// session-bulk-rename.test.js — tests for tools/session-bulk-rename.js (issue #518).
// Node built-in test runner. No real subprocess/model calls: runClaude/runNamer/fsOps injected.
// Run: node --test tools/session-bulk-rename.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectSessions,
  decodeProjectDir,
  isEligible,
  runBulkRename,
} from './session-bulk-rename.js';

// ── selectSessions ───────────────────────────────────────────────────────────

test('selectSessions sorts by mtime descending', () => {
  const sessions = [
    { id: 'a', mtimeMs: 100 },
    { id: 'b', mtimeMs: 300 },
    { id: 'c', mtimeMs: 200 },
  ];
  const result = selectSessions(sessions, 3);
  assert.deepEqual(result.map(s => s.id), ['b', 'c', 'a']);
});

test('selectSessions with n=-1 selects all sessions', () => {
  const sessions = [
    { id: 'a', mtimeMs: 100 },
    { id: 'b', mtimeMs: 300 },
    { id: 'c', mtimeMs: 200 },
  ];
  const result = selectSessions(sessions, -1);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(s => s.id), ['b', 'c', 'a']);
});

test('selectSessions with n slices to that many, most recent first', () => {
  const sessions = [
    { id: 'a', mtimeMs: 100 },
    { id: 'b', mtimeMs: 300 },
    { id: 'c', mtimeMs: 200 },
    { id: 'd', mtimeMs: 400 },
  ];
  const result = selectSessions(sessions, 2);
  assert.deepEqual(result.map(s => s.id), ['d', 'b']);
});

test('selectSessions with n larger than list returns all', () => {
  const sessions = [{ id: 'a', mtimeMs: 100 }, { id: 'b', mtimeMs: 200 }];
  const result = selectSessions(sessions, 50);
  assert.equal(result.length, 2);
});

// ── decodeProjectDir ─────────────────────────────────────────────────────────

test('decodeProjectDir mirrors cmdScan\'s inline decode', () => {
  assert.equal(decodeProjectDir('-Users-natha-dev-AgentSystem'), '/Users/natha/dev/AgentSystem');
  assert.equal(decodeProjectDir('-home-basely-AgentSystem'), '/home/basely/AgentSystem');
});

// ── isEligible ───────────────────────────────────────────────────────────────

test('isEligible: skips when an autorename marker exists', () => {
  const eligible = isEligible({
    entry: { session: 'x', renamed: false },
    markerExists: true,
    force: false,
  });
  assert.equal(eligible, false);
});

test('isEligible: skips when renamed:true and no marker (manual rename)', () => {
  const eligible = isEligible({
    entry: { session: 'x', renamed: true },
    markerExists: false,
    force: false,
  });
  assert.equal(eligible, false);
});

test('isEligible: eligible when no marker and not manually renamed', () => {
  const eligible = isEligible({
    entry: { session: 'x', renamed: false },
    markerExists: false,
    force: false,
  });
  assert.equal(eligible, true);
});

test('isEligible: unregistered session (no entry) is eligible', () => {
  const eligible = isEligible({ entry: null, markerExists: false, force: false });
  assert.equal(eligible, true);
});

test('isEligible: --force bypasses marker skip', () => {
  const eligible = isEligible({
    entry: { session: 'x', renamed: false },
    markerExists: true,
    force: true,
  });
  assert.equal(eligible, true);
});

test('isEligible: --force bypasses manual-rename skip', () => {
  const eligible = isEligible({
    entry: { session: 'x', renamed: true },
    markerExists: false,
    force: true,
  });
  assert.equal(eligible, true);
});

// ── runBulkRename (worker pool, injected runners) ────────────────────────────

function makeFsOps({ registry = {}, markers = new Set() } = {}) {
  return {
    getRegistryEntry: (sessionId) => registry[sessionId] || null,
    hasMarker: (sessionId) => markers.has(sessionId),
    writeMarker: (sessionId) => { markers.add(sessionId); },
    register: () => {},
  };
}

test('dry-run makes zero calls into the injected claude-runner', async () => {
  const sessions = [
    { id: 's1', mtimeMs: 100, dirName: '-tmp-repo1' },
    { id: 's2', mtimeMs: 200, dirName: '-tmp-repo2' },
  ];
  let claudeCalls = 0;
  let namerCalls = 0;
  const result = await runBulkRename({
    sessions,
    n: -1,
    dryRun: true,
    force: false,
    jobs: 2,
    fsOps: makeFsOps(),
    runClaude: () => { claudeCalls++; return '{"summary":"a b c d","status":"done"}'; },
    runNamer: () => { namerCalls++; },
  });
  assert.equal(claudeCalls, 0);
  assert.equal(namerCalls, 0);
  assert.equal(result.renamed, 0);
  assert.equal(result.planned, 2);
});

test('marker-present sessions are skipped (not force)', async () => {
  const sessions = [{ id: 's1', mtimeMs: 100, dirName: '-tmp-repo1' }];
  const fsOps = makeFsOps({ markers: new Set(['s1']) });
  let claudeCalls = 0;
  const result = await runBulkRename({
    sessions,
    n: -1,
    dryRun: false,
    force: false,
    jobs: 2,
    fsOps,
    runClaude: () => { claudeCalls++; return '{"summary":"a b c d","status":"done"}'; },
    runNamer: () => {},
  });
  assert.equal(claudeCalls, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.renamed, 0);
});

test('manually-renamed sessions (renamed:true, no marker) are skipped', async () => {
  const sessions = [{ id: 's1', mtimeMs: 100, dirName: '-tmp-repo1' }];
  const fsOps = makeFsOps({ registry: { s1: { session: 's1', renamed: true } } });
  let claudeCalls = 0;
  const result = await runBulkRename({
    sessions,
    n: -1,
    dryRun: false,
    force: false,
    jobs: 2,
    fsOps,
    runClaude: () => { claudeCalls++; return '{"summary":"a b c d","status":"done"}'; },
    runNamer: () => {},
  });
  assert.equal(claudeCalls, 0);
  assert.equal(result.skipped, 1);
});

test('--force bypasses both marker and manual-rename filters', async () => {
  const sessions = [
    { id: 's1', mtimeMs: 100, dirName: '-tmp-repo1' },
    { id: 's2', mtimeMs: 90, dirName: '-tmp-repo2' },
  ];
  const fsOps = makeFsOps({
    registry: { s2: { session: 's2', renamed: true } },
    markers: new Set(['s1']),
  });
  let claudeCalls = 0;
  const result = await runBulkRename({
    sessions,
    n: -1,
    dryRun: false,
    force: true,
    jobs: 2,
    fsOps,
    runClaude: () => { claudeCalls++; return '{"summary":"a b c d","status":"done"}'; },
    runNamer: () => {},
    readDigest: () => 'some digest text long enough to pass the thin check 1234567890',
  });
  assert.equal(claudeCalls, 2);
  assert.equal(result.renamed, 2);
});

test('one session failing does not stop the rest of the pool', async () => {
  const sessions = [
    { id: 's1', mtimeMs: 300, dirName: '-tmp-repo1' },
    { id: 's2', mtimeMs: 200, dirName: '-tmp-repo2' },
    { id: 's3', mtimeMs: 100, dirName: '-tmp-repo3' },
  ];
  const fsOps = makeFsOps();
  const seen = [];
  const result = await runBulkRename({
    sessions,
    n: -1,
    dryRun: false,
    force: false,
    jobs: 2,
    fsOps,
    runClaude: (id) => {
      seen.push(id);
      if (id === 's2') throw new Error('boom');
      return '{"summary":"a b c d","status":"done"}';
    },
    runNamer: () => {},
    readDigest: () => 'some digest text long enough to pass the thin check 1234567890',
  });
  assert.equal(seen.length, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.renamed, 2);
});
