import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldVisits } from './memory-reconsolidate.js';
import { emptyGraph, addNode, addEdge } from './graph/graph-lib.js';

test('foldVisits bumps visit_count on edges incident to accessed nodes', () => {
  let g = emptyGraph('t', 't');
  g = addNode(g, 'a'); g = addNode(g, 'b'); g = addNode(g, 'c');
  g = addEdge(g, 'a', 'b');
  g = addEdge(g, 'b', 'c');
  const before = g.edges.map(e => e.weights._visit_raw || 0);
  assert.deepStrictEqual(before, [0, 0]);

  const out = foldVisits(g, ['a']);
  const ab = out.edges.find(e => e.source === 'a' && e.target === 'b');
  const bc = out.edges.find(e => e.source === 'b' && e.target === 'c');
  assert.ok(ab.weights._visit_raw >= 1, 'edge incident to accessed node a is bumped');
  assert.strictEqual(bc.weights._visit_raw || 0, 0, 'unrelated edge untouched');
  assert.ok(ab.weights.last_visited, 'last_visited set');
});
