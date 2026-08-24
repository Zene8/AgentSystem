#!/usr/bin/env node
// daily-triage-lock.js — binds the stage-2 concurrency guard to the *skill* entry path (#402).
//
// `.github/workflows/scheduled-tasks.yml`'s `concurrency: group: scheduled-tasks-daily-triage`
// only serializes Actions runs. A manual `claude -p "Use the daily-triage skill and execute it
// now."` from a shell is not an Actions run, so it is invisible to that group — and that gap is
// exactly the collision that happened three times (issue #402): a scheduled run and a manual run
// both mid-flight, both appending to the same closeout file, both dispatching their own items.
//
// `tools/sync-lock.js` already implements the time-stale lockfile continuous-sync needs for the
// same shape of problem (#341) — reused here rather than reinvented. The lock lives in tmpdir(),
// outside both this repo and `~/agent-memory`, so neither a PR diff nor `brain-sync.js`'s
// `git add -A` ever touches it.
//
// Two subcommands because the skill's STEP 1 (acquire) and STEP 6 (release) are separate bash
// calls in the same session, and shell state does not persist between tool calls — the token
// `sync-lock.js` needs at release time has to survive on disk, not in a variable. `acquire`
// writes it to a sidecar file next to the lock; `release` reads it back and removes both.
//
// Usage:
//   node tools/daily-triage-lock.js acquire   # exit 0: lock held, proceed; exit 1: another run holds it
//   node tools/daily-triage-lock.js release   # best-effort; exit 0 either way
//
// Env:
//   DAILY_TRIAGE_LOCK_FILE  override the lock path (tests use this; real runs never need to).
//
// STALE_MS is set well above the skill's own 180-minute run cap (see the Caps table in
// skills/daily-triage/SKILL.md) so an in-progress run is never mistaken for abandoned, and well
// below the ~10h gap between scheduled runs (05:00/15:00 UTC, moved from 13:00 by #452), so a
// crashed run cannot block the next legitimate one for long.
//
// #418: this lock is meant to be the SOLE arbiter of "is another run in progress" (the durable
// fix from #402's own issue), but the arbiter is only correct if it can tell "another run" apart
// from "myself, again". Every Actions job step has GITHUB_RUN_ID (and GITHUB_RUN_ATTEMPT) in its
// environment automatically; a second `acquire` call carrying the SAME run id as the record
// already on disk cannot be a competing run by definition, so it must proceed rather than yield.
// Only actually-different run ids yield. Local/manual invocations have no GITHUB_RUN_ID at all
// (CI is the only place that sets it) so they always fall back to ordinary mutual exclusion —
// this bypass can only ever apply to an Actions run recognising its own id.

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { acquireLock, releaseLock } from './sync-lock.js';
import { isMainModule } from './is-main.js';

export const LOCK_FILE = process.env.DAILY_TRIAGE_LOCK_FILE
  || join(tmpdir(), 'agentsystem-daily-triage.lock');
export const STALE_MS = 200 * 60 * 1000; // 180min cap + slack, well under the ~10h schedule gap

export function acquire(lockFile = LOCK_FILE, staleMs = STALE_MS) {
  const runId = process.env.GITHUB_RUN_ID || null;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT || null;
  const meta = runId ? { runId, ...(runAttempt ? { runAttempt } : {}) } : {};
  const held = acquireLock(lockFile, {
    staleMs,
    meta,
    // Never self when we have no run id of our own (manual/local invocations) — only an Actions
    // run can recognise itself, and only against a holder record that was itself written by an
    // Actions run carrying the same id.
    isSelf: (holder) => Boolean(runId) && Boolean(holder) && holder.runId === runId,
  });
  if (held.acquired) writeFileSync(`${lockFile}.token`, held.token);
  return held;
}

export function release(lockFile = LOCK_FILE) {
  let token;
  try { token = readFileSync(`${lockFile}.token`, 'utf8'); } catch { return false; }
  const released = releaseLock(lockFile, token);
  try { rmSync(`${lockFile}.token`, { force: true }); } catch { /* nothing to clean up */ }
  return released;
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'acquire') {
    const held = acquire();
    if (held.acquired) {
      process.stdout.write('acquired\n');
      process.exit(0);
    }
    const who = held.holder ? `${held.holder.host}:${held.holder.pid} at ${held.holder.at}` : 'unknown holder';
    process.stdout.write(`held by ${who} -- another daily-triage run is in progress, deferring\n`);
    process.exit(1);
  } else if (cmd === 'release') {
    release();
    process.stdout.write('released\n');
    process.exit(0);
  } else {
    process.stderr.write('usage: daily-triage-lock.js acquire|release\n');
    process.exit(2);
  }
}

if (isMainModule(import.meta.url)) main();
