/**
 * tests/memory-injection-diet.test.js
 * Regression tests for #170: memory injection diet.
 * 1. Trivial-prompt bail (short prompts / ack phrases skip retrieval entirely).
 * 2. Session dedup of injected node ids (never inject the same pattern twice per session).
 * 3. BM25 score floor + top-4 -> top-2.
 *
 * node --test tests/memory-injection-diet.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  isTrivialPrompt, dedupPath, loadInjectedIds, saveInjectedIds,
  SCORE_FLOOR, RETRIEVAL_TOP, MIN_PROMPT_LEN,
} = require(join(__dirname, '..', 'hooks', 'memory-router.js'));

test('isTrivialPrompt: prompts shorter than the minimum length are trivial', () => {
  assert.strictEqual(isTrivialPrompt('ok'), true);
  assert.strictEqual(isTrivialPrompt('short'), true);
  assert.strictEqual('short'.length < MIN_PROMPT_LEN, true);
});

test('isTrivialPrompt: ack phrases are trivial regardless of length', () => {
  for (const p of ['ok', 'yes', 'no', 'sure', 'continue', 'merge it', 'go', 'do it', 'thanks', 'thank you']) {
    assert.strictEqual(isTrivialPrompt(p), true, `expected "${p}" to be trivial`);
  }
  // case-insensitive
  assert.strictEqual(isTrivialPrompt('Continue please with the rest of the migration'), true);
});

test('isTrivialPrompt: substantive prompts are not trivial', () => {
  assert.strictEqual(isTrivialPrompt('please refactor the auth middleware to support refresh tokens'), false);
  assert.strictEqual(isTrivialPrompt('investigate why the deploy pipeline is failing on staging'), false);
});

test('isTrivialPrompt: empty/undefined prompt is trivial (fails length check safely)', () => {
  assert.strictEqual(isTrivialPrompt(''), true);
  assert.strictEqual(isTrivialPrompt(undefined), true);
});

test('dedupPath: stable per transcript_path, distinct across sessions', () => {
  const a = dedupPath({ transcript_path: '/tmp/session-a.jsonl' });
  const b = dedupPath({ transcript_path: '/tmp/session-a.jsonl' });
  const c = dedupPath({ transcript_path: '/tmp/session-b.jsonl' });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test('loadInjectedIds/saveInjectedIds: round-trips a set of ids through a temp file', () => {
  const file = join(tmpdir(), `test-dedup-${Date.now()}-${Math.random()}.json`);
  try {
    assert.deepStrictEqual([...loadInjectedIds(file)], []); // missing file -> empty set
    saveInjectedIds(file, new Set(['node-a', 'node-b']));
    const loaded = loadInjectedIds(file);
    assert.strictEqual(loaded.has('node-a'), true);
    assert.strictEqual(loaded.has('node-b'), true);
    assert.strictEqual(loaded.has('node-c'), false);
  } finally {
    rmSync(file, { force: true });
  }
});

test('loadInjectedIds: corrupt file degrades to empty set rather than throwing', () => {
  const file = join(tmpdir(), `test-dedup-corrupt-${Date.now()}-${Math.random()}.json`);
  try {
    writeFileSync(file, 'not json{{{');
    assert.deepStrictEqual([...loadInjectedIds(file)], []);
  } finally {
    rmSync(file, { force: true });
  }
});

test('RETRIEVAL_TOP is 2 (top-4 -> top-2 diet)', () => {
  assert.strictEqual(RETRIEVAL_TOP, 2);
});

test('SCORE_FLOOR is a sensible positive threshold on the 0-1ish BM25 composite scale', () => {
  assert.ok(SCORE_FLOOR > 0);
  assert.ok(SCORE_FLOOR < 1);
});
