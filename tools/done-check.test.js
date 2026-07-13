// done-check: extraction of verifiable claims from DONE text, verdict logic
// (contradicted > verified > unverified), n/a for non-DONE, file annotation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractClaims, verifyRun, annotateFile } from './done-check.js';

test('extractClaims: PR merge, commit, and file-creation claims, deduped', () => {
  const text = 'DONE: merged PR #42 as commit abc1234def. Created tools/new-thing.js. PR #42 merged clean.';
  const claims = extractClaims(text);
  assert.deepEqual(claims, [
    { kind: 'pr-merged', value: '42' },
    { kind: 'commit-landed', value: 'abc1234def' },
    { kind: 'file-exists', value: 'tools/new-thing.js' },
  ]);
});

test('extractClaims: no claims in plain prose', () => {
  assert.deepEqual(extractClaims('DONE: reviewed the design doc and left comments.'), []);
});

test('verifyRun: non-DONE result is n/a', () => {
  const v = verifyRun({ result: 'BLOCKED: waiting on credentials' });
  assert.equal(v.verdict, 'n/a');
});

test('verifyRun: DONE with all claims true is verified', () => {
  const v = verifyRun(
    { result: 'DONE: merged PR #7, commit deadbee landed.' },
    { 'pr-merged': () => true, 'commit-landed': () => true });
  assert.equal(v.verdict, 'verified');
  assert.deepEqual(v.claims.map(c => c.ok), [true, true]);
});

test('verifyRun: any false claim makes the DONE contradicted', () => {
  const v = verifyRun(
    { result: 'DONE: merged PR #7, commit deadbee landed.' },
    { 'pr-merged': () => false, 'commit-landed': () => true });
  assert.equal(v.verdict, 'contradicted');
});

test('verifyRun: DONE with no checkable claims is unverified', () => {
  const v = verifyRun({ result: 'DONE: analysis complete, see comment above.' }, {});
  assert.equal(v.verdict, 'unverified');
});

test('verifyRun: checker exception does not count as contradiction', () => {
  const v = verifyRun(
    { result: 'DONE: merged PR #7.' },
    { 'pr-merged': () => { throw new Error('gh offline'); } });
  assert.equal(v.verdict, 'unverified');
  assert.equal(v.claims[0].ok, null);
});

test('annotateFile: writes verification back into the run-log JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'done-check-'));
  const file = path.join(dir, 'run.json');
  fs.writeFileSync(file, JSON.stringify({ agent: 'friday', result: 'DONE: merged PR #9.' }));
  const verdict = annotateFile(file, { 'pr-merged': () => true });
  assert.equal(verdict, 'verified');
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(entry.verification.verdict, 'verified');
  assert.equal(entry.verification.claims[0].value, '9');
});

test('annotateFile: malformed JSON returns null, file untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'done-check-'));
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, '{nope');
  assert.equal(annotateFile(file), null);
  assert.equal(fs.readFileSync(file, 'utf8'), '{nope');
});
