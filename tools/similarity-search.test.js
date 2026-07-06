import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTokens,
  jaccardSimilarity,
  hasConflictingPolarity,
  findHighOverlapCandidates,
  markSuperseded,
} from './similarity-search.js';

test('extractTokens removes punctuation and lowercases', () => {
  const tokens = extractTokens('User PREFERS npm!');
  assert.deepEqual(tokens, ['user', 'prefers', 'npm']);
});

test('extractTokens handles empty input', () => {
  assert.deepEqual(extractTokens(''), []);
  assert.deepEqual(extractTokens('   '), []);
});

test('jaccardSimilarity computes intersection over union', () => {
  const sim = jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd']);
  // intersection: {b, c} = 2
  // union: {a, b, c, d} = 4
  // sim = 2/4 = 0.5
  assert.strictEqual(sim, 0.5);
});

test('jaccardSimilarity returns 0 for empty inputs', () => {
  assert.strictEqual(jaccardSimilarity([], []), 0);
  assert.strictEqual(jaccardSimilarity(['a'], []), 0);
  assert.strictEqual(jaccardSimilarity([], ['b']), 0);
});

test('jaccardSimilarity returns 1 for identical tokens', () => {
  assert.strictEqual(jaccardSimilarity(['a', 'b'], ['a', 'b']), 1);
});

test('hasConflictingPolarity detects "prefers X" vs "prefers Y"', () => {
  const fact1 = 'user prefers npm';
  const fact2 = 'user prefers pnpm';
  assert.strictEqual(hasConflictingPolarity(fact1, fact2), true);
});

test('hasConflictingPolarity detects "uses X" vs "uses Y"', () => {
  const fact1 = 'i use vim for editing';
  const fact2 = 'i use emacs for editing';
  assert.strictEqual(hasConflictingPolarity(fact1, fact2), true);
});

test('hasConflictingPolarity returns false for completely different facts', () => {
  const fact1 = 'user prefers npm';
  const fact2 = 'i like dark mode';
  assert.strictEqual(hasConflictingPolarity(fact1, fact2), false);
});

test('hasConflictingPolarity returns false for similar/compatible facts', () => {
  const fact1 = 'user prefers npm package manager';
  const fact2 = 'npm is fast to install';
  assert.strictEqual(hasConflictingPolarity(fact1, fact2), false);
});

test('findHighOverlapCandidates filters by similarity threshold', () => {
  const newFact = 'user prefers npm';
  const nodes = [
    { id: 'node-1', content: '---\nid: node-1\n---\n\nuser prefers pnpm', frontmatter: {} },
    { id: 'node-2', content: '---\nid: node-2\n---\n\ncompletely unrelated text', frontmatter: {} },
    { id: 'node-3', content: '---\nid: node-3\n---\n\nuser likes dark mode', frontmatter: {} },
  ];
  const candidates = findHighOverlapCandidates(newFact, nodes, { similarityThreshold: 0.4 });
  assert.ok(candidates.length > 0, 'should find node-1 as high overlap');
  assert.strictEqual(candidates[0].nodeId, 'node-1');
  assert.ok(candidates[0].similarity > 0.4);
});

test('findHighOverlapCandidates skips already-superseded nodes', () => {
  const newFact = 'user prefers npm';
  const nodes = [
    {
      id: 'old-node',
      content: '---\nid: old-node\nsuperseded_by: newer-node\n---\n\nuser prefers pnpm',
      frontmatter: { superseded_by: 'newer-node' },
    },
    { id: 'other', content: '---\nid: other\n---\n\nunrelated', frontmatter: {} },
  ];
  const candidates = findHighOverlapCandidates(newFact, nodes, { similarityThreshold: 0.4 });
  assert.strictEqual(candidates.length, 0, 'should skip superseded nodes');
});

test('findHighOverlapCandidates returns top N candidates sorted by similarity', () => {
  const newFact = 'user prefers npm';
  const nodes = [
    { id: 'node-1', content: '---\nid: node-1\n---\n\nuser prefers pnpm', frontmatter: {} },
    { id: 'node-2', content: '---\nid: node-2\n---\n\nuser prefers yarn', frontmatter: {} },
    { id: 'node-3', content: '---\nid: node-3\n---\n\nuser prefers python', frontmatter: {} },
  ];
  const candidates = findHighOverlapCandidates(newFact, nodes, { top: 2, similarityThreshold: 0.3 });
  assert.strictEqual(candidates.length, 2, 'should return top 2');
  assert.ok(candidates[0].similarity >= candidates[1].similarity, 'should be sorted by similarity desc');
});

test('markSuperseded adds superseded_by and superseded_date to frontmatter', () => {
  const original = '---\nid: old-node\ntype: manual-fact\n---\n\nuser prefers npm';
  const marked = markSuperseded(original, 'new-node', '2026-07-05');
  assert.match(marked, /superseded_by: new-node/);
  assert.match(marked, /superseded_date: 2026-07-05/);
  assert.match(marked, /user prefers npm/); // body preserved
});

test('markSuperseded preserves existing frontmatter fields', () => {
  const original = '---\nid: old-node\ntype: manual-fact\nsalience: 0.5\n---\n\noriginal body';
  const marked = markSuperseded(original, 'new-node');
  assert.match(marked, /id: old-node/);
  assert.match(marked, /type: manual-fact/);
  assert.match(marked, /salience: 0.5/);
  assert.match(marked, /superseded_by: new-node/);
});
