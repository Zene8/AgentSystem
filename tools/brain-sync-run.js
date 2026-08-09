#!/usr/bin/env node
// brain-sync-run.js — the supervised wrapper around brain-sync.js (#341).
//
// brain-sync.js already does pull/merge/commit/push correctly and reports honest exit codes.
// Nothing *ran* it, so hosts only converged when a person remembered, and the Mission Control box —
// which writes memory from cron with no session ever open — drifted for months until a weekly job
// tripped over ~250 conflicting nodes (#340).
//
// This is the thing that runs it, from three places:
//   SessionStart (via hooks/continuous-sync-hook.js)  --pull-only
//   SessionEnd   (via the same hook)                  commit + push
//   host timer, every ~15 min                         commit + push   <- the one that covers cron-only hosts
//
// It adds exactly three things and no sync logic of its own:
//   1. a lock, because those three triggers overlap and two git commits in one tree is corruption;
//   2. exit-code translation, so a systemd unit can tell "conflict, human alerted" from "broken";
//   3. a human-needed alert on conflict.
//
// The rule that must never bend: a conflict is NEVER auto-resolved. No `-X ours`, no `-X theirs`,
// no reset, no second attempt with a different strategy. `~/agent-memory` is user data in a private
// repo — preferences, client notes, per-agent decision logs — and a merge strategy that picks a
// side there is silent data loss with a green exit code. The alert is the whole response.
//
// Exit codes:
//   0  synced, nothing to do, or skipped because another sync held the lock
//   2  setup error from brain-sync (no checkout at that path) — passed through, not alerted, because
//      a host that has never cloned the brain would otherwise re-raise the same issue forever
//   3  conflict; a human-needed alert was raised. 3 rather than 1 so a systemd unit can declare
//      SuccessExitStatus=0 3 and not mark a working watchdog as failed (same convention as
//      tools/actions-watchdog.js).
//
// Usage:
//   node tools/brain-sync-run.js [--pull-only] [--path <brain>] [--lock <file>] [--state <file>]
//                                [--stale-ms <n>] [--brain-sync <script>] [--human-needed <script>]
//
// Node builtins only (repo rule for tools/).

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir, hostname, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './is-main.js';
import { acquireLock, releaseLock, DEFAULT_STALE_MS } from './sync-lock.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Stable human-needed key: one open issue per outage, however many times the timer fires. */
export const ALERT_KEY = 'brain-sync-conflict';

/** What a brain-sync exit code means to us. */
export function classify(code) {
  if (code === 0) return { outcome: 'ok', alert: false, exit: 0 };
  if (code === 1) return { outcome: 'conflict', alert: true, exit: 3 };
  if (code === 2) return { outcome: 'setup', alert: false, exit: 2 };
  return { outcome: 'error', alert: false, exit: 2 };
}

/**
 * The human-needed call for a conflict. Deliberately tells the operator to resolve it by hand and
 * offers no merge strategy: the whole point of stopping here is that only a person can decide which
 * side of a memory node is right.
 */
export function raiseArgs({ root, host, detail, kind = 'merge' }) {
  const cause = kind === 'markers'
    ? `the working tree in ${root} on ${host} still contains merge-conflict markers from an earlier `
      + `merge that was never finished. The sync stopped before touching git: brain-sync.js would `
      + `have committed those markers as ordinary content (it stages with \`git add -A\`) and pushed `
      + `them to every host. That has already happened once, to nexus/personal-brain/graph.json.`
    : `tools/brain-sync.js reported a merge conflict in ${root} on ${host}.`;
  return [
    'raise', ALERT_KEY,
    '--title', `Agent memory sync is blocked on ${host}`,
    '--why',
      `${cause} Memory sync is stopped `
      + `on this host until it is resolved, so anything written here is not reaching the other `
      + `machines and theirs is not reaching this one.\n\n`
      + `Conflicting paths:\n${detail || '(see git status)'}`,
    '--action',
      `On ${host}:\n`
      + '```bash\n'
      + `cd ${root}\n`
      + 'git status            # see both sides\n'
      + '# resolve each file by hand — this is user data, keep both sides where they disagree\n'
      + 'git commit\n'
      + 'node ~/dev/AgentSystem/tools/brain-sync.js\n'
      + '```\n\n'
      + 'Do not resolve with a merge strategy. `graph.json` is the one exception and brain-sync.js '
      + 'already handles it, by taking either side and leaving it to be rebuilt from `nodes/` with '
      + '`tools/graph/graph-init.js`.\n\n'
      + 'If a `graph.json` is the corrupt file, **delete it first** and then rebuild:\n'
      + '```bash\n'
      + 'rm nexus/<brain>/graph.json\n'
      + 'node ~/dev/AgentSystem/tools/graph/graph-init.js <slug> --brain-path=nexus/<brain>\n'
      + '```\n'
      + 'graph-init reads the existing graph before writing one, so it cannot repair a file it '
      + 'cannot parse — running it on the corrupt graph just re-throws the JSON error.',
  ];
}

/** First few conflicting paths out of brain-sync's stderr, for the alert body. */
export function conflictDetail(stderr, max = 20) {
  const lines = String(stderr || '').split('\n');
  const start = lines.findIndex((l) => l.includes('merge conflict needs a human'));
  if (start < 0) return '';
  const paths = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    paths.push(line.trim());
    if (paths.length >= max) { paths.push('…'); break; }
  }
  return paths.join('\n');
}

/**
 * Tracked files still carrying merge-conflict markers.
 *
 * Found by running this for real: `nexus/personal-brain/graph.json` in the shared brain has had six
 * `<<<<<<< HEAD` markers *committed* since a sync from the Mission Control box, and every host has
 * been pulling them. It breaks `graph-lib.readGraph`, so memory injection on that graph fails.
 *
 * The mechanism is worth stating, because it makes the wrapper complicit: brain-sync.js commits
 * with `git add -A` *before* it pulls. A working tree left half-merged by an earlier failed run is
 * therefore not detected as a conflict — it is committed as ordinary content, markers and all, and
 * pushed. So the check has to happen here, before brain-sync is invoked at all.
 */
export function conflictedFiles(root, git = defaultGit) {
  // `git grep` searches tracked files only, which is what we want: an untracked scratch file with a
  // line of angle brackets in it is not a half-finished merge. -I skips binaries.
  const r = git(root, ['grep', '-l', '-I', '-e', '^<<<<<<< ']);
  // 1 = no matches, which is the healthy case. Anything else (not a repo, no HEAD) is left to
  // brain-sync to diagnose and report properly.
  if (r.status !== 0) return [];
  return String(r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function defaultGit(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function readState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  const pullOnly = argv.includes('--pull-only');
  const root = resolve(value('path', join(homedir(), 'agent-memory')));
  // The lock lives outside the brain checkout on purpose: brain-sync.js runs `git add -A`, so a
  // lockfile inside it would be committed and pushed to every host on every sync.
  const lockFile = value('lock', join(tmpdir(), 'agentsystem-brain-sync.lock'));
  const stateFile = value('state', join(tmpdir(), 'agentsystem-brain-sync-alert.json'));
  const staleMs = Number(value('stale-ms', DEFAULT_STALE_MS)) || DEFAULT_STALE_MS;
  const brainSync = value('brain-sync', join(HERE, 'brain-sync.js'));
  const humanNeeded = value('human-needed', join(HERE, 'human-needed.js'));

  const held = acquireLock(lockFile, { staleMs });
  if (!held.acquired) {
    // Not an error: the other trigger is doing this exact work right now. Skipping is the
    // correct outcome, and a 15-minute timer must not turn it into noise.
    const who = held.holder ? `${held.holder.host}:${held.holder.pid}` : 'unknown';
    process.stdout.write(`brain-sync-run: another sync holds the lock (${who}) — skipping\n`);
    process.exit(0);
  }

  const runHumanNeeded = (args2) => {
    const h = spawnSync(process.execPath, [humanNeeded, ...args2], { encoding: 'utf8' });
    // A broken alert channel must not change the verdict. The conflict is still a conflict, and
    // the exit code is what the systemd unit and the next run key off.
    if ((h.status ?? 1) !== 0) {
      process.stderr.write(`brain-sync-run: could not reach human-needed (${h.status})\n`);
      return false;
    }
    return true;
  };

  const markRaised = () => {
    try {
      mkdirSync(dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, JSON.stringify({ raised: true, at: new Date().toISOString(), root }));
    } catch { /* the alert is already open; state is only an optimisation */ }
  };

  let verdict = { exit: 0 };
  try {
    // Preflight, before brain-sync is invoked at all. A tree left half-merged by an earlier run has
    // its markers committed as ordinary content by `git add -A` and pushed to every host — the
    // failure is silent and exits 0, so it cannot be caught after the fact.
    const stuck = conflictedFiles(root);
    if (stuck.length) {
      process.stderr.write(
        `brain-sync-run: ${stuck.length} tracked file(s) still contain merge-conflict markers — `
        + `not syncing, a human has to finish that merge:\n${stuck.map((f) => `  ${f}`).join('\n')}\n`);
      runHumanNeeded(raiseArgs({
        root, host: hostname(), kind: 'markers', detail: stuck.slice(0, 20).join('\n'),
      }));
      markRaised();
      verdict = { outcome: 'conflict', alert: true, exit: 3 };
    } else {
      const args = ['--path', root, ...(pullOnly ? ['--pull-only'] : [])];
      const r = spawnSync(process.execPath, [brainSync, ...args], { encoding: 'utf8' });
      const code = r.error ? 2 : (r.status ?? 2);
      verdict = classify(code);

      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);

      if (verdict.alert) {
        const detail = conflictDetail(r.stderr);
        runHumanNeeded(raiseArgs({ root, host: hostname(), detail }));
        markRaised();
      } else if (verdict.outcome === 'ok' && readState(stateFile)?.raised) {
        // Only resolve when we know we raised. Calling `resolve` on every clean run would spawn a gh
        // API call every 15 minutes on every host to say nothing.
        if (runHumanNeeded(['resolve', ALERT_KEY])) {
          try { rmSync(stateFile, { force: true }); } catch { /* next clean run retries */ }
        }
      }
    }
  } finally {
    releaseLock(lockFile, held.token);
  }

  process.exit(verdict.exit);
}
