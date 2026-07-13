'use strict';
// Routine compliance: command extraction from transcript, per-routine violation
// detection, and clean sessions producing empty violation lists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { commandsFromTranscript, evaluateCompliance } = require('./routine-compliance-hook.js');

function writeTranscript(lines) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'routine-tel-')), 't.jsonl');
  fs.writeFileSync(file, lines.map(JSON.stringify).join('\n'));
  return file;
}

const bashTurn = (command) => ({
  message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] },
});

test('commandsFromTranscript: collects Bash and PowerShell commands in order, skips user turns', () => {
  const file = writeTranscript([
    bashTurn('git status'),
    { message: { role: 'user', content: [{ type: 'text', text: 'gh pr create should not count' }] } },
    { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'PowerShell', input: { command: 'Get-Date' } }] } },
    { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x' } }] } },
  ]);
  assert.deepEqual(commandsFromTranscript(file), ['git status', 'Get-Date']);
});

test('fix-pr-until-green: PR created without pr-guard is a violation', () => {
  const rec = evaluateCompliance(['gh pr create --title x'], 's1');
  assert.equal(rec.violations.length, 1);
  assert.equal(rec.violations[0].routineId, 'fix-pr-until-green');
});

test('fix-pr-until-green: later pr-guard run clears it', () => {
  const rec = evaluateCompliance(['gh pr create --title x', 'node tools/pr-guard.js 42'], 's1');
  assert.deepEqual(rec.violations, []);
});

test('post-merge-cleanup: merge without --delete-branch or later delete is a violation', () => {
  const rec = evaluateCompliance(['gh pr merge 42 --squash'], 's1');
  assert.equal(rec.violations[0].routineId, 'post-merge-cleanup');
});

test('post-merge-cleanup: --delete-branch inline or branch delete later clears it', () => {
  assert.deepEqual(evaluateCompliance(['gh pr merge 42 --squash --delete-branch'], 's1').violations, []);
  assert.deepEqual(
    evaluateCompliance(['gh pr merge 42 --squash', 'git push origin --delete feat/x'], 's1').violations, []);
});

test('verify-before-close: direct gh issue close is a violation; issue-close.js is not', () => {
  const rec = evaluateCompliance(['gh issue close 7 --comment done'], 's1');
  assert.equal(rec.violations[0].routineId, 'verify-before-close');
  assert.deepEqual(evaluateCompliance(['node tools/issue-close.js 7 --commit abc'], 's1').violations, []);
});

test('evaluateCompliance: record shape includes checked routine ids and session id', () => {
  const rec = evaluateCompliance(['git status'], 'sess-9', '2026-07-13T00:00:00Z');
  assert.equal(rec.sessionId, 'sess-9');
  assert.equal(rec.ts, '2026-07-13T00:00:00Z');
  assert.ok(rec.checked.includes('fix-pr-until-green'));
  assert.deepEqual(rec.violations, []);
});
