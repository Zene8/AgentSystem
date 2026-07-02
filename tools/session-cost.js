#!/usr/bin/env node
/**
 * session-cost.js — Report Claude session costs from nexus session log
 * Usage:
 *   node tools/session-cost.js          # today's sessions
 *   node tools/session-cost.js --week   # last 7 days
 *   node tools/session-cost.js --all    # all time
 *   node tools/session-cost.js --top    # top 10 most expensive
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const LOG = `${homedir()}/agent-memory/nexus/session-log.jsonl`;
const args = process.argv.slice(2);
const mode = args[0] || '--today';

if (!existsSync(LOG)) {
  console.log('No session log yet. Sessions logged after next Stop hook fires.');
  process.exit(0);
}

const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
const sessions = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const now = new Date();
const cutoff = {
  '--today': new Date(now.toDateString()),
  '--week':  new Date(now - 7 * 86400_000),
  '--all':   new Date(0),
  '--top':   new Date(0),
}[mode] ?? new Date(now.toDateString());

const filtered = sessions.filter(s => new Date(s.ts) >= cutoff);

if (mode === '--top') {
  filtered.sort((a, b) => b.cost_usd - a.cost_usd);
  const top = filtered.slice(0, 10);
  console.log('Top 10 most expensive sessions:');
  top.forEach((s, i) => {
    console.log(`  ${i+1}. $${s.cost_usd.toFixed(4)} | ${s.agent || 'unknown'} | ${s.in_tok}in ${s.out_tok}out | ${s.ts.slice(0, 16)}`);
  });
  process.exit(0);
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
    console.log(`  $${(s.cost_usd||0).toFixed(4)} | ${s.agent||'?'} | ${s.in_tok||0}in ${s.out_tok||0}out | ${s.ts.slice(0,16)}`);
  });
}
