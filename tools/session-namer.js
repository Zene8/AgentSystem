#!/usr/bin/env node
/**
 * session-namer.js — Auto-name, search, group, and resume Claude Code sessions.
 *
 * Session name format: [repo] [5-word title] [YYYY-MM-DD]
 * Registry: ~/agent-memory/nexus/session-registry.jsonl
 *
 * Usage:
 *   node session-namer.js --register --session=ID [--cwd=PATH]
 *   node session-namer.js --finalize --session=ID
 *   node session-namer.js --scan
 *   node session-namer.js --list [--repo=NAME] [--date=YYYY-MM-DD] [--limit=N]
 *   node session-namer.js --search QUERY
 *   node session-namer.js --group [--by=repo|date]
 *   node session-namer.js --resume SESSION_ID
 *   node session-namer.js --today
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const HOME         = homedir();
const REGISTRY     = join(HOME, 'agent-memory', 'nexus', 'session-registry.jsonl');
const PROJECTS_DIR = join(HOME, '.claude', 'projects');

// Stop words stripped when building the 5-word title
const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'in','on','at','to','for','of','and','or','but','with','from',
  'how','what','why','when','where','which','who',
  'please','can','could','would','should','will','do','did','does',
  'i','you','we','me','my','your','our','it','its',
  'this','that','these','those','just','really','very','also',
  'need','want','make','get','use','have','has','had','let',
  'help','add','fix','run','new','old','up','out','so','then',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureRegistry() {
  mkdirSync(join(HOME, 'agent-memory', 'nexus'), { recursive: true });
  if (!existsSync(REGISTRY)) writeFileSync(REGISTRY, '', 'utf8');
}

function loadRegistry() {
  ensureRegistry();
  return readFileSync(REGISTRY, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function saveEntry(entry) {
  ensureRegistry();
  const lines = readFileSync(REGISTRY, 'utf8').split('\n').filter(Boolean);
  const idx   = lines.findIndex(l => {
    try { return JSON.parse(l).session === entry.session; } catch { return false; }
  });
  if (idx >= 0) lines[idx] = JSON.stringify(entry);
  else lines.push(JSON.stringify(entry));
  writeFileSync(REGISTRY, lines.join('\n') + '\n', 'utf8');
}

/** /home/natha/dev/AgentSystem → agentsystem */
function repoFromCwd(cwd) {
  if (!cwd) return 'unknown';
  const base = basename(cwd).replace(/^\./, '').toLowerCase();
  return base || 'root';
}

/** cwd → Claude Code project dir name (/ → -) */
function cwdToProjectDir(cwd) {
  return cwd.replace(/\//g, '-');
}

/** Extract 5 significant words from free text */
function titleFromText(text) {
  if (!text || typeof text !== 'string') return 'untitled session';
  const words = text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, '')   // strip code fences
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return words.slice(0, 5).join(' ') || 'untitled session';
}

function dateStr(ts) { return (ts || new Date().toISOString()).slice(0, 10); }
function today()     { return new Date().toISOString().slice(0, 10); }
function buildName(repo, title, ts) { return `${repo} ${title} ${dateStr(ts)}`; }

// ── Read first user message from session JSONL ───────────────────────────────

async function readFirstUserMessage(sessionId, cwd) {
  let projectDir = null;

  if (cwd) {
    const candidate = join(PROJECTS_DIR, cwdToProjectDir(cwd));
    if (existsSync(candidate)) projectDir = candidate;
  }

  if (!projectDir) {
    for (const dir of readdirSync(PROJECTS_DIR)) {
      const f = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      if (existsSync(f)) { projectDir = join(PROJECTS_DIR, dir); break; }
    }
  }

  if (!projectDir) return null;
  const filePath = join(projectDir, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return null;

  return new Promise(resolve => {
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    let found = null;
    rl.on('line', line => {
      if (found) return;
      try {
        const obj = JSON.parse(line);
        if (
          obj.type === 'user' &&
          obj.origin?.kind === 'human' &&
          obj.promptSource === 'typed' &&
          typeof obj.message?.content === 'string' &&
          obj.message.content.trim().length > 0
        ) {
          found = { text: obj.message.content.trim(), ts: obj.timestamp, cwd: obj.cwd };
          rl.close();
        }
      } catch { /* skip malformed lines */ }
    });
    rl.on('close', () => resolve(found));
    rl.on('error',  () => resolve(null));
  });
}

// ── Commands ─────────────────────────────────────────────────────────────────

function cmdRegister({ session, cwd }) {
  if (!session) { console.error('--session required'); process.exit(1); }
  const repo  = repoFromCwd(cwd);
  const ts    = new Date().toISOString();
  const entry = { session, repo, cwd: cwd || '', title: 'pending',
                  name: buildName(repo, 'pending', ts), timestamp: ts, finalized: false };
  saveEntry(entry);
}

async function cmdFinalize({ session }) {
  if (!session) { console.error('--session required'); process.exit(1); }
  const existing = loadRegistry().find(e => e.session === session)
                || { session, repo: 'unknown', cwd: '' };

  const msg = await readFirstUserMessage(session, existing.cwd);
  if (!msg) {
    saveEntry({ ...existing, finalized: true });
    return;
  }

  const title = titleFromText(msg.text);
  const repo  = existing.repo !== 'unknown' ? existing.repo : repoFromCwd(msg.cwd);
  const name  = buildName(repo, title, msg.ts || existing.timestamp);
  const updated = { ...existing, repo, cwd: msg.cwd || existing.cwd, title, name,
                    timestamp: msg.ts || existing.timestamp,
                    finalized: true, first_prompt: msg.text.slice(0, 120) };
  saveEntry(updated);
  console.log(`[session-namer] ${session.slice(0, 8)}… → "${name}"`);
}

function cmdList({ repo, date, limit }) {
  let rows = loadRegistry();
  if (repo)  rows = rows.filter(e => e.repo.toLowerCase().includes(repo.toLowerCase()));
  if (date)  rows = rows.filter(e => dateStr(e.timestamp) === date);
  rows.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  if (limit) rows = rows.slice(0, parseInt(limit, 10));

  if (!rows.length) { console.log('No sessions found.'); return; }

  const w = Math.min(55, Math.max(20, ...rows.map(r => (r.name || '').length)));
  console.log(`${'SESSION'.padEnd(8)}  ${'NAME'.padEnd(w)}  FIRST PROMPT`);
  console.log('─'.repeat(8 + w + 50));
  for (const r of rows) {
    const preview = (r.first_prompt || r.title || '').replace(/\n/g, ' ').slice(0, 40);
    console.log(`${(r.session || '').slice(0, 8)}  ${(r.name || '').padEnd(w)}  ${preview}`);
  }
}

function cmdSearch(query) {
  if (!query) { console.error('query required'); process.exit(1); }
  const q = query.toLowerCase();
  const matches = loadRegistry()
    .filter(e =>
      e.name?.toLowerCase().includes(q) ||
      e.repo?.toLowerCase().includes(q) ||
      e.title?.toLowerCase().includes(q) ||
      e.first_prompt?.toLowerCase().includes(q) ||
      e.session?.startsWith(q)
    )
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  if (!matches.length) { console.log(`No matches for "${query}"`); return; }
  console.log(`${matches.length} session(s) matching "${query}":\n`);
  for (const r of matches) {
    const projectDirName = r.cwd ? cwdToProjectDir(r.cwd) : null;
    const transcript     = projectDirName
      ? join(PROJECTS_DIR, projectDirName, `${r.session}.jsonl`) : null;
    console.log(`  ${r.session}`);
    console.log(`  Name  : ${r.name}`);
    console.log(`  Date  : ${dateStr(r.timestamp)}  Repo: ${r.repo}`);
    if (r.first_prompt) console.log(`  Prompt: ${r.first_prompt.slice(0, 80)}`);
    if (transcript)     console.log(`  Resume: claude --continue "${transcript}"`);
    console.log();
  }
}

function cmdGroup({ by }) {
  const all = loadRegistry().sort((a, b) => (b.timestamp||'').localeCompare(a.timestamp||''));

  const groupBy = by || 'repo';
  const key     = groupBy === 'date'
    ? e => dateStr(e.timestamp)
    : e => e.repo || 'unknown';

  const groups = {};
  for (const e of all) { const k = key(e); (groups[k] = groups[k] || []).push(e); }

  const sorted = Object.entries(groups).sort(([a],[b]) =>
    groupBy === 'date' ? b.localeCompare(a) : a.localeCompare(b)
  );

  for (const [label, rows] of sorted) {
    console.log(`\n── ${label} (${rows.length}) ──`);
    for (const r of rows) {
      const d = dateStr(r.timestamp);
      const t = (r.title || 'pending').slice(0, 40);
      console.log(`  ${d}  ${r.session.slice(0, 8)}…  ${t}`);
    }
  }
}

function cmdResume(sessionId) {
  if (!sessionId) { console.error('session ID required'); process.exit(1); }
  const entry = loadRegistry().find(e => e.session.startsWith(sessionId));
  if (!entry) { console.log('Not in registry — try: node session-namer.js --search ' + sessionId); return; }

  const projectDirName = entry.cwd ? cwdToProjectDir(entry.cwd) : null;
  const transcript     = projectDirName
    ? join(PROJECTS_DIR, projectDirName, `${entry.session}.jsonl`) : null;

  console.log(`Session  : ${entry.session}`);
  console.log(`Name     : ${entry.name}`);
  console.log(`Repo     : ${entry.repo}  (${entry.cwd})`);
  console.log(`Date     : ${dateStr(entry.timestamp)}`);
  if (entry.first_prompt) console.log(`Prompt   : ${entry.first_prompt.slice(0, 100)}`);
  if (transcript)         console.log(`\nResume:\n  claude --continue "${transcript}"`);
}

async function cmdScan() {
  console.log('[session-namer] scanning ~/.claude/projects/ ...');
  let registered = 0; let named = 0;
  for (const dirName of readdirSync(PROJECTS_DIR)) {
    const dirPath = join(PROJECTS_DIR, dirName);
    const cwd     = '/' + dirName.replace(/^-/, '').replace(/-/g, '/');
    const repo    = repoFromCwd(cwd);
    let files;
    try { files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl')); }
    catch { continue; }

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      if (loadRegistry().find(e => e.session === sessionId && e.finalized)) continue;
      if (!loadRegistry().find(e => e.session === sessionId)) {
        const ts = new Date().toISOString();
        saveEntry({ session: sessionId, repo, cwd, title: 'pending',
                    name: buildName(repo, 'pending', ts), timestamp: ts, finalized: false });
        registered++;
      }
      await cmdFinalize({ session: sessionId });
      named++;
    }
  }
  console.log(`[session-namer] done — registered: ${registered}, named: ${named}`);
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {}; const positional = [];
for (const arg of args) {
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    if (eq >= 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else         flags[arg.slice(2)]      = true;
  } else positional.push(arg);
}

(async () => {
  if      (flags.register)              cmdRegister({ session: flags.session, cwd: flags.cwd || process.env.CWD || process.cwd() });
  else if (flags.finalize)              await cmdFinalize({ session: flags.session });
  else if (flags.scan)                  { await cmdScan(); await cmdScanAgy(); }
  else if (flags.list)                  cmdList({ repo: flags.repo, date: flags.date, limit: flags.limit });
  else if (flags.search || positional.length && !flags.group)
                                        cmdSearch(flags.search !== true ? flags.search : positional.join(' '));
  else if (flags.group)                 cmdGroup({ by: flags.by });
  else if (flags.resume)                cmdResume(flags.resume !== true ? flags.resume : positional[0]);
  else if (flags.today)                 cmdList({ date: today() });
  else {
    console.log(`session-namer.js — Claude Code session naming & search

Commands:
  --register --session=ID [--cwd=PATH]   Register session on start (hook)
  --finalize --session=ID                Name session from first prompt (hook)
  --scan                                 Retroactively name all sessions
  --list [--repo=X] [--date=YYYY-MM-DD] [--limit=N]
  --today                                Today's sessions
  --search QUERY                         Search by name, repo, prompt
  --group [--by=repo|date]               Grouped view
  --resume SESSION_ID                    Show info + resume command

Registry: ${REGISTRY}
`);
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// Antigravity CLI (agy) support
// Transcripts: ~/.gemini/antigravity-cli/brain/[session-id]/.system_generated/logs/transcript.jsonl
// Format: { source: "USER_EXPLICIT", type: "USER_INPUT", created_at, content: "<USER_REQUEST>text</USER_REQUEST>..." }
// cwd map: ~/.gemini/antigravity-cli/cache/last_conversations.json  (cwd → latest-session-id)
// history: ~/.gemini/antigravity-cli/history.jsonl  (timestamp ms, workspace, display)
// ═══════════════════════════════════════════════════════════════════════════

const AGY_BRAIN_DIR    = join(HOME, '.gemini', 'antigravity-cli', 'brain');
const AGY_LAST_CONV    = join(HOME, '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json');
const AGY_HISTORY      = join(HOME, '.gemini', 'antigravity-cli', 'history.jsonl');

/** Build session-id → cwd map for agy sessions */
function buildAgyCwdMap() {
  const map = new Map();   // session-id → cwd

  // 1. Invert last_conversations.json (cwd → latest-session-id)
  if (existsSync(AGY_LAST_CONV)) {
    try {
      const lc = JSON.parse(readFileSync(AGY_LAST_CONV, 'utf8'));
      for (const [cwd, sid] of Object.entries(lc)) map.set(sid, cwd);
    } catch { /* ignore */ }
  }

  // 2. Timestamp correlation via history.jsonl for unmapped sessions
  let histEntries = [];
  if (existsSync(AGY_HISTORY)) {
    try {
      histEntries = readFileSync(AGY_HISTORY, 'utf8')
        .split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(e => e && e.timestamp && e.workspace);
    } catch { /* ignore */ }
  }

  if (histEntries.length && existsSync(AGY_BRAIN_DIR)) {
    for (const dir of readdirSync(AGY_BRAIN_DIR)) {
      if (map.has(dir)) continue;   // already mapped
      const transcript = join(AGY_BRAIN_DIR, dir, '.system_generated', 'logs', 'transcript.jsonl');
      if (!existsSync(transcript)) continue;

      // Get first message ISO timestamp, convert to epoch ms
      try {
        const firstLine = readFileSync(transcript, 'utf8').split('\n').find(l => l.trim());
        if (!firstLine) continue;
        const firstMs = Date.parse(JSON.parse(firstLine).created_at);
        if (!firstMs) continue;

        // Find history entries within ±5 min of session start
        const WINDOW = 5 * 60 * 1000;
        const nearby = histEntries.filter(e => Math.abs(e.timestamp - firstMs) < WINDOW);
        if (!nearby.length) continue;

        // Most common workspace in that window
        const freq = {};
        for (const e of nearby) freq[e.workspace] = (freq[e.workspace] || 0) + 1;
        const best = Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0];
        map.set(dir, best);
      } catch { /* skip */ }
    }
  }

  return map;
}

/** Strip <USER_REQUEST>...</USER_REQUEST> and metadata XML tags from agy content */
function extractAgyUserText(content) {
  if (!content) return '';
  const m = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  return m ? m[1].trim() : content.replace(/<[^>]+>/g, ' ').trim();
}

/** Read first typed user message from an agy transcript */
async function readFirstAgyMessage(brainDir) {
  const transcript = join(brainDir, '.system_generated', 'logs', 'transcript.jsonl');
  if (!existsSync(transcript)) return null;

  return new Promise(resolve => {
    const rl = createInterface({ input: createReadStream(transcript), crlfDelay: Infinity });
    let found = null;
    rl.on('line', line => {
      if (found) return;
      try {
        const obj = JSON.parse(line);
        if (
          obj.source === 'USER_EXPLICIT' &&
          obj.type   === 'USER_INPUT' &&
          obj.content
        ) {
          const text = extractAgyUserText(obj.content);
          if (text.length > 0) {
            found = { text, ts: obj.created_at };
            rl.close();
          }
        }
      } catch { /* skip */ }
    });
    rl.on('close', () => resolve(found));
    rl.on('error',  () => resolve(null));
  });
}

/** Scan all agy brain dirs and register sessions */
async function cmdScanAgy() {
  if (!existsSync(AGY_BRAIN_DIR)) {
    console.log('[session-namer] agy: brain dir not found, skipping');
    return;
  }

  const cwdMap = buildAgyCwdMap();
  let registered = 0; let named = 0;
  const dirs = readdirSync(AGY_BRAIN_DIR);

  for (const sessionId of dirs) {
    const brainDir = join(AGY_BRAIN_DIR, sessionId);
    const existing = loadRegistry().find(e => e.session === sessionId);
    if (existing?.finalized) continue;

    const cwd  = cwdMap.get(sessionId) || '';
    const repo = repoFromCwd(cwd) || 'agy';

    const msg = await readFirstAgyMessage(brainDir);
    const ts  = msg?.ts || new Date().toISOString();

    if (!existing) {
      saveEntry({ session: sessionId, repo, cwd, title: 'pending',
                  name: buildName(repo, 'pending', ts),
                  timestamp: ts, finalized: false, runtime: 'agy' });
      registered++;
    }

    if (msg) {
      const title = titleFromText(msg.text);
      const name  = buildName(repo, title, msg.ts || ts);
      const prev  = loadRegistry().find(e => e.session === sessionId) || {};
      saveEntry({ ...prev, session: sessionId, repo, cwd, title, name,
                  timestamp: msg.ts || ts, finalized: true,
                  first_prompt: msg.text.slice(0, 120), runtime: 'agy' });
      console.log(`[session-namer][agy] ${sessionId.slice(0,8)}… → "${name}"`);
      named++;
    } else {
      const prev = loadRegistry().find(e => e.session === sessionId) || {};
      saveEntry({ ...prev, session: sessionId, repo, cwd, finalized: true, runtime: 'agy' });
    }
  }

  console.log(`[session-namer][agy] done — registered: ${registered}, named: ${named}`);
}
