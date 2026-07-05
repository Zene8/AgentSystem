'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRoutingConfig, loadRoutingRules, defaultConfigPath } = require('./routing-config.js');

const SAMPLE = `
# comment line, ignored
infra | \\b(deploy|ci)\\b | Friday | claude @friday | Friday (engineering) | deploy, CI

security | \\b(security audit)\\b | Sam | claude @sam | Sam (security) | security audit
`;

test('parseRoutingConfig: skips blank lines and comments', () => {
  const rules = parseRoutingConfig(SAMPLE);
  assert.equal(rules.length, 2);
});

test('parseRoutingConfig: extracts all six columns per rule', () => {
  const rules = parseRoutingConfig(SAMPLE);
  assert.equal(rules[0].id, 'infra');
  assert.equal(rules[0].agentShort, 'Friday');
  assert.equal(rules[0].command, 'claude @friday');
  assert.equal(rules[0].hintDisplay, 'Friday (engineering)');
  assert.equal(rules[0].keywordsDisplay, 'deploy, CI');
  assert.ok(rules[0].regex.test('please deploy this'));
});

test('parseRoutingConfig: throws on malformed row (too few columns)', () => {
  assert.throws(() => parseRoutingConfig('bad | row | only-three'));
});

test('parseRoutingConfig: throws on invalid regex', () => {
  assert.throws(() => parseRoutingConfig('id | \\b(unterminated | Friday | cmd | hint | kw'));
});

test('loadRoutingRules: real config/routing.yml loads and parses without error', () => {
  const rules = loadRoutingRules(defaultConfigPath());
  assert.ok(rules.length >= 7);
  assert.ok(rules.every(r => r.id && r.regex && r.agentShort));
});

test('loadRoutingRules: returns [] for a nonexistent path', () => {
  assert.deepEqual(loadRoutingRules('/nonexistent/routing.yml'), []);
});
