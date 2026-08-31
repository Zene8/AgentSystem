'use strict';
// secret-shield-redact.cjs — the two directions of the shield (issue #222).
//
//   redactShape()    ingress: real value -> stable placeholder, before bytes leave the machine.
//   rehydrateShape() egress:  placeholder -> real value, at the disk/shell boundary.
//
// Why both live in one module: they are a matched pair, and the epic is explicit that shipping
// rehydration without the ingress filter is a NET LOSS — rehydration puts a real secret into a
// shell command, and that command's stdout is a tool result that goes to the cloud on the next
// request. Keeping them in one file makes it hard to deploy half of it.
//
// SHAPE PRESERVATION is deliberate. PostToolUse `tool_response` is an object whose fields differ
// per tool (Bash: {stdout,stderr,exit_code}; Read: {file_contents}; Grep: {matches:[{line_content}]};
// MCP: a bare array of content blocks). The docs do not state whether `updatedToolOutput` must be a
// string or must mirror `tool_response`'s type, so we walk the structure and hand back the SAME
// shape with only string leaves rewritten. That is correct under either reading.
//
// Node builtins only. CommonJS (hooks/package.json).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detect } = require('./secret-shield-detect.cjs');

// Depth cap: a tool response is data, and a cyclic or pathologically nested one must not hang the
// hook. Anything past the cap is left ALONE, and the caller is told (see `truncated`) so it can
// fail closed rather than pass unexamined bytes.
const MAX_DEPTH = 12;

// Matches the placeholder grammar from secret-shield-vault.cjs: __<TYPE>_<NN>__
const PLACEHOLDER_RE = /__[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_\d{2,}__/g;

/**
 * Literal sweep for every value already in the vault.
 *
 * THIS IS NOT A BELT-AND-BRACES EXTRA — it is the half of the shield the detectors cannot do.
 * Detection is contextual: `AWS_SECRET_ACCESS_KEY=<v>` matches a pattern, a bare `<v>` alone on
 * stdout does not. So the moment rehydration puts a real value into a shell command, that value
 * comes back in the command's output in a context no pattern recognises, and it leaks. Once a value
 * is in the vault we know it verbatim, so we can replace it unconditionally, in any context, with
 * the same stable placeholder. `the leak test` in hooks/secret-shield-hook.test.js fails without
 * this function — it was written first and caught exactly this.
 *
 * Runs AFTER the detectors, on their output, so the entropy detector never has to look at a
 * placeholder we just inserted.
 */
function sweepKnown(str, vault) {
  const replacements = [];
  if (typeof str !== 'string' || str.length === 0) return { text: str, replacements };
  if (typeof vault.knownValues !== 'function') return { text: str, replacements };

  let out = str;
  for (const known of vault.knownValues()) {
    if (!out.includes(known.value)) continue;
    // split/join, not RegExp: a secret can contain any byte, and escaping it into a pattern is a
    // needless way to get this wrong.
    const hits = out.split(known.value).length - 1;
    out = out.split(known.value).join(known.placeholder);
    for (let i = 0; i < hits; i++) replacements.push({ placeholder: known.placeholder, type: known.type });
  }
  return { text: out, replacements };
}

/**
 * Redact one string: detectors first, then the known-value sweep.
 * Detector replacement runs back-to-front so earlier indices stay valid.
 * Returns { text, replacements: [{ placeholder, type }] }.
 */
function redactString(str, vault, config = {}) {
  const replacements = [];
  if (typeof str !== 'string' || str.length === 0) return { text: str, replacements };

  const found = detect(str, { detectors: config.detectors || null, entropy: config.entropy !== false });

  let out = str;
  for (let i = found.length - 1; i >= 0; i--) {
    const d = found[i];
    const placeholder = vault.allocate(d.value, d.type);
    out = out.slice(0, d.start) + placeholder + out.slice(d.end);
    replacements.push({ placeholder, type: d.type });
  }
  replacements.reverse();

  const swept = sweepKnown(out, vault);
  return { text: swept.text, replacements: replacements.concat(swept.replacements) };
}

/**
 * Walk any JSON-ish value, redacting string leaves and preserving the container shape.
 * Returns { value, replacements, truncated } — `truncated` true means the depth cap was hit and
 * some bytes were NOT examined, which a fail-closed caller must treat as a failure.
 */
function redactShape(value, vault, config = {}, depth = 0) {
  const replacements = [];
  let truncated = false;

  if (depth > MAX_DEPTH) return { value, replacements, truncated: true };

  if (typeof value === 'string') {
    const r = redactString(value, vault, config);
    return { value: r.text, replacements: r.replacements, truncated: false };
  }
  if (Array.isArray(value)) {
    const out = value.map((v) => {
      const r = redactShape(v, vault, config, depth + 1);
      replacements.push(...r.replacements);
      truncated = truncated || r.truncated;
      return r.value;
    });
    return { value: out, replacements, truncated };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = redactShape(v, vault, config, depth + 1);
      replacements.push(...r.replacements);
      truncated = truncated || r.truncated;
      out[k] = r.value;
    }
    return { value: out, replacements, truncated };
  }
  // number | boolean | null | undefined — nothing to redact.
  return { value, replacements, truncated };
}

/**
 * Replace placeholders with their real values. Returns { text, used: [placeholder],
 * unknown: [placeholder] }.
 *
 * An UNKNOWN placeholder is not rehydrated and is reported. The caller decides: for a write or a
 * shell command, an unresolvable placeholder is ambiguous, and the epic says ambiguity blocks.
 */
function rehydrateString(str, vault) {
  const used = [];
  const unknown = [];
  if (typeof str !== 'string' || str.length === 0) return { text: str, used, unknown };

  const text = str.replace(PLACEHOLDER_RE, (ph) => {
    const real = vault.lookup(ph);
    if (real === null || real === undefined) { unknown.push(ph); return ph; }
    used.push(ph);
    return real;
  });
  return { text, used, unknown };
}

/** rehydrateString over an arbitrary shape, preserving containers. */
function rehydrateShape(value, vault, depth = 0) {
  const used = [];
  const unknown = [];
  if (depth > MAX_DEPTH) return { value, used, unknown };

  if (typeof value === 'string') {
    const r = rehydrateString(value, vault);
    return { value: r.text, used: r.used, unknown: r.unknown };
  }
  if (Array.isArray(value)) {
    const out = value.map((v) => {
      const r = rehydrateShape(v, vault, depth + 1);
      used.push(...r.used); unknown.push(...r.unknown);
      return r.value;
    });
    return { value: out, used, unknown };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = rehydrateShape(v, vault, depth + 1);
      used.push(...r.used); unknown.push(...r.unknown);
      out[k] = r.value;
    }
    return { value: out, used, unknown };
  }
  return { value, used, unknown };
}

/** Directory holding the vault, the key and the audit log. */
function shieldDir(home = os.homedir()) {
  return path.join(home, '.claude', 'secret-shield');
}

/**
 * Append one audit record. Records the PLACEHOLDER, never the value — the audit log is the thing a
 * human reads to check the shield, and a log that quotes secrets is the leak it was meant to catch.
 *
 * Best-effort by design: an unwritable audit log must not brick a tool call. The caller that needs
 * a hard guarantee checks the return value.
 */
function appendAudit(entry, home = os.homedir()) {
  try {
    const dir = shieldDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(path.join(dir, 'audit.jsonl'), line, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  MAX_DEPTH,
  PLACEHOLDER_RE,
  sweepKnown,
  redactString,
  redactShape,
  rehydrateString,
  rehydrateShape,
  appendAudit,
  shieldDir,
};
