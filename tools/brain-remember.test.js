import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFactToBrain } from './brain-remember.js';

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
