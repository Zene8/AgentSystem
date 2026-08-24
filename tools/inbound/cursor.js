// cursor.js — per-host poll position for each inbound source.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// Where this lives is the whole point of the file, and both obvious placements are wrong:
//
//   NOT ~/agent-memory — a fast-tier cursor rewrites every two minutes and holds no facts. It
//   would conflict on every brain sync, which is exactly why session-log.jsonl, routing-log.jsonl
//   and the injection logs are already gitignored inside that repo. A conflict there is never
//   auto-resolved, so a cursor in the brain converts a routine poll into a human-needed alert.
//
//   NOT tmpdir() — cleared at boot on most systems. A reboot that loses the cursor makes the
//   entire inbox look new, and once `action` verdicts are live that is a spawn storm rather than a
//   slow morning. Same reasoning that moved the brain-sync alert state out of tmpdir() in #434.
//
// So: cacheDir() from brain-sync-run.js — XDG_CACHE_HOME, else LOCALAPPDATA, else ~/.cache, then
// /agentsystem. Imported, not reimplemented; a second copy of that resolution order is how two
// hosts end up disagreeing about where their state is.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { cacheDir } from '../brain-sync-run.js';
import { SOURCES } from './envelope.js';

// Belt-and-braces dedupe BEHIND the cursor, for sources whose cursor semantics are inclusive or
// approximate (Gmail history ids and GitHub notification timestamps both are). Bounded so the file
// cannot grow without limit; 500 is several fast-tier polls' worth of the busiest source.
export const SEEN_RING_SIZE = 500;

export function inboundStateDir() {
  return join(cacheDir(), 'inbound');
}

export function cursorPath(source) {
  assertSource(source);
  return join(inboundStateDir(), `${source}.json`);
}

// The kill switch. A sentinel FILE rather than `systemctl stop`, for two reasons: stopping the
// service freezes the cursor, so the backlog becomes a replay storm at restart; and a misbehaving
// classifier has to be stoppable in one second from a phone, not from an ssh session into a host
// that refuses ssh (#439, #361). It halts DISPATCH only — polling and cursor advancement continue.
export function pausePath() {
  return join(inboundStateDir(), 'PAUSED');
}

export function isPaused() {
  return existsSync(pausePath());
}

export function pause(reason = '') {
  mkdirSync(inboundStateDir(), { recursive: true });
  writeFileSync(pausePath(), `${new Date().toISOString()} ${reason}\n`.trim() + '\n', 'utf8');
  return pausePath();
}

export function resume() {
  if (!existsSync(pausePath())) return false;
  unlinkSync(pausePath());
  return true;
}

function assertSource(source) {
  if (!SOURCES.includes(source)) {
    throw new Error(`unknown source "${source}" — allowed: ${SOURCES.join(', ')}`);
  }
}

function emptyState() {
  return { cursor: null, lastRunAt: null, seenIds: [] };
}

/**
 * Read the cursor for one source.
 *
 * A file that is present but does not parse THROWS. It must never be treated as absent, because
 * absent means "poll from the beginning" — the caller would re-read the whole source and, with
 * `action` verdicts live, re-action all of it. The adapter's contract is to refuse to poll and
 * alert; a corrupt cursor is a person's problem, not something to paper over.
 */
export function readCursor(source) {
  const file = cursorPath(source);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw new Error(`cursor ${file} is unreadable (${err.code}) — refusing to poll`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `cursor ${file} does not parse as JSON (${err.message}) — refusing to poll, because `
      + 'treating it as absent would re-read the whole source from the beginning',
    );
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`cursor ${file} is not an object — refusing to poll`);
  }
  if (!Array.isArray(parsed.seenIds)) {
    throw new Error(`cursor ${file} has no seenIds array — refusing to poll`);
  }

  return {
    cursor: parsed.cursor ?? null,
    lastRunAt: parsed.lastRunAt ?? null,
    seenIds: parsed.seenIds.map(String),
  };
}

/**
 * Write the cursor atomically — tmp file plus rename, the same shape event-bus.js uses to publish.
 * A fast-tier timer firing while a previous run is still writing must never leave a half-written
 * cursor behind, since readCursor() correctly refuses to poll on one.
 */
export function writeCursor(source, state) {
  const file = cursorPath(source);
  mkdirSync(inboundStateDir(), { recursive: true });

  const body = {
    cursor: state.cursor ?? null,
    lastRunAt: state.lastRunAt ?? new Date().toISOString(),
    seenIds: (state.seenIds || []).map(String).slice(-SEEN_RING_SIZE),
  };

  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return body;
}

/**
 * Advance the cursor past a completed poll: new position, the ids just seen appended to the ring,
 * and lastRunAt stamped.
 *
 * lastRunAt is stamped on EVERY poll, including one that returned nothing. It is the only evidence
 * the reconciler has that a tier's timer is alive — a poller that stopped firing and a poller with
 * a quiet inbox look identical otherwise, and "the process exited 0" is not "the feature ran"
 * (#362).
 */
export function advanceCursor(source, { cursor, seenIds = [], now = new Date() }) {
  const prev = readCursor(source);
  const merged = [...prev.seenIds];
  for (const id of seenIds) {
    if (!merged.includes(String(id))) merged.push(String(id));
  }
  return writeCursor(source, {
    cursor: cursor ?? prev.cursor,
    lastRunAt: now.toISOString(),
    seenIds: merged,
  });
}

/**
 * Items this host has not seen before, in arrival order. Runs behind whatever filtering the
 * source's own cursor did.
 */
export function dropSeen(envelopes, seenIds) {
  const seen = new Set((seenIds || []).map(String));
  const out = [];
  for (const env of envelopes) {
    if (seen.has(String(env.externalId))) continue;
    seen.add(String(env.externalId));
    out.push(env);
  }
  return out;
}

/**
 * Is this source's timer alive? Stale means lastRunAt is older than `staleFactor` intervals, which
 * the reconciler turns into the `inbound-poller-stale` alert. A source that has never run is NOT
 * stale — it is new, and alerting on first install trains the reader to ignore the channel.
 */
export function isStale(state, intervalMs, { now = Date.now(), staleFactor = 3 } = {}) {
  if (!state || !state.lastRunAt) return false;
  const last = new Date(state.lastRunAt).getTime();
  if (Number.isNaN(last)) return true;
  return now - last > intervalMs * staleFactor;
}
