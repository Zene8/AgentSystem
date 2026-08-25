#!/usr/bin/env node
// model-tier-guard.js — spend-aware tier guard (user-approved feature, no issue at time of
// writing; opened as a follow-up to #519 and referenced in that PR).
//
// WHY THIS EXISTS: on 2026-08-17 three dispatched agents died mid-task on "You've hit your
// org's monthly spend limit", with no prior signal. #519 fixed the blindness in the spend
// telemetry itself (claude-opus-5 was priced at $0, so the number this guard reads was
// silently wrong). This tool is the next layer up: given a requested model tier and this
// month's spend, decide whether to allow it, downgrade it to a cheaper tier, or refuse
// outright — BEFORE a caller burns budget on it.
//
// This module does NOT re-implement spend parsing. It imports the log-reading primitives
// from session-cost.js (parseSessionLog/dedupeSessions/rowDate) and the #519 unpriced-model
// aggregation (collectUnpriced) so both tools stay in lock-step with one log format.
//
// Wiring is documentation-only in this change (see bottom of file) — nothing here is
// auto-invoked by any hook or by sync-agents.js yet. A caller (a hook, a dispatch wrapper,
// sync-agents.js) would call `guardModel(...)` or shell out to this file's CLI before
// dispatching an opus/fable-tier agent, and act on the returned decision.

import { readFileSync, existsSync } from 'node:fs';
import { isMainModule } from './is-main.js';
import { LOG, parseSessionLog, dedupeSessions, rowDate, collectUnpriced } from './session-cost.js';

// Named once, per the DoD — every other reference (CLI help, env var fallback) reads this,
// never a second hardcoded number. $150 is Friday's default, NOT a number the user supplied —
// the user asked for a configurable threshold and the ability to set it, not for 150
// specifically. Override with --threshold=<usd> or MODEL_TIER_GUARD_THRESHOLD_USD.
export const DEFAULT_THRESHOLD_USD = 150;

// Tiers this guard cares about. Matches both the bare alias ('opus', 'fable') and any
// versioned id containing the tier name ('claude-opus-5', 'claude-fable-5', ...) so a future
// version bump (opus-6, say) is still recognized without an edit here.
function tierOf(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('fable')) return 'fable';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

const GUARDED_TIERS = new Set(['opus', 'fable']);
const DOWNGRADE_TARGET = 'sonnet';

// Pure: month-to-date window for `now` — local calendar month, matching session-cost.js's
// own local-calendar-day convention for --today (new Date(now.toDateString())) rather than a
// UTC month boundary that would silently disagree with what `node tools/session-cost.js`
// reports for "today" at the edges of a day.
export function monthStart(now) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Pure: fold parsed+deduped session-log rows into month-to-date spend + unpriced-model
// presence. Kept separate from the fs read below so it's testable without touching disk —
// mirrors the parseSessionLog/dedupeSessions split session-cost.js already uses.
export function summarizeSpend(rows, now = new Date()) {
  const cutoff = monthStart(now);
  const inMonth = dedupeSessions(rows).filter(r => {
    const d = rowDate(r);
    return !Number.isNaN(d.getTime()) && d >= cutoff;
  });
  const spendUsd = inMonth.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const unpriced = collectUnpriced(inMonth);
  return {
    spendUsd: Math.round(spendUsd * 1e4) / 1e4,
    hasUnpriced: Object.keys(unpriced).length > 0,
    unpriced,
    sessionCount: inMonth.length,
  };
}

// Reads the real session log (tools/session-cost.js's LOG) and returns the same shape as
// summarizeSpend. A missing log is a quiet month, not a failure — same convention
// session-cost.js and its --check use for "no file yet".
export function getMonthToDateSpend(now = new Date()) {
  if (!existsSync(LOG)) {
    return { spendUsd: 0, hasUnpriced: false, unpriced: {}, sessionCount: 0 };
  }
  const { rows } = parseSessionLog(readFileSync(LOG, 'utf8'));
  return summarizeSpend(rows, now);
}

// Pure: the actual decision. Kept independent of disk/env reads so it's fully unit-testable.
//
// Decision rules:
//   - bypass:            allow the requested model as-is. Caller MUST report the bypass —
//                         see printDecision() / the CLI below. A silent bypass defeats the guard.
//   - hasUnpriced:        month-to-date spend includes a model this system can't price (the
//                         #519 failure mode one layer up: an unpriced model must never read as
//                         "$0, so we must be under budget" and silently permit a guarded tier).
//                         Refuse opus/fable outright until the pricing table catches up — the
//                         guard cannot vouch for headroom it cannot compute. Cheap tiers are
//                         unaffected; the uncertainty is specifically about whether it's safe
//                         to green-light MORE expensive spend.
//   - spendUsd >= threshold, guarded tier: downgrade to sonnet.
//   - otherwise:          allow.
export function decideTier({ model, spendUsd, hasUnpriced, threshold = DEFAULT_THRESHOLD_USD, bypass = false }) {
  const tier = tierOf(model);

  if (bypass) {
    return { decision: 'allow', model, tier, reason: 'bypass flag set — guard overridden', bypassed: true };
  }

  if (!GUARDED_TIERS.has(tier)) {
    return { decision: 'allow', model, tier, reason: `${tier} is not a guarded tier`, bypassed: false };
  }

  if (hasUnpriced) {
    return {
      decision: 'refuse',
      model,
      tier,
      reason: 'month-to-date spend includes an unpriced model — cannot verify budget headroom, refusing rather than risk a silent $0 read (see #519)',
      bypassed: false,
    };
  }

  if (spendUsd >= threshold) {
    return {
      decision: 'downgrade',
      model: DOWNGRADE_TARGET,
      tier,
      requestedModel: model,
      reason: `month-to-date spend $${spendUsd.toFixed(2)} >= threshold $${threshold.toFixed(2)} — downgraded ${tier} to ${DOWNGRADE_TARGET}`,
      bypassed: false,
    };
  }

  return {
    decision: 'allow',
    model,
    tier,
    reason: `month-to-date spend $${spendUsd.toFixed(2)} < threshold $${threshold.toFixed(2)}`,
    bypassed: false,
  };
}

// Full evaluation: reads real spend, applies decideTier. Separated from decideTier so tests
// can exercise the decision logic without touching the filesystem.
export function guardModel(model, { threshold = resolveThreshold(), bypass = false, now = new Date() } = {}) {
  const { spendUsd, hasUnpriced } = getMonthToDateSpend(now);
  return decideTier({ model, spendUsd, hasUnpriced, threshold, bypass });
}

// Threshold resolution order: --threshold flag (CLI) > MODEL_TIER_GUARD_THRESHOLD_USD env var
// > DEFAULT_THRESHOLD_USD. Exported so the CLI and tests read the same precedence.
export function resolveThreshold(argv = process.argv.slice(2), env = process.env) {
  const flagArg = argv.find(a => a.startsWith('--threshold='));
  if (flagArg) {
    const v = Number(flagArg.split('=')[1]);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  const envVal = Number(env.MODEL_TIER_GUARD_THRESHOLD_USD);
  if (Number.isFinite(envVal) && envVal >= 0) return envVal;
  return DEFAULT_THRESHOLD_USD;
}

function printDecision(result, threshold) {
  if (result.bypassed) {
    console.log(`BYPASS USED — guard overridden, model unchanged: ${result.model}`);
  }
  console.log(`decision: ${result.decision}`);
  console.log(`model:    ${result.model}`);
  if (result.requestedModel) console.log(`requested: ${result.requestedModel}`);
  console.log(`reason:   ${result.reason}`);
  console.log(`threshold: $${threshold.toFixed(2)}`);
}

function main() {
  const argv = process.argv.slice(2);
  const model = argv.find(a => !a.startsWith('--'));
  const bypass = argv.includes('--bypass');
  const threshold = resolveThreshold(argv);

  if (!model) {
    console.error('Usage: node tools/model-tier-guard.js <model> [--bypass] [--threshold=<usd>]');
    console.error(`  env: MODEL_TIER_GUARD_THRESHOLD_USD (default $${DEFAULT_THRESHOLD_USD})`);
    process.exitCode = 1;
    return;
  }

  const { spendUsd, hasUnpriced } = getMonthToDateSpend();
  const result = decideTier({ model, spendUsd, hasUnpriced, threshold, bypass });
  printDecision(result, threshold);

  if (result.decision === 'refuse') process.exitCode = 2;
}

if (isMainModule(import.meta.url)) main();

// --- Wiring (documentation only — NOT auto-invoked anywhere yet) ------------------------
//
// A caller that dispatches a Claude Code agent with a chosen model (a hook, a CLI wrapper
// around `claude --bg --agent`, or sync-agents.js's own MODELS.claude lookup) would, before
// dispatch:
//
//   import { guardModel } from './tools/model-tier-guard.js';
//   const result = guardModel(requestedModel, { bypass: userPassedBypassFlag });
//   if (result.decision === 'refuse' && !result.bypassed) {
//     // do not dispatch; surface result.reason to the caller/human-needed alert
//   } else {
//     dispatchWith(result.model); // 'allow' -> requested model unchanged, 'downgrade' -> sonnet
//   }
//
// Equivalently from a shell/CI context:
//   node tools/model-tier-guard.js claude-opus-5 --threshold=150
//   echo $?   # 2 on refuse, 0 otherwise — decision text is also on stdout either way
//
// This PR deliberately does NOT wire this into any hook or into sync-agents.js — see the
// issue for the follow-up to do that once the decision policy above has been reviewed.
