import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWikilinkMap, applyWikilinkMap } from './wikilink-sync.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpBrain() {
  const dir = join(tmpdir(), `wikilink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'nodes'), { recursive: true });

  // graph.json with 3 nodes and 2 edges
  const graph = {
    version: '1.0', brain: 'test', project_slug: 'test',
    nodes: ['alpha', 'beta', 'gamma'],
    edges: [
      { source: 'alpha', target: 'beta',  weights: {} },
      { source: 'beta',  target: 'gamma', weights: {} },
    ],
  };
  writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph), 'utf8');

  // Node files without connections
  for (const id of ['alpha', 'beta', 'gamma']) {
    writeFileSync(join(dir, 'nodes', `${id}.md`), `---\nid: ${id}\ntype: user-fact\n---\n\n- ${id} content\n`, 'utf8');
  }

  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildWikilinkMap', () => {
  it('builds adjacency from graph edges', () => {
    const graph = {
      nodes: ['alpha', 'beta', 'gamma'],
      edges: [
        { source: 'alpha', target: 'beta' },
        { source: 'beta', target: 'gamma' },
        { source: 'alpha', target: 'gamma' },
      ],
    };
    const map = buildWikilinkMap(graph);
    assert.deepEqual([...map.get('alpha')].sort(), ['beta', 'gamma']);
    assert.deepEqual([...map.get('beta')].sort(), ['alpha', 'gamma']);
    assert.deepEqual([...map.get('gamma')].sort(), ['alpha', 'beta']);
  });

  it('is undirected — both directions added', () => {
    const graph = {
      nodes: ['a', 'b'],
      edges: [{ source: 'a', target: 'b' }],
    };
    const map = buildWikilinkMap(graph);
    assert.ok(map.get('a').has('b'), 'a should link to b');
    assert.ok(map.get('b').has('a'), 'b should back-link to a (undirected)');
  });

  it('returns empty sets for isolated nodes', () => {
    const graph = { nodes: ['lone'], edges: [] };
    const map = buildWikilinkMap(graph);
    assert.equal(map.get('lone').size, 0);
  });
});

describe('applyWikilinkMap', () => {
  it('writes connections into frontmatter of node without existing connections', () => {
    const dir = makeTmpBrain();
    try {
      const graph = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
      const map = buildWikilinkMap(graph);
      const stats = applyWikilinkMap(map, join(dir, 'nodes'));

      const alpha = readFileSync(join(dir, 'nodes', 'alpha.md'), 'utf8');
      assert.ok(alpha.includes('connections:'), 'should add connections field');
      assert.ok(alpha.includes('[[beta]]'), 'alpha should link to beta');
      // alpha→beta, beta←→gamma: all 3 nodes have at least one neighbor
      assert.equal(stats.updated, 3, 'all nodes with edges should be updated');
    } finally {
      cleanup(dir);
    }
  });

  it('does not add connections to isolated nodes', () => {
    const dir = makeTmpBrain();
    try {
      // Remove all edges — gamma only had one incoming
      const graphPath = join(dir, 'graph.json');
      const g = JSON.parse(readFileSync(graphPath, 'utf8'));
      g.edges = [];
      writeFileSync(graphPath, JSON.stringify(g), 'utf8');

      const map = buildWikilinkMap(g);
      applyWikilinkMap(map, join(dir, 'nodes'));

      const gamma = readFileSync(join(dir, 'nodes', 'gamma.md'), 'utf8');
      assert.ok(!gamma.includes('connections:'), 'isolated node should not get connections field');
    } finally {
      cleanup(dir);
    }
  });

  it('is idempotent — running twice produces same result', () => {
    const dir = makeTmpBrain();
    try {
      const graph = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
      const map = buildWikilinkMap(graph);
      const nodesDir = join(dir, 'nodes');
      applyWikilinkMap(map, nodesDir);
      const after1 = readFileSync(join(nodesDir, 'alpha.md'), 'utf8');
      applyWikilinkMap(map, nodesDir);
      const after2 = readFileSync(join(nodesDir, 'alpha.md'), 'utf8');
      assert.equal(after1, after2, 'file should be unchanged on second run');
    } finally {
      cleanup(dir);
    }
  });

  it('returns stats with updated count', () => {
    const dir = makeTmpBrain();
    try {
      const graph = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
      const map = buildWikilinkMap(graph);
      const stats = applyWikilinkMap(map, join(dir, 'nodes'));
      assert.ok(typeof stats.updated === 'number');
      assert.ok(typeof stats.skipped === 'number');
      assert.ok(typeof stats.total === 'number');
    } finally {
      cleanup(dir);
    }
  });
});
