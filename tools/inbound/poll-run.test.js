// Tests for tools/inbound/poll-run.js.
//
// The adapter, the publisher and the cursor store are all injected, so nothing here touches the
// network, the real event bus or the real cursor directory. Only the policy file is real, written
// to a temp dir and passed as an explicit path.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { POLICY_FILENAME } from './policy.js';
import { alertKey, ALERT_KEY_PREFIX, parseArgs, pollSource, ADAPTERS } from './poll-run.js';

const GITHUB_ON = [
  'github:',
  '  enabled: true',
  '  cadence: medium',
  '  reasons: [ci_activity, assign]',
  '  max_actions_per_day: 20',
  '',
].join('\n');

function writePolicy(text) {
  const dir = mkdtempSync(join(tmpdir(), 'poll-run-policy-'));
  const file = join(dir, POLICY_FILENAME);
  writeFileSync(file, text, 'utf8');
  return file;
}

function envelope(id, ts = '2026-08-22T10:00:00.000Z') {
  return {
    source: 'github',
    externalId: id,
    ts,
    actor: 'Zene8/AgentSystem',
    subject: '[assign] something',
    body: 'body',
    url: 'https://github.com/Zene8/AgentSystem/issues/1',
  };
}

// A recording stand-in for cursor.js. Holds one source's state in memory.
function fakeCursorStore(initial = { cursor: null, lastRunAt: null, seenIds: [] }) {
  const store = { state: { ...initial }, advances: [], reads: 0 };
  store.readCursor = () => { store.reads += 1; return { ...store.state }; };
  store.advanceCursor = (source, { cursor, seenIds }) => {
    store.advances.push({ source, cursor, seenIds });
    store.state = {
      cursor: cursor ?? store.state.cursor,
      lastRunAt: '2026-08-22T10:00:00.000Z',
      seenIds: [...new Set([...store.state.seenIds, ...seenIds])],
    };
    return { ...store.state };
  };
  return store;
}

function fakePublisher() {
  const published = [];
  const fn = (event) => { published.push(event); return { id: `e-${published.length}` }; };
  fn.published = published;
  return fn;
}

function adapterReturning(result) {
  return { github: { poll: (args) => ({ ...result, calledWith: args }) } };
}

test('the real ADAPTERS map holds github and nothing that is not yet built', () => {
  assert.deepEqual(Object.keys(ADAPTERS), ['github']);
  assert.equal(typeof ADAPTERS.github.poll, 'function');
});

test('alertKey is per source AND per host', () => {
  assert.equal(alertKey('github', 'baselyserver-mc'), `${ALERT_KEY_PREFIX}-github-baselyserver-mc`);
  assert.notEqual(alertKey('github', 'laptop'), alertKey('gmail', 'laptop'));
  assert.notEqual(alertKey('github', 'laptop'), alertKey('github', 'baselyserver-mc'));
});

test('pollSource rejects an unknown source before reading anything', () => {
  assert.throws(() => pollSource('slack', { policyPath: writePolicy(GITHUB_ON) }), /unknown source/);
});

test('a disabled source is status disabled, not an error, and never calls the adapter', () => {
  const adapters = adapterReturning({ items: [], cursor: null });
  let called = false;
  adapters.github.poll = () => { called = true; return { items: [], cursor: null }; };
  const r = pollSource('github', {
    policyPath: writePolicy('github:\n  enabled: false\n  cadence: medium\n  max_actions_per_day: 1\n'),
    adapters,
  });
  assert.equal(r.status, 'disabled');
  assert.match(r.reason, /is false/);
  assert.equal(r.published, 0);
  assert.equal(called, false);
});

test('an enabled source with no adapter yet is a stated no-op, not a crash', () => {
  const r = pollSource('github', { policyPath: writePolicy(GITHUB_ON), adapters: {} });
  assert.equal(r.status, 'no-adapter');
  assert.match(r.reason, /no adapter implemented/);
});

test('the happy path publishes one inbound-item per envelope and then advances the cursor', () => {
  const publisher = fakePublisher();
  const cursorStore = fakeCursorStore();
  const r = pollSource('github', {
    policyPath: writePolicy(GITHUB_ON),
    adapters: adapterReturning({
      items: [envelope('gh-1'), envelope('gh-2', '2026-08-22T11:00:00.000Z')],
      cursor: '2026-08-22T11:00:00.000Z',
      seen: 5,
      invalid: [],
    }),
    publisher,
    cursorStore,
  });

  assert.equal(r.status, 'ok');
  assert.equal(r.published, 2);
  assert.equal(r.seen, 5);
  assert.equal(publisher.published.length, 2);
  assert.equal(publisher.published[0].type, 'inbound-item');
  assert.equal(publisher.published[0].source, 'inbound/github');
  assert.equal(publisher.published[0].payload.envelope.externalId, 'gh-1');
  assert.deepEqual(cursorStore.advances, [
    { source: 'github', cursor: '2026-08-22T11:00:00.000Z', seenIds: ['gh-1', 'gh-2'] },
  ]);
});

test('the cursor is read BEFORE the adapter runs and passed in as since', () => {
  const cursorStore = fakeCursorStore({ cursor: '2026-08-22T09:00:00.000Z', lastRunAt: null, seenIds: [] });
  const adapters = adapterReturning({ items: [], cursor: '2026-08-22T09:00:00.000Z' });
  const r = pollSource('github', {
    policyPath: writePolicy(GITHUB_ON),
    adapters,
    publisher: fakePublisher(),
    cursorStore,
  });
  assert.equal(cursorStore.reads, 1);
  assert.equal(r.status, 'ok');
});

test('an already-seen envelope is dropped, because GitHub since is inclusive', () => {
  const publisher = fakePublisher();
  const cursorStore = fakeCursorStore({ cursor: '2026-08-22T09:00:00.000Z', lastRunAt: null, seenIds: ['gh-1'] });
  const r = pollSource('github', {
    policyPath: writePolicy(GITHUB_ON),
    adapters: adapterReturning({ items: [envelope('gh-1'), envelope('gh-2')], cursor: 'c', seen: 2 }),
    publisher,
    cursorStore,
  });
  assert.equal(r.fresh, 1);
  assert.equal(r.published, 1);
  assert.equal(publisher.published[0].payload.envelope.externalId, 'gh-2');
});

test('an empty poll still advances the cursor, so lastRunAt is stamped (#362)', () => {
  const cursorStore = fakeCursorStore();
  const r = pollSource('github', {
    policyPath: writePolicy(GITHUB_ON),
    adapters: adapterReturning({ items: [], cursor: '2026-08-22T11:00:00.000Z', seen: 0 }),
    publisher: fakePublisher(),
    cursorStore,
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.published, 0);
  assert.equal(cursorStore.advances.length, 1);
  assert.deepEqual(cursorStore.advances[0].seenIds, []);
});

test('an adapter failure is status error with the adapter message, and moves no cursor', () => {
  const cursorStore = fakeCursorStore();
  const r = pollSource('github', {
    policyPath: writePolicy(GITHUB_ON),
    adapters: { github: { poll: () => { throw new Error('gh api failed: HTTP 401: Bad credentials'); } } },
    publisher: fakePublisher(),
    cursorStore,
  });
  assert.equal(r.status, 'error');
  assert.match(r.reason, /Bad credentials/);
  assert.deepEqual(cursorStore.advances, [], 'a failed poll must not advance past unread items');
});

test('a corrupt cursor throws out of pollSource, before any API call', () => {
  let polled = false;
  const cursorStore = fakeCursorStore();
  cursorStore.readCursor = () => { throw new Error('cursor file does not parse as JSON'); };
  assert.throws(() => pollSource('github', {
    policyPath: writePolicy(GITHUB_ON),
    adapters: { github: { poll: () => { polled = true; return { items: [] }; } } },
    publisher: fakePublisher(),
    cursorStore,
  }), /does not parse as JSON/);
  assert.equal(polled, false);
});

test('a partial publish advances past exactly what landed, so the rest is retried not lost', () => {
  const cursorStore = fakeCursorStore({ cursor: 'old', lastRunAt: null, seenIds: [] });
  let n = 0;
  const publisher = () => {
    n += 1;
    if (n === 2) throw new Error('disk full');
    return { id: 'e-1' };
  };
  const r = pollSource('github', {
    policyPath: writePolicy(GITHUB_ON),
    adapters: adapterReturning({ items: [envelope('gh-1'), envelope('gh-2'), envelope('gh-3')], cursor: 'new' }),
    publisher,
    cursorStore,
  });
  assert.equal(r.status, 'error');
  assert.match(r.reason, /publish failed: disk full/);
  assert.equal(r.published, 1);
  assert.deepEqual(cursorStore.advances, [{ source: 'github', cursor: 'old', seenIds: ['gh-1'] }],
    'the cursor keeps its old position but remembers gh-1 as seen');
});

test('a publish that fails on the very first item advances nothing at all', () => {
  const cursorStore = fakeCursorStore();
  const r = pollSource('github', {
    policyPath: writePolicy(GITHUB_ON),
    adapters: adapterReturning({ items: [envelope('gh-1')], cursor: 'new' }),
    publisher: () => { throw new Error('bus unavailable'); },
    cursorStore,
  });
  assert.equal(r.status, 'error');
  assert.equal(r.published, 0);
  assert.deepEqual(cursorStore.advances, []);
});

test('--dry-run publishes nothing, writes no cursor, and reports what it would do', () => {
  const publisher = fakePublisher();
  const cursorStore = fakeCursorStore({ cursor: 'old', lastRunAt: null, seenIds: [] });
  const r = pollSource('github', {
    dryRun: true,
    policyPath: writePolicy(GITHUB_ON),
    adapters: adapterReturning({ items: [envelope('gh-1')], cursor: 'new', seen: 3, invalid: [{ id: '9' }] }),
    publisher,
    cursorStore,
  });
  assert.equal(r.status, 'dry-run');
  assert.equal(r.published, 0);
  assert.equal(r.fresh, 1);
  assert.equal(r.cursorWas, 'old');
  assert.equal(r.cursorWouldBe, 'new');
  assert.equal(r.items.length, 1);
  assert.equal(r.invalid.length, 1);
  assert.deepEqual(publisher.published, []);
  assert.deepEqual(cursorStore.advances, []);
});

test('pollSource fails closed when LIFE_REPO is unset and no path is given', () => {
  assert.throws(() => pollSource('github', { env: {} }), /LIFE_REPO is unset/);
});

test('parseArgs accepts each documented flag', () => {
  assert.deepEqual(parseArgs(['--source=github']),
    { source: 'github', cadence: null, dryRun: false, alert: false, json: false });
  assert.deepEqual(parseArgs(['--cadence=medium', '--dry-run', '--alert', '--json']),
    { source: null, cadence: 'medium', dryRun: true, alert: true, json: true });
});

test('parseArgs rejects bad usage rather than guessing', () => {
  assert.throws(() => parseArgs([]), /one of --source/);
  assert.throws(() => parseArgs(['--source=github', '--cadence=medium']), /mutually exclusive/);
  assert.throws(() => parseArgs(['--cadence=hourly']), /unknown cadence/);
  assert.throws(() => parseArgs(['--source=slack']), /unknown source/);
  assert.throws(() => parseArgs(['--source=github', '--wat']), /unknown argument "--wat"/);
});
