import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import {
  emptyGraph,
  addNode,
  addEdge,
  updateVisitCount,
  updateConfidence,
  recomputeComposite,
  pruneOrphanedEdges,
  readGraph,
  writeGraph,
  parseFrontmatter,
  serializeFrontmatter,
} from '../tools/graph/graph-lib.js';

function tmpDir() {
  const d = join(tmpdir(), `graph-test-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

test('emptyGraph returns valid structure', () => {
  const g = emptyGraph('agent', 'test-project');
  assert.equal(g.version, '1.0');
  assert.equal(g.brain, 'agent');
  assert.equal(g.project_slug, 'test-project');
  assert.deepEqual(g.nodes, []);
  assert.deepEqual(g.edges, []);
});

test('addNode adds node id if not present', () => {
  const g = emptyGraph('agent', 'test');
  const g2 = addNode(g, 'pattern-auth');
  assert.deepEqual(g2.nodes, ['pattern-auth']);
  const g3 = addNode(g2, 'pattern-auth');
  assert.deepEqual(g3.nodes, ['pattern-auth']);
});

test('addEdge adds edge with zero weights if not present', () => {
  const g = emptyGraph('agent', 'test');
  const g2 = addEdge(addNode(addNode(g, 'a'), 'b'), 'a', 'b');
  assert.equal(g2.edges.length, 1);
  assert.equal(g2.edges[0].source, 'a');
  assert.equal(g2.edges[0].target, 'b');
  assert.equal(g2.edges[0].weights.co_change, 0.0);
  assert.equal(g2.edges[0].weights.confidence, 0.0);
  const g3 = addEdge(g2, 'a', 'b');
  assert.equal(g3.edges.length, 1);
});

test('updateVisitCount increments raw and renormalizes', () => {
  let g = emptyGraph('agent', 'test');
  g = addNode(addNode(g, 'a'), 'b');
  g = addEdge(addEdge(g, 'a', 'b'), 'b', 'a');
  g.edges[0].weights._visit_raw = 5;
  g.edges[1].weights._visit_raw = 5;
  g = updateVisitCount(g, 'a', 'b');
  const edge = g.edges.find(e => e.source === 'a' && e.target === 'b');
  assert.equal(edge.weights._visit_raw, 6);
  assert.equal(edge.weights.visit_count, 1.0);
});

test('updateConfidence clamps to [0,1]', () => {
  let g = emptyGraph('agent', 'test');
  g = addNode(addNode(g, 'a'), 'b');
  g = addEdge(g, 'a', 'b');
  g.edges[0].weights.confidence = 0.9;
  g = updateConfidence(g, 'a', 'b', 0.2);
  assert.equal(g.edges[0].weights.confidence, 1.0);
  g.edges[0].weights.confidence = 0.1;
  g = updateConfidence(g, 'a', 'b', -0.15);
  assert.equal(g.edges[0].weights.confidence, 0.0);
});

test('recomputeComposite uses correct formula', () => {
  const weights = { co_change: 1.0, semantic: 1.0, visit_count: 1.0, confidence: 1.0 };
  const composite = recomputeComposite(weights);
  assert.equal(composite, 1.0);
  const half = { co_change: 0.5, semantic: 0.5, visit_count: 0.5, confidence: 0.5 };
  assert.equal(recomputeComposite(half), 0.5);
});

test('pruneOrphanedEdges removes edges where source or target missing from nodes', () => {
  let g = emptyGraph('agent', 'test');
  g.nodes = ['a', 'b'];
  g.edges = [
    { source: 'a', target: 'b', weights: {}, composite: 0 },
    { source: 'a', target: 'ghost', weights: {}, composite: 0 },
    { source: 'ghost2', target: 'b', weights: {}, composite: 0 },
  ];
  const pruned = pruneOrphanedEdges(g);
  assert.equal(pruned.edges.length, 1);
  assert.equal(pruned.edges[0].source, 'a');
  assert.equal(pruned.edges[0].target, 'b');
});

test('readGraph / writeGraph round-trip', () => {
  const dir = tmpDir();
  const graphPath = join(dir, 'graph.json');
  const g = emptyGraph('repo', 'roundtrip-test');
  writeGraph(graphPath, g);
  const loaded = readGraph(graphPath);
  assert.deepEqual(loaded, g);
  rmSync(dir, { recursive: true });
});

test('parseFrontmatter parses id, type, brain, keywords, connections', () => {
  const md = `---\nid: pattern-auth-retry\ntype: pattern\nbrain: agent\ncreated: 2026-05-25\nrelevance_keywords: [auth, retry, token]\nconnections:\n  - "[[agent-friday]]"\n  - "[[outcome-1071]]"\n---\n\n# Body here\n`;
  const { frontmatter, body } = parseFrontmatter(md);
  assert.equal(frontmatter.id, 'pattern-auth-retry');
  assert.equal(frontmatter.type, 'pattern');
  assert.deepEqual(frontmatter.relevance_keywords, ['auth', 'retry', 'token']);
  assert.deepEqual(frontmatter.connections, ['[[agent-friday]]', '[[outcome-1071]]']);
  assert.match(body, /# Body here/);
});

test('serializeFrontmatter roundtrips cleanly', () => {
  const fm = {
    id: 'pattern-test',
    type: 'pattern',
    brain: 'agent',
    created: '2026-05-25',
    relevance_keywords: ['a', 'b'],
    connections: ['[[x]]'],
  };
  const md = serializeFrontmatter(fm, '# body');
  const { frontmatter } = parseFrontmatter(md);
  assert.equal(frontmatter.id, fm.id);
  assert.deepEqual(frontmatter.relevance_keywords, fm.relevance_keywords);
});
