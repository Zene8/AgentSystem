'use strict';
// Regression tests for #114: memory-router.js's keyword table must agree with jarvis.md's
// routing table (infra/deploy/CI and schema/DB → Friday, not directly to Leo/Pym), have an
// r2d2 fallback, and not misroute on the bare word "audit".
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, matchDomain } = require('./memory-router.js');

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

test('matchDomain returns empty string when nothing matches', () => {
  assert.strictEqual(matchDomain('hello there, how is your day'), '');
});
