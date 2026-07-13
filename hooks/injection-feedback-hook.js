'use strict';
// Stop hook — memory feedback loop scorer. Joins this session's injection-log.jsonl records
// (written by hooks/memory-router.js at UserPromptSubmit) against the finished transcript and
// scores each injected node: "used" = its id appears anywhere in assistant text or tool inputs
// after injection (mentioned, queried via graph-query, cited in a summary). Used nodes are
// reinforced by appending to that brain's visits.log — the SAME append-only channel
// graph-query.js --record-access writes, folded into edge weights by memory-reconsolidate.js —
// so useful memories rise and never-used injections decay naturally. All outcomes (used or not)
// are appended to injection-feedback.jsonl for offline analysis (tools/memory-eval.js --report).
//
// Never throws, never blocks Stop: every step degrades to a no-op on failure.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sessionKey, INJECTION_LOG_PATH } = require('./memory-router.js');

const FEEDBACK_LOG_PATH = path.join(os.homedir(), 'agent-memory', 'nexus', 'injection-feedback.jsonl');

// All injection records for one session, deduped to the latest brain info per node id.
function injectionsForSession(key, logPath) {
  const byId = new Map();
  try {
    const raw = fs.readFileSync(logPath || INJECTION_LOG_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec.sessionKey !== key || !Array.isArray(rec.nodes)) continue;
      for (const n of rec.nodes) {
        if (n && n.id) byId.set(n.id, n);
      }
    }
  } catch { /* no log yet — nothing injected */ }
  return [...byId.values()];
}

// Build a lowercase haystack of everything the ASSISTANT did after injection: text blocks and
// tool_use inputs. User turns are excluded — the router's own injected hint echoing node ids
// back through the prompt stream must not count as "used".
function transcriptHaystack(transcriptPath) {
  let out = '';
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const msg = entry && entry.message;
      if (!msg || msg.role !== 'assistant') continue;
      const content = msg.content;
      if (typeof content === 'string') { out += content + '\n'; continue; }
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block) continue;
        if (block.type === 'text' && typeof block.text === 'string') out += block.text + '\n';
        if (block.type === 'tool_use' && block.input) {
          try { out += JSON.stringify(block.input) + '\n'; } catch { /* skip */ }
        }
      }
    }
  } catch { /* missing transcript — score nothing as used */ }
  return out.toLowerCase();
}

function scoreInjections(injected, haystack) {
  return injected.map(n => ({ ...n, used: !!n.id && haystack.includes(String(n.id).toLowerCase()) }));
}

function appendFeedback(scored, key, feedbackPath) {
  const p = feedbackPath || FEEDBACK_LOG_PATH;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const ts = new Date().toISOString();
    const lines = scored.map(s =>
      JSON.stringify({ ts, sessionKey: key, nodeId: s.id, brain: s.brain || null, used: s.used })).join('\n');
    if (lines) fs.appendFileSync(p, lines + '\n');
  } catch { /* non-fatal */ }
}

// Reinforce used nodes: one visits.log line per brain dir, identical shape to the one
// graph-query.js --record-access appends ({ts, nodes:[...]}) so memory-reconsolidate.js
// folds it in with zero changes.
function reinforceUsed(scored) {
  const byDir = new Map();
  for (const s of scored) {
    if (!s.used || !s.brainDir) continue;
    if (!byDir.has(s.brainDir)) byDir.set(s.brainDir, []);
    byDir.get(s.brainDir).push(s.id);
  }
  let reinforced = 0;
  for (const [dir, nodes] of byDir) {
    try {
      if (!fs.existsSync(path.join(dir, 'graph.json'))) continue;
      fs.appendFileSync(path.join(dir, 'visits.log'),
        JSON.stringify({ ts: new Date().toISOString(), nodes }) + '\n');
      reinforced += nodes.length;
    } catch { /* non-fatal */ }
  }
  return reinforced;
}

function run(payload, opts) {
  const o = opts || {};
  const key = sessionKey(payload);
  const injected = injectionsForSession(key, o.injectionLogPath);
  if (injected.length === 0) return { injected: 0, used: 0, reinforced: 0 };
  const haystack = transcriptHaystack(payload && payload.transcript_path);
  const scored = scoreInjections(injected, haystack);
  appendFeedback(scored, key, o.feedbackLogPath);
  const reinforced = o.skipReinforce ? 0 : reinforceUsed(scored);
  return { injected: scored.length, used: scored.filter(s => s.used).length, reinforced };
}

module.exports = {
  injectionsForSession, transcriptHaystack, scoreInjections, appendFeedback, reinforceUsed, run,
  FEEDBACK_LOG_PATH,
};

if (require.main === module) {
  let input = '';
  process.stdin.on('data', d => (input += d));
  process.stdin.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(input || '{}'); } catch { /* ignore */ }
    let summary = { injected: 0, used: 0, reinforced: 0 };
    try { summary = run(payload); } catch { /* never block Stop */ }
    if (summary.injected > 0) {
      process.stdout.write(`injection-feedback: ${summary.used}/${summary.injected} injected nodes used, ${summary.reinforced} reinforced`);
    }
    process.exit(0);
  });
}
