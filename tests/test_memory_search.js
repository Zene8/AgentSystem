/**
 * tests/test_memory_search.js
 * node --test tests/test_memory_search.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntries, tokenize, buildTfVector, cosineSimilarity, tfidfEmbedding } from '../tools/memory-search.js';

// ---------------------------------------------------------------------------
// Tests: cosine similarity
// ---------------------------------------------------------------------------

describe('cosine similarity', () => {
  it('identical vectors → score 1.0', () => {
    const v = tfidfEmbedding('auth bug login session');
    assert.strictEqual(cosineSimilarity(v, v), 1.0);
  });

  it('orthogonal vectors → score 0.0', () => {
    const a = buildTfVector(['cat']);
    const b = buildTfVector(['dog']);
    assert.strictEqual(cosineSimilarity(a, b), 0);
  });

  it('partially overlapping → 0 < score < 1', () => {
    const a = tfidfEmbedding('auth bug login');
    const b = tfidfEmbedding('auth fix session');
    const score = cosineSimilarity(a, b);
    assert.ok(score > 0 && score < 1, `score ${score} not in (0,1)`);
  });

  it('empty vectors → score 0', () => {
    const a = buildTfVector([]);
    const b = tfidfEmbedding('something');
    assert.strictEqual(cosineSimilarity(a, b), 0);
  });

  it('two empty vectors → score 0', () => {
    assert.strictEqual(cosineSimilarity({}, {}), 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: entry parsing
// ---------------------------------------------------------------------------

describe('entry parsing', () => {
  const sampleMd = `
# SONA Patterns

Preamble text.

### auth-fix — 2026-05-30 — Friday
**S:** auth middleware bug
**O:** missing null check on token
**A:** added guard clause | success: yes

### db-migration — 2026-05-20 — Pym
**S:** schema migration postgres
**O:** column rename required two-step
**A:** added backward compat column | success: yes
`;

  it('parses two entries', () => {
    const entries = parseEntries(sampleMd);
    assert.strictEqual(entries.length, 2);
  });

  it('parses id, date, agent from header', () => {
    const entries = parseEntries(sampleMd);
    assert.strictEqual(entries[0].id, 'auth-fix');
    assert.strictEqual(entries[0].date, '2026-05-30');
    assert.strictEqual(entries[0].agent, 'Friday');
  });

  it('includes body in text field', () => {
    const entries = parseEntries(sampleMd);
    assert.ok(entries[0].text.includes('null check'));
  });

  it('empty markdown returns empty array', () => {
    assert.strictEqual(parseEntries('').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: top-N ordering
// ---------------------------------------------------------------------------

describe('top-N ordering', () => {
  it('returns results sorted by score descending', () => {
    const entries = [
      { id: 'a', text: 'completely unrelated content about databases', date: '', agent: '' },
      { id: 'b', text: 'auth login session token bug fix', date: '', agent: '' },
      { id: 'c', text: 'auth middleware token validation', date: '', agent: '' },
    ];
    const query = 'auth token session';
    const qVec = tfidfEmbedding(query);
    const results = entries
      .map(e => ({ ...e, score: cosineSimilarity(qVec, tfidfEmbedding(e.text)) }))
      .sort((a, b) => b.score - a.score);

    assert.ok(results[0].score >= results[1].score);
    assert.ok(results[1].score >= results[2].score);
    assert.strictEqual(results[results.length - 1].id, 'a');
  });
});
