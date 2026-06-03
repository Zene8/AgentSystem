import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProject, selectCoreFacts } from './memory-context.js';

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
  assert.strictEqual(detectProject('D:/Documents/DEV/basely-brain/docs', reg), 'basely-brain');
});

test('selectCoreFacts returns exactly N ids for N < total', () => {
  const facts = [
    { id: 'c', importance: 0.3 },
    { id: 'a', importance: 0.9 },
    { id: 'b', importance: 0.6 },
    { id: 'd', importance: 0.1 },
  ];
  const result = selectCoreFacts(facts, 2);
  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result, ['a', 'b']);
});

test('selectCoreFacts returns all when N >= total', () => {
  const facts = [{ id: 'x', importance: 0.5 }, { id: 'y', importance: 0.2 }];
  assert.strictEqual(selectCoreFacts(facts, 7).length, 2);
});

test('selectCoreFacts preserves descending importance order', () => {
  const facts = [
    { id: 'low', importance: 0.1 },
    { id: 'high', importance: 0.95 },
    { id: 'mid', importance: 0.5 },
  ];
  const result = selectCoreFacts(facts, 3);
  assert.deepStrictEqual(result, ['high', 'mid', 'low']);
});

test('selectCoreFacts does not mutate input array', () => {
  const facts = [{ id: 'a', importance: 0.1 }, { id: 'b', importance: 0.9 }];
  const original = [...facts];
  selectCoreFacts(facts, 7);
  assert.deepStrictEqual(facts, original);
});
