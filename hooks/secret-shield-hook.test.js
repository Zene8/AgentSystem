'use strict';
// Tests for hooks/secret-shield-hook.js (issue #222).
//
// The one that matters is `the leak test` at the bottom: with rehydration ON, a real secret goes
// into a real shell command, the command works, and the command's OUTPUT comes back carrying zero
// bytes of the real value. Everything else here is scaffolding for that.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'secret-shield-hook.js');

// A syntactically valid AWS access key id + secret. Test fixture only, never was live, and
// assembled at runtime rather than written as a literal — see lib/secret-shield-fixtures.cjs.
const { FIXTURES } = require('./lib/secret-shield-fixtures.cjs');
const AWS_KEY = FIXTURES.awsAccessKey2;
const AWS_SECRET = FIXTURES.awsSecretKey;

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ss-${label}-`));
}

/** Run the hook with a JSON payload on stdin. Returns { status, stdout, stderr, json }. */
function runHook(payload, { phase = 'post', home, env = {} } = {}) {
  const res = spawnSync(process.execPath, [HOOK, `--phase=${phase}`], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, SECRET_SHIELD_HOME: home, ...env },
  });
  let json = null;
  if (res.stdout && res.stdout.trim()) {
    try { json = JSON.parse(res.stdout); } catch { /* left null; asserted by caller */ }
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

/** A project cwd with a .secret-shield.json. */
function project(overrides = {}) {
  const cwd = tmpdir('proj');
  fs.writeFileSync(path.join(cwd, '.secret-shield.json'), JSON.stringify(overrides));
  return cwd;
}

function setup(overrides) {
  return { cwd: project(overrides), home: tmpdir('home') };
}

test('post: redacts a secret in Bash stdout and preserves the response shape', () => {
  const { cwd, home } = setup();
  const { status, json } = runHook({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd, session_id: 's1',
    tool_input: { command: 'cat creds' },
    tool_response: { stdout: `key=${AWS_KEY}\n`, stderr: '', exit_code: 0 },
  }, { home });

  assert.strictEqual(status, 0, 'must exit 0 or the harness discards the redaction');
  assert.ok(json, 'expected JSON on stdout');
  const out = json.hookSpecificOutput.updatedToolOutput;
  assert.strictEqual(json.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.ok(!JSON.stringify(out).includes(AWS_KEY), 'real key must not survive');
  assert.match(out.stdout, /__SECRET_AWS_ACCESS_KEY_\d+__/);
  // Shape preservation: the object fields and their types come back as they went in.
  assert.strictEqual(out.stderr, '');
  assert.strictEqual(out.exit_code, 0, 'non-string leaves pass through untouched');
});

test('post: redacts Read file_contents', () => {
  const { cwd, home } = setup();
  const { json } = runHook({
    tool_name: 'Read', cwd, session_id: 's1',
    tool_response: { file_path: '/x/.env', file_contents: `AWS_SECRET_ACCESS_KEY=${AWS_SECRET}\n` },
  }, { home });
  const out = json.hookSpecificOutput.updatedToolOutput;
  assert.ok(!out.file_contents.includes(AWS_SECRET));
  assert.strictEqual(out.file_path, '/x/.env', 'unrelated fields untouched');
});

test('post: redacts nested Grep matches without flattening the array', () => {
  const { cwd, home } = setup();
  const { json } = runHook({
    tool_name: 'Grep', cwd, session_id: 's1',
    tool_response: {
      pattern: 'AKIA',
      matches: [
        { file_path: 'a.txt', line_number: 3, line_content: `id: ${AWS_KEY}` },
        { file_path: 'b.txt', line_number: 9, line_content: 'nothing here' },
      ],
    },
  }, { home });
  const out = json.hookSpecificOutput.updatedToolOutput;
  assert.ok(Array.isArray(out.matches), 'array container preserved');
  assert.strictEqual(out.matches.length, 2);
  assert.ok(!out.matches[0].line_content.includes(AWS_KEY));
  assert.strictEqual(out.matches[0].line_number, 3);
  assert.strictEqual(out.matches[1].line_content, 'nothing here', 'clean rows unchanged');
});

test('post: an MCP-style bare array of content blocks stays an array', () => {
  const { cwd, home } = setup();
  const { json } = runHook({
    tool_name: 'mcp__thing__do', cwd, session_id: 's1',
    tool_response: [{ type: 'text', text: `token ${AWS_KEY}` }],
  }, { home });
  const out = json.hookSpecificOutput.updatedToolOutput;
  assert.ok(Array.isArray(out), 'MCP responses are a bare array, not an object wrapper');
  assert.strictEqual(out[0].type, 'text');
  assert.ok(!out[0].text.includes(AWS_KEY));
});

test('post: a clean response produces no output at all', () => {
  const { cwd, home } = setup();
  const r = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: 'all fine here\n', stderr: '', exit_code: 0 },
  }, { home });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '', 'no rewrite means no JSON, so the harness keeps the original');
});

test('post: the same secret gets the same placeholder across calls', () => {
  const { cwd, home } = setup();
  const payload = {
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: `k=${AWS_KEY}`, stderr: '', exit_code: 0 },
  };
  const a = runHook(payload, { home }).json.hookSpecificOutput.updatedToolOutput.stdout;
  const b = runHook(payload, { home }).json.hookSpecificOutput.updatedToolOutput.stdout;
  assert.strictEqual(a, b, 'placeholders must be stable or the model sees a new name every turn');
});

test('post: disabled config passes the output through untouched', () => {
  const { home } = setup();
  const cwd = project({ enabled: false });
  const r = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: `k=${AWS_KEY}`, stderr: '', exit_code: 0 },
  }, { home });
  assert.strictEqual(r.stdout.trim(), '');
});

test('post: SECRET_SHIELD_ALLOW_UNSHIELDED=1 bypasses and records the bypass', () => {
  const { cwd, home } = setup();
  const r = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: `k=${AWS_KEY}`, stderr: '', exit_code: 0 },
  }, { home, env: { SECRET_SHIELD_ALLOW_UNSHIELDED: '1' } });
  assert.strictEqual(r.stdout.trim(), '', 'bypass means no rewrite');
  const audit = fs.readFileSync(path.join(home, '.claude', 'secret-shield', 'audit.jsonl'), 'utf8');
  assert.match(audit, /"event":"bypass"/, 'a bypass must be recorded, not silent');
});

test('post: fails CLOSED by blanking strings when the vault cannot be opened', () => {
  const { cwd, home } = setup();
  // Seed a real vault, then corrupt it. An existing-but-undecryptable vault throws by design.
  runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: `k=${AWS_KEY}`, stderr: '', exit_code: 0 },
  }, { home });
  const dir = path.join(home, '.claude', 'secret-shield');
  const vaultFile = fs.readdirSync(dir).find((f) => f.endsWith('.vault'));
  fs.writeFileSync(path.join(dir, vaultFile), Buffer.from('garbage that will not authenticate'));

  const r = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: `k=${AWS_KEY}`, stderr: '', exit_code: 7 },
  }, { home });
  assert.strictEqual(r.status, 0, 'still exit 0 — a non-zero exit would discard the blanking');
  const out = r.json.hookSpecificOutput.updatedToolOutput;
  assert.ok(!JSON.stringify(out).includes(AWS_KEY), 'no bytes of the secret may travel');
  assert.match(out.stdout, /secret-shield: withheld/);
  assert.strictEqual(out.exit_code, 7, 'shape and non-string leaves survive the blanking');
});

test('post: garbage on stdin exits 0 and writes nothing', () => {
  const { home } = setup();
  const res = spawnSync(process.execPath, [HOOK, '--phase=post'], {
    input: 'not json at all', encoding: 'utf8',
    env: { ...process.env, SECRET_SHIELD_HOME: home },
  });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '');
});

test('pre: rehydration is off by default, so nothing is substituted', () => {
  const { cwd, home } = setup();
  // Allocate a placeholder first so the vault actually knows it.
  const ph = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: AWS_KEY, stderr: '', exit_code: 0 },
  }, { home }).json.hookSpecificOutput.updatedToolOutput.stdout.trim();

  const r = runHook({
    tool_name: 'Bash', cwd, session_id: 's1', tool_input: { command: `echo ${ph}` },
  }, { phase: 'pre', home });
  assert.strictEqual(r.stdout.trim(), '', 'rehydrate defaults to false — opt-in only');
});

test('pre: with rehydrate on, updatedInput carries only the changed keys', () => {
  const home = tmpdir('home');
  const cwd = project({ rehydrate: true });
  const ph = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: AWS_KEY, stderr: '', exit_code: 0 },
  }, { home }).json.hookSpecificOutput.updatedToolOutput.stdout.trim();

  const r = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_input: { command: `echo ${ph}`, description: 'print it', timeout: 5000 },
  }, { phase: 'pre', home });

  const upd = r.json.hookSpecificOutput.updatedInput;
  assert.deepStrictEqual(Object.keys(upd), ['command'], 'updatedInput is a partial merge');
  assert.ok(upd.command.includes(AWS_KEY));
  assert.strictEqual(r.json.hookSpecificOutput.hookEventName, 'PreToolUse');
});

test('pre: an unknown placeholder is left alone rather than denied', () => {
  const home = tmpdir('home');
  const cwd = project({ rehydrate: true });
  const r = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_input: { command: 'echo __SECRET_MADE_UP_99__' },
  }, { phase: 'pre', home });
  assert.strictEqual(r.status, 0);
  const decision = r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision;
  assert.notStrictEqual(decision, 'deny', 'placeholder-shaped source text must not block tools');
});

test('pre: denies when the input needs a vault that will not open', () => {
  const home = tmpdir('home');
  const cwd = project({ rehydrate: true });
  const ph = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: AWS_KEY, stderr: '', exit_code: 0 },
  }, { home }).json.hookSpecificOutput.updatedToolOutput.stdout.trim();

  const dir = path.join(home, '.claude', 'secret-shield');
  const vaultFile = fs.readdirSync(dir).find((f) => f.endsWith('.vault'));
  fs.writeFileSync(path.join(dir, vaultFile), Buffer.from('garbage'));

  const r = runHook({
    tool_name: 'Bash', cwd, session_id: 's1', tool_input: { command: `echo ${ph}` },
  }, { phase: 'pre', home });
  assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, 'deny',
    'PreToolUse is the only place a hard block is possible — use it');
});

// ---------------------------------------------------------------------------------------------
// THE LEAK TEST
//
// The epic's actual claim is that rehydration is safe. It is only safe if the round trip holds:
// the real secret reaches the shell, the command WORKS, and the command's output comes back with
// no byte of that secret in it. If this test ever fails, rehydration is a net loss and must be
// turned off — a real secret would be entering a tool result that goes to the cloud.
// ---------------------------------------------------------------------------------------------
test('the leak test: rehydrated command runs for real, and its output leaks nothing', () => {
  const home = tmpdir('home');
  const cwd = project({ rehydrate: true });

  // 1. A secret enters through a tool result and is redacted to a stable placeholder.
  const secretFile = path.join(cwd, 'creds.txt');
  fs.writeFileSync(secretFile, `AWS_SECRET_ACCESS_KEY=${AWS_SECRET}\n`);
  const post1 = runHook({
    tool_name: 'Read', cwd, session_id: 's1',
    tool_response: { file_path: secretFile, file_contents: fs.readFileSync(secretFile, 'utf8') },
  }, { home });
  const redacted = post1.json.hookSpecificOutput.updatedToolOutput.file_contents;
  assert.ok(!redacted.includes(AWS_SECRET), 'ingress must not leak');
  const ph = redacted.match(/__[A-Z0-9_]+_\d+__/)[0];

  // 2. The model, which has only ever seen the placeholder, writes a command using it.
  const modelCommand = `printf '%s' ${ph}`;
  assert.ok(!modelCommand.includes(AWS_SECRET));

  // 3. PreToolUse rehydrates it.
  const pre = runHook({
    tool_name: 'Bash', cwd, session_id: 's1', tool_input: { command: modelCommand },
  }, { phase: 'pre', home });
  const realCommand = pre.json.hookSpecificOutput.updatedInput.command;
  assert.ok(realCommand.includes(AWS_SECRET), 'the shell must get the real value or rehydration is pointless');

  // 4. The command actually runs, and it works — the whole point of rehydrating.
  const ran = execFileSync('bash', ['-c', realCommand], { encoding: 'utf8' });
  assert.ok(ran.includes(AWS_SECRET),
    'the rehydrated command must reach the shell with the real value and work');

  // 5. The result of that command goes back out through PostToolUse. Zero bytes may survive.
  const post2 = runHook({
    tool_name: 'Bash', cwd, session_id: 's1',
    tool_response: { stdout: `${AWS_SECRET}\n${ran}`, stderr: '', exit_code: 0 },
  }, { home });
  const returned = JSON.stringify(post2.json.hookSpecificOutput.updatedToolOutput);
  assert.ok(!returned.includes(AWS_SECRET), 'EGRESS LEAK: rehydrated secret came back in a tool result');
  assert.ok(returned.includes(ph), 'and it must come back as the SAME placeholder, not a new one');

  // 6. The audit log records both directions, by placeholder, never by value.
  const audit = fs.readFileSync(path.join(home, '.claude', 'secret-shield', 'audit.jsonl'), 'utf8');
  assert.match(audit, /"event":"redact"/);
  assert.match(audit, /"event":"rehydrate"/);
  assert.ok(!audit.includes(AWS_SECRET), 'the audit log must never quote a secret');
});

// -------------------------------------------------------------------------------------------
// stdin size cap (Sam F2): stdin is untrusted IN SIZE. An uncapped read loop is memory
// exhaustion at a trust boundary, and a hook killed by the OOM killer writes no JSON — which on
// PostToolUse means the ORIGINAL, unredacted output is used. So the cap must fail closed.
// -------------------------------------------------------------------------------------------

/** Stream `bytes` of raw junk at the hook's stdin without building it all in this process. */
function runHookRaw(bytes, phase) {
  const home = tmpdir('home');
  const chunk = 'x'.repeat(1024 * 1024);
  const res = spawnSync(process.execPath, [HOOK, `--phase=${phase}`], {
    input: chunk.repeat(bytes / (1024 * 1024)),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, SECRET_SHIELD_HOME: home },
  });
  let json = null;
  if (res.stdout && res.stdout.trim()) {
    try { json = JSON.parse(res.stdout); } catch { /* asserted by caller */ }
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json, home };
}

test('post: a payload over the stdin cap is withheld, not passed through', () => {
  const res = runHookRaw(33 * 1024 * 1024, 'post'); // MAX_STDIN_BYTES is 32MB
  assert.equal(res.status, 0, 'must still exit 0 — a non-zero exit makes the harness ignore our JSON');
  assert.ok(res.json, `expected JSON on stdout, got: ${res.stdout.slice(0, 200)}`);
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'PostToolUse');
  // The whole payload is 'x' repeated; the replacement must be the notice, never those bytes.
  const out = res.json.hookSpecificOutput.updatedToolOutput;
  assert.equal(typeof out, 'string');
  assert.match(out, /secret-shield: withheld/);
  assert.ok(!out.includes('xxxxxxxxxx'), 'original payload bytes must not survive');
  assert.match(res.stderr, /exceeded/);
});

test('pre: a tool input over the stdin cap is DENIED, not run uninspected', () => {
  const res = runHookRaw(33 * 1024 * 1024, 'pre');
  assert.equal(res.status, 0);
  assert.ok(res.json, `expected JSON on stdout, got: ${res.stdout.slice(0, 200)}`);
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(res.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(res.json.hookSpecificOutput.permissionDecisionReason, /could not be inspected/);
});

test('a payload UNDER the cap is unaffected by it', () => {
  const { cwd, home } = setup({});
  // ~2MB of harmless text in a Bash result: well under the cap, must pass through untouched.
  const payload = {
    tool_name: 'Bash',
    cwd,
    tool_response: { stdout: 'hello world\n'.repeat(160000), stderr: '', exit_code: 0 },
  };
  const res = runHook(payload, { home });
  assert.equal(res.status, 0);
  assert.ok(!/exceeded/.test(res.stderr), `unexpected cap trip: ${res.stderr}`);
  // Nothing secret in it, so the hook emits nothing and the original is used — that is correct here.
  if (res.json) {
    const out = res.json.hookSpecificOutput.updatedToolOutput;
    assert.ok(!JSON.stringify(out).includes('withheld'), 'a clean under-cap payload must not be blanked');
  }
});
