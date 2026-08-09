#!/usr/bin/env node
// Locking for the continuous-sync runners (#341).
//
// The scenario this exists for: a 15-minute host timer and a SessionEnd hook firing at the same
// second on the same checkout. Two `git commit`s racing in one repo is not something brain-sync.js
// defends against, and the failure mode (index.lock, a half-staged commit) is exactly the kind of
// mess that later shows up as "conflict needing a human" on an unrelated job.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { acquireLock, releaseLock, readLock, isStale } from './sync-lock.js';

const scratch = () => mkdtempSync(join(tmpdir(), 'sync-lock-'));

test('acquires a free lock and writes a readable holder record', () => {
  const file = join(scratch(), 'a.lock');
  const held = acquireLock(file);
  assert.equal(held.acquired, true);
  assert.ok(existsSync(file));

  const rec = readLock(file);
  assert.equal(rec.pid, process.pid);
  assert.ok(rec.host);
  assert.ok(Number.isFinite(Date.parse(rec.at)));
});

test('a second acquire while held is refused, and names the holder', () => {
  const file = join(scratch(), 'b.lock');
  assert.equal(acquireLock(file).acquired, true);

  const second = acquireLock(file);
  assert.equal(second.acquired, false);
  assert.equal(second.holder.pid, process.pid);
});

test('a stale lock is taken over', () => {
  const file = join(scratch(), 'c.lock');
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  writeFileSync(file, JSON.stringify({ pid: 999999, host: 'ghost', at: old }));

  const held = acquireLock(file, { staleMs: 60_000 });
  assert.equal(held.acquired, true);
  assert.equal(readLock(file).pid, process.pid);
});

test('an unparseable lock file is treated as stale, not as a permanent block', () => {
  const file = join(scratch(), 'd.lock');
  writeFileSync(file, 'half-written garbage');
  assert.equal(readLock(file), null);
  assert.equal(isStale(null), true);
  assert.equal(acquireLock(file).acquired, true);
});

test('release removes only our own lock', () => {
  const file = join(scratch(), 'e.lock');
  const held = acquireLock(file);

  // Someone else took the lock over after we went stale. Releasing must not delete their record.
  writeFileSync(file, JSON.stringify({ pid: 1, host: 'other', at: new Date().toISOString() }));
  releaseLock(file, held.token);
  assert.ok(existsSync(file), 'released a lock that was no longer ours');
  assert.equal(readLock(file).host, 'other');
});

test('release of our own lock removes the file', () => {
  const file = join(scratch(), 'f.lock');
  const held = acquireLock(file);
  assert.equal(releaseLock(file, held.token), true);
  assert.equal(existsSync(file), false);
});

test('isStale is time-based and tolerates a missing timestamp', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(isStale({ at: '2026-01-01T00:00:00Z' }, { staleMs: 1000, now }), false);
  assert.equal(isStale({ at: '2025-12-31T23:00:00Z' }, { staleMs: 1000, now }), true);
  assert.equal(isStale({ pid: 3 }, { staleMs: 1000, now }), true);
});
