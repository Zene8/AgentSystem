#!/usr/bin/env node
// routing-report.js — #124: joins the two halves of routing-log.jsonl (hint records written by
// hooks/memory-router.js and actual-agent records written by hooks/sona-writeback-hook.js) by
// their shared promptHash, and prints per-branch (config/routing.yml `id`) hit rate plus the
// most common misroute patterns. Plain Node, no new deps — reads the log directly.
//
// Usage:
//   node tools/routing-report.js [--log=<path>]
//   node tools/routing-report.js --check          # drift predicate, exit 1 when blind
//   node tools/routing-report.js --diagnose       # read-only shape dump for a zero-join host

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { isMainModule } from './is-main.js';

export const ROUTING_LOG_PATH = join(homedir(), 'agent-memory', 'nexus', 'routing-log.jsonl');

// Pure: parse JSONL text into an array of records, skipping blank/malformed lines.
export function loadRecords(logPath) {
  let raw;
  try {
    raw = readFileSync(logPath || ROUTING_LOG_PATH, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed line.
    }
  }
  return out;
}

// Pure: split records into hint records (have a `hint` field, written by memory-router.js) and
// actual-agent records (have an `agent` field, written by sona-writeback-hook.js), then join by
// promptHash. If multiple records share a promptHash on one side, the last one wins (matches
// append-order semantics — most recent write reflects the final state for that prompt).
export function joinRecords(records) {
  const hints = new Map();
  const actuals = new Map();
  for (const r of records) {
    if (!r || !r.promptHash) continue;
    if (Object.prototype.hasOwnProperty.call(r, 'hint')) {
      hints.set(r.promptHash, r);
    } else if (Object.prototype.hasOwnProperty.call(r, 'agent')) {
      actuals.set(r.promptHash, r);
    }
  }
  const joined = [];
  for (const [hash, hintRec] of hints) {
    const actualRec = actuals.get(hash);
    if (!actualRec) continue;
    joined.push({
      promptHash: hash,
      hint: hintRec.hint,
      agentHint: hintRec.agentHint || null,
      agentActual: actualRec.agent || null,
    });
  }
  return joined;
}

// Pure: compute per-branch hit rate and misroute pattern counts from joined records.
// Records with hint === 'none' (no domain match, e.g. identity queries) are excluded from
// branch scoring — there's no keyword branch to attribute a hit/miss to.
export function computeStats(joined) {
  const branches = new Map(); // id -> { total, hit }
  const misroutes = new Map(); // "hinted -> actual" -> count

  for (const rec of joined) {
    if (!rec.hint || rec.hint === 'none') continue;
    const branch = branches.get(rec.hint) || { total: 0, hit: 0 };
    branch.total += 1;

    const hinted = (rec.agentHint || '').toLowerCase();
    const actual = (rec.agentActual || '').toLowerCase();
    const isHit = Boolean(hinted) && Boolean(actual) && hinted === actual;
    if (isHit) branch.hit += 1;
    branches.set(rec.hint, branch);

    if (!isHit) {
      const key = `${rec.agentHint || rec.hint} -> ${rec.agentActual || 'unknown'}`;
      misroutes.set(key, (misroutes.get(key) || 0) + 1);
    }
  }
  return { branches, misroutes };
}

// Pure: render the report as a plain-text string.
export function formatReport(branches, misroutes) {
  const lines = [];
  lines.push('Routing accuracy report');
  lines.push('========================');

  if (branches.size === 0) {
    lines.push('');
    lines.push('No joined hint/actual records yet — routing-log.jsonl needs both a hint record');
    lines.push('(from memory-router.js) and an actual-agent record (from sona-writeback-hook.js)');
    lines.push('for the same promptHash.');
  } else {
    lines.push('');
    lines.push('Per-branch hit rate:');
    const sorted = [...branches.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [id, s] of sorted) {
      const pct = s.total ? ((s.hit / s.total) * 100).toFixed(1) : '0.0';
      lines.push(`  ${id.padEnd(14)} ${s.hit}/${s.total} (${pct}%)`);
    }
  }

  lines.push('');
  lines.push('Top misroute patterns:');
  if (misroutes.size === 0) {
    lines.push('  none');
  } else {
    const sortedMis = [...misroutes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [pattern, count] of sortedMis) {
      lines.push(`  ${pattern}: ${count}`);
    }
  }

  return lines.join('\n');
}

// #466: below this many parsed records, a zero-join result is inconclusive, not drift — a
// freshly-onboarded or low-traffic host just hasn't accumulated enough pairs yet. Picked at the
// low end of "order of 10-20" from the issue: high enough that a handful of stray hint records
// (the baselyserver shape below) can't look like a healthy sample, low enough to still catch
// drift quickly once a host is actually routing.
const MIN_SAMPLE = 15;

// Pure: #351 --check predicate, revised by #466. A quiet week (no log file) is NOT a failure. A
// log that EXISTS with content but yields zero PARSED records is genuine corruption (unchanged).
// A parsed-but-zero-join result is only reported as drift when BOTH sides of the join are
// populated (at least one hint record AND at least one actual-agent record) and still don't
// overlap — that's the "241/97 unique hashes, only 2 overlap" failure from the #351 audit, where
// hint records and actual records were minted with different promptHashes for the same turn.
//
// A headless CI host (e.g. baselyserver, #466) runs no interactive sessions: memory-router.js
// still logs hints, but sona-writeback-hook.js never fires because no agent ever answers, so
// actuals is permanently empty. That's a structurally different state from #351 — one side never
// existed, there's nothing to fail to join — and reporting it as drift paged every single day
// with no fix available. Same logic applies below MIN_SAMPLE: too few records to tell "empty by
// construction" apart from "minting mismatch" with any confidence, so treat it as inconclusive.
//
// #480: "the actual side is populated" now means populated with actuals whose promptHash came from
// the #473 pointer file (`hashSource: 'pointer'`). Actuals hashed by the pre-#473 transcript-text
// fallback — including every untagged record written before the tag existed — were minted by the
// mechanism #351 already proved unreliable, so they can never be evidence that the join SHOULD be
// working. routing-log.jsonl is append-only real user data and cannot be migrated, so a host whose
// only actuals are legacy ones reported drift forever with no available fix. They still count in
// stats and still join if they happen to match; they just don't arm the drift verdict.
export function checkRoutingLog(logPath) {
  const path = logPath || ROUTING_LOG_PATH;
  if (!existsSync(path)) {
    return { blind: false, reason: null, totalRecords: 0, joinedRecords: 0 };
  }
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { blind: false, reason: null, totalRecords: 0, joinedRecords: 0 };
  }
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    return { blind: false, reason: null, totalRecords: 0, joinedRecords: 0 };
  }
  const records = loadRecords(path);
  if (records.length === 0) {
    return { blind: true, reason: `${lines.length} line(s) present but 0 parsed as valid JSON`, totalRecords: 0, joinedRecords: 0 };
  }
  const joined = joinRecords(records);
  if (joined.length > 0) {
    return { blind: false, reason: null, totalRecords: records.length, joinedRecords: joined.length };
  }
  // Zero join from here down — the ambiguous case. Check the sample floor first: below it, there
  // aren't enough records to distinguish "empty by construction" from "minting mismatch" at all.
  if (records.length < MIN_SAMPLE) {
    return {
      blind: false,
      reason: `only ${records.length} record(s) parsed — below the ${MIN_SAMPLE}-record floor to evaluate join health`,
      totalRecords: records.length,
      joinedRecords: 0,
    };
  }
  // Classify exactly as joinRecords() does -- `hint` wins, `agent` only as an else-if. Counting
  // the two sides with independent hasOwnProperty checks would put a record carrying BOTH fields
  // on both sides, so it would read as "both sides populated" while joinRecords filed it under
  // hints alone and produced no pair: a false `blind: true` on the one shape no operator could
  // act on. The two must agree or this predicate is measuring a different log than the join is.
  let hintCount = 0;
  let actualCount = 0;
  let pointerActualCount = 0;
  for (const r of records) {
    if (!r || !r.promptHash) continue;
    if (Object.prototype.hasOwnProperty.call(r, 'hint')) hintCount += 1;
    else if (Object.prototype.hasOwnProperty.call(r, 'agent')) {
      actualCount += 1;
      if (r.hashSource === 'pointer') pointerActualCount += 1;
    }
  }
  if (hintCount === 0 || actualCount === 0) {
    return {
      blind: false,
      reason: `${records.length} record(s) parsed but only one side of the join is populated (${hintCount} hint, ${actualCount} actual) — headless host, not drift`,
      totalRecords: records.length,
      joinedRecords: 0,
    };
  }
  // #480: actuals exist but none was minted from the #473 pointer — pre-fix data only, expected to
  // self-heal as pointer-tagged actuals accumulate. Not drift, and not silently "OK" either.
  if (pointerActualCount === 0) {
    return {
      blind: false,
      reason: `${records.length} record(s) parsed (${hintCount} hint, ${actualCount} actual) but 0 actual(s) carry hashSource=pointer — pre-#473 legacy actuals only, self-heals as new sessions log, not drift`,
      totalRecords: records.length,
      joinedRecords: 0,
    };
  }
  return {
    blind: true,
    reason: `${records.length} record(s) parsed (${hintCount} hint, ${actualCount} actual, ${pointerActualCount} pointer-tagged) but 0 hint/actual pairs share a promptHash`,
    totalRecords: records.length,
    joinedRecords: 0,
  };
}

// #472: read-only diagnostic for a host whose --check says "N record(s) parsed (H hint, A actual)
// but 0 hint/actual pairs share a promptHash". That verdict names the symptom and nothing else,
// and on the one host where it fires (baselyserver) there is no shell — ssh is refused — so the
// log itself was unreadable and the cause unknowable. This prints the SHAPE of the log: how many
// records of each side, over what time span, and for each actual record the nearest-in-time hint
// record. Two causes look completely different here. A minting mismatch (#351) shows actuals and
// hints interleaved seconds apart and still not matching; a structurally unjoinable log shows the
// two sides separated in time or arriving in disjoint bursts, i.e. different processes entirely.
//
// It prints hashes (truncated), agent/hint names and timestamps only. Prompt TEXT is never in
// routing-log.jsonl to begin with — memory-router.js stores promptHash(prompt), never the prompt —
// so there is nothing here that could leak into a workflow log.
export function diagnoseRoutingLog(records, limit) {
  const cap = limit || 20;
  const hints = [];
  const actuals = [];
  for (const r of records) {
    if (!r || !r.promptHash) continue;
    if (Object.prototype.hasOwnProperty.call(r, 'hint')) hints.push(r);
    else if (Object.prototype.hasOwnProperty.call(r, 'agent')) actuals.push(r);
  }
  const lines = [];
  const uniqHint = new Set(hints.map(r => r.promptHash));
  const uniqActual = new Set(actuals.map(r => r.promptHash));
  let overlap = 0;
  for (const h of uniqActual) if (uniqHint.has(h)) overlap += 1;
  lines.push(`records ${records.length} — hint ${hints.length} (${uniqHint.size} unique), actual ${actuals.length} (${uniqActual.size} unique), overlapping hashes ${overlap}`);
  const span = arr => {
    const ts = arr.map(r => r.ts).filter(Boolean).sort();
    return ts.length ? `${ts[0]} .. ${ts[ts.length - 1]}` : '(no timestamps)';
  };
  lines.push(`hint time span    ${span(hints)}`);
  lines.push(`actual time span  ${span(actuals)}`);
  const ms = r => {
    const t = Date.parse(r.ts || '');
    return Number.isNaN(t) ? null : t;
  };
  lines.push('');
  lines.push(`last ${cap} actual record(s), each with its nearest-in-time hint record:`);
  const tail = actuals.slice(-cap);
  if (tail.length === 0) lines.push('  (none)');
  for (const a of tail) {
    const at = ms(a);
    let best = null;
    let bestGap = null;
    for (const h of hints) {
      const ht = ms(h);
      if (at === null || ht === null) continue;
      const gap = Math.abs(ht - at);
      if (bestGap === null || gap < bestGap) { bestGap = gap; best = h; }
    }
    const ah = String(a.promptHash).slice(0, 10);
    const left = `  actual ${a.ts || '(no ts)'} hash ${ah} agent=${a.agent}`;
    if (!best) { lines.push(`${left}  ->  no comparable hint record`); continue; }
    const bh = String(best.promptHash).slice(0, 10);
    const same = best.promptHash === a.promptHash ? 'SAME HASH' : 'different hash';
    lines.push(`${left}\n      nearest hint ${best.ts} hash ${bh} hint=${best.hint} gap=${Math.round(bestGap / 1000)}s (${same})`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const flags = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] ?? true;
  }
  return flags;
}

function main() {
  const flags = parseArgs(process.argv);

  if (flags.check) {
    const result = checkRoutingLog(flags.log);
    if (result.blind) {
      console.error(`routing-report --check: FAILED — ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    // #466: a non-blind result can now carry a reason (headless host, below the sample floor).
    // Print it — the drift-check job records only this one line, and "OK" with no explanation is
    // how a host that is silently never joining looks identical to a healthy one.
    const why = result.reason ? ` — ${result.reason}` : '';
    console.log(`routing-report --check: OK — ${result.totalRecords} record(s), ${result.joinedRecords} joined${why}`);
    return;
  }

  if (flags.diagnose) {
    const path = flags.log || ROUTING_LOG_PATH;
    if (!existsSync(path)) {
      console.log(`routing-report --diagnose: no log at ${path} — nothing to diagnose`);
      return;
    }
    console.log(`routing-report --diagnose: ${path}`);
    console.log(diagnoseRoutingLog(loadRecords(path), Number(flags.limit) || 20));
    return;
  }

  const records = loadRecords(flags.log);
  const joined = joinRecords(records);
  const { branches, misroutes } = computeStats(joined);
  console.log(formatReport(branches, misroutes));
}

const isMain = isMainModule(import.meta.url);

if (isMain) main();
