#!/usr/bin/env node
/**
 * LINUX MISSION-CONTROL HOST COMPONENT: Runs on dedicated Linux host only. Not compatible with Windows.
 * See tools/mission-control/README.md for architecture.
 *
 * Claude Code Remote Control Server
 * REST API + mobile web panel for phone-based agent dispatch
 *
 * Auth:    Authorization: Bearer <key from ~/.claude/remote-webhook.key>
 * Endpoints:
 *   GET  /              — health + daemon status
 *   GET  /panel         — mobile web control panel
 *   GET  /sessions      — list running sessions
 *   GET  /cost          — today's spend summary
 *   GET  /log/:id       — tail agent run log (last 100 lines)
 *   POST /run           — spawn background agent
 *                         body: { agent, prompt, cwd? }
 *   POST /github        — GitHub webhook → auto-route to agent
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, openSync, closeSync, mkdirSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { SessionRegistry } from './session-registry.js';
import { validateRepo } from './repo-validator.js';
import { spawnAgyOneShotDirect, spawnAgyPersistent } from './agy-dispatcher.js';

const HOME      = homedir();
const KEY_FILE  = `${HOME}/.claude/remote-webhook.key`;
const ROSTER    = `${HOME}/.claude/daemon/roster.json`;
const CLAUDE    = process.env.CLAUDE_BIN || `${HOME}/.local/bin/claude`;
if (process.env.CLAUDE_BIN && !existsSync(process.env.CLAUDE_BIN)) {
  console.error(`Specified CLAUDE_BIN does not exist: ${process.env.CLAUDE_BIN}`);
  process.exit(1);
}
const LOG_DIR   = `${HOME}/.claude/agent-runs`;
const COST_LOG  = `${HOME}/agent-memory/nexus/session-log.jsonl`;
const KNOWN_REPOS_FILE = `${HOME}/agent-memory/nexus/known-repos.json`;
const MC_REGISTRY_FILE = `${HOME}/.claude/mission-control-registry.json`;
const PORT      = parseInt(process.env.PORT || '8765');
const GH_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

const SECRET = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : null;
if (!SECRET) { console.error('No ~/.claude/remote-webhook.key found'); process.exit(1); }

const HOST      = process.env.HOST || '127.0.0.1';
const AUDIT_LOG = `${HOME}/.claude/mission-control-audit.jsonl`;

const rateLimitWindowMs = 60 * 1000;
const rateLimitMaxRequests = 100;
const ipRequestCounts = new Map();

function rateLimiter(req) {
  const ip = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  
  if (!ipRequestCounts.has(ip)) {
    ipRequestCounts.set(ip, []);
  }
  
  const timestamps = ipRequestCounts.get(ip);
  const activeTimestamps = timestamps.filter(ts => now - ts < rateLimitWindowMs);
  
  if (activeTimestamps.length >= rateLimitMaxRequests) {
    return false;
  }
  
  activeTimestamps.push(now);
  ipRequestCounts.set(ip, activeTimestamps);
  return true;
}

function auditLog(action, req, details = {}) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      ip: req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      details,
    };
    appendFileSync(AUDIT_LOG, JSON.stringify(logEntry) + '\n');
  } catch (e) {
    console.error('Failed to write audit log:', e.message);
  }
}

mkdirSync(LOG_DIR, { recursive: true });

// Initialize Mission Control registry (for both claude + agy sessions)
const registry = new SessionRegistry(MC_REGISTRY_FILE);

// Reconcile any stale active sessions on server startup
function reconcileRegistryOnStartup() {
  try {
    const running = registry.getRunning();
    if (running.length > 0) {
      console.log(`[mc-registry] Found ${running.length} stale active session(s) on startup. Cleaning up...`);
      for (const s of running) {
        registry.exitSession(s.id, 137, s.logPath);
      }
    }
  } catch (e) {
    console.warn('[mc-registry] Startup reconciliation failed:', e.message);
  }
}
reconcileRegistryOnStartup();

// ── helpers ──────────────────────────────────────────────────────────────────

function readJSON(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      try { resolve({ raw, parsed: JSON.parse(raw.toString() || '{}') }); }
      catch { resolve({ raw, parsed: {} }); }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function html(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function checkAuth(req) {
  const h = req.headers.authorization || '';
  if (h === `Bearer ${SECRET}` || h === SECRET) return true;
  // Also allow ?key= query param for panel bookmarks
  const url = new URL(req.url, `http://localhost`);
  return url.searchParams.get('key') === SECRET;
}

function verifyGitHubSig(raw, sig) {
  if (!GH_SECRET || !sig) return false;
  const expected = 'sha256=' + createHmac('sha256', GH_SECRET).update(raw).digest('hex');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(sigBuf, expectedBuf);
}

function getSessions() {
  const roster = readJSON(ROSTER) || {};
  return Object.entries(roster.workers || {}).map(([id, w]) => ({
    id, pid: w.pid, cwd: w.cwd,
    startedAt: new Date(w.startedAt).toISOString(),
    agent: w.dispatch?.flagArgs?.find((a, i, arr) => arr[i-1] === '--agent') || 'unknown',
  }));
}

function getCostSummary() {
  if (!existsSync(COST_LOG)) return { today: { sessions: 0, cost_usd: 0 }, recent: [] };
  const lines = readFileSync(COST_LOG, 'utf8').trim().split('\n').filter(Boolean);
  const sessions = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const today = new Date(new Date().toDateString());
  const todaySessions = sessions.filter(s => new Date(s.ts) >= today);
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const weekSessions = sessions.filter(s => new Date(s.ts) >= weekAgo);
  return {
    today: {
      sessions: todaySessions.length,
      cost_usd: todaySessions.reduce((s, r) => s + (r.cost_usd || 0), 0),
    },
    week: {
      sessions: weekSessions.length,
      cost_usd: weekSessions.reduce((s, r) => s + (r.cost_usd || 0), 0),
    },
    recent: sessions.slice(-5).reverse(),
  };
}

// ── bg-agent spawn protection ─────────────────────────────────────────────────
// Guards the raw `claude --bg` spawn path (used directly by /github and the
// legacy /run handler, which do NOT go through SessionRegistry's per-harness
// cap). Prevents duplicate spawns from rapid-fire repeated events (e.g. GitHub
// retries/flapping webhooks) and caps total concurrent background sessions.
const SPAWN_DEDUPE_WINDOW_MS = 30 * 1000;
const MAX_CONCURRENT_BG_SESSIONS = 5;
const recentSpawnKeys = new Map(); // `${agent}|${cwd}` -> last spawn timestamp

function pruneRecentSpawnKeys(now) {
  for (const [key, ts] of recentSpawnKeys) {
    if (now - ts > SPAWN_DEDUPE_WINDOW_MS) recentSpawnKeys.delete(key);
  }
}

function spawnAgent(agent, prompt, cwd = HOME) {
  return new Promise(async (resolve) => {
    const now = Date.now();
    pruneRecentSpawnKeys(now);

    // 1. Debounce/dedup: skip identical agent+cwd spawns within the window.
    const dedupeKey = `${agent}|${cwd}`;
    const lastSpawn = recentSpawnKeys.get(dedupeKey);
    if (lastSpawn && (now - lastSpawn) < SPAWN_DEDUPE_WINDOW_MS) {
      console.log(`[spawn-guard] Skipped duplicate spawn for agent=${agent} cwd=${cwd} (last spawned ${now - lastSpawn}ms ago, window=${SPAWN_DEDUPE_WINDOW_MS}ms)`);
      resolve({ skipped: true, reason: 'duplicate', agent, ts: now });
      return;
    }

    // 2. Concurrency cap: reject/queue beyond MAX_CONCURRENT_BG_SESSIONS active sessions.
    let activeCount = 0;
    try {
      const active = await getActiveSessions();
      activeCount = Array.isArray(active) ? active.length : 0;
    } catch {
      activeCount = 0;
    }
    if (activeCount >= MAX_CONCURRENT_BG_SESSIONS) {
      console.log(`[spawn-guard] Rejected spawn for agent=${agent} — concurrency cap reached (${activeCount}/${MAX_CONCURRENT_BG_SESSIONS} active bg sessions)`);
      resolve({ skipped: true, reason: 'concurrency_cap', agent, active: activeCount, cap: MAX_CONCURRENT_BG_SESSIONS, ts: now });
      return;
    }

    recentSpawnKeys.set(dedupeKey, now);

    const ts = now;
    const logFile = `${LOG_DIR}/${ts}-${agent}.log`;

    // Use --bg for proper daemon-managed background sessions
    // stdout: "backgrounded · <8-char-id>"
    const child = spawn(CLAUDE, ['--bg', '--agent', agent, '-p', prompt], {
      cwd: existsSync(cwd) ? cwd : HOME,
      env: { ...process.env, HOME },
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.unref();

    let stdout = '', stderr = '';
    child.stdout?.on('data', d => stdout += d);
    child.stderr?.on('data', d => stderr += d);

    child.on('close', () => {
      // Parse session short ID from "backgrounded · abc123de"
      const match = stdout.match(/backgrounded\s*[·•]\s*([a-f0-9]+)/i);
      const shortId = match?.[1] || null;
      resolve({
        sessionId: shortId || `${ts}-${agent}`,
        shortId,
        logFile: shortId ? null : logFile,
        logId: shortId || `${ts}-${agent}`,
        ts
      });
    });

    // Fallback: if spawn fails, log to file
    child.on('error', () => {
      const logFd = openSync(logFile, 'w');
      const fallback = spawn(CLAUDE, ['--agent', agent, '-p', prompt], {
        cwd: existsSync(cwd) ? cwd : HOME,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, HOME },
      });
      fallback.unref();
      closeSync(logFd);
      resolve({
        sessionId: `${ts}-${agent}`,
        shortId: null,
        logFile,
        logId: `${ts}-${agent}`,
        ts,
        pid: fallback.pid
      });
    });
  });
}

function getActiveSessions() {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, ['agents', '--json'], { env: { ...process.env, HOME } });
    let out = '';
    child.stdout?.on('data', d => out += d);
    child.on('close', () => {
      try { resolve(JSON.parse(out)); } catch { resolve([]); }
    });
    child.on('error', () => resolve([]));
  });
}

function getAgentLog(shortId) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, ['logs', shortId], { env: { ...process.env, HOME } });
    let out = '';
    child.stdout?.on('data', d => out += d);
    child.stderr?.on('data', d => out += d);
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(''));
    setTimeout(() => { child.kill(); resolve(out); }, 5000);
  });
}

function getRecentRuns(limit = 10) {
  try {
    return readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const [ts, ...rest] = f.replace('.log', '').split('-');
        return { id: f.replace('.log', ''), ts: parseInt(ts), agent: rest.join('-'), file: `${LOG_DIR}/${f}` };
      })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  } catch { return []; }
}

function loadKnownRepos() {
  try {
    if (existsSync(KNOWN_REPOS_FILE)) {
      return JSON.parse(readFileSync(KNOWN_REPOS_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Failed to load known-repos.json:', e.message);
  }
  return { repos: [] };
}

async function dispatchClaude(agent, prompt, repoPath) {
  return spawnAgent(agent, prompt, repoPath);
}

async function dispatchAgy(prompt, repoPath, model = null) {
  try {
    const result = await spawnAgyPersistent(prompt, repoPath, model);
    return result;
  } catch (e) {
    console.error('agy dispatch failed:', e.message);
    return { status: 'failed', error: e.message };
  }
}

// ── Web panel HTML ────────────────────────────────────────────────────────────

function panelHTML(key) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>⚡ Mission Control</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-main: #030712;
    --bg-radial: radial-gradient(circle at 50% 50%, #0b1528 0%, #030712 100%);
    --card-bg: rgba(17, 24, 39, 0.6);
    --border-glow: rgba(99, 102, 241, 0.15);
    --border-subtle: rgba(255, 255, 255, 0.08);
    --text-primary: #f3f4f6;
    --text-secondary: #9ca3af;
    --text-muted: #6b7280;
    --neon-blue: #38bdf8;
    --neon-purple: #c084fc;
    --neon-green: #34d399;
    --neon-red: #f87171;
    --neon-orange: #fb923c;
    --shadow-neon: 0 0 15px rgba(99, 102, 241, 0.25);
    --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  body {
    background: var(--bg-main);
    background-image: var(--bg-radial);
    color: var(--text-primary);
    font-family: 'Outfit', sans-serif;
    min-height: 100vh;
    padding: 16px;
    max-width: 600px;
    margin: 0 auto;
    overflow-x: hidden;
  }
  
  .glass-card {
    background: var(--card-bg);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 16px;
    transition: var(--transition);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
  }
  
  .glass-card:hover {
    border-color: rgba(99, 102, 241, 0.25);
    box-shadow: 0 8px 32px rgba(99, 102, 241, 0.05);
  }
  
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 4px 16px;
    margin-bottom: 12px;
  }
  
  h1 {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, var(--neon-blue), var(--neon-purple));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  h2 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-secondary);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--neon-green);
    box-shadow: 0 0 10px var(--neon-green);
    display: inline-block;
    animation: pulse 2s infinite;
  }
  
  @keyframes pulse {
    0% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7); }
    70% { transform: scale(1.1); box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
    100% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
  }
  
  .tabs {
    display: flex;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 10px;
    padding: 4px;
    margin-bottom: 16px;
    border: 1px solid var(--border-subtle);
  }
  
  .tab-btn {
    flex: 1;
    padding: 10px;
    background: transparent;
    color: var(--text-secondary);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
    font-size: 13px;
    transition: var(--transition);
  }
  
  .tab-btn.active {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.8), rgba(168, 85, 247, 0.8));
    color: white;
    box-shadow: var(--shadow-neon);
  }
  
  label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  
  .form-group {
    margin-bottom: 12px;
  }
  
  select, textarea, input {
    width: 100%;
    background: rgba(0, 0, 0, 0.3);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 12px;
    font-family: inherit;
    font-size: 14px;
    outline: none;
    transition: var(--transition);
  }
  
  select:focus, textarea:focus, input:focus {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: 0 0 10px rgba(99, 102, 241, 0.2);
  }
  
  textarea {
    resize: vertical;
    min-height: 90px;
  }
  
  button.action-btn {
    width: 100%;
    padding: 12px;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    color: white;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: var(--transition);
    box-shadow: var(--shadow-neon);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  
  button.action-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 0 20px rgba(99, 102, 241, 0.4);
  }
  
  button.action-btn:active {
    transform: translateY(1px);
    opacity: 0.9;
  }
  
  .quick-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }
  
  .quick-btn {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 10px;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: var(--transition);
  }
  
  .quick-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
    color: var(--text-primary);
  }
  
  .metrics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
    text-align: center;
  }
  
  .metric-box {
    display: flex;
    flex-direction: column;
  }
  
  .metric-value {
    font-size: 20px;
    font-weight: 700;
    color: var(--neon-green);
    background: linear-gradient(135deg, var(--neon-green), #10b981);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  
  .metric-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-top: 4px;
  }
  
  .session-card {
    border-bottom: 1px solid var(--border-subtle);
    padding: 12px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .session-card:last-child {
    border: none;
    padding-bottom: 0;
  }
  
  .session-card:first-child {
    padding-top: 0;
  }
  
  .session-info {
    flex: 1;
    min-width: 0;
  }
  
  .session-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  
  .session-name {
    font-weight: 600;
    color: var(--neon-purple);
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }
  
  .badge.claude { background: rgba(99, 102, 241, 0.15); color: var(--neon-blue); border: 1px solid rgba(99, 102, 241, 0.3); }
  .badge.agy { background: rgba(168, 85, 247, 0.15); color: var(--neon-purple); border: 1px solid rgba(168, 85, 247, 0.3); }
  
  .badge.running { background: rgba(52, 211, 153, 0.1); color: var(--neon-green); border: 1px solid rgba(52, 211, 153, 0.2); }
  .badge.spawning { background: rgba(251, 146, 60, 0.1); color: var(--neon-orange); border: 1px solid rgba(251, 146, 60, 0.2); }
  
  .session-sub {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    gap: 8px;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .session-controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .icon-btn {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    width: 32px;
    height: 32px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: var(--transition);
    color: var(--text-secondary);
  }
  
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }
  
  .icon-btn.kill:hover {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
    color: var(--neon-red);
  }
  
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(2, 6, 23, 0.85);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  
  .modal-content {
    background: #020617;
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    width: 100%;
    max-width: 550px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }
  
  .modal-header {
    padding: 16px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .modal-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
  
  .terminal-view {
    flex: 1;
    background: #000;
    padding: 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    line-height: 1.5;
    color: #a7f3d0;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    border-bottom-left-radius: 16px;
    border-bottom-right-radius: 16px;
    min-height: 300px;
  }
</style>
</head>
<body>
  <header>
    <h1>⚡ Mission Control</h1>
    <div style="display:flex;align-items:center;gap:6px">
      <span class="pulse-dot"></span>
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.05em">System Live</span>
    </div>
  </header>

  <div class="glass-card">
    <div class="metrics-grid">
      <div class="metric-box">
        <div class="metric-value" id="cost-val">—</div>
        <div class="metric-label">Today's Cost</div>
      </div>
      <div class="metric-box">
        <div class="metric-value" id="sessions-val" style="color:var(--neon-blue);background:none;-webkit-text-fill-color:initial">—</div>
        <div class="metric-label">Active Runs</div>
      </div>
      <div class="metric-box">
        <div class="metric-value" id="week-val" style="color:var(--neon-purple);background:none;-webkit-text-fill-color:initial">—</div>
        <div class="metric-label">Weekly Spend</div>
      </div>
    </div>
  </div>

  <div class="glass-card">
    <h2>🚀 Dispatch Agent</h2>
    
    <div class="tabs">
      <button class="tab-btn active" id="tab-claude" onclick="setHarness('claude')">Claude Code</button>
      <button class="tab-btn" id="tab-agy" onclick="setHarness('agy')">Antigravity</button>
    </div>

    <div id="quick-prompts-container">
      <label>Quick Actions</label>
      <div class="quick-grid">
        <button class="quick-btn" onclick="quickClaude('friday','Check CI status and report failures')">🔧 CI Status</button>
        <button class="quick-btn" onclick="quickClaude('sam','Run security audit on latest changes')">🔒 Security</button>
        <button class="quick-btn" onclick="quickClaude('friday','Review open PRs and flag blockers')">📋 PR Review</button>
        <button class="quick-btn" onclick="quickClaude('jarvis','Give me a status briefing on all active work')">📊 Status Briefing</button>
      </div>
    </div>

    <form onsubmit="event.preventDefault(); dispatch();">
      <div class="form-group">
        <label for="repo">Target Repository</label>
        <select id="repo" required>
          <option value="" disabled selected>Loading allowlisted repositories...</option>
        </select>
      </div>

      <div class="form-group" id="group-agent">
        <label for="agent">Lead Agent Role</label>
        <select id="agent">
          <option value="jarvis">Jarvis (CEO / Orchestrate)</option>
          <option value="friday" selected>Friday (CTO / Engineering)</option>
          <option value="sam">Sam (CSO / Security)</option>
          <option value="nat">Nat (CBO / Business)</option>
          <option value="ultron">Ultron (Backend API)</option>
          <option value="pym">Pym (Database Schema)</option>
          <option value="leo">Leo (DevOps & CI/CD)</option>
          <option value="astra">Astra (Frontend & UX)</option>
          <option value="wanda">Wanda (Design & UI)</option>
          <option value="threepio">Threepio (Docs & Release Notes)</option>
          <option value="r2d2">R2D2 (General fallback)</option>
        </select>
      </div>

      <div class="form-group" id="group-model" style="display:none">
        <label for="model">Gemini Model</label>
        <select id="model">
          <option value="">Default (gemini-3.1-pro-preview)</option>
          <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
          <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
          <option value="gemini-3.1-flash-lite-preview">gemini-3.1-flash-lite-preview</option>
        </select>
      </div>

      <div class="form-group">
        <label for="prompt">Task Instructions</label>
        <textarea id="prompt" placeholder="What goal should the agent achieve?" required></textarea>
      </div>

      <button type="submit" class="action-btn" id="run-btn">
        <span>▶ Dispatch Agent Session</span>
      </button>
    </form>
    
    <div id="dispatch-result" style="display:none;margin-top:12px;font-size:12px;padding:10px;border-radius:8px"></div>
  </div>

  <div class="glass-card">
    <h2>📡 Active Agent Fleet <span id="fleet-count" class="badge running" style="margin-left:8px">0</span></h2>
    <div id="sessions-list" style="margin-top:12px">
      <div style="color:var(--text-muted);font-size:12px">Checking active sessions...</div>
    </div>
  </div>

  <div class="glass-card">
    <h2>📜 Session Logs History</h2>
    <div id="history-list" style="margin-top:12px">
      <div style="color:var(--text-muted);font-size:12px">Loading runs...</div>
    </div>
  </div>

  <div class="glass-card" style="padding:14px 20px">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text-muted)">
      <span>System: <strong id="health-platform">—</strong></span>
      <span>Node: <strong id="health-node">—</strong></span>
      <span>Daemon Status: <strong id="health-daemon">—</strong></span>
    </div>
  </div>

  <div class="modal-overlay" id="log-modal" onclick="closeLogStream(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title" id="log-modal-title">Logs Stream</div>
        <button class="icon-btn" onclick="closeLogStream(event)">✕</button>
      </div>
      <div class="terminal-view" id="log-terminal">Connecting...</div>
    </div>
  </div>

  <script>
    const KEY = '${key}';
    let currentHarness = 'claude';
    let logInterval = null;

    async function api(path, opts = {}) {
      const r = await fetch(path, {
        headers: {
          'Authorization': 'Bearer ' + KEY,
          'Content-Type': 'application/json'
        },
        ...opts
      });
      return r.json();
    }

    function setHarness(harness) {
      currentHarness = harness;
      document.getElementById('tab-claude').classList.toggle('active', harness === 'claude');
      document.getElementById('tab-agy').classList.toggle('active', harness === 'agy');
      document.getElementById('group-agent').style.display = harness === 'claude' ? 'block' : 'none';
      document.getElementById('group-model').style.display = harness === 'agy' ? 'block' : 'none';
      document.getElementById('quick-prompts-container').style.display = harness === 'claude' ? 'block' : 'none';
    }

    function quickClaude(agent, prompt) {
      document.getElementById('agent').value = agent;
      document.getElementById('prompt').value = prompt;
      setHarness('claude');
    }

    async function loadRepos() {
      try {
        const d = await api('/repos');
        const select = document.getElementById('repo');
        if (!d.repos || d.repos.length === 0) {
          select.innerHTML = '<option value="" disabled>No repos registered</option>';
          return;
        }
        select.innerHTML = d.repos.map(r => 
          \`<option value="\${r.slug}">\${r.slug} (\${(r.description || '').slice(0, 50)}...)</option>\`
        ).join('');
      } catch (e) {
        document.getElementById('repo').innerHTML = \`<option value="" disabled>Error: \${e.message}</option>\`;
      }
    }

    async function loadCost() {
      try {
        const d = await api('/cost');
        document.getElementById('cost-val').textContent = '$' + (d.today?.cost_usd || 0).toFixed(4);
        document.getElementById('sessions-val').textContent = d.today?.sessions || 0;
        document.getElementById('week-val').textContent = '$' + (d.week?.cost_usd || 0).toFixed(3);
      } catch {}
    }

    async function loadHealth() {
      try {
        const d = await api('/health');
        document.getElementById('health-platform').textContent = d.platform || 'unknown';
        document.getElementById('health-node').textContent = d.node_version || 'unknown';
        document.getElementById('health-daemon').textContent = d.daemon?.status || 'stopped';
        if (d.daemon?.status === 'running') {
          document.getElementById('health-daemon').style.color = 'var(--neon-green)';
        } else {
          document.getElementById('health-daemon').style.color = 'var(--neon-red)';
        }
      } catch {}
    }

    async function loadSessions() {
      try {
        const d = await api('/sessions');
        const list = document.getElementById('sessions-list');
        const count = document.getElementById('fleet-count');
        
        const active = (d.sessions || []).filter(s => s.status === 'running' || s.status === 'spawning');
        count.textContent = active.length;
        
        if (active.length === 0) {
          list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px">No active agent runs</div>';
          return;
        }
        
        list.innerHTML = active.map(s => {
          const badgeClass = s.harness === 'claude' ? 'claude' : 'agy';
          const statusClass = s.status === 'running' ? 'running' : 'spawning';
          const name = s.agent ? s.agent : (s.model || 'Antigravity');
          return \`
            <div class="session-card">
              <div class="session-info">
                <div class="session-header-row">
                  <span class="session-name">\${name}</span>
                  <span class="badge \${badgeClass}">\${s.harness}</span>
                  <span class="badge \${statusClass}">\${s.status}</span>
                </div>
                <div class="session-sub">
                  <span>repo: <strong>\${s.repo}</strong></span>
                  <span>&bull;</span>
                  <span>\${new Date(s.spawnedAt).toLocaleTimeString()}</span>
                </div>
              </div>
              <div class="session-controls">
                <button class="icon-btn" title="View Logs" onclick="viewLogStream('\${s.id}', '\${name}')">
                  📄
                </button>
                <button class="icon-btn kill" title="Stop Session" onclick="stopSession('\${s.id}')">
                  ✕
                </button>
              </div>
            </div>
          \`;
        }).join('');
      } catch {}
    }

    async function loadRuns() {
      try {
        const d = await api('/runs');
        const list = document.getElementById('history-list');
        const runs = d.runs || [];
        
        if (runs.length === 0) {
          list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px">No completed runs</div>';
          return;
        }
        
        list.innerHTML = runs.map(r => {
          return \`
            <div class="session-card" style="padding:8px 0">
              <div class="session-info">
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-weight:500;font-size:13px">\${r.agent || 'Agent'}</span>
                  <span class="badge claude" style="font-size:8px">claude</span>
                </div>
                <div style="font-size:10px;color:var(--text-muted)">
                  \${new Date(r.ts).toLocaleString()}
                </div>
              </div>
              <div class="session-controls">
                <button class="icon-btn" title="View Logs" onclick="viewLogStream('\${r.id}', '\${r.agent}')">
                  📄
                </button>
              </div>
            </div>
          \`;
        }).join('');
      } catch {}
    }

    async function dispatch() {
      const repo = document.getElementById('repo').value;
      const prompt = document.getElementById('prompt').value.trim();
      const agent = document.getElementById('agent').value;
      const model = document.getElementById('model').value;
      
      if (!repo) { alert('Select a target repository'); return; }
      if (!prompt) { alert('Enter task instructions'); return; }
      
      const btn = document.getElementById('run-btn');
      const resultDiv = document.getElementById('dispatch-result');
      
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.querySelector('span').textContent = 'Spawning Agent...';
      resultDiv.style.display = 'none';
      
      try {
        const payload = {
          harness: currentHarness,
          repo,
          prompt,
          ...(currentHarness === 'claude' ? { agent } : { model })
        };
        
        const data = await api('/run', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        
        if (data.error) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(239, 68, 68, 0.1)';
          resultDiv.style.border = '1px solid var(--neon-red)';
          resultDiv.style.color = 'var(--neon-red)';
          resultDiv.textContent = 'Spawn Failed: ' + data.error;
        } else {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(52, 211, 153, 0.1)';
          resultDiv.style.border = '1px solid var(--neon-green)';
          resultDiv.style.color = 'var(--neon-green)';
          resultDiv.textContent = 'Agent dispatched successfully! ID: ' + data.id;
          document.getElementById('prompt').value = '';
          setTimeout(loadSessions, 1000);
        }
      } catch (e) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'rgba(239, 68, 68, 0.1)';
        resultDiv.style.border = '1px solid var(--neon-red)';
        resultDiv.style.color = 'var(--neon-red)';
        resultDiv.textContent = 'Network Error: ' + e.message;
      } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.querySelector('span').textContent = '▶ Dispatch Agent Session';
      }
    }

    async function stopSession(id) {
      if (!confirm('Are you sure you want to stop this session?')) return;
      try {
        const data = await api('/stop', {
          method: 'POST',
          body: JSON.stringify({ id })
        });
        if (data.error) {
          alert('Failed to stop session: ' + data.error);
        } else {
          loadSessions();
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function viewLogStream(id, name) {
      const modal = document.getElementById('log-modal');
      const terminal = document.getElementById('log-terminal');
      document.getElementById('log-modal-title').textContent = \`Logs: \${name} (\${id})\`;
      
      modal.style.display = 'flex';
      terminal.textContent = 'Reading tail logs...';
      
      if (logInterval) clearInterval(logInterval);
      
      const fetchLogs = async () => {
        try {
          const r = await fetch('/log/' + id, {
            headers: { 'Authorization': 'Bearer ' + KEY }
          });
          if (r.ok) {
            const text = await r.text();
            terminal.textContent = text || 'No logs recorded yet.';
            terminal.scrollTop = terminal.scrollHeight;
          } else {
            terminal.textContent = 'Logs temporarily unavailable (http status: ' + r.status + ')';
          }
        } catch (e) {
          terminal.textContent = 'Error loading logs: ' + e.message;
        }
      };
      
      await fetchLogs();
      logInterval = setInterval(fetchLogs, 3000);
    }

    function closeLogStream(e) {
      document.getElementById('log-modal').style.display = 'none';
      if (logInterval) {
        clearInterval(logInterval);
        logInterval = null;
      }
    }

    // Initialize Page
    loadRepos();
    loadCost();
    loadSessions();
    loadRuns();
    loadHealth();
    
    // Auto-refresh loops. Each tick of loadSessions() spawns a claude-agents-json
    // subprocess server-side (getActiveSessions), so keep this interval modest — it only
    // matters while the panel tab is actually open. 15s/90s is imperceptible for a status
    // dashboard and cuts idle subprocess-spawn frequency ~3x vs the previous 5s/30s.
    setInterval(() => {
      loadSessions();
      loadRuns();
      loadHealth();
    }, 15000);

    setInterval(loadCost, 90000);
  </script>
</body>
</html>`;
}

// ── GitHub webhook router ─────────────────────────────────────────────────────

function routeGitHubEvent(event, payload) {
  const repo = payload.repository?.full_name || 'unknown';

  if (event === 'pull_request') {
    const action = payload.action;
    const pr = payload.pull_request;
    if (['opened', 'synchronize'].includes(action)) {
      return {
        agent: 'friday',
        prompt: `GitHub PR #${pr.number} ${action} in ${repo}: "${pr.title}". Review the changes, check for issues, and post a review summary. PR URL: ${pr.html_url}`,
      };
    }
  }

  if (event === 'push' && payload.ref === 'refs/heads/main') {
    return {
      agent: 'leo',
      prompt: `New push to main in ${repo} by ${payload.pusher?.name}. ${payload.commits?.length || 0} commit(s). Check CI status and alert on failures. Ref: ${payload.after}`,
    };
  }

  if (event === 'issues' && payload.action === 'opened') {
    const issue = payload.issue;
    return {
      agent: 'jarvis',
      prompt: `New GitHub issue #${issue.number} opened in ${repo}: "${issue.title}". Triage it, label it appropriately, and route to the right agent. URL: ${issue.html_url}`,
    };
  }

  if (event === 'check_run' && payload.check_run?.conclusion === 'failure') {
    return {
      agent: 'friday',
      prompt: `CI check failed in ${repo}: ${payload.check_run?.name}. Investigate the failure and create a fix. Commit: ${payload.check_run?.head_sha?.slice(0,8)}`,
    };
  }

  if (event === 'workflow_run' && payload.workflow_run?.conclusion === 'failure') {
    return {
      agent: 'leo',
      prompt: `GitHub Actions workflow "${payload.workflow_run?.name}" failed in ${repo}. Investigate and fix. URL: ${payload.workflow_run?.html_url}`,
    };
  }

  return null; // unhandled event
}

// ── Request router ────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Hub-Signature-256');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Rate Limiting check
  if (!rateLimiter(req)) {
    return json(res, 429, { error: 'Too many requests. Rate limit exceeded.' });
  }

  const url = new URL(req.url, `http://localhost`);
  const path = url.pathname;

  // GitHub webhook — auth via HMAC sig, not Bearer
  if (req.method === 'POST' && path === '/github') {
    const { raw, parsed } = await readBody(req);
    const sig = req.headers['x-hub-signature-256'] || '';
    if (!GH_SECRET || !verifyGitHubSig(raw, sig)) {
      return json(res, 401, { error: 'Invalid GitHub webhook signature' });
    }
    const event = req.headers['x-github-event'] || '';
    const route = routeGitHubEvent(event, parsed);
    if (!route) return json(res, 200, { status: 'ignored', event });

    const run = await spawnAgent(route.agent, route.prompt, HOME);
    if (run.skipped) {
      console.log(`[github] ${event} → ${route.agent} SKIPPED (${run.reason})`);
      return json(res, 200, { status: 'skipped', ...run, agent: route.agent, event });
    }
    console.log(`[github] ${event} → ${route.agent} id=${run.shortId || run.logId}`);
    return json(res, 200, { status: 'dispatched', ...run, agent: route.agent, event });
  }

  // All other routes need Bearer auth
  if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized — use Authorization: Bearer <key>' });

  // GET / — status
  if (req.method === 'GET' && path === '/') {
    return json(res, 200, {
      status: 'ok', version: '1.0.0',
      daemon: readJSON(`${HOME}/.claude/daemon.status.json`),
      sessions: getSessions().length,
    });
  }

  // GET /panel — mobile control panel
  if (req.method === 'GET' && path === '/panel') {
    return html(res, panelHTML(SECRET));
  }

  // GET /repos — list spawnable repos
  if (req.method === 'GET' && path === '/repos') {
    const knownRepos = loadKnownRepos();
    const repos = (knownRepos.repos || []).map(r => ({
      slug: r.slug,
      path: r.path,
      primary_cli: r.primary_cli || 'claude',
      description: r.description || ''
    }));
    return json(res, 200, { repos });
  }

  // GET /sessions — live from claude agents --json + agy sessions from registry
  if (req.method === 'GET' && path === '/sessions') {
    const claudeSessions = await getActiveSessions();
    const roster = getSessions(); // from roster.json as fallback
    const sessions = claudeSessions.length ? claudeSessions : roster;

    // Add agy sessions from registry
    const allSessions = [...sessions];
    const registrySessions = registry.getSessions();
    const agySessions = registrySessions.filter(s => s.harness === 'agy');
    allSessions.push(...agySessions);

    return json(res, 200, { sessions: allSessions, source: claudeSessions.length ? 'cli+registry' : 'roster+registry' });
  }

  // GET /cost
  if (req.method === 'GET' && path === '/cost') {
    return json(res, 200, getCostSummary());
  }

  // GET /runs
  if (req.method === 'GET' && path === '/runs') {
    return json(res, 200, { runs: getRecentRuns() });
  }

  // GET /log/:id — uses claude logs <id> for bg sessions, file fallback
  if (req.method === 'GET' && path.startsWith('/log/')) {
    const id = path.slice(5).replace(/[^a-z0-9_\-]/gi, '');
    auditLog('view_log', req, { id });
    
    // Check if session exists in registry and has a logPath
    const session = registry.getSession(id);
    if (session && session.logPath) {
      if (existsSync(session.logPath)) {
        const content = readFileSync(session.logPath, 'utf8');
        const last = content.split('\n').slice(-100).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(last);
      }
    }

    // Try as a background session short-id first
    if (/^[a-f0-9]{8}$/.test(id)) {
      const output = await getAgentLog(id);
      if (output) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(output);
      }
    }
    // Fallback: file-based log
    const logFile = `${LOG_DIR}/${id}.log`;
    if (!existsSync(logFile)) return json(res, 404, { error: 'Log not found' });
    const content = readFileSync(logFile, 'utf8');
    const last = content.split('\n').slice(-100).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(last);
  }

  // POST /run — supports two request formats:
  //   1. NEW (Mission Control): { harness: "claude"|"agy", prompt, repo, agent?, model? }
  //   2. LEGACY (panel): { agent, prompt, cwd? }
  if (req.method === 'POST' && path === '/run') {
    const { parsed } = await readBody(req);
    
    auditLog('run_session', req, {
      harness: parsed.harness || 'claude',
      repo: parsed.repo || 'unknown',
      agent: parsed.agent || null,
      model: parsed.model || null
    });

    // Detect which format based on presence of 'harness' or 'repo' fields
    const isMissionControlFormat = parsed.harness || parsed.repo;

    if (isMissionControlFormat) {
      // NEW FORMAT: Mission Control dispatch
      const { harness, prompt, repo, agent = null, model = null } = parsed;

      // Validate required fields
      if (!harness) return json(res, 400, { error: 'harness required (claude or agy)' });
      if (!prompt) return json(res, 400, { error: 'prompt required' });
      if (!repo) return json(res, 400, { error: 'repo required (slug from allowlist)' });

      if (!['claude', 'agy'].includes(harness)) {
        return json(res, 400, { error: `Unknown harness "${harness}". Valid: claude, agy` });
      }

      // Validate repo against allowlist
      const knownRepos = loadKnownRepos();
      let repoPath;
      try {
        const validated = validateRepo(repo, knownRepos);
        repoPath = validated.path;
      } catch (e) {
        return json(res, 403, { error: e.message });
      }

      // CONCURRENCY CAP: Enforce max 1 concurrent session per harness (CEO requirement)
      // See https://github.com/Zene8/AgentSystem/issues/95 — autonomy constraints
      const running = registry.getRunning().filter(s => s.harness === harness);
      if (running.length > 0) {
        return json(res, 409, {
          error: `${harness} harness already running`,
          running: running[0],
          message: 'Max 1 concurrent session per harness. Wait for current session to complete.',
        });
      }

      // Create session registry entry
      const sessionRecord = registry.createSession({
        harness,
        repo,
        prompt,
        agent: harness === 'claude' ? agent : null,
        model: harness === 'agy' ? model : null,
      });

      try {
        let dispatchResult;
        if (harness === 'claude') {
          // Dispatch claude agent
          if (!agent) {
            registry.exitSession(sessionRecord.id, 1);
            return json(res, 400, { error: 'agent required for claude harness' });
          }
          const validAgents = ['jarvis','friday','sam','nat','ultron','pym','leo','astra','wanda','threepio','r2d2'];
          if (!validAgents.includes(agent.toLowerCase())) {
            registry.exitSession(sessionRecord.id, 1);
            return json(res, 400, { error: `Unknown agent: ${agent}` });
          }
          dispatchResult = await dispatchClaude(agent.toLowerCase(), prompt, repoPath);
        } else {
          // Dispatch agy
          dispatchResult = await dispatchAgy(prompt, repoPath, model);
        }

        // Update registry with dispatch result
        if (dispatchResult.sessionId) {
          registry.updateSession(sessionRecord.id, {
            status: 'running',
            logPath: dispatchResult.logPath || dispatchResult.logFile || null,
            harnessSessionId: dispatchResult.sessionId,
            tmuxSession: dispatchResult.tmuxSession || null,
            pid: dispatchResult.pid || null
          });
        } else {
          registry.exitSession(sessionRecord.id, dispatchResult.exitCode || 1);
        }

        console.log(`[mc-${harness}] repo=${repo} id=${sessionRecord.id} prompt="${prompt.slice(0, 60)}"`);
        return json(res, 202, {
          id: sessionRecord.id,
          harness,
          repo,
          status: dispatchResult.status || 'running',
          spawnedAt: sessionRecord.spawnedAt,
          logUrl: `http://localhost:${PORT}/log/${sessionRecord.id}`,
        });
      } catch (e) {
        registry.exitSession(sessionRecord.id, 1);
        console.error(`[mc-${harness}] dispatch error:`, e.message);
        return json(res, 500, { error: `Dispatch failed: ${e.message}` });
      }
    } else {
      // LEGACY FORMAT: Panel dispatch (backward compat)
      const { agent = 'jarvis', prompt, cwd = HOME } = parsed;
      if (!prompt) return json(res, 400, { error: 'prompt required' });

      const validAgents = ['jarvis','friday','sam','nat','ultron','pym','leo','astra','wanda','threepio','r2d2'];
      if (!validAgents.includes(agent.toLowerCase())) {
        return json(res, 400, { error: `Unknown agent. Valid: ${validAgents.join(', ')}` });
      }

      const run = await spawnAgent(agent.toLowerCase(), prompt, cwd);
      if (run.skipped) {
        console.log(`[run-legacy] ${agent} SKIPPED (${run.reason}) prompt="${prompt.slice(0, 60)}"`);
        return json(res, 429, { status: 'skipped', agent, reason: run.reason, active: run.active, cap: run.cap });
      }
      console.log(`[run-legacy] ${agent} id=${run.shortId || run.logId} prompt="${prompt.slice(0, 60)}"`);
      return json(res, 200, { status: 'dispatched', agent, shortId: run.shortId, logId: run.logId,
        monitor: run.shortId ? `claude attach ${run.shortId}` : null });
    }
  }

  // GET /health — health status
  if (req.method === 'GET' && path === '/health') {
    const runningSessions = registry.getRunning();
    return json(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      daemon: readJSON(`${HOME}/.claude/daemon.status.json`) || { status: 'unknown' },
      active_sessions: runningSessions.length,
      platform: process.platform,
      node_version: process.version,
    });
  }

  // POST /stop — stop/kill a running session
  if (req.method === 'POST' && path === '/stop') {
    const { parsed } = await readBody(req);
    const { id } = parsed;
    if (!id) return json(res, 400, { error: 'id required' });

    auditLog('stop_session', req, { id });

    const session = registry.getSession(id);
    if (!session) return json(res, 404, { error: 'Session not found' });
    if (session.status !== 'running' && session.status !== 'spawning') {
      return json(res, 400, { error: `Session is not running (status: ${session.status})` });
    }

    try {
      if (session.harness === 'claude') {
        const shortId = session.harnessSessionId;
        if (shortId && /^[a-f0-9]{8}$/.test(shortId)) {
          const child = spawn(CLAUDE, ['stop', shortId], { env: { ...process.env, HOME } });
          child.on('close', (code) => {
            registry.exitSession(id, code || 0);
            return json(res, 200, { status: 'stopped', id });
          });
          child.on('error', (err) => {
            return json(res, 500, { error: `Failed to stop agent: ${err.message}` });
          });
        } else {
          registry.exitSession(id, 0);
          return json(res, 200, { status: 'stopped', id, warning: 'No active background ID to stop' });
        }
      } else if (session.harness === 'agy') {
        const tmuxName = session.tmuxSession;
        if (tmuxName) {
          const { stopAgyPersistent } = await import('./agy-persistence.js');
          const result = await stopAgyPersistent({ tmuxSessionName: tmuxName });
          registry.exitSession(id, result.exitCode || 0);
          return json(res, 200, { status: 'stopped', id });
        } else if (session.pid) {
          try {
            process.kill(session.pid, 'SIGTERM');
          } catch {}
          registry.exitSession(id, 0);
          return json(res, 200, { status: 'stopped', id });
        } else {
          registry.exitSession(id, 0);
          return json(res, 200, { status: 'stopped', id });
        }
      }
    } catch (e) {
      return json(res, 500, { error: `Failed to stop session: ${e.message}` });
    }
    return;
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`\nClaude Remote Control Server`);
  console.log(`  Local:   http://${HOST}:${PORT}`);
  console.log(`  WSL:     http://172.22.131.86:${PORT}`);
  console.log(`  Windows: http://172.22.128.1:${PORT} (after port forward)`);
  console.log(`  Panel:   http://${HOST}:${PORT}/panel?key=<key>`);
  console.log(`  Key:     ${SECRET.slice(0,8)}...${SECRET.slice(-4)}\n`);
});

server.on('error', err => { console.error('Server error:', err); process.exit(1); });
