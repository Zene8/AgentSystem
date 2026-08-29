import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideTier,
  summarizeSpend,
  monthStart,
  resolveThreshold,
  DEFAULT_THRESHOLD_USD,
} from './model-tier-guard.js';

test('decideTier: under threshold allows opus through unchanged', () => {
  const result = decideTier({ model: 'claude-opus-5', spendUsd: 10, hasUnpriced: false, threshold: 150 });
  assert.equal(result.decision, 'allow');
  assert.equal(result.model, 'claude-opus-5');
});

test('decideTier: under threshold allows fable through unchanged', () => {
  const result = decideTier({ model: 'fable', spendUsd: 10, hasUnpriced: false, threshold: 150 });
  assert.equal(result.decision, 'allow');
  assert.equal(result.model, 'fable');
});

test('decideTier: over threshold downgrades opus to sonnet', () => {
  const result = decideTier({ model: 'claude-opus-5', spendUsd: 200, hasUnpriced: false, threshold: 150 });
  assert.equal(result.decision, 'downgrade');
  assert.equal(result.model, 'sonnet');
  assert.equal(result.requestedModel, 'claude-opus-5');
});

test('decideTier: over threshold downgrades fable to sonnet', () => {
  const result = decideTier({ model: 'fable', spendUsd: 151, hasUnpriced: false, threshold: 150 });
  assert.equal(result.decision, 'downgrade');
  assert.equal(result.model, 'sonnet');
  assert.equal(result.requestedModel, 'fable');
});

test('decideTier: over threshold does NOT touch sonnet or haiku (not guarded tiers)', () => {
  const sonnetResult = decideTier({ model: 'claude-sonnet-5', spendUsd: 999, hasUnpriced: false, threshold: 150 });
  const haikuResult = decideTier({ model: 'haiku', spendUsd: 999, hasUnpriced: false, threshold: 150 });
  assert.equal(sonnetResult.decision, 'allow');
  assert.equal(haikuResult.decision, 'allow');
});

test('decideTier: bypass overrides everything and is reported', () => {
  const result = decideTier({ model: 'claude-opus-5', spendUsd: 999, hasUnpriced: true, threshold: 150, bypass: true });
  assert.equal(result.decision, 'allow');
  assert.equal(result.model, 'claude-opus-5');
  assert.equal(result.bypassed, true);
});

// #519 one layer up: unpriced spend must never read as "$0, safe to allow" and silently
// permit a guarded tier through. It must refuse rather than green-light unverifiable spend.
test('decideTier: unpriced model in month-to-date spend refuses opus rather than silently allowing', () => {
  const result = decideTier({ model: 'claude-opus-5', spendUsd: 0, hasUnpriced: true, threshold: 150 });
  assert.equal(result.decision, 'refuse');
  assert.equal(result.bypassed, false);
});

test('decideTier: unpriced spend refuses fable too', () => {
  const result = decideTier({ model: 'fable', spendUsd: 0, hasUnpriced: true, threshold: 150 });
  assert.equal(result.decision, 'refuse');
});

test('decideTier: unpriced spend does not block cheap tiers (sonnet/haiku unaffected)', () => {
  const sonnetResult = decideTier({ model: 'sonnet', spendUsd: 0, hasUnpriced: true, threshold: 150 });
  assert.equal(sonnetResult.decision, 'allow');
});

test('decideTier: bypass still overrides an unpriced-spend refusal, and reports the bypass', () => {
  const result = decideTier({ model: 'claude-opus-5', spendUsd: 0, hasUnpriced: true, threshold: 150, bypass: true });
  assert.equal(result.decision, 'allow');
  assert.equal(result.bypassed, true);
});

test('DEFAULT_THRESHOLD_USD is named once and is 150 (Friday default, not user-supplied)', () => {
  assert.equal(DEFAULT_THRESHOLD_USD, 150);
});

test('resolveThreshold: --threshold flag wins over env and default', () => {
  const v = resolveThreshold(['--threshold=42'], { MODEL_TIER_GUARD_THRESHOLD_USD: '99' });
  assert.equal(v, 42);
});

test('resolveThreshold: env var wins over default when no flag given', () => {
  const v = resolveThreshold([], { MODEL_TIER_GUARD_THRESHOLD_USD: '99' });
  assert.equal(v, 99);
});

test('resolveThreshold: falls back to DEFAULT_THRESHOLD_USD with no flag or env', () => {
  const v = resolveThreshold([], {});
  assert.equal(v, DEFAULT_THRESHOLD_USD);
});

test('resolveThreshold: ignores a malformed --threshold value and falls through', () => {
  const v = resolveThreshold(['--threshold=notanumber'], {});
  assert.equal(v, DEFAULT_THRESHOLD_USD);
});

test('monthStart: returns the 1st of the given date\'s local month', () => {
  const d = monthStart(new Date(2026, 7, 24)); // Aug 24 2026 local
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 1);
});

// Timestamps use local-time (no 'Z') mid-month/mid-prior-month values, not month-boundary UTC
// instants, so the test is not flaky across host timezones (a UTC boundary timestamp can fall
// on either side of a *local* calendar-month cutoff depending on the runner's TZ).
test('summarizeSpend: sums cost_usd for rows within the current month only', () => {
  const now = new Date(2026, 7, 24); // Aug 24 2026 local
  const rows = [
    { session: 's1', ts: '2026-08-10T12:00:00', cost_usd: 10, in_tok: 1, out_tok: 1 },
    { session: 's2', ts: '2026-08-20T12:00:00', cost_usd: 5, in_tok: 1, out_tok: 1 },
    { session: 's3', ts: '2026-07-15T12:00:00', cost_usd: 999, in_tok: 1, out_tok: 1 }, // out of month
  ];
  const result = summarizeSpend(rows, now);
  assert.equal(result.spendUsd, 15);
  assert.equal(result.sessionCount, 2);
});

test('summarizeSpend: hasUnpriced true when any in-month row carries an unpriced model', () => {
  const now = new Date(2026, 7, 24);
  const rows = [
    { session: 's1', ts: '2026-08-10T12:00:00', cost_usd: 1, unpriced: [{ model: 'claude-unknown-9', out_tok: 500 }] },
  ];
  const result = summarizeSpend(rows, now);
  assert.equal(result.hasUnpriced, true);
  assert.deepStrictEqual(result.unpriced, { 'claude-unknown-9': 500 });
});

test('summarizeSpend: hasUnpriced false and spend correct when no unpriced rows in month', () => {
  const now = new Date(2026, 7, 24);
  const rows = [
    { session: 's1', ts: '2026-08-10T12:00:00', cost_usd: 3 },
  ];
  const result = summarizeSpend(rows, now);
  assert.equal(result.hasUnpriced, false);
  assert.equal(result.spendUsd, 3);
});
