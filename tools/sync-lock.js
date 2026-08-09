#!/usr/bin/env node
// sync-lock.js — a small time-based file lock, shared by the continuous-sync runners (#341).
//
// Why this exists: memory sync now has three triggers — SessionStart, SessionEnd, and a ~15 minute
// host timer — all of which can fire in the same second on the same checkout. `brain-sync.js` runs
// `git add -A`, `git commit`, `git pull` and `git push` against one working tree; two of those
// overlapping is not a merge conflict, it is a corrupted index, and it surfaces later as a
// "conflict needing a human" on some unrelated job (#341, #340).
//
// Staleness is time-based rather than pid-based on purpose. A pid check is not portable — Windows
// reuses pids freely and `process.kill(pid, 0)` means something different under a service account —
// and the thing being guarded either finishes in seconds or has already gone wrong. A lock older
// than the window is assumed abandoned and taken over.
//
// Release is token-checked: if we went stale and someone else took the lock over, our late release
// must not delete their record. That is the one race a naive `unlink` gets wrong.
//
// Node builtins only (repo rule for tools/).

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';

/** Default: longer than a normal sync, shorter than the 15-minute timer interval. */
export const DEFAULT_STALE_MS = 10 * 60 * 1000;

/** The holder record in `file`, or null when absent or unparseable. */
export function readLock(file) {
  try {
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    return rec && typeof rec === 'object' ? rec : null;
  } catch {
    return null;
  }
}

/**
 * True when a holder record should be ignored: missing, undated, or older than the window.
 * A half-written or hand-mangled lock file reads as stale — a lock nobody can ever clear is a
 * worse outage than the race it prevents.
 */
export function isStale(rec, { staleMs = DEFAULT_STALE_MS, now = Date.now() } = {}) {
  if (!rec) return true;
  const at = Date.parse(rec.at);
  if (!Number.isFinite(at)) return true;
  return now - at >= staleMs;
}

/**
 * Try to take `file`.
 * @returns {{acquired: true, token: string} | {acquired: false, holder: object|null}}
 */
export function acquireLock(file, { staleMs = DEFAULT_STALE_MS, now = Date.now(), meta = {} } = {}) {
  const token = JSON.stringify({
    pid: process.pid, host: hostname(), at: new Date(now).toISOString(), ...meta,
  });
  try { mkdirSync(dirname(file), { recursive: true }); } catch { /* already there */ }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, token, { flag: 'wx' }); // atomic create-or-fail
      return { acquired: true, token };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readLock(file);
      if (!isStale(holder, { staleMs, now })) return { acquired: false, holder };
      // Stale: clear it and try once more. If we lose that second race the winner now holds a
      // fresh lock, and the next pass reports them as the holder instead of stealing it.
      try { rmSync(file, { force: true }); } catch { /* someone else cleared it first */ }
    }
  }
  return { acquired: false, holder: readLock(file) };
}

/** Release `file`, but only if it still carries our token. */
export function releaseLock(file, token) {
  try {
    if (readFileSync(file, 'utf8') !== token) return false;
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
