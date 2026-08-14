#!/usr/bin/env node
// repo-sync.js — pull the AgentSystem checkout forward at session start (#341).
//
// The whole point is the *refusals*: this runs unattended on every host, so anything other than
// "on main, clean, fast-forward" must be a silent no-op. A tool that pulls under a dirty tree, or
// that touches a feature branch, would eat work nobody asked it to touch.
//
// Integration tests use real git repos in a temp dir rather than a mocked runner. The behaviours
// that matter here (does --ff-only refuse a diverged branch, does a dirty tree survive) are git's,
// not ours, and mocking them would only test the mock.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { decide } from './repo-sync.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'repo-sync.js');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

function scenario() {
  const root = mkdtempSync(join(tmpdir(), 'repo-sync-'));
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const clone = join(root, 'clone');

  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  mkdirSync(seed);
  git(seed, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'one');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '--quiet', 'origin', 'main');

  execFileSync('git', ['clone', '--quiet', origin, clone]);
  return { root, origin, seed, clone };
}

/** Add a commit to origin, so the clone is one behind. */
function advanceOrigin(s, text = 'two\n') {
  writeFileSync(join(s.seed, 'b.txt'), text);
  git(s.seed, 'add', '-A');
  git(s.seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'two');
  git(s.seed, 'push', '--quiet', 'origin', 'main');
}

/**
 * Every skip on `main` now writes a consecutive-skip counter, so each test gets its own state file.
 * Without this the suite would bump the real per-host counter under cacheDir() and could raise a
 * live human-needed alert from `npm test`.
 */
const run = (path, ...extra) => execFileSync(process.execPath, [
  SCRIPT, '--path', path,
  ...(extra.includes('--state') ? [] : ['--state', `${path}.skip-state.json`]),
  ...extra,
], { encoding: 'utf8' });

/**
 * A stand-in for tools/human-needed.js that records its argv instead of talking to GitHub.
 * `.mjs`, not `.js`: the temp dir is outside this repo, so it inherits no `"type": "module"`.
 */
function alertStub(dir) {
  const log = join(dir, 'alerts.log');
  const script = join(dir, 'fake-human-needed.mjs');
  // JSON per line: the --why/--action bodies are multi-line, so a raw argv join would make one
  // invocation look like nine.
  writeFileSync(script, `import { appendFileSync } from 'node:fs';\n`
    + `appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  return { script, log, lines: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) };
}

// ── the decision, in isolation ────────────────────────────────────────────────

test('decide: syncs only on a clean main with an origin', () => {
  assert.equal(decide({ branch: 'main', dirty: '', hasOrigin: true }).sync, true);
});

test('decide: refuses a feature branch', () => {
  const d = decide({ branch: 'issue-341-continuous-sync', dirty: '', hasOrigin: true });
  assert.equal(d.sync, false);
  assert.match(d.reason, /branch/);
});

test('decide: refuses a dirty tree', () => {
  const d = decide({ branch: 'main', dirty: ' M tools/x.js', hasOrigin: true });
  assert.equal(d.sync, false);
  assert.match(d.reason, /uncommitted/);
});

test('decide: refuses a checkout with no origin remote', () => {
  const d = decide({ branch: 'main', dirty: '', hasOrigin: false });
  assert.equal(d.sync, false);
  assert.match(d.reason, /origin/);
});

test('decide: refuses a detached HEAD', () => {
  assert.equal(decide({ branch: 'HEAD', dirty: '', hasOrigin: true }).sync, false);
});

// ── end to end, against real git ──────────────────────────────────────────────

test('fast-forwards a clean main', () => {
  const s = scenario();
  const before = git(s.clone, 'rev-parse', 'HEAD');
  advanceOrigin(s);

  const out = run(s.clone);
  assert.notEqual(git(s.clone, 'rev-parse', 'HEAD'), before, 'clone did not move');
  assert.match(out, /pulled/);
});

// This test used to assert `out === ''` — silence on every skip was the stated contract, and that
// contract WAS the bug (#423): the Mission Control canon sat 7 commits behind origin/main with two
// uncommitted files and nothing anywhere said so, so a week of red enforcement-drift-check runs
// reported downstream *hook* drift instead of the stale tree underneath it. The refusal to pull is
// still correct and the two assertions below it are unchanged — what changed is that the refusal is
// now audible when, and only when, it is actually costing the host commits.
test('a dirty tree is left completely alone, and says so when it is behind', () => {
  const s = scenario();
  const before = git(s.clone, 'rev-parse', 'HEAD');
  writeFileSync(join(s.clone, 'a.txt'), 'local edit\n');
  advanceOrigin(s);

  const out = run(s.clone);
  assert.match(out, /uncommitted/, `skip reason missing from: ${out}`);
  assert.match(out, /1 commit/, `behind-count missing from: ${out}`);
  assert.match(out, /origin\/main/, `remote ref missing from: ${out}`);
  assert.equal(out.trim().split('\n').length, 1, `expected exactly one line, got: ${out}`);

  assert.equal(git(s.clone, 'rev-parse', 'HEAD'), before, 'pulled under a dirty tree');
  assert.match(git(s.clone, 'status', '--porcelain'), /a\.txt/, 'local edit was destroyed');
});

// The common case on every host at every session start. If this ever prints, the warning becomes
// per-session noise and stops being read — which is the same failure as printing nothing.
test('a dirty tree that is already up to date stays silent', () => {
  const s = scenario();
  writeFileSync(join(s.clone, 'a.txt'), 'local edit\n');

  const out = run(s.clone);
  assert.equal(out, '', `expected silence when not behind, got: ${out}`);
});

// The regression guard for the trap that would have shipped a no-op: `git rev-list --count
// HEAD..origin/main` reads the LOCAL remote-tracking ref, and the scenario helpers never fetch, so
// an implementation that skips the fetch reports behind=0 here forever and looks fixed.
test('the behind-count comes from a fresh fetch, not the stale tracking ref', () => {
  const s = scenario();
  writeFileSync(join(s.clone, 'a.txt'), 'local edit\n');
  advanceOrigin(s);
  assert.equal(git(s.clone, 'rev-list', '--count', 'HEAD..origin/main'), '0', 'fixture assumption broken');

  assert.match(run(s.clone), /1 commit/);
});

test('three consecutive skips while behind raise one per-host alert', () => {
  const s = scenario();
  const stub = alertStub(s.root);
  const state = join(s.root, 'skip-state.json');
  writeFileSync(join(s.clone, 'a.txt'), 'local edit\n');
  advanceOrigin(s);

  const once = () => run(s.clone, '--state', state, '--human-needed', stub.script);

  once();
  assert.deepEqual(stub.lines(), [], 'alerted on the first skip — an ordinary mid-edit state');
  once();
  assert.deepEqual(stub.lines(), [], 'alerted on the second skip');
  once();
  assert.equal(stub.lines().length, 1, `expected exactly one raise, got: ${stub.lines().join('\n')}`);
  assert.deepEqual(JSON.parse(stub.lines()[0]).slice(0, 1), ["raise"]);
  assert.match(JSON.parse(stub.lines()[0])[1], /^repo-sync-behind-[a-z0-9]/);

  // A fourth skip must not re-invoke: human-needed de-duplicates, but only if we stop hammering it.
  once();
  assert.equal(stub.lines().length, 1, 'raised again after the alert was already open');

  assert.equal(git(s.clone, 'status', '--porcelain').includes('a.txt'), true, 'local edit was destroyed');
});

test('a successful sync clears the skip counter and resolves the alert', () => {
  const s = scenario();
  const stub = alertStub(s.root);
  const state = join(s.root, 'skip-state.json');
  writeFileSync(join(s.clone, 'a.txt'), 'local edit\n');
  advanceOrigin(s);

  const once = (...extra) => run(s.clone, '--state', state, '--human-needed', stub.script, ...extra);
  once(); once(); once();
  assert.equal(stub.lines().length, 1);

  git(s.clone, 'checkout', '--', 'a.txt'); // the human cleared their edit
  assert.match(once(), /pulled/);
  assert.equal(JSON.parse(readFileSync(state, 'utf8'))[s.clone], undefined, 'counter survived a sync');
  assert.equal(stub.lines().length, 2);
  assert.deepEqual(JSON.parse(stub.lines()[1]).slice(0, 1), ["resolve"]);
  assert.match(JSON.parse(stub.lines()[1])[1], /^repo-sync-behind-[a-z0-9]/);
});

// ── --check-canon, the assertion enforcement-drift-check runs ─────────────────

test('--check-canon exits 1 when the checkout is behind origin/main', () => {
  const s = scenario();
  advanceOrigin(s);
  assert.throws(() => run(s.clone, '--check-canon'), (e) => {
    assert.equal(e.status, 1);
    assert.match(String(e.stdout), /1 commit/);
    return true;
  });
});

test('--check-canon exits 0 on a checkout that is in sync', () => {
  const s = scenario();
  assert.match(run(s.clone, '--check-canon'), /in sync/);
});

// Same reasoning as the bare-~/.claude no-install case: a host that never had canon is not drifting.
test('--check-canon on a path that is not a checkout is a clean skip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-sync-nocanon-'));
  assert.match(run(join(dir, 'nope'), '--check-canon'), /no checkout/);
});

test('a feature branch is never touched', () => {
  const s = scenario();
  git(s.clone, 'checkout', '--quiet', '-b', 'issue-999-thing');
  const before = git(s.clone, 'rev-parse', 'HEAD');
  advanceOrigin(s);

  assert.equal(run(s.clone), '');
  assert.equal(git(s.clone, 'rev-parse', 'HEAD'), before);
});

test('a local commit on main that origin does not have is not clobbered', () => {
  const s = scenario();
  writeFileSync(join(s.clone, 'local.txt'), 'mine\n');
  git(s.clone, 'add', '-A');
  git(s.clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'local');
  const before = git(s.clone, 'rev-parse', 'HEAD');
  advanceOrigin(s);

  run(s.clone); // --ff-only must refuse; the tool must not escalate to a merge
  assert.equal(git(s.clone, 'rev-parse', 'HEAD'), before, 'diverged main was rewritten');
});

test('--dry-run reports the decision and changes nothing', () => {
  const s = scenario();
  const before = git(s.clone, 'rev-parse', 'HEAD');
  advanceOrigin(s);

  const out = run(s.clone, '--dry-run');
  assert.match(out, /would pull/);
  assert.equal(git(s.clone, 'rev-parse', 'HEAD'), before);
});

test('a path that is not a git checkout exits 0 in silence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-sync-nogit-'));
  assert.equal(run(dir), '');
});
