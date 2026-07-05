import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProject, detectRepo, selectCoreFacts, relevantSona, agentTier, agentBrainNodes, buildSubagentContext } from './memory-context.js';
import { resolveRepoBrainDir, resolveRepoGraphPath } from './graph/graph-lib.js';
import { sep } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const reg = { repos: [
  { slug: 'agentsystem', path: 'C:/Users/natha/dev/AgentSystem' },
  { slug: 'basely', path: 'D:/Documents/DEV/Basely' },
  { slug: 'basely-brain', path: 'D:/Documents/DEV/basely-brain' },
] };

test('detectProject matches cwd inside a repo', () => {
  assert.strictEqual(detectProject('C:/Users/natha/dev/AgentSystem/tools', reg), 'agentsystem');
  assert.strictEqual(detectProject('C:\\Users\\natha\\dev\\AgentSystem', reg), 'agentsystem');
});

test('detectProject returns null outside any repo', () => {
  assert.strictEqual(detectProject('C:/Users/natha/Desktop', reg), null);
});

test('detectProject longest-prefix wins for nested-name repos', () => {
  assert.strictEqual(detectProject('D:/Documents/DEV/basely-brain/docs', reg), 'basely-brain');
});

test('detectRepo returns the full registry entry, not just the slug', () => {
  const repo = detectRepo('C:/Users/natha/dev/AgentSystem/tools', reg);
  assert.strictEqual(repo.slug, 'agentsystem');
  assert.strictEqual(repo.path, 'C:/Users/natha/dev/AgentSystem');
});

test('detectRepo returns null outside any repo', () => {
  assert.strictEqual(detectRepo('C:/Users/natha/Desktop', reg), null);
});

test('resolveRepoGraphPath uses brain_path when present (relative to repo.path)', () => {
  const repo = { slug: 'agentsystem', path: 'C:/Users/natha/dev/AgentSystem', brain_path: 'nexus/agentsystem/graph.json' };
  assert.strictEqual(resolveRepoBrainDir(repo), 'C:/Users/natha/dev/AgentSystem/nexus/agentsystem'.replace(/\//g, sep));
  assert.strictEqual(resolveRepoGraphPath(repo), 'C:/Users/natha/dev/AgentSystem/nexus/agentsystem/graph.json'.replace(/\//g, sep));
});

test('resolveRepoGraphPath falls back to nexus/<slug> when brain_path is absent', () => {
  const repo = { slug: 'basely', path: 'D:/Documents/DEV/Basely' };
  assert.strictEqual(resolveRepoGraphPath(repo), 'D:/Documents/DEV/Basely/nexus/basely/graph.json'.replace(/\//g, sep));
});

test('resolveRepoGraphPath/resolveRepoBrainDir return null when repo is null or has no path', () => {
  assert.strictEqual(resolveRepoBrainDir(null), null);
  assert.strictEqual(resolveRepoGraphPath(null), null);
  assert.strictEqual(resolveRepoBrainDir({ slug: 'x' }), null);
});

test('selectCoreFacts returns exactly N ids for N < total', () => {
  const facts = [
    { id: 'c', importance: 0.3 },
    { id: 'a', importance: 0.9 },
    { id: 'b', importance: 0.6 },
    { id: 'd', importance: 0.1 },
  ];
  const result = selectCoreFacts(facts, 2);
  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result, ['a', 'b']);
});

test('selectCoreFacts returns all when N >= total', () => {
  const facts = [{ id: 'x', importance: 0.5 }, { id: 'y', importance: 0.2 }];
  assert.strictEqual(selectCoreFacts(facts, 7).length, 2);
});

test('selectCoreFacts preserves descending importance order', () => {
  const facts = [
    { id: 'low', importance: 0.1 },
    { id: 'high', importance: 0.95 },
    { id: 'mid', importance: 0.5 },
  ];
  const result = selectCoreFacts(facts, 3);
  assert.deepStrictEqual(result, ['high', 'mid', 'low']);
});

test('selectCoreFacts does not mutate input array', () => {
  const facts = [{ id: 'a', importance: 0.1 }, { id: 'b', importance: 0.9 }];
  const original = [...facts];
  selectCoreFacts(facts, 7);
  assert.deepStrictEqual(facts, original);
});

// Part 2: relevantSona tests (stubbed scorer — no file IO)
const STUB_ENTRIES = [
  { id: 'auth-bug', text: 'auth bug oauth token session login', date: '2026-01-01', agent: 'Friday', raw: '' },
  { id: 'deploy-pipeline', text: 'deploy pipeline ci cd github actions docker', date: '2026-01-02', agent: 'Leo', raw: '' },
  { id: 'db-migration', text: 'database migration schema prisma postgres', date: '2026-01-03', agent: 'Pym', raw: '' },
  { id: 'frontend-harvest', text: 'react component harvest typescript frontend tsx', date: '2026-01-04', agent: 'Astra', raw: '' },
];

// Deterministic stub scorer: returns 1.0 if entry id matches the "winning" keyword, else 0.1
function makeStubScorer(winnerId) {
  return (entry) => entry.id === winnerId ? 1.0 : 0.1;
}

test('relevantSona: returns top entry by score (stubbed scorer)', () => {
  const results = relevantSona(STUB_ENTRIES, 'auth', { top: 1, scorer: makeStubScorer('auth-bug') });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0], 'auth-bug');
});

test('relevantSona: returns top-N entries in descending score order', () => {
  const scorer = (entry) => ({ 'db-migration': 0.9, 'deploy-pipeline': 0.7, 'auth-bug': 0.3, 'frontend-harvest': 0.1 }[entry.id] ?? 0);
  const results = relevantSona(STUB_ENTRIES, 'schema', { top: 2, scorer });
  assert.deepStrictEqual(results, ['db-migration', 'deploy-pipeline']);
});

test('relevantSona: empty entries returns []', () => {
  assert.deepStrictEqual(relevantSona([], 'auth', { scorer: makeStubScorer('x') }), []);
});

test('relevantSona: empty query returns []', () => {
  assert.deepStrictEqual(relevantSona(STUB_ENTRIES, '', { scorer: makeStubScorer('auth-bug') }), []);
  assert.deepStrictEqual(relevantSona(STUB_ENTRIES, '   ', { scorer: makeStubScorer('auth-bug') }), []);
});

test('relevantSona: top bounded to entry count when fewer entries than top', () => {
  const results = relevantSona(STUB_ENTRIES, 'any', { top: 10, scorer: () => 0.5 });
  assert.strictEqual(results.length, STUB_ENTRIES.length);
});

test('relevantSona: does not mutate entries input', () => {
  const entries = [...STUB_ENTRIES];
  relevantSona(entries, 'auth', { top: 2, scorer: makeStubScorer('auth-bug') });
  assert.strictEqual(entries.length, STUB_ENTRIES.length);
});

// Part 3: #120 — subagent memory tiering (agentTier, agentBrainNodes, buildSubagentContext)

test('agentTier: leads are jarvis/friday/sam/nat, case-insensitive', () => {
  assert.strictEqual(agentTier('Friday'), 'lead');
  assert.strictEqual(agentTier('sam'), 'lead');
  assert.strictEqual(agentTier('JARVIS'), 'lead');
  assert.strictEqual(agentTier('nat'), 'lead');
});

test('agentTier: everyone else (including unknown/empty) is a worker', () => {
  assert.strictEqual(agentTier('ultron'), 'worker');
  assert.strictEqual(agentTier('r2d2'), 'worker');
  assert.strictEqual(agentTier('threepio'), 'worker');
  assert.strictEqual(agentTier(''), 'worker');
  assert.strictEqual(agentTier(undefined), 'worker');
});

function makeFakeAgentBrain() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-brain-test-'));
  const nodesDir = join(dir, 'nodes');
  mkdirSync(nodesDir);
  writeFileSync(join(nodesDir, 'agent-friday.md'), '---\nid: agent-friday\ntype: agent\ncreated: 2026-06-21\n---\n# Agent: Friday\n');
  writeFileSync(join(nodesDir, 'manual-fact-a.md'), '---\nid: manual-fact-a\nagent: friday\ncreated: 2026-07-01\n---\n- fact a\n');
  writeFileSync(join(nodesDir, 'manual-fact-b.md'), '---\nid: manual-fact-b\nagent: friday\ncreated: 2026-07-03\n---\n- fact b\n');
  writeFileSync(join(nodesDir, 'manual-fact-other.md'), '---\nid: manual-fact-other\nagent: pym\ncreated: 2026-07-03\n---\n- unrelated\n');
  return dir;
}

test('agentBrainNodes: returns own identity node first, then matching manual facts by recency', () => {
  const dir = makeFakeAgentBrain();
  try {
    const ids = agentBrainNodes(dir, 'friday', 5);
    assert.strictEqual(ids[0], 'agent-friday');
    assert.ok(ids.includes('manual-fact-a'));
    assert.ok(ids.includes('manual-fact-b'));
    assert.ok(!ids.includes('manual-fact-other'));
    assert.strictEqual(ids.indexOf('manual-fact-b') < ids.indexOf('manual-fact-a'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agentBrainNodes: respects the n cap', () => {
  const dir = makeFakeAgentBrain();
  try {
    assert.strictEqual(agentBrainNodes(dir, 'friday', 1).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agentBrainNodes: returns [] for missing dir or empty agent name', () => {
  assert.deepStrictEqual(agentBrainNodes('C:/nonexistent-agent-brain-dir', 'friday'), []);
  assert.deepStrictEqual(agentBrainNodes('C:/nonexistent-agent-brain-dir', ''), []);
});

test('buildSubagentContext: worker tier never includes personal user facts', () => {
  const ctx = buildSubagentContext({ agent: 'r2d2', cwd: 'C:/nonexistent-cwd-xyz' });
  assert.strictEqual(ctx.tier, 'worker');
  assert.deepStrictEqual(ctx.userCore, []);
  assert.strictEqual(ctx.userTotal, 0);
  assert.ok(ctx.sona.length <= 1);
});

test('buildSubagentContext: lead tier is capped to at most 4 user facts', () => {
  const ctx = buildSubagentContext({ agent: 'friday', cwd: 'C:/nonexistent-cwd-xyz' });
  assert.strictEqual(ctx.tier, 'lead');
  assert.ok(ctx.userCore.length <= 4);
});
