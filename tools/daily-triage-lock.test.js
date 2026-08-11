#!/usr/bin/env node
// The scenario (#402): a manual `claude -p "Use the daily-triage skill..."` dispatch racing the
// scheduled Actions run. Each entry path is a separate process, so this exercises the CLI as a
// subprocess rather than importing acquire/release directly — the thing under test is exactly
// the token surviving between two independent invocations, which an in-process call would not
// catch.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'daily-triage-lock.js');

const scratch = () => mkdtempSync(join(tmpdir(), 'daily-triage-lock-'));
const run = (args, lockFile) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8', env: { ...process.env, DAILY_TRIAGE_LOCK_FILE: lockFile },
});

test('acquire succeeds, a second concurrent acquire is refused and says so', () => {
  const lock = join(scratch(), 'x.lock');
  const first = run(['acquire'], lock);
  assert.equal(first.status, 0, first.stdout + first.stderr);

  const second = run(['acquire'], lock); // the manual-run-vs-scheduled-run collision
  assert.equal(second.status, 1, 'a second concurrent run must be refused the lock, not proceed');
  assert.match(second.stdout, /deferring/);
});

test('release from a later, separate process (step 6 is a different bash call than step 1) frees it', () => {
  const lock = join(scratch(), 'y.lock');
  assert.equal(run(['acquire'], lock).status, 0);

  const released = run(['release'], lock);
  assert.equal(released.status, 0);
  assert.equal(existsSync(lock), false, 'release must remove the lock file');
  assert.equal(existsSync(`${lock}.token`), false, 'release must remove the sidecar token');

  assert.equal(run(['acquire'], lock).status, 0, 'a fresh run can proceed once released');
});

test('release with nothing held is a no-op, not a crash', () => {
  const lock = join(scratch(), 'z.lock');
  const r = run(['release'], lock);
  assert.equal(r.status, 0);
});
