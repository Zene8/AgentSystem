#!/usr/bin/env node
/**
 * Antigravity (agy) Harness Dispatcher
 * Spawns one-shot and persistent agy sessions for Mission Control
 *
 * PERSISTENCE WRAPPER:
 * Leo is building tools/mission-control/agy-persistence.js (issue #84)
 * that provides spawnAgyPersistent({ prompt, repoPath, model?, continueId? })
 * This module stubs against that interface until it's available.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const HOME = homedir();
const AGY_CLI = 'agy'; // Assume agy is in PATH

/**
 * Spawn one-shot agy session
 * Uses direct `agy` CLI invocation, output captured to caller
 *
 * @param {string} prompt - Task description
 * @param {string} repoPath - Absolute path to repo (pre-validated)
 * @param {string} [model] - Model override (e.g., 'gemini-2.0')
 * @returns {Promise<{sessionId: string, logPath: null, status: string}>}
 *   sessionId: auto-assigned from history.jsonl
 *   logPath: null (agy manages its own history)
 *   status: 'running' (agy runs one-shot)
 */
export async function spawnAgyOneShotDirect(prompt, repoPath, model = null) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--add-dir', repoPath];
    if (model) args.push('--model', model);

    // TODO: Add --dangerously-skip-permissions for MC context (requires confirmation)
    // args.push('--dangerously-skip-permissions');

    const child = spawn(AGY_CLI, args, {
      cwd: repoPath,
      env: { ...process.env, HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    child.stdout?.on('data', d => (stdout += d));
    child.stderr?.on('data', d => (stderr += d));

    child.on('close', (code) => {
      resolve({
        sessionId: null, // agy doesn't expose session IDs from one-shot
        logPath: null,
        status: code === 0 ? 'exited' : 'failed',
        exitCode: code,
        output: stdout + stderr,
      });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn agy: ${err.message}`));
    });

    // Timeout after 30 minutes (agy may run long for some tasks)
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('agy spawn timeout (30m)'));
    }, 30 * 60 * 1000);

    child.on('close', () => clearTimeout(timeout));
  });
}

/**
 * Spawn persistent agy session (wraps Leo's agy-persistence.js)
 * This function stubs against Leo's module until #84 is merged
 *
 * @param {string} prompt - Task description
 * @param {string} repoPath - Absolute path to repo (pre-validated)
 * @param {string} [model] - Model override
 * @param {string} [continueId] - Resume from previous conversation
 * @returns {Promise<{sessionId: string, tmuxSession: string, logPath: string, status: string}>}
 */
export async function spawnAgyPersistent(prompt, repoPath, model = null, continueId = null) {
  // TODO: Implement once Leo's agy-persistence.js is available (issue #84)
  // For now, fall back to one-shot (non-persistent)
  console.warn('[agy-dispatcher] agy-persistence.js not yet available, falling back to one-shot');

  try {
    const result = await spawnAgyOneShotDirect(prompt, repoPath, model);
    return {
      sessionId: continueId || 'agy-oneShotFallback',
      tmuxSession: null,
      logPath: null,
      status: result.status,
      exitCode: result.exitCode,
    };
  } catch (e) {
    return {
      sessionId: null,
      tmuxSession: null,
      logPath: null,
      status: 'failed',
      error: e.message,
    };
  }
}

export default { spawnAgyOneShotDirect, spawnAgyPersistent };
