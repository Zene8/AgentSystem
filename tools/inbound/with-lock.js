// with-lock.js — run one inbound pass under the daily-triage lock.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// Why the INBOUND pipeline shares the DAILY-TRIAGE lock rather than taking one of its own: they
// write the same three things. The daily cap counter (caps.js) is check-then-increment, safe within
// one process and not across two. The closeout file is appended by the stage-2 skill and read by the
// reconciler. And the source cursors are advanced by the poller while the stage-2 skill is reading
// those same inboxes — two arbiters would let both sides believe they were alone, which is #402
// again with more moving parts.
//
// A pass that cannot get the lock is DEFERRED, not failed: exit 0, nothing logged as an error. The
// queue is durable, so a skipped dispatch pass costs latency and nothing else, and the timer fires
// again in minutes. Treating it as a failure would raise an alert every time a legitimate
// three-hour stage-2 run held the lock.
//
// The lock is held for the pass only. Callers must not wrap a long-lived daemon in it — the poller
// and the dispatcher are one-shot processes precisely so this stays true.

import { acquire, release } from '../daily-triage-lock.js';

/**
 * Run `fn` while holding the lock. Returns `{ ran: true, result }`, or
 * `{ ran: false, holder }` when another run holds it.
 *
 * The release is in a `finally` so a thrown handler cannot leave the lock held; without that, one
 * crash would silence inbound dispatch for the whole 200-minute stale window.
 */
export function withTriageLock(fn, { lock = { acquire, release } } = {}) {
  const held = lock.acquire();
  if (!held.acquired) return { ran: false, holder: held.holder || null };
  try {
    return { ran: true, result: fn() };
  } finally {
    lock.release();
  }
}

/** The one-line reason a caller prints when it stood down. Shaped for a log, not an alert. */
export function deferredMessage(holder) {
  const who = holder ? `${holder.host}:${holder.pid} at ${holder.at}` : 'unknown holder';
  return `deferred: the daily-triage lock is held by ${who} — nothing is lost, the queue keeps it`;
}
