/**
 * tests/test_session_namer.js
 * Tests for session-namer.js — sweep, finalize-early, idempotency
 *
 * Run: node --test tests/test_session_namer.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const d = join(tmpdir(), `session-namer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeRegistry(dir, entries) {
  const p = join(dir, 'session-registry.jsonl');
  writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return p;
}

function readRegistry(registryPath) {
  return readFileSync(registryPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l));
}

/**
 * Create a fake Claude Code transcript with a typed user message.
 * projectDir must exist and follow Claude's convention: /<cwd-as-path>.
 */
function makeTranscript(projectDir, sessionId, userText) {
  mkdirSync(projectDir, { recursive: true });
  const filePath = join(projectDir, `${sessionId}.jsonl`);
  const line = JSON.stringify({
    type: 'user',
    origin: { kind: 'human' },
    promptSource: 'typed',
    timestamp: new Date().toISOString(),
    cwd: '/home/test/myrepo',
    message: { content: userText },
  });
  writeFileSync(filePath, line + '\n', 'utf8');
  return filePath;
}

/**
 * Run session-namer.js with overridden HOME so it reads our test registry/projects.
 * We override HOME via env so REGISTRY and PROJECTS_DIR resolve to tmp.
 */
function runNamer(args, { HOME }) {
  const result = execFileSync(
    process.execPath,
    [join(process.cwd(), 'tools/session-namer.js'), ...args],
    { env: { ...process.env, HOME, SESSION_NAMER_HOME: HOME }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return result;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('--sweep: fixes stuck pending session that has a transcript', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const sessionId = 'aaaa1111-0000-0000-0000-000000000001';
  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-'); // -home-test-myrepo

  // Create fake project directory with transcript
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);
  makeTranscript(projectDir, sessionId, 'fix the login bug on the dashboard page');

  // Create registry with stuck pending entry
  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd, title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  const output = runNamer(['--sweep'], { HOME: tmp });
  assert.match(output, /sweep fixed aaaa1111/, 'sweep should report fixed session');
  // Note: "fix" is a stop word so it's stripped; title uses remaining significant words
  assert.match(output, /login bug dashboard page/, 'sweep should use transcript text for name');

  const entries = readRegistry(registryPath);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].finalized, true, 'entry should be finalized after sweep');
  assert.ok(entries[0].title !== 'pending', 'title should not be "pending" after sweep');
  assert.ok(entries[0].first_prompt?.includes('fix the login bug'), 'first_prompt should be set');
  assert.ok(entries[0].name.includes('login bug dashboard page'), 'name should contain title words');

  rmSync(tmp, { recursive: true, force: true });
});

test('--sweep: skips sessions with no transcript', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });
  mkdirSync(join(tmp, '.claude', 'projects'), { recursive: true });

  const sessionId = 'bbbb2222-0000-0000-0000-000000000002';
  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd: '/home/test/myrepo', title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  const output = runNamer(['--sweep'], { HOME: tmp });
  assert.match(output, /no-transcript: 1/, 'sweep should report 1 skipped (no transcript)');

  const entries = readRegistry(registryPath);
  // Entry remains unchanged — sweep does not mark finalized when no transcript
  assert.equal(entries[0].finalized, false, 'entry should remain unfinalized when no transcript');

  rmSync(tmp, { recursive: true, force: true });
});

test('--sweep: never clobbers already-named sessions', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const sessionId = 'cccc3333-0000-0000-0000-000000000003';
  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-');
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);
  makeTranscript(projectDir, sessionId, 'this text should not overwrite the good name');

  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd, title: 'already good title',
      name: 'myrepo already good title 2026-06-01', timestamp: '2026-06-01T00:00:00.000Z',
      finalized: true, first_prompt: 'original prompt text' }
  ]);

  const output = runNamer(['--sweep'], { HOME: tmp });
  assert.match(output, /no pending sessions|fixed: 0/, 'sweep should not touch already-named sessions');

  const entries = readRegistry(registryPath);
  assert.equal(entries[0].title, 'already good title', 'existing title must be preserved');
  assert.equal(entries[0].first_prompt, 'original prompt text', 'first_prompt must not be overwritten');

  rmSync(tmp, { recursive: true, force: true });
});

test('--finalize-early: names session when transcript has a message', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const sessionId = 'dddd4444-0000-0000-0000-000000000004';
  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-');
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);
  makeTranscript(projectDir, sessionId, 'refactor authentication middleware for speed');

  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd, title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  const output = runNamer(['--finalize-early', `--session=${sessionId}`], { HOME: tmp });
  assert.match(output, /early-finalize dddd4444/, 'finalize-early should report the session');

  const entries = readRegistry(registryPath);
  assert.equal(entries[0].finalized, true, 'entry should be finalized');
  assert.match(entries[0].name, /refactor authentication middleware/, 'name should use prompt text');

  rmSync(tmp, { recursive: true, force: true });
});

test('--finalize-early: no-ops when transcript not available yet', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });
  mkdirSync(join(tmp, '.claude', 'projects'), { recursive: true });

  const sessionId = 'eeee5555-0000-0000-0000-000000000005';
  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd: '/home/test/myrepo', title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  // No transcript file created — simulates the race where hook fires before transcript is written
  runNamer(['--finalize-early', `--session=${sessionId}`], { HOME: tmp });

  const entries = readRegistry(registryPath);
  // Should remain pending — Stop hook will catch it later, or next sweep will
  assert.equal(entries[0].finalized, false, 'entry should remain unfinalized when no transcript yet');
  assert.equal(entries[0].title, 'pending', 'title should remain "pending"');

  rmSync(tmp, { recursive: true, force: true });
});

test('--finalize-early: idempotent — does not clobber already-named session', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const sessionId = 'ffff6666-0000-0000-0000-000000000006';
  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-');
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);
  makeTranscript(projectDir, sessionId, 'this text should be ignored');

  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd, title: 'keep this name',
      name: 'myrepo keep this name 2026-06-01', timestamp: '2026-06-01T00:00:00.000Z',
      finalized: true, first_prompt: 'original prompt kept' }
  ]);

  runNamer(['--finalize-early', `--session=${sessionId}`], { HOME: tmp });

  const entries = readRegistry(registryPath);
  assert.equal(entries[0].title, 'keep this name', 'title must not be overwritten');
  assert.equal(entries[0].first_prompt, 'original prompt kept', 'first_prompt must not be overwritten');

  rmSync(tmp, { recursive: true, force: true });
});

test('--sweep: fixes multiple pending sessions in one run', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-');
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);

  const s1 = 'aaaa0001-0000-0000-0000-000000000001';
  const s2 = 'aaaa0002-0000-0000-0000-000000000002';
  const s3 = 'aaaa0003-0000-0000-0000-000000000003';

  makeTranscript(projectDir, s1, 'deploy the new payment service api');
  makeTranscript(projectDir, s2, 'fix null pointer in user profile loader');
  // s3 has no transcript — should be skipped

  const registryPath = makeRegistry(nexusDir, [
    { session: s1, repo: 'myrepo', cwd, title: 'pending', name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false },
    { session: s2, repo: 'myrepo', cwd, title: 'pending', name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false },
    { session: s3, repo: 'myrepo', cwd, title: 'pending', name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false },
  ]);

  const output = runNamer(['--sweep'], { HOME: tmp });
  assert.match(output, /fixed: 2/, 'sweep should fix 2 sessions');
  assert.match(output, /no-transcript: 1/, 'sweep should skip 1 session with no transcript');

  const entries = readRegistry(registryPath);
  const e1 = entries.find(e => e.session === s1);
  const e2 = entries.find(e => e.session === s2);
  const e3 = entries.find(e => e.session === s3);
  assert.equal(e1.finalized, true);
  assert.ok(e1.name.includes('deploy') || e1.name.includes('payment') || e1.name.includes('service'));
  assert.equal(e2.finalized, true);
  assert.ok(e2.name.includes('null') || e2.name.includes('pointer') || e2.name.includes('profile'));
  assert.equal(e3.finalized, false, 's3 should remain unfinalized');

  rmSync(tmp, { recursive: true, force: true });
});

// ── Done marker tests ────────────────────────────────────────────────────────

test('done marker: finalized session name ends with " + (done)"', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const sessionId = 'done1111-0000-0000-0000-000000000001';
  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-');
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);
  makeTranscript(projectDir, sessionId, 'build the user authentication flow');

  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd, title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  runNamer(['--finalize', `--session=${sessionId}`], { HOME: tmp });

  const entries = readRegistry(registryPath);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].name.endsWith(' + (done)'), `name should end with " + (done)", got: "${entries[0].name}"`);

  rmSync(tmp, { recursive: true, force: true });
});

test('done marker: title field is NOT affected by done marker', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const sessionId = 'done2222-0000-0000-0000-000000000002';
  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-');
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);
  makeTranscript(projectDir, sessionId, 'migrate database schema columns');

  makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd, title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  runNamer(['--finalize', `--session=${sessionId}`], { HOME: tmp });

  const registryPath = join(nexusDir, 'session-registry.jsonl');
  const entries = readRegistry(registryPath);
  assert.equal(entries.length, 1);
  // title must not contain the marker
  assert.ok(!entries[0].title.includes('(done)'), `title must not contain "(done)", got: "${entries[0].title}"`);
  // name must contain the marker
  assert.ok(entries[0].name.endsWith(' + (done)'), `name must end with " + (done)", got: "${entries[0].name}"`);

  rmSync(tmp, { recursive: true, force: true });
});

test('done marker: pending session does NOT get the marker', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });
  mkdirSync(join(tmp, '.claude', 'projects'), { recursive: true });

  const sessionId = 'done3333-0000-0000-0000-000000000003';
  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd: '/home/test/myrepo', title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  // No transcript — finalize-early will no-op, leaving entry as pending
  runNamer(['--finalize-early', `--session=${sessionId}`], { HOME: tmp });

  const entries = readRegistry(registryPath);
  assert.equal(entries[0].finalized, false, 'entry must remain unfinalized');
  assert.ok(!entries[0].name.includes('(done)'), 'pending name must not contain "(done)"');

  rmSync(tmp, { recursive: true, force: true });
});

test('done marker: idempotent — re-finalizing does not double-append marker', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const sessionId = 'done4444-0000-0000-0000-000000000004';
  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-');
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);
  makeTranscript(projectDir, sessionId, 'implement search indexing pipeline');

  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd, title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  // Finalize once
  runNamer(['--finalize', `--session=${sessionId}`], { HOME: tmp });
  const after1 = readRegistry(registryPath)[0];
  assert.ok(after1.name.endsWith(' + (done)'), 'first finalize should add marker');

  // Re-run sweep — must not double-append
  runNamer(['--sweep'], { HOME: tmp });
  const after2 = readRegistry(registryPath)[0];
  const markerCount = (after2.name.match(/\+ \(done\)/g) || []).length;
  assert.equal(markerCount, 1, `marker should appear exactly once, got name: "${after2.name}"`);

  rmSync(tmp, { recursive: true, force: true });
});

test('done marker: sweep retro-marks existing finalized entries missing the marker', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });
  mkdirSync(join(tmp, '.claude', 'projects'), { recursive: true });

  const sessionId = 'done5555-0000-0000-0000-000000000005';
  // Pre-existing finalized entry without the done marker (simulates data before this feature)
  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd: '/home/test/myrepo',
      title: 'old session title',
      name: 'myrepo old session title 2026-06-01',
      timestamp: '2026-06-01T00:00:00.000Z',
      finalized: true, first_prompt: 'original prompt' }
  ]);

  const output = runNamer(['--sweep'], { HOME: tmp });
  assert.match(output, /retro-marked 1/, 'sweep should report retro-marking 1 existing session');

  const entries = readRegistry(registryPath);
  assert.equal(entries[0].name, 'myrepo old session title 2026-06-01 + (done)',
    'retro-sweep should add marker to existing finalized entry');
  // title must remain clean
  assert.equal(entries[0].title, 'old session title', 'title must not be modified by retro-sweep');

  rmSync(tmp, { recursive: true, force: true });
});

test('done marker: finalize-early adds marker on first-time finalize', async () => {
  const tmp = makeTmpDir();
  const nexusDir = join(tmp, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });

  const sessionId = 'done6666-0000-0000-0000-000000000006';
  const cwd = '/home/test/myrepo';
  const cwdSlug = cwd.replace(/\//g, '-');
  const projectDir = join(tmp, '.claude', 'projects', cwdSlug);
  makeTranscript(projectDir, sessionId, 'add rate limiting middleware');

  const registryPath = makeRegistry(nexusDir, [
    { session: sessionId, repo: 'myrepo', cwd, title: 'pending',
      name: 'myrepo pending 2026-07-01', timestamp: '2026-07-01T00:00:00.000Z', finalized: false }
  ]);

  runNamer(['--finalize-early', `--session=${sessionId}`], { HOME: tmp });

  const entries = readRegistry(registryPath);
  assert.equal(entries[0].finalized, true);
  assert.ok(entries[0].name.endsWith(' + (done)'), `finalize-early name must end with " + (done)", got: "${entries[0].name}"`);
  assert.ok(!entries[0].title.includes('(done)'), 'title must be clean');

  rmSync(tmp, { recursive: true, force: true });
});
