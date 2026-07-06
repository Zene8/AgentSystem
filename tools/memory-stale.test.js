import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fakeMemRoot, prevMemRoot;

before(() => {
  fakeMemRoot = mkdtempSync(join(tmpdir(), 'stale-test-'));
  prevMemRoot = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = fakeMemRoot;
});

after(() => {
  process.env.AGENT_MEMORY_ROOT = prevMemRoot;
  rmSync(fakeMemRoot, { recursive: true, force: true });
});

test('memory-stale.js --contradictions lists superseded nodes', () => {
  // Set up a test brain with a superseded node
  const brainDir = join(fakeMemRoot, 'nexus', 'test-brain');
  const nodesDir = join(brainDir, 'nodes');
  mkdirSync(nodesDir, { recursive: true });

  // Create two nodes: one normal, one superseded
  writeFileSync(
    join(nodesDir, 'node-old.md'),
    '---\nid: node-old\ntype: fact\nsuperseded_by: node-new\nsuperseded_date: 2026-07-05\n---\n\nOld fact'
  );
  writeFileSync(
    join(nodesDir, 'node-new.md'),
    '---\nid: node-new\ntype: fact\n---\n\nNew fact'
  );

  // Create graph
  writeFileSync(
    join(brainDir, 'graph.json'),
    JSON.stringify({
      version: '1.0',
      brain: 'test',
      project_slug: 'test',
      nodes: ['node-old', 'node-new'],
      edges: [],
    }, null, 2)
  );

  // Run memory-stale with --contradictions
  const cmd = `node tools/memory-stale.js --brain=test-brain --contradictions`;
  const output = execSync(cmd, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, AGENT_MEMORY_ROOT: fakeMemRoot },
  });

  // Should list the superseded pair
  assert.match(output, /contradiction scan/i);
  assert.match(output, /superseded pairs/i);
  assert.match(output, /node-old/);
  assert.match(output, /node-new/);
  assert.match(output, /2026-07-05/);
});

test('memory-stale.js --contradictions reports zero pairs when none exist', () => {
  // Set up a test brain with no superseded nodes
  const brainDir = join(fakeMemRoot, 'nexus', 'test-brain-2');
  const nodesDir = join(brainDir, 'nodes');
  mkdirSync(nodesDir, { recursive: true });

  // Create normal nodes (no superseded_by field)
  writeFileSync(
    join(nodesDir, 'node-a.md'),
    '---\nid: node-a\ntype: fact\n---\n\nFact A'
  );
  writeFileSync(
    join(nodesDir, 'node-b.md'),
    '---\nid: node-b\ntype: fact\n---\n\nFact B'
  );

  // Create graph
  writeFileSync(
    join(brainDir, 'graph.json'),
    JSON.stringify({
      version: '1.0',
      brain: 'test2',
      project_slug: 'test2',
      nodes: ['node-a', 'node-b'],
      edges: [],
    }, null, 2)
  );

  // Run memory-stale with --contradictions
  const cmd = `node tools/memory-stale.js --brain=test-brain-2 --contradictions`;
  const output = execSync(cmd, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, AGENT_MEMORY_ROOT: fakeMemRoot },
  });

  // Should report zero pairs
  assert.match(output, /contradiction scan/i);
  assert.match(output, /superseded pairs.*\(0\)/i);
});
