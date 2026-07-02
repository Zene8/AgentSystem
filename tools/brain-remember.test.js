import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFactToBrain, remember } from './brain-remember.js';
import { readGraph } from './graph/graph-lib.js';

const md = `# Brain

## Who I Am

- Solo founder

## Session Notes

- 2026-01-01: bootstrapped
`;

test('appendFactToBrain inserts under existing section', () => {
  const { md: out, added } = appendFactToBrain(md, 'prefers dark mode', 'Who I Am');
  assert.strictEqual(added, true);
  const lines = out.split('\n');
  const sec = lines.findIndex(l => l === '## Who I Am');
  assert.strictEqual(lines[sec + 2], '- Solo founder');
  assert.strictEqual(lines[sec + 3], '- prefers dark mode', 'appended after last bullet in section');
});

test('appendFactToBrain creates missing section', () => {
  const { md: out, added } = appendFactToBrain(md, 'uses Vim', 'Tools');
  assert.strictEqual(added, true);
  assert.match(out, /## Tools\n\n- uses Vim/);
});

test('appendFactToBrain dedups identical facts', () => {
  const { added } = appendFactToBrain(md, '- Solo founder', 'Who I Am');
  assert.strictEqual(added, false);
});

test('appendFactToBrain does not bleed into next section', () => {
  const { md: out } = appendFactToBrain(md, 'new fact', 'Who I Am');
  const lines = out.split('\n');
  const sNotes = lines.findIndex(l => l === '## Session Notes');
  assert.ok(lines.slice(0, sNotes).includes('- new fact'), 'fact stays in target section');
});

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
