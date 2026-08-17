import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitLanded, parseArgs } from './issue-close.js';

test('parseArgs: parses issue, commit and optional comment', () => {
  const parsed = parseArgs(['123', '--commit', 'abc1234', '--comment', 'fixed it']);
  assert.deepEqual(parsed, {
    issue: '123',
    commit: 'abc1234',
    extra: 'fixed it',
  });
});

test('parseArgs: handles missing comment', () => {
  const parsed = parseArgs(['123', '--commit', 'abc1234']);
  assert.deepEqual(parsed, {
    issue: '123',
    commit: 'abc1234',
    extra: '',
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
