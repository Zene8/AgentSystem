#!/usr/bin/env node
/**
 * session-cost.js — Report Claude session costs from nexus session log
 * Usage:
 *   node tools/session-cost.js          # today's sessions
 *   node tools/session-cost.js --week   # last 7 days
 *   node tools/session-cost.js --all    # all time
 *   node tools/session-cost.js --top    # top 10 most expensive
 *   node tools/session-cost.js --check  # exit 1 if the log exists but is blind (#351)
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { isMainModule } from './is-main.js';

export const LOG = join(homedir(), 'agent-memory', 'nexus', 'session-log.jsonl');

// Pure: parse JSONL text into an array of successfully-parsed row objects, skipping
// blank/malformed lines. Returns { rows, totalLines } so callers can tell "0 rows because
// the file is empty" apart from "0 rows because every line failed to parse".
export function parseSessionLog(text) {
  const lines = (text || '').trim().split('\n').filter(Boolean);
  const rows = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { rows, totalLines: lines.length };
}

// Pure: resolve a row's timestamp under either key. #351: session-end.sh writes `ts`, but a
// competing writer (tools/pm-hygiene.js, before its own #351 fix) produced rows carrying only
// `timestamp` — the reader filtered on `s.ts` exclusively, so `new Date(undefined) >= cutoff`
// was always false and those rows were silently invisible to every date-scoped report. Accept
// both so the historical `timestamp`-only rows aren't orphaned.
export function rowDate(row) {
  return new Date(row.ts || row.timestamp);
}

// Pure: #519 — fold each row's `unpriced` array (model ids session-cost-compute.js could not
// price, carried through session-end.sh) into one { model -> total_out_tok } map across all
// rows in scope. Silence here is the original defect: an unpriced model contributed real
// output tokens that never appeared in any total, so this must be additive across rows, not
// last-write-wins, or a second session on the same unpriced model would hide the first.
export function collectUnpriced(rows) {
  const out = {};
  for (const r of rows) {
    for (const u of (r.unpriced || [])) {
      if (!u || !u.model) continue;
      out[u.model] = (out[u.model] || 0) + (u.out_tok || 0);
    }
  }
  return out;
}

// #155: defense against double-logged rows. Root cause investigated: sona-writeback-hook.js
// is intentionally registered on BOTH the Stop and SubagentStop events (see HOOK_REGISTRY in tools/deploy-hooks.js),
// which is by design (main-session AND subagent episodic capture) — but session-end.sh (the writer
// of THIS log) is registered once, on Stop only. If a future hook wiring regression ever fires the
// same Stop event twice for one turn (e.g. duplicate registration, or a retried hook after timeout),
// the appended row would be byte-identical (same session, same transcript-derived cost/tokens, same
// second-resolution timestamp). Collapse exact duplicates here as a cheap, safe aggregation-time
// backstop — two genuinely distinct turns essentially never share session+ts+cost+in_tok+out_tok.
export function dedupeSessions(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.session}|${r.ts || r.timestamp}|${r.cost_usd}|${r.in_tok}|${r.out_tok}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// Pure: #351 --check predicate. A quiet week (no file, or a file with no lines) is NOT a
// failure — it's indistinguishable from "nothing happened yet". A file that EXISTS and has
// content but yields nothing usable is the blind-telemetry failure this exists to catch:
//   - every line fails to parse as JSON, or
//   - every parsed row's date is unresolvable (neither `ts` nor `timestamp` parses).
// Returns { blind: boolean, reason: string|null, totalLines, parsedRows, datedRows }.
export function checkSessionLog(text) {
  const { rows, totalLines } = parseSessionLog(text);
  if (totalLines === 0) {
    return { blind: false, reason: null, totalLines: 0, parsedRows: 0, datedRows: 0 };
  }
  if (rows.length === 0) {
    return { blind: true, reason: `${totalLines} line(s) present but 0 parsed as valid JSON`, totalLines, parsedRows: 0, datedRows: 0 };
  }
  const datedRows = rows.filter(r => !Number.isNaN(rowDate(r).getTime())).length;
  if (datedRows === 0) {
    return { blind: true, reason: `${rows.length} row(s) parsed but none carry a resolvable 'ts' or 'timestamp'`, totalLines, parsedRows: rows.length, datedRows: 0 };
  }
  return { blind: false, reason: null, totalLines, parsedRows: rows.length, datedRows };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--today';

  // #122: startup overhead line — sums fixed per-session context injection (CLAUDE.md files,
  // routines.generated.md, memory-context SessionStart output). Delegates to startup-overhead.js
  // (single source of truth for the measurement) rather than re-summing here.
  if (mode === '--startup') {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    await import(pathToFileURL(join(__dirname, 'startup-overhead.js')).href);
    return;
  }

  if (mode === '--check') {
    if (!existsSync(LOG)) {
      console.log('session-cost --check: no log yet (quiet — not a failure)');
      return;
    }
    const text = readFileSync(LOG, 'utf8');
    const result = checkSessionLog(text);
    if (result.blind) {
      console.error(`session-cost --check: FAILED — ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`session-cost --check: OK — ${result.parsedRows} row(s) parsed, ${result.datedRows} with a resolvable date`);
    return;
  }

  if (!existsSync(LOG)) {
    console.log('No session log yet. Sessions logged after next Stop hook fires.');
    return;
  }

  const { rows: rawSessions } = parseSessionLog(readFileSync(LOG, 'utf8'));

  const sessions = dedupeSessions(rawSessions);
  if (sessions.length !== rawSessions.length && mode !== '--top') {
    console.log(`(deduped ${rawSessions.length - sessions.length} duplicate log row(s))`);
  }

  const now = new Date();
  const cutoff = {
    '--today': new Date(now.toDateString()),
    '--week':  new Date(now - 7 * 86400_000),
    '--all':   new Date(0),
    '--top':   new Date(0),
  }[mode] ?? new Date(now.toDateString());

  const filtered = sessions.filter(s => rowDate(s) >= cutoff);

  if (mode === '--top') {
    filtered.sort((a, b) => b.cost_usd - a.cost_usd);
    const top = filtered.slice(0, 10);
    console.log('Top 10 most expensive sessions:');
    top.forEach((s, i) => {
      console.log(`  ${i+1}. $${(s.cost_usd||0).toFixed(4)} | ${s.agent || 'unknown'} | ${s.in_tok||0}in ${s.out_tok||0}out | ${(s.ts || s.timestamp || '').slice(0, 16)}`);
    });
    return;
  }

  const total_cost = filtered.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const total_in   = filtered.reduce((s, r) => s + (r.in_tok || 0), 0);
  const total_out  = filtered.reduce((s, r) => s + (r.out_tok || 0), 0);

  const label = { '--today': 'Today', '--week': 'Last 7 days', '--all': 'All time' }[mode] || 'Today';
  console.log(`\n${label} — ${filtered.length} session(s)`);
  console.log(`  Cost:        $${total_cost.toFixed(4)}`);
  console.log(`  Input tok:   ${total_in.toLocaleString()}`);
  console.log(`  Output tok:  ${total_out.toLocaleString()}`);

  if (filtered.length > 0) {
    console.log('\nRecent sessions:');
    filtered.slice(-5).reverse().forEach(s => {
      console.log(`  $${(s.cost_usd||0).toFixed(4)} | ${s.agent||'?'} | ${s.in_tok||0}in ${s.out_tok||0}out | ${(s.ts || s.timestamp || '').slice(0,16)}`);
    });
  }

  // #519: an unpriced model must never be a silent $0 in the total above. Print it loud rather
  // than failing the process (exit 0 by design) -- session-cost.js is a routine reporting
  // command run interactively and from other scripts that only expect a summary, and a nonzero
  // exit here would break those callers on every run touching a model this table hasn't caught
  // up to yet. The visible cost of that choice is that nothing here enforces a fix -- callers
  // that need enforcement (e.g. tools/model-tier-guard.js, #519 follow-up) must check this
  // themselves rather than relying on this process's exit code.
  const unpriced = collectUnpriced(filtered);
  const unpricedModels = Object.keys(unpriced);
  if (unpricedModels.length > 0) {
    console.log('');
    for (const model of unpricedModels) {
      console.log(`  UNPRICED: ${model} (${unpriced[model].toLocaleString()} output tokens)`);
    }
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
