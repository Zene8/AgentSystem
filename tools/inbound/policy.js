// policy.js — what each inbound source is allowed to do, loaded fail-closed.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// The policy file lives at $LIFE_REPO/inbound-policy.yml, in the PRIVATE Life OS repo, because it
// holds sender and chat allowlists. It is never committed here and never passed as a workflow
// input: Zene8/AgentSystem is public and Actions logs would publish it. The schema-only example is
// docs/inbound-policy.example.yml.
//
// Fail closed, everywhere. A missing file, an unreadable file, a file this parser does not
// understand, a source that is absent from it, a cadence tier that does not exist — every one of
// them DISABLES that adapter and says why. Nothing here has a permissive default. The direction is
// the same as GITHUB_WEBHOOK_SECRET being unset in webhook-server.js, which rejects every webhook
// rather than accepting them.
//
// Pure Node builtins (tools/ rule). No npm YAML dependency — see parseInboundPolicy.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SOURCES } from './envelope.js';

export const CADENCE_TIERS = ['fast', 'medium', 'daily'];

// Interval per tier, in ms. Used by the reconciler to decide whether a tier's lastRunAt is stale
// (spec: older than 3x its interval) and by the timer installer to write OnUnitActiveSec.
export const CADENCE_INTERVAL_MS = {
  fast: 2 * 60 * 1000,
  medium: 10 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

export const POLICY_FILENAME = 'inbound-policy.yml';

// Every key a source block may declare. An unrecognized key disables the source rather than being
// ignored, because the realistic cause is a misspelling in a security-relevant field — a policy
// with `senders_alow:` in it must not read as "gmail has no allowlist configured, carry on".
const SCALAR_KEYS = new Set(['enabled', 'cadence', 'max_actions_per_day']);
const LIST_KEYS = new Set(['senders_allow', 'labels_ignore', 'chats_allow', 'reasons', 'databases']);

/**
 * The Life OS repo root, which the whole design depends on.
 *
 * Throws when $LIFE_REPO is unset. That is deliberate and it is a behavior change: today an unset
 * $LIFE_REPO only degrades the daily closeout path (#281). Under this design it means no policy
 * file, which means fail-closed disables EVERY adapter — a poller that runs on a timer, does
 * nothing at all, and exits 0 forever. Loud beats silent.
 */
export function lifeRepoRoot(env = process.env) {
  const raw = env.LIFE_REPO;
  if (!raw || String(raw).trim() === '') {
    throw new Error(
      '$LIFE_REPO is unset, so no inbound policy can be loaded and every adapter would '
      + 'silently fail closed (see #281). Set it to the Life OS checkout root.',
    );
  }
  return String(raw).trim();
}

export function policyPath(env = process.env) {
  return join(lifeRepoRoot(env), POLICY_FILENAME);
}

/**
 * Parse the constrained YAML subset the policy file uses:
 *
 *   <source>:
 *     enabled: true
 *     cadence: fast
 *     max_actions_per_day: 12
 *     senders_allow: [a@example.com, b@example.com]
 *
 * That is the whole grammar — top-level map of maps, scalars and inline lists, `#` comments. No
 * block sequences, no nesting past two levels, no multi-line scalars, no anchors.
 *
 * tools/ takes no npm deps, so there is no full YAML parser available; routines.js writes its own
 * for routines.yml for the same reason. This one THROWS on any line it does not recognize instead
 * of skipping it. A lenient parser on a file that gates what the fleet may act on would let a
 * typo'd or half-written line vanish, and the caller cannot tell "not configured" from
 * "configured, silently dropped".
 */
export function parseInboundPolicy(text) {
  const out = {};
  let current = null;
  let currentName = null;
  let lineNo = 0;

  for (const rawLine of String(text).split('\n')) {
    lineNo += 1;
    const line = rawLine.replace(/\r$/, '');
    const withoutComment = stripComment(line);
    if (withoutComment.trim() === '') continue;

    // Top-level source header: `gmail:` at column 0, no value.
    const header = withoutComment.match(/^([A-Za-z][\w-]*):\s*$/);
    if (header) {
      currentName = header[1];
      if (Object.prototype.hasOwnProperty.call(out, currentName)) {
        throw new Error(`line ${lineNo}: source "${currentName}" declared twice`);
      }
      current = {};
      out[currentName] = current;
      continue;
    }

    const entry = withoutComment.match(/^\s+([A-Za-z][\w-]*):\s*(.*)$/);
    if (!entry) {
      throw new Error(`line ${lineNo}: cannot parse ${JSON.stringify(line)}`);
    }
    if (!current) {
      throw new Error(`line ${lineNo}: "${entry[1]}" appears before any source header`);
    }

    const key = entry[1];
    const value = entry[2].trim();
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      throw new Error(`line ${lineNo}: key "${key}" declared twice under "${currentName}"`);
    }

    if (SCALAR_KEYS.has(key)) {
      if (value === '') throw new Error(`line ${lineNo}: "${key}" has no value`);
      current[key] = parseScalar(value, lineNo, key);
      continue;
    }
    if (LIST_KEYS.has(key)) {
      current[key] = parseInlineList(value, lineNo, key);
      continue;
    }
    throw new Error(
      `line ${lineNo}: unknown key "${key}" under "${currentName}" — allowed: `
      + `${[...SCALAR_KEYS, ...LIST_KEYS].sort().join(', ')}`,
    );
  }

  return out;
}

function stripComment(line) {
  // No quoted strings in this grammar, so a `#` is always a comment. Keeping it that simple is
  // what makes the parser auditable.
  const i = line.indexOf('#');
  return i === -1 ? line : line.slice(0, i);
}

function parseScalar(value, lineNo, key) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^["'].*["']$/.test(value)) return value.slice(1, -1);
  if (/^[\w.@:/-]+$/.test(value)) return value;
  throw new Error(`line ${lineNo}: "${key}" value ${JSON.stringify(value)} is not a plain scalar`);
}

function parseInlineList(value, lineNo, key) {
  if (value === '' || value === '[]') return [];
  const m = value.match(/^\[(.*)\]$/);
  if (!m) throw new Error(`line ${lineNo}: "${key}" must be an inline list like [a, b] or []`);
  const inner = m[1].trim();
  if (inner === '') return [];
  return inner.split(',').map((part, i) => {
    const item = part.trim().replace(/^["'](.*)["']$/, '$1');
    if (item === '') throw new Error(`line ${lineNo}: "${key}" has an empty item at position ${i}`);
    return item;
  });
}

/**
 * Load the policy for one source.
 *
 * Never throws for a file-level problem — a poller runs per source and one bad file must not take
 * down the process with a stack trace no timer will read. Returns
 * `{ enabled: false, reason }` instead, which the caller alerts on. The one exception is an unset
 * $LIFE_REPO, which lifeRepoRoot() throws for, because that is not one source failing.
 */
export function loadPolicy(source, { env = process.env, path } = {}) {
  if (!SOURCES.includes(source)) {
    throw new Error(`unknown source "${source}" — allowed: ${SOURCES.join(', ')}`);
  }

  const file = path || policyPath(env);

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return disabled(`policy file ${file} is unreadable (${err.code || err.message})`);
  }

  let parsed;
  try {
    parsed = parseInboundPolicy(text);
  } catch (err) {
    return disabled(`policy file ${file} does not parse: ${err.message}`);
  }

  const block = parsed[source];
  if (!block) return disabled(`policy file ${file} has no "${source}" section`);

  if (typeof block.enabled !== 'boolean') {
    return disabled(`"${source}.enabled" must be true or false`);
  }
  if (block.enabled !== true) return disabled(`"${source}.enabled" is false`);

  if (!CADENCE_TIERS.includes(block.cadence)) {
    return disabled(
      `"${source}.cadence" must be one of ${CADENCE_TIERS.join(', ')} (got ${JSON.stringify(block.cadence)})`,
    );
  }

  const cap = block.max_actions_per_day;
  if (!Number.isInteger(cap) || cap < 0) {
    return disabled(`"${source}.max_actions_per_day" must be a non-negative integer`);
  }

  return {
    enabled: true,
    source,
    cadence: block.cadence,
    intervalMs: CADENCE_INTERVAL_MS[block.cadence],
    maxActionsPerDay: cap,
    sendersAllow: block.senders_allow || [],
    labelsIgnore: block.labels_ignore || [],
    chatsAllow: block.chats_allow || [],
    reasons: block.reasons || [],
    databases: block.databases || [],
  };
}

function disabled(reason) {
  return { enabled: false, reason };
}

/**
 * Every source in a given cadence tier that is currently enabled. This is what a tier timer runs:
 * one unit per tier, not one per source, so adding a source never adds a unit.
 */
export function sourcesForCadence(cadence, opts = {}) {
  if (!CADENCE_TIERS.includes(cadence)) {
    throw new Error(`unknown cadence "${cadence}" — allowed: ${CADENCE_TIERS.join(', ')}`);
  }
  const out = [];
  for (const source of SOURCES) {
    const policy = loadPolicy(source, opts);
    if (policy.enabled && policy.cadence === cadence) out.push(policy);
  }
  return out;
}
