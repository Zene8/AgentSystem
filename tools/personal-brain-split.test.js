import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBrainCandidates, sectionImportance, splitPersonalBrain } from './personal-brain-split.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Override agentMemoryRoot by patching env — personal-brain-split reads it via graph-lib.
// Instead we test the exported pure functions directly, and for splitPersonalBrain we
// create a temp dir and monkey-patch the env var used by agentMemoryRoot().

function makeTmpMemoryRoot() {
  const dir = join(tmpdir(), `pbs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'nexus', 'personal-brain', 'nodes'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Write a minimal user-brain.md into the tmp brain dir.
function writeBrain(brainDir, content) {
  writeFileSync(join(brainDir, 'user-brain.md'), content, 'utf8');
}

// Run splitPersonalBrain with AGENT_MEMORY_ROOT pointed at tmp dir.
function runSplit(brainRoot, dryRun = false) {
  const prev = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = brainRoot;
  try {
    return splitPersonalBrain({ dryRun });
  } finally {
    if (prev === undefined) delete process.env.AGENT_MEMORY_ROOT;
    else process.env.AGENT_MEMORY_ROOT = prev;
  }
}

// ── Pure function tests ───────────────────────────────────────────────────────

describe('parseBrainCandidates', () => {
  it('parses bullets under sections', () => {
    const raw = `## Preferences\n- dark mode\n- short answers\n`;
    const candidates = parseBrainCandidates(raw);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].section, 'Preferences');
    assert.ok(candidates[0].text.includes('dark mode'));
  });

  it('skips struck-through (superseded) facts', () => {
    const raw = `## Goals\n- ~~old goal~~\n- new goal\n`;
    const candidates = parseBrainCandidates(raw);
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0].text.includes('new goal'));
  });

  it('returns empty array for empty brain', () => {
    assert.equal(parseBrainCandidates('').length, 0);
  });

  it('skips unfilled template placeholder bullets', () => {
    const raw = [
      '## Who I Am',
      '- [Your role — e.g., solo founder, developer, team lead]',
      '- Subscriptions: [e.g., Claude Max, Gemini Pro, GitHub Copilot]',
      '- Primary repos: [list your repos]',
      '## Current Goals',
      '### [Project Name]',
      '- [Goal 1]',
      '- [Goal 2]',
      '## Real facts',
      '- I actually prefer dark mode',
    ].join('\n');
    const candidates = parseBrainCandidates(raw);
    assert.equal(candidates.length, 1, `expected only the real fact, got: ${JSON.stringify(candidates)}`);
    assert.ok(candidates[0].text.includes('dark mode'));
  });
});

describe('sectionImportance', () => {
  it('hard constraints score highest', () => {
    assert.ok(sectionImportance("don't want") >= 0.9);
  });

  it('session notes score lowest', () => {
    assert.ok(sectionImportance('session notes') <= 0.3);
  });

  it('defaults to 0.5 for unknown sections', () => {
    assert.equal(sectionImportance('misc random section'), 0.5);
  });
});

// ── Integration: salience and connections persistence ─────────────────────────

describe('splitPersonalBrain — field preservation', () => {
  it('preserves salience across two split calls', () => {
    const root = makeTmpMemoryRoot();
    try {
      const brainDir = join(root, 'nexus', 'personal-brain');
      writeBrain(brainDir, `## Preferences\n- use dark mode always\n`);

      // First split — creates node file
      const r1 = runSplit(root);
      assert.ok(r1.ok, `first split failed: ${r1.message}`);

      // Find the generated node file
      const nodesDir = join(brainDir, 'nodes');
      const files = readdirSync(nodesDir).filter(f => f.endsWith('.md'));
      assert.ok(files.length > 0, 'no node files created');
      const nodeFile = join(nodesDir, files[0]);

      // Inject salience into the node (simulating brain-remember.js stampSalience)
      const raw = readFileSync(nodeFile, 'utf8');
      const patched = raw.replace(/^---\n/, '---\nsalience: 0.72\n');
      writeFileSync(nodeFile, patched, 'utf8');

      // Second split — must NOT wipe salience
      const r2 = runSplit(root);
      assert.ok(r2.ok, `second split failed: ${r2.message}`);

      const after = readFileSync(nodeFile, 'utf8');
      assert.ok(after.includes('salience: 0.72'), `salience was wiped on re-split. File:\n${after}`);
    } finally {
      cleanup(root);
    }
  });

  it('preserves connections across two split calls', () => {
    const root = makeTmpMemoryRoot();
    try {
      const brainDir = join(root, 'nexus', 'personal-brain');
      writeBrain(brainDir, `## Goals\n- ship memory system\n`);

      const r1 = runSplit(root);
      assert.ok(r1.ok);

      const nodesDir = join(brainDir, 'nodes');
      const files = readdirSync(nodesDir).filter(f => f.endsWith('.md'));
      const nodeFile = join(nodesDir, files[0]);

      // Inject connections (simulating wikilink-sync)
      const raw = readFileSync(nodeFile, 'utf8');
      const patched = raw.replace(/^---\n/, '---\nconnections: [[other-node]]\n');
      writeFileSync(nodeFile, patched, 'utf8');

      const r2 = runSplit(root);
      assert.ok(r2.ok);

      const after = readFileSync(nodeFile, 'utf8');
      assert.ok(after.includes('connections: [[other-node]]'), `connections wiped on re-split. File:\n${after}`);
    } finally {
      cleanup(root);
    }
  });

  it('does not add salience line when none existed before', () => {
    const root = makeTmpMemoryRoot();
    try {
      const brainDir = join(root, 'nexus', 'personal-brain');
      writeBrain(brainDir, `## Technical\n- prefer TypeScript\n`);

      runSplit(root);

      const nodesDir = join(brainDir, 'nodes');
      const files = readdirSync(nodesDir).filter(f => f.endsWith('.md'));
      const nodeFile = join(nodesDir, files[0]);
      const content = readFileSync(nodeFile, 'utf8');

      assert.ok(!content.includes('\nsalience:'), 'salience should not appear when not previously set');
    } finally {
      cleanup(root);
    }
  });

  it('dry-run does not write node files', () => {
    const root = makeTmpMemoryRoot();
    try {
      const brainDir = join(root, 'nexus', 'personal-brain');
      writeBrain(brainDir, `## Goals\n- test dry run\n`);

      const r = runSplit(root, true);
      assert.ok(r.ok);

      const nodesDir = join(brainDir, 'nodes');
      const files = existsSync(nodesDir)
        ? readdirSync(nodesDir).filter(f => f.endsWith('.md'))
        : [];
      assert.equal(files.length, 0, 'dry-run should not write files');
    } finally {
      cleanup(root);
    }
  });
});
