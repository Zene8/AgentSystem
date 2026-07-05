'use strict';
// Regression tests for #120: SubagentStart hook must defensively extract the agent name
// across the field-name variants Claude Code's payload could plausibly use, and degrade
// gracefully to '' (worker-tier default) rather than throwing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAgentName } = require('./memory-context-inject-subagent.js');

test('extractAgentName: reads subagent_type when present', () => {
  assert.strictEqual(extractAgentName({ subagent_type: 'Friday' }), 'Friday');
});

test('extractAgentName: falls back through agent_type, agent, name', () => {
  assert.strictEqual(extractAgentName({ agent_type: 'r2d2' }), 'r2d2');
  assert.strictEqual(extractAgentName({ agent: 'Sam' }), 'Sam');
  assert.strictEqual(extractAgentName({ name: 'ultron' }), 'ultron');
});

test('extractAgentName: null/empty payload returns empty string, never throws', () => {
  assert.strictEqual(extractAgentName(null), '');
  assert.strictEqual(extractAgentName(undefined), '');
  assert.strictEqual(extractAgentName({}), '');
});

test('extractAgentName: trims whitespace', () => {
  assert.strictEqual(extractAgentName({ subagent_type: '  friday  ' }), 'friday');
});
