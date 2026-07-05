#!/usr/bin/env node
// Regression test for #113: sync-agents.js frontmatter parsing must be CRLF-aware.
// Source agent .md files are Windows-authored (CRLF); a CRLF-blind regex silently
// fails to parse frontmatter, leaving `model:` empty for agents not in MODELS map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, stripFrontmatter, stripToolsLine } from './sync-agents.js';

test('parseFrontmatter handles CRLF line endings', () => {
  const content = '---\r\nname: clarification-needed\r\nmodel: opus\r\n---\r\nBody text\r\n';
  const meta = parseFrontmatter(content);
  assert.strictEqual(meta.name, 'clarification-needed');
  assert.strictEqual(meta.model, 'opus');
});

test('parseFrontmatter handles LF line endings', () => {
  const content = '---\nname: foo\nmodel: opus\n---\nBody\n';
  const meta = parseFrontmatter(content);
  assert.strictEqual(meta.name, 'foo');
  assert.strictEqual(meta.model, 'opus');
});

test('stripFrontmatter removes CRLF frontmatter block', () => {
  const content = '---\r\nname: foo\r\n---\r\nBody text\r\n';
  const body = stripFrontmatter(content);
  assert.strictEqual(body, 'Body text\r\n');
});

test('stripToolsLine removes tools: line from CRLF frontmatter', () => {
  const content = '---\r\nname: foo\r\ntools: bash, git\r\nmodel: opus\r\n---\r\nBody\r\n';
  const out = stripToolsLine(content);
  assert.ok(!/^tools:/m.test(out));
  assert.ok(out.includes('model: opus'));
});
