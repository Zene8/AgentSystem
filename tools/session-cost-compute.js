#!/usr/bin/env node
// session-cost-compute.js — compute real USD cost for a Claude Code session transcript.
//
// WHY THIS EXISTS: the Stop hook's stdin JSON does NOT contain cost_usd or usage fields
// (verified against the Claude Code hooks reference 2026-07-02) — only session_id,
// transcript_path, cwd, permission_mode, turn_number, stop_reason, and optionally
// agent_type/agent_id. Real per-turn token usage + model name live inside the
// transcript JSONL itself, on each `type: "assistant"` line's `message.usage` /
// `message.model`. This script reads that file and computes real cost from it —
// session-end.sh no longer guesses from fields that were never sent.
//
// Usage: node tools/session-cost-compute.js <transcript-path>
// Output (stdout): {"cost_usd": N, "in_tok": N, "out_tok": N, "models": {...}, "unknown_models": [...]}

import { existsSync, readFileSync } from 'node:fs';
import { isMainModule } from './is-main.js';

// USD per 1M tokens. Cache write/read prices follow Anthropic's standard multipliers
// of the base input price (5m write = 1.25x, 1h write = 2x, read = 0.1x) — confirmed
// convention, applied here explicitly per model since Claude Sonnet 5 has a
// time-limited introductory rate that the multiplier alone doesn't capture.
// Sonnet 5 intro pricing ($2/$10) runs through 2026-08-31; after that it reverts to
// $3/$15 — update SONNET_5_INTRO_ENDS or the standard-rate block if this drifts.
const SONNET_5_INTRO_ENDS = new Date('2026-08-31T23:59:59Z');

function sonnet5Pricing(now) {
  if (now <= SONNET_5_INTRO_ENDS) {
    return { input: 2.00, output: 10.00, cacheWrite5m: 2.50, cacheWrite1h: 4.00, cacheRead: 0.20 };
  }
  return { input: 3.00, output: 15.00, cacheWrite5m: 3.75, cacheWrite1h: 6.00, cacheRead: 0.30 };
}

// Concrete tier prices, defined once so bare aliases (#519 — 'opus'/'sonnet'/'haiku' show up in
// transcripts too, not just the versioned ids) resolve to the SAME numbers as their versioned
// counterparts instead of a second, driftable copy. 'sonnet' resolves through the date-dependent
// sonnet5Pricing(now) path rather than a frozen snapshot, so the 2026-08-31 intro-rate rollover
// applies to the alias too.
const OPUS_5_PRICE  = { input: 5.00,  output: 25.00, cacheWrite5m: 6.25,  cacheWrite1h: 10.00, cacheRead: 0.50 };
const FABLE_PRICE   = { input: 10.00, output: 50.00, cacheWrite5m: 12.50, cacheWrite1h: 20.00, cacheRead: 1.00 };
const HAIKU_PRICE   = { input: 1.00,  output: 5.00,  cacheWrite5m: 1.25,  cacheWrite1h: 2.00,  cacheRead: 0.10 };

export function buildPricingTable(now = new Date()) {
  const sonnetPrice = sonnet5Pricing(now);
  return {
    // claude-opus-4-8 kept for historical transcripts already on disk; claude-opus-5 (#519) is
    // the id sync-agents.js actually dispatches ($5/$25, identical tier — see MODELS.claude).
    'claude-opus-4-8':           OPUS_5_PRICE,
    'claude-opus-5':             OPUS_5_PRICE,
    'claude-fable-5':            FABLE_PRICE,
    'fable':                     FABLE_PRICE,
    'claude-sonnet-5':           sonnetPrice,
    'claude-haiku-4-5-20251001': HAIKU_PRICE,
    'claude-haiku-4-5':          HAIKU_PRICE,
    // Bare aliases (#519): seen ~10x/10x/2x in transcripts since 2026-08-20 alongside the
    // versioned ids. Resolve to the current concrete tier rather than reporting unpriced.
    'opus':                      OPUS_5_PRICE,
    'sonnet':                    sonnetPrice,
    'haiku':                     HAIKU_PRICE,
  };
}

// Pure: parse transcript JSONL text into per-model usage totals.
// Includes sidechain turns (isSidechain: true) deliberately — those are in-session
// Agent-tool subagent dispatches (Ultron, Jarvis, etc.), and their spend is real spend
// against this session, not a separate one.
export function aggregateUsage(transcriptText) {
  const byModel = {};
  for (const line of transcriptText.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant') continue;
    const model = obj.message?.model;
    const usage = obj.message?.usage;
    if (!model || !usage) continue;

    if (!byModel[model]) {
      byModel[model] = { input_tokens: 0, output_tokens: 0, cache_5m: 0, cache_1h: 0, cache_read: 0 };
    }
    const m = byModel[model];
    m.input_tokens += usage.input_tokens || 0;
    m.output_tokens += usage.output_tokens || 0;
    m.cache_read += usage.cache_read_input_tokens || 0;
    // cache_creation breaks 5m/1h out explicitly; fall back to lumping the (rare,
    // legacy-shape) flat cache_creation_input_tokens into the 5m bucket if the
    // breakdown object is absent, so no tokens are silently dropped from cost.
    if (usage.cache_creation) {
      m.cache_5m += usage.cache_creation.ephemeral_5m_input_tokens || 0;
      m.cache_1h += usage.cache_creation.ephemeral_1h_input_tokens || 0;
    } else if (usage.cache_creation_input_tokens) {
      m.cache_5m += usage.cache_creation_input_tokens;
    }
  }
  return byModel;
}

// Claude Code's own placeholder for a turn with no real model call (a suppressed response, a
// server error before inference) -- always 0 tokens (confirmed against live transcripts, #519).
// It is EXPECTED to be free, not a pricing gap, so it must never land in unknown_models next to
// an actually-unpriced model id -- that would bury the real gap in noise on every run.
const SYNTHETIC_MODEL = '<synthetic>';

// Pure: price aggregated per-model usage. Unknown models are reported separately
// (not silently priced at $0 and not silently dropped) so a new/renamed model shows
// up as a visible gap instead of a quietly wrong total.
export function priceUsage(byModel, pricing) {
  let totalCost = 0, totalIn = 0, totalOut = 0;
  const unknownModels = [];
  const models = {};

  for (const [model, u] of Object.entries(byModel)) {
    totalIn += u.input_tokens;
    totalOut += u.output_tokens;

    if (model === SYNTHETIC_MODEL) {
      models[model] = { ...u, cost_usd: 0 };
      continue;
    }

    const price = pricing[model];
    if (!price) {
      unknownModels.push(model);
      models[model] = { ...u, cost_usd: null };
      continue;
    }
    const cost =
      (u.input_tokens / 1_000_000) * price.input +
      (u.output_tokens / 1_000_000) * price.output +
      (u.cache_5m / 1_000_000) * price.cacheWrite5m +
      (u.cache_1h / 1_000_000) * price.cacheWrite1h +
      (u.cache_read / 1_000_000) * price.cacheRead;
    totalCost += cost;
    models[model] = { ...u, cost_usd: Math.round(cost * 1e6) / 1e6 };
  }

  return {
    cost_usd: Math.round(totalCost * 1e6) / 1e6,
    in_tok: totalIn,
    out_tok: totalOut,
    models,
    unknown_models: unknownModels,
  };
}

export function computeSessionCost(transcriptPath, { now = new Date() } = {}) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { ok: false, message: `transcript not found: ${transcriptPath}` };
  }
  const text = readFileSync(transcriptPath, 'utf8');
  const byModel = aggregateUsage(text);
  const priced = priceUsage(byModel, buildPricingTable(now));
  return { ok: true, ...priced };
}

function main() {
  const transcriptPath = process.argv[2];
  const result = computeSessionCost(transcriptPath);
  if (!result.ok) {
    console.error(`session-cost-compute: ${result.message}`);
    // Emit a zeroed record rather than nothing — session-end.sh always gets valid
    // JSON to log, even when the transcript can't be read.
    console.log(JSON.stringify({ cost_usd: 0, in_tok: 0, out_tok: 0, models: {}, unknown_models: [] }));
    process.exit(0);
  }
  console.log(JSON.stringify(result));
}

if (isMainModule(import.meta.url)) main();
