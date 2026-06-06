/**
 * Round-trip test for task-scratchpad.js using a fixture AGENT_MEMORY_ROOT.
 * All writes go to a tmpdir — no live data touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./task-scratchpad.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

function run(args, root) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, AGENT_MEMORY_ROOT: root },
    }
  );
  return result;
}

test('scratchpad round-trip: init → write → read → close', () => {
  const root = mkdtempSync(join(tmpdir(), 'scratchpad-test-'));
  try {
    // init
    const init = run(['--init', '--issue=42', '--workers=Ultron,Astra', '--project=testproj'], root);
    assert.strictEqual(init.status, 0, `init failed: ${init.stderr}`);
    assert.match(init.stdout, /Initialized/);

    // write
    const write = run(['--write', '--issue=42', '--agent=Ultron', '--message=Found the bug', '--project=testproj'], root);
    assert.strictEqual(write.status, 0, `write failed: ${write.stderr}`);
    assert.match(write.stdout, /Written/);

    // read
    const read = run(['--read', '--issue=42', '--project=testproj'], root);
    assert.strictEqual(read.status, 0, `read failed: ${read.stderr}`);
    assert.match(read.stdout, /Scratchpad.*testproj.*42/);
    assert.match(read.stdout, /Ultron/);
    assert.match(read.stdout, /Found the bug/);

    // close
    const close = run(['--close', '--issue=42', '--project=testproj'], root);
    assert.strictEqual(close.status, 0, `close failed: ${close.stderr}`);
    assert.match(close.stdout, /archived/i);

    // after close: read returns "No scratchpad found" (not an error)
    const readAfter = run(['--read', '--issue=42', '--project=testproj'], root);
    assert.strictEqual(readAfter.status, 0);
    assert.match(readAfter.stdout, /No scratchpad found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scratchpad: write without init exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'scratchpad-test-'));
  try {
    const result = run(['--write', '--issue=99', '--agent=X', '--message=Hi', '--project=testproj'], root);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Scratchpad not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scratchpad: missing --issue exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'scratchpad-test-'));
  try {
    const result = run(['--init', '--project=testproj'], root);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--issue/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scratchpad: multiple write entries are appended in order', () => {
  const root = mkdtempSync(join(tmpdir(), 'scratchpad-test-'));
  try {
    run(['--init', '--issue=7', '--workers=A,B', '--project=testproj'], root);
    run(['--write', '--issue=7', '--agent=A', '--message=First entry', '--project=testproj'], root);
    run(['--write', '--issue=7', '--agent=B', '--message=Second entry', '--project=testproj'], root);
    const read = run(['--read', '--issue=7', '--project=testproj'], root);
    const idx1 = read.stdout.indexOf('First entry');
    const idx2 = read.stdout.indexOf('Second entry');
    assert.ok(idx1 < idx2, 'entries should appear in write order');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
