import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aggregateUsage,
  priceUsage,
  buildPricingTable,
  computeSessionCost,
} from './session-cost-compute.js';

test('aggregateUsage sums tokens per model from assistant turns only', () => {
  const lines = [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({
      type: 'assistant', isSidechain: false,
      message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } },
    }),
    JSON.stringify({
      type: 'assistant', isSidechain: true, // subagent turn — still counted, real spend
      message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 20, output_tokens: 10 } },
    }),
  ].join('\n');

  const result = aggregateUsage(lines);
  assert.strictEqual(result['claude-sonnet-5'].input_tokens, 100);
  assert.strictEqual(result['claude-sonnet-5'].output_tokens, 50);
  assert.strictEqual(result['claude-haiku-4-5-20251001'].input_tokens, 20);
});

test('aggregateUsage skips malformed lines and lines with no usage', () => {
  const lines = [
    'not json',
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5' } }), // no usage
    JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-5', usage: { input_tokens: 5, output_tokens: 5 } },
    }),
  ].join('\n');

  const result = aggregateUsage(lines);
  assert.strictEqual(Object.keys(result).length, 1);
  assert.strictEqual(result['claude-sonnet-5'].input_tokens, 5);
});

test('aggregateUsage splits cache_creation into 5m/1h buckets', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 200,
        cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 300 },
      },
    },
  });
  const result = aggregateUsage(line);
  assert.strictEqual(result['claude-opus-4-8'].cache_5m, 1000);
  assert.strictEqual(result['claude-opus-4-8'].cache_1h, 300);
  assert.strictEqual(result['claude-opus-4-8'].cache_read, 200);
});

test('aggregateUsage falls back flat cache_creation_input_tokens into the 5m bucket', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-opus-4-8', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 500 } },
  });
  const result = aggregateUsage(line);
  assert.strictEqual(result['claude-opus-4-8'].cache_5m, 500);
  assert.strictEqual(result['claude-opus-4-8'].cache_1h, 0);
});

test('priceUsage computes cost correctly for a known model', () => {
  const byModel = { 'claude-haiku-4-5-20251001': { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_5m: 0, cache_1h: 0, cache_read: 0 } };
  const pricing = buildPricingTable(new Date('2026-01-01'));
  const result = priceUsage(byModel, pricing);
  assert.strictEqual(result.cost_usd, 6.00); // $1 input + $5 output at 1M tokens each
  assert.deepStrictEqual(result.unknown_models, []);
});

test('priceUsage flags unknown models instead of silently zeroing them', () => {
  const byModel = { 'claude-nonexistent-9': { input_tokens: 1000, output_tokens: 1000, cache_5m: 0, cache_1h: 0, cache_read: 0 } };
  const pricing = buildPricingTable();
  const result = priceUsage(byModel, pricing);
  assert.deepStrictEqual(result.unknown_models, ['claude-nonexistent-9']);
  assert.strictEqual(result.models['claude-nonexistent-9'].cost_usd, null);
  assert.strictEqual(result.cost_usd, 0);
});

test('buildPricingTable uses Sonnet 5 intro pricing before 2026-08-31', () => {
  const pricing = buildPricingTable(new Date('2026-07-01'));
  assert.strictEqual(pricing['claude-sonnet-5'].input, 2.00);
  assert.strictEqual(pricing['claude-sonnet-5'].output, 10.00);
});

test('buildPricingTable switches Sonnet 5 to standard pricing after 2026-08-31', () => {
  const pricing = buildPricingTable(new Date('2026-09-01'));
  assert.strictEqual(pricing['claude-sonnet-5'].input, 3.00);
  assert.strictEqual(pricing['claude-sonnet-5'].output, 15.00);
});

test('computeSessionCost returns ok:false for a missing transcript', () => {
  const result = computeSessionCost('/nonexistent/path.jsonl');
  assert.strictEqual(result.ok, false);
});

// #519: claude-opus-5 is the id sync-agents.js actually dispatches (tools/sync-agents.js:44,
// MODELS.claude) — the old table only had the never-dispatched claude-opus-4-8, so the
// dominant, most expensive tier was priced at $0 with no error.
test('#519: buildPricingTable prices claude-opus-5 at $5/$25 per 1M', () => {
  const pricing = buildPricingTable(new Date('2026-01-01'));
  assert.strictEqual(pricing['claude-opus-5'].input, 5.00);
  assert.strictEqual(pricing['claude-opus-5'].output, 25.00);
  assert.strictEqual(pricing['claude-opus-5'].cacheWrite5m, 6.25);
  assert.strictEqual(pricing['claude-opus-5'].cacheWrite1h, 10.00);
  assert.strictEqual(pricing['claude-opus-5'].cacheRead, 0.50);
});

test('#519: buildPricingTable prices fable at $10/$50 per 1M', () => {
  const pricing = buildPricingTable(new Date('2026-01-01'));
  assert.strictEqual(pricing['fable'].input, 10.00);
  assert.strictEqual(pricing['fable'].output, 50.00);
  assert.strictEqual(pricing['claude-fable-5'].input, 10.00);
});

test('#519: bare aliases opus/sonnet/haiku resolve to their concrete tier prices', () => {
  const pricing = buildPricingTable(new Date('2026-01-01'));
  assert.deepStrictEqual(pricing['opus'], pricing['claude-opus-5']);
  assert.deepStrictEqual(pricing['haiku'], pricing['claude-haiku-4-5-20251001']);
  assert.deepStrictEqual(pricing['sonnet'], pricing['claude-sonnet-5']);
});

test('#519: bare "sonnet" alias tracks the date-dependent intro pricing, not a frozen copy', () => {
  const before = buildPricingTable(new Date('2026-07-01'));
  const after = buildPricingTable(new Date('2026-09-01'));
  assert.strictEqual(before['sonnet'].input, 2.00); // intro rate
  assert.strictEqual(after['sonnet'].input, 3.00);  // standard rate post-rollover
});

test('#519: priceUsage prices opus-5 usage correctly end-to-end', () => {
  const byModel = { 'claude-opus-5': { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_5m: 0, cache_1h: 0, cache_read: 0 } };
  const pricing = buildPricingTable(new Date('2026-01-01'));
  const result = priceUsage(byModel, pricing);
  assert.strictEqual(result.cost_usd, 30.00); // $5 input + $25 output at 1M each
  assert.deepStrictEqual(result.unknown_models, []);
});

test('#519: <synthetic> prices at $0 and is NOT reported as an unknown model', () => {
  const byModel = { '<synthetic>': { input_tokens: 0, output_tokens: 0, cache_5m: 0, cache_1h: 0, cache_read: 0 } };
  const pricing = buildPricingTable();
  const result = priceUsage(byModel, pricing);
  assert.strictEqual(result.models['<synthetic>'].cost_usd, 0);
  assert.deepStrictEqual(result.unknown_models, []);
});

test('#519: a genuinely unknown model alongside <synthetic> is still flagged (not buried)', () => {
  const byModel = {
    '<synthetic>': { input_tokens: 0, output_tokens: 0, cache_5m: 0, cache_1h: 0, cache_read: 0 },
    'claude-nonexistent-9': { input_tokens: 100, output_tokens: 200_000, cache_5m: 0, cache_1h: 0, cache_read: 0 },
  };
  const pricing = buildPricingTable();
  const result = priceUsage(byModel, pricing);
  assert.deepStrictEqual(result.unknown_models, ['claude-nonexistent-9']);
  assert.strictEqual(result.models['claude-nonexistent-9'].cost_usd, null);
  assert.strictEqual(result.models['claude-nonexistent-9'].output_tokens, 200_000);
});

test('computeSessionCost reads a real transcript file end-to-end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scc-test-'));
  const file = join(dir, 'transcript.jsonl');
  writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 1_000_000, output_tokens: 0 } },
    }),
  ].join('\n'));

  const result = computeSessionCost(file, { now: new Date('2026-01-01') });
  rmSync(dir, { recursive: true, force: true });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.cost_usd, 1.00);
  assert.strictEqual(result.in_tok, 1_000_000);
});
