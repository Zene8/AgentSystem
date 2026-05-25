#!/usr/bin/env node
// graph-query.js — query graph by keywords, return top-N nodes by composite score
// Usage: node tools/graph/graph-query.js <slug> [keywords...] [--top=N] [--json]
//        [--brain-path=PATH] [--mode=debugging|architecture|routine|incident]
//        [--spread] [--spread-hops=N] [--spread-decay=F]
//        [--primed=node1,node2,node3]
//
// Fix 1: visit_count is decayed at query time (Ebbinghaus half-life 30 days)
// Fix 2: --mode adjusts composite weights for task context
// Fix 3: --spread enables multi-hop spreading activation to surface non-obvious connections
// Fix 6 (issue #36): --primed=node1,node2 adds priming_bonus to neighbors of active nodes

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  readGraph,
  parseFrontmatter,
  WEIGHT_PROFILES,
  decayedVisitScore,
  spreadingActivation,
  recomputeComposite,
} from './graph-lib.js';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of args) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags[k] = v ?? true;
  } else {
    positional.push(a);
  }
}

const [slug, ...keywords] = positional;
if (!slug) {
  console.error('Usage: graph-query.js <slug> [keywords...] [--top=N] [--json] [--brain-path=PATH]');
  console.error('       [--mode=debugging|architecture|routine|incident] [--spread]');
  process.exit(1);
}

const topN = parseInt(flags.top || '10');
const jsonOut = !!flags.json;
const mode = flags.mode || 'default';
const useSpread = !!flags.spread;
const spreadHops = parseInt(flags['spread-hops'] || '3');
const spreadDecay = parseFloat(flags['spread-decay'] || '0.5');

// Fix 6 (issue #36): Working memory priming.
// --primed=node-a,node-b  → nodes currently in agent's working memory (recently read/visited).
// Neighbors of primed nodes get a priming_bonus (+0.15) added to their effective composite.
// Simulates how recent concept activation makes related concepts more accessible.
const primedNodes = flags.primed
  ? new Set(String(flags.primed).split(',').map(s => s.trim()).filter(Boolean))
  : new Set();
const PRIMING_BONUS = 0.15;

// Validate mode
if (!WEIGHT_PROFILES[mode]) {
  console.error(`Unknown mode: ${mode}. Valid: ${Object.keys(WEIGHT_PROFILES).join(', ')}`);
  process.exit(1);
}

const nexusDir = flags['brain-path']
  ? resolve(flags['brain-path'])
  : join(process.cwd(), 'nexus', slug);

const graphPath = join(nexusDir, 'graph.json');
if (!existsSync(graphPath)) {
  console.error(`No graph at ${graphPath}. Run graph-init first.`);
  process.exit(1);
}

const graph = readGraph(graphPath);
const nodesDir = join(nexusDir, 'nodes');
const now = Date.now();

// Fix 1: Build a time-decayed version of the graph for scoring.
// Stored visit_count is the normalized base; decayedVisitScore applies half-life.
// Composite in graph.json is "as of last update" — we recompute at query time with decay.
function effectiveComposite(edge) {
  const decayed = decayedVisitScore(
    edge.weights.visit_count,
    edge.weights.last_visited,
    now
  );
  return recomputeComposite(
    { ...edge.weights, visit_count: decayed },
    mode  // Fix 2: use mode-specific weights
  );
}

// Fix 6: Build primed neighbor set — nodes one hop from any primed node.
// These get priming_bonus applied to their edge score.
const primedNeighbors = new Set();
if (primedNodes.size > 0) {
  for (const edge of graph.edges) {
    if (primedNodes.has(edge.source)) primedNeighbors.add(edge.target);
    if (primedNodes.has(edge.target)) primedNeighbors.add(edge.source);
  }
}

// Score each node by its best edge composite (with decay + mode + priming)
const scored = graph.nodes.map(nodeId => {
  const rawEdgeScore = graph.edges
    .filter(e => e.source === nodeId || e.target === nodeId)
    .reduce((max, e) => Math.max(max, effectiveComposite(e)), 0);

  // Priming bonus: if this node neighbors an active working memory node, boost it
  const primed = primedNeighbors.has(nodeId);
  const edgeScore = primed ? Math.min(1.0, rawEdgeScore + PRIMING_BONUS) : rawEdgeScore;

  let keywordScore = 0;
  if (keywords.length > 0) {
    const nodePath = join(nodesDir, `${nodeId}.md`);
    if (existsSync(nodePath)) {
      const { frontmatter, body } = parseFrontmatter(readFileSync(nodePath, 'utf8'));
      const haystack = [
        ...(frontmatter.relevance_keywords || []),
        nodeId,
        body,
      ].join(' ').toLowerCase();
      const matches = keywords.filter(kw => haystack.includes(kw.toLowerCase())).length;
      keywordScore = matches / keywords.length;
    }
  }

  const score = keywords.length > 0
    ? parseFloat((edgeScore * 0.4 + keywordScore * 0.6).toFixed(4))
    : parseFloat(edgeScore.toFixed(4));

  return { nodeId, score, edgeScore, keywordScore, primed };
});

const directResults = scored
  .filter(r => r.score > 0 || keywords.length === 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, topN);

// Fix 3: Spreading activation — surface 2nd/3rd order connections
let spreadResults = [];
if (useSpread && directResults.length > 0) {
  // Seed from top direct results (up to 5 seeds for performance)
  const seedNodes = directResults.slice(0, 5).map(r => r.nodeId);

  // Use decay-adjusted graph edges for spreading
  const decayedGraph = {
    ...graph,
    edges: graph.edges.map(e => ({
      ...e,
      composite: effectiveComposite(e),
    })),
  };

  const activation = spreadingActivation(decayedGraph, seedNodes, {
    maxHops: spreadHops,
    decayPerHop: spreadDecay,
    threshold: 0.05,
  });

  // Exclude nodes already in direct results
  const directIds = new Set(directResults.map(r => r.nodeId));
  spreadResults = Array.from(activation.entries())
    .filter(([nodeId]) => !directIds.has(nodeId))
    .map(([nodeId, activation_strength]) => ({ nodeId, activation_strength }))
    .sort((a, b) => b.activation_strength - a.activation_strength)
    .slice(0, topN);
}

if (jsonOut) {
  const out = { mode, direct: directResults };
  if (useSpread) out.spread = spreadResults;
  console.log(JSON.stringify(out, null, 2));
} else {
  const modeLabel = mode !== 'default' ? ` [mode: ${mode}]` : '';
  if (directResults.length === 0) {
    console.log(`No results for: ${keywords.join(', ')}`);
  } else {
    console.log(`Top ${directResults.length} nodes in [${slug}]${modeLabel} for: ${keywords.join(', ') || '(all)'}\n`);
    for (const r of directResults) {
      const primedTag = r.primed ? ' [primed]' : '';
      console.log(`  ${r.nodeId.padEnd(55)} score=${r.score}${primedTag}`);
    }
  }
  if (useSpread && spreadResults.length > 0) {
    console.log(`\nSpreading activation (${spreadHops} hops) — non-obvious connections:\n`);
    for (const r of spreadResults) {
      console.log(`  ${r.nodeId.padEnd(55)} activation=${r.activation_strength}`);
    }
  }
}
