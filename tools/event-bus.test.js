// Event bus: durable queue semantics — publish/claim/complete/fail with exponential
// backoff, dead-letter + alert on exhausted attempts, stale-claim recovery, requeue.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as bus from './event-bus.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'event-bus-')); }

test('publish: creates a queue file with defaults; list returns FIFO', () => {
  const root = tmpRoot();
  const a = bus.publish({ type: 'noop', payload: { n: 1 } }, root);
  const b = bus.publish({ type: 'noop', payload: { n: 2 } }, root);
  assert.equal(a.attempts, 0);
  assert.equal(a.maxAttempts, bus.DEFAULT_MAX_ATTEMPTS);
  const pending = bus.listPending(root);
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map(p => p.event.payload.n), [1, 2]);
  assert.notEqual(a.id, b.id);
});

test('publish: rejects event without a type', () => {
  assert.throws(() => bus.publish({ payload: {} }, tmpRoot()), /type/);
});

test('claimNext: claims oldest, moves file into processing, second claim gets next event', () => {
  const root = tmpRoot();
  bus.publish({ type: 'noop', payload: { n: 1 } }, root);
  bus.publish({ type: 'noop', payload: { n: 2 } }, root);
  const c1 = bus.claimNext(root);
  const c2 = bus.claimNext(root);
  assert.equal(c1.event.payload.n, 1);
  assert.equal(c2.event.payload.n, 2);
  assert.ok(fs.existsSync(c1.claimFile));
  assert.equal(bus.claimNext(root), null);
  assert.equal(bus.listPending(root).length, 0);
});

test('claimNext: skips events whose nextAttemptAt is in the future', () => {
  const root = tmpRoot();
  const future = new Date(Date.now() + 3600_000).toISOString();
  bus.publish({ type: 'noop', nextAttemptAt: future }, root);
  assert.equal(bus.claimNext(root), null);
  // eligible when "now" passes nextAttemptAt
  assert.ok(bus.claimNext(root, Date.now() + 3601_000));
});

test('complete: appends to done.jsonl with result and removes claim file', () => {
  const root = tmpRoot();
  bus.publish({ type: 'noop' }, root);
  const claim = bus.claimNext(root);
  bus.complete(claim, root, 'the-result');
  assert.ok(!fs.existsSync(claim.claimFile));
  const done = fs.readFileSync(bus.dirs(root).done, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(done.length, 1);
  assert.equal(done[0].result, 'the-result');
  assert.equal(bus.stats(root).done, 1);
});

test('fail below maxAttempts: requeues with exponential backoff and lastError', () => {
  const root = tmpRoot();
  bus.publish({ type: 'noop', maxAttempts: 3 }, root);
  const now = Date.now();
  const claim = bus.claimNext(root, now);
  assert.equal(bus.fail(claim, new Error('boom'), root, now), 'requeued');
  const [p] = bus.listPending(root);
  assert.equal(p.event.attempts, 1);
  assert.equal(p.event.lastError, 'boom');
  const delay = Date.parse(p.event.nextAttemptAt) - now;
  assert.equal(delay, bus.BACKOFF_BASE_MS); // first retry: base * 2^0
  // second failure doubles the backoff
  const claim2 = bus.claimNext(root, now + bus.BACKOFF_BASE_MS + 1);
  assert.equal(bus.fail(claim2, 'boom2', root, now), 'requeued');
  const [p2] = bus.listPending(root);
  assert.equal(Date.parse(p2.event.nextAttemptAt) - now, bus.BACKOFF_BASE_MS * 2);
});

test('fail at maxAttempts: dead-letters the event and writes an alert', () => {
  const root = tmpRoot();
  bus.publish({ type: 'noop', maxAttempts: 1 }, root);
  const claim = bus.claimNext(root);
  assert.equal(bus.fail(claim, new Error('fatal'), root), 'dead');
  assert.equal(bus.listPending(root).length, 0);
  const d = bus.dirs(root);
  const dead = fs.readFileSync(d.dead, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(dead.length, 1);
  assert.equal(dead[0].lastError, 'fatal');
  const alerts = fs.readFileSync(d.alerts, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(alerts[0].kind, 'event-dead-letter');
  assert.equal(alerts[0].eventId, dead[0].id);
});

test('requeueDead: dead events return to the queue with attempts reset, dead log truncated', () => {
  const root = tmpRoot();
  bus.publish({ type: 'noop', maxAttempts: 1 }, root);
  bus.fail(bus.claimNext(root), 'x', root);
  assert.equal(bus.requeueDead(root), 1);
  const [p] = bus.listPending(root);
  assert.equal(p.event.attempts, 0);
  assert.equal(bus.stats(root).dead, 0);
});

test('recoverStale: requeues old processing claims as a failed attempt, leaves fresh ones', () => {
  const root = tmpRoot();
  bus.publish({ type: 'noop' }, root);
  bus.publish({ type: 'noop' }, root);
  const stale = bus.claimNext(root);
  bus.claimNext(root); // fresh claim, stays
  const old = Date.now() - 60 * 60 * 1000;
  fs.utimesSync(stale.claimFile, old / 1000, old / 1000);
  const recovered = bus.recoverStale(root, 15 * 60 * 1000);
  assert.equal(recovered, 1);
  const pending = bus.listPending(root);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].event.attempts, 1);
  assert.match(pending[0].event.lastError, /stale claim/);
});

test('stats: counts every state', () => {
  const root = tmpRoot();
  bus.publish({ type: 'noop' }, root);
  bus.publish({ type: 'noop' }, root);
  bus.publish({ type: 'noop', maxAttempts: 1 }, root);
  bus.complete(bus.claimNext(root), root);
  bus.fail(bus.claimNext(root), 'x', root); // maxAttempts 3 → requeued... claims FIFO
  const s = bus.stats(root);
  assert.equal(s.done, 1);
  assert.equal(s.pending + s.processing + s.dead, 2);
});

test('publish: rejects unknown types, non-object payloads, and oversized payloads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'event-bus-'));
  assert.throws(() => bus.publish({ type: 'mystery' }, root), /unknown event type/);
  assert.throws(() => bus.publish({ type: 'noop', payload: 'a string' }, root), /plain object/);
  assert.throws(() => bus.publish({ type: 'noop', payload: { big: 'x'.repeat(70000) } }, root), /too large/);
});
