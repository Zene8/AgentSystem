// graph-lib.js — core graph library, zero npm dependencies
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// Cross-CLI shared memory root. Neutral path — readable by Claude, Gemini, Copilot, any CLI.
// Override with AGENT_MEMORY_ROOT env var if needed.
export function agentMemoryRoot() {
  return process.env.AGENT_MEMORY_ROOT || join(homedir(), 'agent-memory');
}

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
      last_visited: null,
      confidence: { n_confirms: 0, n_contradicts: 0 },
      valid_from: new Date().toISOString(),
      valid_until: null,
    },
    composite: 0.0,
  };
  let updated = { ...graph, edges: [...graph.edges, edge] };
  updated = enforceEdgeCap(updated, source);
  updated = enforceEdgeCap(updated, target);
  return updated;
}

// Fix 1: Temporal decay — visit_count decays over time without reinforcement.
// Half-life: 30 days. An edge not touched in 30 days has half its normalized visit strength.
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

// Apply Ebbinghaus decay to a visit_count score at query time.
// decayed = visit_count * 0.5^(daysSinceLast / effectiveHalfLife)
// degreeCentrality: hub nodes decay slower (more connections = more durable memory)
export function decayedVisitScore(visit_count, last_visited, now = Date.now(), halfLifeDays = 30, degreeCentrality = 0) {
  if (!last_visited || !visit_count) return 0;
  const alpha = 0.5;
  const effectiveHalfLife = halfLifeDays * (1 + alpha * degreeCentrality);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSince = (now - new Date(last_visited).getTime()) / msPerDay;
  const decay = Math.pow(0.5, daysSince / effectiveHalfLife);
  return parseFloat((visit_count * decay).toFixed(4));
}

// Bayesian confidence updates using n_confirms / n_contradicts counts.
// delta > 0 → increment n_confirms; delta < 0 → increment n_contradicts
// Posterior mean = (n_confirms + 1) / (n_confirms + n_contradicts + 2)  [Laplace smoothing]
export function updateConfidence(graph, source, target, delta) {
  const edges = graph.edges.map(e => {
    if (e.source === source && e.target === target) {
      const conf = e.weights.confidence && typeof e.weights.confidence === 'object'
        ? { ...e.weights.confidence }
        : { n_confirms: 0, n_contradicts: 0 };
      if (delta > 0) conf.n_confirms += 1;
      else if (delta < 0) conf.n_contradicts += 1;
      const updated = {
        ...e,
        weights: {
          ...e.weights,
          confidence: conf,
        },
      };
      return { ...updated, composite: recomputeComposite(updated.weights) };
    }
    return e;
  });
  return { ...graph, edges };
}

// recomputeComposite accepts mode string OR weight config object.
// Handles Bayesian confidence object by computing posterior mean.
export function recomputeComposite(weights, config = {}) {
  const profile = typeof config === 'string'
    ? (WEIGHT_PROFILES[config] || WEIGHT_PROFILES.default)
    : { ...WEIGHT_PROFILES.default, ...config };
  const confVal = typeof weights.confidence === 'object' && weights.confidence !== null
    ? (weights.confidence.n_confirms + 1) / (weights.confidence.n_confirms + weights.confidence.n_contradicts + 2)
    : (weights.confidence || 0);
  return parseFloat((
    (weights.co_change || 0) * profile.co_change +
    (weights.semantic || 0) * profile.semantic +
    (weights.visit_count || 0) * profile.visit_count +
    confVal * profile.confidence
  ).toFixed(4));
}

// Enforce a maximum edge count per node. Removes lowest-composite edges until count <= cap.
// The newly added edge is not protected; lowest composite overall is removed.
export function enforceEdgeCap(graph, nodeId, cap = 15) {
  const nodeEdges = graph.edges.filter(e => e.source === nodeId || e.target === nodeId);
  if (nodeEdges.length <= cap) return graph;
  // Sort ascending by composite — lowest first
  const sorted = [...nodeEdges].sort((a, b) => (a.composite || 0) - (b.composite || 0));
  const toRemove = new Set();
  for (let i = 0; i < nodeEdges.length - cap; i++) {
    toRemove.add(sorted[i]);
  }
  const edges = graph.edges.filter(e => !toRemove.has(e));
  return { ...graph, edges };
}

// Fix 7 (issue #38): Salience tagging — high-stakes events encode stronger memories.
export function computeSalience({ incident = false, durationMinutes = 0, firstTimeSolve = false, presolveConfidence = 1.0 } = {}) {
  let s = 0.0;
  if (incident) s += 0.40;
  if (durationMinutes > 120) s += 0.20;
  if (firstTimeSolve) s += 0.20;
  if (presolveConfidence < 0.3) s += 0.20;
  return parseFloat(Math.min(1.0, s).toFixed(4));
}

// Fix 8 (issue #35): Episodic memory node builder.
export function buildEpisodeNode({ id, sequence = [], contextTags = [], salience = 0.0, durationMinutes = 0, outcomeRef = null, connections = [] }) {
  const created = new Date().toISOString().slice(0, 10);
  const frontmatter = {
    id,
    type: 'episode',
    brain: 'agent',
    created,
    context_tags: contextTags,
    salience,
    duration_minutes: durationMinutes,
    ...(outcomeRef ? { outcome_ref: outcomeRef } : {}),
    connections: [...(outcomeRef ? [`[[${outcomeRef.replace(/[\[\]]/g, '')}]]`] : []), ...connections],
  };
  const seqLines = sequence.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const body = `# Episode: ${id}\n\n## Sequence\n\n${seqLines || '(none recorded)'}\n\n**Salience:** ${salience}\n**Duration:** ${durationMinutes} min\n`;
  return serializeFrontmatter(frontmatter, body);
}

// Fix 9 (issue #39): Cross-agent memory propagation gate check.
export function shouldPropagate(confidence, salience) {
  return confidence >= 0.8 && salience >= 0.7;
}

export function buildSharedMemoryEntry({ id, body, confidence, salience, sourceAgent, audience = [] }) {
  const created = new Date().toISOString().slice(0, 10);
  const frontmatter = {
    id: `shared-${id}`,
    type: 'shared-outcome',
    brain: 'agent',
    created,
    source_agent: sourceAgent,
    audience,
    confidence,
    salience,
  };
  return serializeFrontmatter(frontmatter, body);
}

export function pruneOrphanedEdges(graph) {
  const nodeSet = new Set(graph.nodes);
  const edges = graph.edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
  return { ...graph, edges };
}

// Spreading activation — multi-hop traversal with decay per hop.
// lateralInhibition: after each hop, keep top M=7 nodes at full strength,
// apply β=0.15 penalty to the rest to prevent hub nodes from dominating.
export function spreadingActivation(graph, seedNodes, {
  maxHops = 3,
  decayPerHop = 0.5,
  threshold = 0.1,
  lateralInhibition = true,
} = {}) {
  const activation = new Map();
  const seedSet = new Set(seedNodes);

  let frontier = new Map(seedNodes.map(n => [n, 1.0]));

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier = new Map();

    for (const [nodeId, strength] of frontier) {
      const edges = graph.edges.filter(
        e => e.source === nodeId || e.target === nodeId
      );

      for (const edge of edges) {
        const neighbor = edge.source === nodeId ? edge.target : edge.source;
        const newStrength = strength * decayPerHop * (edge.composite || 0.01);

        if (newStrength < threshold) continue;

        const existing = nextFrontier.get(neighbor) ?? 0;
        if (newStrength > existing) {
          nextFrontier.set(neighbor, newStrength);
        }

        const globalExisting = activation.get(neighbor) ?? 0;
        if (newStrength > globalExisting) {
          activation.set(neighbor, parseFloat(newStrength.toFixed(4)));
        }
      }
    }

    // Lateral inhibition: keep top M=7 nodes at full strength, penalise rest
    if (lateralInhibition && nextFrontier.size > 0) {
      const M = 7;
      const beta = 0.15;
      const sorted = [...nextFrontier.entries()].sort((a, b) => b[1] - a[1]);
      for (let i = M; i < sorted.length; i++) {
        const [nodeId, str] = sorted[i];
        const inhibited = str * (1 - beta);
        nextFrontier.set(nodeId, inhibited);
        // Update global activation map with inhibited value if it was previously set from this hop
        const globalExisting = activation.get(nodeId) ?? 0;
        if (inhibited < globalExisting) {
          // Don't reduce global — global tracks max across hops; inhibition is frontier-local
        } else {
          activation.set(nodeId, parseFloat(inhibited.toFixed(4)));
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

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
