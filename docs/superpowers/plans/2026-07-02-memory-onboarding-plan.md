# Unified Memory Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/onboard-memory` so a pasted block of text auto-classifies and routes each
extracted fact to the correct memory tier (personal-brain / a specific repo's brain / a specific
agent's brain) instead of always writing to personal-brain, and make link-building
(`wikilink-sync`) run synchronously on every write instead of waiting on the weekly cron.

**Architecture:** One new pure module (`memory-classify.js`, mirrors the existing
`memory-capture.js` shape) asks the LLM to output `{fact, tier, target}` instead of bare fact
strings. `brain-remember.js`'s `remember()` gains tier-aware write paths (repo/agent) alongside
its unchanged personal path, and calls `wikilink-sync`'s already-existing in-process functions
after every write. `memory-onboard.js` wires the two together and groups output by tier.

**Tech Stack:** Node.js (zero npm dependencies — builtins + this repo's own `graph-lib.js` only),
`node:test` for tests, `claude -p` subprocess for LLM calls (existing pattern, no API key).

## Global Constraints

- Zero npm dependencies. Pure Node builtins + imports from `tools/graph/graph-lib.js` only (repo
  rule for `tools/**`, from `CLAUDE.md`).
- All tests via `node:test` / `node:assert/strict`, run with `node --test <file>`.
- No input-side chunking of the pasted text — one LLM call over the whole blob (confirmed:
  pastes are small-medium, <5k words; see spec Non-goals).
- `--fact=` CLI mode stays LLM-free and personal-brain-only — unchanged contract.
- No changes to `graph-lib.js` primitives (BM25, decay, spreading activation, salience,
  confidence, reconciliation) — reused as-is.
- Delivery: direct commit to `main` via the worktree-branch-then-merge pattern already used
  earlier this session (no PR / no Sam audit) — user-confirmed, this repo's own internal tooling
  doesn't route through the full Standard Issue Workflow gate.
- **Path correction vs. the spec:** the spec said repo-brains live under
  `~/agent-memory/nexus/<repo>/`. Verified against `tools/graph/graph-init.js`'s actual code
  (`nexusDir = join(repoPath, 'nexus', slug)`) and this repo's own `.gitignore`
  (`nexus/agentsystem/`, `nexus/*/`, `nexus/`): repo-brains actually live **inside each repo's own
  working tree**, e.g. `<repo-path>/nexus/<slug>/graph.json`, gitignored. This plan implements the
  verified real path, not the spec's approximation — the spec's conclusion ("repo-brain tier is
  uninitialized here") still holds, just at the corrected path.
- **Repo-tier edge scope:** unlike agent-brain (which has one natural anchor node per agent,
  `agent-<name>`), a repo brain has no single natural anchor node to edge a manual fact against —
  it holds many `commit-*`/`file-*`/`hotfile-*` nodes with no obvious "the one node" to link to.
  This plan therefore does `addNode` only for repo-tier facts (no `addEdge`), and `addNode` +
  `addEdge` to `agent-<target>` for agent-tier facts. Both still get picked up by `wikilink-sync`
  once any future write creates a real edge to them — isolated nodes just show no backlinks yet,
  which is correct (there's nothing to link to).

---

### Task 1: `memory-classify.js` — classify+extract prompt and parser

**Files:**
- Create: `tools/memory-classify.js`
- Test: `tools/memory-classify.test.js`

**Interfaces:**
- Produces: `buildClassifyPrompt(text, { repos = [], agents = [] } = {}) → string`
- Produces: `parseClassifiedFacts(raw, { repos = [], agents = [] } = {}) → Array<{fact, tier, target}>`
  where `tier` is `'personal' | 'repo' | 'agent'`, `target` is `''` for `personal`.
- Produces: `AGENT_ROSTER` — exported `string[]` constant, the fixed agent name list.
- Consumes: nothing from other tasks (this task is a pure, standalone module).

- [ ] **Step 1: Write the failing tests**

Create `tools/memory-classify.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifyPrompt, parseClassifiedFacts, AGENT_ROSTER } from './memory-classify.js';

test('AGENT_ROSTER contains the known agent set', () => {
  for (const name of ['jarvis', 'friday', 'sam', 'nat', 'ultron', 'pym', 'leo', 'astra', 'wanda', 'threepio', 'r2d2']) {
    assert.ok(AGENT_ROSTER.includes(name), `missing ${name}`);
  }
});

test('buildClassifyPrompt embeds the supplied repo and agent lists', () => {
  const prompt = buildClassifyPrompt('some text', { repos: ['agentsystem', 'genie'], agents: ['friday'] });
  assert.match(prompt, /agentsystem/);
  assert.match(prompt, /genie/);
  assert.match(prompt, /friday/);
  assert.match(prompt, /some text/);
});

test('parseClassifiedFacts parses well-formed JSON lines', () => {
  const raw = [
    '{"fact": "prefers dark mode", "tier": "personal", "target": ""}',
    '{"fact": "AgentSystem always branches from dev", "tier": "repo", "target": "agentsystem"}',
    '{"fact": "Friday checks trust score before spawning", "tier": "agent", "target": "friday"}',
  ].join('\n');
  const out = parseClassifiedFacts(raw, { repos: ['agentsystem'], agents: ['friday'] });
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out[0], { fact: 'prefers dark mode', tier: 'personal', target: '' });
  assert.deepStrictEqual(out[1], { fact: 'AgentSystem always branches from dev', tier: 'repo', target: 'agentsystem' });
  assert.deepStrictEqual(out[2], { fact: 'Friday checks trust score before spawning', tier: 'agent', target: 'friday' });
});

test('parseClassifiedFacts returns [] for NONE', () => {
  assert.deepStrictEqual(parseClassifiedFacts('NONE', {}), []);
  assert.deepStrictEqual(parseClassifiedFacts('  none  ', {}), []);
});

test('parseClassifiedFacts skips malformed lines but keeps valid ones', () => {
  const raw = 'not json at all\n{"fact": "valid one", "tier": "personal", "target": ""}\n{broken';
  const out = parseClassifiedFacts(raw, {});
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].fact, 'valid one');
});

test('parseClassifiedFacts coerces an unknown repo target back to personal', () => {
  const raw = '{"fact": "some fact", "tier": "repo", "target": "not-a-real-repo"}';
  const out = parseClassifiedFacts(raw, { repos: ['agentsystem'], agents: [] });
  assert.deepStrictEqual(out[0], { fact: 'some fact', tier: 'personal', target: '' });
});

test('parseClassifiedFacts coerces an unknown agent target back to personal', () => {
  const raw = '{"fact": "some fact", "tier": "agent", "target": "not-a-real-agent"}';
  const out = parseClassifiedFacts(raw, { repos: [], agents: ['friday'] });
  assert.deepStrictEqual(out[0], { fact: 'some fact', tier: 'personal', target: '' });
});

test('parseClassifiedFacts coerces an invalid tier string back to personal', () => {
  const raw = '{"fact": "some fact", "tier": "bogus", "target": "x"}';
  const out = parseClassifiedFacts(raw, {});
  assert.deepStrictEqual(out[0], { fact: 'some fact', tier: 'personal', target: '' });
});

test('parseClassifiedFacts caps output at 8 facts', () => {
  const lines = Array.from({ length: 12 }, (_, i) => `{"fact": "fact ${i}", "tier": "personal", "target": ""}`);
  const out = parseClassifiedFacts(lines.join('\n'), {});
  assert.strictEqual(out.length, 8);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test tools/memory-classify.test.js`
Expected: FAIL — `Cannot find module './memory-classify.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement `tools/memory-classify.js`**

```js
#!/usr/bin/env node
// memory-classify.js — classify + extract facts from pasted text across memory tiers.
// Mirrors memory-capture.js's buildCapturePrompt/parseCaptureFacts shape, but the LLM
// also decides which memory tier (personal/repo/agent) each fact belongs to, given the
// known repo slugs and agent roster as context. Conservative by design: unknown/invalid
// tier or target always falls back to personal — never guesses a repo/agent that doesn't exist.

const MAX_FACTS = 8;
const VALID_TIERS = new Set(['personal', 'repo', 'agent']);

// Fixed roster — matches the agent set documented in ~/.claude/CLAUDE.md.
export const AGENT_ROSTER = [
  'jarvis', 'friday', 'sam', 'nat', 'ultron', 'pym', 'leo', 'astra', 'wanda', 'threepio', 'r2d2',
];

// Pure: build the classify+extract prompt for pasted text.
export function buildClassifyPrompt(text, { repos = [], agents = [] } = {}) {
  return [
    'You are a memory extraction + routing engine reading pasted text.',
    'Extract ONLY facts that are ALL of:',
    '  (a) durable — true beyond this session (preferences, decisions, stable context, corrections, patterns)',
    '  (b) specific — a concrete fact, not a task description or question',
    '  (c) high-precision — you are certain, not inferring',
    '',
    'EXCLUDE: one-off task details, speculation, ephemeral state.',
    `Cap: at most ${MAX_FACTS} facts. If none qualify, output exactly: NONE`,
    '',
    'For EACH fact, decide which memory tier it belongs to:',
    '  - "personal" — about the user themselves (identity, preferences, workflow, goals). Default when unsure.',
    `  - "repo" — a technical fact about ONE specific repo. target must be exactly one of: ${repos.join(', ') || '(none known)'}`,
    `  - "agent" — a learned pattern about ONE specific agent. target must be exactly one of: ${agents.join(', ') || '(none known)'}`,
    '',
    'Output ONLY one JSON object per line, no preamble, no explanation, no markdown fences:',
    '{"fact": "...", "tier": "personal", "target": ""}',
    '{"fact": "...", "tier": "repo", "target": "agentsystem"}',
    '{"fact": "...", "tier": "agent", "target": "friday"}',
    '',
    '--- TEXT START ---',
    text.slice(0, 8000),
    '--- TEXT END ---',
  ].join('\n');
}

// Pure: parse LLM output into { fact, tier, target } objects.
// Skips malformed lines. Coerces unknown/invalid tier or target back to personal.
export function parseClassifiedFacts(raw, { repos = [], agents = [] } = {}) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === 'NONE') return [];

  const repoSet = new Set(repos);
  const agentSet = new Set(agents);
  const out = [];

  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    let obj;
    try { obj = JSON.parse(l); } catch { continue; }
    if (!obj || typeof obj.fact !== 'string' || !obj.fact.trim()) continue;

    let tier = VALID_TIERS.has(obj.tier) ? obj.tier : 'personal';
    let target = typeof obj.target === 'string' ? obj.target.trim() : '';

    if (tier === 'repo' && !repoSet.has(target)) { tier = 'personal'; target = ''; }
    if (tier === 'agent' && !agentSet.has(target)) { tier = 'personal'; target = ''; }
    if (tier === 'personal') target = '';

    out.push({ fact: obj.fact.trim(), tier, target });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test tools/memory-classify.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/memory-classify.js tools/memory-classify.test.js
git commit -m "feat(memory): add memory-classify.js — extract + route facts across personal/repo/agent tiers"
```

---

### Task 2: `brain-remember.js` — tier-aware `remember()`

**Files:**
- Modify: `tools/brain-remember.js`
- Test: `tools/brain-remember.test.js` (extend)

**Interfaces:**
- Consumes: `readGraph`, `writeGraph`, `addNode`, `addEdge`, `emptyGraph`, `serializeFrontmatter`,
  `agentMemoryRoot`, `computeSalience` from `tools/graph/graph-lib.js` (all pre-existing exports,
  verified this session); `readRegistry`, `findRepo` from `tools/graph/known-repos.js`
  (pre-existing); `buildWikilinkMap`, `applyWikilinkMap` from `tools/graph/wikilink-sync.js`
  (pre-existing, already support being called as functions, not just CLI).
- Produces: `remember({ fact, section = 'Session Notes', llm, tier = 'personal', target = '' }) →
  { ok, added, action?, message?, id? }` — the `tier`/`target` params are new; omitting them
  reproduces today's exact personal-brain behavior (default `tier: 'personal'`).

- [ ] **Step 1: Write the failing tests**

Add to `tools/brain-remember.test.js` (below the existing `appendFactToBrain` tests — keep those
unchanged):

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFactToBrain, remember } from './brain-remember.js';
import { readGraph } from './graph/graph-lib.js';

// ── Tier routing tests ────────────────────────────────────────────────────────
// Uses AGENT_MEMORY_ROOT override (same pattern as memory-onboard.test.js) plus a
// temp fake repo directory so graph-init.js has somewhere real to write.

let fakeMemRoot, fakeRepoDir, prevMemRoot;

before(() => {
  fakeMemRoot = mkdtempSync(join(tmpdir(), 'br-test-mem-'));
  fakeRepoDir = mkdtempSync(join(tmpdir(), 'br-test-repo-'));

  const personalDir = join(fakeMemRoot, 'nexus', 'personal-brain');
  mkdirSync(personalDir, { recursive: true });
  writeFileSync(join(personalDir, 'user-brain.md'), '# Brain\n\n## Session Notes\n\n');

  const nexusDir = join(fakeMemRoot, 'nexus');
  mkdirSync(nexusDir, { recursive: true });
  writeFileSync(join(nexusDir, 'known-repos.json'), JSON.stringify({
    version: '1.0',
    repos: [{
      slug: 'fakerepo', path: fakeRepoDir, brain_path: 'nexus/fakerepo/graph.json',
      last_init: '2026-07-02', primary_cli: 'claude', bootstrap_complete: false,
    }],
  }, null, 2));

  const agentBrainDir = join(nexusDir, 'agent-brain');
  const agentNodesDir = join(agentBrainDir, 'nodes');
  mkdirSync(agentNodesDir, { recursive: true });
  writeFileSync(join(agentBrainDir, 'graph.json'), JSON.stringify({
    version: '1.0', brain: 'agent', project_slug: 'agent-brain', nodes: ['agent-friday'], edges: [],
  }, null, 2));
  writeFileSync(join(agentNodesDir, 'agent-friday.md'), '---\nid: agent-friday\ntype: agent-identity\n---\n\n# Friday\n');

  prevMemRoot = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = fakeMemRoot;
});

after(() => {
  process.env.AGENT_MEMORY_ROOT = prevMemRoot;
  rmSync(fakeMemRoot, { recursive: true, force: true });
  rmSync(fakeRepoDir, { recursive: true, force: true });
});

test('remember() tier=repo auto-inits the repo brain and writes a node', () => {
  const r = remember({ fact: 'always branch from dev', section: 'Session Notes', tier: 'repo', target: 'fakerepo' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, true);

  const graphPath = join(fakeRepoDir, 'nexus', 'fakerepo', 'graph.json');
  assert.ok(existsSync(graphPath), 'graph-init should have created graph.json');
  const graph = readGraph(graphPath);
  assert.ok(graph.nodes.some(n => n.startsWith('manual-')), 'a manual fact node should exist');
});

test('remember() tier=repo is idempotent on an identical second call', () => {
  const first = remember({ fact: 'second call test fact', section: 'Session Notes', tier: 'repo', target: 'fakerepo' });
  const second = remember({ fact: 'second call test fact', section: 'Session Notes', tier: 'repo', target: 'fakerepo' });
  assert.strictEqual(first.added, true);
  assert.strictEqual(second.added, false, 'identical fact should not create a duplicate node');
});

test('remember() tier=repo with an unregistered target fails with a clear message', () => {
  const r = remember({ fact: 'orphan fact', section: 'Session Notes', tier: 'repo', target: 'doesnotexist' });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /registered but path missing|not found/i);
});

test('remember() tier=agent edges the fact node to the agent identity node', () => {
  const r = remember({ fact: 'friday always checks trust score before spawning ultron', section: 'Session Notes', tier: 'agent', target: 'friday' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, true);

  const graphPath = join(fakeMemRoot, 'nexus', 'agent-brain', 'graph.json');
  const graph = readGraph(graphPath);
  const factNode = graph.nodes.find(n => n.startsWith('manual-'));
  assert.ok(factNode, 'a manual fact node should exist');
  assert.ok(
    graph.edges.some(e => (e.source === 'agent-friday' && e.target === factNode) || (e.source === factNode && e.target === 'agent-friday')),
    'fact node should be edged to agent-friday'
  );
});

test('remember() tier=personal (default) still works exactly as before and now runs split', () => {
  const r = remember({ fact: 'a personal preference for the tier-default test', section: 'Session Notes' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, true);
  assert.strictEqual(r.split.ok, true, 'personal-brain-split should still run on the personal path');
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `node --test tools/brain-remember.test.js`
Expected: the 4 existing `appendFactToBrain` tests PASS (unchanged); the 5 new tier-routing tests
FAIL — `remember()` doesn't accept `tier`/`target` yet, so repo/agent writes silently land in
`user-brain.md` instead and the graph.json assertions fail with `ENOENT` or missing nodes.

- [ ] **Step 3: Implement tier routing in `tools/brain-remember.js`**

Replace the whole file with:

```js
#!/usr/bin/env node
// brain-remember.js — agent-driven write-back (MemGPT-style self-edit).
// Agents call this when they learn a durable fact. Routes to one of three tiers:
//   - personal (default): user-brain.md → splitPersonalBrain() → personal-brain/nodes/*.md
//   - repo:    <repo-path>/nexus/<slug>/graph.json (auto-inits via graph-init.js on first use)
//   - agent:   ~/agent-memory/nexus/agent-brain/graph.json, edged to agent-<name>
// All three tiers sync wikilinks immediately after every write (no weekly-cron wait).
// Usage: node tools/brain-remember.js --fact="..." [--section="..."] [--tier=repo --target="agentsystem"]

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  agentMemoryRoot, computeSalience,
  addNode, addEdge, readGraph, writeGraph, emptyGraph, serializeFrontmatter,
} from './graph/graph-lib.js';
import { splitPersonalBrain } from './personal-brain-split.js';
import { reconcileFact, defaultLlm } from './memory-reconcile.js';
import { readRegistry, findRepo } from './graph/known-repos.js';
import { buildWikilinkMap, applyWikilinkMap } from './graph/wikilink-sync.js';

const GRAPH_INIT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'graph', 'graph-init.js');

// Shared slug logic — matches personal-brain-split.js's slugify() exactly (same regex),
// kept local here since it's also needed for repo/agent node ids and salience stamping.
function slugifyFact(text) {
  return text.replace(/^[-*]\s*/, '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').trim()
    .split(/\s+/).slice(0, 8).join('-');
}

// Stamp salience onto a node file written by splitPersonalBrain.
// Non-fatal: if the node file is absent (slug mismatch etc.) we silently skip.
function stampSalience(fact, action) {
  const id = slugifyFact(fact);
  if (!id) return;
  const nodePath = join(agentMemoryRoot(), 'nexus', 'personal-brain', 'nodes', `${id}.md`);
  if (!existsSync(nodePath)) return;
  try {
    const raw = readFileSync(nodePath, 'utf8');
    const presolveConfidence = action === 'UPDATE' ? 0.5 : 0.1;
    const salience = computeSalience({ firstTimeSolve: action === 'ADD', presolveConfidence });
    if (raw.includes('\nsalience:')) return;
    const stamped = raw.replace(/^---\n/, `---\nsalience: ${salience}\n`);
    writeFileSync(nodePath, stamped, 'utf8');
  } catch {
    // Non-fatal: salience stamping never blocks fact persistence.
  }
}

// Non-fatal: link sync never blocks fact persistence (mirrors stampSalience's contract).
function syncWikilinks(brainDir) {
  try {
    const graphPath = join(brainDir, 'graph.json');
    if (!existsSync(graphPath)) return;
    const graph = readGraph(graphPath);
    const map = buildWikilinkMap(graph);
    applyWikilinkMap(map, join(brainDir, 'nodes'));
  } catch {
    // Non-fatal.
  }
}

// Resolve (and auto-init if missing) the on-disk location of a repo's brain.
// Returns null if the slug isn't registered or its registered path no longer exists.
function ensureRepoGraph(slug) {
  const registryPath = join(agentMemoryRoot(), 'nexus', 'known-repos.json');
  const registry = readRegistry(registryPath);
  const repo = findRepo(registry, slug);
  if (!repo || !existsSync(repo.path)) return null;

  const nexusDir = join(repo.path, 'nexus', slug);
  const graphPath = join(nexusDir, 'graph.json');
  if (!existsSync(graphPath)) {
    try {
      execFileSync(process.execPath, [GRAPH_INIT_PATH, slug, repo.path], { stdio: 'pipe', timeout: 60000 });
    } catch {
      // Non-fatal: even if graph-init fails (e.g. not a git repo), fall through —
      // the caller still gets a writable target for the manual fact via emptyGraph().
    }
  }
  return { nexusDir, graphPath, nodesDir: join(nexusDir, 'nodes') };
}

// tier: 'repo' — addNode only (no natural single anchor node to edge against; see plan's
// Global Constraints for why this differs from the agent-tier path).
function writeRepoFact({ fact, section, target }) {
  const loc = ensureRepoGraph(target);
  if (!loc) return { ok: false, added: false, message: `repo '${target}' registered but path missing — skipped` };

  const id = `manual-${slugifyFact(fact)}`;
  let graph = existsSync(loc.graphPath) ? readGraph(loc.graphPath) : emptyGraph('repo', target);
  const isNew = !graph.nodes.includes(id);
  graph = addNode(graph, id);

  mkdirSync(loc.nodesDir, { recursive: true });
  const nodeFile = join(loc.nodesDir, `${id}.md`);
  if (!existsSync(nodeFile)) {
    const today = new Date().toISOString().slice(0, 10);
    const fm = {
      id, type: 'manual-fact', brain: 'repo', source: 'manual-onboard',
      created: today, source_section: section, connections: [],
    };
    writeFileSync(nodeFile, serializeFrontmatter(fm, `- ${fact}`), 'utf8');
  }

  writeGraph(loc.graphPath, graph);
  syncWikilinks(loc.nexusDir);
  return { ok: true, added: isNew, action: isNew ? 'ADD' : 'NOOP', id };
}

// tier: 'agent' — addNode + addEdge to the existing agent-<target> identity node.
function writeAgentFact({ fact, section, target }) {
  const brainDir = join(agentMemoryRoot(), 'nexus', 'agent-brain');
  const graphPath = join(brainDir, 'graph.json');
  const nodesDir = join(brainDir, 'nodes');
  const agentNodeId = `agent-${target}`;

  let graph = existsSync(graphPath) ? readGraph(graphPath) : emptyGraph('agent', 'agent-brain');
  const id = `manual-${slugifyFact(fact)}`;
  const isNew = !graph.nodes.includes(id);
  graph = addNode(graph, id);
  if (graph.nodes.includes(agentNodeId)) graph = addEdge(graph, agentNodeId, id);

  mkdirSync(nodesDir, { recursive: true });
  const nodeFile = join(nodesDir, `${id}.md`);
  if (!existsSync(nodeFile)) {
    const today = new Date().toISOString().slice(0, 10);
    const fm = {
      id, type: 'manual-fact', brain: 'agent-brain', source: 'manual-onboard',
      created: today, source_section: section, agent: target, connections: [],
    };
    writeFileSync(nodeFile, serializeFrontmatter(fm, `- ${fact}`), 'utf8');
  }

  writeGraph(graphPath, graph);
  syncWikilinks(brainDir);
  return { ok: true, added: isNew, action: isNew ? 'ADD' : 'NOOP', id };
}

// Pure: insert a fact bullet under `section` in markdown `raw`.
// Dedup: skips if the same fact text already exists (case-insensitive). Creates section if missing.
// Returns { md, added }.
export function appendFactToBrain(raw, fact, section = 'Session Notes') {
  const clean = fact.replace(/^[-*]\s*/, '').trim();
  if (!clean) return { md: raw, added: false };
  const bullet = `- ${clean}`;

  const lines = raw.split('\n');
  const norm = s => s.replace(/^[-*]\s*/, '').trim().toLowerCase();
  if (lines.some(l => norm(l) === norm(bullet))) return { md: raw, added: false };

  const headerIdx = lines.findIndex(l => {
    const m = l.match(/^#{1,3}\s+(.+?)\s*$/);
    return m && m[1].toLowerCase() === section.toLowerCase();
  });

  if (headerIdx === -1) {
    const tail = raw.endsWith('\n') ? '' : '\n';
    return { md: `${raw}${tail}\n## ${section}\n\n${bullet}\n`, added: true };
  }

  let end = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^#{1,3}\s+/.test(lines[i])) { end = i; break; }
  }
  let insertAt = headerIdx + 1;
  for (let i = headerIdx + 1; i < end; i++) {
    if (lines[i].trim() !== '') insertAt = i + 1;
  }
  lines.splice(insertAt, 0, bullet);
  return { md: lines.join('\n'), added: true };
}

export function remember({ fact, section = 'Session Notes', llm, tier = 'personal', target = '' } = {}) {
  if (!fact) return { ok: false, message: 'no fact provided', added: false };

  if (tier === 'repo') return writeRepoFact({ fact, section, target });
  if (tier === 'agent') return writeAgentFact({ fact, section, target });

  // tier === 'personal' (default) — unchanged behavior, now also syncs wikilinks.
  const brainPath = join(agentMemoryRoot(), 'nexus', 'personal-brain', 'user-brain.md');
  if (!existsSync(brainPath)) return { ok: false, message: 'user-brain.md not found', added: false };

  const raw = readFileSync(brainPath, 'utf8');
  const { md, action, supersededText } = reconcileFact(raw, fact, section, { llm: llm ?? defaultLlm });
  if (action === 'NOOP') return { ok: true, added: false, action: 'NOOP', message: 'already known (deduped)' };

  writeFileSync(brainPath, md, 'utf8');
  const split = splitPersonalBrain();
  stampSalience(fact, action);
  syncWikilinks(join(agentMemoryRoot(), 'nexus', 'personal-brain'));
  return { ok: true, added: true, action, section, supersededText, split, salience: true };
}

const isMain = process.argv[1] &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const args = process.argv.slice(2);
  const flags = {};
  for (const a of args) {
    const m = a.match(/^--([\w-]+)=(.*)$/);
    if (m) flags[m[1]] = m[2];
  }
  if (!flags.fact) {
    console.error('Usage: brain-remember.js --fact="..." [--section="..."] [--tier=repo|agent --target="..."]');
    process.exit(1);
  }
  const r = remember({ fact: flags.fact, section: flags.section, tier: flags.tier, target: flags.target });
  if (!r.ok) { console.error(`brain-remember: ${r.message}`); process.exit(1); }
  const tierLabel = flags.tier && flags.tier !== 'personal' ? `${flags.tier}:${flags.target}` : (flags.section || 'Session Notes');
  console.log(r.added ? `remembered → [${tierLabel}]: ${flags.fact}` : `brain-remember: ${r.message || 'no-op'}`);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test tools/brain-remember.test.js`
Expected: PASS, all 9 tests (4 original `appendFactToBrain` + 5 new tier-routing).

- [ ] **Step 5: Commit**

```bash
git add tools/brain-remember.js tools/brain-remember.test.js
git commit -m "feat(memory): remember() routes to repo/agent brains, syncs wikilinks on every write"
```

---

### Task 3: `memory-onboard.js` — wire classify+route into the onboarding flow

**Files:**
- Modify: `tools/memory-onboard.js`
- Modify: `tools/memory-onboard.test.js:92-110` (existing stub-LLM test uses the old bullet
  format — must be updated to JSON-line format or it breaks)

**Interfaces:**
- Consumes: `buildClassifyPrompt`, `parseClassifiedFacts`, `AGENT_ROSTER` from Task 1's
  `tools/memory-classify.js`; `agentMemoryRoot` from `tools/graph/graph-lib.js`; `readRegistry`
  from `tools/graph/known-repos.js`; `remember` from Task 2's updated `tools/brain-remember.js`
  (now accepts `tier`/`target`).
- Produces: `extractAndRemember(text, { section, llm }) → { ok, extracted, written, byTier,
  warnings }` — `written` is now `Array<{fact, tier, target}>` (was `string[]`); `byTier` is
  `{ personal: n, repo: n, agent: n }`; `warnings` is `string[]`.

- [ ] **Step 1: Update the test that will break, and add new ones**

In `tools/memory-onboard.test.js`, replace the existing stub-LLM test (currently around line 92)
with the JSON-line format the new parser expects, and add a multi-tier assertion:

```js
test('extractAndRemember with stub LLM that returns classified JSON-line facts', () => {
  resetBrain();

  const prev = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = fakeMemRoot;

  const stubLlm = () => [
    '{"fact": "prefers dark mode", "tier": "personal", "target": ""}',
    '{"fact": "deploys to Railway", "tier": "personal", "target": ""}',
  ].join('\n');
  const result = extractAndRemember('some prompt text', {
    section: 'Session Notes',
    llm: stubLlm,
  });

  process.env.AGENT_MEMORY_ROOT = prev;

  assert.strictEqual(result.ok, true);
  assert.ok(result.extracted >= 1, `expected >=1 extracted facts, got ${result.extracted}`);
  assert.ok(result.byTier.personal >= 1);
});

test('extractAndRemember groups mixed-tier facts into byTier counts', () => {
  resetBrain();

  const prev = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = fakeMemRoot;

  // No repos/agents are registered in this fixture's known-repos.json, so a repo/agent
  // classification the LLM emits gets coerced back to personal by parseClassifiedFacts —
  // this test asserts that coercion, not a successful repo/agent write (that's covered
  // in brain-remember.test.js with a real fixture repo).
  const stubLlm = () => [
    '{"fact": "prefers dark mode", "tier": "personal", "target": ""}',
    '{"fact": "some repo fact", "tier": "repo", "target": "nonexistent-repo"}',
  ].join('\n');
  const result = extractAndRemember('some prompt text', { section: 'Session Notes', llm: stubLlm });

  process.env.AGENT_MEMORY_ROOT = prev;

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.byTier.repo, 0, 'unregistered repo target should be coerced to personal, not counted as repo');
  assert.ok(result.byTier.personal >= 1);
});
```

- [ ] **Step 2: Run tests, verify the updated/new ones fail**

Run: `node --test tools/memory-onboard.test.js`
Expected: FAIL on both tests above — `extractAndRemember` still uses `buildCapturePrompt`/
`parseCaptureFacts` (bullet format), so feeding JSON-line stub output through the old bullet
parser extracts 0 facts.

- [ ] **Step 3: Update `tools/memory-onboard.js`**

Change the imports (near the top):

```js
import { remember } from './brain-remember.js';
import { buildClassifyPrompt, parseClassifiedFacts, AGENT_ROSTER } from './memory-classify.js';
import { agentMemoryRoot } from './graph/graph-lib.js';
import { readRegistry } from './graph/known-repos.js';
```

(This replaces the old `import { buildCapturePrompt, parseCaptureFacts } from './memory-capture.js';` line.)

Replace `extractAndRemember` and `printResult`:

```js
export function extractAndRemember(text, { section = 'Session Notes', llm = defaultLlm } = {}) {
  if (!text || !text.trim()) return { ok: true, extracted: 0, written: [], byTier: { personal: 0, repo: 0, agent: 0 }, warnings: [] };

  const registryPath = join(agentMemoryRoot(), 'nexus', 'known-repos.json');
  const repos = readRegistry(registryPath).repos.map(r => r.slug);

  const prompt = buildClassifyPrompt(text, { repos, agents: AGENT_ROSTER });
  let raw;
  try { raw = llm(prompt); }
  catch (e) { return { ok: false, message: `llm failed: ${e.message}`, written: [] }; }

  const classified = parseClassifiedFacts(raw, { repos, agents: AGENT_ROSTER });
  const written = [];
  const byTier = { personal: 0, repo: 0, agent: 0 };
  const warnings = [];

  for (const { fact, tier, target } of classified) {
    try {
      const r = remember({ fact, section, tier, target });
      if (r.ok && r.added) { written.push({ fact, tier, target }); byTier[tier]++; }
      else if (!r.ok) { warnings.push(r.message); }
    } catch (e) {
      warnings.push(`${fact}: ${e.message}`);
    }
  }
  return { ok: true, extracted: classified.length, written, byTier, warnings };
}
```

```js
function printResult(result) {
  if (!result.ok) { console.error(`memory-onboard: ${result.message}`); return; }
  if (result.extracted === 0) { console.log('no durable facts extracted'); return; }

  const parts = [];
  if (result.byTier.personal) parts.push(`${result.byTier.personal} → personal-brain`);
  if (result.byTier.repo) parts.push(`${result.byTier.repo} → repo`);
  if (result.byTier.agent) parts.push(`${result.byTier.agent} → agent`);

  console.log(`extracted ${result.extracted} candidate(s), stored ${result.written.length} new fact(s): ${parts.join(', ')}`);
  for (const w of result.written) console.log(`  + [${w.tier}${w.target ? ':' + w.target : ''}] ${w.fact}`);
  const skipped = result.extracted - result.written.length;
  if (skipped > 0) console.log(`  (${skipped} already known or skipped)`);
  for (const w of (result.warnings || [])) console.log(`  ! ${w}`);
}
```

No other changes needed in this file — `--fact=` mode (Mode 1 in the CLI block) already bypasses
`extractAndRemember` entirely and stays untouched, matching the spec's Non-goals.

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test tools/memory-onboard.test.js`
Expected: PASS, all tests (the two updated/new ones plus every pre-existing `--fact=`/`--text=`/
`--session=`/stdin/help test, which don't touch the classify path and are unaffected).

- [ ] **Step 5: Commit**

```bash
git add tools/memory-onboard.js tools/memory-onboard.test.js
git commit -m "feat(memory): wire memory-classify into /onboard-memory, route facts by tier"
```

---

### Task 4: Update `/onboard-memory` command docs and sync

**Files:**
- Modify: `.agents/commands/onboard-memory.md`

**Interfaces:**
- Consumes: nothing (doc-only).
- Produces: nothing consumed by other tasks — this is the last content change before manual
  verification.

- [ ] **Step 1: Update the command doc's behavior description**

In `.agents/commands/onboard-memory.md`, after the `## Your task` heading's mode list, add a note
(the file already exists from earlier in this session with corrected `~/dev/AgentSystem` paths —
only the behavior note is new):

```markdown
**Note on routing (as of 2026-07-02):** text/session/stdin modes now auto-classify each
extracted fact across three tiers — personal-brain (default), a specific repo's brain, or a
specific agent's brain — based on what the fact is actually about. No flag needed; this is
automatic. `--fact=` mode is unaffected: it always writes personal-brain directly, no LLM
classification (that's the point of `--fact=` — a fast manual write).
```

Place it directly under the existing `**If no args given:**` block, before the final "After
running, report..." line.

- [ ] **Step 2: Sync the updated command to `~/.claude/commands/`**

Run: `node ~/dev/AgentSystem/tools/sync-agents.js`
Expected output includes: `[SUCCESS] Command: onboard-memory.md -> C:\Users\natha\.claude\commands`
(this sync path was added earlier this session — confirm it's still wired, don't re-add it).

- [ ] **Step 3: Verify the live copy updated**

Run: `grep -n "auto-classify" ~/.claude/commands/onboard-memory.md`
Expected: prints the new note's line — confirms the sync actually overwrote the live file, not
just the repo source.

- [ ] **Step 4: Commit**

```bash
git add .agents/commands/onboard-memory.md
git commit -m "docs(onboard-memory): note auto-classify routing behavior"
```

---

### Task 5: End-to-end verification and ship

**Files:** none (verification only, then delivery).

- [ ] **Step 1: Run the full test suite**

Run: `node --test tools/memory-classify.test.js tools/brain-remember.test.js tools/memory-onboard.test.js`
Expected: PASS, zero failures across all three files.

- [ ] **Step 2: Manual multi-tier verification (per spec's Testing section)**

From a real (non-test) shell, with the real `~/agent-memory` and a real registered repo (e.g.
`agentsystem`, once its repo brain has been auto-inited by this feature the first time it's used):

```bash
node ~/dev/AgentSystem/tools/memory-onboard.js --text="I always use dark mode in my editor. In the AgentSystem repo we always branch off dev, never main. Friday should always check the trust score before spawning Ultron."
```

Expected: output shows a 3-way split, e.g.
`extracted 3 candidate(s), stored 3 new fact(s): 1 → personal-brain, 1 → repo, 1 → agent`,
followed by one `+ [tier:target] fact` line per fact. Then confirm all three landed:

```bash
cat ~/agent-memory/nexus/personal-brain/nodes/*dark-mode*.md
cat ~/dev/AgentSystem/nexus/agentsystem/graph.json | grep manual-
cat ~/agent-memory/nexus/agent-brain/graph.json | grep -A2 agent-friday
```

Expected: the personal-brain node file exists; the repo graph.json has a `manual-*` node; the
agent-brain graph.json shows an edge between `agent-friday` and a `manual-*` node — and this all
happened in the one command above, not after next Monday's cron.

- [ ] **Step 3: Push to main (direct-commit delivery, per user's confirmed choice)**

If this plan was executed inside a worktree (per this repo's background-session isolation guard),
merge it back:

```bash
git -C ~/dev/AgentSystem merge <worktree-branch-name> --no-edit
git -C ~/dev/AgentSystem push origin main
```

If executed directly on `main` in a non-background session, the five commits from Tasks 1-4 are
already on `main` — just push:

```bash
git -C ~/dev/AgentSystem push origin main
```

- [ ] **Step 4: Report the shipped state**

Summarize for the user: which tiers were exercised in the manual check, the final commit range,
and the known current limitation carried over from the spec — most repos in `known-repos.json`
still have stale WSL-era `path` fields, so repo-tier onboarding will hit the "path missing"
warning for any repo other than the one whose path happens to still be valid on this machine.
That's a separate, already-identified cleanup (not part of this feature) — flag it, don't fix it
here.

---

## Self-review notes (fixed inline before finalizing)

- **Spec coverage:** every component in the spec (`memory-classify.js`, tier-aware `remember()`,
  synchronous `wikilink-sync` call, auto-init on first repo write, `/onboard-memory` wiring,
  `--fact=` untouched) maps to a task above. The two Global-Constraints corrections (repo-brain
  path location; repo-tier has no edge target) are refinements discovered while reading the
  actual source, not new scope — both are called out explicitly rather than silently diverging
  from the approved spec.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type/signature consistency:** `remember()`'s new `{tier, target}` params, `writeRepoFact`/
  `writeAgentFact`'s return shape (`{ok, added, action, id}` / `{ok, added, message}`), and
  `extractAndRemember`'s new `{ok, extracted, written, byTier, warnings}` return shape are used
  identically across Task 2's and Task 3's code — checked by re-reading both blocks side by side.
