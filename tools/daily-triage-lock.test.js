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
// GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT are deliberately stripped from the inherited env, not just left
// alone: `npm test` itself runs inside an Actions job when this suite runs in CI, so `process.env`
// already carries a real run id. Leaving it in would make every "different run" test below silently
// pass as "same run" (both children inheriting the CI job's own id) and mask the exact bug #418
// exists to catch — tests must set GITHUB_RUN_ID explicitly, per invocation, to mean anything.
const run = (args, lockFile, extraEnv = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8',
  env: { ...process.env, GITHUB_RUN_ID: '', GITHUB_RUN_ATTEMPT: '', DAILY_TRIAGE_LOCK_FILE: lockFile, ...extraEnv },
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

// #418: a scheduled Actions run must never mistake its OWN in-progress record for a competitor.
test('acquire with the same GITHUB_RUN_ID as the in-progress holder proceeds, not yields', () => {
  const lock = join(scratch(), 'self.lock');
  const first = run(['acquire'], lock, { GITHUB_RUN_ID: '31710023950' });
  assert.equal(first.status, 0, first.stdout + first.stderr);

  // A second invocation carrying the SAME run id as the record already on disk — e.g. a retried
  // step, or anything re-checking the lock within the same Actions run — is this run, not a
  // competing one, and must proceed.
  const second = run(['acquire'], lock, { GITHUB_RUN_ID: '31710023950' });
  assert.equal(second.status, 0, `same-run acquire must proceed, not yield: ${second.stdout}${second.stderr}`);
  assert.match(second.stdout, /acquired/);
});

test('acquire with a DIFFERENT GITHUB_RUN_ID than the in-progress holder still yields', () => {
  const lock = join(scratch(), 'other.lock');
  const first = run(['acquire'], lock, { GITHUB_RUN_ID: '31672750743' });
  assert.equal(first.status, 0, first.stdout + first.stderr);

  const second = run(['acquire'], lock, { GITHUB_RUN_ID: '31710023950' });
  assert.equal(second.status, 1, 'a genuinely different run id must still be refused the lock');
  assert.match(second.stdout, /deferring/);
});
