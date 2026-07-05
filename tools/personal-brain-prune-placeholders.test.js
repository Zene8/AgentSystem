import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeGraph, emptyGraph, addNode, addEdge } from './graph/graph-lib.js';
import { prunePlaceholders } from './personal-brain-prune-placeholders.js';

function makeTmpMemoryRoot() {
  const dir = join(tmpdir(), `pbp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'nexus', 'personal-brain', 'nodes'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function run(root, opts) {
  const prev = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = root;
  try {
    return prunePlaceholders(opts);
  } finally {
    if (prev === undefined) delete process.env.AGENT_MEMORY_ROOT;
    else process.env.AGENT_MEMORY_ROOT = prev;
  }
}

describe('prunePlaceholders', () => {
  it('removes placeholder nodes and their edges, keeps real facts', () => {
    const root = makeTmpMemoryRoot();
    try {
      const brainDir = join(root, 'nexus', 'personal-brain');
      const nodesDir = join(brainDir, 'nodes');

      writeFileSync(join(nodesDir, 'add-your-preferences-here.md'),
        '---\nid: add-your-preferences-here\n---\n\n- [Add your preferences here]\n');
      writeFileSync(join(nodesDir, 'real-fact.md'),
        '---\nid: real-fact\n---\n\n- I prefer dark mode\n');

      let graph = emptyGraph('agent', 'personal-brain');
      graph = addNode(graph, 'add-your-preferences-here');
      graph = addNode(graph, 'real-fact');
      graph = addEdge(graph, 'add-your-preferences-here', 'real-fact');
      writeGraph(join(brainDir, 'graph.json'), graph);

      const r = run(root);
      assert.ok(r.ok);
      assert.deepStrictEqual(r.removed, ['add-your-preferences-here']);
      assert.ok(!existsSync(join(nodesDir, 'add-your-preferences-here.md')));
      assert.ok(existsSync(join(nodesDir, 'real-fact.md')));
    } finally {
      cleanup(root);
    }
  });

  it('is a no-op (idempotent) on a clean brain', () => {
    const root = makeTmpMemoryRoot();
    try {
      const brainDir = join(root, 'nexus', 'personal-brain');
      const nodesDir = join(brainDir, 'nodes');
      writeFileSync(join(nodesDir, 'real-fact.md'), '---\nid: real-fact\n---\n\n- I prefer dark mode\n');
      let graph = emptyGraph('agent', 'personal-brain');
      graph = addNode(graph, 'real-fact');
      writeGraph(join(brainDir, 'graph.json'), graph);

      const r1 = run(root);
      const r2 = run(root);
      assert.deepStrictEqual(r1.removed, []);
      assert.deepStrictEqual(r2.removed, []);
      assert.ok(existsSync(join(nodesDir, 'real-fact.md')));
    } finally {
      cleanup(root);
    }
  });
});
