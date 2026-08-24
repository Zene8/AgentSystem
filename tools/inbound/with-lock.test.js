// Tests for tools/inbound/with-lock.js — the shared-arbiter wrapper.
//
// The lock itself is tested in tools/daily-triage-lock.test.js; what matters here is the
// contract around it: the pass runs at most once, a lost race is a stand-down and not an error,
// and the lock is always released even when the pass throws.

import test from 'node:test';
import assert from 'node:assert/strict';

import { deferredMessage, withTriageLock } from './with-lock.js';

function fakeLock({ acquired = true, holder = null } = {}) {
  const calls = { acquire: 0, release: 0 };
  return {
    calls,
    acquire: () => { calls.acquire += 1; return { acquired, holder }; },
    release: () => { calls.release += 1; return true; },
  };
}

test('holding the lock, the pass runs once and the lock is released', () => {
  const lock = fakeLock();
  let ran = 0;
  const out = withTriageLock(() => { ran += 1; return 'summary'; }, { lock });
  assert.deepEqual(out, { ran: true, result: 'summary' });
  assert.equal(ran, 1);
  assert.equal(lock.calls.release, 1);
});

test('a lost race runs nothing, releases nothing, and reports the holder', () => {
  const holder = { host: 'baselyserver', pid: 4242, at: '2026-08-22T13:00:00.000Z' };
  const lock = fakeLock({ acquired: false, holder });
  let ran = 0;
  const out = withTriageLock(() => { ran += 1; }, { lock });
  assert.equal(out.ran, false);
  assert.deepEqual(out.holder, holder);
  assert.equal(ran, 0);
  assert.equal(lock.calls.release, 0, 'releasing a lock we never held would free another run lock');
});

test('a throwing pass still releases the lock', () => {
  const lock = fakeLock();
  assert.throws(() => withTriageLock(() => { throw new Error('adapter blew up'); }, { lock }),
    /adapter blew up/);
  assert.equal(lock.calls.release, 1,
    'without the finally, one crash silences dispatch for the whole 200-minute stale window');
});

test('deferredMessage names the holder and says nothing is lost', () => {
  const msg = deferredMessage({ host: 'baselyserver', pid: 7, at: '2026-08-22T13:00:00.000Z' });
  assert.match(msg, /baselyserver:7/);
  assert.match(msg, /nothing is lost/);
  assert.match(deferredMessage(null), /unknown holder/);
});
