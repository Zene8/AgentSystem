// guard-secrets.test.js — the deny path of the PreToolUse secret guard (#508).
//
// Every case runs the REAL hook as a child process against a THROWAWAY key file under a temp
// HOME. A real key is never read, and the fixture value is generated per-run, so nothing here
// puts a live secret in a transcript — which is the exact failure the hook exists to prevent.
//
// The last test is the load-bearing one: it asserts that no stdout/stderr the hook produces on
// ANY path ever contains the secret value or a recognisable slice of it. A guard that names the
// value it blocked has re-created the leak it blocked.
//
// Run: node --test hooks/guard-secrets.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const HOOK = path.join(__dirname, 'guard-secrets.js');

/** A throwaway 64-hex value, the shape of the real Mission Control bearer key. */
const fixtureKey = () => crypto.randomBytes(32).toString('hex');

/**
 * Runs the hook with a temp HOME containing ~/.claude/<name> files.
 * @returns {{status:number, stdout:string, stderr:string}}
 */
function run(command, files, { toolName = 'Bash' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-secrets-'));
  try {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    for (const [name, content] of Object.entries(files || {})) {
      fs.writeFileSync(path.join(home, '.claude', name), content);
    }
    // os.homedir() reads HOME on posix and USERPROFILE on win32 — set both so the same test
    // exercises the real code path on either platform.
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const input = JSON.stringify({ tool_name: toolName, tool_input: { command } });
    try {
      const stdout = execFileSync(process.execPath, [HOOK], { input, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { status: 0, stdout, stderr: '' };
    } catch (err) {
      return { status: err.status, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('denies a command that inlines the literal value of a ~/.claude/*.key file', () => {
  const key = fixtureKey();
  // The shape recorded in the #506 transcript: assigned to a variable, then used via $K. The
  // agent never "printed" it; tool_input.command is logged verbatim regardless.
  const r = run(`K=${key}; curl -s -H "Authorization: Bearer $K" http://localhost:8787/health`, {
    'remote-webhook.key': `${key}\n`,
  });
  assert.equal(r.status, 2, 'exit 2 is what makes PreToolUse deny the call');
  assert.match(r.stderr, /BLOCKED/);
  assert.match(r.stderr, /~\/\.claude\/remote-webhook\.key/, 'the denial must name the file');
  assert.match(r.stderr, /\$\(cat ~\/\.claude\/remote-webhook\.key\)/, 'and the correct form');
});

test('a key file with a trailing newline still matches the literal, which has none', () => {
  const key = fixtureKey();
  for (const stored of [`${key}\n`, `${key}\r\n`, `${key}  \n\n`, key]) {
    assert.equal(run(`echo ${key}`, { 'remote-webhook.key': stored }).status, 2, 'trailing whitespace must be trimmed before hashing');
  }
});

test('denies a secret glued to other characters, not only a standalone token', () => {
  const key = fixtureKey();
  const r = run(`curl "http://localhost:8787/dispatch?token=${key}x"`, { 'remote-webhook.key': `${key}\n` });
  assert.equal(r.status, 2);
});

test('allows the correct $(cat ...) form — the whole point of the denial message', () => {
  const key = fixtureKey();
  const r = run(
    'curl -s -H "Authorization: Bearer $(cat ~/.claude/remote-webhook.key)" http://localhost:8787/health',
    { 'remote-webhook.key': `${key}\n` },
  );
  assert.equal(r.status, 0, 'the documented form leaks nothing and must never be blocked');
  assert.equal(r.stderr, '');
});

test('allows a high-entropy token that is not a known secret', () => {
  const key = fixtureKey();
  const files = { 'remote-webhook.key': `${key}\n` };
  for (const cmd of [
    `git show ${'a'.repeat(40)}:tools/actions-watchdog.js`, // a 40-char sha
    `git checkout ${crypto.randomBytes(20).toString('hex')}`,
    `curl -H "Authorization: Bearer ${crypto.randomBytes(32).toString('hex')}" https://example.test`,
    `node tools/brain-sync.js --state ${crypto.randomBytes(24).toString('base64url')}`,
  ]) {
    assert.equal(run(cmd, files).status, 0, `entropy alone must not deny: ${cmd.slice(0, 30)}...`);
  }
});

test('fails OPEN on its own internal errors, never bricking Bash', () => {
  const key = fixtureKey();
  // No ~/.claude at all: run() creates it, so hit the other error paths instead.
  assert.equal(run(`echo ${key}`, {}).status, 0, 'no .key files present -> allow');
  assert.equal(run(`echo ${key}`, { 'short.key': 'abc\n' }).status, 0, 'a placeholder key must not make words deniable');
  assert.equal(run(`echo ${key}`, { 'remote-webhook.key': `${key}\n` }, { toolName: 'Read' }).status, 0, 'non-Bash tools are out of scope');

  // Malformed stdin.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-secrets-bad-'));
  try {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'remote-webhook.key'), `${key}\n`);
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const input of ['', 'not json at all', '{"tool_name":"Bash"}']) {
      assert.doesNotThrow(
        () => execFileSync(process.execPath, [HOOK], { input, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }),
        `malformed stdin must exit 0: ${JSON.stringify(input)}`,
      );
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('no output on any path ever contains the secret value or a slice of it', () => {
  const key = fixtureKey();
  const files = { 'remote-webhook.key': `${key}\n` };
  const outputs = [];
  for (const cmd of [
    `K=${key}; curl -H "Authorization: Bearer $K" http://localhost:8787/health`,
    `echo ${key}`,
    `curl "http://x.test?token=${key}x"`,
    'curl -H "Authorization: Bearer $(cat ~/.claude/remote-webhook.key)" http://localhost:8787/health',
  ]) {
    const r = run(cmd, files);
    outputs.push(r.stdout, r.stderr);
  }
  const all = outputs.join('\n');
  assert.ok(!all.includes(key), 'the hook must never render the secret');
  // Not even a fragment: no "last 4", no truncated prefix. 8 chars is well below any
  // plausible accidental collision with the denial text.
  for (const slice of [key.slice(0, 8), key.slice(-8), key.slice(20, 28)]) {
    assert.ok(!all.includes(slice), 'the hook must never render even a slice of the secret');
  }
});
