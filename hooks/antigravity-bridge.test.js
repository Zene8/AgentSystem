// antigravity-bridge.test.js — the bridge must not lose a hook's EXIT STATUS (#514).
//
// Exit 2 is the only deny code in the Claude Code hook protocol. `runHookSync` used to return `''`
// for every non-zero exit, so a deny and an allow-that-printed-nothing were the same value, and
// `guard-git.sh`'s exit-2 block was inert in every `agy` session. The output sniff that stood in
// for it ("does the text contain BLOCKED:") could not have worked either, because guard-git.sh
// writes that line to stderr and stderr was never captured.
//
// The bridge is driven as a REAL child process here, with the guard replaced by a fixture in a
// throwaway tree, so each test picks the exit code it wants to prove. Re-implementing the decision
// in the test would only prove the test copied it.
//
// Run: node --test hooks/antigravity-bridge.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BRIDGE = path.join(__dirname, 'antigravity-bridge.js');

/**
 * Copies the bridge into a temp tree and writes `guard-git.sh` as the given shell fixture, so the
 * bridge resolves the fixture by the same `path.join(__dirname, ...)` it uses in production.
 * @returns {string} path to the bridge copy
 */
function bridgeWithGuard(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bridge-'));
  fs.mkdirSync(path.join(root, 'claude-hooks'));
  fs.writeFileSync(path.join(root, 'claude-hooks', 'guard-git.sh'), body);
  fs.copyFileSync(BRIDGE, path.join(root, 'antigravity-bridge.js'));
  return path.join(root, 'antigravity-bridge.js');
}

/** Runs one PreToolUse event through the bridge and returns its parsed decision. */
function preToolUse(bridgePath, commandLine) {
  const payload = {
    toolCall: { name: 'run_command', args: { CommandLine: commandLine } },
    workspacePaths: [os.tmpdir()],
  };
  const res = spawnSync(process.execPath, [bridgePath, 'PreToolUse'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(res.status, 0, `bridge itself failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

test('exit 2 from a hook denies the tool call', () => {
  const bridge = bridgeWithGuard('#!/bin/bash\ncat >/dev/null\necho "BLOCKED: nope" >&2\nexit 2\n');
  const out = preToolUse(bridge, 'echo hello');

  assert.equal(out.decision, 'deny');
  // The reason comes off stderr, which is where every guard in this repo writes it.
  assert.match(out.reason, /BLOCKED: nope/);
});

test('exit 2 with no output still denies — the status is the decision, not the text', () => {
  const bridge = bridgeWithGuard('#!/bin/bash\ncat >/dev/null\nexit 2\n');
  const out = preToolUse(bridge, 'echo hello');

  assert.equal(out.decision, 'deny');
  assert.ok(out.reason.length > 0, 'a deny must carry some reason for the transcript');
});

test('exit 1 with output fails OPEN — a crashing hook must not brick every tool call', () => {
  // The whole point of the split: only 2 denies. A hook that dies for any other reason (no `jq`,
  // a syntax error, a bad path) prints to both streams and exits non-zero, and that must not
  // become a block.
  const bridge = bridgeWithGuard(
    '#!/bin/bash\ncat >/dev/null\necho "stdout noise"\necho "jq: command not found" >&2\nexit 1\n',
  );
  const out = preToolUse(bridge, 'echo hello');

  assert.equal(out.decision, 'allow');
});

test('exit 1 whose output mentions BLOCKED is still allowed — text is not the predicate', () => {
  const bridge = bridgeWithGuard(
    '#!/bin/bash\ncat >/dev/null\necho "BLOCKED: direct write to main" >&2\nexit 1\n',
  );
  const out = preToolUse(bridge, 'echo hello');

  assert.equal(out.decision, 'allow');
});

test('exit 0 allows', () => {
  const bridge = bridgeWithGuard('#!/bin/bash\ncat >/dev/null\nexit 0\n');
  assert.equal(preToolUse(bridge, 'echo hello').decision, 'allow');
});

test('a non-run_command tool is allowed without consulting the guard', () => {
  // Guard would deny if it ran at all, so an `allow` proves it was skipped.
  const bridge = bridgeWithGuard('#!/bin/bash\ncat >/dev/null\nexit 2\n');
  const payload = { toolCall: { name: 'view_file', args: {} }, workspacePaths: [os.tmpdir()] };
  const res = spawnSync(process.execPath, [bridge, 'PreToolUse'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout.trim()).decision, 'allow');
});

// --- The real guard, end to end -----------------------------------------------------------------
//
// The fixtures above pin the status contract; this pins that the guard actually shipped in this
// repo reaches it. Without this, a future rename of guard-git.sh would leave the fixtures green
// and the bridge guarding nothing.
test('the real guard-git.sh denies a push to main through the bridge', () => {
  const push = 'git pu' + 'sh origin ' + 'ma' + 'in'; // split so this file cannot trip the live hook
  const out = preToolUse(BRIDGE, push);

  assert.equal(out.decision, 'deny', `expected a deny for ${push}`);
  assert.match(out.reason, /direct write to ma/);
});

test('the real guard-git.sh allows an ordinary command through the bridge', () => {
  assert.equal(preToolUse(BRIDGE, 'ls -la').decision, 'allow');
});

// --- The module surface -------------------------------------------------------------------------

test('runHookCaptured reports the status; runHookSync still collapses non-zero to empty', () => {
  const { runHookCaptured, runHookSync } = require('./antigravity-bridge.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cap-'));
  const fixture = path.join(root, 'two.sh');
  fs.writeFileSync(fixture, '#!/bin/bash\ncat >/dev/null\necho out\necho err >&2\nexit 2\n');

  // Fixtures live outside hooks/, so address them the way the bridge resolves everything: relative
  // to its own directory.
  const rel = path.relative(__dirname, fixture).split(path.sep).join('/');

  const cap = runHookCaptured(rel, {}, os.tmpdir());
  assert.equal(cap.status, 2);
  assert.match(cap.stdout, /out/);
  assert.match(cap.stderr, /err/);

  // Unchanged contract for the bookkeeping call sites.
  assert.equal(runHookSync(rel, {}, os.tmpdir()), '');
});

test('a missing hook script fails open rather than throwing', () => {
  const { runHookCaptured } = require('./antigravity-bridge.js');
  const cap = runHookCaptured('claude-hooks/definitely-not-here.sh', {}, os.tmpdir());
  // bash reports 127 for a script it cannot find; what matters is that it is neither a throw nor a
  // 2, so the PreToolUse path lets the call through.
  assert.notEqual(cap.status, 2);
  assert.notEqual(cap.status, 0);
});

// Keep `bash` availability an explicit failure rather than a mysterious one: every assertion above
// depends on it, exactly as hooks/guard-git.test.js does.
test('bash is on PATH (precondition for every test in this file)', () => {
  assert.doesNotThrow(() => execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore' }));
});
