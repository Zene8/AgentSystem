// dispatch.js — the `inbound-item` handler: what actually happens to a polled item.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
//   paused? -> release, spend nothing
//   policy still enabled? -> classify -> cap -> publish a spawn-agent event | record a notify
//
// This is the only place in the pipeline where a model call and a spawn decision meet, so it is
// where every brake lives. Each one exists because of a distinct way this can go wrong:
//
//   pause      a person needs to be able to stop the fleet acting with one file, no deploy.
//   policy     the item was queued under the policy of an earlier poll. A source turned OFF between
//              the poll and the drain must not still get agents spawned from its backlog.
//   cap        a wrong verdict is survivable; a hundred wrong verdicts in one morning is not.
//   ceiling    the spawn goes out as a `spawn-agent` EVENT, never a direct spawnAgent() call, so
//              Mission Control's MC_MAX_PER_HARNESS / MC_MAX_BG_SESSIONS limits still arbitrate and
//              a rejected spawn requeues with backoff instead of vanishing.
//
// Privacy boundary, and it is deliberate: the body reaches the CLASSIFIER and nothing else. The
// spawn prompt carries subject, actor, url and the classifier's one-line task — never the body — so
// no `spawn-agent` event, and therefore no synced `done.jsonl` record, can hold the text of a
// private message. The inbound event itself is marked `_sensitive` so the bus redacts it on
// completion (event-bus.js `redactPayload`).
//
// The autonomy-ceiling preamble is composed HERE, not by the classifier. A polled email is untrusted
// text; if the model wrote the prompt, the email could argue its way past "draft PRs only".

import { classify } from './classifier.js';
import { claimAction } from './caps.js';
import { isPaused } from './pause.js';
import { loadPolicy } from './policy.js';
import * as bus from '../event-bus.js';

export const CEILING = [
  'AUTONOMY CEILING — this task was triggered automatically by an inbound item, not by a person:',
  '  - Draft PRs only. Never merge, never push to main, never close an issue.',
  '  - Never send email, chat, or any outbound message.',
  '  - If the task needs a human decision, a credential, or money: stop and raise a human-needed alert.',
].join('\n');

/** An error the dispatcher recognises as "not now": release the claim, spend no attempt. */
export function deferredError(message) {
  const err = new Error(message);
  err.deferred = true;
  return err;
}

/**
 * The prompt handed to the spawned agent. Body-free by construction — every field interpolated here
 * is a header, and the only free text is the classifier's own one-line task.
 */
export function buildSpawnPrompt(envelope, verdict) {
  return [
    CEILING,
    '',
    `Task: ${verdict.task}`,
    '',
    'Context:',
    `  source:  ${envelope.source}`,
    `  from:    ${envelope.actor}`,
    `  subject: ${envelope.subject}`,
    `  link:    ${envelope.url}`,
    `  triage:  ${verdict.why}`,
    '',
    'Open the link for the full item. Do not assume anything not visible there.',
  ].join('\n');
}

// What lands in done.jsonl for every item, whatever the verdict. Never the body: this record syncs
// to every host through the private brain repo, and "private" is not the same as "publish it there".
function record(envelope, verdict, extra) {
  return {
    source: envelope.source,
    externalId: envelope.externalId,
    url: envelope.url,
    actor: envelope.actor,
    verdict: verdict.verdict,
    why: verdict.why,
    degraded: verdict.degraded === true,
    ...extra,
  };
}

/**
 * Handle one `inbound-item` event. Signature matches the bus handler contract:
 * `(payload, event) => result`, where a thrown error means retry-with-backoff and a thrown
 * `deferred` error means release.
 *
 * Injectables exist so the tests run with no model call, no policy file and no spawn.
 */
export function inboundItemHandler(payload, event, deps = {}) {
  const {
    classifier = classify,
    policyLoader = loadPolicy,
    paused = isPaused,
    claim = claimAction,
    publish = bus.publish,
    env = process.env,
    now = new Date(),
  } = deps;

  const envelope = payload && payload.envelope;
  if (!envelope || !envelope.source || !envelope.externalId) {
    // Not deferrable and not retryable: a malformed event will be just as malformed next time, so
    // let it exhaust its attempts and dead-letter where the reconciler will report it.
    throw new Error('inbound-item requires payload.envelope with source and externalId');
  }

  // 1. Kill switch. First, before the model call — a pause must cost nothing, not even a token.
  if (paused()) {
    throw deferredError(`inbound dispatch paused — ${envelope.source}/${envelope.externalId} released`);
  }

  // 2. Policy, re-read at dispatch time. The item was queued under an older read of it.
  const policy = policyLoader(envelope.source, { env });
  if (!policy.enabled) {
    return record(envelope, { verdict: 'ignore', why: `source disabled at dispatch: ${policy.reason}` },
      { action: 'dropped' });
  }

  // 3. Classify. Never throws; an unreadable answer is already a notify (classifier.js).
  const verdict = classifier(envelope);

  if (verdict.verdict !== 'action') {
    return record(envelope, verdict, { action: 'none' });
  }

  // 4. Daily cap. An over-cap action degrades to notify — recorded, not lost.
  const slot = claim(envelope.source, policy.maxActionsPerDay, { now });
  if (!slot.allowed) {
    return record(envelope, {
      verdict: 'notify',
      why: `action suppressed by daily cap (${slot.used}/${slot.limit} for ${slot.day}): ${verdict.why}`,
      degraded: true,
    }, { action: 'capped', reason: slot.reason });
  }

  // 5. Spawn — as an event, so the harness concurrency caps still apply.
  const spawned = publish({
    type: 'spawn-agent',
    source: `inbound/${envelope.source}`,
    payload: {
      agent: verdict.agent,
      prompt: buildSpawnPrompt(envelope, verdict),
      cwd: env.AGENTSYSTEM_ROOT || undefined,
    },
  });

  return record(envelope, verdict, {
    action: 'spawned',
    agent: verdict.agent,
    spawnEventId: spawned && spawned.id,
    capUsed: `${slot.used}/${slot.limit}`,
  });
}
