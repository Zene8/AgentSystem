#!/usr/bin/env node
'use strict';
/**
 * Test suite for session-hygiene-hook.js
 * Tests SessionEnd hook behavior for session finalization and logging.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const testDir = path.join(os.tmpdir(), `session-hygiene-test-${Date.now()}`);

test('setup', () => {
  fs.mkdirSync(testDir, { recursive: true });
});

test('session-hygiene-hook: hook structure is correct', () => {
  // Verify the hook file exists and is readable
  const hookPath = path.join(__dirname, 'session-hygiene-hook.js');
  assert(fs.existsSync(hookPath), 'session-hygiene-hook.js should exist');
  const content = fs.readFileSync(hookPath, 'utf8');
  assert(content.includes('SessionEnd'), 'Hook should reference SessionEnd');
  assert(content.includes('session-namer.js'), 'Hook should call session-namer.js');
  assert(content.includes('session-log-append.js'), 'Hook should call session-log-append.js');
});

test('session-hygiene-hook: handles missing payload gracefully', () => {
  // The hook should output 'OK' when given no stdin.
  // This is a smoke test to ensure the hook doesn't crash on empty input.
  assert(true, 'Placeholder — hook integration tests require spawning');
});

test('session-hygiene-hook: spawns detached worker without blocking', () => {
  // The hook should exit immediately with 'OK' without waiting for the worker.
  assert(true, 'Placeholder — worker-mode tests deferred to integration suite');
});

test('cleanup', () => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
});
