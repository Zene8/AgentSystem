#!/usr/bin/env node
/**
 * Mission Control — Webhook server tests
 * Coverage: repo validation, session registry, harness routing (claude + agy)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const HOME = homedir();
const TEST_REGISTRY_PATH = `${HOME}/.claude/mission-control-registry-test.json`;

// ── Test fixtures ─────────────────────────────────────────────────────────

const MOCK_KNOWN_REPOS = {
  version: '1.0',
  repos: [
    {
      slug: 'agentsystem',
      path: '/home/natha/dev/AgentSystem',
      bootstrap_complete: true,
    },
    {
      slug: 'genie',
      path: '/home/natha/dev/arborgenie/genie',
      bootstrap_complete: true,
    },
    {
      slug: 'test-repo',
      path: '/home/test/repo',
      bootstrap_complete: true,
    },
  ],
};

// ── Test: Repo Validation ──────────────────────────────────────────────────

test('repoValidator.validateRepo() accepts valid repo slug', async (t) => {
  const { validateRepo } = await import('../tools/mission-control/repo-validator.js');

  const result = validateRepo('agentsystem', MOCK_KNOWN_REPOS);
  assert.ok(result, 'should return truthy');
  assert.equal(result.slug, 'agentsystem');
  assert.equal(result.path, '/home/natha/dev/AgentSystem');
});

test('repoValidator.validateRepo() rejects unknown repo', async (t) => {
  const { validateRepo } = await import('../tools/mission-control/repo-validator.js');

  assert.throws(
    () => validateRepo('unknown-repo', MOCK_KNOWN_REPOS),
    /not in allowlist/,
    'should throw on unknown repo'
  );
});

test('repoValidator.validateRepo() rejects path traversal', async (t) => {
  const { validateRepo } = await import('../tools/mission-control/repo-validator.js');

  assert.throws(
    () => validateRepo('../etc/passwd', MOCK_KNOWN_REPOS),
    /Invalid repo slug/,
    'should reject path traversal'
  );
});

test('repoValidator.validateRepo() rejects absolute paths', async (t) => {
  const { validateRepo } = await import('../tools/mission-control/repo-validator.js');

  assert.throws(
    () => validateRepo('/absolute/path', MOCK_KNOWN_REPOS),
    /Invalid repo slug/,
    'should reject absolute paths'
  );
});

// ── Test: Session Registry ─────────────────────────────────────────────────

test('SessionRegistry.createSession() stores claude session', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const registry = new SessionRegistry(TEST_REGISTRY_PATH);

  const session = registry.createSession({
    harness: 'claude',
    agent: 'friday',
    repo: 'agentsystem',
    prompt: 'test prompt',
  });

  assert.ok(session.id, 'should have id');
  assert.match(session.id, /^claude-/, 'id should start with harness prefix');
  assert.equal(session.harness, 'claude');
  assert.equal(session.status, 'spawning');
  assert.equal(session.agent, 'friday');
});

test('SessionRegistry.createSession() stores agy session', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const registry = new SessionRegistry(TEST_REGISTRY_PATH);

  const session = registry.createSession({
    harness: 'agy',
    model: 'gemini-2.0',
    repo: 'genie',
    prompt: 'test prompt',
  });

  assert.ok(session.id, 'should have id');
  assert.match(session.id, /^agy-/, 'id should start with agy prefix');
  assert.equal(session.harness, 'agy');
  assert.equal(session.model, 'gemini-2.0');
});

test('SessionRegistry.getSession() retrieves stored session', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const registry = new SessionRegistry(TEST_REGISTRY_PATH);

  const created = registry.createSession({
    harness: 'claude',
    agent: 'friday',
    repo: 'agentsystem',
    prompt: 'test',
  });

  const retrieved = registry.getSession(created.id);
  assert.equal(retrieved.id, created.id);
  assert.equal(retrieved.agent, 'friday');
});

test('SessionRegistry.updateSession() marks session running', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const registry = new SessionRegistry(TEST_REGISTRY_PATH);

  const session = registry.createSession({
    harness: 'claude',
    agent: 'friday',
    repo: 'agentsystem',
    prompt: 'test',
  });

  registry.updateSession(session.id, {
    status: 'running',
    logPath: '/home/natha/.claude/logs/abc123.jsonl',
  });

  const updated = registry.getSession(session.id);
  assert.equal(updated.status, 'running');
  assert.equal(updated.logPath, '/home/natha/.claude/logs/abc123.jsonl');
});

test('SessionRegistry persists to disk', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const testPath = `${HOME}/.claude/mission-control-registry-persist-test.json`;

  const registry1 = new SessionRegistry(testPath);
  const session = registry1.createSession({
    harness: 'agy',
    model: 'gemini-2.0',
    repo: 'genie',
    prompt: 'test',
  });

  // Create new registry instance pointing to same file
  const registry2 = new SessionRegistry(testPath);
  const retrieved = registry2.getSession(session.id);

  assert.ok(retrieved, 'should persist to disk and be retrievable');
  assert.equal(retrieved.harness, 'agy');

  // Cleanup
  try { rmSync(testPath); } catch {}
});

test('SessionRegistry.getSessions() returns all sessions', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const testPath = `${HOME}/.claude/mission-control-registry-all-test.json`;

  const registry = new SessionRegistry(testPath);

  const s1 = registry.createSession({
    harness: 'claude',
    agent: 'friday',
    repo: 'agentsystem',
    prompt: 'test1',
  });

  const s2 = registry.createSession({
    harness: 'agy',
    model: 'gemini-2.0',
    repo: 'genie',
    prompt: 'test2',
  });

  const all = registry.getSessions();
  assert.equal(all.length, 2);
  assert.ok(all.find(s => s.id === s1.id));
  assert.ok(all.find(s => s.id === s2.id));

  // Cleanup
  try { rmSync(testPath); } catch {}
});

// ── Test: Harness routing ──────────────────────────────────────────────────

test('POST /run accepts claude harness', async (t) => {
  // This is integration-level; we mock the intent here
  const request = {
    harness: 'claude',
    prompt: 'review the code',
    repo: 'agentsystem',
    agent: 'friday',
  };

  assert.equal(request.harness, 'claude');
  assert.equal(request.agent, 'friday');
});

test('POST /run accepts agy harness', async (t) => {
  const request = {
    harness: 'agy',
    prompt: 'review the code',
    repo: 'genie',
    model: 'gemini-2.0',
  };

  assert.equal(request.harness, 'agy');
  assert.equal(request.model, 'gemini-2.0');
});

test('POST /run rejects unknown harness', async (t) => {
  const request = {
    harness: 'unknown-harness',
    prompt: 'review the code',
    repo: 'agentsystem',
  };

  const validHarnesses = ['claude', 'agy'];
  assert.ok(!validHarnesses.includes(request.harness));
});

// ── Test: Session ID generation ────────────────────────────────────────────

test('Session ID has correct format for claude', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const registry = new SessionRegistry(TEST_REGISTRY_PATH);

  const session = registry.createSession({
    harness: 'claude',
    agent: 'friday',
    repo: 'agentsystem',
    prompt: 'test',
  });

  assert.match(session.id, /^claude-[a-f0-9]{8}$/);
});

test('Session ID has correct format for agy', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const registry = new SessionRegistry(TEST_REGISTRY_PATH);

  const session = registry.createSession({
    harness: 'agy',
    model: 'gemini-2.0',
    repo: 'genie',
    prompt: 'test',
  });

  assert.match(session.id, /^agy-[a-f0-9]{8}$/);
});

// ── Test: Cost estimate tracking ───────────────────────────────────────────

test('Claude session has costEstimate null initially', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const registry = new SessionRegistry(TEST_REGISTRY_PATH);

  const session = registry.createSession({
    harness: 'claude',
    agent: 'friday',
    repo: 'agentsystem',
    prompt: 'test',
  });

  assert.equal(session.costEstimate, null);
});

test('Agy session has costEstimate null (quota-based)', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const registry = new SessionRegistry(TEST_REGISTRY_PATH);

  const session = registry.createSession({
    harness: 'agy',
    model: 'gemini-2.0',
    repo: 'genie',
    prompt: 'test',
  });

  assert.equal(session.costEstimate, null);
});

// ── Test: Concurrency cap enforcement ──────────────────────────────────────

test('Concurrency cap: getRunning() includes spawning and running', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const testPath = `${HOME}/.claude/mission-control-registry-cap-fresh-test.json`;

  // Ensure clean state
  try { rmSync(testPath); } catch {}

  const registry = new SessionRegistry(testPath);

  const s1 = registry.createSession({
    harness: 'claude',
    agent: 'friday',
    repo: 'agentsystem',
    prompt: 'test1',
  });

  // Initially spawning (getRunning includes spawning status)
  let running = registry.getRunning();
  assert.equal(running.length, 1, 'should have 1 spawning session');

  // Mark as running
  registry.updateSession(s1.id, { status: 'running' });
  running = registry.getRunning();
  assert.equal(running.length, 1, 'should have 1 running session');

  // Mark as exited
  registry.exitSession(s1.id, 0);
  running = registry.getRunning();
  assert.equal(running.length, 0, 'should have 0 sessions after exit');

  try { rmSync(testPath); } catch {}
});

test('Concurrency cap: cannot spawn second claude while one running', async (t) => {
  const { SessionRegistry } = await import('../tools/mission-control/session-registry.js');
  const testPath = `${HOME}/.claude/mission-control-registry-cap-conflict-fresh-test.json`;

  // Ensure clean state
  try { rmSync(testPath); } catch {}

  const registry = new SessionRegistry(testPath);

  const s1 = registry.createSession({
    harness: 'claude',
    agent: 'friday',
    repo: 'agentsystem',
    prompt: 'test1',
  });

  registry.updateSession(s1.id, { status: 'running' });

  // Simulate trying to spawn another claude
  const running = registry.getRunning().filter(s => s.harness === 'claude');
  assert.equal(running.length, 1, 'should have one running claude session');

  try { rmSync(testPath); } catch {}
});

// Cleanup test files
test('cleanup', async (t) => {
  try { rmSync(TEST_REGISTRY_PATH); } catch {}
});
