#!/usr/bin/env node
/**
 * Antigravity CLI Persistence Wrapper
 * Spawns `agy` in tmux sessions for background execution
 */

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const HOME = homedir();
const LOG_BASE = join(HOME, '.agy-mission-control');
mkdirSync(LOG_BASE, { recursive: true });

export async function spawnAgyPersistent({ prompt, repoPath, model, continueId }) {
  if (!existsSync(repoPath)) throw new Error(`Repo not found: ${repoPath}`);

  const timestamp = Date.now();
  const sessionId = `agy-${timestamp}`;
  const tmuxSessionName = `mc-${sessionId}`;
  const logPath = join(LOG_BASE, `${sessionId}.log`);
  const metaPath = join(LOG_BASE, `${sessionId}.json`);

  const args = ['-p', prompt];
  if (model) args.push('--model', model);
  if (continueId) args.push('--continue', continueId);
  else args.push('--dangerously-skip-permissions');
  args.push('--add-dir', repoPath);

  return new Promise((resolve, reject) => {
    const cmd = ['new-session', '-d', '-s', tmuxSessionName, '-c', repoPath];
    const cmdArgs = ['agy'].concat(args);
    cmd.push(cmdArgs.join(' ') + ` 2>&1 | tee ${logPath}`);

    const tmux = spawn('tmux', cmd, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME },
      shell: true,
    });

    tmux.on('error', () => spawnDirect({ prompt, repoPath, model, continueId, logPath, sessionId, tmuxSessionName }).then(resolve).catch(reject));

    tmux.on('close', (code) => {
      if (code !== 0) return spawnDirect({ prompt, repoPath, model, continueId, logPath, sessionId, tmuxSessionName }).then(resolve).catch(reject);

      const pidCmd = spawn('tmux', ['list-panes', '-t', tmuxSessionName, '-F', '#{pane_pid}'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let pidOut = '';
      pidCmd.stdout?.on('data', d => { pidOut += d.toString(); });
      pidCmd.on('close', () => {
        const pid = parseInt(pidOut.trim());
        const conversationId = sessionId;
        writeFileSync(metaPath, JSON.stringify({
          id: sessionId, tmuxSessionName, pid: pid || null, logPath, conversationId,
          spawnedAt: new Date().toISOString(), model, repoPath, prompt: prompt.slice(0, 200),
        }, null, 2));
        resolve({ tmuxSessionName, pid: pid || null, logPath, conversationId, spawnedAt: new Date().toISOString() });
      });
    });
  });
}

async function spawnDirect({ prompt, repoPath, model, continueId, logPath, sessionId, tmuxSessionName }) {
  return new Promise((resolve) => {
    const args = ['-p', prompt];
    if (model) args.push('--model', model);
    if (continueId) args.push('--continue', continueId);
    else args.push('--dangerously-skip-permissions');
    args.push('--add-dir', repoPath);

    const agy = spawn('agy', args, { cwd: repoPath, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME } });
    agy.unref();
    const pid = agy.pid;

    agy.stdout?.on('data', d => { appendFileSync(logPath, d.toString()); });
    agy.stderr?.on('data', d => { appendFileSync(logPath, d.toString()); });

    const conversationId = sessionId;
    const metaPath = join(LOG_BASE, `${sessionId}.json`);
    writeFileSync(metaPath, JSON.stringify({
      id: sessionId, tmuxSessionName, pid, logPath, conversationId,
      spawnedAt: new Date().toISOString(), model, repoPath, prompt: prompt.slice(0, 200), method: 'direct',
    }, null, 2));

    resolve({ tmuxSessionName, pid, logPath, conversationId, spawnedAt: new Date().toISOString() });
  });
}

export async function stopAgyPersistent({ tmuxSessionName }) {
  return new Promise((resolve) => {
    const kill = spawn('tmux', ['kill-session', '-t', tmuxSessionName], { stdio: ['ignore', 'pipe', 'pipe'] });
    kill.on('close', (code) => { resolve({ exitCode: code || 0, exitedAt: new Date().toISOString() }); });
    kill.on('error', () => { resolve({ exitCode: 0, exitedAt: new Date().toISOString() }); });
  });
}

export async function listAgySessions() {
  const sessions = [];
  try {
    const files = require('fs').readdirSync(LOG_BASE).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const metaPath = join(LOG_BASE, file);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      sessions.push(meta);
    }
  } catch (e) {
    console.warn(`Failed to list sessions: ${e.message}`);
  }
  return sessions;
}

export async function getAgyLog(sessionId, { tail = 100 } = {}) {
  const logPath = join(LOG_BASE, `${sessionId}.log`);
  if (!existsSync(logPath)) return '';
  try {
    const content = readFileSync(logPath, 'utf8');
    return content.split('\n').slice(-tail).join('\n');
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'spawn') {
    const [prompt, repoPath, model, continueId] = args;
    spawnAgyPersistent({ prompt, repoPath, model, continueId })
      .then(r => console.log(JSON.stringify(r, null, 2)))
      .catch(e => { console.error('Error:', e.message); process.exit(1); });
  } else if (cmd === 'stop') {
    stopAgyPersistent({ tmuxSessionName: args[0] })
      .then(r => console.log(JSON.stringify(r, null, 2)))
      .catch(e => { console.error('Error:', e.message); process.exit(1); });
  } else if (cmd === 'list') {
    listAgySessions().then(s => console.log(JSON.stringify(s, null, 2))).catch(e => { console.error('Error:', e.message); process.exit(1); });
  } else {
    console.log('Usage: agy-persistence.js spawn|stop|list [args]');
  }
}

/**
 * CONCURRENCY MODEL (per Friday's autonomy rules):
 * - Max 1 concurrent agy session per account
 * - Sessions are bounded (spawn → run → exit or checkpoint)
 * - Resumable via --continue <conversationId>
 * - Never an infinite/eternal daemon
 *
 * Enforcement: Dispatcher (webhook) checks before calling spawnAgyPersistent
 * This wrapper is permissive; concurrency cap is enforced upstream
 */
