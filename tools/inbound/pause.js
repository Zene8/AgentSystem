// pause.js — the inbound kill switch.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// One sentinel file. While it exists, the dispatcher classifies nothing and spawns nothing: every
// claimed inbound item is RELEASED back to the queue unchanged (see event-bus.js `release`), so a
// pause costs no attempts and dead-letters nothing. Polling and cursor advancement deliberately
// keep running — a pause is "stop acting", not "stop watching", and stopping the poller too would
// mean the cursor sat still and the resume re-read a week of notifications in one pass.
//
// Why a file and not an env var or a policy key:
//   - A person (or the webhook OPS endpoint) must be able to stop the fleet with one command, with
//     no deploy, no restart, and no edit to a file that syncs to every host.
//   - It lives in the per-host cache dir, so pausing the Mission Control server does not pause the
//     laptop. A shared-repo flag would, and would also need a brain sync to take effect.
//   - It survives a reboot, unlike an in-memory flag, and a stale one is visible: `state()` reports
//     when and why it was set, so a pause nobody remembered setting reads as an obvious cause
//     rather than a mystery quiet spell.

import fs from 'node:fs';
import path from 'node:path';

import { cacheDir } from '../brain-sync-run.js';
import { isMainModule } from '../is-main.js';

export const PAUSE_FILENAME = 'PAUSED';

export function inboundDir() {
  return path.join(cacheDir(), 'inbound');
}

export function pausePath(dir = inboundDir()) {
  return path.join(dir, PAUSE_FILENAME);
}

/**
 * Is inbound dispatch paused right now?
 *
 * Deliberately the cheapest possible check — one `existsSync` — because the dispatcher calls it
 * once per claimed event, and a check that could itself fail would be a way for the kill switch to
 * stop working.
 */
export function isPaused(dir = inboundDir()) {
  return fs.existsSync(pausePath(dir));
}

/**
 * Pause. Idempotent: pausing an already-paused host keeps the ORIGINAL reason and timestamp, so
 * "who stopped this and when" survives a second pause command.
 */
export function pause(reason = 'no reason given', dir = inboundDir()) {
  const existing = state(dir);
  if (existing.paused) return existing;
  fs.mkdirSync(dir, { recursive: true });
  const body = { pausedAt: new Date().toISOString(), reason: String(reason).slice(0, 500) };
  const file = pausePath(dir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
  fs.renameSync(tmp, file);
  return { paused: true, ...body };
}

/** Resume. Idempotent: resuming a running host is a stated no-op, not an error. */
export function resume(dir = inboundDir()) {
  const was = state(dir);
  try { fs.unlinkSync(pausePath(dir)); } catch { /* already running */ }
  return { paused: false, wasPaused: was.paused, pausedAt: was.pausedAt || null, reason: was.reason || null };
}

/**
 * Report the switch. An unreadable or hand-created sentinel still counts as PAUSED — the file's
 * existence is the signal, and treating unparseable content as "not paused" would let a corrupt
 * write silently re-arm the fleet.
 */
export function state(dir = inboundDir()) {
  const file = pausePath(dir);
  if (!fs.existsSync(file)) return { paused: false, pausedAt: null, reason: null, file };
  let body = {};
  try { body = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* touched by hand */ }
  return {
    paused: true,
    pausedAt: body.pausedAt || null,
    reason: body.reason || '(sentinel file has no readable reason)',
    file,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// The switch has to be usable from three places: a console on the server, the Mission Control
// Ops tab (which can only run a script under tools/, see webhook-server.js OPS), and a phone via
// that same endpoint. So the CLI is the interface and the exports above are the library.
//
//   node tools/inbound/pause.js status
//   node tools/inbound/pause.js pause "why"
//   node tools/inbound/pause.js resume
//
// Exit 0 always for status: "paused" is a state to report, not a fault, and an ops runner that
// read a non-zero exit as a failure would make a working kill switch look broken.
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const reason = rest.join(' ').trim();

  if (!cmd || cmd === 'status') {
    const s = state();
    console.log(s.paused
      ? `inbound dispatch is PAUSED since ${s.pausedAt || 'unknown'} — ${s.reason}\n  sentinel: ${s.file}`
      : `inbound dispatch is running\n  sentinel would be: ${s.file}`);
    return;
  }
  if (cmd === 'pause') {
    const s = pause(reason || 'paused from the CLI with no reason given');
    console.log(`inbound dispatch PAUSED since ${s.pausedAt} — ${s.reason}`);
    console.log('queued items keep accumulating and nothing is lost; resume with: node tools/inbound/pause.js resume');
    return;
  }
  if (cmd === 'resume') {
    const s = resume();
    console.log(s.wasPaused
      ? `inbound dispatch RESUMED (was paused since ${s.pausedAt} — ${s.reason})`
      : 'inbound dispatch was already running — nothing to do');
    return;
  }
  console.error(`pause: unknown command "${cmd}" — expected status, pause or resume`);
  process.exit(1);
}

if (isMainModule(import.meta.url)) main();
