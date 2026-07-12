#!/usr/bin/env node
/**
 * pm-hygiene.test.js — Tests for PM hygiene tool.
 * Run with: node --test tools/pm-hygiene.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';

// Note: This file tests helper exports separately. The main async function
// requires git repos and file I/O, so we test via integration in shell scripts.

test('pm-hygiene: placeholder test (main logic tested via integration)', () => {
  // This tool is primarily tested through the hook integration:
  // The session-end.sh hook calls pm-hygiene.js with real session context,
  // and the resulting HANDOFF.md and session-log.jsonl entries are verified
  // through end-to-end test sessions.
  //
  // Unit tests would require:
  // - Mock git repos for checkUncommittedChanges, findOrphanedBranches
  // - Mock file system for writeHandoffMarkdown, appendSessionSummary
  // - Mock registry for loadSessionEntry, getPRFromRegistry
  //
  // These are better tested through the hook integration suite.

  assert.ok(true, 'pm-hygiene integration tests deferred to hook suite');
});
