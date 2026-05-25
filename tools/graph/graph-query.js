#!/usr/bin/env node
// graph-query.js — query graph by keywords, return top-N nodes by composite score
// Usage: node tools/graph/graph-query.js <slug> [keywords...] [--top=N] [--json] [--brain-path=PATH]

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readGraph, parseFrontmatter } from './graph-lib.js';

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
  process.exit(1);
}

const topN = parseInt(flags.top || '10');
const jsonOut = !!flags.json;

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

const scored = graph.nodes.map(nodeId => {
  const edgeScore = graph.edges
    .filter(e => e.source === nodeId || e.target === nodeId)
    .reduce((max, e) => Math.max(max, e.composite), 0);

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

  return { nodeId, score, edgeScore, keywordScore };
});

const results = scored
  .filter(r => r.score > 0 || keywords.length === 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, topN);

if (jsonOut) {
  console.log(JSON.stringify(results, null, 2));
} else {
  if (results.length === 0) {
    console.log(`No results for: ${keywords.join(', ')}`);
  } else {
    console.log(`Top ${results.length} nodes in [${slug}] for: ${keywords.join(', ') || '(all)'}\n`);
    for (const r of results) {
      console.log(`  ${r.nodeId.padEnd(55)} score=${r.score}`);
    }
  }
}
