// guard-git.test.js — the only hook in this repo that MECHANICALLY blocks an action.
//
// skills/daily-triage/SKILL.md lists "Never push to `main` in any repo" among its hard limits, but
// until #220 that was prose the model was asked to honour with nothing behind it: the hook blocked
// force-pushes to main and let a plain one through. That became load-bearing when the unattended
// 05:00/15:00 run was cleared to dispatch code items against a CLIENT repo — an agent could have
// written straight to a client's default branch.
//
// Run: node --test hooks/guard-git.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'claude-hooks', 'guard-git.sh');

/**
 * Runs the REAL hook rather than re-implementing its regexes — a test that
 * copies the pattern under test proves only that it copied it correctly.
 * @returns {number} 2 when the hook blocks, 0 when it allows.
 */
function run(command, toolName = 'Bash', cwd = process.cwd(), env = null) {
  const input = JSON.stringify({ tool_name: toolName, tool_input: { command } });
  try {
    execFileSync(env ? BASH : 'bash', [HOOK], {
      input,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    return 0;
  } catch (err) {
    return err.status;
  }
}

// Assembled from fragments so this file's own source cannot trip the deployed PreToolUse hook
// when an agent edits or greps it.
const PUSH = 'git pu' + 'sh';
const MAIN = 'ma' + 'in';
const MASTER = 'mas' + 'ter';
const FORCE = '--for' + 'ce';
const LEASE = '--for' + 'ce-with-lease';
const RESET = 'git re' + 'set --hard';

test('blocks a direct push to main, forced or not', () => {
  for (const cmd of [
    `${PUSH} origin ${MAIN}`,
    `${PUSH} -u origin ${MAIN}`,
    `${PUSH} origin HEAD:${MAIN}`,
    `${PUSH} origin ${MASTER}`,
    `${PUSH} --force origin ${MAIN}`,
    `${PUSH} origin ${MAIN} --no-verify`,
  ]) {
    assert.equal(run(cmd), 2, `should have been blocked: ${cmd}`);
  }
});

test('allows pushing any other branch — draft-PR work must not break', () => {
  for (const cmd of [
    `${PUSH} origin my-feature-branch`,
    `${PUSH} -u origin fix/some-thing`,
    `${PUSH} origin feat/${MAIN}-menu`,
  ]) {
    assert.equal(run(cmd), 0, `should have been allowed: ${cmd}`);
  }
});

test('does not false-positive on a branch whose name merely starts with main', () => {
  assert.equal(run(`${PUSH} origin ${MAIN}tenance-branch`), 0);
});

test('leaves non-push git commands alone', () => {
  for (const cmd of [
    `git commit -m 'the ${MAIN} thing'`,
    `git log origin/${MAIN}..HEAD`,
    `git fetch origin ${MAIN}`,
    `git checkout ${MAIN}`,
  ]) {
    assert.equal(run(cmd), 0, `should have been allowed: ${cmd}`);
  }
});

test('still blocks a hard reset while on main', () => {
  // Branch-aware: only fires when the CWD is actually on main, which it is for this test run.
  const onMain = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  const expected = /^(main|master)$/.test(onMain) ? 2 : 0;
  assert.equal(run(`${RESET} origin`), expected);
});

test('ignores tools other than Bash', () => {
  assert.equal(run(`${PUSH} origin ${MAIN}`, 'Read'), 0);
});

// --- #284: token anchoring and per-segment matching --------------------------
//
// Both defect classes below made a BLOCKING guard fire on routine work. That is
// a false positive, so it fails safe — but it trains agents and people to treat
// this guard as noise, and the same file holds the real protection against
// direct writes to the default branch.

test('#284 force-push rule: force flag must be a standalone token', () => {
  // `-f` was matched as a bare substring, so it hit inside any branch name
  // containing it. None of these are force pushes.
  for (const cmd of [
    `${PUSH} -u origin feature-for-${MAIN}-page`,
    `${PUSH} -u origin issue-275-fix-linked-issue-check`,
    `${PUSH} -u origin docs/fix-stale-claims`,
    `${PUSH} origin fix/test-suite-green`,
    // --follow-tags is not a force flag, and starts with the same letters as
    // nothing the pattern should catch.
    `${PUSH} --follow-tags origin some-branch`,
  ]) {
    assert.equal(run(cmd), 0, `should have been allowed: ${cmd}`);
  }
});

test('#284 rules do not match across shell command separators', () => {
  // The observed misfires: the flag came from the push and the branch word came
  // from an entirely different command in the same compound line.
  for (const cmd of [
    `${PUSH} -u origin issue-275-fix-linked-issue-check && git log origin/${MAIN} -1`,
    `${PUSH} ${LEASE} origin test/replace-placeholder-assertions && gh pr create --base ${MAIN} --head test/replace-placeholder-assertions`,
    `${PUSH} origin my-branch && git checkout ${MAIN}`,
    `${PUSH} origin HEAD; echo ${MAIN}`,
    `${PUSH} origin my-branch || git fetch origin ${MAIN}`,
    `${PUSH} origin my-branch\ngit log origin/${MASTER}`,
  ]) {
    assert.equal(run(cmd), 0, `should have been allowed: ${cmd}`);
  }
});

test('#284 segmenting does not lose a true positive', () => {
  // A real push to the default branch survives segmenting, whatever it is
  // chained with and whichever side of the separator it lands on.
  for (const cmd of [
    `${PUSH} ${FORCE} origin ${MAIN}`,
    `${PUSH} -f origin ${MAIN}`,
    `${PUSH} ${LEASE} origin ${MASTER}`,
    `${PUSH} ${FORCE} origin HEAD:${MAIN}`,
    `${PUSH} origin ${MAIN} ${FORCE}`,
    `git fetch origin && ${PUSH} ${FORCE} origin ${MAIN}`,
    `${PUSH} ${FORCE} origin ${MAIN} && echo done`,
    `echo start\n${PUSH} origin ${MAIN}`,
    `${PUSH} origin ${MAIN} | tee push.log`,
  ]) {
    assert.equal(run(cmd), 2, `should have been blocked: ${cmd}`);
  }
});

test('#284 hard-reset rule fires on any --hard target, and only on main', () => {
  // Previously `--hard (HEAD|origin)` only, so `git reset --hard <sha>` walked
  // through a rule whose message claims to stop hard resets on main.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-git-test-'));
  try {
    execFileSync('git', ['init', '-q', '-b', MAIN], { cwd: tmp });
    for (const cmd of [`${RESET} origin`, `${RESET} HEAD`, `${RESET} abc1234`, `${RESET} '@{u}'`]) {
      assert.equal(run(cmd, 'Bash', tmp), 2, `should have been blocked on ${MAIN}: ${cmd}`);
    }

    // Same commands on a non-default branch are the developer's own business.
    execFileSync('git', ['checkout', '-q', '-b', 'some-work'], { cwd: tmp });
    for (const cmd of [`${RESET} origin`, `${RESET} abc1234`]) {
      assert.equal(run(cmd, 'Bash', tmp), 0, `should have been allowed off ${MAIN}: ${cmd}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#284 hard-reset rule does not depend on grep -P', () => {
  // The pattern is plain ERE but was run with `grep -qP`. On a host whose grep
  // lacks -P, grep exits non-zero, the `&&` short-circuits, and this blocking
  // rule silently never blocks.
  // Comment lines are stripped: the fix is documented in prose that necessarily
  // names the flag it removed.
  const code = fs
    .readFileSync(HOOK, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  assert(!/grep\s+-\w*P/.test(code), 'guard-git.sh must not use grep -P (not portable)');
});

test('#284 git clean warning does not span separate arguments', () => {
  // `-[^-]*f[^-]*d` let the wildcards run across spaces, so an ordinary clean
  // of files named *.f and *.d tripped the warning. Warn-only, so assert on the
  // message rather than the exit code.
  const { spawnSync } = require('node:child_process');
  const stderrOf = (command) => {
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
    return spawnSync('bash', [HOOK], { input, encoding: 'utf8' }).stderr || '';
  };
  assert(!stderrOf('git clean -x foo.f bar.d').includes('WARNING'), 'must not warn on unrelated filenames');
  assert(stderrOf('git clean -fd').includes('WARNING'), 'must still warn on -fd');
  assert(stderrOf('git clean -df').includes('WARNING'), 'must still warn on -df');
  assert(stderrOf('git clean -f -d').includes('WARNING'), 'must still warn on -f -d');
});

test('blocks direct gh issue close commands', () => {
  for (const cmd of [
    'gh issue close 123',
    'gh issue close 456 --comment "fixed"',
    'gh issue close 789 -y',
    'git status && gh issue close 123',
  ]) {
    assert.equal(run(cmd), 2, `should have been blocked: ${cmd}`);
  }
});

test('allows other gh issue or git commands', () => {
  for (const cmd of [
    'gh issue list',
    'gh issue view 123',
    'node tools/issue-close.js 123 --commit abc1234',
    'git commit -m "close issue"',
  ]) {
    assert.equal(run(cmd), 0, `should have been allowed: ${cmd}`);
  }
});

// --- #516: the guard must not evaporate when jq is missing -------------------
//
// The payload was parsed with jq only, jq's stderr went to /dev/null, and a host
// without jq therefore got TOOL="" -> `TOOL != Bash` -> exit 0 on EVERY Bash
// call. `git push origin main` sailed through with no diagnostic. These tests
// run the REAL script with a PATH that genuinely has no jq on it, rather than
// asserting on the source, because "the fallback is written" and "the fallback
// runs" are different claims and only the second one is the fix.

/** Absolute path to bash, resolved from the UNMODIFIED PATH — the stripped PATH
 * below may not contain it, and the point is to strip the hook's PATH, not ours. */
function resolveExe(name) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch { /* next */ }
    }
  }
  return null;
}

const BASH = resolveExe('bash') || 'bash';

function dirProvides(dir, name) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  return exts.some((ext) => {
    try {
      return fs.statSync(path.join(dir, name + ext)).isFile();
    } catch {
      return false;
    }
  });
}

// Externals the hook actually shells out to. `jq`/`node` are deliberately absent
// from this list — they are what the tests remove.
const HOOK_EXTERNALS = ['cat', 'tr', 'grep', 'git', 'date', 'mkdir'];

/**
 * A PATH with every directory that provides any of `hide` removed.
 *
 * Removing a directory is blunt: on Linux `jq` lives in /usr/bin next to grep,
 * tr, cat, date and mkdir, so dropping it would break the hook for reasons that
 * have nothing to do with this bug and the test would pass vacuously. So after
 * filtering, anything the hook needs that no longer resolves is re-supplied from
 * `shimDir` as a one-line exec wrapper around its original absolute path.
 */
function pathWithout(hide, shimDir) {
  const kept = (process.env.PATH || '')
    .split(path.delimiter)
    .filter((dir) => dir && !hide.some((name) => dirProvides(dir, name)));

  fs.mkdirSync(shimDir, { recursive: true });
  for (const name of HOOK_EXTERNALS) {
    if (kept.some((dir) => dirProvides(dir, name))) continue;
    const target = resolveExe(name);
    if (!target) continue;
    const posix = target.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
    fs.writeFileSync(path.join(shimDir, name), `#!/bin/sh\nexec "${posix}" "$@"\n`, { mode: 0o755 });
  }
  return [shimDir, ...kept].join(path.delimiter);
}

function withTmpDir(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-git-nojq-'));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('#516 jq absent: a direct push to main is STILL blocked', () => {
  withTmpDir((tmp) => {
    const PATH = pathWithout(['jq'], path.join(tmp, 'shim'));
    // Sanity: the strip has to be real, or the assertion below proves nothing.
    assert.equal(
      spawnSync(BASH, ['-c', 'command -v jq'], { env: { ...process.env, PATH }, encoding: 'utf8' }).status,
      1,
      'test setup failed: jq is still on the stripped PATH',
    );
    for (const cmd of [
      `${PUSH} origin ${MAIN}`,
      `${PUSH} -u origin ${MAIN}`,
      `${PUSH} ${FORCE} origin ${MASTER}`,
      'gh issue close 123',
    ]) {
      assert.equal(run(cmd, 'Bash', process.cwd(), { PATH }), 2, `should have been blocked with no jq: ${cmd}`);
    }
  });
});

test('#516 jq absent: the node fallback still reads the real command, not a blanket deny', () => {
  withTmpDir((tmp) => {
    const PATH = pathWithout(['jq'], path.join(tmp, 'shim'));
    for (const cmd of [
      `${PUSH} origin my-feature-branch`,
      `${PUSH} -u origin issue-516-guard-git-jq-fallback`,
      `git commit -m 'the ${MAIN} thing'`,
    ]) {
      assert.equal(run(cmd, 'Bash', process.cwd(), { PATH }), 0, `should have been allowed with no jq: ${cmd}`);
    }
    // And a non-Bash tool is still ignored, i.e. the fallback reads tool_name too.
    assert.equal(run(`${PUSH} origin ${MAIN}`, 'Read', process.cwd(), { PATH }), 0);
  });
});

test('#516 neither jq nor node: allows (never bricks the session) but says so loudly', () => {
  withTmpDir((tmp) => {
    const PATH = pathWithout(['jq', 'node', 'nodejs'], path.join(tmp, 'shim'));
    // POSIX form: the hook is a shell script and derives the log's directory
    // with `${VAR%/*}`, which knows nothing about backslashes.
    const log = path.join(tmp, 'guard-git.log');
    const logForShell = log.replace(/\\/g, '/');
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `${PUSH} origin ${MAIN}` } });
    const res = spawnSync(BASH, [HOOK], {
      input,
      encoding: 'utf8',
      env: { ...process.env, PATH, GUARD_GIT_LOG: logForShell },
    });

    // Fail-closed here would deny every Bash call, including the ones needed to
    // install jq or node — so exit 0 is the deliberate choice, not an oversight.
    assert.equal(res.status, 0, 'must not fail closed: denying every Bash call bricks the session');
    assert.match(res.stderr, /UNGUARDED/, 'the inert state must be visible on stderr');
    assert(fs.existsSync(log), `expected a log line at ${log}`);
    const body = fs.readFileSync(log, 'utf8');
    assert.match(body, /UNGUARDED/);
    assert.match(body, /neither jq nor node/);
  });
});

test('#516 the payload parse has a non-jq path at all', () => {
  // Cheap structural backstop for the case where a future edit "simplifies" the
  // fallback away: every jq call must be paired with a node alternative.
  const code = fs.readFileSync(HOOK, 'utf8');
  assert.match(code, /command -v node/, 'guard-git.sh must probe for node as a jq fallback');
  assert.match(code, /JSON\.parse/, 'guard-git.sh must carry a node JSON parse fallback');
});
