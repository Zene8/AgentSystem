// graph-lib.js — core graph library, zero npm dependencies
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function emptyGraph(brain, projectSlug) {
  return { version: '1.0', brain, project_slug: projectSlug, nodes: [], edges: [] };
}

export function readGraph(graphPath) {
  return JSON.parse(readFileSync(graphPath, 'utf8'));
}

export function writeGraph(graphPath, graph) {
  mkdirSync(dirname(graphPath), { recursive: true });
  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
}

export function addNode(graph, nodeId) {
  if (graph.nodes.includes(nodeId)) return graph;
  return { ...graph, nodes: [...graph.nodes, nodeId] };
}

export function addEdge(graph, source, target) {
  const exists = graph.edges.some(e => e.source === source && e.target === target);
  if (exists) return graph;
  const edge = {
    source,
    target,
    weights: { co_change: 0.0, semantic: 0.0, _visit_raw: 0, visit_count: 0.0, confidence: 0.0 },
    composite: 0.0,
  };
  return { ...graph, edges: [...graph.edges, edge] };
}

export function updateVisitCount(graph, source, target) {
  const edges = graph.edges.map(e => {
    if (e.source === source && e.target === target) {
      return { ...e, weights: { ...e.weights, _visit_raw: (e.weights._visit_raw || 0) + 1 } };
    }
    return e;
  });
  const maxRaw = Math.max(...edges.map(e => e.weights._visit_raw || 0), 1);
  const normalized = edges.map(e => ({
    ...e,
    weights: { ...e.weights, visit_count: (e.weights._visit_raw || 0) / maxRaw },
  }));
  const recomputed = normalized.map(e => ({ ...e, composite: recomputeComposite(e.weights) }));
  return { ...graph, edges: recomputed };
}

export function updateConfidence(graph, source, target, delta) {
  const edges = graph.edges.map(e => {
    if (e.source === source && e.target === target) {
      const raw = (e.weights.confidence || 0) + delta;
      const clamped = parseFloat(Math.min(1.0, Math.max(0.0, raw)).toFixed(4));
      const updated = { ...e, weights: { ...e.weights, confidence: clamped } };
      return { ...updated, composite: recomputeComposite(updated.weights) };
    }
    return e;
  });
  return { ...graph, edges };
}

export function recomputeComposite(weights, config = {}) {
  const w = { co_change: 0.20, semantic: 0.20, visit_count: 0.30, confidence: 0.30, ...config };
  return parseFloat((
    (weights.co_change || 0) * w.co_change +
    (weights.semantic || 0) * w.semantic +
    (weights.visit_count || 0) * w.visit_count +
    (weights.confidence || 0) * w.confidence
  ).toFixed(4));
}

export function pruneOrphanedEdges(graph) {
  const nodeSet = new Set(graph.nodes);
  const edges = graph.edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
  return { ...graph, edges };
}

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  return { frontmatter: parseYaml(match[1]), body: match[2] };
}

export function serializeFrontmatter(frontmatter, body) {
  return `---\n${toYaml(frontmatter)}---\n\n${body.trimStart()}`;
}

function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const inlineArr = line.match(/^([\w-]+):\s+\[([^\]]*)\]\s*$/);
    if (inlineArr) {
      result[inlineArr[1]] = inlineArr[2].split(',').map(s => s.trim());
      i++; continue;
    }
    const blockListStart = line.match(/^([\w-]+):\s*$/);
    if (blockListStart) {
      const key = blockListStart[1];
      const items = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s+-\s+/)) {
        items.push(lines[i].replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, ''));
        i++;
      }
      result[key] = items;
      continue;
    }
    const scalar = line.match(/^([\w-]+):\s+(.+)$/);
    if (scalar) {
      result[scalar[1]] = scalar[2].replace(/^["']|["']$/g, '');
    }
    i++;
  }
  return result;
}

function toYaml(obj) {
  return Object.entries(obj).map(([k, v]) => {
    if (Array.isArray(v)) {
      if (v.length === 0) return `${k}: []`;
      if (k === 'connections') {
        return `${k}:\n${v.map(s => `  - "${s}"`).join('\n')}`;
      }
      return `${k}: [${v.map(s => String(s)).join(', ')}]`;
    }
    return `${k}: ${v}`;
  }).join('\n') + '\n';
}
