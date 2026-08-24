import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { commitLanded, parseArgs, closeNotPlanned } from './issue-close.js';

const SCRIPT = new URL('./issue-close.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('parseArgs: parses issue, commit and optional comment', () => {
  const parsed = parseArgs(['123', '--commit', 'abc1234', '--comment', 'fixed it']);
  assert.deepEqual(parsed, {
    issue: '123',
    commit: 'abc1234',
    extra: 'fixed it',
    notPlanned: null,
  });
});

test('parseArgs: handles missing comment', () => {
  const parsed = parseArgs(['123', '--commit', 'abc1234']);
  assert.deepEqual(parsed, {
    issue: '123',
    commit: 'abc1234',
    extra: '',
    notPlanned: null,
  });
});

test('commitLanded: returns true when git merge-base command succeeds', () => {
  const mockExec = (cmd, args) => {
    if (cmd === 'git' && args[0] === 'merge-base') {
      return Buffer.from(''); // Success
    }
    return Buffer.from('');
  };
  assert.equal(commitLanded('abc1234', { exec: mockExec }), true);
});

test('commitLanded: returns false when git merge-base command fails', () => {
  const mockExec = (cmd, args) => {
    if (cmd === 'git' && args[0] === 'merge-base') {
      throw new Error('Not ancestor');
    }
    return Buffer.from('');
  };
  assert.equal(commitLanded('abc1234', { exec: mockExec }), false);
});

test('parseArgs: parses --not-planned with a reason', () => {
  const parsed = parseArgs(['747', '--not-planned', 'human credential rotation, no fix commit']);
  assert.deepEqual(parsed, {
    issue: '747',
    commit: null,
    extra: '',
    notPlanned: 'human credential rotation, no fix commit',
  });
});

test('parseArgs: --not-planned with no following value yields empty-string reason', () => {
  const parsed = parseArgs(['747', '--not-planned']);
  assert.equal(parsed.notPlanned, '');
});

test('parseArgs: absent --not-planned yields null (distinct from blank reason)', () => {
  const parsed = parseArgs(['123', '--commit', 'abc1234']);
  assert.equal(parsed.notPlanned, null);
});

test('closeNotPlanned: invokes gh issue close with the "not planned" reason and an unmistakable comment', () => {
  let captured = null;
  const mockExec = (cmd, args, opts) => { captured = { cmd, args, opts }; };
  const body = closeNotPlanned('747', 'human credential rotation, no fix commit', { exec: mockExec });

  assert.equal(body, 'Closed as not planned: human credential rotation, no fix commit');
  assert.equal(captured.cmd, 'gh');
  assert.deepEqual(captured.args, [
    'issue', 'close', '747',
    '--reason', 'not planned',
    '--comment', 'Closed as not planned: human credential rotation, no fix commit',
  ]);
});

// --- CLI-level tests below exercise the real entry point. None of these reach a real `gh` call:
// every case here is refused (exit 2) before gh would be invoked, or (the regression case) exits
// 1 on an unreachable commit before gh would be invoked. That keeps them safe to run anywhere,
// with no PATH shimming of `gh` required.

test('CLI: --not-planned with a blank reason refuses with exit 2 and never reaches gh', () => {
  const r = run(['747', '--not-planned', '   ']);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  assert.match(r.stderr, /non-empty reason/);
});

test('CLI: --not-planned with no reason at all refuses with exit 2', () => {
  const r = run(['747', '--not-planned']);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  assert.match(r.stderr, /non-empty reason/);
});

test('CLI: --commit and --not-planned together is a usage error, not silent precedence', () => {
  const r = run(['747', '--commit', 'deadbeef', '--not-planned', 'some reason']);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  assert.match(r.stderr, /mutually exclusive/);
});

// The regression that matters: adding the not-planned path must not weaken the existing
// --commit guard. An unreachable SHA must still be refused before gh is ever called.
test('CLI: --commit with an unreachable SHA still refuses (regression guard unchanged)', () => {
  const r = run(['747', '--commit', '0000000000000000000000000000000000000000']);
  assert.equal(r.status, 1, `expected exit 1 (REFUSED), got ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  assert.match(r.stderr, /REFUSED.*not reachable from origin\/main/);
});
