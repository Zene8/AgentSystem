// session-namer-humanfilter.test.js — tests for Bug 1 (origin-less SDK sessions) and Bug 3 (name format)
// Tests: (a) SDK origin-less lines are accepted, (b) system/task-notification are rejected, (c) buildName format

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = join(fileURLToPath(import.meta.url), '..', 'session-namer.js');

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal session registry JSONL string. */
function makeRegistry(entries) {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

let fakeHome;
let registryPath;
let projectsDir;

const TEST_SESSION_ID = 'test0011223344';

before(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'sn-filter-test-'));
  const nexusDir = join(fakeHome, 'agent-memory', 'nexus');
  projectsDir = join(fakeHome, '.claude', 'projects');
  mkdirSync(nexusDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });
  registryPath = join(nexusDir, 'session-registry.jsonl');
});

after(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

/** Run session-namer with SESSION_NAMER_HOME overridden (Windows compat). */
function run(args) {
  return execFileSync(
    process.execPath,
    [TOOL, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, SESSION_NAMER_HOME: fakeHome },
      timeout: 10_000,
    }
  ).trim();
}

/** Parse registry entries. */
function readRegistry() {
  return readFileSync(registryPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('buildName format (via --register): repo - title - YYYY-MM-DD HH:MM', () => {
  // Exercise the real buildName() code path through cmdRegister rather than
  // hand-writing the expected string, so this actually tests the fix.
  const sessionId = 'buildfmt0011223344';
  run(['--register', `--session=${sessionId}`, '--cwd=/tmp/agentsystem']);
  const entry = readRegistry().find(e => e.session === sessionId);
  assert.ok(entry, 'entry should be registered');
  assert.match(entry.name, /^agentsystem - pending - [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$/);
});

test('SDK origin-less session (Bug 1) - readFirstUserMessage accepts promptSource:sdk with no origin', () => {
  // Create a fake transcript with origin:undefined but promptSource:'sdk'
  const projectDirName = 'test-' + TEST_SESSION_ID.slice(0, 8);
  const projDir = join(projectsDir, projectDirName);
  mkdirSync(projDir, { recursive: true });
  
  const transcript = join(projDir, `${TEST_SESSION_ID}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'user',
      origin: undefined,  // No origin field
      promptSource: 'sdk',
      message: { content: 'debug session namer bugs' },
      timestamp: '2026-07-02T14:35:00.000Z',
      cwd: '/tmp/agentsystem',
    }),
  ];
  writeFileSync(transcript, lines.join('\n'));
  
  // Register and finalize the session
  const entry = {
    session: TEST_SESSION_ID,
    repo: 'test',
    cwd: '/tmp/agentsystem',
    title: 'pending',
    name: 'test pending 2026-07-02',
    timestamp: '2026-07-02T00:00:00.000Z',
    finalized: false,
  };
  writeFileSync(registryPath, makeRegistry([entry]));
  
  // Finalize should now succeed (before Bug 1 fix, this would stay pending)
  run(['--finalize', `--session=${TEST_SESSION_ID}`]);

  const updated = readRegistry().find(e => e.session === TEST_SESSION_ID);
  assert.strictEqual(updated.finalized, true);
  assert.notStrictEqual(updated.title, 'pending');
  // After titleFromText filtering, expect "debug session namer bugs" (remove stop words: "the")
  // Actually, "debug" is not a stop word, so we expect it to be there
  assert.ok(updated.title.includes('session') || updated.title.includes('namer') || updated.title.includes('bugs'));
  // Full name format: "repo - title - YYYY-MM-DD HH:MM" (NO done marker from --finalize).
  // The done marker is only applied by --finalize-close (SessionEnd hook).
  assert.match(updated.name, /^test - .+ - [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$/);
});

test('system promptSource (Bug 1) - readFirstUserMessage rejects promptSource:system even with valid content', () => {
  // Create a fake transcript with promptSource:'system' (should be rejected)
  const projectDirName = 'test-sys-' + TEST_SESSION_ID.slice(0, 8);
  const projDir = join(projectsDir, projectDirName);
  mkdirSync(projDir, { recursive: true });
  
  const sessionId = 'testsys0011223344';
  const transcript = join(projDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'user',
      origin: undefined,
      promptSource: 'system',  // This is NOT in HUMAN_PROMPT_SOURCES
      message: { content: 'important system message' },
      timestamp: '2026-07-02T14:35:00.000Z',
      cwd: '/tmp/test',
    }),
  ];
  writeFileSync(transcript, lines.join('\n'));
  
  // Register the session
  const entry = {
    session: sessionId,
    repo: 'test',
    cwd: '/tmp/test',
    title: 'pending',
    name: 'test pending 2026-07-02',
    timestamp: '2026-07-02T00:00:00.000Z',
    finalized: false,
  };
  writeFileSync(registryPath, makeRegistry([entry]));
  
  // Finalize should NOT find the message (no real user message to extract)
  run(['--finalize', `--session=${sessionId}`]);
  
  const updated = readRegistry().find(e => e.session === sessionId);
  // Title should still be pending because no real user message was found
  assert.strictEqual(updated.title, 'pending');
  assert.strictEqual(updated.finalized, false);
});

test('task-notification promptSource (Bug 1) - readFirstUserMessage rejects promptSource:task-notification', () => {
  // Create a fake transcript with promptSource:'task-notification' (should be rejected)
  const projectDirName = 'test-task-' + TEST_SESSION_ID.slice(0, 8);
  const projDir = join(projectsDir, projectDirName);
  mkdirSync(projDir, { recursive: true });

  const sessionId = 'testtask0011223344';
  const transcript = join(projDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'user',
      origin: undefined,
      promptSource: 'task-notification',  // This is NOT in HUMAN_PROMPT_SOURCES
      message: { content: 'automated task notification' },
      timestamp: '2026-07-02T14:35:00.000Z',
      cwd: '/tmp/test',
    }),
  ];
  writeFileSync(transcript, lines.join('\n'));

  // Register the session
  const entry = {
    session: sessionId,
    repo: 'test',
    cwd: '/tmp/test',
    title: 'pending',
    name: 'test pending 2026-07-02',
    timestamp: '2026-07-02T00:00:00.000Z',
    finalized: false,
  };
  writeFileSync(registryPath, makeRegistry([entry]));

  // Finalize should NOT find the message
  run(['--finalize', `--session=${sessionId}`]);

  const updated = readRegistry().find(e => e.session === sessionId);
  assert.strictEqual(updated.title, 'pending');
  assert.strictEqual(updated.finalized, false);
});

test('--finalize does NOT apply done marker (Bug 2 fix)', () => {
  // Create a transcript with a user message
  const projectDirName = 'tmp-work';
  const projDir = join(projectsDir, projectDirName);
  mkdirSync(projDir, { recursive: true });

  const sessionId = 'finalize-nomark-1234';
  const transcript = join(projDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'user',
      origin: { kind: 'human' },
      message: { content: 'fix session hooks issue' },
      timestamp: '2026-07-03T10:30:00.000Z',
      cwd: '/tmp/work',
    }),
  ];
  writeFileSync(transcript, lines.join('\n'));

  // Register a session entry
  const entry = {
    session: sessionId,
    repo: 'myrepo',
    cwd: '/tmp/work',
    title: 'pending',
    name: 'myrepo - pending - 2026-07-03 10:30',
    timestamp: '2026-07-03T10:30:00.000Z',
    finalized: false,
  };
  writeFileSync(registryPath, makeRegistry([entry]));

  // Run --finalize (Stop hook path)
  run(['--finalize', `--session=${sessionId}`]);

  const updated = readRegistry().find(e => e.session === sessionId);
  assert.strictEqual(updated.finalized, true);
  // Name should NOT have the done marker appended
  assert.match(updated.name, /^myrepo - .+ - [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$/);
  assert.doesNotMatch(updated.name, /[+] [(]done[)]/);
});

test('--finalize-close applies done marker (Bug 2 fix - SessionEnd path)', () => {
  // Register a session with a real title
  const sessionId = 'finalize-close-1234';
  const entry = {
    session: sessionId,
    repo: 'myrepo',
    cwd: '/tmp/work',
    title: 'fix session hooks',
    name: 'myrepo - fix session hooks - 2026-07-03 10:30',
    timestamp: '2026-07-03T10:30:00.000Z',
    finalized: true,
  };
  writeFileSync(registryPath, makeRegistry([entry]));

  // Run --finalize-close (SessionEnd hook path)
  run(['--finalize-close', `--session=${sessionId}`]);

  const updated = readRegistry().find(e => e.session === sessionId);
  assert.strictEqual(updated.finalized, true);
  // Name SHOULD have the done marker appended
  assert.match(updated.name, /[+] [(]done[)]$/);
  assert.strictEqual(updated.name, 'myrepo - fix session hooks - 2026-07-03 10:30 + (done)');
});

test('--finalize-close is idempotent (does not double-mark)', () => {
  // Register a session that already has the done marker
  const sessionId = 'finalize-close-idempot';
  const entry = {
    session: sessionId,
    repo: 'myrepo',
    cwd: '/tmp/work',
    title: 'fix session hooks',
    name: 'myrepo - fix session hooks - 2026-07-03 10:30 + (done)',
    timestamp: '2026-07-03T10:30:00.000Z',
    finalized: true,
  };
  writeFileSync(registryPath, makeRegistry([entry]));

  // Run --finalize-close again
  run(['--finalize-close', `--session=${sessionId}`]);

  const updated = readRegistry().find(e => e.session === sessionId);
  // Should still have exactly one done marker
  assert.strictEqual(updated.name, 'myrepo - fix session hooks - 2026-07-03 10:30 + (done)');
  const matches = updated.name.match(/[+] [(]done[)]/g);
  assert.strictEqual(matches.length, 1, 'should have exactly one done marker');
});
