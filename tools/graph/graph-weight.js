#!/usr/bin/env node
// graph-weight.js — update edge weights + recompute composite
// Usage:
//   node tools/graph/graph-weight.js visit      <slug> <source> <target>
//   node tools/graph/graph-weight.js confidence <slug> <source> <target> <delta>
//   node tools/graph/graph-weight.js deprecate  <slug> <node-id>

import { join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readGraph, writeGraph, updateVisitCount, updateConfidence } from './graph-lib.js';

const [,, command, slug, ...rest] = process.argv;
const COMMANDS = ['visit', 'confidence', 'deprecate'];

if (!command || !COMMANDS.includes(command) || !slug) {
  console.error(`Usage: graph-weight.js <${COMMANDS.join('|')}> <slug> ...`);
  process.exit(1);
}

const nexusDir = join(process.cwd(), 'nexus', slug);
const graphPath = join(nexusDir, 'graph.json');

if (!existsSync(graphPath)) {
  console.error(`No graph at ${graphPath}. Run graph-init first.`);
  process.exit(1);
}

let graph = readGraph(graphPath);

if (command === 'visit') {
  const [source, target] = rest;
  if (!source || !target) { console.error('visit requires <source> <target>'); process.exit(1); }
  graph = updateVisitCount(graph, source, target);
  const edge = graph.edges.find(e => e.source === source && e.target === target);
  console.log(`visit: ${source} → ${target} raw=${edge?.weights._visit_raw} normalized=${edge?.weights.visit_count}`);
}

if (command === 'confidence') {
  const [source, target, deltaStr] = rest;
  const delta = parseFloat(deltaStr);
  if (!source || !target || isNaN(delta)) {
    console.error('confidence requires <source> <target> <delta>'); process.exit(1);
  }
  graph = updateConfidence(graph, source, target, delta);
  const edge = graph.edges.find(e => e.source === source && e.target === target);
  console.log(`confidence: ${source} → ${target} = ${edge?.weights.confidence} (composite=${edge?.composite})`);
}

if (command === 'deprecate') {
  const [nodeId] = rest;
  if (!nodeId) { console.error('deprecate requires <node-id>'); process.exit(1); }
  const nodePath = join(nexusDir, 'nodes', `${nodeId}.md`);
  if (existsSync(nodePath)) {
    let content = readFileSync(nodePath, 'utf8');
    if (!content.includes('deprecated: true')) {
      content = content.replace(/^---\n/, '---\ndeprecated: true\n');
      writeFileSync(nodePath, content, 'utf8');
    }
  }
  console.log(`deprecated: ${nodeId}`);
}

writeGraph(graphPath, graph);
