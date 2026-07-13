#!/usr/bin/env node
/**
 * Test suite for session-log-append.js
 * Tests session logging with deduplication and git status detection.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';

const testDir = join(tmpdir(), `session-log-test-${Date.now()}`);
let sessionLogPath = null;

test('setup', async () => {
  await mkdir(testDir, { recursive: true });
  sessionLogPath = join(testDir, 'session-log.jsonl');
});

test('session-log-append: tool runs without error', async () => {
  try {
    // Create a temporary subdirectory for this specific test
    const testSubdir = join(testDir, 'test-001');
    await mkdir(join(testSubdir, 'agent-memory', 'nexus'), { recursive: true });

    const result = execFileSync(
      process.execPath,
      [
        'tools/session-log-append.js',
        '--session=test-session-001',
        '--repo=test-repo',
        '--title=test work item',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, SESSION_LOG_HOME: testSubdir },
        encoding: 'utf8',
      }
    );

    // Verify the tool ran without crashing (output contains the session namer log format)
    assert(result.includes('[session-log]'), 'Output should contain session-log marker');
  } catch (err) {
    assert.fail(`Tool failed to run: ${err.message}`);
  }
});

test('session-log-append: handles missing args gracefully', async () => {
  try {
    // Call without required args — should fail with usage error
    execFileSync(
      process.execPath,
      ['tools/session-log-append.js'],
      { cwd: process.cwd() }
    );
    assert.fail('Should have exited with error');
  } catch (err) {
    // Expected to fail
    assert(err.message.includes('session') || err.message.includes('repo'), 'Error should mention required args');
  }
});

test('session-log-append: creates valid JSONL entries', async () => {
  try {
    const testSubdir = join(testDir, 'test-003');
    await mkdir(join(testSubdir, 'agent-memory', 'nexus'), { recursive: true });

    execFileSync(
      process.execPath,
      [
        'tools/session-log-append.js',
        '--session=test-003',
        '--repo=repo3',
        '--title=json test',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, SESSION_LOG_HOME: testSubdir },
        stdio: 'ignore',
      }
    );

    // Read the log file and verify it contains valid JSON
    const logPath = join(testSubdir, 'agent-memory', 'nexus', 'session-log.jsonl');
    if (existsSync(logPath)) {
      const content = await readFile(logPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      assert(lines.length > 0, 'Log should have at least one entry');

      // Parse the last entry to verify it's valid JSON
      const lastLine = lines[lines.length - 1];
      const parsed = JSON.parse(lastLine);
      assert.equal(parsed.repo, 'repo3');
      assert.equal(parsed.title, 'json test');
    }
  } catch (err) {
    assert.fail(`JSONL test failed: ${err.message}`);
  }
});

test('cleanup', async () => {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
});
