#!/usr/bin/env node
// brain-sync.js — sync ~/agent-memory (the central agent brain) with its private remote.
//
// The brain is shared by every host running AgentSystem: this laptop, the Mission Control server,
// and anything added later. Git is the transport rather than a cloud drive because a drive syncs
// whole files last-writer-wins, and `graph.json` is rewritten in full by the graph tools — two
// hosts writing in the same window would silently drop one side's nodes. Git turns that into a
// visible conflict instead.
//
// Usage:
//   node tools/brain-sync.js              pull, merge, commit local changes, push
//   node tools/brain-sync.js --status     report what would sync; change nothing
//   node tools/brain-sync.js --pull-only  pull and merge; do not push
//   node tools/brain-sync.js --path <dir> operate on a checkout other than ~/agent-memory
//   node tools/brain-sync.js --ignore-markers  proceed even though tracked files hold `<<<<<<<`
//                                              text (a node that legitimately quotes markers).
//                                              Never bypasses an actually-unfinished merge.
//
// Exit codes: 0 synced (or nothing to do), 1 conflict or corruption needing a human, 2 usage/setup
// error.
//
// Staging is NOT a bare `git add -A`: PER_HOST_LOG_DENYLIST below is excluded by pathspec, because
// the brain's own .gitignore is in a repo this one cannot fix and a name missing from it (#482:
// visits.log) means a permanent, every-host, every-sync merge conflict.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './is-main.js';

const __filename = fileURLToPath(import.meta.url);

// Known git object-database corruption signatures, matched against a failed command's stderr.
// ponytail: a fixed pattern list, not authoritative like `git fsck` -- extend the regex (or switch
// to a preflight `git fsck --connectivity-only`) if a corruption mode shows up that doesn't match.
const CORRUPTION_PATTERN =
  /(fatal: bad object|error: object file .* is empty|fatal: loose object .* is corrupt|error: bad sha1 file|fatal: unable to read \S+ object)/;

/**
 * The sentinel phrases. Both are matched verbatim by tools/brain-sync-run.js, which imports them
 * from here rather than hand-copying the literals. They must stay **disjoint substrings**: that file
 * classifies by `String(stderr).includes(...)`, so if the remote phrase contained the local one, a
 * damaged *origin* would be diagnosed as a damaged local checkout and the alert would tell a person
 * to throw the local copy away. Neither is a substring of the other, and neither contains the
 * merge-conflict phrase `merge conflict needs a human`.
 */
export const CORRUPT_MARK = 'agent-memory git object database is corrupt';
export const REMOTE_CORRUPT_MARK = 'agent-memory remote object database is corrupt';

/**
 * Which side of the wire the corruption is on, or null when this stderr is not corruption at all.
 *
 * Git prefixes everything the *server* said with `remote: `. That distinction is the whole point:
 * the same "object file ... is empty" text can come from this host's `.git` (local damage) or be
 * relayed from origin through `git fetch`/`git push` (the remote's damage). Diagnosing the second
 * as the first is not a cosmetic mislabel -- the local alert body says to `mv` the checkout aside
 * and re-clone from origin, which would clone *from the broken side* and destroy the last healthy
 * copy along with any commit it holds that never reached origin.
 *
 * Local wins when both match: if this host's own object database is damaged, that is the problem in
 * front of the operator, whatever the server also said.
 */
export function classifyCorruption(raw) {
  const text = String(raw || '');
  if (!text) return null;
  const isRemote = (l) => /^\s*remote:/.test(l);
  const lines = text.split('\n');
  if (CORRUPTION_PATTERN.test(lines.filter((l) => !isRemote(l)).join('\n'))) {
    return { side: 'local', text };
  }
  if (CORRUPTION_PATTERN.test(lines.filter(isRemote).join('\n'))) {
    return { side: 'remote', text };
  }
  return null;
}

/**
 * Per-host append-only logs that must NEVER be staged into the brain (#482).
 *
 * These are matched by **basename, at any depth**, and the guard lives here — in this repo — on
 * purpose. The brain's own `.gitignore` already excludes most of them and its comment states the
 * reason exactly: "every sync would conflict on every line of every file, and none of it is a
 * durable fact." But `.gitignore` lives in `~/agent-memory`, a *separate private repo* that this
 * one cannot fix, and a name missing from it is unrecoverable by construction: `git add -A` tracks
 * the file on the first host to sync, after which every other host appends to its own copy and
 * every subsequent merge conflicts on it forever.
 *
 * That is not hypothetical. `visits.log` was never added to that ignore list, so the Sunday
 * `weekly-memory-decay` pass on baselyserver died in `Push the decayed brain` on a merge conflict in
 * `nexus/personal-brain/visits.log` — a file whose entire content is one JSONL line per node access
 * on one machine. It is written by `tools/graph/graph-query.js` (`--record-access`) and
 * `hooks/injection-feedback-hook.js`, i.e. on essentially every session, on every host.
 *
 * A repo-side denylist protects every host including one whose `.gitignore` is stale or absent, and
 * it survives a re-clone of the brain from a remote that predates the ignore fix.
 *
 * What is deliberately NOT here: `nexus/events/done.jsonl` and `dead-letter.jsonl`. Those are
 * append-only too, but they are the triage record the reconciler reads, tracked on purpose, and the
 * brain's `.gitignore` says so.
 */
export const PER_HOST_LOG_DENYLIST = Object.freeze([
  // The #482 file. Absent from the brain's .gitignore, which is why this list exists at all.
  'visits.log',
  // Already ignored in the brain today. Re-asserted here so a host with a stale .gitignore (or a
  // clone from before those lines landed) cannot start tracking them either.
  'injection-log.jsonl',
  'injection-feedback.jsonl',
  'routing-log.jsonl',
  'session-log.jsonl',
  'session-registry.jsonl',
  'auto-capture.log',
  'session-autorename.log',
  'routine-compliance.jsonl',
  'continuous-sync.log',
  'alerts.jsonl',
]);

/**
 * Positive pathspecs matching the denylist at any depth.
 *
 * A leading `*` and no `:(glob)` magic on purpose: git's default pathspec matching runs wildmatch
 * *without* WM_PATHNAME, so `*` crosses `/`. `:(glob)**` would work too but changes the semantics
 * of every other character in the pattern, and these are plain basenames.
 */
export function denyMatchPathspecs(list = PER_HOST_LOG_DENYLIST) {
  return list.map((name) => `*${name}`);
}

/** The same set as exclusions, for `git add -- . :(exclude)*visits.log …`. */
export function denyExcludePathspecs(list = PER_HOST_LOG_DENYLIST) {
  return denyMatchPathspecs(list).map((p) => `:(exclude)${p}`);
}

/** True when this path's basename is denylisted. Accepts either slash style. */
export function isPerHostLog(p, list = PER_HOST_LOG_DENYLIST) {
  const base = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
  return list.includes(base);
}

/**
 * The path out of one `git status --porcelain` line, unquoted, rename-aware.
 *
 * `R  old -> new` reports two paths and the interesting one is the destination; a path with a
 * special character comes back double-quoted and C-escaped, and only the quotes matter here since
 * the denylist is plain ASCII basenames.
 */
export function porcelainPath(line) {
  // NOT a fixed slice(3). `git status --porcelain` writes a two-char XY field then a space, but the
  // caller trims the whole command output, which eats the leading space of an unstaged-only line
  // (` M path`) and shifted the path by one character -- so a TRACKED dirty log read as a different
  // path, missed the tracked-set carve-out, and was left unstaged. That is a permanently dirty tree,
  // which is the total-sync-outage failure this file's comments warn about. `??` lines have no
  // leading space, which is why only the tracked case broke.
  const m = /^\s*([A-Z?!.]{1,2})\s+(.*)$/.exec(String(line || ''));
  let rest = m ? m[2] : String(line || '').slice(3);
  const arrow = rest.indexOf(' -> ');
  if (arrow >= 0) rest = rest.slice(arrow + 4);
  return rest.replace(/^"|"$/g, '');
}

function main() {
const args = process.argv.slice(2);
const opt = {
  status: false, pullOnly: false, ignoreMarkers: false,
  root: path.join(os.homedir(), 'agent-memory'),
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--status': opt.status = true; break;
    case '--pull-only': opt.pullOnly = true; break;
    // Same spelling and same meaning as tools/brain-sync-run.js, which forwards it here. One flag,
    // not two: the wrapper's preflight and this guard scan for the same thing, so an operator who
    // has decided the markers are legitimate content must not have to learn a second override.
    case '--ignore-markers': opt.ignoreMarkers = true; break;
    case '--path': opt.root = args[++i] || die('--path needs a directory', 2); break;
    case '-h': case '--help':
      process.stdout.write(
        fs.readFileSync(__filename, 'utf8').split('\n')
          .slice(1).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, ''))
          .join('\n') + '\n');
      process.exit(0);
      break;
    default: die(`unknown option: ${args[i]} (try --help)`, 2);
  }
}

function die(msg, code) { process.stderr.write(`brain-sync: ${msg}\n`); process.exit(code); }
function log(msg) { process.stdout.write(`${msg}\n`); }

// A git command can fail for many honest reasons -- offline, bad creds, a non-fast-forward push --
// and git()'s generic die() is right for those. It can also fail because an object database is
// damaged, which git reports in its own distinctive words. That gets a distinct sentinel phrase, the
// same shape as the #348 merge-conflict guard's `merge conflict needs a human`: there is no repair
// this script can attempt, so brain-sync-run.js must alert a human rather than filing it next to an
// offline fetch. The phrases are CORRUPT_MARK / REMOTE_CORRUPT_MARK above, which brain-sync-run.js
// imports rather than re-typing.
function dieCorrupt(gitArgs, corrupt, root, die) {
  const cmd = `\`git ${gitArgs.join(' ')}\``;
  if (corrupt.side === 'remote') {
    die(`${REMOTE_CORRUPT_MARK} — ${cmd} was refused by origin, which reported damage in its own `
      + `object database (every line below prefixed \`remote: \` came from the server, not from `
      + `${root}):\n${corrupt.text}\n\n`
      + `The checkout at ${root} is NOT known to be damaged and must not be discarded: it may hold `
      + `commits that never reached the broken origin, and re-cloning would pull from the broken `
      + `side. Leave it alone, keep it as the healthy copy, and get origin repaired (or repointed `
      + `at a healthy mirror) by a human.\n`, 1);
  }
  die(`${CORRUPT_MARK} at ${root} — ${cmd} failed reading the object database itself, not from a `
    + `merge conflict or a transient error:\n${corrupt.text}\n\n`
    + `There is no local repair this script can attempt. Resolve with \`git fsck\` and a human. `
    + `There is no override flag for this -- unlike a stuck merge, a damaged object database has no `
    + `"the operator has decided it's fine" case.\n`, 1);
}

// Every git call is checked. A sync tool that ignores a failed pull and pushes anyway is how you
// get a force-push argument with yourself later.
function git(gitArgs, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', opt.root, ...gitArgs], { encoding: 'utf8' });
  if (r.error) die(`cannot run git: ${r.error.message}`, 2);
  if (r.status !== 0) {
    const stderr = (r.stderr || r.stdout || '').trim();
    // Deliberately OUTSIDE the `!allowFail` branch, and this is the bug the guard shipped with:
    // the one call that touches the most of the object database -- the merge in `git pull` -- is
    // `allowFail: true`, because a merge conflict is an expected outcome there. Object damage that
    // `git status` never reads (a bad object behind the merge base, a corrupt pack) therefore
    // surfaced only as a non-zero pull with no unmerged paths, fell through to the conflict branch,
    // and raised a "resolve this merge by hand" alert about a merge that does not exist. Corruption
    // is never an expected outcome of any call here, so allowFail must not mean "ignore it".
    const corrupt = classifyCorruption(stderr);
    if (corrupt) dieCorrupt(gitArgs, corrupt, opt.root, die);
    if (!allowFail) die(`git ${gitArgs.join(' ')} failed (${r.status})\n${stderr}`, 1);
  }
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

if (!fs.existsSync(path.join(opt.root, '.git'))) {
  die(`no git checkout at ${opt.root}\n` +
      `  clone it first: git clone <brain-remote> ${opt.root}`, 2);
}

// Identity: commits are made non-interactively by hooks and cron, where a missing user.email is a
// hard failure with an unhelpful message. Supply one per-command rather than mutating global config.
const IDENT = ['-c', 'user.name=AgentSystem brain-sync', '-c', 'user.email=brain-sync@localhost'];
const HOST = os.hostname();

// ---------------------------------------------------------------------------- status

const dirtyAll = git(['status', '--porcelain']).out;
const dirtyAllLines = dirtyAll ? dirtyAll.split('\n') : [];

// Already tracked? Then the denylist alone can no longer help — this is exactly the state
// baselyserver was in when the decay pass died (#482). Report it every run, loudly, in --status
// too, and do NOT fix it here: `git rm --cached` rewrites the index of a private user-data repo,
// which is a person's decision, not a scheduled job's.
const trackedPerHost = git(['ls-files', '--', ...denyMatchPathspecs()], { allowFail: true })
  .out.split('\n').filter(Boolean);
const trackedPaths = new Set(trackedPerHost);

// The exclusion applies only to names git is NOT already tracking, and that asymmetry is deliberate.
// Refusing to stage a *tracked* file whose content changed leaves the working tree permanently
// dirty, and `git pull` then refuses the merge outright — turning a conflict on one worthless log
// into a total sync outage on that host, which is strictly worse than the bug. So: an untracked
// per-host log is kept out of git forever (the fix), and an already-tracked one keeps syncing
// exactly as before while the warning below tells a human the one command that ends it.
// Path-exact, NOT by basename: `visits.log` is written per brain, so the same name exists at
// nexus/personal-brain/visits.log and nexus/agent-brain/<agent>/visits.log. Carving the whole
// NAME out because one copy is tracked would start committing every still-untracked sibling —
// seeding the exact conflict this denylist exists to prevent, on the hosts already suffering it.
function isExcludedPerHostPath(q, tracked = trackedPaths) {
  // Both sides are git output (porcelain and ls-files), so both use forward slashes;
  // isPerHostLog normalises either style for its own basename check.
  return isPerHostLog(q) && !tracked.has(String(q || ''));
}
const perHostDirty = dirtyAllLines.filter((l) => isExcludedPerHostPath(porcelainPath(l)));
const dirty = dirtyAllLines
  .filter((l) => !isExcludedPerHostPath(porcelainPath(l))).join('\n');

function reportTrackedPerHostLogs() {
  if (!trackedPerHost.length) return;
  process.stderr.write(
    `brain-sync: WARNING — ${trackedPerHost.length} per-host append-only log(s) are TRACKED in `
    + `${opt.root}:\n${trackedPerHost.map((f) => `  ${f}`).join('\n')}\n`
    + `\nEvery host appends to its own copy, so every sync conflicts on these and none of it is a\n`
    + `durable fact (that is #482: the weekly decay pass died pushing nexus/personal-brain/visits.log).\n`
    + `They are still being staged, because leaving a tracked file dirty makes \`git pull\` refuse\n`
    + `to merge at all. Untracking is a human's call — on this host:\n`
    + `  git -C ${opt.root} rm --cached ${trackedPerHost.map((f) => `'${f}'`).join(' ')}\n`
    + `then add the name(s) to ${opt.root}/.gitignore, commit, and push. Not done automatically:\n`
    + `that writes the index of a private user-data repo.\n`);
}

git(['fetch', '--quiet', 'origin']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
const counts = git(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`], { allowFail: true });
const [behind, ahead] = counts.code === 0 ? counts.out.split(/\s+/) : ['?', '?'];

if (opt.status) {
  const changed = dirty ? dirty.split('\n').length : 0;
  log(`brain     ${opt.root}`);
  log(`branch    ${branch} (${ahead} ahead, ${behind} behind origin)`);
  log(`local     ${changed} uncommitted change(s)`);
  if (dirty) log(dirty.split('\n').map((l) => `          ${l}`).join('\n'));
  // Reported separately, not folded into the count above, because the two need different actions:
  // the count is what the next sync will commit, this is what it will deliberately leave alone.
  log(`per-host  ${perHostDirty.length} append-only log(s) excluded from sync`);
  if (perHostDirty.length) log(perHostDirty.map((l) => `          ${l}`).join('\n'));
  log(`tracked   ${trackedPerHost.length} per-host log(s) TRACKED (should be 0)`);
  reportTrackedPerHostLogs();
  process.exit(0);
}

// ------------------------------------------------------------------- refuse an unfinished merge

// #348. When the pull below stops for a human it exits 1 *mid-merge*, leaving MERGE_HEAD and
// marker-laden files in the tree. The next run read those as ordinary local changes, ran `add -A`
// and committed — which concludes the merge and publishes `<<<<<<<` markers as brain content to
// every host. That is 221f626: 129 corrupted files, and the weekly decay pass dying on the first
// JSON.parse. So nothing below this point may touch the index until a person has finished it.
//
// tools/brain-sync-run.js runs an equivalent preflight before invoking this script, but it is not
// the only caller: the alert it raises, the docs, and brain-join.sh all tell a person to run
// `node tools/brain-sync.js` directly — which is precisely the moment the tree is half-merged. A
// guard that only exists in the wrapper is absent exactly when it is needed.
//
// `--status` is exempt on purpose: reporting is how you look at a stuck tree.
if (!opt.status) {
  // Two distinct states, and only the second one is overridable.
  //
  //   (a) a merge is genuinely unfinished — MERGE_HEAD exists, or a path is unmerged in the index.
  //       This is git state, not text, so `--ignore-markers` must not reach it. The way out is
  //       `git commit` or `git merge --abort`, and pretending otherwise re-opens #348 behind a flag.
  //
  //   (b) markers are sitting in tracked content with no merge in progress — i.e. an earlier run
  //       already committed them (#340). Here `--ignore-markers` is legitimate: a brain node may
  //       quote marker text, and the brain now records this very incident.
  const merging = git(['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], { allowFail: true }).code === 0;
  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], { allowFail: true }).out
    .split('\n').filter(Boolean);

  // `git grep` searches tracked files only — an untracked scratch file full of angle brackets is
  // not a half-finished merge. -I skips binaries. Exit 1 means no matches, the healthy case.
  const markerScan = opt.ignoreMarkers
    ? { code: 1, out: '' }
    : git(['grep', '-l', '-I', '-e', '^<<<<<<< '], { allowFail: true });
  const marked = markerScan.code === 0 ? markerScan.out.split('\n').filter(Boolean) : [];

  if (merging || unmerged.length || marked.length) {
    // "merge conflict needs a human" verbatim: brain-sync-run.js keys its human-needed alert off
    // that phrase (classify()), and treats a bare exit 1 as a plain failure. Without it a stuck
    // tree exits 1, is filed as a network blip, and nobody is told. The paths are indented
    // immediately below so conflictDetail() can lift them into the issue body.
    const paths = (unmerged.length ? unmerged : marked);
    process.stderr.write(
      `brain-sync: merge conflict needs a human — ${
        merging || unmerged.length
          ? `a merge is still in progress in ${opt.root}`
          : `${marked.length} tracked file(s) in ${opt.root} still contain merge-conflict markers`}:\n${
        (paths.length ? paths : ['(see git status)']).map((f) => `  ${f}`).join('\n')}\n` +
      `\nNothing was staged. \`git add -A\` here would conclude that merge and publish \`<<<<<<<\`\n` +
      `markers as brain content to every host.\n` +
      `Resolve in ${opt.root}, then: git commit && node tools/brain-sync.js\n` +
      (merging || unmerged.length
        ? `To throw the merge away instead: git merge --abort\n`
        : `If a node legitimately quotes marker text: re-run with --ignore-markers\n`));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------- commit local work

// --pull-only means pull only, all the way down. This ran at SessionStart, where the promise to the
// user is "bring this host up to date, write nothing" — but committing here made every session open
// by staging `git add -A` and writing a commit, so an editor left mid-thought or a half-finished
// merge became a permanent commit that the next non-pull-only run pushed everywhere. The pull below
// can still fail on a dirty tree; that is the honest outcome, and it stops rather than committing.
reportTrackedPerHostLogs();
if (perHostDirty.length) {
  log(`${perHostDirty.length} per-host append-only log(s) excluded from staging`);
}

if (dirty && opt.pullOnly) {
  log(`${dirty.split('\n').length} local change(s) left uncommitted (--pull-only)`);
} else if (dirty) {
  // NOT a bare `git add -A`. The exclusions are the #482 fix: a per-host append-only log that the
  // brain's .gitignore happens to miss would otherwise be tracked by the first host to sync, and
  // conflict on every host's every sync from then on.
  git(['add', '-A', '--', '.', ...denyExcludePathspecs()]);
  // Those exclusions are name globs, and a git pathspec exclusion beats any positive pattern
  // beside it — so an ALREADY-TRACKED log must be re-added by its exact path in a second call.
  // Leaving it unstaged while dirty is what makes the next `git pull` refuse the merge.
  if (trackedPerHost.length) git(['add', '--', ...trackedPerHost], { allowFail: true });
  // Belt and braces around the porcelain parsing above: `git status` collapses an untracked
  // *directory* to one entry, so a directory holding nothing but denylisted logs reads as a real
  // local change and then stages nothing. Committing an empty index fails with a bare exit 1, which
  // brain-sync-run.js correctly classifies as "error" — a red run over a file we chose to skip.
  const staged = git(['diff', '--cached', '--name-only'], { allowFail: true })
    .out.split('\n').filter(Boolean);
  if (!staged.length) {
    log(`${dirty.split('\n').length} local change(s) resolved to nothing stageable ` +
        `(per-host logs only) — nothing committed`);
  } else {
    // Host in the subject on purpose: when a conflict does show up, knowing which machine wrote
    // which side is the whole diagnosis.
    git([...IDENT, 'commit', '--quiet', '-m',
      `brain: sync from ${HOST}`,
      '-m', `${staged.length} path(s) changed. Written by tools/brain-sync.js.`]);
    log(`committed ${staged.length} local change(s)`);
  }
}

// ---------------------------------------------------------------------------- pull

// Merge, not rebase: brain history is a record of what each host knew when, and rebasing rewrites
// commits that other hosts have already pulled.
const pull = git([...IDENT, 'pull', '--no-edit', '--no-rebase', 'origin', branch], { allowFail: true });

if (pull.code !== 0) {
  const conflicts = git(['diff', '--name-only', '--diff-filter=U'], { allowFail: true }).out
    .split('\n').filter(Boolean);

  // A dirty tree under --pull-only is not a conflict. Since --pull-only no longer commits first, git
  // refuses the merge outright when incoming changes touch a locally modified file — nothing is
  // merged, nothing is broken, there is no unmerged path to resolve. Reporting that as "a human must
  // resolve a merge" would open an issue at every session start on any host with unsaved memory
  // edits. Say so and exit 0; the next full sync commits and pushes properly.
  if (opt.pullOnly && dirty && !conflicts.length) {
    log('pull skipped: local changes are uncommitted (--pull-only writes nothing)');
    process.exit(0);
  }

  // graph.json is a generated index, not authored content — it is rewritten whole on every graph
  // write, so a conflict there is guaranteed the moment two hosts think. Take our side and let
  // graph-reindex.js rebuild it from nodes/, which is where the real facts live. (graph-init.js is
  // the wrong tool here — it mines THIS repo's git log and scaffolds new nodes, not a brain reindex.)
  // Anything else is a genuine content conflict and stops here for a human.
  const generated = conflicts.filter((f) => path.basename(f) === 'graph.json');
  const real = conflicts.filter((f) => path.basename(f) !== 'graph.json');

  if (real.length || !generated.length) {
    process.stderr.write(
      `brain-sync: merge conflict needs a human:\n${
        (conflicts.length ? conflicts : ['(see git status)']).map((f) => `  ${f}`).join('\n')}\n` +
      `\nResolve in ${opt.root}, then: git commit && node tools/brain-sync.js\n`);
    process.exit(1);
  }

  for (const f of generated) git(['checkout', '--ours', '--', f]);
  git(['add', ...generated]);
  git([...IDENT, 'commit', '--quiet', '--no-edit']);
  log(`resolved ${generated.length} generated graph.json conflict(s) — ` +
      `regenerate with tools/graph-reindex.js`);
}

// ---------------------------------------------------------------------------- push

if (opt.pullOnly) { log('pulled (--pull-only, not pushing)'); process.exit(0); }

const outgoing = git(['rev-list', '--count', `origin/${branch}..HEAD`], { allowFail: true }).out;
if (outgoing === '0') { log('up to date, nothing to push'); process.exit(0); }

git(['push', '--quiet', 'origin', branch]);
log(`pushed ${outgoing} commit(s) to origin/${branch}`);
}

if (isMainModule(import.meta.url)) main();
