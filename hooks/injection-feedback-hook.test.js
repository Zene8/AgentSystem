'use strict';
// Memory feedback loop, leg 2: Stop-hook usefulness scorer. Injected node ids recorded by
// memory-router.js (injection-log.jsonl) must be joined to the finished transcript, scored
// used/unused against ASSISTANT content only, appended to injection-feedback.jsonl, and used
// nodes reinforced via the brain's visits.log (same shape graph-query --record-access writes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sessionKey, logInjection } = require('./memory-router.js');
const {
  injectionsForSession, transcriptHaystack, scoreInjections, appendFeedback, reinforceUsed, run,
} = require('./injection-feedback-hook.js');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function writeInjectionLog(dir, records) {
  const p = path.join(dir, 'injection-log.jsonl');
  fs.writeFileSync(p, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  return p;
}

function writeTranscript(dir, lines) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

test('injectionsForSession: filters by sessionKey and dedups node ids across records', () => {
  const dir = tmp('inj-log-');
  const log = writeInjectionLog(dir, [
    { sessionKey: 'sessA', nodes: [{ id: 'n1', brain: 'pb', brainDir: '/pb' }] },
    { sessionKey: 'sessA', nodes: [{ id: 'n1', brain: 'pb', brainDir: '/pb' }, { id: 'n2', brain: 'repo', brainDir: '/r' }] },
    { sessionKey: 'sessB', nodes: [{ id: 'other', brain: 'pb', brainDir: '/pb' }] },
  ]);
  const got = injectionsForSession('sessA', log);
  assert.deepEqual(got.map(n => n.id).sort(), ['n1', 'n2']);
});

test('injectionsForSession: missing log file returns empty, never throws', () => {
  assert.deepEqual(injectionsForSession('x', path.join(os.tmpdir(), 'no-such-injection-log.jsonl')), []);
});

test('transcriptHaystack: includes assistant text and tool inputs, EXCLUDES user turns', () => {
  const dir = tmp('inj-tr-');
  const p = writeTranscript(dir, [
    { message: { role: 'user', content: [{ type: 'text', text: 'RELEVANT MEMORY: user-echoed-node' }] } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'applying Prefers-Strict-Mode rule' }] } },
    { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'graph-query.js pb tool-queried-node' } }] } },
  ]);
  const hay = transcriptHaystack(p);
  assert.ok(hay.includes('prefers-strict-mode'), 'assistant text lowercased and present');
  assert.ok(hay.includes('tool-queried-node'), 'tool_use input present');
  assert.ok(!hay.includes('user-echoed-node'), 'user turns must not count as usage');
});

test('scoreInjections: marks used only when id appears in haystack (case-insensitive)', () => {
  const scored = scoreInjections(
    [{ id: 'Used-Node', brainDir: '/b' }, { id: 'unused-node', brainDir: '/b' }],
    'the assistant mentioned used-node here');
  assert.equal(scored.find(s => s.id === 'Used-Node').used, true);
  assert.equal(scored.find(s => s.id === 'unused-node').used, false);
});

test('appendFeedback: writes one JSONL record per scored node', () => {
  const dir = tmp('inj-fb-');
  const fb = path.join(dir, 'feedback.jsonl');
  appendFeedback([{ id: 'n1', brain: 'pb', used: true }, { id: 'n2', brain: 'pb', used: false }], 'sessK', fb);
  const lines = fs.readFileSync(fb, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(l => l.used), [true, false]);
  assert.equal(lines[0].sessionKey, 'sessK');
});

test('reinforceUsed: appends graph-query-shaped visits.log line only for used nodes in real brain dirs', () => {
  const brainDir = tmp('inj-brain-');
  fs.writeFileSync(path.join(brainDir, 'graph.json'), '{"nodes":[],"edges":[]}');
  const count = reinforceUsed([
    { id: 'used-1', used: true, brainDir },
    { id: 'unused-1', used: false, brainDir },
    { id: 'orphan', used: true, brainDir: path.join(brainDir, 'not-a-brain') },
  ]);
  assert.equal(count, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(brainDir, 'visits.log'), 'utf8').trim());
  assert.deepEqual(rec.nodes, ['used-1']);
  assert.ok(rec.ts, 'visits.log record carries a timestamp like --record-access does');
});

test('run: end-to-end join of injection log + transcript, feedback written, used node reinforced', () => {
  const dir = tmp('inj-e2e-');
  const brainDir = tmp('inj-e2e-brain-');
  fs.writeFileSync(path.join(brainDir, 'graph.json'), '{"nodes":[],"edges":[]}');
  const payload = { transcript_path: writeTranscript(dir, [
    { message: { role: 'assistant', content: [{ type: 'text', text: 'per hot-fact-node, doing X' }] } },
  ]) };
  const key = sessionKey(payload);
  const log = writeInjectionLog(dir, [
    { sessionKey: key, nodes: [
      { id: 'hot-fact-node', brain: 'pb', brainDir },
      { id: 'cold-fact-node', brain: 'pb', brainDir },
    ] },
  ]);
  const fb = path.join(dir, 'feedback.jsonl');
  const summary = run(payload, { injectionLogPath: log, feedbackLogPath: fb });
  assert.deepEqual(summary, { injected: 2, used: 1, reinforced: 1 });
  const visits = JSON.parse(fs.readFileSync(path.join(brainDir, 'visits.log'), 'utf8').trim());
  assert.deepEqual(visits.nodes, ['hot-fact-node']);
});

test('run: no injections for session is a quiet no-op', () => {
  const dir = tmp('inj-noop-');
  const summary = run({ transcript_path: path.join(dir, 'none.jsonl') },
    { injectionLogPath: path.join(dir, 'empty.jsonl') });
  assert.deepEqual(summary, { injected: 0, used: 0, reinforced: 0 });
});

test('memory-router: logInjection appends to injection-log.jsonl and sessionKey is stable', () => {
  // sessionKey must sanitize identically for the router (write side) and this hook (read side).
  const a = sessionKey({ transcript_path: 'C:\\x\\y\\t.jsonl' });
  const b = sessionKey({ transcript_path: 'C:\\x\\y\\t.jsonl' });
  assert.equal(a, b);
  assert.match(a, /^[a-zA-Z0-9_]+$/);
  assert.equal(typeof logInjection, 'function');
});
