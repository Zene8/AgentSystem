import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReflectionPrompt, parseInsights } from './memory-reflect.js';

test('buildReflectionPrompt includes facts and asks for insights', () => {
  const p = buildReflectionPrompt(['solo founder', 'uses node']);
  assert.match(p, /- solo founder/);
  assert.match(p, /- uses node/);
  assert.match(p, /INSIGHTS/);
});

test('parseInsights extracts bullet lines only', () => {
  const out = parseInsights('Here are insights:\n- prefers automation\n* values speed\nnot a bullet\n- \n');
  assert.deepStrictEqual(out, ['prefers automation', 'values speed']);
});
