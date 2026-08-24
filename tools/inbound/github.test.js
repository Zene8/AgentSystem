// Tests for tools/inbound/github.js. Every API response is stubbed — no network, no gh.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_SIZE,
  notificationsPath,
  externalIdFor,
  htmlUrlFor,
  isInteresting,
  poll,
} from './github.js';

const POLICY = { reasons: ['ci_activity', 'assign', 'review_requested'] };

function notification(over = {}) {
  return {
    id: '1001',
    reason: 'assign',
    updated_at: '2026-08-22T10:00:00Z',
    subject: { title: 'Fix the poller', type: 'Issue', url: 'https://api.github.com/repos/Zene8/AgentSystem/issues/483' },
    repository: { full_name: 'Zene8/AgentSystem' },
    ...over,
  };
}

function stub(list) {
  const calls = [];
  const run = (args) => { calls.push(args); return list; };
  return { run, calls };
}

test('notificationsPath asks for one page of unread threads', () => {
  const p = notificationsPath(null);
  assert.match(p, new RegExp(`per_page=${PAGE_SIZE}`));
  assert.match(p, /all=false/);
  assert.match(p, /participating=false/);
  assert.ok(!p.includes('since='), 'no cursor means no since');
});

test('notificationsPath passes the cursor as an encoded since', () => {
  assert.match(notificationsPath('2026-08-22T10:00:00.000Z'),
    /since=2026-08-22T10%3A00%3A00\.000Z/);
});

test('externalIdFor is stable across identical polls and moves on new activity', () => {
  const n = notification();
  assert.equal(externalIdFor(n), externalIdFor({ ...n }));
  assert.notEqual(externalIdFor(n), externalIdFor(notification({ updated_at: '2026-08-22T11:00:00Z' })));
  // Thread id alone would collide here, swallowing a genuinely new comment on a seen thread.
  assert.notEqual(externalIdFor(n), externalIdFor(notification({ id: '1002' })));
});

test('htmlUrlFor rewrites the API url for issues and pulls', () => {
  assert.equal(htmlUrlFor(notification()), 'https://github.com/Zene8/AgentSystem/issues/483');
  assert.equal(
    htmlUrlFor(notification({ subject: { url: 'https://api.github.com/repos/Zene8/AgentSystem/pulls/488' } })),
    'https://github.com/Zene8/AgentSystem/pull/488',
  );
});

test('htmlUrlFor falls back to the Actions tab for a CheckSuite, which has no subject url', () => {
  const n = notification({ reason: 'ci_activity', subject: { title: 'CI failed', type: 'CheckSuite', url: null } });
  assert.equal(htmlUrlFor(n), 'https://github.com/Zene8/AgentSystem/actions');
});

test('htmlUrlFor never returns empty — an unset url would fail envelope validation', () => {
  assert.equal(htmlUrlFor({ subject: {}, repository: {} }), 'https://github.com/notifications');
});

test('isInteresting gates on the policy reason list, which is fail-closed when empty', () => {
  assert.equal(isInteresting(notification(), POLICY), true);
  assert.equal(isInteresting(notification({ reason: 'subscribed' }), POLICY), false);
  assert.equal(isInteresting(notification(), { reasons: [] }), false);
  assert.equal(isInteresting(notification(), {}), false);
});

test('isInteresting keeps failing check suites and drops green ones', () => {
  const ci = (title) => notification({ reason: 'ci_activity', subject: { title, type: 'CheckSuite', url: null } });
  assert.equal(isInteresting(ci('sam-audit workflow run failed for main'), POLICY), true);
  assert.equal(isInteresting(ci('test workflow run cancelled for main'), POLICY), true);
  assert.equal(isInteresting(ci('CI errored on issue-483'), POLICY), true);
  assert.equal(isInteresting(ci('test workflow run succeeded for main'), POLICY), false);
  assert.equal(isInteresting(ci(''), POLICY), false);
});

test('poll returns normalized envelopes, oldest first', () => {
  const { run, calls } = stub([
    notification({ id: '2', updated_at: '2026-08-22T12:00:00Z' }),
    notification({ id: '1', updated_at: '2026-08-22T10:00:00Z' }),
  ]);
  const out = poll({ cursor: null, policy: POLICY, runGh: run });
  assert.equal(calls.length, 1);
  assert.deepEqual(out.items.map(i => i.ts),
    ['2026-08-22T10:00:00.000Z', '2026-08-22T12:00:00.000Z']);
  const item = out.items[0];
  assert.equal(item.source, 'github');
  assert.equal(item.actor, 'Zene8/AgentSystem');
  assert.match(item.subject, /^\[assign\] /);
  assert.match(item.body, /reason: assign/);
});

test('poll advances the cursor to the newest item seen, filtered ones included', () => {
  // A stream of uninteresting notifications must not pin the cursor, or every later poll re-reads
  // them for nothing.
  const { run } = stub([
    notification({ id: '9', reason: 'subscribed', updated_at: '2026-08-22T15:00:00Z' }),
    notification({ id: '1', updated_at: '2026-08-22T10:00:00Z' }),
  ]);
  const out = poll({ cursor: '2026-08-22T09:00:00.000Z', policy: POLICY, runGh: run });
  assert.equal(out.items.length, 1);
  assert.equal(out.cursor, '2026-08-22T15:00:00.000Z');
  assert.equal(out.seen, 2);
});

test('poll never moves the cursor backwards', () => {
  const { run } = stub([notification({ updated_at: '2026-08-01T00:00:00Z' })]);
  const out = poll({ cursor: '2026-08-22T09:00:00.000Z', policy: POLICY, runGh: run });
  assert.equal(out.cursor, '2026-08-22T09:00:00.000Z');
});

test('poll on an empty page keeps the cursor and returns nothing', () => {
  const { run } = stub([]);
  const out = poll({ cursor: '2026-08-22T09:00:00.000Z', policy: POLICY, runGh: run });
  assert.deepEqual(out.items, []);
  assert.equal(out.cursor, '2026-08-22T09:00:00.000Z');
});

test('poll skips one malformed notification instead of losing the rest of the page', () => {
  const { run } = stub([
    notification({ id: '1' }),
    notification({ id: '2', updated_at: 'not a date' }),
    null,
    notification({ id: '3' }),
  ]);
  const out = poll({ cursor: null, policy: POLICY, runGh: run });
  assert.equal(out.items.length, 2);
  assert.equal(out.invalid.length, 1);
  assert.equal(out.invalid[0].id, '2');
});

test('poll truncates an enormous title rather than handing the bus an oversized payload', () => {
  const { run } = stub([notification({
    subject: { title: 'x'.repeat(9000), type: 'Issue', url: 'https://api.github.com/repos/a/b/issues/1' },
  })]);
  const out = poll({ cursor: null, policy: POLICY, runGh: run });
  assert.ok(out.items[0].body.length <= 4000);
});

test('poll throws on a transport failure — that is the adapter broken, not one bad item', () => {
  const boom = () => { throw new Error('gh api failed: HTTP 401: Bad credentials'); };
  assert.throws(() => poll({ policy: POLICY, runGh: boom }), /Bad credentials/);
});

test('poll throws when the API does not return an array', () => {
  assert.throws(() => poll({ policy: POLICY, runGh: () => ({ message: 'Not Found' }) }),
    /did not return an array/);
});
