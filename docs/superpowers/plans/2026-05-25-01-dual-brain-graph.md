# Dual-Brain Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weighted graph memory system with two isolated brains — agent brain (user-global, compounds across all projects) and repo brain (per-project, generated from git + AST).

**Architecture:** Markdown node files store human-readable content; `graph.json` sidecar stores edge structure and multi-dimensional weights. Node.js CLI tools read/write both. No LLM calls, no npm dependencies — pure Node.js built-ins only.

**Tech Stack:** Node.js v25+ (built-ins only: `fs`, `path`, `child_process`), PowerShell (Windows), bash (tests)

---

## File Map

| File | Purpose |
|------|---------|
| `tools/graph/graph-lib.js` | Core library: parse nodes, read/write graph.json, weight math |
| `tools/graph/graph-init.js` | CLI: populate repo brain from git + import analysis |
| `tools/graph/graph-query.js` | CLI: query graph by keywords, return top-N nodes by composite |
| `tools/graph/graph-weight.js` | CLI: increment visit_count or adjust confidence, recompute composite |
| `nexus/.gitignore` | Ignore all generated repo brain content |
| `tests/test_graph.js` | Unit tests for graph-lib.js (Node built-in test runner) |
| `tests/test_graph_integration.sh` | Integration tests: init, query, weight update round-trips |

Agent brain scaffold (one-time, user-global):
- `~/.claude/agent-memory/nexus/agent-brain/graph.json`
- `~/.claude/agent-memory/nexus/agent-brain/INDEX.md`

---

## Task 1: Directory scaffold + gitignore

**Files:**
- Create: `tools/graph/.gitkeep`
- Create: `nexus/.gitignore`

- [ ] **Step 1: Create tools/graph directory**

```bash
mkdir -p tools/graph
touch tools/graph/.gitkeep
```

- [ ] **Step 2: Create nexus/.gitignore to ignore all generated repo brain content**

Create `nexus/.gitignore`:
```
# Repo brain content is generated — never commit
*/
*.json
*.md
!.gitignore
```

- [ ] **Step 3: Commit**

```bash
git add tools/graph/.gitkeep nexus/.gitignore
git commit -m "chore: scaffold graph tools dir + gitignore repo brain"
```

---

## Task 2: Core graph library (`graph-lib.js`)

**Files:**
- Create: `tools/graph/graph-lib.js`
- Create: `tests/test_graph.js`

- [ ] **Step 1: Write failing unit tests**

Create `tests/test_graph.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import {
  emptyGraph,
  addNode,
  addEdge,
  updateVisitCount,
  updateConfidence,
  recomputeComposite,
  pruneOrphanedEdges,
  readGraph,
  writeGraph,
  parseFrontmatter,
  serializeFrontmatter,
} from '../tools/graph/graph-lib.js';

// Test helpers
function tmpDir() {
  const d = join(tmpdir(), `graph-test-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

test('emptyGraph returns valid structure', () => {
  const g = emptyGraph('agent', 'test-project');
  assert.equal(g.version, '1.0');
  assert.equal(g.brain, 'agent');
  assert.equal(g.project_slug, 'test-project');
  assert.deepEqual(g.nodes, []);
  assert.deepEqual(g.edges, []);
});

test('addNode adds node id if not present', () => {
  const g = emptyGraph('agent', 'test');
  const g2 = addNode(g, 'pattern-auth');
  assert.deepEqual(g2.nodes, ['pattern-auth']);
  // idempotent
  const g3 = addNode(g2, 'pattern-auth');
  assert.deepEqual(g3.nodes, ['pattern-auth']);
});

test('addEdge adds edge with zero weights if not present', () => {
  const g = emptyGraph('agent', 'test');
  const g2 = addEdge(addNode(addNode(g, 'a'), 'b'), 'a', 'b');
  assert.equal(g2.edges.length, 1);
  assert.equal(g2.edges[0].source, 'a');
  assert.equal(g2.edges[0].target, 'b');
  assert.equal(g2.edges[0].weights.co_change, 0.0);
  assert.equal(g2.edges[0].weights.confidence, 0.0);
  // idempotent
  const g3 = addEdge(g2, 'a', 'b');
  assert.equal(g3.edges.length, 1);
});

test('updateVisitCount increments raw and renormalizes', () => {
  let g = emptyGraph('agent', 'test');
  g = addNode(addNode(g, 'a'), 'b');
  g = addEdge(addEdge(g, 'a', 'b'), 'b', 'a');
  // Set raw visits manually for predictable test
  g.edges[0].weights._visit_raw = 5;
  g.edges[1].weights._visit_raw = 5;
  g = updateVisitCount(g, 'a', 'b');
  // edge a->b raw should be 6, max is 6, normalized = 1.0
  const edge = g.edges.find(e => e.source === 'a' && e.target === 'b');
  assert.equal(edge.weights._visit_raw, 6);
  assert.equal(edge.weights.visit_count, 1.0);
});

test('updateConfidence clamps to [0,1]', () => {
  let g = emptyGraph('agent', 'test');
  g = addNode(addNode(g, 'a'), 'b');
  g = addEdge(g, 'a', 'b');
  // Start at 0.9, add 0.1 → should clamp at 1.0
  g.edges[0].weights.confidence = 0.9;
  g = updateConfidence(g, 'a', 'b', 0.2);
  assert.equal(g.edges[0].weights.confidence, 1.0);
  // Start at 0.1, subtract 0.15 → should clamp at 0.0
  g.edges[0].weights.confidence = 0.1;
  g = updateConfidence(g, 'a', 'b', -0.15);
  assert.equal(g.edges[0].weights.confidence, 0.0);
});

test('recomputeComposite uses correct formula', () => {
  const weights = { co_change: 1.0, semantic: 1.0, visit_count: 1.0, confidence: 1.0 };
  const composite = recomputeComposite(weights);
  // 0.20 + 0.20 + 0.30 + 0.30 = 1.0
  assert.equal(composite, 1.0);

  const half = { co_change: 0.5, semantic: 0.5, visit_count: 0.5, confidence: 0.5 };
  assert.equal(recomputeComposite(half), 0.5);
});

test('pruneOrphanedEdges removes edges where source or target missing from nodes', () => {
  let g = emptyGraph('agent', 'test');
  g.nodes = ['a', 'b'];
  g.edges = [
    { source: 'a', target: 'b', weights: {}, composite: 0 },
    { source: 'a', target: 'ghost', weights: {}, composite: 0 },
    { source: 'ghost2', target: 'b', weights: {}, composite: 0 },
  ];
  const pruned = pruneOrphanedEdges(g);
  assert.equal(pruned.edges.length, 1);
  assert.equal(pruned.edges[0].source, 'a');
  assert.equal(pruned.edges[0].target, 'b');
});

test('readGraph / writeGraph round-trip', () => {
  const dir = tmpDir();
  const graphPath = join(dir, 'graph.json');
  const g = emptyGraph('repo', 'roundtrip-test');
  writeGraph(graphPath, g);
  const loaded = readGraph(graphPath);
  assert.deepEqual(loaded, g);
  rmSync(dir, { recursive: true });
});

test('parseFrontmatter parses id, type, brain, keywords, connections', () => {
  const md = `---
id: pattern-auth-retry
type: pattern
brain: agent
created: 2026-05-25
relevance_keywords: [auth, retry, token]
connections:
  - "[[agent-friday]]"
  - "[[outcome-1071]]"
---

# Body here
`;
  const { frontmatter, body } = parseFrontmatter(md);
  assert.equal(frontmatter.id, 'pattern-auth-retry');
  assert.equal(frontmatter.type, 'pattern');
  assert.deepEqual(frontmatter.relevance_keywords, ['auth', 'retry', 'token']);
  assert.deepEqual(frontmatter.connections, ['[[agent-friday]]', '[[outcome-1071]]']);
  assert.match(body, /# Body here/);
});

test('serializeFrontmatter roundtrips cleanly', () => {
  const fm = {
    id: 'pattern-test',
    type: 'pattern',
    brain: 'agent',
    created: '2026-05-25',
    relevance_keywords: ['a', 'b'],
    connections: ['[[x]]'],
  };
  const md = serializeFrontmatter(fm, '# body');
  const { frontmatter } = parseFrontmatter(md);
  assert.equal(frontmatter.id, fm.id);
  assert.deepEqual(frontmatter.relevance_keywords, fm.relevance_keywords);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/test_graph.js 2>&1 | head -20
```

Expected: `Error: Cannot find module '../tools/graph/graph-lib.js'`

- [ ] **Step 3: Implement graph-lib.js**

Create `tools/graph/graph-lib.js`:
```javascript
// graph-lib.js — core graph library, zero npm dependencies
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Graph structure ──────────────────────────────────────────────────────────

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

// ── Node / edge mutations (pure — return new graph) ─────────────────────────

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

// ── Weight updates ───────────────────────────────────────────────────────────

export function updateVisitCount(graph, source, target) {
  const edges = graph.edges.map(e => {
    if (e.source === source && e.target === target) {
      return { ...e, weights: { ...e.weights, _visit_raw: (e.weights._visit_raw || 0) + 1 } };
    }
    return e;
  });
  // renormalize all visit_counts across whole graph
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
      const clamped = Math.min(1.0, Math.max(0.0, parseFloat(raw.toFixed(4))));
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

// ── Graph maintenance ────────────────────────────────────────────────────────

export function pruneOrphanedEdges(graph) {
  const nodeSet = new Set(graph.nodes);
  const edges = graph.edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
  return { ...graph, edges };
}

// ── Frontmatter parsing ──────────────────────────────────────────────────────

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  return { frontmatter: parseYaml(match[1]), body: match[2] };
}

export function serializeFrontmatter(frontmatter, body) {
  return `---\n${toYaml(frontmatter)}---\n\n${body.trimStart()}`;
}

// ── Minimal YAML parser (handles our frontmatter subset only) ────────────────

function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // inline array: key: [a, b, c]
    const inlineArr = line.match(/^(\w+):\s+\[([^\]]*)\]\s*$/);
    if (inlineArr) {
      result[inlineArr[1]] = inlineArr[2].split(',').map(s => s.trim());
      i++; continue;
    }
    // block list start: key:
    const blockListStart = line.match(/^(\w+):\s*$/);
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
    // scalar: key: value
    const scalar = line.match(/^(\w+):\s+(.+)$/);
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
      // use block list for connections, inline for keywords
      if (k === 'connections') {
        return `${k}:\n${v.map(s => `  - "${s}"`).join('\n')}`;
      }
      return `${k}: [${v.join(', ')}]`;
    }
    return `${k}: ${v}`;
  }).join('\n') + '\n';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/test_graph.js 2>&1
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tools/graph/graph-lib.js tests/test_graph.js
git commit -m "feat(graph): core graph library with weighted edge model"
```

---

## Task 3: Repo brain population (`graph-init.js`)

**Files:**
- Create: `tools/graph/graph-init.js`
- Modify: `tests/test_graph_integration.sh`

- [ ] **Step 1: Write failing integration test**

Create `tests/test_graph_integration.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()   { echo "[PASS] $1"; ((PASS++)); }
fail() { echo "[FAIL] $1"; ((FAIL++)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_SLUG="test-graph-$(date +%s)"
NEXUS_DIR="$REPO_ROOT/nexus/$TEST_SLUG"

cleanup() { rm -rf "$NEXUS_DIR"; }
trap cleanup EXIT

echo "=== Test: graph-init creates repo brain ==="
node "$REPO_ROOT/tools/graph/graph-init.js" "$TEST_SLUG" "$REPO_ROOT" 2>/dev/null
[ -f "$NEXUS_DIR/graph.json" ] && ok "graph.json created" || fail "graph.json missing"
[ -d "$NEXUS_DIR/nodes" ]      && ok "nodes/ dir created" || fail "nodes/ dir missing"
[ -f "$NEXUS_DIR/INDEX.md" ]   && ok "INDEX.md created"   || fail "INDEX.md missing"

echo "=== Test: graph-init idempotent ==="
node "$REPO_ROOT/tools/graph/graph-init.js" "$TEST_SLUG" "$REPO_ROOT" 2>/dev/null
NODES_BEFORE=$(node -e "const g=JSON.parse(require('fs').readFileSync('$NEXUS_DIR/graph.json','utf8')); console.log(g.nodes.length)")
node "$REPO_ROOT/tools/graph/graph-init.js" "$TEST_SLUG" "$REPO_ROOT" 2>/dev/null
NODES_AFTER=$(node -e "const g=JSON.parse(require('fs').readFileSync('$NEXUS_DIR/graph.json','utf8')); console.log(g.nodes.length)")
[ "$NODES_BEFORE" = "$NODES_AFTER" ] && ok "idempotent: node count stable" || fail "idempotent: node count changed ($NODES_BEFORE -> $NODES_AFTER)"

echo "=== Test: graph-init creates hotfile nodes ==="
HOTFILES=$(ls "$NEXUS_DIR/nodes/hotfile-"* 2>/dev/null | wc -l)
[ "$HOTFILES" -gt 0 ] && ok "hotfile nodes created ($HOTFILES)" || fail "no hotfile nodes"

echo "=== Test: graph-init creates commit nodes ==="
COMMITS=$(ls "$NEXUS_DIR/nodes/commit-"* 2>/dev/null | wc -l)
[ "$COMMITS" -gt 0 ] && ok "commit nodes created ($COMMITS)" || fail "no commit nodes"

echo "=== Test: graph.json has valid structure ==="
node -e "
const g = JSON.parse(require('fs').readFileSync('$NEXUS_DIR/graph.json', 'utf8'));
if (g.version !== '1.0') process.exit(1);
if (g.brain !== 'repo') process.exit(1);
if (!Array.isArray(g.nodes)) process.exit(1);
if (!Array.isArray(g.edges)) process.exit(1);
console.log('valid');
" 2>/dev/null && ok "graph.json structure valid" || fail "graph.json invalid structure"

echo ""
echo "========================================"
printf "  PASSED: %d\n" $PASS
printf "  FAILED: %d\n" $FAIL
echo "========================================"
[ $FAIL -eq 0 ] && echo "RESULT: PASSED" && exit 0 || echo "RESULT: FAILED" && exit 1
```

```bash
chmod +x tests/test_graph_integration.sh
bash tests/test_graph_integration.sh
```

Expected: FAIL — `graph-init.js` not found.

- [ ] **Step 2: Implement graph-init.js**

Create `tools/graph/graph-init.js`:
```javascript
#!/usr/bin/env node
// graph-init.js — populate repo brain from git + file analysis
// Usage: node tools/graph/graph-init.js <project-slug> [repo-path]

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import {
  emptyGraph, readGraph, writeGraph,
  addNode, addEdge, pruneOrphanedEdges,
  recomputeComposite, serializeFrontmatter,
} from './graph-lib.js';

const slug = process.argv[2];
const repoPath = resolve(process.argv[3] || process.cwd());
if (!slug) { console.error('Usage: graph-init.js <project-slug> [repo-path]'); process.exit(1); }

const nexusDir = join(repoPath, 'nexus', slug);
const nodesDir = join(nexusDir, 'nodes');
const graphPath = join(nexusDir, 'graph.json');

mkdirSync(nodesDir, { recursive: true });

// Load or create graph
let graph = existsSync(graphPath) ? readGraph(graphPath) : emptyGraph('repo', slug);
graph = { ...graph, brain: 'repo', project_slug: slug };

const today = new Date().toISOString().slice(0, 10);

// ── Step 1: Commit nodes from git log ────────────────────────────────────────
function git(cmd) {
  try { return execSync(cmd, { cwd: repoPath, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }); }
  catch { return ''; }
}

const logRaw = git('git log --oneline --no-merges -50');
const commits = logRaw.trim().split('\n').filter(Boolean);

for (const line of commits) {
  const [hash, ...rest] = line.split(' ');
  const msg = rest.join(' ');
  const nodeId = `commit-${hash}`;
  if (!existsSync(join(nodesDir, `${nodeId}.md`))) {
    const body = `# Commit: ${hash}\n\n${msg}\n`;
    const fm = { id: nodeId, type: 'commit', brain: 'repo', created: today,
                 relevance_keywords: extractKeywords(msg), connections: [] };
    writeFileSync(join(nodesDir, `${nodeId}.md`), serializeFrontmatter(fm, body), 'utf8');
  }
  graph = addNode(graph, nodeId);
}

// ── Step 2: Hotfile nodes from git churn ─────────────────────────────────────
const statRaw = git('git log --name-only --no-merges --format="" -200');
const fileCounts = {};
for (const line of statRaw.trim().split('\n').filter(Boolean)) {
  if (line.trim()) fileCounts[line.trim()] = (fileCounts[line.trim()] || 0) + 1;
}
const maxCount = Math.max(...Object.values(fileCounts), 1);
const hotfiles = Object.entries(fileCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

for (const [filePath, count] of hotfiles) {
  const nodeId = `hotfile-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
  const churnScore = parseFloat((count / maxCount).toFixed(4));
  const fullPath = join(repoPath, filePath);
  const ext = extname(filePath).slice(1) || 'unknown';

  if (!existsSync(join(nodesDir, `${nodeId}.md`))) {
    const body = `# Hot File: ${filePath}\n\nChurn score: ${churnScore} (${count} changes)\nType: ${ext}\n`;
    const fm = { id: nodeId, type: 'hotfile', brain: 'repo', created: today,
                 churn_score: churnScore, path: filePath,
                 relevance_keywords: [filePath.split('/').pop(), ext], connections: [] };
    writeFileSync(join(nodesDir, `${nodeId}.md`), serializeFrontmatter(fm, body), 'utf8');
  }
  graph = addNode(graph, nodeId);
}

// ── Step 3: File nodes + semantic edges from import analysis ─────────────────
const SOURCE_EXTS = new Set(['.js', '.ts', '.py', '.ps1', '.sh', '.jsx', '.tsx']);
const IMPORT_RE = /(?:import|require|from)\s+['"]([^'"]+)['"]/g;

function scanFiles(dir, base) {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const fullPath = join(dir, e.name);
      if (e.isDirectory() && !['node_modules','.git','.claude','nexus'].includes(e.name))
        return scanFiles(fullPath, base);
      if (e.isFile() && SOURCE_EXTS.has(extname(e.name)))
        return [fullPath];
      return [];
    });
  } catch { return []; }
}

const sourceFiles = scanFiles(repoPath, repoPath);
const fileNodeMap = {}; // path → nodeId

for (const filePath of sourceFiles) {
  const rel = relative(repoPath, filePath);
  const nodeId = `file-${rel.replace(/[^a-zA-Z0-9]/g, '-')}`;
  fileNodeMap[filePath] = nodeId;
  graph = addNode(graph, nodeId);

  if (!existsSync(join(nodesDir, `${nodeId}.md`))) {
    const body = `# File: ${rel}\n\nPath: \`${rel}\`\n`;
    const fm = { id: nodeId, type: 'file', brain: 'repo', created: today,
                 path: rel, relevance_keywords: extractKeywords(rel), connections: [] };
    writeFileSync(join(nodesDir, `${nodeId}.md`), serializeFrontmatter(fm, body), 'utf8');
  }
}

// Add semantic edges between files that import each other
for (const filePath of sourceFiles) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const sourceId = fileNodeMap[filePath];
    let match;
    while ((match = IMPORT_RE.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        const resolved = resolve(join(filePath, '..'), importPath);
        for (const ext of ['', '.js', '.ts', '.jsx', '.tsx', '/index.js']) {
          const candidate = resolved + ext;
          if (fileNodeMap[candidate]) {
            graph = addEdge(graph, sourceId, fileNodeMap[candidate]);
            // Set semantic weight based on direct import (strong signal)
            const edge = graph.edges.find(e => e.source === sourceId && e.target === fileNodeMap[candidate]);
            if (edge) {
              edge.weights.semantic = 0.85;
              edge.composite = recomputeComposite(edge.weights);
            }
            break;
          }
        }
      }
    }
  } catch { /* skip unreadable files */ }
}

// ── Step 4: Co-change edges from git log ─────────────────────────────────────
const logFiles = git('git log --name-only --no-merges --format="COMMIT" -100');
let currentCommitFiles = [];
for (const line of logFiles.split('\n')) {
  if (line.trim() === 'COMMIT') {
    // add co-change edges for all pairs in this commit
    const nodeIds = currentCommitFiles
      .map(f => fileNodeMap[join(repoPath, f)])
      .filter(Boolean);
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        graph = addEdge(graph, nodeIds[i], nodeIds[j]);
        const edge = graph.edges.find(e =>
          (e.source === nodeIds[i] && e.target === nodeIds[j]) ||
          (e.source === nodeIds[j] && e.target === nodeIds[i])
        );
        if (edge) {
          edge.weights._co_raw = (edge.weights._co_raw || 0) + 1;
        }
      }
    }
    currentCommitFiles = [];
  } else if (line.trim()) {
    currentCommitFiles.push(line.trim());
  }
}

// Normalize co_change scores
const maxCoRaw = Math.max(...graph.edges.map(e => e.weights._co_raw || 0), 1);
for (const edge of graph.edges) {
  if (edge.weights._co_raw) {
    edge.weights.co_change = parseFloat(((edge.weights._co_raw || 0) / maxCoRaw).toFixed(4));
    edge.composite = recomputeComposite(edge.weights);
  }
}

// ── Step 5: Arch nodes from docs/ ────────────────────────────────────────────
const docsDir = join(repoPath, 'docs');
if (existsSync(docsDir)) {
  for (const file of readdirSync(docsDir).filter(f => f.startsWith('ADR') || f.match(/arch/i))) {
    const nodeId = `arch-${file.replace(/[^a-zA-Z0-9]/g, '-').replace(/\.md$/, '')}`;
    graph = addNode(graph, nodeId);
    if (!existsSync(join(nodesDir, `${nodeId}.md`))) {
      let body = '';
      try { body = readFileSync(join(docsDir, file), 'utf8'); } catch {}
      const fm = { id: nodeId, type: 'arch', brain: 'repo', created: today,
                   source_file: `docs/${file}`,
                   relevance_keywords: extractKeywords(file), connections: [] };
      writeFileSync(join(nodesDir, `${nodeId}.md`), serializeFrontmatter(fm, body), 'utf8');
    }
  }
}

// ── Step 6: Prune + write ────────────────────────────────────────────────────
graph = pruneOrphanedEdges(graph);
writeGraph(graphPath, graph);

// Write INDEX.md
const nodeCount = graph.nodes.length;
const edgeCount = graph.edges.length;
const indexContent = `# Repo Brain Index — ${slug}

Generated: ${today}
Nodes: ${nodeCount} | Edges: ${edgeCount}

## Node Types
- Commits: ${graph.nodes.filter(n => n.startsWith('commit-')).length}
- Files: ${graph.nodes.filter(n => n.startsWith('file-')).length}
- Hot files: ${graph.nodes.filter(n => n.startsWith('hotfile-')).length}
- Architecture: ${graph.nodes.filter(n => n.startsWith('arch-')).length}

## Top Edges by Composite Score
${graph.edges
  .sort((a, b) => b.composite - a.composite)
  .slice(0, 10)
  .map(e => `- \`${e.source}\` → \`${e.target}\` (${e.composite})`)
  .join('\n')}
`;
writeFileSync(join(nexusDir, 'INDEX.md'), indexContent, 'utf8');
console.log(`graph-init: ${nodeCount} nodes, ${edgeCount} edges → nexus/${slug}/`);

// ── Helpers ──────────────────────────────────────────────────────────────────
function extractKeywords(text) {
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['the','and','for','from','with'].includes(w))
      .slice(0, 6)
  )];
}
```

- [ ] **Step 3: Run integration tests**

```bash
bash tests/test_graph_integration.sh
```

Expected: all tests pass. Check output for node/edge counts.

- [ ] **Step 4: Commit**

```bash
git add tools/graph/graph-init.js tests/test_graph_integration.sh
git commit -m "feat(graph): graph-init populates repo brain from git + imports"
```

---

## Task 4: Query CLI (`graph-query.js`)

**Files:**
- Create: `tools/graph/graph-query.js`

- [ ] **Step 1: Write failing test**

Add to `tests/test_graph_integration.sh` (append before final summary block):
```bash
echo "=== Test: graph-query returns results ==="
QUERY_OUT=$(node "$REPO_ROOT/tools/graph/graph-query.js" "$TEST_SLUG" agent 2>/dev/null)
[ -n "$QUERY_OUT" ] && ok "graph-query returns output" || fail "graph-query returned nothing"

echo "=== Test: graph-query --json outputs valid JSON ==="
node "$REPO_ROOT/tools/graph/graph-query.js" "$TEST_SLUG" agent --json 2>/dev/null \
  | node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('ok')" \
  && ok "graph-query --json valid" || fail "graph-query --json invalid"
```

```bash
bash tests/test_graph_integration.sh
```

Expected: two new FAIL lines for graph-query.

- [ ] **Step 2: Implement graph-query.js**

Create `tools/graph/graph-query.js`:
```javascript
#!/usr/bin/env node
// graph-query.js — query graph by keywords, return top-N nodes by composite
// Usage: node tools/graph/graph-query.js <slug> <keyword...> [--top=N] [--json] [--brain-path=PATH]

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
if (!slug) { console.error('Usage: graph-query.js <slug> [keywords...] [--top=N] [--json] [--brain-path=PATH]'); process.exit(1); }

const topN = parseInt(flags.top || '10');
const jsonOut = !!flags.json;

// Determine brain path
let nexusDir;
if (flags['brain-path']) {
  nexusDir = resolve(flags['brain-path']);
} else {
  nexusDir = join(process.cwd(), 'nexus', slug);
}

const graphPath = join(nexusDir, 'graph.json');
if (!existsSync(graphPath)) {
  console.error(`No graph found at ${graphPath}. Run graph-init first.`);
  process.exit(1);
}

const graph = readGraph(graphPath);
const nodesDir = join(nexusDir, 'nodes');

// Score each node: composite of best edge + keyword match
const scored = graph.nodes.map(nodeId => {
  // Max composite score of any edge touching this node
  const edgeScore = graph.edges
    .filter(e => e.source === nodeId || e.target === nodeId)
    .reduce((max, e) => Math.max(max, e.composite), 0);

  // Keyword relevance from node file
  let keywordScore = 0;
  const nodePath = join(nodesDir, `${nodeId}.md`);
  if (existsSync(nodePath) && keywords.length > 0) {
    const { frontmatter, body } = parseFrontmatter(readFileSync(nodePath, 'utf8'));
    const haystack = [
      ...(frontmatter.relevance_keywords || []),
      nodeId,
      body,
    ].join(' ').toLowerCase();
    const matches = keywords.filter(kw => haystack.includes(kw.toLowerCase())).length;
    keywordScore = matches / keywords.length;
  }

  const score = keywords.length > 0
    ? (edgeScore * 0.4 + keywordScore * 0.6)
    : edgeScore;

  return { nodeId, score: parseFloat(score.toFixed(4)), edgeScore, keywordScore };
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
      console.log(`  ${r.nodeId.padEnd(50)} score=${r.score}`);
    }
  }
}
```

- [ ] **Step 3: Run tests**

```bash
bash tests/test_graph_integration.sh
```

Expected: all tests pass.

- [ ] **Step 4: Smoke test manually**

```bash
node tools/graph/graph-init.js agentsystem .
node tools/graph/graph-query.js agentsystem agent friday --top=5
```

Expected: top 5 nodes ranked by score.

- [ ] **Step 5: Commit**

```bash
git add tools/graph/graph-query.js tests/test_graph_integration.sh
git commit -m "feat(graph): graph-query CLI — keyword search + composite ranking"
```

---

## Task 5: Weight update CLI (`graph-weight.js`)

**Files:**
- Create: `tools/graph/graph-weight.js`

- [ ] **Step 1: Write failing test**

Add to `tests/test_graph_integration.sh`:
```bash
echo "=== Test: graph-weight visit increments visit_count ==="
# Get two connected nodes from the graph
EDGE=$(node -e "
const g=JSON.parse(require('fs').readFileSync('$NEXUS_DIR/graph.json','utf8'));
const e=g.edges[0]; if(e) console.log(e.source+' '+e.target);
" 2>/dev/null)
if [ -n "$EDGE" ]; then
  SRC=$(echo $EDGE | cut -d' ' -f1)
  TGT=$(echo $EDGE | cut -d' ' -f2)
  node "$REPO_ROOT/tools/graph/graph-weight.js" visit "$TEST_SLUG" "$SRC" "$TGT" 2>/dev/null
  RAW=$(node -e "
    const g=JSON.parse(require('fs').readFileSync('$NEXUS_DIR/graph.json','utf8'));
    const e=g.edges.find(e=>e.source==='$SRC'&&e.target==='$TGT');
    console.log(e.weights._visit_raw);
  " 2>/dev/null)
  [ "$RAW" -ge 1 ] && ok "visit_count raw incremented" || fail "visit_count not incremented"
else
  ok "no edges yet (skip visit test)"
fi

echo "=== Test: graph-weight confidence adjusts ==="
if [ -n "$EDGE" ]; then
  node "$REPO_ROOT/tools/graph/graph-weight.js" confidence "$TEST_SLUG" "$SRC" "$TGT" 0.1 2>/dev/null
  CONF=$(node -e "
    const g=JSON.parse(require('fs').readFileSync('$NEXUS_DIR/graph.json','utf8'));
    const e=g.edges.find(e=>e.source==='$SRC'&&e.target==='$TGT');
    console.log(e.weights.confidence);
  " 2>/dev/null)
  node -e "process.exit($CONF >= 0 && $CONF <= 1 ? 0 : 1)" && ok "confidence in [0,1]" || fail "confidence out of range"
fi
```

Run and expect FAIL.

- [ ] **Step 2: Implement graph-weight.js**

Create `tools/graph/graph-weight.js`:
```javascript
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
  console.log(`visit: ${source} → ${target} incremented`);
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
    content = content.replace(/^deprecated:.*$/m, '');
    content = content.replace(/^---\n/, `---\ndeprecated: true\n`);
    writeFileSync(nodePath, content, 'utf8');
  }
  console.log(`deprecated: ${nodeId}`);
}

writeGraph(graphPath, graph);
```

- [ ] **Step 3: Run tests**

```bash
bash tests/test_graph_integration.sh
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tools/graph/graph-weight.js tests/test_graph_integration.sh
git commit -m "feat(graph): graph-weight CLI — visit count, confidence, deprecate"
```

---

## Task 6: Initialize agent brain scaffold

**Files:**
- Create: `~/.claude/agent-memory/nexus/agent-brain/graph.json`
- Create: `~/.claude/agent-memory/nexus/agent-brain/INDEX.md`
- Create: `tools/graph/agent-brain-init.js`

- [ ] **Step 1: Write failing test**

Add to `tests/test_graph_integration.sh`:
```bash
echo "=== Test: agent brain scaffold exists ==="
AGENT_BRAIN="$HOME/.claude/agent-memory/nexus/agent-brain"
[ -f "$AGENT_BRAIN/graph.json" ] && ok "agent brain graph.json exists" || fail "agent brain graph.json missing — run agent-brain-init.js"
[ -f "$AGENT_BRAIN/INDEX.md" ]   && ok "agent brain INDEX.md exists"   || fail "agent brain INDEX.md missing"
```

Run: expect FAIL.

- [ ] **Step 2: Implement agent-brain-init.js**

Create `tools/graph/agent-brain-init.js`:
```javascript
#!/usr/bin/env node
// agent-brain-init.js — one-time setup of the agent brain scaffold
// Safe to re-run (idempotent)

import { existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { emptyGraph, writeGraph, addNode, serializeFrontmatter } from './graph-lib.js';

const brainDir = join(homedir(), '.claude', 'agent-memory', 'nexus', 'agent-brain');
const nodesDir = join(brainDir, 'nodes');
const graphPath = join(brainDir, 'graph.json');

mkdirSync(nodesDir, { recursive: true });

const today = new Date().toISOString().slice(0, 10);

// Create or load graph
let graph = existsSync(graphPath)
  ? JSON.parse(require('fs').readFileSync(graphPath, 'utf8'))  // use raw read to avoid import issues
  : emptyGraph('agent', 'global');

// Re-import properly
import { readGraph } from './graph-lib.js';  // already imported above

// Seed agent identity nodes for known agents
const AGENTS = ['jarvis', 'friday', 'sam', 'ultron', 'pym', 'leo', 'nat', 'wanda', 'astra', 'threepio', 'r2d2'];
for (const agent of AGENTS) {
  const nodeId = `agent-${agent}`;
  const nodePath = join(nodesDir, `${nodeId}.md`);
  if (!existsSync(nodePath)) {
    const fm = {
      id: nodeId, type: 'agent', brain: 'agent', created: today,
      relevance_keywords: [agent], connections: [],
    };
    const body = `# Agent: ${agent[0].toUpperCase() + agent.slice(1)}\n\nDomain: TBD\nAuthority: TBD\n`;
    writeFileSync(nodePath, serializeFrontmatter(fm, body), 'utf8');
  }
  graph = addNode(graph, nodeId);
}

writeGraph(graphPath, graph);

// Write INDEX.md
const indexContent = `# Agent Brain Index — Global

Initialized: ${today}
Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length}

## Purpose

Long-term agent memory. Compounds across all projects.
Repo brains decay; agent brain persists forever.

## Node Types
- Agent identity: ${graph.nodes.filter(n => n.startsWith('agent-')).length}
- Decision patterns: ${graph.nodes.filter(n => n.startsWith('pattern-')).length}
- Task outcomes: ${graph.nodes.filter(n => n.startsWith('outcome-')).length}
- Cross-domain: ${graph.nodes.filter(n => n.startsWith('xdomain-')).length}

## Usage

Query: \`node tools/graph/graph-query.js global <keywords> --brain-path=$HOME/.claude/agent-memory/nexus/agent-brain\`
Weight: \`node tools/graph/graph-weight.js confidence global <source> <target> <+0.1|-0.15>\`
`;
writeFileSync(join(brainDir, 'INDEX.md'), indexContent, 'utf8');
console.log(`agent-brain-init: ${graph.nodes.length} agent nodes → ${brainDir}`);
```

- [ ] **Step 3: Run agent-brain-init**

```bash
node tools/graph/agent-brain-init.js
```

Expected: `agent-brain-init: 11 nodes → C:/Users/natha/.claude/agent-memory/nexus/agent-brain`

- [ ] **Step 4: Run tests**

```bash
bash tests/test_graph_integration.sh
```

Expected: all tests pass including new agent brain tests.

- [ ] **Step 5: Run full test suite**

```bash
bash tests/test_memory_consistency.sh && bash tests/test_graph_integration.sh && node --test tests/test_graph.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tools/graph/agent-brain-init.js
git commit -m "feat(graph): agent-brain-init seeds global agent identity nodes"
```
