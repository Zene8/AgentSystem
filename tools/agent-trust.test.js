import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustScores, trustFor, composeHintWithTrust, TRUST_THRESHOLD } from './agent-trust.js';

// --- Fixture: format B (on-disk format from ~/agent-memory/nexus/trust-scores.md) ---

const FIXTURE_MD = `---
name: trust-scores
metadata:
  type: reference
---

# Agent Trust Scores

Formula: \`Trust = 0.4×success_rate + ...\`

| Agent | Score | Tasks | Last Updated | Notes |
|-------|-------|-------|--------------|-------|
| Friday | 0.82 | 12 | 2026-05-23 | Strong arch |
| Jarvis | 0.85 | 8 | 2026-05-23 | Good orchestration |
| Sam | 0.90 | 6 | 2026-05-23 | Zero security bypasses |
| r2d2 | 0.72 | 0 | — | Fallback only |
| Fragile | 0.45 | 3 | 2026-05-20 | Needs support |
`;

// Fixture with percentage format (as compute-trust-scores.js would emit)
const FIXTURE_PCT = `| Agent | Total Runs | Successes | Failures | Unknown | Success Rate |
|-------|-----------|-----------|---------|---------|-------------|
| friday | 12 | 10 | 2 | 0 | 83% |
| ultron | 4 | 2 | 2 | 0 | 50% |
`;

// --- parseTrustScores ---

test('parseTrustScores: parses format-B float scores', () => {
  const scores = parseTrustScores(FIXTURE_MD);
  assert.strictEqual(scores['friday'], 0.82);
  assert.strictEqual(scores['jarvis'], 0.85);
  assert.strictEqual(scores['sam'], 0.90);
  assert.strictEqual(scores['r2d2'], 0.72);
  assert.strictEqual(scores['fragile'], 0.45);
});

test('parseTrustScores: keys are lowercase', () => {
  const scores = parseTrustScores(FIXTURE_MD);
  assert.ok(!('Friday' in scores), 'capitalized key should not exist');
  assert.ok('friday' in scores);
});

test('parseTrustScores: parses percentage format (format A fallback)', () => {
  const scores = parseTrustScores(FIXTURE_PCT);
  assert.ok(Math.abs(scores['friday'] - 0.83) < 0.001);
  assert.ok(Math.abs(scores['ultron'] - 0.50) < 0.001);
});

test('parseTrustScores: returns empty object for empty input', () => {
  assert.deepStrictEqual(parseTrustScores(''), {});
  assert.deepStrictEqual(parseTrustScores(null), {});
  assert.deepStrictEqual(parseTrustScores(undefined), {});
});

test('parseTrustScores: returns empty object for markdown with no table', () => {
  assert.deepStrictEqual(parseTrustScores('# Just a heading\nsome text'), {});
});

test('parseTrustScores: ignores separator rows', () => {
  const scores = parseTrustScores(FIXTURE_MD);
  // separator "|---|---|" should not appear as a key
  const keys = Object.keys(scores);
  assert.ok(!keys.some(k => k.startsWith('-')));
});

// --- trustFor ---

test('trustFor: returns score for known agent', () => {
  const scores = parseTrustScores(FIXTURE_MD);
  assert.strictEqual(trustFor('Friday', scores), 0.82);
  assert.strictEqual(trustFor('friday', scores), 0.82);
  assert.strictEqual(trustFor('FRIDAY', scores), 0.82);
});

test('trustFor: returns null for unknown agent', () => {
  const scores = parseTrustScores(FIXTURE_MD);
  assert.strictEqual(trustFor('ultron', scores), null);
});

test('trustFor: returns null for null inputs', () => {
  assert.strictEqual(trustFor(null, {}), null);
  assert.strictEqual(trustFor('friday', null), null);
});

// --- composeHintWithTrust ---

const BASE_HINT = 'ROUTING HINT: domain signal → Leo (DevOps). Route there unless cross-domain.';
const SCORES_WITH_LEO = { leo: 0.78, fragile: 0.45 };

test('composeHintWithTrust: appends trust percentage for known agent', () => {
  const result = composeHintWithTrust(BASE_HINT, 'Leo (DevOps)', SCORES_WITH_LEO);
  assert.match(result, /\[trust: 78%\]/);
});

test('composeHintWithTrust: no warning when trust >= threshold', () => {
  const result = composeHintWithTrust(BASE_HINT, 'Leo (DevOps)', SCORES_WITH_LEO);
  assert.ok(!result.includes('consider review'));
});

test('composeHintWithTrust: appends warning when trust < threshold', () => {
  const hint = 'ROUTING HINT: domain signal → Fragile (ops). Route there.';
  const result = composeHintWithTrust(hint, 'Fragile (ops)', SCORES_WITH_LEO);
  assert.match(result, /\[trust: 45%/);
  assert.match(result, /consider review or pair/);
});

test('composeHintWithTrust: passes through hint unchanged for unknown agent', () => {
  const result = composeHintWithTrust(BASE_HINT, 'Ultron (backend)', SCORES_WITH_LEO);
  assert.strictEqual(result, BASE_HINT);
});

test('composeHintWithTrust: passes through empty/null hint unchanged', () => {
  assert.strictEqual(composeHintWithTrust('', 'Leo (DevOps)', SCORES_WITH_LEO), '');
  assert.strictEqual(composeHintWithTrust(null, 'Leo (DevOps)', SCORES_WITH_LEO), null);
});

test('TRUST_THRESHOLD is 0.6', () => {
  assert.strictEqual(TRUST_THRESHOLD, 0.6);
});

test('composeHintWithTrust: score exactly at threshold is NOT warned', () => {
  const scores = { testbot: 0.6 };
  const hint = 'ROUTING HINT: domain signal → Testbot (test).';
  const result = composeHintWithTrust(hint, 'Testbot (test)', scores);
  assert.ok(!result.includes('consider review'));
  assert.match(result, /\[trust: 60%\]/);
});
