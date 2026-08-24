'use strict';
// #124: routing accuracy telemetry — sona-writeback-hook.js must extract the transcript's
// first user-turn text and append {ts, promptHash, agent} to routing-log.jsonl, using the
// EXACT promptHash algorithm from hooks/memory-router.js (sha1, trimmed, first 16 hex chars).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promptHash, hashPointerPath, writeHashPointer } = require('./memory-router.js');
const {
  extractFirstUserPromptText, extractLastUserPromptText, logRoutingActual, extractEpisodicFacts,
  readHashPointer,
} = require('./sona-writeback-hook.js');

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sona-writeback-test-'));
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return p;
}

test('extractFirstUserPromptText: finds the first user-turn text block', () => {
  const p = writeTranscript([
    { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } },
    { message: { role: 'user', content: [{ type: 'text', text: '  fix the router bug  ' }] } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'DONE: fixed it' }] } },
  ]);
  assert.equal(extractFirstUserPromptText(p), '  fix the router bug  ');
});

test('extractFirstUserPromptText: handles string content (not array)', () => {
  const p = writeTranscript([
    { message: { role: 'user', content: 'plain string prompt' } },
  ]);
  assert.equal(extractFirstUserPromptText(p), 'plain string prompt');
});

test('extractFirstUserPromptText: skips a user turn with only empty/whitespace text', () => {
  const p = writeTranscript([
    { message: { role: 'user', content: [{ type: 'text', text: '   ' }] } },
    { message: { role: 'user', content: [{ type: 'text', text: 'real prompt' }] } },
  ]);
  assert.equal(extractFirstUserPromptText(p), 'real prompt');
});

test('extractFirstUserPromptText: returns null when no user turn exists', () => {
  const p = writeTranscript([{ message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }]);
  assert.equal(extractFirstUserPromptText(p), null);
});

test('extractFirstUserPromptText: returns null on nonexistent file (never throws)', () => {
  assert.equal(extractFirstUserPromptText('/nonexistent/transcript.jsonl'), null);
});

test('extractFirstUserPromptText: tolerates malformed JSON lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sona-writeback-test-'));
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, 'not-json\n' + JSON.stringify({ message: { role: 'user', content: [{ type: 'text', text: 'ok prompt' }] } }) + '\n', 'utf8');
  assert.equal(extractFirstUserPromptText(p), 'ok prompt');
});

// #351: Stop/SubagentStop fire once per completed turn, not once per session — the "actual"
// record must hash the LAST user turn (the one that just finished), not the first, or it can
// never join to memory-router.js's hint record for turns after the first.
test('extractLastUserPromptText: returns the LAST user-turn text, not the first', () => {
  const p = writeTranscript([
    { message: { role: 'user', content: [{ type: 'text', text: 'first turn prompt' }] } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'DONE: did turn 1' }] } },
    { message: { role: 'user', content: [{ type: 'text', text: 'second turn prompt' }] } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'DONE: did turn 2' }] } },
  ]);
  assert.equal(extractLastUserPromptText(p), 'second turn prompt');
});

test('extractLastUserPromptText: handles string content (not array)', () => {
  const p = writeTranscript([
    { message: { role: 'user', content: 'turn one' } },
    { message: { role: 'user', content: 'turn two' } },
  ]);
  assert.equal(extractLastUserPromptText(p), 'turn two');
});

test('extractLastUserPromptText: skips a trailing user turn with only whitespace text', () => {
  const p = writeTranscript([
    { message: { role: 'user', content: [{ type: 'text', text: 'real last prompt' }] } },
    { message: { role: 'user', content: [{ type: 'text', text: '   ' }] } },
  ]);
  assert.equal(extractLastUserPromptText(p), 'real last prompt');
});

test('extractLastUserPromptText: returns null when no user turn exists', () => {
  const p = writeTranscript([{ message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }]);
  assert.equal(extractLastUserPromptText(p), null);
});

test('extractLastUserPromptText: returns null on nonexistent file (never throws)', () => {
  assert.equal(extractLastUserPromptText('/nonexistent/transcript.jsonl'), null);
});

test('logRoutingActual: hashes the LAST user turn so multi-turn sessions join correctly (#351)', () => {
  const lastPrompt = `deploy this last prompt ${Date.now()}-${Math.random()}`;
  const p = writeTranscript([
    { message: { role: 'user', content: [{ type: 'text', text: 'irrelevant first turn' }] } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'DONE: turn 1' }] } },
    { message: { role: 'user', content: [{ type: 'text', text: lastPrompt }] } },
  ]);
  const expectedHash = promptHash(lastPrompt);

  assert.doesNotThrow(() => logRoutingActual({ agent: 'Friday' }, p));

  const realLog = path.join(os.homedir(), 'agent-memory', 'nexus', 'routing-log.jsonl');
  const raw = fs.readFileSync(realLog, 'utf8');
  const lines = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const match = lines.find(l => l.promptHash === expectedHash);
  assert.ok(match, 'expected a routing-log.jsonl record keyed by the LAST turn\'s promptHash');
  assert.equal(match.agent, 'Friday');
});

test('logRoutingActual: writes a record to routing-log.jsonl keyed by the shared promptHash', () => {
  const uniquePrompt = `deploy this to prod ${Date.now()}-${Math.random()}`;
  const p = writeTranscript([
    { message: { role: 'user', content: [{ type: 'text', text: uniquePrompt }] } },
  ]);
  const expectedHash = promptHash(uniquePrompt);
  assert.equal(expectedHash.length, 16);

  assert.doesNotThrow(() => logRoutingActual({ agent: 'Friday' }, p));

  // logRoutingActual delegates to memory-router.js's logRoutingEvent, which writes to the
  // real ~/agent-memory/nexus/routing-log.jsonl (shared, fixed path — see #124 design).
  // Verify the record landed and is joinable by promptHash + carries the actual agent.
  const realLog = path.join(os.homedir(), 'agent-memory', 'nexus', 'routing-log.jsonl');
  const raw = fs.readFileSync(realLog, 'utf8');
  const lines = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const match = lines.find(l => l.promptHash === expectedHash);
  assert.ok(match, 'expected a routing-log.jsonl record with the computed promptHash');
  assert.equal(match.agent, 'Friday');
});

test('logRoutingActual: never throws when transcript has no user turn', () => {
  const p = writeTranscript([{ message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }]);
  assert.doesNotThrow(() => logRoutingActual({ agent: 'Friday' }, p));
});

test('logRoutingActual: never throws on nonexistent transcript path', () => {
  assert.doesNotThrow(() => logRoutingActual({ agent: 'Friday' }, '/nonexistent/path.jsonl'));
});

// #473: memory-router.js writes a pointer file at UserPromptSubmit time carrying the exact
// promptHash it hashed for the hint record. logRoutingActual must use that hash verbatim
// (identical by construction) rather than re-deriving it from transcript text, which injected
// content (system-reminders, headless machine prompts) routinely corrupts.
test('readHashPointer: returns the pointer hash when fresh and well-formed', () => {
  const transcriptPath = '/tmp/fake-session-473-hit.jsonl';
  writeHashPointer({ transcript_path: transcriptPath }, 'deadbeef01234567');
  assert.equal(readHashPointer(transcriptPath), 'deadbeef01234567');
});

test('readHashPointer: returns null (fallback) when no pointer file exists', () => {
  assert.equal(readHashPointer('/tmp/fake-session-473-missing-' + Date.now() + '.jsonl'), null);
});

test('readHashPointer: returns null (fallback) when the pointer is stale', () => {
  const transcriptPath = '/tmp/fake-session-473-stale.jsonl';
  fs.writeFileSync(
    hashPointerPath({ transcript_path: transcriptPath }),
    JSON.stringify({ hash: 'stalehash1234567', ts: Date.now() - 60 * 60 * 1000 }),
  );
  assert.equal(readHashPointer(transcriptPath), null);
});

test('readHashPointer: returns null (fallback) when the pointer file is malformed JSON', () => {
  const transcriptPath = '/tmp/fake-session-473-malformed.jsonl';
  fs.writeFileSync(hashPointerPath({ transcript_path: transcriptPath }), 'not json{{{');
  assert.equal(readHashPointer(transcriptPath), null);
});

test('logRoutingActual: uses the pointer hash verbatim when present, ignoring transcript text', () => {
  const transcriptPath = writeTranscript([
    // Last user text block is injected boilerplate, NOT what memory-router.js hashed —
    // exactly the #473 failure mode. The pointer must win over re-extracting this text.
    { message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>irrelevant injected block</system-reminder>' }] } },
  ]);
  writeHashPointer({ transcript_path: transcriptPath }, 'pointerhash012345');

  assert.doesNotThrow(() => logRoutingActual({ agent: 'Friday' }, transcriptPath));

  const realLog = path.join(os.homedir(), 'agent-memory', 'nexus', 'routing-log.jsonl');
  const raw = fs.readFileSync(realLog, 'utf8');
  const lines = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const match = lines.find(l => l.promptHash === 'pointerhash012345');
  assert.ok(match, 'expected logRoutingActual to log the pointer hash verbatim');
  assert.equal(match.agent, 'Friday');
});

test('logRoutingActual: falls back to transcript extraction when no pointer exists (never worse than today)', () => {
  const uniquePrompt = `no pointer for this turn ${Date.now()}-${Math.random()}`;
  const transcriptPath = writeTranscript([
    { message: { role: 'user', content: [{ type: 'text', text: uniquePrompt }] } },
  ]);
  const expectedHash = promptHash(uniquePrompt);

  assert.doesNotThrow(() => logRoutingActual({ agent: 'Friday' }, transcriptPath));

  const realLog = path.join(os.homedir(), 'agent-memory', 'nexus', 'routing-log.jsonl');
  const raw = fs.readFileSync(realLog, 'utf8');
  const lines = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const match = lines.find(l => l.promptHash === expectedHash);
  assert.ok(match, 'expected logRoutingActual to fall back to extractLastUserPromptText hash');
  assert.equal(match.agent, 'Friday');
});

// #155: no-signal transcripts must not produce a degenerate all-"unknown" episodic entry.
test('extractEpisodicFacts: returns null when there is no DONE/BLOCKED, no files, no agent', () => {
  const p = writeTranscript([
    { message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'thinking about it...' }] } },
  ]);
  assert.equal(extractEpisodicFacts(p), null);
});

test('extractEpisodicFacts: returns facts when a DONE status line is present', () => {
  const p = writeTranscript([
    { message: { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'DONE: fixed the bug' }] } },
  ]);
  const facts = extractEpisodicFacts(p);
  assert.ok(facts);
  assert.equal(facts.outcome, 'done');
  assert.equal(facts.task, 'fixed the bug');
});

// 2026-07-12 audit: outcome=unknown entries are junk on retrieval — the old OR-guard let
// file-touch-only turns produce ~400 noise entries in sona-patterns.md. No DONE:/BLOCKED:
// status line now means no episodic write, even when files were touched.
test('extractEpisodicFacts: returns null when files were touched but no status line found', () => {
  const p = writeTranscript([
    { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/foo.js' } }] } },
  ]);
  assert.equal(extractEpisodicFacts(p), null);
});
