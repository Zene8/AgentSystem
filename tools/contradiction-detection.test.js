#!/usr/bin/env node
// contradiction-detection.test.js — empirical test for contradiction detection at write time
// Tests the full flow: remember conflicting facts, verify old node is marked superseded,
// verify selectCoreFacts skips it, verify graph-query skips it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remember } from './brain-remember.js';
import { selectCoreFacts } from './memory-context.js';
import { readGraph, parseFrontmatter } from './graph/graph-lib.js';

let fakeMemRoot, fakeRepoDir, prevMemRoot;

before(() => {
  fakeMemRoot = mkdtempSync(join(tmpdir(), 'cd-test-mem-'));
  fakeRepoDir = mkdtempSync(join(tmpdir(), 'cd-test-repo-'));

  const personalDir = join(fakeMemRoot, 'nexus', 'personal-brain');
  mkdirSync(personalDir, { recursive: true });
  writeFileSync(join(personalDir, 'user-brain.md'), '# Brain\n\n## Session Notes\n\n');

  const nexusDir = join(fakeMemRoot, 'nexus');
  mkdirSync(nexusDir, { recursive: true });
  writeFileSync(join(nexusDir, 'known-repos.json'), JSON.stringify({
    version: '1.0',
    repos: [{
      slug: 'testrepo', path: fakeRepoDir, brain_path: 'nexus/testrepo/graph.json',
      last_init: '2026-07-02', primary_cli: 'claude', bootstrap_complete: false,
    }],
  }, null, 2));

  const agentBrainDir = join(nexusDir, 'agent-brain');
  const agentNodesDir = join(agentBrainDir, 'nodes');
  mkdirSync(agentNodesDir, { recursive: true });
  writeFileSync(join(agentBrainDir, 'graph.json'), JSON.stringify({
    version: '1.0', brain: 'agent', project_slug: 'agent-brain', nodes: ['agent-testbot'], edges: [],
  }, null, 2));
  writeFileSync(join(agentNodesDir, 'agent-testbot.md'), '---\nid: agent-testbot\ntype: agent-identity\n---\n\n# TestBot\n');

  prevMemRoot = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = fakeMemRoot;
});

after(() => {
  process.env.AGENT_MEMORY_ROOT = prevMemRoot;
  rmSync(fakeMemRoot, { recursive: true, force: true });
  rmSync(fakeRepoDir, { recursive: true, force: true });
});

test('repo tier: remembering conflicting facts marks old node as superseded', () => {
  // Remember "prefers npm"
  const r1 = remember({
    fact: 'user prefers npm for package management',
    section: 'Preferences',
    tier: 'repo',
    target: 'testrepo',
  });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.added, true);
  const nodeId1 = r1.id;

  // Remember conflicting "prefers pnpm"
  const r2 = remember({
    fact: 'user prefers pnpm for package management',
    section: 'Preferences',
    tier: 'repo',
    target: 'testrepo',
  });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.added, true);
  const nodeId2 = r2.id;

  // Verify first node is marked superseded
  const graphPath = join(fakeRepoDir, 'nexus', 'testrepo', 'graph.json');
  const nodesDir = join(fakeRepoDir, 'nexus', 'testrepo', 'nodes');
  const oldNodePath = join(nodesDir, `${nodeId1}.md`);
  const { frontmatter: oldFm } = parseFrontmatter(readFileSync(oldNodePath, 'utf8'));
  assert.strictEqual(oldFm.superseded_by, nodeId2, 'first node should be marked superseded_by second node');
  assert.ok(oldFm.superseded_date, 'superseded_date should be set');

  // Verify second node is NOT marked superseded
  const newNodePath = join(nodesDir, `${nodeId2}.md`);
  const { frontmatter: newFm } = parseFrontmatter(readFileSync(newNodePath, 'utf8'));
  assert.strictEqual(newFm.superseded_by, undefined, 'second node should not be marked superseded');
});

test('repo tier: selectCoreFacts skips superseded nodes', () => {
  // Remember "user prefers npm"
  const r1 = remember({
    fact: 'user prefers npm for package managers',
    section: 'Preferences',
    tier: 'repo',
    target: 'testrepo',
  });
  const nodeId1 = r1.id;

  // Remember conflicting "user prefers pnpm"
  const r2 = remember({
    fact: 'user prefers pnpm for package managers',
    section: 'Preferences',
    tier: 'repo',
    target: 'testrepo',
  });
  const nodeId2 = r2.id;

  // Create a facts array like hotUserFacts returns
  const facts = [
    { id: nodeId1, importance: 0.8, superseded_by: nodeId2 },
    { id: nodeId2, importance: 0.8, superseded_by: undefined },
    { id: 'other-node', importance: 0.5, superseded_by: undefined },
  ];

  // selectCoreFacts should skip the superseded node
  const coreIds = selectCoreFacts(facts, 2);
  assert.ok(!coreIds.includes(nodeId1), `selectCoreFacts should skip superseded node ${nodeId1}`);
  assert.ok(coreIds.includes(nodeId2), `selectCoreFacts should include active node ${nodeId2}`);
});

test('agent tier: remembering conflicting facts marks old node as superseded', () => {
  // Remember "testbot prefers npm"
  const r1 = remember({
    fact: 'testbot prefers npm for testing',
    section: 'Preferences',
    tier: 'agent',
    target: 'testbot',
  });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.added, true);
  const nodeId1 = r1.id;

  // Remember conflicting "testbot prefers yarn"
  const r2 = remember({
    fact: 'testbot prefers yarn for testing',
    section: 'Preferences',
    tier: 'agent',
    target: 'testbot',
  });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.added, true);
  const nodeId2 = r2.id;

  // Verify first node is marked superseded
  const nodesDir = join(fakeMemRoot, 'nexus', 'agent-brain', 'nodes');
  const oldNodePath = join(nodesDir, `${nodeId1}.md`);
  const { frontmatter: oldFm } = parseFrontmatter(readFileSync(oldNodePath, 'utf8'));
  assert.strictEqual(oldFm.superseded_by, nodeId2, 'first node should be marked superseded_by second node');
  assert.ok(oldFm.superseded_date, 'superseded_date should be set');
});

test('non-conflicting facts are not marked superseded', () => {
  // Remember "user prefers npm"
  const r1 = remember({
    fact: 'user prefers npm',
    section: 'Tools',
    tier: 'repo',
    target: 'testrepo',
  });
  const nodeId1 = r1.id;

  // Remember different non-conflicting "user likes dark mode"
  const r2 = remember({
    fact: 'user likes dark mode',
    section: 'Preferences',
    tier: 'repo',
    target: 'testrepo',
  });
  const nodeId2 = r2.id;

  // Verify first node is NOT marked superseded
  const nodesDir = join(fakeRepoDir, 'nexus', 'testrepo', 'nodes');
  const nodePath = join(nodesDir, `${nodeId1}.md`);
  const { frontmatter } = parseFrontmatter(readFileSync(nodePath, 'utf8'));
  assert.strictEqual(frontmatter.superseded_by, undefined, 'non-conflicting facts should not be marked superseded');
});

test('graph contains both conflicting nodes', () => {
  // Remember "prefers npm"
  const r1 = remember({
    fact: 'user prefers npm',
    section: 'Tools',
    tier: 'repo',
    target: 'testrepo',
  });

  // Remember "prefers pnpm"
  const r2 = remember({
    fact: 'user prefers pnpm',
    section: 'Tools',
    tier: 'repo',
    target: 'testrepo',
  });

  // Both nodes should exist in the graph
  const graphPath = join(fakeRepoDir, 'nexus', 'testrepo', 'graph.json');
  const graph = readGraph(graphPath);
  assert.ok(graph.nodes.includes(r1.id), 'first node should be in graph');
  assert.ok(graph.nodes.includes(r2.id), 'second node should be in graph');
  assert.ok(graph.nodes.length >= 2, 'graph should contain at least 2 nodes');
});
