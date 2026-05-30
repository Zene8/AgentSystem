#!/usr/bin/env node
// memory-stale.js — scanner for orphaned nodes and weak facts

import { join } from 'node:path';
import {
  agentMemoryRoot,
  readGraph,
  writeGraph,
  pruneOrphanedEdges,
} from './graph/graph-lib.js';

function printHelp() {
  console.log(`
memory-stale — scanner for orphaned nodes and weak facts

Usage:
  node tools/memory-stale.js --brain=<slug> [--fix] [--min-composite=0.1]

Options:
  --brain=<slug>            Brain slug (e.g. user-brain, friday, jarvis) [required]
  --fix                     Remove orphaned nodes from graph.nodes (do NOT delete .md files)
  --min-composite=<value>   Composite threshold for weak facts (default: 0.1)
  --help                    Print this help message

Behavior:
  1. Load graph from {agentMemoryRoot}/nexus/{brain}/graph.json
  2. Detect orphaned nodes: in graph.nodes but have zero active edges (valid_until === null)
  3. Detect weak facts: nodes where ALL their active edges have composite < min-composite
  4. Print report
  5. --fix: remove orphaned nodes from graph.nodes and call pruneOrphanedEdges
  6. Write graph back if --fix and changes made
  `);
}

function parseArgs(argv) {
  const args = {};
  const flags = [];
  for (const arg of argv.slice(2)) {
    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--fix') {
      flags.push('fix');
    } else if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value === undefined) {
        flags.push(key);
      } else {
        args[key] = value;
      }
    }
  }
  return { args, flags };
}

function main() {
  const { args, flags } = parseArgs(process.argv);

  if (!args.brain) {
    console.error('Error: --brain is required.');
    printHelp();
    process.exit(1);
  }

  const brain = args.brain;
  const shouldFix = flags.includes('fix');
  const minComposite = parseFloat(args['min-composite'] || '0.1');

  const graphPath = join(agentMemoryRoot(), 'nexus', brain, 'graph.json');

  let graph;
  try {
    graph = readGraph(graphPath);
  } catch (err) {
    console.error(`Error: graph.json not found at ${graphPath}`);
    process.exit(1);
  }

  // Find active edges (valid_until === null)
  const activeEdges = graph.edges.filter(e => e.weights.valid_until === null);

  // Detect orphaned nodes: in graph.nodes but have zero active edges
  const orphanedNodes = graph.nodes.filter(nodeId => {
    const hasActiveEdge = activeEdges.some(e => e.source === nodeId || e.target === nodeId);
    return !hasActiveEdge;
  });

  // Detect weak facts: nodes where ALL their active edges have composite < min-composite
  const weakFacts = [];
  for (const nodeId of graph.nodes) {
    const nodeEdges = activeEdges.filter(e => e.source === nodeId || e.target === nodeId);
    if (nodeEdges.length === 0) continue; // Skip orphaned (already detected)
    const allWeak = nodeEdges.every(e => (e.composite || 0) < minComposite);
    if (allWeak) {
      const maxComposite = Math.max(...nodeEdges.map(e => e.composite || 0));
      weakFacts.push({ nodeId, maxComposite });
    }
  }

  // Sort weak facts by max composite (ascending)
  weakFacts.sort((a, b) => a.maxComposite - b.maxComposite);

  // Print report
  console.log(`stale scan [${brain}]:`);
  if (orphanedNodes.length > 0) {
    console.log(`  orphaned nodes (${orphanedNodes.length}): ${orphanedNodes.join(', ')}`);
  } else {
    console.log(`  orphaned nodes (0)`);
  }

  if (weakFacts.length > 0) {
    const weakList = weakFacts.map(wf => `${wf.nodeId} (max_composite=${wf.maxComposite.toFixed(4)})`).join(', ');
    console.log(`  weak facts (${weakFacts.length}): ${weakList}`);
  } else {
    console.log(`  weak facts (0)`);
  }

  // Apply --fix if requested
  if (shouldFix && orphanedNodes.length > 0) {
    let updated = {
      ...graph,
      nodes: graph.nodes.filter(n => !orphanedNodes.includes(n)),
    };
    updated = pruneOrphanedEdges(updated);
    writeGraph(graphPath, updated);
    console.log(`fixed: removed ${orphanedNodes.length} orphaned nodes`);
  }
}

main();
