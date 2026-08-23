// Tests for tools/inbound/caps.js — the per-source daily action ceiling.
//
// Every call takes an explicit `file` and an explicit `now`, so nothing reads the real per-host
// counter and the day-rollover cases do not need a clock that moves.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CAPS_FILENAME, capsPath, claimAction, readCaps, usage, utcDay } from './caps.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-caps-')), CAPS_FILENAME);
}

const T1 = new Date('2026-08-22T10:00:00.000Z');
const T2 = new Date('2026-08-22T23:59:59.000Z'); // same UTC day
const NEXT = new Date('2026-08-23T00:00:01.000Z'); // next UTC day

test('utcDay is the UTC calendar date, so every host agrees on the boundary', () => {
  assert.equal(utcDay(T1), '2026-08-22');
  assert.equal(utcDay(T2), '2026-08-22');
  assert.equal(utcDay(NEXT), '2026-08-23');
});

test('a fresh host has spent nothing', () => {
  const file = tmpFile();
  assert.deepEqual(readCaps(file), {});
  const u = usage('github', 5, { file, now: T1 });
  assert.deepEqual(u, {
    source: 'github', day: '2026-08-22', used: 0, limit: 5, remaining: 5, atCap: false,
  });
});

test('claimAction spends one slot at a time and the file records it', () => {
  const file = tmpFile();
  const a = claimAction('github', 3, { file, now: T1 });
  assert.equal(a.allowed, true);
  assert.equal(a.used, 1);
  assert.equal(a.remaining, 2);
  assert.deepEqual(readCaps(file), { github: { day: '2026-08-22', count: 1 } });

  claimAction('github', 3, { file, now: T1 });
  const c = claimAction('github', 3, { file, now: T1 });
  assert.equal(c.allowed, true);
  assert.equal(c.remaining, 0);
});

test('over the cap the answer is a refusal with reason daily-cap, and nothing is written', () => {
  const file = tmpFile();
  claimAction('github', 1, { file, now: T1 });
  const over = claimAction('github', 1, { file, now: T1 });
  assert.equal(over.allowed, false);
  assert.equal(over.reason, 'daily-cap');
  assert.equal(over.used, 1, 'a refused claim must not inflate the count');
  assert.deepEqual(readCaps(file), { github: { day: '2026-08-22', count: 1 } });
});

test('the count is per source — one noisy inbox cannot spend another source budget', () => {
  const file = tmpFile();
  claimAction('github', 1, { file, now: T1 });
  const gmail = claimAction('gmail', 1, { file, now: T1 });
  assert.equal(gmail.allowed, true);
  assert.equal(usage('github', 1, { file, now: T1 }).atCap, true);
  assert.equal(usage('gmail', 1, { file, now: T1 }).atCap, true);
});

test('the count resets on the UTC day boundary, not before it', () => {
  const file = tmpFile();
  claimAction('github', 1, { file, now: T1 });
  assert.equal(claimAction('github', 1, { file, now: T2 }).allowed, false, 'still the same UTC day');
  const tomorrow = claimAction('github', 1, { file, now: NEXT });
  assert.equal(tomorrow.allowed, true);
  assert.equal(tomorrow.day, '2026-08-23');
  assert.deepEqual(readCaps(file), { github: { day: '2026-08-23', count: 1 } });
});

test('a missing limit is zero, not unlimited — an unattended inbox spawns nothing by default', () => {
  const file = tmpFile();
  for (const limit of [undefined, null, 'ten', -3, 2.5]) {
    const r = claimAction('gmail', limit, { file, now: T1 });
    assert.equal(r.allowed, false, `limit ${limit} must not allow a spawn`);
    assert.equal(r.reason, 'daily-cap');
  }
  assert.deepEqual(readCaps(file), {});
});

test('a limit of 0 is a legitimate "watch but never act" setting', () => {
  const file = tmpFile();
  const r = claimAction('notion', 0, { file, now: T1 });
  assert.equal(r.allowed, false);
  assert.equal(r.limit, 0);
});

test('a corrupt counter file reads as an empty day rather than jamming every source', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const junk of ['not json', '[]', 'null', '"x"']) {
    fs.writeFileSync(file, junk);
    assert.deepEqual(readCaps(file), {});
    assert.equal(usage('github', 2, { file, now: T1 }).used, 0);
  }
});

test('a garbled per-source entry is ignored without discarding the healthy ones', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    github: { day: '2026-08-22', count: 'lots' },
    gmail: { day: '2026-08-22', count: 4 },
  }));
  assert.equal(usage('github', 5, { file, now: T1 }).used, 0);
  assert.equal(usage('gmail', 5, { file, now: T1 }).used, 4);
});

test('claimAction creates the cache dir when it does not exist', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caps-mk-')), 'deep', 'dir', CAPS_FILENAME);
  assert.equal(claimAction('github', 1, { file, now: T1 }).allowed, true);
  assert.equal(fs.existsSync(file), true);
});

test('the default counter lives in the per-host cache dir, never in the synced brain', () => {
  const p = capsPath();
  assert.match(p, /agentsystem[\\/]inbound[\\/]caps\.json$/);
  assert.equal(p.includes('agent-memory'), false,
    'two hosts writing one counter daily would conflict on every brain sync');
});
