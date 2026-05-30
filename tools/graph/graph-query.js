#!/usr/bin/env node
// graph-query.js — query graph by keywords, return top-N nodes by composite score
// Usage: node tools/graph/graph-query.js <slug> [keywords...] [--top=N] [--json]
//        [--brain-path=PATH] [--mode=debugging|architecture|routine|incident]
//        [--spread] [--spread-hops=N] [--spread-decay=F]
//        [--primed=node1,node2,node3]
//        [--hot-stub]  — return only nodes with hot:true in frontmatter, then exit
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

// BM25 keyword scoring.
// terms: string[], docContent: string, df: Map<string,number>, N: number, avgdl: number
// Returns raw BM25 score (not normalized).
export function computeBM25(terms, docContent, df, N, avgdl) {
  if (!terms || terms.length === 0) return 0;
  const k1 = 1.5;
  const b = 0.75;
  const words = docContent.toLowerCase().split(/\s+/);
  const docLen = words.length || 1;

  let score = 0;
  for (const term of terms) {
    const t = term.toLowerCase();
    const tf = words.filter(w => w === t).length;
    const dfTerm = df.get(t) || 0;
    const idf = Math.log((N - dfTerm + 0.5) / (dfTerm + 0.5) + 1);
    score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgdl));
  }
  return score;
}

// Detect if running as CLI (not imported as a module).
// In Node ESM, import.meta.url gives the file URL; process.argv[1] is the entry script path.
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === __filename ||
  process.argv[1]?.replace(/\\/g, '/') === __filename.replace(/\\/g, '/');

if (isMain) {
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
    console.error('       [--hot-stub]');
    process.exit(1);
  }

  const topN = parseInt(flags.top || '10');
  const jsonOut = !!flags.json;
  const mode = flags.mode || 'default';
  const useSpread = !!flags.spread;
  const spreadHops = parseInt(flags['spread-hops'] || '3');
  const spreadDecay = parseFloat(flags['spread-decay'] || '0.5');
  const hotStub = !!flags['hot-stub'];

  // Fix 6 (issue #36): Working memory priming.
  const primedNodes = flags.primed
    ? new Set(String(flags.primed).split(',').map(s => s.trim()).filter(Boolean))
    : new Set();
  const PRIMING_BONUS = 0.15;

  // Validate mode (skip for hot-stub since we exit before scoring)
  if (!hotStub && !WEIGHT_PROFILES[mode]) {
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

  // --hot-stub mode: return nodes with hot:true in frontmatter, then exit
  if (hotStub) {
    const hotNodes = [];
    for (const nodeId of graph.nodes) {
      const nodePath = join(nodesDir, `${nodeId}.md`);
      if (!existsSync(nodePath)) continue;
      const { frontmatter } = parseFrontmatter(readFileSync(nodePath, 'utf8'));
      if (frontmatter.hot === true) {
        hotNodes.push(nodeId);
      }
    }
    if (jsonOut) {
      console.log(JSON.stringify(hotNodes));
    } else {
      for (const nodeId of hotNodes) {
        console.log(nodeId);
      }
    }
    process.exit(0);
  }

  // Fix 1: Build a time-decayed version of the graph for scoring.
  function effectiveComposite(edge) {
    const decayed = decayedVisitScore(
      edge.weights.visit_count,
      edge.weights.last_visited,
      now
    );
    return recomputeComposite(
      { ...edge.weights, visit_count: decayed },
      mode
    );
  }

  // Fix 6: Build primed neighbor set
  const primedNeighbors = new Set();
  if (primedNodes.size > 0) {
    for (const edge of graph.edges) {
      if (primedNodes.has(edge.source)) primedNeighbors.add(edge.target);
      if (primedNodes.has(edge.target)) primedNeighbors.add(edge.source);
    }
  }

  // Pre-load all node content for BM25 IDF calculation when keywords are present
  let contentCache = null;
  let dfMap = null;
  let bm25Avgdl = 1;

  if (keywords.length > 0) {
    contentCache = new Map();
    for (const nodeId of graph.nodes) {
      const nodePath = join(nodesDir, `${nodeId}.md`);
      if (existsSync(nodePath)) {
        const raw = readFileSync(nodePath, 'utf8');
        const { frontmatter, body } = parseFrontmatter(raw);
        const haystack = [
          ...(frontmatter.relevance_keywords || []),
          nodeId,
          body,
        ].join(' ');
        contentCache.set(nodeId, haystack);
      }
    }

    dfMap = new Map();
    let totalWords = 0;
    const cacheN = contentCache.size;
    for (const [, content] of contentCache) {
      totalWords += content.toLowerCase().split(/\s+/).length;
      for (const kw of keywords) {
        const t = kw.toLowerCase();
        if (content.toLowerCase().includes(t)) {
          dfMap.set(t, (dfMap.get(t) || 0) + 1);
        }
      }
    }
    bm25Avgdl = cacheN > 0 ? totalWords / cacheN : 1;
  }

  const MAX_BM25 = 10.0;

  const scored = graph.nodes.map(nodeId => {
    const rawEdgeScore = graph.edges
      .filter(e => e.source === nodeId || e.target === nodeId)
      .reduce((max, e) => Math.max(max, effectiveComposite(e)), 0);

    const primed = primedNeighbors.has(nodeId);
    const edgeScore = primed ? Math.min(1.0, rawEdgeScore + PRIMING_BONUS) : rawEdgeScore;

    let keywordScore = 0;
    if (keywords.length > 0 && contentCache) {
      const content = contentCache.get(nodeId);
      if (content) {
        const cacheN = contentCache.size;
        const raw = computeBM25(keywords, content, dfMap, cacheN, bm25Avgdl);
        keywordScore = Math.min(1.0, raw / (keywords.length * MAX_BM25));
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

  // Fix 3: Spreading activation
  let spreadResults = [];
  if (useSpread && directResults.length > 0) {
    const seedNodes = directResults.slice(0, 5).map(r => r.nodeId);
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
}
