'use strict';
// guard-secrets.js — PreToolUse (matcher: Bash). Denies a Bash call whose command string
// contains the literal value of a known local secret file.
//
// Why a hook and not a rule (#508, after #506 rotated the Mission Control bearer key):
// a tool call's `tool_input.command` is recorded verbatim in the session transcript and in
// ~/.claude/history.jsonl. So `K=<literal>; curl -H "Authorization: Bearer $K" ...` publishes
// the secret just as surely as echoing it, even though the agent never "printed" it. The
// dispatch brief for the preceding work explicitly required comparing keys by hash and never
// rendering the value; that instruction was followed and the value still reached the transcript
// three times by three paths. An instruction is not a control point. This is.
//
// Two hard properties:
//   1. It NEVER renders a secret. Comparison is sha256-vs-sha256; nothing in any log line,
//      error path or denial message contains a secret value or any substring of one. The only
//      thing named is the FILE.
//   2. It DENIES (exit 2) rather than warns. A warning fires after the command text is already
//      in the transcript, which is the entire leak.
//
// It fails OPEN on its own internal errors (no ~/.claude, unreadable file, malformed stdin) and
// CLOSED only on an actual hash match: a crashing guard must not brick every Bash call.
//
// Paths this canNOT close, by construction — once a value is in context it is in the transcript:
//   - the user pastes a secret into the session;
//   - compaction re-emits whatever is in context, unbound by any instruction aimed at the
//     agent's own output.
// Those are handled procedurally in the shared `operating-discipline` block: a secret pasted
// into a session is compromised the moment it is pasted — rotate it, start a fresh session.
//
// Pure Node builtins (repo rule for tools/ and hooks/). CommonJS: see hooks/package.json.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Deliberately NO env override for the secret directory. An env-var escape hatch on a deny-only
// guard is a one-line bypass ("point it at an empty dir"), and the tests do not need one: they
// override HOME/USERPROFILE, which is what os.homedir() reads on every platform.
const SECRET_DIR = () => path.join(os.homedir(), '.claude');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Below this, a "secret" file is a placeholder and matching it would deny ordinary words.
const MIN_SECRET_LEN = 16;

/**
 * Every known local secret, as { byHash: Map<sha256, displayName>, lengths: Set<number> }.
 * Trailing whitespace/newlines are trimmed before hashing (and a fully-trimmed variant is added
 * too) so a key file saved with a trailing newline still matches the inlined literal, which has
 * none. Values shorter than MIN_SECRET_LEN are ignored: a short or placeholder file would
 * otherwise make an ordinary word deniable.
 *
 * `lengths` holds only the LENGTH of each secret, never its bytes — that is what lets the window
 * scan below look for a secret glued to other characters without ever holding the value.
 */
function secretHashes() {
  const byHash = new Map();
  const lengths = new Set();
  const dir = SECRET_DIR();
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { byHash, lengths }; // no ~/.claude on this host — fail open.
  }
  for (const name of names) {
    if (!name.endsWith('.key')) continue;
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue; // unreadable file — fail open for that file only.
    }
    for (const v of new Set([raw.replace(/\s+$/, ''), raw.trim()])) {
      if (v.length < MIN_SECRET_LEN) continue;
      byHash.set(sha256(v), `~/.claude/${name}`);
      lengths.add(v.length);
    }
  }
  return { byHash, lengths };
}

// The shapes that actually occur here: lowercase hex keys (the Mission Control bearer key is
// 64 hex chars) and long url-safe base64-ish tokens.
const TOKEN_PATTERNS = [/[0-9a-f]{32,}/g, /[A-Za-z0-9_-]{40,}/g];

// Cap on the window scan: tokens longer than this get the exact-match check only.
const MAX_SCAN_TOKEN_LEN = 4096;

/**
 * The display name of the secret file whose value appears in `command`, or null.
 * Exact token match first — the fast path, and the shape of the real incident. Then a bounded
 * scan of windows at each known secret LENGTH inside longer tokens: without it a secret glued to
 * other characters (`?token=<key>`, `Bearer<key>x`) tokenises as one longer string and the exact
 * comparison misses it.
 */
function findSecret(command, secrets) {
  const { byHash, lengths } = secrets || {};
  if (!command || !byHash || byHash.size === 0) return null;
  const tokens = new Set();
  for (const re of TOKEN_PATTERNS) {
    for (const m of String(command).matchAll(re)) tokens.add(m[0]);
  }
  for (const t of tokens) {
    const hit = byHash.get(sha256(t));
    if (hit) return hit;
  }
  for (const t of tokens) {
    // A pathological command line must not make the guard slow — it runs on EVERY Bash call.
    if (t.length > MAX_SCAN_TOKEN_LEN) continue;
    for (const len of lengths) {
      if (len >= t.length) continue;
      for (let i = 0; i + len <= t.length; i++) {
        const hit = byHash.get(sha256(t.slice(i, i + len)));
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * Denial text. Contains the file and the correct form — never a value, not even truncated.
 * There is no "last 4" here on purpose: 4 characters of a rotated key is still 4 characters
 * of a key in the transcript forever.
 */
function denialMessage(file) {
  return [
    `BLOCKED: this command contains the literal value of ${file}.`,
    `A tool call's command string is recorded verbatim in the session transcript and in`,
    `~/.claude/history.jsonl, so passing a secret inline publishes it — see #506/#508.`,
    `Use "$(cat ${file})" instead of the literal value; every documented invocation in this repo`,
    `already does (docs/mission-control-linux-deploy.md, docs/mission-control-windows-deploy.md).`,
    `The value you inlined is now in this transcript: it must be rotated.`,
  ].join('\n');
}

function main() {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    let file = null;
    try {
      const payload = JSON.parse(input || '{}');
      if ((payload.tool_name || '') !== 'Bash') return process.exit(0);
      file = findSecret(payload.tool_input && payload.tool_input.command, secretHashes());
    } catch {
      return process.exit(0); // malformed stdin / anything unexpected: fail open.
    }
    if (file) {
      process.stderr.write(denialMessage(file) + '\n');
      // Also on stdout: hosts that only capture one stream (the Antigravity bridge reads
      // stdout) must still see the denial.
      process.stdout.write(denialMessage(file) + '\n');
      return process.exit(2); // PreToolUse: 2 = deny the call.
    }
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(0));
}

module.exports = { findSecret, secretHashes, denialMessage };

if (require.main === module) main();
