// graph-lib.js — core graph library, zero npm dependencies
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// --- Fix 2: Context-adaptive weight profiles ---
// Different task modes weight graph dimensions differently.
// Debugging: co_change matters most (what changed together when this broke?)
// Architecture: semantic matters most (what concepts are related?)
// Routine: confidence matters most (what worked before?)
// Incident: co_change + speed (what's coupled, fast)
export const WEIGHT_PROFILES = {
  debugging:    { co_change: 0.40, semantic: 0.15, visit_count: 0.25, confidence: 0.20 },
  architecture: { co_change: 0.10, semantic: 0.40, visit_count: 0.15, confidence: 0.35 },
  routine:      { co_change: 0.15, semantic: 0.20, visit_count: 0.25, confidence: 0.40 },
  incident:     { co_change: 0.45, semantic: 0.10, visit_count: 0.20, confidence: 0.25 },
  default:      { co_change: 0.20, semantic: 0.20, visit_count: 0.30, confidence: 0.30 },
};

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
    weights: {
      co_change: 0.0,
      semantic: 0.0,
      _visit_raw: 0,
      visit_count: 0.0,
      last_visited: null,   // Fix 1: timestamp for temporal decay
      confidence: 0.0,
    },
    composite: 0.0,
  };
  return { ...graph, edges: [...graph.edges, edge] };
}

// Fix 1: Temporal decay — visit_count decays over time without reinforcement.
// Half-life: 30 days. An edge not touched in 30 days has half its normalized visit strength.
// Stored visit_count remains the normalized base value. Decay applied at query time via
// decayedVisitScore(). last_visited timestamp updated here on every increment.
export function updateVisitCount(graph, source, target) {
  const now = new Date().toISOString();
  const edges = graph.edges.map(e => {
    if (e.source === source && e.target === target) {
      return {
        ...e,
        weights: {
          ...e.weights,
          _visit_raw: (e.weights._visit_raw || 0) + 1,
          last_visited: now,
        },
      };
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

// Fix 1: Apply Ebbinghaus decay to a visit_count score at query time.
// decayed = visit_count * 0.5^(daysSinceLast / halfLifeDays)
// last_visited null (never visited) → returns 0.
export function decayedVisitScore(visit_count, last_visited, now = Date.now(), halfLifeDays = 30) {
  if (!last_visited || !visit_count) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSince = (now - new Date(last_visited).getTime()) / msPerDay;
  const decay = Math.pow(0.5, daysSince / halfLifeDays);
  return parseFloat((visit_count * decay).toFixed(4));
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

// Fix 2: recomputeComposite accepts mode string OR weight config object.
// Mode string → looked up in WEIGHT_PROFILES. Unknown mode → default.
// Config object → used directly (for backwards compatibility and custom profiles).
export function recomputeComposite(weights, config = {}) {
  const profile = typeof config === 'string'
    ? (WEIGHT_PROFILES[config] || WEIGHT_PROFILES.default)
    : { ...WEIGHT_PROFILES.default, ...config };
  return parseFloat((
    (weights.co_change || 0) * profile.co_change +
    (weights.semantic || 0) * profile.semantic +
    (weights.visit_count || 0) * profile.visit_count +
    (weights.confidence || 0) * profile.confidence
  ).toFixed(4));
}

export function pruneOrphanedEdges(graph) {
  const nodeSet = new Set(graph.nodes);
  const edges = graph.edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
  return { ...graph, edges };
}

// Fix 3: Spreading activation — multi-hop traversal with decay per hop.
// Surfaces non-obvious connections that direct lookup misses.
// seedNodes: array of node IDs to start from (each starts at strength 1.0)
// maxHops: how many hops to traverse (default 3)
// decayPerHop: strength multiplier per hop × edge composite (default 0.5)
// threshold: stop spreading when activation < threshold (default 0.1)
// Returns Map(nodeId → activation_strength), excluding seed nodes.
export function spreadingActivation(graph, seedNodes, {
  maxHops = 3,
  decayPerHop = 0.5,
  threshold = 0.1,
} = {}) {
  const activation = new Map();
  const seedSet = new Set(seedNodes);

  // Initialize frontier with seed nodes at full strength
  let frontier = new Map(seedNodes.map(n => [n, 1.0]));

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier = new Map();

    for (const [nodeId, strength] of frontier) {
      // Find all edges connecting to this node (bidirectional)
      const edges = graph.edges.filter(
        e => e.source === nodeId || e.target === nodeId
      );

      for (const edge of edges) {
        const neighbor = edge.source === nodeId ? edge.target : edge.source;
        // Strength decays by hop factor × edge composite strength
        const newStrength = strength * decayPerHop * (edge.composite || 0.01);

        if (newStrength < threshold) continue;

        // Keep maximum activation if node reachable via multiple paths
        const existing = nextFrontier.get(neighbor) ?? 0;
        if (newStrength > existing) {
          nextFrontier.set(neighbor, newStrength);
        }

        // Record in overall activation map (max across all hops)
        const globalExisting = activation.get(neighbor) ?? 0;
        if (newStrength > globalExisting) {
          activation.set(neighbor, parseFloat(newStrength.toFixed(4)));
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  // Remove seed nodes from results (they seeded the search, not the findings)
  for (const seed of seedSet) {
    activation.delete(seed);
  }

  return activation;
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
