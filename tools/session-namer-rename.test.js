// session-namer-rename.test.js — tests for the --rename command added to session-namer.js
// Uses a temp HOME so real ~/agent-memory is never touched.
// Run: node --test tools/session-namer-rename.test.js

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

// A stable fake session entry
const FAKE_SESSION_ID = 'aabbccddeeff0011';
const FAKE_ENTRY = {
  session: FAKE_SESSION_ID,
  name:    'original-name',
  title:   'original name',
  repo:    'test-repo',
  cwd:     '/tmp/test',
  date:    '2026-06-30',
};

before(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'sn-rename-test-'));
  // Replicate the registry path that session-namer.js builds from HOME
  const nexusDir = join(fakeHome, 'agent-memory', 'nexus');
  mkdirSync(nexusDir, { recursive: true });
  registryPath = join(nexusDir, 'session-registry.jsonl');
  writeFileSync(registryPath, makeRegistry([FAKE_ENTRY]));
});

after(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

/** Reset registry back to original state before each rename test that modifies it. */
function resetRegistry() {
  writeFileSync(registryPath, makeRegistry([FAKE_ENTRY]));
}

/** Run session-namer with HOME overridden to temp dir. */
function run(args) {
  return execFileSync(
    process.execPath,
    [TOOL, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, HOME: fakeHome },
      timeout: 10_000,
    }
  ).trim();
}

/** Parse the registry entries back out. */
function readRegistry() {
  return readFileSync(registryPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('--rename full ID updates name and title', () => {
  resetRegistry();
  const out = run(['--rename', FAKE_SESSION_ID, 'my new session name']);
  assert.match(out, /renamed.*→.*my new session name/i);

  const entries = readRegistry();
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].name, 'my new session name');
  assert.strictEqual(entries[0].renamed, true);
  assert.ok(entries[0].renamedAt, 'renamedAt should be set');
  // title is a slug (lowercase, letters/digits/spaces only)
  assert.match(entries[0].title, /^[a-z0-9 ]+$/);
});

test('--rename prefix match (8-char prefix)', () => {
  resetRegistry();
  const prefix = FAKE_SESSION_ID.slice(0, 8); // 'aabbccdd'
  const out = run(['--rename', prefix, 'renamed via prefix']);
  assert.match(out, /renamed/i);

  const entries = readRegistry();
  assert.strictEqual(entries[0].name, 'renamed via prefix');
});

test('--rename preserves other fields on the entry', () => {
  resetRegistry();
  run(['--rename', FAKE_SESSION_ID, 'preserved fields test']);
  const [entry] = readRegistry();
  assert.strictEqual(entry.session, FAKE_SESSION_ID);
  assert.strictEqual(entry.repo, 'test-repo');
  assert.strictEqual(entry.cwd, '/tmp/test');
  assert.strictEqual(entry.date, '2026-06-30');
});

test('--rename unknown ID exits non-zero with helpful message', () => {
  let threw = false;
  try {
    run(['--rename', 'deadbeef', 'some name']);
  } catch (e) {
    threw = true;
    const combined = (e.stdout || '') + (e.stderr || '');
    assert.match(combined, /Not in registry|not found/i);
  }
  assert.strictEqual(threw, true, 'expected non-zero exit');
});

test('--rename with no new name exits non-zero', () => {
  let threw = false;
  try {
    run(['--rename', FAKE_SESSION_ID]);
  } catch (e) {
    threw = true;
    const combined = (e.stdout || '') + (e.stderr || '');
    assert.match(combined, /new name required/i);
  }
  assert.strictEqual(threw, true, 'expected non-zero exit');
});

test('--rename with no args exits non-zero', () => {
  let threw = false;
  try {
    run(['--rename']);
  } catch (e) {
    threw = true;
    const combined = (e.stdout || '') + (e.stderr || '');
    assert.match(combined, /session ID required/i);
  }
  assert.strictEqual(threw, true, 'expected non-zero exit');
});

test('positional args do not misfire as --search when --rename is present', () => {
  // "node session-namer.js --rename notexist some name" should fail with rename error,
  // not fall through to search and return search results.
  let threw = false;
  try {
    run(['--rename', 'notexist', 'some name']);
  } catch (e) {
    threw = true;
    const combined = (e.stdout || '') + (e.stderr || '');
    assert.match(combined, /Not in registry|not found/i);
    assert.doesNotMatch(combined, /match.*found|search.*result/i);
  }
  assert.strictEqual(threw, true);
});
