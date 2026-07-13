import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixtureBrain, runEval, feedbackReport, FIXTURE_QUERIES } from './memory-eval.js';

// Memory feedback loop, leg 3: retrieval quality must be pinned in CI. If BM25 scoring,
// the score composite, or the importance blend regresses in graph-query.js, these canned
// queries stop returning their expected nodes and this suite fails the build.

test('fixture brain retrieval: every canned query hits its expected node in top-3', () => {
  const dir = buildFixtureBrain(mkdtempSync(join(tmpdir(), 'memory-eval-test-')));
  const { recallAt3, results } = runEval(dir);
  assert.equal(recallAt3, 1,
    `expected perfect recall@3, misses: ${JSON.stringify(results.filter(r => !r.hitAt3))}`);
});

test('fixture brain retrieval: recall@1 is perfect on the unambiguous fixture', () => {
  const dir = buildFixtureBrain(mkdtempSync(join(tmpdir(), 'memory-eval-test-')));
  const { recallAt1 } = runEval(dir);
  assert.equal(recallAt1, 1);
});

test('fixture has at least 4 queries so the eval is not trivially green', () => {
  assert.ok(FIXTURE_QUERIES.length >= 4);
});

test('feedbackReport aggregates used/injected per brain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-eval-fb-'));
  const log = join(dir, 'injection-feedback.jsonl');
  writeFileSync(log, [
    JSON.stringify({ ts: 't', sessionKey: 'a', nodeId: 'n1', brain: 'personal-brain', used: true }),
    JSON.stringify({ ts: 't', sessionKey: 'a', nodeId: 'n2', brain: 'personal-brain', used: false }),
    JSON.stringify({ ts: 't', sessionKey: 'b', nodeId: 'n3', brain: 'agentsystem', used: true }),
    'garbage-line',
  ].join('\n') + '\n');
  const r = feedbackReport(log);
  assert.equal(r.total, 3);
  assert.equal(r.used, 2);
  assert.equal(r.byBrain['personal-brain'].injected, 2);
  assert.equal(r.byBrain['personal-brain'].used, 1);
  assert.equal(r.byBrain['agentsystem'].used, 1);
});

test('feedbackReport on missing log returns empty stats, never throws', () => {
  const r = feedbackReport(join(tmpdir(), 'nonexistent-feedback.jsonl'));
  assert.equal(r.total, 0);
  assert.equal(r.rate, null);
});
