'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let findProjectMd, buildPreamble, readCeoPrompt;

describe('agent-context-inject helpers', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('findProjectMd', () => {
    before(() => {
      ({ findProjectMd, buildPreamble, readCeoPrompt } = require('./agent-context-inject'));
    });

    test('finds CLAUDE.md in cwd', () => {
      const claudeMd = path.join(tmpDir, 'CLAUDE.md');
      fs.writeFileSync(claudeMd, '# Project');
      const result = findProjectMd(tmpDir);
      assert.equal(result.path, claudeMd);
      assert.equal(result.content, '# Project');
    });

    test('finds CLAUDE.md in parent when not in cwd', () => {
      const subDir = path.join(tmpDir, 'sub', 'deep');
      fs.mkdirSync(subDir, { recursive: true });
      const claudeMd = path.join(tmpDir, 'CLAUDE.md');
      fs.writeFileSync(claudeMd, '# Parent Project');
      const result = findProjectMd(subDir);
      assert.equal(result.path, claudeMd);
    });

    test('falls back to GEMINI.md if no CLAUDE.md', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-fallback-'));
      const geminiMd = path.join(dir, 'GEMINI.md');
      fs.writeFileSync(geminiMd, '# Gemini');
      const result = findProjectMd(dir);
      assert.equal(result.path, geminiMd);
      fs.rmSync(dir, { recursive: true });
    });

    test('returns null when no project MD found', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-empty-'));
      const result = findProjectMd(emptyDir);
      assert.equal(result, null);
      fs.rmSync(emptyDir, { recursive: true });
    });
  });

  describe('buildPreamble', () => {
    test('includes project context section when md provided', () => {
      const preamble = buildPreamble('# My Project', 'models: {}', 'servers: []', 'cli: []', '');
      assert.ok(preamble.includes('=== ACTIVE PROJECT CONTEXT ==='));
      assert.ok(preamble.includes('# My Project'));
    });

    test('includes models section', () => {
      const preamble = buildPreamble('# Project', 'agents:\n  ceo: {}', '', '', '');
      assert.ok(preamble.includes('=== AVAILABLE MODELS ==='));
      assert.ok(preamble.includes('agents:'));
    });

    test('includes MCPs section', () => {
      const preamble = buildPreamble('# Project', '', 'servers:\n  - gmail', '', '');
      assert.ok(preamble.includes('=== AVAILABLE MCPS ==='));
      assert.ok(preamble.includes('gmail'));
    });

    test('includes tools section', () => {
      const preamble = buildPreamble('# Project', '', '', 'cli:\n  - gh', '');
      assert.ok(preamble.includes('=== AVAILABLE TOOLS ==='));
      assert.ok(preamble.includes('gh'));
    });

    test('omits project context section when no md', () => {
      const preamble = buildPreamble(null, '', '', '', '');
      assert.ok(!preamble.includes('=== ACTIVE PROJECT CONTEXT ==='));
    });

    test('includes YOUR ROLE section when ceo prompt provided', () => {
      const preamble = buildPreamble(null, '', '', '', '# CEO');
      assert.ok(preamble.includes('=== YOUR ROLE ==='));
      assert.ok(preamble.includes('# CEO'));
    });

    test('omits YOUR ROLE section when ceo prompt empty', () => {
      const preamble = buildPreamble(null, '', '', '', '');
      assert.ok(!preamble.includes('=== YOUR ROLE ==='));
    });
  });
});
