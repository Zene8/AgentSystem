// envelope.js — the one shape every inbound adapter produces.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// Adapters (gmail, beeper, github, notion) each speak a different API. The dispatcher, the
// classifier and the closeout all speak ONLY this envelope, so a new source is a new adapter and
// nothing else. Pure Node builtins (tools/ rule): no npm deps, no network, no I/O at all.
//
// The validation here is deliberately loud. An adapter that hands over a malformed item is a bug
// in that adapter, and the failure must land there — at publish time, naming the field — rather
// than downstream in a classifier prompt or, worse, in a spawned agent's instructions.

export const SOURCES = ['gmail', 'beeper', 'github', 'notion'];

// Bodies are truncated by the adapter before they ever reach the bus. Two independent reasons:
// event-bus.js refuses a payload over 64 KiB, and the classifier is a one-shot Haiku call whose
// cost is the input. 4000 chars is well inside both and is more than enough to decide
// ignore/notify/action — anything needing the full text is an `action` and the agent fetches it.
export const BODY_MAX_CHARS = 4000;

const TRUNCATION_SUFFIX = '\n[truncated]';

/**
 * Cut `text` to BODY_MAX_CHARS, marking it so the classifier can see the body is partial and the
 * reader of a closeout is not misled into thinking a short message was the whole message.
 */
export function truncateBody(text, max = BODY_MAX_CHARS) {
  const s = text == null ? '' : String(text);
  if (s.length <= max) return s;
  return s.slice(0, max - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

const REQUIRED_STRINGS = ['source', 'externalId', 'ts', 'actor', 'subject', 'url'];

/**
 * Validate and normalize one raw adapter item into an envelope.
 *
 * Throws on anything an adapter should not be emitting. `body` is the only optional field — a
 * calendar-style item or a bare notification legitimately has none — and it is truncated here as
 * a backstop even though adapters are expected to do it themselves.
 */
export function normalizeEnvelope(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('envelope must be an object');
  }

  for (const field of REQUIRED_STRINGS) {
    const v = raw[field];
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`envelope.${field} must be a non-empty string`);
    }
  }

  if (!SOURCES.includes(raw.source)) {
    throw new Error(`envelope.source "${raw.source}" is not one of: ${SOURCES.join(', ')}`);
  }

  // `externalId` is the dedupe key for the cursor's seenIds ring and for the whole "did we already
  // action this?" question. An id that changes between polls is not a dedupe key at all — it turns
  // every poll into a fresh item and, once `action` verdicts are live, into a spawn storm. There is
  // no way to detect instability from a single item, so the contract is asserted in the adapter's
  // own contract test (cursor/id monotonicity) and only its shape is checked here.
  if (/\s/.test(raw.externalId)) {
    throw new Error('envelope.externalId must not contain whitespace');
  }

  const ts = new Date(raw.ts);
  if (Number.isNaN(ts.getTime())) {
    throw new Error(`envelope.ts "${raw.ts}" is not a parseable date`);
  }

  if (raw.body != null && typeof raw.body !== 'string') {
    throw new Error('envelope.body must be a string when present');
  }

  return {
    source: raw.source,
    externalId: raw.externalId,
    ts: ts.toISOString(),
    actor: raw.actor,
    subject: raw.subject,
    body: truncateBody(raw.body ?? ''),
    url: raw.url,
  };
}

/**
 * The subset of an envelope that is safe to write to durable storage — `done.jsonl`, the closeout,
 * the panel.
 *
 * `subject` and `body` are deliberately absent. `done.jsonl` lives under
 * ~/agent-memory/nexus/events/ and that repo, private though it is, syncs to every host; writing
 * mail bodies and chat text there distributes them further than they need to travel. `url` is the
 * escape hatch: a human reading a closeout clicks through to the source of truth.
 */
export function redactForRecord(envelope, extra = {}) {
  return {
    source: envelope.source,
    externalId: envelope.externalId,
    ts: envelope.ts,
    actor: envelope.actor,
    url: envelope.url,
    ...extra,
  };
}
