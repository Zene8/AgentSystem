#!/usr/bin/env node
'use strict';
// secret-shield-hook.js — the shield's two boundaries (issue #222).
//
//   --phase=post   PostToolUse. Real secret -> placeholder, in the tool RESULT, before those
//                  bytes are attached to the next request and leave the machine.
//   --phase=pre    PreToolUse.  Placeholder -> real secret, in the tool INPUT, so a rehydrated
//                  command or file write actually works.
//
// Three facts about the hook contract shape this file, all verified against the hook docs:
//
//  1. `tool_response` is an OBJECT whose fields differ per tool (Bash {stdout,stderr,exit_code},
//     Read {file_contents}, Grep {matches:[{line_content}]}, WebFetch {body}, MCP a BARE ARRAY of
//     content blocks). The docs do not say whether `updatedToolOutput` must be a string or must
//     mirror `tool_response`. So we never assume: redactShape() walks the structure and returns the
//     same shape with only string leaves rewritten. Correct under either reading, and it needs no
//     per-tool table that would silently miss the next tool added.
//
//  2. ONLY exit 0 with valid JSON applies `updatedToolOutput`. Exit 1, exit 3+, a crash, or
//     malformed stdout all mean the ORIGINAL, UNREDACTED result is used. A PostToolUse hook that
//     throws therefore does not fail closed — it fails wide open and silently. Everything below is
//     wrapped so that the process exits 0 on every path, and a failure emits a shape-preserving
//     BLANKED result instead of the original bytes (see failClosedShape).
//
//  3. PostToolUse fires inside subagents too, so subagent tool results are covered by the same
//     filter without extra wiring. `agent_id` is recorded in the audit line when present.
//
// Node builtins only. CommonJS (hooks/package.json).

const fs = require('node:fs');
const os = require('node:os');

const { loadConfig } = require('./lib/secret-shield-config.cjs');
const { openVault } = require('./lib/secret-shield-vault.cjs');
const {
  redactShape, rehydrateShape, appendAudit, PLACEHOLDER_RE,
} = require('./lib/secret-shield-redact.cjs');

const NOTICE = '[secret-shield: withheld - the shield could not verify this output, so it was not passed through]';

function readStdin() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      if (err.code === 'EOF') break;
      throw err;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Same shape, every string leaf replaced by the notice. This is what fail-closed MEANS on
 * PostToolUse: the tool already ran, so we cannot stop it — the only thing still under our control
 * is whether its bytes travel. Blanking is the strictly safer default when we could not confirm the
 * output was clean.
 */
function failClosedShape(value, depth = 0) {
  if (depth > 12) return NOTICE;
  if (typeof value === 'string') return value.length ? NOTICE : value;
  if (Array.isArray(value)) return value.map((v) => failClosedShape(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = failClosedShape(v, depth + 1);
    return out;
  }
  // numbers/booleans/null carry no secret, and keeping exit_code intact keeps the result readable
  return value;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function phasePost(input, home) {
  const cwd = input.cwd || process.cwd();
  const response = input.tool_response;
  if (response === undefined || response === null) return;

  let config;
  try {
    config = loadConfig(cwd, process.env);
  } catch {
    // Config unreadable is not a reason to blank every tool result on the machine — that would make
    // a typo in one JSON file look like a total harness failure. Pass through, and say so on stderr.
    process.stderr.write('secret-shield: config unreadable; output NOT shielded\n');
    return;
  }
  if (!config.enabled || config.mode === 'off') return;

  if (config.allowUnshielded) {
    appendAudit({ event: 'bypass', phase: 'post', tool: input.tool_name, session: input.session_id }, home);
    return;
  }

  let vault;
  try {
    vault = openVault({ project: config.project, home });
  } catch (err) {
    // An existing-but-undecryptable vault throws by design (fail closed). Without a vault we cannot
    // mint stable placeholders, so we cannot redact — blank instead of leaking.
    appendAudit({ event: 'fail-closed', phase: 'post', reason: 'vault-unavailable', tool: input.tool_name, session: input.session_id }, home);
    process.stderr.write(`secret-shield: vault unavailable (${(err && err.code) || 'error'}); output withheld\n`);
    if (config.failClosed) {
      emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: failClosedShape(response) } });
    }
    return;
  }

  let result;
  try {
    result = redactShape(response, vault, config);
  } catch {
    appendAudit({ event: 'fail-closed', phase: 'post', reason: 'detect-error', tool: input.tool_name, session: input.session_id }, home);
    process.stderr.write('secret-shield: detector error; output withheld\n');
    if (config.failClosed) {
      emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: failClosedShape(response) } });
    }
    try { vault.close(); } catch { /* nothing left to protect */ }
    return;
  }

  if (result.truncated && config.failClosed) {
    // Depth cap hit: some bytes were never examined. "Probably fine" is the wrong default here.
    appendAudit({ event: 'fail-closed', phase: 'post', reason: 'depth-cap', tool: input.tool_name, session: input.session_id }, home);
    emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: failClosedShape(response) } });
    try { vault.close(); } catch { /* ignore */ }
    return;
  }

  if (result.replacements.length > 0) {
    for (const r of result.replacements) {
      appendAudit({
        event: 'redact',
        phase: 'post',
        tool: input.tool_name,
        placeholder: r.placeholder,
        type: r.type,
        session: input.session_id,
        agent: input.agent_id || null,
      }, home);
    }
    emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: result.value } });
  }
  try { vault.close(); } catch { /* ignore */ }
}

function phasePre(input, home) {
  const cwd = input.cwd || process.cwd();
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return;

  let config;
  try {
    config = loadConfig(cwd, process.env);
  } catch {
    return;
  }
  if (!config.enabled || config.mode === 'off') return;
  // Rehydration is OFF by default and must stay that way: it puts a real secret back into a shell
  // command, and that command's stdout is a tool result. It is only safe BECAUSE --phase=post
  // exists to catch it on the way back.
  if (!config.rehydrate) return;

  const raw = JSON.stringify(toolInput);
  PLACEHOLDER_RE.lastIndex = 0;
  const hasPlaceholder = PLACEHOLDER_RE.test(raw);
  PLACEHOLDER_RE.lastIndex = 0;
  if (!hasPlaceholder) return;

  let vault;
  try {
    vault = openVault({ project: config.project, home });
  } catch (err) {
    // PreToolUse CAN block, which is the one place true fail-closed is available. A command
    // carrying a placeholder we cannot resolve would otherwise run with a literal
    // `__SECRET_AWS_ACCESS_KEY_01__` in it — deny instead, and say why.
    appendAudit({ event: 'fail-closed', phase: 'pre', reason: 'vault-unavailable', tool: input.tool_name, session: input.session_id }, home);
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `secret-shield: this input references a vault placeholder but the vault could not be opened (${(err && err.code) || 'error'}). Refusing rather than running it with an unresolved placeholder.`,
      },
    });
    return;
  }

  let out;
  try {
    out = rehydrateShape(toolInput, vault);
  } catch {
    appendAudit({ event: 'fail-closed', phase: 'pre', reason: 'rehydrate-error', tool: input.tool_name, session: input.session_id }, home);
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'secret-shield: failed to rehydrate placeholders in this input. Refusing rather than running it half-substituted.',
      },
    });
    return;
  }

  if (out.used.length > 0) {
    for (const ph of out.used) {
      appendAudit({
        event: 'rehydrate',
        phase: 'pre',
        tool: input.tool_name,
        placeholder: ph,
        session: input.session_id,
        agent: input.agent_id || null,
      }, home);
    }
    // `updatedInput` is a PARTIAL MERGE over tool_input, so sending only changed top-level keys is
    // both sufficient and narrower than resending the whole object.
    const updatedInput = {};
    for (const k of Object.keys(toolInput)) {
      if (JSON.stringify(toolInput[k]) !== JSON.stringify(out.value[k])) updatedInput[k] = out.value[k];
    }
    if (Object.keys(updatedInput).length > 0) {
      emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } });
    }
  }
  // Unknown placeholders are deliberately NOT a denial: `__FOO_01__` is legal source text, and
  // blocking every tool call that happens to contain that shape would make the shield unusable.
  if (out.unknown.length > 0) {
    appendAudit({ event: 'unknown-placeholder', phase: 'pre', tool: input.tool_name, count: out.unknown.length, session: input.session_id }, home);
  }
  try { vault.close(); } catch { /* ignore */ }
}

function main() {
  const args = process.argv.slice(2);
  const phaseArg = args.find((a) => a.startsWith('--phase='));
  const phase = phaseArg ? phaseArg.slice('--phase='.length) : 'post';
  const home = process.env.SECRET_SHIELD_HOME || os.homedir();

  let input;
  try {
    const raw = readStdin();
    if (!raw.trim()) return;
    input = JSON.parse(raw);
  } catch {
    // No parseable payload means nothing to protect and nothing to say.
    return;
  }

  if (phase === 'pre') phasePre(input, home);
  else phasePost(input, home);
}

try {
  main();
} catch (err) {
  // Last resort. Exit 0 regardless: a non-zero exit makes the harness ignore our JSON, and any JSON
  // already written IS the redaction. Never let a bug here become "original output used".
  process.stderr.write(`secret-shield: internal error (${(err && err.code) || 'error'})\n`);
}
process.exit(0);
