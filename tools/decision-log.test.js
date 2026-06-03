/**
 * Round-trip test for decision-log.js using a fixture AGENT_MEMORY_ROOT.
 * All writes go to a tmpdir — no live data touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./decision-log.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

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

test('decision-log round-trip: write → search', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-log-test-'));
  try {
    // write
    const write = run([
      '--write',
      '--title=Use ESM for all new tools',
      '--decision=All new tools in tools/ must use ES modules (import/export)',
      '--rationale=Consistency with package.json type:module',
      '--agent=Friday',
      '--project=testproj',
    ], root);
    assert.strictEqual(write.status, 0, `write failed: ${write.stderr}`);
    assert.match(write.stdout, /Decision written/);

    // search
    const search = run(['--search', '--query=ESM modules tools', '--project=testproj'], root);
    assert.strictEqual(search.status, 0, `search failed: ${search.stderr}`);
    const results = JSON.parse(search.stdout);
    assert.ok(Array.isArray(results), 'search output should be JSON array');
    assert.ok(results.length > 0, 'should find the written decision');
    assert.ok(results[0].score > 0, 'top result should have positive score');
    assert.match(results[0].title, /ESM/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('decision-log: list shows written decision', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-log-test-'));
  try {
    run([
      '--write',
      '--title=TDD for all new code',
      '--decision=Write tests before implementation',
      '--rationale=Prevent regressions',
      '--agent=Friday',
      '--project=testproj',
    ], root);

    const list = run(['--list', '--project=testproj'], root);
    assert.strictEqual(list.status, 0, `list failed: ${list.stderr}`);
    assert.match(list.stdout, /TDD for all new code/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('decision-log: search returns empty array when no decisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-log-test-'));
  try {
    const search = run(['--search', '--query=anything', '--project=testproj'], root);
    assert.strictEqual(search.status, 0);
    const results = JSON.parse(search.stdout);
    assert.deepStrictEqual(results, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('decision-log: write requires --title and --decision', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-log-test-'));
  try {
    const result = run(['--write', '--agent=Friday', '--project=testproj'], root);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--title.*--decision|--decision.*--title/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('decision-log: search with no query exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-log-test-'));
  try {
    const result = run(['--search'], root);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--query/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('decision-log: expire archives old decisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-log-test-'));
  try {
    // Write with expires=0 (already expired)
    run([
      '--write',
      '--title=Old decision to expire',
      '--decision=This should get archived',
      '--rationale=Test',
      '--agent=Friday',
      '--expires=0',
      '--project=testproj',
    ], root);

    const expire = run(['--expire', '--project=testproj'], root);
    assert.strictEqual(expire.status, 0, `expire failed: ${expire.stderr}`);
    assert.match(expire.stdout, /archived/i);

    // list should now be empty (expired not shown by default)
    const list = run(['--list', '--project=testproj'], root);
    assert.ok(!list.stdout.includes('Old decision to expire'), 'expired decision should not appear in list');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
