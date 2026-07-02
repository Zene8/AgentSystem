// memory-onboard.test.js — tests for memory-onboard.js
// Uses a temp AGENT_MEMORY_ROOT and temp HOME — real ~/agent-memory is never touched.
// Run: node --test tools/memory-onboard.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Import the pure extract helper for unit tests (no subprocess needed)
import { extractAndRemember } from './memory-onboard.js';
import { appendFactToBrain } from './brain-remember.js';

const TOOL = join(fileURLToPath(import.meta.url), '..', 'memory-onboard.js');

// ── Temp environment setup ─────────────────────────────────────────────────────

let fakeMemRoot;
let brainPath;
let fakeHome;
let registryPath;

const STUB_BRAIN = `# User Brain

## Who I Am

- Solo founder

## Session Notes

`;

before(() => {
  fakeMemRoot = mkdtempSync(join(tmpdir(), 'mo-test-mem-'));
  fakeHome    = mkdtempSync(join(tmpdir(), 'mo-test-home-'));

  // Build the brain at expected path
  const personalBrainDir = join(fakeMemRoot, 'nexus', 'personal-brain');
  mkdirSync(personalBrainDir, { recursive: true });
  brainPath = join(personalBrainDir, 'user-brain.md');
  writeFileSync(brainPath, STUB_BRAIN);

  // Build empty session registry
  const nexusDir = join(fakeHome, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });
  registryPath = join(nexusDir, 'session-registry.jsonl');
  writeFileSync(registryPath, '');
});

after(() => {
  rmSync(fakeMemRoot, { recursive: true, force: true });
  rmSync(fakeHome,    { recursive: true, force: true });
});

/** Reset brain to stub state between tests that modify it. */
function resetBrain() {
  writeFileSync(brainPath, STUB_BRAIN);
}

/** Run memory-onboard.js in a subprocess with isolated env. */
function run(args, stdinText) {
  const opts = {
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_MEMORY_ROOT: fakeMemRoot,
      HOME: fakeHome,
    },
    timeout: 15_000,
  };
  if (stdinText !== undefined) {
    opts.input = stdinText;
  }
  return spawnSync(process.execPath, [TOOL, ...args], opts);
}

function readBrain() {
  return readFileSync(brainPath, 'utf8');
}

// ── Unit tests: extractAndRemember using injected no-op LLM ──────────────────

test('extractAndRemember returns early on empty text', async () => {
  const result = extractAndRemember('', { section: 'Session Notes' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.extracted, 0);
});

test('extractAndRemember with stub LLM that returns classified JSON-line facts', () => {
  resetBrain();

  const prev = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = fakeMemRoot;

  const stubLlm = () => [
    '{"fact": "prefers dark mode", "tier": "personal", "target": ""}',
    '{"fact": "deploys to Railway", "tier": "personal", "target": ""}',
  ].join('\n');
  const result = extractAndRemember('some prompt text', {
    section: 'Session Notes',
    llm: stubLlm,
  });

  process.env.AGENT_MEMORY_ROOT = prev;

  assert.strictEqual(result.ok, true);
  assert.ok(result.extracted >= 1, `expected >=1 extracted facts, got ${result.extracted}`);
  assert.ok(result.byTier.personal >= 1);
});

test('extractAndRemember groups mixed-tier facts into byTier counts', () => {
  resetBrain();

  const prev = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = fakeMemRoot;

  // No repos/agents are registered in this fixture's known-repos.json, so a repo/agent
  // classification the LLM emits gets coerced back to personal by parseClassifiedFacts —
  // this test asserts that coercion, not a successful repo/agent write (that's covered
  // in brain-remember.test.js with a real fixture repo).
  const stubLlm = () => [
    '{"fact": "prefers dark mode", "tier": "personal", "target": ""}',
    '{"fact": "some repo fact", "tier": "repo", "target": "nonexistent-repo"}',
  ].join('\n');
  const result = extractAndRemember('some prompt text', { section: 'Session Notes', llm: stubLlm });

  process.env.AGENT_MEMORY_ROOT = prev;

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.byTier.repo, 0, 'unregistered repo target should be coerced to personal, not counted as repo');
  assert.ok(result.byTier.personal >= 1);
});

// ── CLI tests: --fact mode (no LLM — direct write) ───────────────────────────

test('--fact writes a new fact to the brain', () => {
  resetBrain();

  const { status, stdout, stderr } = run(['--fact=prefers TypeScript strict mode']);
  if (status !== 0) {
    throw new Error(`exit ${status}\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  assert.match(stdout, /remembered.*Session Notes.*prefers TypeScript strict mode/i);

  const brain = readBrain();
  assert.match(brain, /prefers TypeScript strict mode/);
});

test('--fact deduplicates an already-known fact', () => {
  resetBrain();
  // Write it once
  run(['--fact=solo founder']);
  // Write again — should be skipped
  const { status, stdout } = run(['--fact=solo founder']);
  assert.strictEqual(status, 0);
  assert.match(stdout, /already known/i);
});

test('--fact with custom --section writes to that section', () => {
  resetBrain();

  const { status, stdout } = run(['--fact=uses Railway for deploys', '--section=Deployment Preferences']);
  assert.strictEqual(status, 0);
  assert.match(stdout, /remembered.*Deployment Preferences/i);

  const brain = readBrain();
  assert.match(brain, /## Deployment Preferences/);
  assert.match(brain, /uses Railway for deploys/);
});

test('--fact with empty value shows help (no fact to write)', () => {
  // --fact= with empty value: flag parser sees falsy value, falls through to help — exits 0
  // This is the actual behavior: empty fact → treated as no --fact flag → help shown
  const { status, stdout } = run(['--fact=']);
  assert.strictEqual(status, 0);
  assert.match(stdout, /memory-onboard|Modes/i);
});

// ── CLI tests: --text mode (stub LLM via env override not available in subprocess) ─

// For --text/stdin tests we test the parsing layer (no LLM spawned) by
// relying on the empty-text fast-path.

test('--text with whitespace-only string exits non-zero with empty error', () => {
  // --text with only whitespace: tool detects empty text and errors — exits 1
  const { status, stderr } = run(['--text=   ']);
  assert.strictEqual(status, 1);
  assert.match(stderr, /empty/i);
});

// ── CLI tests: --session mode ────────────────────────────────────────────────

test('--session with unknown ID exits non-zero', () => {
  const { status, stderr, stdout } = run(['--session=deadbeef']);
  assert.strictEqual(status, 1);
  const combined = stdout + stderr;
  assert.match(combined, /session not found|not found/i);
});

// ── CLI tests: help / no-input mode ─────────────────────────────────────────

test('no args in TTY shows help text', () => {
  // In a subprocess stdin is not a TTY but we can check: if no input and no flags,
  // with stdin closed (no piped data), it should show help.
  // We simulate by passing empty-ish input.
  // Note: When stdin IS a pipe, readStdin() returns null on empty → falls through to help.
  const { status, stdout } = run([], '');
  assert.strictEqual(status, 0, 'help path should exit 0');
  assert.match(stdout, /memory-onboard\.js|Modes/i);
});

// ── CLI tests: stdin mode ────────────────────────────────────────────────────

test('stdin with empty content falls through to help', () => {
  const { status, stdout } = run([], '');
  assert.strictEqual(status, 0);
  // Either help or "no durable facts" — both are valid for empty stdin
  assert.ok(
    stdout.match(/memory-onboard|no durable facts/i),
    `unexpected stdout: ${stdout}`
  );
});
