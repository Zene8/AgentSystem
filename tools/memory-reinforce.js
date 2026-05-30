#!/usr/bin/env node
// memory-reinforce.js — CLI tool to reinforce or contradict edges in agent memory graph

import { join } from 'node:path';
import {
  agentMemoryRoot,
  readGraph,
  writeGraph,
  addNode,
  addEdge,
  updateVisitCount,
  updateConfidence,
} from './graph/graph-lib.js';

function printHelp() {
  console.log(`
memory-reinforce — reinforce or contradict edges in agent memory graph

Usage:
  node tools/memory-reinforce.js --brain=<slug> --source=<nodeId> --target=<nodeId> --confirm
  node tools/memory-reinforce.js --brain=<slug> --source=<nodeId> --target=<nodeId> --contradict
  node tools/memory-reinforce.js --brain=<slug> --source=<nodeId> --target=<nodeId> --visit
  node tools/memory-reinforce.js --brain=<slug> --source=<nodeId> --target=<nodeId> --create
  node tools/memory-reinforce.js --brain=<slug> --source=<nodeId> --target=<nodeId> --create --confirm

Options:
  --brain=<slug>      Brain slug (e.g. user-brain, friday, jarvis) [required]
  --source=<nodeId>   Source node ID [required]
  --target=<nodeId>   Target node ID [required]
  --confirm           Increment n_confirms on the edge
  --contradict        Increment n_contradicts on the edge
  --visit             Record an edge visit
  --create            Create nodes/edge if they don't exist
  --help              Print this help message

Flags can be combined: --create --confirm creates the edge then confirms it.
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
    if (arg.startsWith('--')) {
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

  // Validate required fields
  if (!args.brain || !args.source || !args.target) {
    console.error('Error: --brain, --source, and --target are required.');
    printHelp();
    process.exit(1);
  }

  const brain = args.brain;
  const source = args.source;
  const target = args.target;

  const shouldCreate = flags.includes('create');
  const shouldConfirm = flags.includes('confirm');
  const shouldContradict = flags.includes('contradict');
  const shouldVisit = flags.includes('visit');

  // Construct graph path
  const graphPath = join(agentMemoryRoot(), 'nexus', brain, 'graph.json');

  let graph;
  try {
    graph = readGraph(graphPath);
  } catch (err) {
    if (shouldCreate) {
      // Create empty graph if --create is specified
      graph = {
        version: '1.0',
        brain,
        project_slug: null,
        nodes: [],
        edges: [],
      };
    } else {
      console.error(`Error: graph.json not found at ${graphPath}. Use --create to create it.`);
      process.exit(1);
    }
  }

  // Create nodes and edge if --create is specified
  if (shouldCreate) {
    graph = addNode(graph, source);
    graph = addNode(graph, target);
    graph = addEdge(graph, source, target);
  }

  // Verify edge exists
  const edgeExists = graph.edges.some(e => e.source === source && e.target === target);
  if (!edgeExists) {
    console.error(`Error: edge ${source} → ${target} does not exist. Use --create to create it.`);
    process.exit(1);
  }

  // Apply operations in order: visit → confirm → contradict
  if (shouldVisit) {
    graph = updateVisitCount(graph, source, target);
  }
  if (shouldConfirm) {
    graph = updateConfidence(graph, source, target, 1);
  }
  if (shouldContradict) {
    graph = updateConfidence(graph, source, target, -1);
  }

  // Write graph back
  writeGraph(graphPath, graph);

  // Get final edge stats for reporting
  const edge = graph.edges.find(e => e.source === source && e.target === target);
  const conf = edge.weights.confidence;
  if (!conf && !shouldCreate) throw new Error(`edge ${source} → ${target} missing confidence object`);
  const confirmed = conf ? conf.n_confirms : 0;
  const contradicted = conf ? conf.n_contradicts : 0;
  const visits = edge.weights._visit_raw || 0;

  console.log(`reinforced [${brain}] ${source} → ${target} (confirmed: ${confirmed}, contradicted: ${contradicted}, visits: ${visits})`);
}

main();
