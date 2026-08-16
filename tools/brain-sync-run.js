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
//   3  conflict, or a corrupt object database; a human-needed alert was raised either way. 3 rather
//      than 1 so a systemd unit can declare SuccessExitStatus=0 3 and not mark a working watchdog as
//      failed (same convention as tools/actions-watchdog.js). Corruption reuses 3 rather than adding
//      a fourth code: it is already alerting, and a new code would need the systemd unit's
//      SuccessExitStatus updated on every host to match, or a working guard reads as a crash.
//
// Usage:
//   node tools/brain-sync-run.js [--pull-only] [--path <brain>] [--lock <file>] [--state <file>]
//                                [--corrupt-state <file>] [--stale-ms <n>] [--ignore-markers]
//                                [--brain-sync <script>] [--human-needed <script>]
//
// Node builtins only (repo rule for tools/).

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir, hostname, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './is-main.js';
import { acquireLock, releaseLock, DEFAULT_STALE_MS, workBudgetMs } from './sync-lock.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The human-needed key prefix: one open issue per outage, however many times the timer fires. */
export const ALERT_KEY = 'brain-sync-conflict';

/**
 * A second, distinct key prefix for object-database corruption. Not folded into ALERT_KEY: a
 * conflict and a corrupt object database need different human action (resolve a merge vs. `git
 * fsck` and likely a fresh clone), so one key covering both means fixing one closes an issue that
 * never described the other, and the alert body for whichever was open second would be wrong about
 * which problem it is.
 */
export const CORRUPT_ALERT_KEY = 'brain-sync-corrupt';

/**
 * The key for one host under a given prefix. Per-host on purpose: the blocked tree is per-host, so
 * a single global key means the laptop resolving its conflict closes the issue the Mission Control
 * box is still stuck behind — one host's recovery silently cancelling another's alert.
 */
export function alertKey(host = hostname(), base = ALERT_KEY) {
  return `${base}-${String(host).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** The exact line brain-sync.js prints when a merge stopped for a person. */
const CONFLICT_MARK = 'merge conflict needs a human';

/**
 * The exact phrase brain-sync.js prints when a git command failed because the object database
 * itself is damaged (#429/#430: weekly-memory-decay and weekly-trust-scores both died in 9s on
 * `fatal: bad object HEAD`, and nothing downstream said the brain repo was corrupt). Exported,
 * unlike CONFLICT_MARK, so a test can assert against the one literal this file matches on rather
 * than a second hand-copied string. It cannot instead be imported *from* brain-sync.js: that file
 * exports nothing at module level (its CORRUPTION_PATTERN is local to main()), so there is nothing
 * there for this file to import.
 */
export const CORRUPT_MARK = 'agent-memory git object database is corrupt';

/**
 * What a brain-sync exit code means to us.
 *
 * Exit 1 alone is NOT a conflict. brain-sync.js `die(..., 1)`s on any failed git command — an
 * offline fetch, a non-fast-forward push, expired credentials — and treating those as conflicts
 * does two bad things at once: it opens a "resolve this merge by hand" issue about a network blip,
 * and it returns 3, which the unit declares a success. A sync that is failing every 15 minutes
 * would report healthy while crying wolf. So the conflict verdict requires brain-sync to have
 * actually said so. Corruption gets the same treatment, checked first since it is the more specific
 * match: a corrupt object database makes git fail in its own distinctive words, never the conflict
 * phrase, so the two checks cannot both fire for one failure.
 */
export function classify(code, stderr = '') {
  if (code === 0) return { outcome: 'ok', alert: false, exit: 0 };
  if (code === 1 && String(stderr).includes(CORRUPT_MARK)) {
    return { outcome: 'corrupt', alert: true, exit: 3 };
  }
  if (code === 1 && String(stderr).includes(CONFLICT_MARK)) {
    return { outcome: 'conflict', alert: true, exit: 3 };
  }
  if (code === 1) return { outcome: 'error', alert: false, exit: 2 };
  if (code === 2) return { outcome: 'setup', alert: false, exit: 2 };
  return { outcome: 'error', alert: false, exit: 2 };
}

/**
 * The human-needed call for a conflict. Deliberately tells the operator to resolve it by hand and
 * offers no merge strategy: the whole point of stopping here is that only a person can decide which
 * side of a memory node is right.
 */
export function raiseArgs({ root, host = hostname(), detail, kind = 'merge' }) {
  // Corrupt is its own shape, not another flavor of "conflict": there is no merge to resolve, no
  // markers to remove, and offering "commit" or "git status" as next steps would be actively wrong.
  if (kind === 'corrupt') {
    return [
      'raise', alertKey(host, CORRUPT_ALERT_KEY),
      '--title', `Agent memory git repository is corrupt on ${host}`,
      '--why',
        `tools/brain-sync.js in ${root} on ${host} could not even run \`git status\` -- the object `
        + `database itself is damaged. Nothing was synced in either direction: no pull, no push, no `
        + `commit. This is not a merge conflict and brain-sync.js makes no attempt to repair it -- `
        + `only a human with \`git fsck\` and, most likely, a fresh clone from a healthy peer can.\n\n`
        + `Git's own error:\n${detail || '(see brain-sync.js output)'}`,
      '--action',
        `On ${host}:\n`
        + '```bash\n'
        + `cd ${root}\n`
        + 'git fsck --full        # see exactly what is damaged\n'
        + 'git log --oneline -20  # anything written here that never reached origin?\n'
        + 'git reflog\n'
        + '```\n\n'
        + 'Do not run `git gc`, `git prune`, or `git repack` against a damaged database first -- '
        + 'each of those can turn partial corruption into permanent data loss. This repo is one clone '
        + 'among several: every other host that has synced holds a full copy, so the usual fix is to '
        + 'note anything above that never reached origin, then replace the damaged checkout:\n'
        + '```bash\n'
        + `mv ${root} ${root}.corrupt-$(date +%s)\n`
        + `git clone <brain-remote> ${root}\n`
        + '```\n'
        + `Then confirm: node ~/dev/AgentSystem/tools/brain-sync.js --status\n`,
    ];
  }
  const cause = kind === 'markers'
    ? `the working tree in ${root} on ${host} still contains merge-conflict markers from an earlier `
      + `merge that was never finished. The sync stopped before touching git: brain-sync.js would `
      + `have committed those markers as ordinary content (it stages with \`git add -A\`) and pushed `
      + `them to every host. That has already happened once, to nexus/personal-brain/graph.json.`
    : `tools/brain-sync.js reported a merge conflict in ${root} on ${host}.`;
  return [
    'raise', alertKey(host),
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

/**
 * Where per-host state that must outlive a reboot goes. XDG on Linux/macOS, LOCALAPPDATA on
 * Windows, and `~/.cache` when neither is set — never tmpdir, which is cleared at boot on most
 * hosts.
 */
export function cacheDir() {
  const base = process.env.XDG_CACHE_HOME
    || process.env.LOCALAPPDATA
    || join(homedir(), '.cache');
  return join(base, 'agentsystem');
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
  // Escape hatch for the one false positive the marker scan can produce: a brain node that
  // legitimately *quotes* conflict-marker text — and the brain now records this very incident, so
  // that is not hypothetical. Without it, one such node blocks sync on every host permanently, and
  // the only way out would be editing memory by hand to appease a checker. Off by default: the scan
  // is right far more often than it is wrong.
  const ignoreMarkers = argv.includes('--ignore-markers');
  const root = resolve(value('path', join(homedir(), 'agent-memory')));
  // The lock lives outside the brain checkout on purpose: brain-sync.js runs `git add -A`, so a
  // lockfile inside it would be committed and pushed to every host on every sync.
  const lockFile = value('lock', join(tmpdir(), 'agentsystem-brain-sync.lock'));
  // State, unlike the lock, must survive a reboot. It records "we opened the issue", and it is the
  // only thing that ever closes it: on a machine where /tmp is cleared at boot (systemd-tmpfiles,
  // macOS, most containers) a state file in tmpdir means the next clean sync sees no record, never
  // calls `resolve`, and the human-needed issue stays open forever after the conflict is long fixed.
  // A stale "memory sync is blocked" issue that nobody can clear trains people to ignore the label.
  const stateFile = value('state', join(cacheDir(), 'brain-sync-alert.json'));
  // Separate from stateFile for the same reason CORRUPT_ALERT_KEY is separate from ALERT_KEY: a
  // clean run must be able to resolve "conflict fixed" without wrongly also claiming "corruption
  // fixed" (or vice versa) when only one of the two was ever open. Defaults alongside stateFile
  // (same directory) rather than to a second independent cacheDir() call, so that a caller who
  // isolates state with `--state <dir>/x` (every test in this file does) isolates both by default
  // without having to learn a second flag -- only a caller who wants the two split across
  // directories needs `--corrupt-state` at all.
  const corruptStateFile = value('corrupt-state', join(dirname(stateFile), 'brain-sync-corrupt-alert.json'));
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

  const markRaised = (file) => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ raised: true, at: new Date().toISOString(), root }));
    } catch { /* the alert is already open; state is only an optimisation */ }
  };

  // Resolve one previously-raised alert on a clean run. Only when we know we raised it: calling
  // `resolve` on every clean run would spawn a gh API call every 15 minutes on every host to say
  // nothing. Conflict and corruption are resolved independently -- a clean run proves both are
  // gone, but each has its own key and state file, so each is only closed if it was the one open.
  const maybeResolve = (key, file) => {
    if (!readState(file)?.raised) return;
    if (runHumanNeeded(['resolve', key])) {
      try { rmSync(file, { force: true }); } catch { /* next clean run retries */ }
    }
  };

  let verdict = { exit: 0 };
  try {
    // Preflight, before brain-sync is invoked at all. A tree left half-merged by an earlier run has
    // its markers committed as ordinary content by `git add -A` and pushed to every host — the
    // failure is silent and exits 0, so it cannot be caught after the fact.
    const stuck = ignoreMarkers ? [] : conflictedFiles(root);
    if (stuck.length) {
      process.stderr.write(
        `brain-sync-run: ${stuck.length} tracked file(s) still contain merge-conflict markers — `
        + `not syncing, a human has to finish that merge:\n${stuck.map((f) => `  ${f}`).join('\n')}\n`);
      runHumanNeeded(raiseArgs({
        root, host: hostname(), kind: 'markers', detail: stuck.slice(0, 20).join('\n'),
      }));
      markRaised(stateFile);
      verdict = { outcome: 'conflict', alert: true, exit: 3 };
    } else {
      // --ignore-markers is forwarded, not consumed here: brain-sync.js carries the same guard
      // (#348) for the direct-invocation path, and an override the operator gave the wrapper would
      // otherwise be re-blocked one level down. It is the only flag forwarded beyond --path and
      // --pull-only, and it suppresses a *scan* — it never resolves a conflict, which stays the
      // one thing neither script will do.
      const args = ['--path', root,
        ...(pullOnly ? ['--pull-only'] : []),
        ...(ignoreMarkers ? ['--ignore-markers'] : [])];
      // Bounded by the lock window, not open-ended. A `git push` hung on an unreachable remote
      // otherwise outlives its own lock: the next trigger sees a stale record, takes over, and two
      // brain-syncs run in one working tree — the exact overlap the lock exists to prevent, reached
      // *through* the lock. Timing out first means the holder always releases before it goes stale.
      const r = spawnSync(process.execPath, [brainSync, ...args], {
        encoding: 'utf8', timeout: workBudgetMs(staleMs), killSignal: 'SIGKILL',
      });
      // A timeout kill has no exit status. It is a broken sync, not a conflict: exit 2, no alert.
      const code = (r.error || r.signal) ? 2 : (r.status ?? 2);
      verdict = classify(code, r.stderr);

      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);

      if (verdict.outcome === 'corrupt') {
        // No conflictDetail() here: that helper parses CONFLICT_MARK's paths-list shape, which
        // corruption's stderr does not have. raiseArgs's own '(see brain-sync.js output)' fallback
        // is the right default, so pass brain-sync's raw stderr as-is.
        runHumanNeeded(raiseArgs({ root, host: hostname(), kind: 'corrupt', detail: r.stderr }));
        markRaised(corruptStateFile);
      } else if (verdict.alert) {
        const detail = conflictDetail(r.stderr);
        runHumanNeeded(raiseArgs({ root, host: hostname(), detail }));
        markRaised(stateFile);
      } else if (verdict.outcome === 'ok') {
        maybeResolve(alertKey(), stateFile);
        maybeResolve(alertKey(hostname(), CORRUPT_ALERT_KEY), corruptStateFile);
      }
    }
  } finally {
    releaseLock(lockFile, held.token);
  }

  process.exit(verdict.exit);
}
