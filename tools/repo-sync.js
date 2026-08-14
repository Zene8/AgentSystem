#!/usr/bin/env node
// repo-sync.js — fast-forward the AgentSystem checkout at session start (#341).
//
// AgentSystem is cloned on every machine that uses the harness, but only one of them is Mission
// Control. The others are pure consumers: they run the agents, hooks and tools out of a checkout
// that nobody remembers to `git pull`. So a fix merged to main reaches one host immediately and the
// rest whenever someone happens to notice — which is the same silent-drift shape as #302 and #298.
//
// This is deliberately the most timid tool in the repo. It runs unattended on every host, so every
// case except "on main, clean, and a fast-forward exists" is a silent no-op:
//
//   * feature branch      -> skip. Never move someone's work.
//   * dirty tree          -> skip. `git pull` on a dirty tree either fails or stashes; both are
//                            surprises to a human who left an edit open.
//   * no origin remote    -> skip.
//   * detached HEAD       -> skip.
//   * diverged main       -> `--ff-only` refuses, and we do not escalate to a merge or a reset.
//
// It never pushes. Publishing code stays a PR through Sam's gate; this only consumes what main
// already has.
//
// SessionStart only, never on the host timer: rewriting files under a running session means the
// model's picture of the tree silently stops matching the tree.
//
// The skips are silent — but NOT unconditionally, and that distinction is #423. "Silence on skip is
// the contract" was the original comment on the CLI block below, and it was wrong in the one case
// that matters: Mission Control's canon checkout sat 7 commits behind origin/main for over a week
// with two uncommitted files, skipping every session start without a word. The installed hooks are
// deployed OUT of that tree, so `enforcement-drift-check` went red daily reporting four drifted
// *hook* files while the actual cause — a tree that had stopped pulling — was invisible. Same shape
// as #362: a hook or unit that points at a working tree inherits that tree's git state, and
// verifying the mechanism never verifies the revision behind it.
//
// So a skip is now audible when, and only when, it is costing the host commits. Refusing to pull
// stays correct; there is deliberately no auto-stash, auto-pull or auto-reset anywhere in here.
//
// Usage:
//   node tools/repo-sync.js [--path <repo>] [--dry-run] [--verbose]
//   node tools/repo-sync.js --check-canon [--path <repo>]      # exit 1 if that checkout is behind
//
// Exit code is 0 in every non-catastrophic case, including every skip — this is opportunistic
// housekeeping, and a hook worker treating "nothing to do" as a failure trains people to ignore it.
// `--check-canon` is the one mode that exits 1, because it is an assertion run by CI, not a hook.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './is-main.js';
// Reused, not reimplemented: this is the one place in the repo that already resolves a per-host
// cache directory correctly (XDG / LOCALAPPDATA / ~/.cache, never tmpdir — a reboot that clears
// tmpdir is exactly how the brain-sync alert state got it wrong the first time).
import { cacheDir } from './brain-sync-run.js';

export const SYNC_BRANCH = 'main';

/**
 * Consecutive skips-while-behind before a human is paged.
 *
 * One or two is an ordinary mid-edit state: a person left a change open, and they will clear it
 * themselves. Three DISTINCT session starts still behind is a host that has stopped converging on
 * its own, which is what #423 was. Tuning this is low-stakes in the noisy direction because
 * human-needed.js already de-duplicates to at most one ping per 20h, so the blast radius of too
 * small an N is bounded; too large an N is unbounded, since the whole failure is silence.
 */
export const ALERT_AFTER_SKIPS = 3;

/** One open issue per host: the stuck tree is per-host, so `alertKey` follows brain-sync-run.js. */
export function alertKey(host = hostname()) {
  const slug = String(host).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `repo-sync-behind-${slug}`;
}

/**
 * Should this checkout be pulled? Pure, so the refusals are testable without a git fixture.
 * @param {{branch: string, dirty: string, hasOrigin: boolean}} state
 */
export function decide({ branch, dirty, hasOrigin }) {
  if (!hasOrigin) return { sync: false, reason: 'no origin remote' };
  if (!branch || branch === 'HEAD') return { sync: false, reason: 'detached HEAD' };
  if (branch !== SYNC_BRANCH) return { sync: false, reason: `on branch ${branch}, not ${SYNC_BRANCH}` };
  if (dirty && dirty.trim()) return { sync: false, reason: 'uncommitted local changes' };
  return { sync: true, reason: `clean ${SYNC_BRANCH}` };
}

/**
 * The human-needed call for a host that has stopped converging. It asks a person to clear the
 * blocker and offers no automation, because there is none that is safe: a pull rewrites the tree
 * under whatever session is holding those edits open.
 */
export function raiseArgs({ root, behind, reason, host = hostname() }) {
  return [
    'raise', alertKey(host),
    '--title', `${host} has stopped pulling AgentSystem (${behind} commits behind)`,
    '--why',
      `tools/repo-sync.js has skipped the session-start pull of ${root} on ${host} `
      + `${ALERT_AFTER_SKIPS} times in a row — reason: ${reason}. That checkout is now ${behind} `
      + `commit(s) behind origin/${SYNC_BRANCH}.\n\n`
      + `Skipping is correct (pulling under a live session or a dirty tree eats work), but a host `
      + `that skips indefinitely runs stale code with nothing saying so. Hooks, agents, skills and `
      + `timers are deployed OUT of this checkout, so downstream --check tools will report drift in `
      + `whatever they installed and never name this as the cause — that is #423, and #362 before `
      + `it.`,
    '--action',
      `On ${host}, with no Claude session running:\n`
      + '```bash\n'
      + `cd ${root}\n`
      + 'git status                # what is actually uncommitted — decide keep or discard\n'
      + 'git stash && git pull --ff-only origin main && git stash pop\n'
      + 'node tools/deploy-hooks.js   # hooks were deployed from the stale tree\n'
      + '```\n\n'
      + 'If the branch is not `main`, or `--ff-only` refuses because the tree has local commits, '
      + 'that is a divergence a person has to resolve — do not reset it from a script.',
  ];
}

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** Read the three facts `decide` needs. */
export function readState(root) {
  return {
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out,
    dirty: git(root, ['status', '--porcelain']).out,
    hasOrigin: git(root, ['remote']).out.split('\n').includes('origin'),
  };
}

/**
 * How many commits `origin/main` is ahead of HEAD, after refreshing the tracking ref. null when it
 * cannot be determined (offline, no origin, no such branch upstream).
 *
 * THE FETCH IS LOAD-BEARING — do not "optimise" it away. `git rev-list --count HEAD..origin/main`
 * reads `refs/remotes/origin/main`, a purely local ref that only ever moves when something fetches.
 * On the skip path nothing does: the pull is exactly what we refused to run. So without this fetch
 * the count is whatever it was at the last successful pull, which on a host that stopped pulling is
 * 0 — permanently. The warning would then never fire on precisely the host it exists for, and the
 * fix would look shipped while being a no-op. `tools/repo-sync.test.js` pins this.
 *
 * Fetching under a dirty tree and under a live session is safe in a way pulling is not: it writes
 * only inside `.git/`, and never touches a tracked file, the index, or HEAD.
 */
export function behindOrigin(root) {
  // Explicit refspec rather than a bare `git fetch origin main`: the bare form updates the
  // remote-tracking ref only opportunistically, depending on the remote's configured refspec, and a
  // count read off a ref that quietly did not move is the failure mode this whole function exists
  // to avoid. `+` because we only ever want the remote's current answer, never a merge of it.
  const spec = `+refs/heads/${SYNC_BRANCH}:refs/remotes/origin/${SYNC_BRANCH}`;
  if (git(root, ['fetch', '--quiet', 'origin', spec]).code !== 0) return null;
  const r = git(root, ['rev-list', '--count', `HEAD..origin/${SYNC_BRANCH}`]);
  if (r.code !== 0) return null;
  const n = Number(r.out);
  return Number.isFinite(n) ? n : null;
}

/**
 * The consecutive-skip counter, keyed by checkout path so one host's several clones do not share a
 * tally. Lives under cacheDir(), so it survives the reboot that would otherwise reset the count and
 * make a permanently-stuck host look like a series of first offences.
 */
function readCounts(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeCounts(file, counts) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(counts));
  } catch { /* the counter is an optimisation; a warning still printed */ }
}

/** Record one more skip-while-behind. Returns the new count and whether it is the alerting one. */
export function noteSkip(file, root) {
  const counts = readCounts(file);
  const entry = counts[root] || { count: 0, raised: false };
  entry.count += 1;
  const shouldRaise = entry.count >= ALERT_AFTER_SKIPS && !entry.raised;
  if (shouldRaise) entry.raised = true;
  counts[root] = entry;
  writeCounts(file, counts);
  return { count: entry.count, shouldRaise };
}

/**
 * The host converged. Returns whether an alert was outstanding — only then is `resolve` worth a
 * `gh` round trip, same reasoning as brain-sync-run.js: resolving on every clean run would spawn an
 * API call at every session start on every host to say nothing.
 */
export function clearSkip(file, root) {
  const counts = readCounts(file);
  const entry = counts[root];
  if (!entry) return { wasRaised: false };
  delete counts[root];
  writeCounts(file, counts);
  return { wasRaised: Boolean(entry.raised) };
}

export function repoSync(root, { dryRun = false } = {}) {
  if (!existsSync(join(root, '.git'))) return { synced: false, reason: 'not a git checkout' };

  const state = readState(root);
  // Whether a behind-count against origin/main means anything for this checkout. On a feature
  // branch it does not: being behind main there is the normal, intended state of every branch in
  // flight, and warning about it would fire at every session start on every working tree — noise
  // that gets the real warning filtered out with it.
  const onSyncBranch = state.hasOrigin && state.branch === SYNC_BRANCH;

  const decision = decide(state);
  if (!decision.sync) return { synced: false, reason: decision.reason, onSyncBranch };
  if (dryRun) return { synced: false, dryRun: true, reason: decision.reason, onSyncBranch };

  const pull = git(root, ['pull', '--ff-only', '--quiet', 'origin', SYNC_BRANCH]);
  if (pull.code !== 0) {
    // The expected failure is a diverged main, which --ff-only refuses. That is the tool working.
    return {
      synced: false, onSyncBranch,
      reason: `fast-forward refused: ${(pull.err || pull.out).split('\n')[0]}`,
    };
  }
  return {
    synced: true, onSyncBranch, reason: decision.reason,
    head: git(root, ['rev-parse', '--short', 'HEAD']).out,
  };
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flagValue = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : null;
  };
  const dryRun = argv.includes('--dry-run');
  const verbose = argv.includes('--verbose');
  // Default: the checkout this file lives in. realpath, because ~/dev/AgentSystem is a symlink on
  // the hosts that matter and git resolves the two spellings to the same repo either way.
  const root = resolve(flagValue('path') || join(dirname(fileURLToPath(import.meta.url)), '..'));

  // --check-canon: the assertion enforcement-drift-check runs against $HOME/dev/AgentSystem. It is
  // read-only and deliberately says nothing about *why* the tree is behind — dirty, diverged or
  // parked on a long-merged branch (#362) all land here, and the remedy is a human's call either
  // way. Never repairs: a pull under a live session is the thing this whole file refuses to do.
  if (argv.includes('--check-canon')) {
    if (!existsSync(join(root, '.git'))) {
      // A host that never had a canon checkout is not drifting — same reasoning as a bare
      // ~/.claude reporting no-install rather than failing.
      process.stdout.write(`repo-sync: no checkout at ${root} — nothing to check\n`);
      process.exit(0);
    }
    const n = behindOrigin(root);
    if (n === null) {
      // Offline, or no origin. We cannot distinguish "in sync" from "far behind", and failing a
      // daily job on a network blip is how a check gets muted.
      process.stdout.write(`repo-sync: could not reach origin from ${root} — not asserting\n`);
      process.exit(0);
    }
    const branch = readState(root).branch;
    if (n > 0) {
      process.stdout.write(
        `repo-sync: ${root} is ${n} commit(s) behind origin/${SYNC_BRANCH} (on ${branch})\n`);
      process.exit(1);
    }
    process.stdout.write(`repo-sync: ${root} is in sync with origin/${SYNC_BRANCH}\n`);
    process.exit(0);
  }

  const stateFile = flagValue('state') || join(cacheDir(), 'repo-sync-skip.json');
  const humanNeeded = flagValue('human-needed') || join(dirname(fileURLToPath(import.meta.url)), 'human-needed.js');

  // A broken or unauthenticated `gh` must never take a session start down with it. The pull was
  // already skipped correctly; the alert is a courtesy on top of a warning that already printed.
  const humanNeededCall = (args) => {
    try {
      spawnSync(process.execPath, [humanNeeded, ...args], { encoding: 'utf8', timeout: 30_000 });
    } catch { /* ignore */ }
  };

  const converged = () => {
    if (clearSkip(stateFile, root).wasRaised) humanNeededCall(['resolve', alertKey()]);
  };

  const r = repoSync(root, { dryRun });
  if (r.synced) {
    process.stdout.write(`repo-sync: pulled ${SYNC_BRANCH} (${r.head})\n`);
    converged();
  } else if (r.dryRun) {
    process.stdout.write(`repo-sync: would pull ${SYNC_BRANCH} — ${r.reason}\n`);
  } else {
    // Skips stay silent by default — this fires at every session start on every host, and a line
    // printed every time is a line nobody reads. The exception, and the whole of #423, is a skip
    // that is actually costing the host commits: exactly one line, only when behind > 0.
    let line = '';
    if (r.onSyncBranch) {
      const n = behindOrigin(root);
      if (n === null) {
        // No network, no count, no claim. Say nothing and change no state: an offline laptop is not
        // a stuck host, and counting it as one would page a human for being on a plane.
      } else if (n === 0) {
        converged();
      } else {
        const { count, shouldRaise } = noteSkip(stateFile, root);
        line = `repo-sync: NOT pulling ${root} — ${r.reason}; `
          + `this checkout is ${n} commit(s) behind origin/${SYNC_BRANCH} `
          + `(skipped ${count}x in a row). Nothing here will fix that automatically.\n`;
        if (shouldRaise) humanNeededCall(raiseArgs({ root, behind: n, reason: r.reason }));
      }
    }
    if (line) process.stdout.write(line);
    else if (verbose) process.stdout.write(`repo-sync: skipped — ${r.reason}\n`);
  }
  process.exit(0);
}
