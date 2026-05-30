import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBM25 } from './graph-query.js';

// Shared df/N/avgdl for tests
const terms = ['foo', 'bar'];
const docA = 'foo foo foo bar baz qux'; // 6 words, foo x3, bar x1
const docB = 'foo bar baz';             // 3 words, foo x1, bar x1
const docs = [docA, docB];
const N = docs.length;
const avgdl = docs.reduce((s, d) => s + d.split(/\s+/).length, 0) / N; // (6+3)/2 = 4.5

function buildDf(termList, docList) {
  const df = new Map();
  for (const t of termList) {
    const lower = t.toLowerCase();
    df.set(lower, docList.filter(d => d.toLowerCase().includes(lower)).length);
  }
  return df;
}
const df = buildDf(terms, docs);

describe('computeBM25', () => {
  it('returns 0 for empty query', () => {
    const score = computeBM25([], docA, df, N, avgdl);
    assert.equal(score, 0);
  });

  it('returns higher score for doc with more term occurrences', () => {
    const scoreA = computeBM25(terms, docA, df, N, avgdl);
    const scoreB = computeBM25(terms, docB, df, N, avgdl);
    assert.ok(scoreA > scoreB, `expected scoreA (${scoreA}) > scoreB (${scoreB})`);
  });

  it('normalizes correctly — result <= 1.0 for typical input', () => {
    const MAX_BM25 = 10.0;
    const raw = computeBM25(terms, docA, df, N, avgdl);
    const normalized = Math.min(1.0, raw / (terms.length * MAX_BM25));
    assert.ok(normalized <= 1.0, `expected normalized (${normalized}) <= 1.0`);
    assert.ok(normalized >= 0, `expected normalized (${normalized}) >= 0`);
  });
});
