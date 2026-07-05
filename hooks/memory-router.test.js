'use strict';
// Regression tests for #114: memory-router.js's keyword table must agree with jarvis.md's
// routing table (infra/deploy/CI and schema/DB → Friday, not directly to Leo/Pym), have an
// r2d2 fallback, and not misroute on the bare word "audit".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  classify, matchDomain, extractKeywords, markerPath, alreadyInjected, detectRepoSlug,
} = require('./memory-router.js');

test('infra/deploy/CI routes to Friday, not directly to Leo', () => {
  const out = classify('please deploy this to the ci pipeline');
  assert.match(out, /Friday/);
  assert.doesNotMatch(out, /Leo \(DevOps\)/);
});

test('schema/migration routes to Friday, not directly to Pym', () => {
  const out = classify('write a database migration for the schema');
  assert.match(out, /Friday/);
  assert.doesNotMatch(out, /Pym \(database\)/);
});

test('bare "audit" does not misroute to Sam', () => {
  const out = classify('can you audit my config files');
  assert.doesNotMatch(out, /Sam/);
});

test('explicit security audit phrase still routes to Sam', () => {
  const out = classify('run a security audit on this PR');
  assert.match(out, /Sam/);
});

test('one-off script task falls back to r2d2', () => {
  const out = classify('write a one-off script to rename these files');
  assert.match(out, /r2d2/);
});

test('matchDomain returns null when nothing matches', () => {
  assert.strictEqual(matchDomain('hello there, how is your day'), null);
});

test('matchDomain returns the rule id alongside the display hint', () => {
  const m = matchDomain('write a database migration for the schema');
  assert.equal(m.id, 'schema');
  assert.match(m.agentDisplay, /Friday/);
});

// #121: task-aware retrieval helpers.
test('extractKeywords drops short/stopword-length tokens and punctuation', () => {
  const kw = extractKeywords('Deploy the CI pipeline to production ASAP!!');
  assert.ok(kw.includes('deploy'));
  assert.ok(kw.includes('pipeline'));
  assert.ok(kw.includes('production'));
  assert.ok(!kw.includes('the'));
  assert.ok(!kw.includes('ci')); // length <= 3, filtered
});

test('markerPath is stable per transcript_path and distinct across sessions', () => {
  const a = markerPath({ transcript_path: '/tmp/session-a.jsonl' });
  const b = markerPath({ transcript_path: '/tmp/session-a.jsonl' });
  const c = markerPath({ transcript_path: '/tmp/session-b.jsonl' });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test('alreadyInjected: once-per-session marker gates a second call', () => {
  const marker = path.join(os.tmpdir(), `test-marker-${Date.now()}-${Math.random()}.marker`);
  assert.strictEqual(alreadyInjected(marker), false);
  fs.writeFileSync(marker, '1');
  assert.strictEqual(alreadyInjected(marker), true);
  fs.rmSync(marker, { force: true });
});

test('detectRepoSlug: unmatched cwd returns null without throwing', () => {
  assert.strictEqual(detectRepoSlug('/some/nonexistent/path/xyz'), null);
});
