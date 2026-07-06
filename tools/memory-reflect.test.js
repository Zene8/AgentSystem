import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildReflectionPrompt, parseInsights, selectTopFacts } from './memory-reflect.js';

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

// #144/#155: reflection must not draw insights from facts the user has since corrected.
test('selectTopFacts skips superseded nodes', () => {
  const dir = mkdtempBrain();
  try {
    writeGraphAndNode(dir, 'fact-old', 0.9, { superseded_by: 'fact-new' }, 'old superseded fact');
    writeGraphAndNode(dir, 'fact-new', 0.9, {}, 'new current fact');
    writeGraphAndNode(dir, 'fact-insight', 0.9, { type: 'insight' }, 'an insight, not a fact');

    const facts = selectTopFacts(dir, 10);
    assert.ok(facts.includes('new current fact'));
    assert.ok(!facts.includes('old superseded fact'), 'superseded fact must be excluded');
    assert.ok(!facts.includes('an insight, not a fact'), 'insight-type nodes must be excluded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mkdtempBrain() {
  const dir = mkdtempSync(join(tmpdir(), 'memory-reflect-test-'));
  mkdirSync(join(dir, 'nodes'), { recursive: true });
  writeFileSync(join(dir, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }), 'utf8');
  return dir;
}

function writeGraphAndNode(dir, id, importance, extraFrontmatter, bodyText) {
  const graphPath = join(dir, 'graph.json');
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  graph.nodes.push(id);
  writeFileSync(graphPath, JSON.stringify(graph), 'utf8');

  const fmLines = Object.entries(extraFrontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
  const content = `---\nid: ${id}\nimportance: ${importance}\n${fmLines}\n---\n\n- ${bodyText}\n`;
  writeFileSync(join(dir, 'nodes', `${id}.md`), content, 'utf8');
}
