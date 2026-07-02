import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifyPrompt, parseClassifiedFacts, AGENT_ROSTER } from './memory-classify.js';

test('AGENT_ROSTER contains the known agent set', () => {
  for (const name of ['jarvis', 'friday', 'sam', 'nat', 'ultron', 'pym', 'leo', 'astra', 'wanda', 'threepio', 'r2d2']) {
    assert.ok(AGENT_ROSTER.includes(name), `missing ${name}`);
  }
});

test('buildClassifyPrompt embeds the supplied repo and agent lists', () => {
  const prompt = buildClassifyPrompt('some text', { repos: ['agentsystem', 'genie'], agents: ['friday'] });
  assert.match(prompt, /agentsystem/);
  assert.match(prompt, /genie/);
  assert.match(prompt, /friday/);
  assert.match(prompt, /some text/);
});

test('parseClassifiedFacts parses well-formed JSON lines', () => {
  const raw = [
    '{"fact": "prefers dark mode", "tier": "personal", "target": ""}',
    '{"fact": "AgentSystem always branches from dev", "tier": "repo", "target": "agentsystem"}',
    '{"fact": "Friday checks trust score before spawning", "tier": "agent", "target": "friday"}',
  ].join('\n');
  const out = parseClassifiedFacts(raw, { repos: ['agentsystem'], agents: ['friday'] });
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out[0], { fact: 'prefers dark mode', tier: 'personal', target: '' });
  assert.deepStrictEqual(out[1], { fact: 'AgentSystem always branches from dev', tier: 'repo', target: 'agentsystem' });
  assert.deepStrictEqual(out[2], { fact: 'Friday checks trust score before spawning', tier: 'agent', target: 'friday' });
});

test('parseClassifiedFacts returns [] for NONE', () => {
  assert.deepStrictEqual(parseClassifiedFacts('NONE', {}), []);
  assert.deepStrictEqual(parseClassifiedFacts('  none  ', {}), []);
});

test('parseClassifiedFacts skips malformed lines but keeps valid ones', () => {
  const raw = 'not json at all\n{"fact": "valid one", "tier": "personal", "target": ""}\n{broken';
  const out = parseClassifiedFacts(raw, {});
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].fact, 'valid one');
});

test('parseClassifiedFacts coerces an unknown repo target back to personal', () => {
  const raw = '{"fact": "some fact", "tier": "repo", "target": "not-a-real-repo"}';
  const out = parseClassifiedFacts(raw, { repos: ['agentsystem'], agents: [] });
  assert.deepStrictEqual(out[0], { fact: 'some fact', tier: 'personal', target: '' });
});

test('parseClassifiedFacts coerces an unknown agent target back to personal', () => {
  const raw = '{"fact": "some fact", "tier": "agent", "target": "not-a-real-agent"}';
  const out = parseClassifiedFacts(raw, { repos: [], agents: ['friday'] });
  assert.deepStrictEqual(out[0], { fact: 'some fact', tier: 'personal', target: '' });
});

test('parseClassifiedFacts coerces an invalid tier string back to personal', () => {
  const raw = '{"fact": "some fact", "tier": "bogus", "target": "x"}';
  const out = parseClassifiedFacts(raw, {});
  assert.deepStrictEqual(out[0], { fact: 'some fact', tier: 'personal', target: '' });
});

test('parseClassifiedFacts caps output at 8 facts', () => {
  const lines = Array.from({ length: 12 }, (_, i) => `{"fact": "fact ${i}", "tier": "personal", "target": ""}`);
  const out = parseClassifiedFacts(lines.join('\n'), {});
  assert.strictEqual(out.length, 8);
});
