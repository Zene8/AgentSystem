#!/usr/bin/env node
// personal-brain-prune-placeholders.js — one-time cleanup for issue #111.
// Removes template placeholder nodes (e.g. "[Add your preferences here]") that were
// promoted into real graph nodes before personal-brain-split.js learned to skip them.
// Safe to re-run: no-op once placeholders are gone.
// Usage: node tools/personal-brain-prune-placeholders.js [--dry-run]

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { agentMemoryRoot, readGraph, writeGraph, parseFrontmatter } from './graph/graph-lib.js';

const PLACEHOLDER_RE = /\[\s*(add your|e\.g\.|your |goal\s*\d|project name|list your)/i;

export function prunePlaceholders({ dryRun = false } = {}) {
  const brainDir = join(agentMemoryRoot(), 'nexus', 'personal-brain');
  const nodesDir = join(brainDir, 'nodes');
  const graphPath = join(brainDir, 'graph.json');

  if (!existsSync(graphPath)) return { ok: false, message: 'no graph.json found', removed: [] };

  let graph = readGraph(graphPath);
  const removed = [];

  for (const nodeId of [...graph.nodes]) {
    const nodeFile = join(nodesDir, `${nodeId}.md`);
    if (!existsSync(nodeFile)) continue;
    const raw = readFileSync(nodeFile, 'utf8');
    const { body } = parseFrontmatter(raw);
    if (PLACEHOLDER_RE.test(body || raw)) {
      removed.push(nodeId);
      if (!dryRun) {
        graph = {
          ...graph,
          nodes: graph.nodes.filter(n => n !== nodeId),
          edges: graph.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
        };
        try { unlinkSync(nodeFile); } catch { /* already gone */ }
      }
    }
  }

  if (!dryRun && removed.length > 0) writeGraph(graphPath, graph);
  return { ok: true, removed };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('personal-brain-prune-placeholders.js');
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const r = prunePlaceholders({ dryRun });
  if (!r.ok) { console.log(`prune-placeholders: ${r.message}`); process.exit(0); }
  console.log(`${dryRun ? '[dry-run] would remove' : 'removed'} ${r.removed.length} placeholder node(s): ${r.removed.join(', ') || '(none)'}`);
}
