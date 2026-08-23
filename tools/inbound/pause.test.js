// Tests for tools/inbound/pause.js — the kill switch.
//
// Every test passes an explicit temp dir, so nothing here touches the real per-host cache and a
// test run can never leave the developer's own inbound pipeline paused.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PAUSE_FILENAME, inboundDir, isPaused, pause, pausePath, resume, state } from './pause.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-pause-')); }

test('a fresh host is not paused', () => {
  const dir = tmpDir();
  assert.equal(isPaused(dir), false);
  assert.deepEqual(state(dir), { paused: false, pausedAt: null, reason: null, file: pausePath(dir) });
});

test('pause creates the sentinel and isPaused sees it', () => {
  const dir = tmpDir();
  const r = pause('spam wave from gmail', dir);
  assert.equal(r.paused, true);
  assert.equal(r.reason, 'spam wave from gmail');
  assert.match(r.pausedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(isPaused(dir), true);
  assert.equal(fs.existsSync(path.join(dir, PAUSE_FILENAME)), true);
});

test('pause works when the inbound dir does not exist yet', () => {
  const dir = path.join(tmpDir(), 'not', 'created', 'yet');
  assert.equal(pause('x', dir).paused, true);
  assert.equal(isPaused(dir), true);
});

test('pausing twice keeps the FIRST reason and timestamp', () => {
  const dir = tmpDir();
  const first = pause('the real reason', dir);
  const second = pause('a later, less useful reason', dir);
  assert.equal(second.reason, 'the real reason');
  assert.equal(second.pausedAt, first.pausedAt);
});

test('resume clears it and reports what it cleared', () => {
  const dir = tmpDir();
  pause('classifier misfiring', dir);
  const r = resume(dir);
  assert.equal(r.paused, false);
  assert.equal(r.wasPaused, true);
  assert.equal(r.reason, 'classifier misfiring');
  assert.equal(isPaused(dir), false);
});

test('resume on a running host is a stated no-op, not an error', () => {
  const dir = tmpDir();
  const r = resume(dir);
  assert.equal(r.paused, false);
  assert.equal(r.wasPaused, false);
});

test('a hand-created sentinel with no JSON still counts as paused', () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pausePath(dir), 'stop it\n');
  assert.equal(isPaused(dir), true);
  const s = state(dir);
  assert.equal(s.paused, true);
  assert.match(s.reason, /no readable reason/);
});

test('an empty sentinel file counts as paused — existence is the signal', () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pausePath(dir), '');
  assert.equal(isPaused(dir), true);
});

test('the reason is capped so a pasted log cannot become the sentinel', () => {
  const dir = tmpDir();
  assert.equal(pause('z'.repeat(900), dir).reason.length, 500);
});

test('the default location is the per-host cache dir, never the synced brain', () => {
  const dir = inboundDir();
  assert.match(dir, /agentsystem[\\/]inbound$/);
  assert.equal(dir.includes('agent-memory'), false,
    'a pause on the server must not pause the laptop, and must not need a brain sync');
});
