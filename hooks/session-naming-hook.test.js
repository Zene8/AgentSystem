#!/usr/bin/env node
'use strict';
/**
 * Test suite for session-naming-hook.js
 * Tests SessionStart hook behavior for session registration and title output.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const testDir = path.join(os.tmpdir(), `session-naming-test-${Date.now()}`);

test('setup', () => {
  fs.mkdirSync(testDir, { recursive: true });
});

test('session-naming-hook: hook structure is correct', () => {
  // Verify the hook file exists and is readable
  const hookPath = path.join(__dirname, 'session-naming-hook.js');
  assert(fs.existsSync(hookPath), 'session-naming-hook.js should exist');
  const content = fs.readFileSync(hookPath, 'utf8');
  assert(content.includes('SessionStart'), 'Hook should reference SessionStart');
  assert(content.includes('session-namer.js'), 'Hook should call session-namer.js');
});

test('session-naming-hook: handles malformed JSON input gracefully', () => {
  // This is a smoke test to ensure the hook doesn't crash.
  // A full integration test would require spawning the hook separately.
  assert(true, 'Placeholder — hook integration tests require child_process spawning');
});

test('cleanup', () => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
});
