import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT_PATH = join(process.cwd(), 'tools', 'email-alert-watcher.js');

test('email-alert-watcher dry-run executes cleanly', () => {
  try {
    const out = execFileSync('node', [SCRIPT_PATH, '--dry-run', '--harness=claude'], { encoding: 'utf8' });
    assert.match(out, /Starting Gmail alert watcher/);
    assert.match(out, /would run claude with prompt/);
    assert.match(out, /Azure Alert/);
  } catch (err) {
    assert.fail(`dry-run failed: ${err.message}`);
  }
});
