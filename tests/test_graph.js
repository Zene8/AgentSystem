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
  WEIGHT_PROFILES,
  decayedVisitScore,
  spreadingActivation,
} from '../tools/graph/graph-lib.js';

function tmpDir() {
  const d = join(tmpdir(), `graph-test-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

// ── Original tests (preserved) ───────────────────────────────────────────────

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
  assert.equal(g2.edges[0].weights.last_visited, null); // Fix 1: new field
  const g3 = addEdge(g2, 'a', 'b');
  assert.equal(g3.edges.length, 1);
});

test('updateVisitCount increments raw, renormalizes, and sets last_visited', () => {
  let g = emptyGraph('agent', 'test');
  g = addNode(addNode(g, 'a'), 'b');
  g = addEdge(addEdge(g, 'a', 'b'), 'b', 'a');
  g.edges[0].weights._visit_raw = 5;
  g.edges[1].weights._visit_raw = 5;
  const before = Date.now();
  g = updateVisitCount(g, 'a', 'b');
  const after = Date.now();
  const edge = g.edges.find(e => e.source === 'a' && e.target === 'b');
  assert.equal(edge.weights._visit_raw, 6);
  assert.equal(edge.weights.visit_count, 1.0);
  // Fix 1: last_visited must be set and valid ISO timestamp
  assert.ok(edge.weights.last_visited, 'last_visited should be set');
  const ts = new Date(edge.weights.last_visited).getTime();
  assert.ok(ts >= before && ts <= after, 'last_visited should be current time');
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

test('recomputeComposite uses correct default formula', () => {
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

// ── Fix 1: Temporal decay tests ──────────────────────────────────────────────

test('decayedVisitScore: fresh visit returns near full value', () => {
  // Visited just now — decay should be negligible (< 1% loss)
  const justNow = new Date().toISOString();
  const score = decayedVisitScore(1.0, justNow, Date.now());
  assert.ok(score > 0.99, `Expected near 1.0, got ${score}`);
});

test('decayedVisitScore: 30-day-old visit returns ~half', () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const score = decayedVisitScore(1.0, thirtyDaysAgo, Date.now());
  // Half-life is 30 days → should be ~0.5
  assert.ok(score > 0.48 && score < 0.52, `Expected ~0.5, got ${score}`);
});

test('decayedVisitScore: 60-day-old visit returns ~quarter', () => {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const score = decayedVisitScore(1.0, sixtyDaysAgo, Date.now());
  // Two half-lives → ~0.25
  assert.ok(score > 0.23 && score < 0.27, `Expected ~0.25, got ${score}`);
});

test('decayedVisitScore: null last_visited returns 0', () => {
  const score = decayedVisitScore(1.0, null, Date.now());
  assert.equal(score, 0);
});

test('decayedVisitScore: zero visit_count returns 0', () => {
  const score = decayedVisitScore(0, new Date().toISOString(), Date.now());
  assert.equal(score, 0);
});

// ── Fix 2: Context-adaptive weight profile tests ─────────────────────────────

test('WEIGHT_PROFILES exports all required modes', () => {
  const required = ['debugging', 'architecture', 'routine', 'incident', 'default'];
  for (const mode of required) {
    assert.ok(WEIGHT_PROFILES[mode], `Missing profile: ${mode}`);
    const p = WEIGHT_PROFILES[mode];
    // Each profile must have all four dimensions
    assert.ok('co_change' in p && 'semantic' in p && 'visit_count' in p && 'confidence' in p);
    // Each profile's weights must sum to 1.0
    const sum = p.co_change + p.semantic + p.visit_count + p.confidence;
    assert.ok(Math.abs(sum - 1.0) < 0.001, `${mode} weights sum to ${sum}, expected 1.0`);
  }
});

test('recomputeComposite: mode string applies correct weights', () => {
  const weights = { co_change: 1.0, semantic: 0.0, visit_count: 0.0, confidence: 0.0 };
  // In debugging mode, co_change weight is 0.40
  const debugScore = recomputeComposite(weights, 'debugging');
  assert.equal(debugScore, 0.4);
  // In architecture mode, co_change weight is 0.10
  const archScore = recomputeComposite(weights, 'architecture');
  assert.equal(archScore, 0.1);
});

test('recomputeComposite: debugging mode emphasizes co_change', () => {
  // co_change=1 should score higher in debugging than architecture
  const weights = { co_change: 1.0, semantic: 0.0, visit_count: 0.0, confidence: 0.0 };
  assert.ok(
    recomputeComposite(weights, 'debugging') > recomputeComposite(weights, 'architecture'),
    'debugging should weight co_change higher than architecture'
  );
});

test('recomputeComposite: architecture mode emphasizes semantic', () => {
  const weights = { co_change: 0.0, semantic: 1.0, visit_count: 0.0, confidence: 0.0 };
  assert.ok(
    recomputeComposite(weights, 'architecture') > recomputeComposite(weights, 'debugging'),
    'architecture should weight semantic higher than debugging'
  );
});

test('recomputeComposite: unknown mode falls back to default', () => {
  const weights = { co_change: 1.0, semantic: 1.0, visit_count: 1.0, confidence: 1.0 };
  assert.equal(recomputeComposite(weights, 'nonexistent'), recomputeComposite(weights, 'default'));
});

test('recomputeComposite: config object still works (backwards compat)', () => {
  const weights = { co_change: 1.0, semantic: 0.0, visit_count: 0.0, confidence: 0.0 };
  const custom = recomputeComposite(weights, { co_change: 0.5, semantic: 0.5, visit_count: 0.0, confidence: 0.0 });
  assert.equal(custom, 0.5);
});

// ── Fix 3: Spreading activation tests ────────────────────────────────────────

function makeChainGraph() {
  // Graph: a -- b -- c -- d
  // a→b composite 0.8, b→c composite 0.6, c→d composite 0.7
  let g = emptyGraph('agent', 'test');
  for (const n of ['a', 'b', 'c', 'd']) g = addNode(g, n);
  g = addEdge(addEdge(addEdge(g, 'a', 'b'), 'b', 'c'), 'c', 'd');
  g.edges[0].composite = 0.8; // a→b
  g.edges[1].composite = 0.6; // b→c
  g.edges[2].composite = 0.7; // c→d
  return g;
}

test('spreadingActivation: returns Map of non-seed activated nodes', () => {
  const g = makeChainGraph();
  const result = spreadingActivation(g, ['a']);
  assert.ok(result instanceof Map, 'should return Map');
  assert.ok(!result.has('a'), 'seed node should not be in results');
});

test('spreadingActivation: direct neighbor gets highest activation', () => {
  const g = makeChainGraph();
  const result = spreadingActivation(g, ['a']);
  // b is 1 hop from a, c is 2 hops, d is 3 hops
  const bStrength = result.get('b') ?? 0;
  const cStrength = result.get('c') ?? 0;
  assert.ok(bStrength > cStrength, `b (${bStrength}) should be stronger than c (${cStrength})`);
});

test('spreadingActivation: 3-hop chain reaches d from a', () => {
  const g = makeChainGraph();
  // threshold must be < 0.042 (a→b: 0.4, b→c: 0.12, c→d: ~0.042 with decayPerHop=0.5)
  const result = spreadingActivation(g, ['a'], { maxHops: 3, decayPerHop: 0.5, threshold: 0.01 });
  assert.ok(result.has('d'), 'd should be reachable in 3 hops from a');
  // a→b (0.8×0.5=0.4) → b→c (0.6×0.5, cumulative ~0.12) → c→d (0.7×0.5, cumulative ~0.042)
  const dStrength = result.get('d');
  assert.ok(dStrength > 0.01 && dStrength < 0.2, `d activation ${dStrength} should be small but present`);
});

test('spreadingActivation: maxHops=1 only reaches direct neighbors', () => {
  const g = makeChainGraph();
  const result = spreadingActivation(g, ['a'], { maxHops: 1 });
  assert.ok(result.has('b'), 'b should be reachable in 1 hop');
  assert.ok(!result.has('c'), 'c should NOT be reachable in 1 hop');
  assert.ok(!result.has('d'), 'd should NOT be reachable in 1 hop');
});

test('spreadingActivation: threshold filters weak activations', () => {
  const g = makeChainGraph();
  // High threshold — only strong direct connections survive
  const result = spreadingActivation(g, ['a'], { threshold: 0.3, decayPerHop: 0.5 });
  // b: 0.8 × 0.5 = 0.4 → survives
  // c: 0.4 × 0.6 × 0.5 = 0.12 → below 0.3, pruned
  assert.ok(result.has('b'), 'b (0.4) should survive threshold 0.3');
  assert.ok(!result.has('c'), 'c (0.12) should be pruned by threshold 0.3');
});

test('spreadingActivation: empty seed returns empty map', () => {
  const g = makeChainGraph();
  const result = spreadingActivation(g, []);
  assert.equal(result.size, 0);
});
