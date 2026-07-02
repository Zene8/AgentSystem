#!/usr/bin/env node
/**
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
import { readFileSync, existsSync, openSync, closeSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SessionRegistry } from './session-registry.js';
import { validateRepo } from './repo-validator.js';
import { spawnAgyOneShotDirect, spawnAgyPersistent } from './agy-dispatcher.js';

const HOME      = homedir();
const KEY_FILE  = `${HOME}/.claude/remote-webhook.key`;
const ROSTER    = `${HOME}/.claude/daemon/roster.json`;
const CLAUDE    = `${HOME}/.local/bin/claude`;
const LOG_DIR   = `${HOME}/.claude/agent-runs`;
const COST_LOG  = `${HOME}/agent-memory/nexus/session-log.jsonl`;
const KNOWN_REPOS_FILE = `${HOME}/agent-memory/nexus/known-repos.json`;
const MC_REGISTRY_FILE = `${HOME}/.claude/mission-control-registry.json`;
const PORT      = parseInt(process.env.PORT || '8765');
const GH_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

const SECRET = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : null;
if (!SECRET) { console.error('No ~/.claude/remote-webhook.key found'); process.exit(1); }

mkdirSync(LOG_DIR, { recursive: true });

// Initialize Mission Control registry (for both claude + agy sessions)
const registry = new SessionRegistry(MC_REGISTRY_FILE);

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

function spawnAgent(agent, prompt, cwd = HOME) {
  return new Promise((resolve) => {
    const ts = Date.now();
    const logFile = `${LOG_DIR}/${ts}-${agent}.log`;

    // Use --bg for proper daemon-managed background sessions
    // stdout: "backgrounded · <8-char-id>"
    const child = spawn(CLAUDE, ['--bg', '--agent', agent, '-p', prompt], {
      cwd: existsSync(cwd) ? cwd : HOME,
      env: { ...process.env, HOME },
    });

    let stdout = '', stderr = '';
    child.stdout?.on('data', d => stdout += d);
    child.stderr?.on('data', d => stderr += d);

    child.on('close', () => {
      // Parse session short ID from "backgrounded · abc123de"
      const match = stdout.match(/backgrounded\s*[·•]\s*([a-f0-9]+)/i);
      const shortId = match?.[1] || null;
      resolve({ shortId, logFile: shortId ? null : logFile, logId: shortId || `${ts}-${agent}`, ts });
    });

    // Fallback: if spawn fails, log to file
    child.on('error', () => {
      const logFd = openSync(logFile, 'w');
      const fallback = spawn(CLAUDE, ['--agent', agent, '-p', prompt], {
        cwd: existsSync(cwd) ? cwd : HOME,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, HOME },
      });
      fallback.unref();
      closeSync(logFd);
      resolve({ shortId: null, logFile, logId: `${ts}-${agent}`, ts });
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
    // For MVP, use one-shot dispatch (direct agy invocation)
    // TODO: Switch to spawnAgyPersistent() once Leo's agy-persistence.js is available (issue #84)
    const result = await spawnAgyOneShotDirect(prompt, repoPath, model);
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
<title>Claude Agent Control</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --border:#30363d; --text:#e6edf3; --muted:#7d8590;
          --blue:#58a6ff; --green:#3fb950; --orange:#d29922; --red:#f85149; --purple:#bc8cff; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font:14px/1.5 'SF Mono',monospace;
         padding:12px; max-width:480px; margin:0 auto; }
  h1 { font-size:18px; color:var(--blue); padding:8px 0 16px; border-bottom:1px solid var(--border); margin-bottom:16px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:8px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:12px; }
  .cost { display:flex; gap:16px; }
  .cost-item { flex:1; text-align:center; }
  .cost-item .val { font-size:22px; color:var(--green); font-weight:700; }
  .cost-item .lbl { font-size:11px; color:var(--muted); }
  select, textarea, input { width:100%; background:var(--bg); color:var(--text);
    border:1px solid var(--border); border-radius:6px; padding:8px; font:inherit; margin-bottom:8px; }
  textarea { resize:vertical; min-height:80px; }
  button { width:100%; padding:10px; background:var(--blue); color:#000; border:none;
           border-radius:6px; font:600 14px/1 inherit; cursor:pointer; }
  button:active { opacity:.8; }
  button.secondary { background:var(--card); color:var(--text); border:1px solid var(--border); }
  .tag { display:inline-block; padding:2px 6px; border-radius:4px; font-size:11px;
         background:var(--border); color:var(--muted); }
  .tag.green { background:#1a3a2a; color:var(--green); }
  .tag.blue { background:#1a2a3a; color:var(--blue); }
  .session { padding:8px 0; border-bottom:1px solid var(--border); }
  .session:last-child { border:none; }
  .session .name { color:var(--purple); font-weight:600; }
  .session .meta { font-size:11px; color:var(--muted); margin-top:2px; }
  #result { font-size:12px; white-space:pre-wrap; word-break:break-all; color:var(--green);
            padding:8px; background:#0a1a0a; border:1px solid var(--border); border-radius:6px;
            display:none; margin-top:8px; max-height:200px; overflow-y:auto; }
  #result.err { color:var(--red); background:#1a0a0a; }
  .run-item { padding:6px 0; border-bottom:1px solid var(--border); font-size:12px; }
  .run-item:last-child { border:none; }
  .quick { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; }
  .quick button { padding:8px 4px; font-size:12px; }
</style>
</head>
<body>
<h1>⚡ Claude Agents</h1>

<div class="card" id="cost-card">
  <h2>Today's Spend</h2>
  <div class="cost">
    <div class="cost-item"><div class="val" id="cost-val">—</div><div class="lbl">USD today</div></div>
    <div class="cost-item"><div class="val" id="sessions-val">—</div><div class="lbl">sessions</div></div>
    <div class="cost-item"><div class="val" id="week-val">—</div><div class="lbl">USD / week</div></div>
  </div>
</div>

<div class="card">
  <h2>Quick Dispatch</h2>
  <div class="quick">
    <button class="secondary" onclick="quick('friday','Check CI status and report failures')">🔧 CI Status</button>
    <button class="secondary" onclick="quick('sam','Run security audit on latest changes')">🔒 Security</button>
    <button class="secondary" onclick="quick('friday','Review open PRs and flag blockers')">📋 PR Review</button>
    <button class="secondary" onclick="quick('jarvis','Give me a status briefing on all active work')">📊 Briefing</button>
  </div>

  <h2 style="margin-top:4px">Custom Dispatch</h2>
  <select id="agent">
    <option value="jarvis">Jarvis (CEO / Orchestrate)</option>
    <option value="friday">Friday (CTO / Engineering)</option>
    <option value="sam">Sam (CSO / Security)</option>
    <option value="nat">Nat (CBO / Business)</option>
    <option value="ultron">Ultron (Backend)</option>
    <option value="pym">Pym (Database)</option>
    <option value="leo">Leo (DevOps)</option>
    <option value="astra">Astra (Frontend)</option>
    <option value="threepio">Threepio (Docs)</option>
    <option value="r2d2">r2d2 (General)</option>
  </select>
  <textarea id="prompt" placeholder="What should the agent do?"></textarea>
  <input id="cwd" placeholder="Working directory (optional)" value="C:/Users/natha/dev">
  <button onclick="dispatch()">▶ Run Agent</button>
  <div id="result"></div>
</div>

<div class="card">
  <h2>Running Sessions <span id="session-count" class="tag green">0</span></h2>
  <div id="sessions"><div style="color:var(--muted);font-size:12px">Loading...</div></div>
</div>

<div class="card">
  <h2>Recent Runs</h2>
  <div id="runs"><div style="color:var(--muted);font-size:12px">Loading...</div></div>
</div>

<script>
const KEY = '${key}';
const BASE = '';

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    ...opts,
  });
  return r.json();
}

function quick(agent, prompt) {
  document.getElementById('agent').value = agent;
  document.getElementById('prompt').value = prompt;
  dispatch();
}

async function dispatch() {
  const agent = document.getElementById('agent').value;
  const prompt = document.getElementById('prompt').value.trim();
  const cwd = document.getElementById('cwd').value.trim();
  if (!prompt) { alert('Prompt required'); return; }

  const res = document.getElementById('result');
  res.className = ''; res.style.display = 'block';
  res.textContent = 'Dispatching...';

  try {
    const data = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ agent, prompt, cwd }),
    });
    res.textContent = JSON.stringify(data, null, 2);
    if (data.error) res.className = 'err';
    else { setTimeout(loadSessions, 1000); setTimeout(loadRuns, 1000); }
  } catch (e) {
    res.className = 'err';
    res.textContent = 'Error: ' + e.message;
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

async function loadSessions() {
  try {
    const d = await api('/sessions');
    const el = document.getElementById('sessions');
    const ct = document.getElementById('session-count');
    ct.textContent = d.sessions?.length || 0;
    if (!d.sessions?.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">No active sessions</div>'; return; }
    el.innerHTML = d.sessions.map(s =>
      '<div class="session">' +
      '<div class="name">' + s.agent + ' <span class="tag blue">PID ' + s.pid + '</span></div>' +
      '<div class="meta">' + (s.cwd || '') + ' &bull; ' + new Date(s.startedAt).toLocaleTimeString() + '</div>' +
      '</div>'
    ).join('');
  } catch {}
}

async function loadRuns() {
  try {
    const d = await api('/runs');
    const el = document.getElementById('runs');
    if (!d.runs?.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">No runs yet</div>'; return; }
    el.innerHTML = d.runs.map(r =>
      '<div class="run-item">' +
      '<span class="tag blue">' + r.agent + '</span> ' +
      new Date(r.ts).toLocaleString() +
      ' <a href="/log/' + r.id + '?key=' + KEY + '" style="color:var(--blue);text-decoration:none">→ log</a>' +
      '</div>'
    ).join('');
  } catch {}
}

// Auto-refresh every 15s
loadCost(); loadSessions(); loadRuns();
setInterval(() => { loadSessions(); loadRuns(); }, 15_000);
setInterval(loadCost, 60_000);
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
            logPath: dispatchResult.logPath || null,
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
      console.log(`[run-legacy] ${agent} id=${run.shortId || run.logId} prompt="${prompt.slice(0, 60)}"`);
      return json(res, 200, { status: 'dispatched', agent, shortId: run.shortId, logId: run.logId,
        monitor: run.shortId ? `claude attach ${run.shortId}` : null });
    }
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nClaude Remote Control Server`);
  console.log(`  Local:   http://127.0.0.1:${PORT}`);
  console.log(`  WSL:     http://172.22.131.86:${PORT}`);
  console.log(`  Windows: http://172.22.128.1:${PORT} (after port forward)`);
  console.log(`  Panel:   http://127.0.0.1:${PORT}/panel?key=<key>`);
  console.log(`  Key:     ${SECRET.slice(0,8)}...${SECRET.slice(-4)}\n`);
});

server.on('error', err => { console.error('Server error:', err); process.exit(1); });
