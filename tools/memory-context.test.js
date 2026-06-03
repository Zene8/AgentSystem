import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProject } from './memory-context.js';

const reg = { repos: [
  { slug: 'agentsystem', path: 'C:/Users/natha/AgentSystem' },
  { slug: 'basely', path: 'D:/Documents/DEV/Basely' },
  { slug: 'basely-brain', path: 'D:/Documents/DEV/basely-brain' },
] };

test('detectProject matches cwd inside a repo', () => {
  assert.strictEqual(detectProject('C:/Users/natha/AgentSystem/tools', reg), 'agentsystem');
  assert.strictEqual(detectProject('C:\\Users\\natha\\AgentSystem', reg), 'agentsystem');
});

test('detectProject returns null outside any repo', () => {
  assert.strictEqual(detectProject('C:/Users/natha/Desktop', reg), null);
});

test('detectProject longest-prefix wins for nested-name repos', () => {
  // basely-brain must not be shadowed by basely
  assert.strictEqual(detectProject('D:/Documents/DEV/basely-brain/docs', reg), 'basely-brain');
});
