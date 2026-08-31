import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isStale } from './memory-maintenance.js';

const DAY = 24 * 60 * 60 * 1000;

test('isStale: never run → stale', () => {
  assert.strictEqual(isStale(null, 7), true);
});

test('isStale: recent run → not stale', () => {
  const now = 1_000_000_000_000;
  assert.strictEqual(isStale(new Date(now - 2 * DAY).toISOString(), 7, now), false);
});

test('isStale: old run → stale', () => {
  const now = 1_000_000_000_000;
  assert.strictEqual(isStale(new Date(now - 10 * DAY).toISOString(), 7, now), true);
});

test('isStale: days<=0 always runs', () => {
  assert.strictEqual(isStale(new Date().toISOString(), 0), true);
});

test('isStale: malformed timestamp → stale', () => {
  assert.strictEqual(isStale('not-a-date', 7), true);
});

// Retrieval walks graph.json, so an un-indexed node file is invisible to every agent — and the
// later steps (dedup, decay, consolidate) only see indexed nodes too. reindex must stay first.
test('dry-run step list starts with reindex', () => {
  const out = execFileSync(process.execPath,
    [new URL('memory-maintenance.js', import.meta.url).pathname, '--dry-run'], { encoding: 'utf8' });
  const steps = out.split('would run steps:')[1].split(',').map((s) => s.trim());
  assert.strictEqual(steps[0], 'reindex');
  assert.ok(steps.includes('split'));
});
