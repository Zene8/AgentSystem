#!/usr/bin/env node
// personal-brain-split.js — parse user-brain.md into discrete graph nodes
// Usage: node tools/personal-brain-split.js [--dry-run]

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { agentMemoryRoot, readGraph, writeGraph, addNode, addEdge, emptyGraph } from './graph/graph-lib.js';

const dryRun = process.argv.includes('--dry-run');
const today = new Date().toISOString().slice(0, 10);

const brainDir = join(agentMemoryRoot(), 'nexus', 'personal-brain');
const brainPath = join(brainDir, 'user-brain.md');
const nodesDir = join(brainDir, 'nodes');
const graphPath = join(brainDir, 'graph.json');

if (!existsSync(brainPath)) {
  console.log('personal-brain-split: user-brain.md not found — nothing to split');
  process.exit(0);
}

const raw = readFileSync(brainPath, 'utf8');
const lines = raw.split('\n');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join('-');
}

function extractKeywords(text) {
  return text
    .replace(/^[-*]\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 3);
}

// Parse sections and bullet points
const candidates = []; // { section, text }
let currentSection = 'General';

for (const line of lines) {
  const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
  if (headerMatch) {
    currentSection = headerMatch[1].trim();
    continue;
  }
  const bulletMatch = line.match(/^[-*]\s+(.+)$/);
  if (bulletMatch) {
    const text = bulletMatch[1].trim();
    if (text) candidates.push({ section: currentSection, text: `- ${text}` });
  }
}

let graph = existsSync(graphPath)
  ? readGraph(graphPath)
  : emptyGraph('agent', 'personal-brain');

let nodesCreated = 0;
let edgesAdded = 0;
const nodeIds = []; // all created node ids in order
const nodeKeywords = new Map(); // id → keywords[]
const sectionLastNode = new Map(); // section → last nodeId

const edgesBefore = graph.edges.length;

for (const { section, text } of candidates) {
  const id = slugify(text.replace(/^[-*]\s*/, ''));
  if (!id) continue;

  const keywords = extractKeywords(text);
  const nodeFile = join(nodesDir, `${id}.md`);

  const nodeContent = `---
id: ${id}
type: user-fact
brain: personal-brain
created: ${today}
source_section: ${section}
relevance_keywords: [${keywords.join(', ')}]
hot: true
---

${text}
`;

  if (dryRun) {
    console.log(`[dry-run] would create node: ${nodeFile}`);
    console.log(`  section: ${section}`);
    console.log(`  keywords: ${keywords.join(', ')}`);
  } else {
    mkdirSync(nodesDir, { recursive: true });
    writeFileSync(nodeFile, nodeContent, 'utf8');
    nodesCreated++;
  }

  if (!graph.nodes.includes(id)) {
    graph = addNode(graph, id);
  }

  // Sequential edge: connect to previous node in same section
  const prevInSection = sectionLastNode.get(section);
  if (prevInSection && prevInSection !== id) {
    graph = addEdge(graph, prevInSection, id);
  }
  sectionLastNode.set(section, id);

  nodeIds.push(id);
  nodeKeywords.set(id, keywords);
}

// Semantic edges: connect nodes sharing 2+ keywords
for (let i = 0; i < nodeIds.length; i++) {
  for (let j = i + 1; j < nodeIds.length; j++) {
    const a = nodeIds[i];
    const b = nodeIds[j];
    const ka = nodeKeywords.get(a) || [];
    const kb = nodeKeywords.get(b) || [];
    const shared = ka.filter(k => kb.includes(k));
    if (shared.length >= 2) {
      graph = addEdge(graph, a, b);
    }
  }
}

const edgesAdded2 = graph.edges.length - edgesBefore;

if (dryRun) {
  console.log(`[dry-run] would split user-brain.md → ${candidates.length} nodes, ~${edgesAdded2} edges`);
} else {
  writeGraph(graphPath, graph);
  console.log(`split user-brain.md → ${nodesCreated} nodes created, ${edgesAdded2} edges added`);
}
