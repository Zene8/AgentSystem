// caps.js — the per-source daily ceiling on `action` verdicts.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// The classifier decides WHETHER an item deserves an agent. This decides whether the system can
// afford one more today. They are separate on purpose: a classifier bug, a spam wave or a
// misconfigured `reasons` list all look like "lots of legitimate actions" from inside the model
// call, and the only defence that survives a wrong verdict is a hard count.
//
// Over the cap, an `action` becomes a `notify` with reason `daily-cap`. It is never dropped and
// never deferred to tomorrow: the item still reaches the closeout, so a day that hit its ceiling is
// visible rather than silently thin.
//
// State is per host (cacheDir, not ~/agent-memory): the counter answers "how many agents has THIS
// machine spawned today", and syncing it would let the laptop's morning spend the server's budget —
// while also conflicting on every brain sync, since two hosts both write it daily.
//
// The UTC day boundary is deliberate and matches the rest of the system (`max_actions_per_day` in
// policy, the closeout date, GitHub's own timestamps). A local-midnight rollover would make the cap
// mean something different on the laptop than on the server.

import fs from 'node:fs';
import path from 'node:path';

import { cacheDir } from '../brain-sync-run.js';

export const CAPS_FILENAME = 'caps.json';

export function capsPath(dir = path.join(cacheDir(), 'inbound')) {
  return path.join(dir, CAPS_FILENAME);
}

export function utcDay(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Read the counter file. A missing or corrupt file reads as an empty day.
 *
 * Corrupt-means-zero is the safe direction here, and it is the opposite of how policy loading
 * behaves: an unreadable policy must fail closed (it decides what is allowed at all), while an
 * unreadable counter failing closed would jam every source until a person deleted a cache file. The
 * worst case of resetting is one extra day's allowance, which the caps themselves still bound.
 */
export function readCaps(file = capsPath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeCaps(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomic: the dispatcher and a timer can both be mid-write
}

/**
 * How many actions has `source` spent today, and what is its ceiling?
 *
 * `limit` comes from policy (`max_actions_per_day`). A source whose policy omits it gets 0 — the
 * same fail-closed rule as every other allowlist here, because "no stated ceiling" must not read as
 * "unlimited agent spawns from an unattended inbox".
 */
export function usage(source, limit, { file = capsPath(), now = new Date() } = {}) {
  const day = utcDay(now);
  const all = readCaps(file);
  const entry = all[source];
  const used = entry && entry.day === day && Number.isInteger(entry.count) ? entry.count : 0;
  const cap = Number.isInteger(limit) && limit >= 0 ? limit : 0;
  return { source, day, used, limit: cap, remaining: Math.max(0, cap - used), atCap: used >= cap };
}

/**
 * Claim one action slot. Returns `{ allowed, ... }`.
 *
 * Check and increment are one call so there is no window where two dispatch passes both read
 * "1 left". They are not, however, safe across processes without the shared daily-triage lock —
 * which is exactly why Phase 3 puts the dispatcher under it.
 */
export function claimAction(source, limit, { file = capsPath(), now = new Date() } = {}) {
  const before = usage(source, limit, { file, now });
  if (before.atCap) return { ...before, allowed: false, reason: 'daily-cap' };

  const all = readCaps(file);
  all[source] = { day: before.day, count: before.used + 1 };
  writeCaps(file, all);
  return { ...before, used: before.used + 1, remaining: before.remaining - 1, allowed: true, reason: null };
}
