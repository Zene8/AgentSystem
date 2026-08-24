// Tests for tools/inbound/policy.js — parser plus fail-closed loading. No network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CADENCE_TIERS,
  CADENCE_INTERVAL_MS,
  POLICY_FILENAME,
  lifeRepoRoot,
  policyPath,
  parseInboundPolicy,
  loadPolicy,
  sourcesForCadence,
} from './policy.js';

const FULL = [
  'gmail:',
  '  enabled: true',
  '  cadence: fast',
  '  senders_allow: [a@example.com, b@example.com]',
  '  labels_ignore: [Promotions]',
  '  max_actions_per_day: 12',
  '',
  'github:',
  '  enabled: true',
  '  cadence: medium',
  '  reasons: [ci_activity, assign]',
  '  max_actions_per_day: 20',
  '',
  'notion:',
  '  enabled: false',
  '  cadence: daily',
  '  max_actions_per_day: 5',
  '',
].join('\n');

// A throwaway policy file. tmpdir() is fine HERE (test fixture, not runtime state — the runtime
// cursor deliberately avoids tmpdir, see cursor.js).
function writePolicy(text) {
  const dir = mkdtempSync(join(tmpdir(), 'inbound-policy-'));
  const file = join(dir, POLICY_FILENAME);
  writeFileSync(file, text, 'utf8');
  return { dir, file };
}

test('cadence tiers and their intervals', () => {
  assert.deepEqual(CADENCE_TIERS, ['fast', 'medium', 'daily']);
  assert.equal(CADENCE_INTERVAL_MS.fast, 2 * 60 * 1000);
  assert.equal(CADENCE_INTERVAL_MS.medium, 10 * 60 * 1000);
  assert.equal(CADENCE_INTERVAL_MS.daily, 24 * 60 * 60 * 1000);
});

test('lifeRepoRoot throws when LIFE_REPO is unset — loud beats silently fail-closed (#281)', () => {
  assert.throws(() => lifeRepoRoot({}), /LIFE_REPO is unset/);
  assert.throws(() => lifeRepoRoot({ LIFE_REPO: '   ' }), /LIFE_REPO is unset/);
});

test('lifeRepoRoot trims, and policyPath appends the filename', () => {
  assert.equal(lifeRepoRoot({ LIFE_REPO: ' /life ' }), '/life');
  assert.equal(policyPath({ LIFE_REPO: '/life' }), join('/life', POLICY_FILENAME));
});

test('parseInboundPolicy reads the whole documented grammar', () => {
  const parsed = parseInboundPolicy(FULL);
  assert.deepEqual(Object.keys(parsed), ['gmail', 'github', 'notion']);
  assert.equal(parsed.gmail.enabled, true);
  assert.equal(parsed.gmail.cadence, 'fast');
  assert.equal(parsed.gmail.max_actions_per_day, 12);
  assert.deepEqual(parsed.gmail.senders_allow, ['a@example.com', 'b@example.com']);
  assert.deepEqual(parsed.gmail.labels_ignore, ['Promotions']);
  assert.equal(parsed.notion.enabled, false);
});

test('parseInboundPolicy strips comments and blank lines', () => {
  const parsed = parseInboundPolicy([
    '# leading comment',
    'gmail:',
    '  # inner comment',
    '  enabled: true   # trailing',
    '',
    '  cadence: fast',
  ].join('\n'));
  assert.equal(parsed.gmail.enabled, true);
  assert.equal(parsed.gmail.cadence, 'fast');
});

test('parseInboundPolicy accepts an empty and a bracketed-empty list', () => {
  const parsed = parseInboundPolicy('gmail:\n  senders_allow: []\n  labels_ignore:\n');
  assert.deepEqual(parsed.gmail.senders_allow, []);
  assert.deepEqual(parsed.gmail.labels_ignore, []);
});

test('parseInboundPolicy strips quotes from scalars and list items', () => {
  const parsed = parseInboundPolicy('gmail:\n  cadence: "fast"\n  senders_allow: ["a@b.com", c@d.com]\n');
  assert.equal(parsed.gmail.cadence, 'fast');
  assert.deepEqual(parsed.gmail.senders_allow, ['a@b.com', 'c@d.com']);
});

test('parseInboundPolicy tolerates CRLF', () => {
  const parsed = parseInboundPolicy('gmail:\r\n  enabled: true\r\n');
  assert.equal(parsed.gmail.enabled, true);
});

test('parseInboundPolicy THROWS rather than skipping anything it does not understand', () => {
  const cases = [
    ['- gmail', /cannot parse/],                                   // block sequence
    ['gmail:\n  enabled: true\ngmail:\n', /declared twice/],        // duplicate source
    ['gmail:\n  enabled: true\n  enabled: false\n', /key "enabled" declared twice/],
    ['  enabled: true\n', /before any source header/],
    ['gmail:\n  senders_alow: [a@b.com]\n', /unknown key "senders_alow"/],
    ['gmail:\n  enabled:\n', /"enabled" has no value/],
    ['gmail:\n  senders_allow: a@b.com\n', /must be an inline list/],
    ['gmail:\n  senders_allow: [a@b.com, ]\n', /empty item/],
    ['gmail:\n  cadence: two words\n', /not a plain scalar/],
  ];
  for (const [text, re] of cases) {
    assert.throws(() => parseInboundPolicy(text), re, `expected throw for ${JSON.stringify(text)}`);
  }
});

test('loadPolicy returns a resolved policy for an enabled source', () => {
  const { file } = writePolicy(FULL);
  const p = loadPolicy('gmail', { path: file });
  assert.equal(p.enabled, true);
  assert.equal(p.source, 'gmail');
  assert.equal(p.cadence, 'fast');
  assert.equal(p.intervalMs, CADENCE_INTERVAL_MS.fast);
  assert.equal(p.maxActionsPerDay, 12);
  assert.deepEqual(p.sendersAllow, ['a@example.com', 'b@example.com']);
  // Unset list keys default to empty, which for an allowlist means "action nothing".
  assert.deepEqual(p.chatsAllow, []);
});

test('loadPolicy rejects an unknown source name outright', () => {
  assert.throws(() => loadPolicy('slack', { path: 'ignored' }), /unknown source/);
});

test('loadPolicy fails CLOSED on every file-level problem, with a reason', () => {
  const missing = loadPolicy('gmail', {
    path: join(mkdtempSync(join(tmpdir(), 'nope-')), POLICY_FILENAME),
  });
  assert.equal(missing.enabled, false);
  assert.match(missing.reason, /unreadable/);

  const bad = writePolicy('this is not the grammar\n');
  const unparseable = loadPolicy('gmail', { path: bad.file });
  assert.equal(unparseable.enabled, false);
  assert.match(unparseable.reason, /does not parse/);
});

test('loadPolicy fails closed per source: absent section, enabled false, bad cadence, bad cap', () => {
  const { file } = writePolicy(FULL);
  const absent = loadPolicy('beeper', { path: file });
  assert.equal(absent.enabled, false);
  assert.match(absent.reason, /no "beeper" section/);

  const off = loadPolicy('notion', { path: file });
  assert.equal(off.enabled, false);
  assert.match(off.reason, /is false/);

  const noEnabled = writePolicy('gmail:\n  cadence: fast\n  max_actions_per_day: 1\n');
  assert.match(loadPolicy('gmail', { path: noEnabled.file }).reason, /must be true or false/);

  const badCadence = writePolicy('gmail:\n  enabled: true\n  cadence: hourly\n  max_actions_per_day: 1\n');
  assert.match(loadPolicy('gmail', { path: badCadence.file }).reason, /cadence" must be one of/);

  const noCap = writePolicy('gmail:\n  enabled: true\n  cadence: fast\n');
  assert.match(loadPolicy('gmail', { path: noCap.file }).reason, /max_actions_per_day/);

  const negCap = writePolicy('gmail:\n  enabled: true\n  cadence: fast\n  max_actions_per_day: -1\n');
  assert.match(loadPolicy('gmail', { path: negCap.file }).reason, /non-negative integer/);
});

test('a cap of zero is valid — the source polls and notifies but never actions', () => {
  const { file } = writePolicy('gmail:\n  enabled: true\n  cadence: fast\n  max_actions_per_day: 0\n');
  const p = loadPolicy('gmail', { path: file });
  assert.equal(p.enabled, true);
  assert.equal(p.maxActionsPerDay, 0);
});

test('sourcesForCadence returns only enabled sources in that tier', () => {
  const { file } = writePolicy(FULL);
  assert.deepEqual(sourcesForCadence('fast', { path: file }).map(p => p.source), ['gmail']);
  assert.deepEqual(sourcesForCadence('medium', { path: file }).map(p => p.source), ['github']);
  // notion is in the daily tier but disabled, so the daily timer has nothing to run.
  assert.deepEqual(sourcesForCadence('daily', { path: file }).map(p => p.source), []);
  assert.throws(() => sourcesForCadence('hourly', { path: file }), /unknown cadence/);
});

test('a source in the policy that is not a known SOURCE is simply never loaded', () => {
  // The parser accepts any header name; loadPolicy only ever asks for known sources, so a stray
  // section cannot smuggle a fifth adapter into a tier.
  const { file } = writePolicy('slack:\n  enabled: true\n  cadence: fast\n  max_actions_per_day: 9\n');
  assert.deepEqual(sourcesForCadence('fast', { path: file }), []);
});

test('loadPolicy with no explicit path resolves through LIFE_REPO', () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-repo-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, POLICY_FILENAME), FULL, 'utf8');
  const p = loadPolicy('github', { env: { LIFE_REPO: dir } });
  assert.equal(p.enabled, true);
  assert.deepEqual(p.reasons, ['ci_activity', 'assign']);
  // ...and with LIFE_REPO unset it throws, rather than quietly disabling everything.
  assert.throws(() => loadPolicy('github', { env: {} }), /LIFE_REPO is unset/);
});
