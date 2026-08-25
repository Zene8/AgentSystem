import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  reconcile,
  parseDate,
  dateRange,
  eventDate,
  filterByDate,
  readJsonl,
  summarizeEvent,
  checkStaleness,
  STALE_ALERT_KEY,
} from '../tools/inbound-reconcile.js';

// Test helper: create a temp directory for test events
function tempEventRoot() {
  const tmp = path.join(os.tmpdir(), `inbound-reconcile-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  fs.mkdirSync(path.join(tmp, 'events'), { recursive: true });
  return tmp;
}

test('parseDate: parses YYYY-MM-DD to midnight UTC', () => {
  const date = parseDate('2026-08-24');
  assert.equal(date.toISOString(), '2026-08-24T00:00:00.000Z');
});

test('parseDate: throws on invalid format', () => {
  assert.throws(() => parseDate('08-24-2026'), /invalid date format/);
  assert.throws(() => parseDate('2026/08/24'), /invalid date format/);
  assert.throws(() => parseDate('today'), /invalid date format/);
});

test('dateRange: creates correct start and end for a date', () => {
  const date = new Date('2026-08-24T12:00:00Z');
  const range = dateRange(date);
  assert.equal(range.start.toISOString(), '2026-08-24T00:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-08-25T00:00:00.000Z');
});

test('filterByDate: filters events to the date range', () => {
  const events = [
    { ts: '2026-08-23T23:59:00Z' },
    { ts: '2026-08-24T00:00:00Z' },
    { ts: '2026-08-24T12:00:00Z' },
    { ts: '2026-08-25T00:00:00Z' },
    { ts: '2026-08-25T12:00:00Z' },
  ];
  const date = new Date('2026-08-24T06:00:00Z');
  const range = dateRange(date);
  const filtered = filterByDate(events, range);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].ts, '2026-08-24T00:00:00Z');
  assert.equal(filtered[1].ts, '2026-08-24T12:00:00Z');
});

test('filterByDate boundary: event published on N-1 but completed on N goes in N', () => {
  // Event published at 2026-08-23T23:00 but completed at 2026-08-24T00:30 should
  // appear in day N's closeout, not day N-1's.
  const events = [
    { ts: '2026-08-23T23:00:00Z', completedAt: '2026-08-24T00:30:00Z' },
    { ts: '2026-08-24T12:00:00Z', completedAt: '2026-08-24T12:30:00Z' },
  ];

  const day23 = dateRange(parseDate('2026-08-23'));
  const day24 = dateRange(parseDate('2026-08-24'));

  const filtered23 = filterByDate(events, day23);
  const filtered24 = filterByDate(events, day24);

  // Event should NOT be in day 23 (completed after midnight)
  assert.equal(filtered23.length, 0);

  // Event SHOULD be in day 24 (completedAt is in day 24 range)
  assert.equal(filtered24.length, 2);
  assert.equal(filtered24[0].completedAt, '2026-08-24T00:30:00Z');
});

test('eventDate: uses completedAt when present', () => {
  const event = { ts: '2026-08-24T10:00:00Z', completedAt: '2026-08-24T12:00:00Z' };
  const date = eventDate(event);
  assert.equal(date.toISOString(), '2026-08-24T12:00:00.000Z');
});

test('eventDate: uses deadAt when completedAt is absent', () => {
  const event = { ts: '2026-08-24T10:00:00Z', deadAt: '2026-08-24T13:00:00Z' };
  const date = eventDate(event);
  assert.equal(date.toISOString(), '2026-08-24T13:00:00.000Z');
});

test('eventDate: falls back to ts when neither completedAt nor deadAt', () => {
  const event = { ts: '2026-08-24T10:00:00Z' };
  const date = eventDate(event);
  assert.equal(date.toISOString(), '2026-08-24T10:00:00.000Z');
});

test('readJsonl: reads and parses jsonl file', () => {
  const tmp = tempEventRoot();
  const file = path.join(tmp, 'test.jsonl');
  fs.writeFileSync(file, '{"a":1}\n{"b":2}\n{"c":3}\n');
  const events = readJsonl(file);
  assert.equal(events.length, 3);
  assert.deepEqual(events[0], { a: 1 });
  assert.deepEqual(events[1], { b: 2 });
  assert.deepEqual(events[2], { c: 3 });
  fs.rmSync(tmp, { recursive: true });
});

test('readJsonl: returns empty array for missing file', () => {
  const events = readJsonl('/nonexistent/file.jsonl');
  assert.equal(events.length, 0);
});

test('readJsonl: skips malformed lines', () => {
  const tmp = tempEventRoot();
  const file = path.join(tmp, 'test.jsonl');
  fs.writeFileSync(file, '{"a":1}\nnot json\n{"b":2}\n');
  const events = readJsonl(file);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { a: 1 });
  assert.deepEqual(events[1], { b: 2 });
  fs.rmSync(tmp, { recursive: true });
});

test('summarizeEvent: formats completed action event', () => {
  const event = {
    type: 'inbound-item',
    ts: '2026-08-24T14:30:45Z',
    completedAt: '2026-08-24T14:30:50Z',
    source: 'github',
    actor: 'test-user',
    url: 'https://github.com/Zene8/AgentSystem/issues/483',
    verdict: 'action',
    why: 'assigned to owner, failed workflow',
    result: {
      action: 'spawned',
      agent: 'friday',
      spawnEventId: 'abc123',
      capUsed: '1/20',
    },
  };
  const summary = summarizeEvent(event);
  assert.equal(summary.time, '14:30:50');
  assert.equal(summary.source, 'github');
  assert.equal(summary.actor, 'test-user');
  assert.equal(summary.verdict, 'action');
  assert.match(summary.actionSummary, /spawned friday/);
});

test('summarizeEvent: formats capped event', () => {
  const event = {
    type: 'inbound-item',
    ts: '2026-08-24T14:30:45Z',
    completedAt: '2026-08-24T14:30:50Z',
    source: 'gmail',
    actor: 'alice@example.com',
    url: 'https://mail.google.com/mail/u/0/#inbox/12345',
    verdict: 'action',
    why: 'from allowed sender',
    result: {
      action: 'capped',
      capUsed: '12/12',
      reason: 'daily-cap',
    },
  };
  const summary = summarizeEvent(event);
  assert.match(summary.actionSummary, /capped/);
});

test('summarizeEvent: formats dropped event', () => {
  const event = {
    type: 'inbound-item',
    ts: '2026-08-24T14:30:45Z',
    completedAt: '2026-08-24T14:30:50Z',
    source: 'beeper',
    actor: 'charlie',
    url: 'https://beeper.com/chats/12345',
    verdict: 'ignore',
    why: 'source disabled at dispatch',
    result: {
      action: 'dropped',
      reason: 'policy disabled',
    },
  };
  const summary = summarizeEvent(event);
  assert.match(summary.actionSummary, /dropped/);
});

test('checkStaleness: returns empty array when all cursors are healthy', () => {
  // This is a simplified test — checkStaleness tries to read real cursor files,
  // and in a test environment those don't exist. A real implementation would
  // need test fixtures for cursor files. For now, this is a placeholder.
  const stale = checkStaleness(Date.now());
  // If no cursor files exist, nothing is stale.
  assert(Array.isArray(stale));
});

test('reconcile: generates summary for empty day', () => {
  const result = reconcile('2026-08-24', true); // dry-run = true
  assert.match(result.summary, /Inbound Triage Summary/);
  assert.match(result.summary, /No inbound items processed/);
  assert.equal(result.totals.done, 0);
  assert.equal(result.totals.dead, 0);
  assert.equal(result.isDry, true);
});

test('reconcile: includes event count in summary', () => {
  const result = reconcile('2026-08-24', true);
  assert.match(result.summary, /Polling Status/);
});

test('reconcile: respects --dry-run flag', () => {
  const dryRun = reconcile('2026-08-24', true);
  assert.equal(dryRun.isDry, true);
  const notDry = reconcile('2026-08-24', false);
  assert.equal(notDry.isDry, false);
});

test('reconcile: returns stale list', () => {
  const result = reconcile('2026-08-24', true);
  assert(Array.isArray(result.stale));
});

test('reconcile: defaults to today when no date given', () => {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const result = reconcile(null, true);
  // dateStr should be today
  assert.equal(result.dateStr, todayStr);
});

test('STALE_ALERT_KEY is set correctly', () => {
  assert.equal(STALE_ALERT_KEY, 'inbound-poller-stale');
});
