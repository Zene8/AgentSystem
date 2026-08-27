#!/usr/bin/env node
// session-bulk-rename.js — bulk-rename past Claude Code sessions with one command,
// reusing the existing haiku auto-rename machinery from
// hooks/session-auto-rename-hook.js (issue #518).
//
// Usage:
//   node tools/session-bulk-rename.js 5      # last 5 sessions by transcript mtime
//   node tools/session-bulk-rename.js -1     # all sessions
//     --dry-run   print plan, zero model calls
//     --force     ignore eligibility filter (marker / manual-rename skip)
//     --jobs=N    concurrency (default 4)
//     --yes       skip confirm for large runs (-1, or N > 25)
//
// This tool does NOT duplicate the naming prompt/parsing logic — it loads
// hooks/session-auto-rename-hook.js's exports (buildDigest, buildPrompt,
// parseNameResponse, shouldRename, findSessionNamer) via createRequire, and
// shells out to session-namer.js exactly the way the hook does. It never
// imports or restructures session-namer.js, and never edits the hook.

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { isMainModule } from './is-main.js';

const require = createRequire(import.meta.url);
const hook = require('../hooks/session-auto-rename-hook.js');
const { buildDigest, buildPrompt, parseNameResponse, shouldRename, findSessionNamer } = hook;

const HOME = process.env.SESSION_NAMER_HOME || homedir();
const PROJECTS_DIR = join(HOME, '.claude', 'projects');
const REGISTRY = join(HOME, 'agent-memory', 'nexus', 'session-registry.jsonl');
const MARKER_DIR = join(HOME, '.claude', 'cache', 'session-autorename');
const MODEL = 'claude-haiku-4-5-20251001';
const LARGE_RUN_THRESHOLD = 25;

// ── pure helpers (unit-testable, no fs/subprocess) ──────────────────────────

/**
 * selectSessions — sort sessions by mtime descending and slice to n.
 * n === -1 means "all sessions".
 */
export function selectSessions(sessions, n) {
  const sorted = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (n === -1) return sorted;
  return sorted.slice(0, n);
}

/**
 * decodeProjectDir — decode a ~/.claude/projects/<dirName> back to the
 * original cwd. Mirrors the exact one-liner in session-namer.js's cmdScan
 * (not exported upstream — duplicated verbatim per issue #518 evidence,
 * since restructuring session-namer.js is out of scope).
 */
export function decodeProjectDir(dirName) {
  return '/' + dirName.replace(/^-/, '').replace(/-/g, '/');
}

/**
 * isEligible — default eligibility filter (bypassed entirely by --force).
 * Mirrors hook's shouldRename semantics: skip when an autorename marker
 * already exists, or the registry entry is a manual (`renamed:true`, no
 * marker) rename. No entry at all (unregistered session) is eligible.
 */
export function isEligible({ entry, markerExists, force }) {
  if (force) return true;
  if (markerExists) return false;
  if (!entry) return true; // unregistered session — nothing to skip yet
  return shouldRename(entry, markerExists);
}

// ── local re-implementations of hook internals not exported (trivial) ──────
// Per issue #518 evidence: do NOT add exports to the hook for these.

function markerPath(sessionId) {
  return join(MARKER_DIR, `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);
}

function hasMarkerReal(sessionId) {
  try { return existsSync(markerPath(sessionId)); } catch { return false; }
}

function writeMarkerReal(sessionId, payload) {
  try {
    mkdirSync(MARKER_DIR, { recursive: true });
    writeFileSync(markerPath(sessionId), JSON.stringify(payload), 'utf8');
  } catch { /* marker is an optimization, not a requirement */ }
}

function getRegistryEntryReal(sessionId) {
  let raw;
  try { raw = readFileSync(REGISTRY, 'utf8'); } catch { return null; }
  let found = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj && obj.session === sessionId) found = obj;
  }
  return found;
}

// ── real fs/subprocess ops (default, overridable for tests) ─────────────────

function realRunClaude(sessionId, digest) {
  const namer = findSessionNamer();
  const candidates = [
    process.env.CLAUDE_CODE_BIN,
    join(HOME, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
  let claudeBin = 'claude';
  for (const p of candidates) {
    if (!p) continue;
    try { if (existsSync(p)) { claudeBin = p; break; } } catch { /* keep looking */ }
  }
  void namer; // namer resolution happens separately in realRunNamer
  return execFileSync(claudeBin, [
    '-p', buildPrompt(digest),
    '--model', MODEL,
    '--safe-mode',
    '--tools', '',
    '--max-turns', '1',
    '--no-session-persistence',
    '--output-format', 'text',
  ], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
}

function realRunNamer(args) {
  const namer = findSessionNamer();
  if (!namer) throw new Error('session-namer.js not found');
  return execFileSync(process.execPath, [namer, ...args], {
    encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function realReadDigest(session) {
  const transcriptPath = join(PROJECTS_DIR, session.dirName, `${session.id}.jsonl`);
  let lines;
  try { lines = readFileSync(transcriptPath, 'utf8').split('\n'); } catch { return null; }
  return buildDigest(lines);
}

function makeRealFsOps() {
  return {
    getRegistryEntry: getRegistryEntryReal,
    hasMarker: hasMarkerReal,
    writeMarker: writeMarkerReal,
    register: (session, cwd) => {
      const namer = findSessionNamer();
      if (!namer) throw new Error('session-namer.js not found');
      execFileSync(process.execPath, [
        namer, '--register', `--session=${session}`, `--cwd=${cwd}`,
      ], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    },
  };
}

// ── worker pool ──────────────────────────────────────────────────────────────

/**
 * processOne — decide eligibility, then (unless dry-run) run the naming
 * pipeline for a single session: register if unregistered, build digest, call
 * the (injected) claude runner, parse the reply, call the (injected) namer,
 * write a marker. Never throws — callers rely on the returned status.
 */
async function processOne(session, { dryRun, force, fsOps, runClaude, runNamer, readDigest }) {
  const entry = fsOps.getRegistryEntry(session.id);
  const markerExists = fsOps.hasMarker(session.id);

  if (!isEligible({ entry, markerExists, force })) {
    return { status: 'skipped', id: session.id };
  }

  if (dryRun) {
    return { status: 'planned', id: session.id };
  }

  try {
    if (!entry) {
      const cwd = session.dirName ? decodeProjectDir(session.dirName) : '';
      fsOps.register(session.id, cwd);
    }

    const digest = readDigest ? readDigest(session) : realReadDigest(session);
    if (!digest || digest.length < 40) {
      return { status: 'skipped', id: session.id, reason: 'transcript too thin' };
    }

    const stdout = runClaude(session.id, digest);
    const parsed = parseNameResponse(stdout);
    if (!parsed) {
      return { status: 'failed', id: session.id, reason: 'unparseable reply' };
    }

    runNamer(session.id, parsed.summary, parsed.status);
    fsOps.writeMarker(session.id, { session: session.id, ...parsed, at: new Date().toISOString() });
    return { status: 'renamed', id: session.id };
  } catch (err) {
    return { status: 'failed', id: session.id, reason: err && err.message };
  }
}

/** Simple bounded-concurrency worker pool. Never lets one item's rejection abort the rest. */
async function runPool(items, jobs, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(jobs, items.length || 1));

  async function runWorker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await worker(items[idx]);
      } catch (err) {
        results[idx] = { status: 'failed', id: items[idx].id, reason: err && err.message };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

/**
 * runBulkRename — the whole bulk-rename flow over an already-scanned list of
 * sessions. All fs/subprocess side effects are injected (fsOps, runClaude,
 * runNamer, readDigest) so this is fully unit-testable with zero real
 * subprocess/model calls.
 */
export async function runBulkRename({
  sessions,
  n,
  dryRun = false,
  force = false,
  jobs = 4,
  fsOps = makeRealFsOps(),
  runClaude = realRunClaude,
  runNamer = (id, summary, status) => realRunNamer(['--auto-rename', id, summary, `--status=${status}`]),
  readDigest = null,
}) {
  const selected = selectSessions(sessions, n);

  const results = await runPool(selected, jobs, (session) =>
    processOne(session, { dryRun, force, fsOps, runClaude, runNamer, readDigest })
  );

  const summary = { renamed: 0, skipped: 0, failed: 0, planned: 0, results };
  for (const r of results) {
    if (r.status === 'renamed') summary.renamed++;
    else if (r.status === 'skipped') summary.skipped++;
    else if (r.status === 'failed') summary.failed++;
    else if (r.status === 'planned') summary.planned++;
  }
  return summary;
}

// ── CLI: scanning transcripts on disk ───────────────────────────────────────

/** Walk ~/.claude/projects/ (each project dir's *.jsonl files) into { id, dirName, mtimeMs } records. */
function scanSessions() {
  let dirs = [];
  try { dirs = readdirSync(PROJECTS_DIR); } catch { return []; }

  const sessions = [];
  for (const dirName of dirs) {
    const dirPath = join(PROJECTS_DIR, dirName);
    let files;
    try { files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const file of files) {
      const filePath = join(dirPath, file);
      let mtimeMs;
      try { mtimeMs = statSync(filePath).mtimeMs; } catch { continue; }
      sessions.push({ id: file.replace(/\.jsonl$/, ''), dirName, mtimeMs });
    }
  }
  return sessions;
}

// ── CLI: confirmation prompt ─────────────────────────────────────────────────

function confirmInteractive(message) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = { dryRun: false, force: false, jobs: 4, yes: false };
  const positional = [];
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--yes') flags.yes = true;
    else if (arg.startsWith('--jobs=')) flags.jobs = parseInt(arg.slice('--jobs='.length), 10) || 4;
    else positional.push(arg);
  }
  const n = positional.length ? parseInt(positional[0], 10) : NaN;
  return { ...flags, n };
}

async function main() {
  const argv = process.argv.slice(2);
  const { n, dryRun, force, jobs, yes } = parseArgs(argv);

  if (Number.isNaN(n)) {
    console.error('Usage: node tools/session-bulk-rename.js <N|-1> [--dry-run] [--force] [--jobs=N] [--yes]');
    process.exit(1);
  }

  const sessions = scanSessions();
  const selected = selectSessions(sessions, n);

  console.log(`[session-bulk-rename] ${selected.length} session(s) selected (of ${sessions.length} total)${force ? ' — --force: eligibility filter bypassed' : ''}${dryRun ? ' — dry run' : ''}`);

  const isLargeRun = n === -1 || n > LARGE_RUN_THRESHOLD;
  if (isLargeRun && !dryRun && !yes) {
    const proceed = await confirmInteractive(
      `About to spend model calls renaming up to ${selected.length} session(s). Continue?`
    );
    if (!proceed) {
      console.log('[session-bulk-rename] aborted.');
      process.exit(1);
    }
  }

  const result = await runBulkRename({ sessions, n, dryRun, force, jobs });

  if (dryRun) {
    for (const r of result.results) console.log(`  ${r.status.padEnd(8)} ${r.id.slice(0, 8)}`);
  } else {
    for (const r of result.results) {
      if (r.status === 'failed') console.log(`  FAILED  ${r.id.slice(0, 8)} — ${r.reason || 'unknown error'}`);
    }
  }

  console.log(`[session-bulk-rename] done — renamed: ${result.renamed}, skipped: ${result.skipped}, failed: ${result.failed}${dryRun ? `, planned: ${result.planned}` : ''}`);
}

if (isMainModule(import.meta.url)) main();
