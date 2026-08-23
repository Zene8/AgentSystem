// Tests for tools/inbound/cursor.js.
//
// cacheDir() resolves XDG_CACHE_HOME first, ahead of LOCALAPPDATA, so setting it here redirects the
// whole state directory into a temp dir on every platform including Windows. It is read per call,
// so it is enough to set it before the first cursor call.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANDBOX = mkdtempSync(join(tmpdir(), 'inbound-cursor-'));
process.env.XDG_CACHE_HOME = SANDBOX;

const {
  SEEN_RING_SIZE,
  inboundStateDir,
  cursorPath,
  pausePath,
  isPaused,
  pause,
  resume,
  readCursor,
  writeCursor,
  advanceCursor,
  dropSeen,
  isStale,
} = await import('./cursor.js');

const { CADENCE_INTERVAL_MS } = await import('./policy.js');

test('state lives under cacheDir()/inbound, not tmpdir and not the brain', () => {
  const dir = inboundStateDir();
  assert.equal(dir, join(SANDBOX, 'agentsystem', 'inbound'));
  assert.ok(!dir.includes('agent-memory'), 'a 2-min cursor must never sit in the synced brain');
  assert.equal(cursorPath('github'), join(dir, 'github.json'));
});

test('cursorPath rejects an unknown source', () => {
  assert.throws(() => cursorPath('slack'), /unknown source/);
});

test('an absent cursor reads as empty, which means poll from the beginning', () => {
  const state = readCursor('notion');
  assert.deepEqual(state, { cursor: null, lastRunAt: null, seenIds: [] });
});

test('writeCursor then readCursor round-trips', () => {
  writeCursor('github', { cursor: '2026-08-22T10:00:00Z', lastRunAt: '2026-08-22T10:00:01Z', seenIds: ['a', 'b'] });
  const state = readCursor('github');
  assert.equal(state.cursor, '2026-08-22T10:00:00Z');
  assert.equal(state.lastRunAt, '2026-08-22T10:00:01Z');
  assert.deepEqual(state.seenIds, ['a', 'b']);
});

test('writeCursor stamps lastRunAt when the caller omits it', () => {
  const before = Date.now();
  const written = writeCursor('notion', { cursor: 'x', seenIds: [] });
  assert.ok(new Date(written.lastRunAt).getTime() >= before);
});

test('writeCursor leaves no tmp file behind — the rename is the commit', () => {
  writeCursor('beeper', { cursor: '1', seenIds: [] });
  const leftovers = readdirSync(inboundStateDir()).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('seenIds is a bounded ring, keeping the NEWEST entries', () => {
  const many = Array.from({ length: SEEN_RING_SIZE + 50 }, (_, i) => `id-${i}`);
  const written = writeCursor('gmail', { cursor: 'c', seenIds: many });
  assert.equal(written.seenIds.length, SEEN_RING_SIZE);
  assert.equal(written.seenIds.at(-1), `id-${SEEN_RING_SIZE + 49}`);
  assert.ok(!written.seenIds.includes('id-0'));
});

test('a present-but-corrupt cursor THROWS — absent would re-read the whole source', () => {
  mkdirSync(inboundStateDir(), { recursive: true });
  writeFileSync(cursorPath('gmail'), '{not json', 'utf8');
  assert.throws(() => readCursor('gmail'), /does not parse as JSON/);

  writeFileSync(cursorPath('gmail'), '["array"]', 'utf8');
  assert.throws(() => readCursor('gmail'), /not an object/);

  writeFileSync(cursorPath('gmail'), '{"cursor":"x"}', 'utf8');
  assert.throws(() => readCursor('gmail'), /no seenIds array/);
});

test('advanceCursor merges new ids, keeps the old cursor when none is given, stamps lastRunAt', () => {
  writeCursor('github', { cursor: 'old', lastRunAt: '2026-01-01T00:00:00.000Z', seenIds: ['a'] });
  const now = new Date('2026-08-22T12:00:00Z');

  const kept = advanceCursor('github', { seenIds: ['b', 'b'], now });
  assert.equal(kept.cursor, 'old', 'a poll that found nothing must not reset the position');
  assert.deepEqual(kept.seenIds, ['a', 'b'], 'duplicates within one poll collapse');
  assert.equal(kept.lastRunAt, now.toISOString());

  const moved = advanceCursor('github', { cursor: 'new', seenIds: ['a'], now });
  assert.equal(moved.cursor, 'new');
  assert.deepEqual(moved.seenIds, ['a', 'b'], 'an id already in the ring is not appended twice');
});

test('an empty poll still stamps lastRunAt — it is the only liveness evidence (#362)', () => {
  const now = new Date('2026-08-22T13:00:00Z');
  const state = advanceCursor('beeper', { seenIds: [], now });
  assert.equal(state.lastRunAt, now.toISOString());
});

test('dropSeen filters known ids and de-duplicates within the batch', () => {
  const envelopes = [
    { externalId: 'a' }, { externalId: 'b' }, { externalId: 'b' }, { externalId: 'c' },
  ];
  assert.deepEqual(dropSeen(envelopes, ['a']).map(e => e.externalId), ['b', 'c']);
  assert.deepEqual(dropSeen(envelopes, []).map(e => e.externalId), ['a', 'b', 'c']);
  assert.deepEqual(dropSeen([], ['a']), []);
});

test('dropSeen compares as strings, so a numeric id still matches', () => {
  assert.deepEqual(dropSeen([{ externalId: 12 }], ['12']), []);
});

test('isStale: never-run is not stale, recent is not stale, old is', () => {
  const interval = CADENCE_INTERVAL_MS.fast;
  const now = Date.parse('2026-08-22T12:00:00Z');

  assert.equal(isStale({ lastRunAt: null }, interval, { now }), false, 'first install must not alert');
  assert.equal(isStale(null, interval, { now }), false);
  assert.equal(isStale({ lastRunAt: new Date(now - interval).toISOString() }, interval, { now }), false);
  assert.equal(isStale({ lastRunAt: new Date(now - interval * 2).toISOString() }, interval, { now }), false);
  assert.equal(isStale({ lastRunAt: new Date(now - interval * 4).toISOString() }, interval, { now }), true);
});

test('isStale treats an unparseable lastRunAt as stale', () => {
  assert.equal(isStale({ lastRunAt: 'whenever' }, 1000, { now: Date.now() }), true);
});

test('PAUSED sentinel: pause, detect, resume — one file, no ssh needed', () => {
  assert.equal(isPaused(), false);
  const file = pause('classifier misbehaving');
  assert.equal(file, pausePath());
  assert.equal(isPaused(), true);
  assert.match(readFileSync(file, 'utf8'), /classifier misbehaving/);

  assert.equal(resume(), true);
  assert.equal(isPaused(), false);
  assert.equal(resume(), false, 'resuming an unpaused system is a no-op, not an error');
  assert.equal(existsSync(pausePath()), false);
});

test('pause with no reason still writes a timestamped sentinel', () => {
  pause();
  assert.match(readFileSync(pausePath(), 'utf8').trim(), /^\d{4}-\d{2}-\d{2}T/);
  resume();
});
