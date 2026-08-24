// Tests for tools/inbound/dispatch.js — the inbound-item handler and its brakes.
//
// Nothing here calls a model, reads the real policy file, touches the real per-host cache or spawns
// an agent: the classifier, the policy loader, the pause check, the cap claim and the publisher are
// all injected. The last two tests are the exception and go the other way on purpose — they drive
// the REAL drain() over a REAL temp bus root, because "the kill switch stops dispatch" is only worth
// anything if it holds through the code that actually runs in production.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as bus from '../event-bus.js';
import { drain, HANDLERS } from '../event-dispatcher.js';
import { CEILING, buildSpawnPrompt, deferredError, inboundItemHandler } from './dispatch.js';

const ENVELOPE = {
  source: 'github',
  externalId: 'gh-7-1',
  ts: '2026-08-22T10:00:00.000Z',
  actor: 'Zene8/AgentSystem',
  subject: '[ci_activity] CI failed on main',
  body: 'SECRET-BODY private message text',
  url: 'https://github.com/Zene8/AgentSystem/actions',
};

const POLICY_ON = { enabled: true, source: 'github', cadence: 'medium', maxActionsPerDay: 5 };

const ACTION = { verdict: 'action', why: 'workflow failure', agent: 'leo', task: 'Fix the lint step.', degraded: false };
const NOTIFY = { verdict: 'notify', why: 'needs a human', agent: null, task: null, degraded: false };
const IGNORE = { verdict: 'ignore', why: 'newsletter', agent: null, task: null, degraded: false };

// A full set of injectables with every brake OPEN, so each test overrides only what it is about.
function deps(over = {}) {
  const spawns = [];
  const claims = [];
  const base = {
    classifier: () => ACTION,
    policyLoader: () => POLICY_ON,
    paused: () => false,
    claim: (source, limit) => {
      claims.push({ source, limit });
      return { allowed: true, used: 1, limit, remaining: limit - 1, day: '2026-08-22', reason: null };
    },
    publish: (event) => { spawns.push(event); return { id: `evt-${spawns.length}` }; },
    env: {},
  };
  const d = { ...base, ...over };
  d.spawns = spawns;
  d.claims = claims;
  return d;
}

function handle(d, envelope = ENVELOPE) {
  return inboundItemHandler({ _sensitive: true, envelope }, { type: 'inbound-item' }, d);
}

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-dispatch-')); }

// --- the happy path ---

test('an action verdict publishes a spawn-agent event and records what it did', () => {
  const d = deps();
  const r = handle(d);
  assert.equal(r.action, 'spawned');
  assert.equal(r.agent, 'leo');
  assert.equal(r.verdict, 'action');
  assert.equal(r.spawnEventId, 'evt-1');
  assert.equal(r.capUsed, '1/5');

  assert.equal(d.spawns.length, 1);
  assert.equal(d.spawns[0].type, 'spawn-agent');
  assert.equal(d.spawns[0].source, 'inbound/github');
  assert.equal(d.spawns[0].payload.agent, 'leo');
});

test('the spawn goes out as an EVENT, never a direct spawn, so harness caps still arbitrate', () => {
  const d = deps();
  handle(d);
  assert.equal(d.spawns[0].type, 'spawn-agent',
    'a direct spawnAgent() call would bypass MC_MAX_PER_HARNESS and lose the retry');
});

test('a notify and an ignore verdict spawn nothing at all', () => {
  for (const verdict of [NOTIFY, IGNORE]) {
    const d = deps({ classifier: () => verdict });
    const r = handle(d);
    assert.equal(r.action, 'none');
    assert.equal(r.verdict, verdict.verdict);
    assert.deepEqual(d.spawns, []);
    assert.deepEqual(d.claims, [], 'a non-action must not spend a daily slot');
  }
});

// --- the privacy boundary ---

test('the body never reaches the spawn prompt, only the classifier', () => {
  let sawBody = false;
  const d = deps({ classifier: (env) => { sawBody = env.body.includes('SECRET-BODY'); return ACTION; } });
  handle(d);
  assert.equal(sawBody, true, 'the classifier needs the body to judge');
  const serialized = JSON.stringify(d.spawns[0]);
  assert.equal(serialized.includes('SECRET-BODY'), false,
    'a spawn-agent event lands in done.jsonl and syncs to every host');
});

test('the handler result carries no body either', () => {
  const r = handle(deps());
  assert.equal(JSON.stringify(r).includes('SECRET-BODY'), false);
  assert.equal(r.url, ENVELOPE.url, 'the link is how the agent gets the content, not a copy of it');
});

test('the autonomy ceiling is our text, at the TOP of the prompt, above anything model-written', () => {
  const prompt = buildSpawnPrompt(ENVELOPE, ACTION);
  assert.ok(prompt.startsWith(CEILING));
  assert.match(prompt, /Draft PRs only/);
  assert.match(prompt, /Never send email, chat/);
  assert.ok(prompt.indexOf('Draft PRs only') < prompt.indexOf(ACTION.task),
    'the ceiling must precede the task, so an item cannot argue past it first');
});

test('the prompt carries only headers and the classifier one-line task', () => {
  const prompt = buildSpawnPrompt(ENVELOPE, ACTION);
  for (const field of [ENVELOPE.actor, ENVELOPE.subject, ENVELOPE.url, ACTION.task, ACTION.why]) {
    assert.ok(prompt.includes(field), `prompt should carry ${field}`);
  }
  assert.equal(prompt.includes('SECRET-BODY'), false);
});

// --- the brakes ---

test('a paused host throws a DEFERRED error and does not classify, cap or spawn', () => {
  let classified = false;
  const d = deps({ paused: () => true, classifier: () => { classified = true; return ACTION; } });
  try {
    handle(d);
    assert.fail('a paused host must not return normally');
  } catch (err) {
    assert.equal(err.deferred, true);
    assert.match(err.message, /paused/);
  }
  assert.equal(classified, false, 'a pause must cost nothing, not even a token');
  assert.deepEqual(d.spawns, []);
  assert.deepEqual(d.claims, []);
});

test('the pause is checked FIRST, before even the policy read', () => {
  let policyRead = false;
  const d = deps({ paused: () => true, policyLoader: () => { policyRead = true; return POLICY_ON; } });
  assert.throws(() => handle(d), /paused/);
  assert.equal(policyRead, false);
});

test('a source disabled between poll and dispatch is dropped, not spawned', () => {
  const d = deps({ policyLoader: () => ({ enabled: false, reason: '"github.enabled" is false' }) });
  const r = handle(d);
  assert.equal(r.action, 'dropped');
  assert.equal(r.verdict, 'ignore');
  assert.match(r.why, /source disabled at dispatch/);
  assert.deepEqual(d.spawns, []);
});

test('over the daily cap an action degrades to notify — recorded, never lost, never spawned', () => {
  const d = deps({
    claim: () => ({ allowed: false, used: 5, limit: 5, remaining: 0, day: '2026-08-22', reason: 'daily-cap' }),
  });
  const r = handle(d);
  assert.equal(r.action, 'capped');
  assert.equal(r.verdict, 'notify');
  assert.equal(r.reason, 'daily-cap');
  assert.equal(r.degraded, true);
  assert.match(r.why, /daily cap \(5\/5 for 2026-08-22\)/);
  assert.match(r.why, /workflow failure/, 'the original verdict reason survives in the record');
  assert.deepEqual(d.spawns, []);
});

test('the cap is claimed with the policy limit for that source', () => {
  const d = deps({ policyLoader: () => ({ ...POLICY_ON, maxActionsPerDay: 2 }) });
  handle(d);
  assert.deepEqual(d.claims, [{ source: 'github', limit: 2 }]);
});

test('a degraded classifier verdict is recorded as degraded', () => {
  const d = deps({ classifier: () => ({ verdict: 'notify', why: 'reply did not parse', degraded: true }) });
  const r = handle(d);
  assert.equal(r.degraded, true);
  assert.match(r.why, /did not parse/);
});

// --- malformed input ---

test('a malformed event throws a plain (non-deferred) error, so it retries and dead-letters', () => {
  for (const payload of [null, {}, { envelope: {} }, { envelope: { source: 'github' } }]) {
    try {
      inboundItemHandler(payload, {}, deps());
      assert.fail(`payload ${JSON.stringify(payload)} should have thrown`);
    } catch (err) {
      assert.match(err.message, /requires payload.envelope/);
      assert.notEqual(err.deferred, true, 'a malformed event must not be released forever');
    }
  }
});

test('deferredError marks the error and nothing else', () => {
  const err = deferredError('because');
  assert.ok(err instanceof Error);
  assert.equal(err.deferred, true);
  assert.equal(err.message, 'because');
});

// --- the phase gate: through the REAL dispatcher, over a REAL bus ---

test('inbound-item is registered in the real HANDLERS map', () => {
  assert.equal(HANDLERS['inbound-item'], inboundItemHandler);
});

test('THE KILL SWITCH: while paused, drain releases every inbound item and spawns nothing', () => {
  const root = tmpRoot();
  for (const id of ['gh-1', 'gh-2', 'gh-3']) {
    bus.publish({
      type: 'inbound-item',
      payload: { _sensitive: true, envelope: { ...ENVELOPE, externalId: id } },
    }, root);
  }

  let classified = 0;
  let spawned = 0;
  const handlers = {
    'inbound-item': (payload, event) => inboundItemHandler(payload, event, deps({
      paused: () => true,
      classifier: () => { classified += 1; return ACTION; },
      publish: () => { spawned += 1; return { id: 'x' }; },
    })),
  };

  const first = drain({ root, handlers });
  assert.equal(first.released, 1);
  assert.equal(first.processed, 1, 'the pass stops at the first deferral instead of churning the backlog');
  assert.equal(first.completed, 0);
  assert.equal(first.dead, 0);
  assert.equal(classified, 0, 'paused means no model call');
  assert.equal(spawned, 0, 'paused means no spawn');

  // Nothing is lost, nothing is burned: all three are still queued, none dead-lettered, and this
  // holds however many times the timer fires while the pause is on.
  for (let i = 0; i < 6; i += 1) drain({ root, handlers });
  const s = bus.stats(root);
  assert.equal(s.pending, 3);
  assert.equal(s.dead, 0);
  assert.equal(s.done, 0);
  assert.equal(spawned, 0);

  // And the moment the pause lifts, the same queue drains normally.
  const running = {
    'inbound-item': (payload, event) => inboundItemHandler(payload, event, deps({
      classifier: () => NOTIFY,
    })),
  };
  const after = drain({ root, handlers: running });
  assert.equal(after.completed, 3);
  assert.equal(after.released, 0);
  assert.equal(bus.stats(root).pending, 0);
});

test('drained inbound records reach done.jsonl with the verdict and without the body', () => {
  const root = tmpRoot();
  bus.publish({ type: 'inbound-item', payload: { _sensitive: true, envelope: ENVELOPE } }, root);
  const summary = drain({
    root,
    handlers: {
      'inbound-item': (payload, event) => inboundItemHandler(payload, event, deps({ classifier: () => NOTIFY })),
    },
  });
  assert.equal(summary.completed, 1);

  const line = JSON.parse(fs.readFileSync(path.join(root, 'done.jsonl'), 'utf8').trim());
  assert.equal(line.result.verdict, 'notify');
  assert.equal(line.result.externalId, ENVELOPE.externalId);
  assert.deepEqual(line.payload, { _sensitive: true, redactedKeys: ['envelope'] });
  assert.equal(JSON.stringify(line).includes('SECRET-BODY'), false,
    'done.jsonl syncs to every host — the body must be gone by the time it lands');
});
