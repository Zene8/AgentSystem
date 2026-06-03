#!/usr/bin/env node
// memory-maintenance.js — the "sleep cycle". Runs the full memory maintenance pass.
// Wired two ways: (1) SessionStart hook with --if-stale (run-on-use), (2) scheduled cron.
// Steps: split → reconsolidate → decay → stale-prune → consolidate → agent-brain-seed.
// Reflection (LLM, slow) only with --reflect. Each step is non-fatal; failures are logged.
// Usage: node tools/memory-maintenance.js [--if-stale=DAYS] [--reflect] [--quiet]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { agentMemoryRoot } from './graph/graph-lib.js';

// Pure: should maintenance run? True if never run, or last run older than `days`.
export function isStale(lastRunIso, days, now = Date.now()) {
  if (!days || days <= 0) return true;
  if (!lastRunIso) return true;
  const last = new Date(lastRunIso).getTime();
  if (!Number.isFinite(last)) return true;
  return (now - last) >= days * 24 * 60 * 60 * 1000;
}

const toolsDir = dirname(fileURLToPath(import.meta.url));
const nexus = join(agentMemoryRoot(), 'nexus');
const pbPath = join(nexus, 'personal-brain');

function step(name, file, args, quiet) {
  try {
    const out = execFileSync('node', [join(toolsDir, file), ...args], { encoding: 'utf8', timeout: 180000 });
    if (!quiet) console.log(`  ✓ ${name}`);
    return { name, ok: true, out };
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message.split('\n')[0]}`);
    return { name, ok: false };
  }
}

export function runMaintenance({ reflect = false, quiet = false } = {}) {
  const results = [];
  results.push(step('split', 'personal-brain-split.js', [], quiet));
  results.push(step('reconsolidate', 'memory-reconsolidate.js', [`--brain-path=${pbPath}`], quiet));
  results.push(step('decay', 'memory-decay.js', ['--brain=personal-brain'], quiet));
  results.push(step('stale-prune', 'memory-stale.js', ['--brain=personal-brain', '--fix'], quiet));
  results.push(step('consolidate', 'graph/graph-consolidate.js', ['personal-brain', `--brain-path=${pbPath}`], quiet));
  results.push(step('agent-brain-seed', 'agent-brain-seed.js', ['--all'], quiet));
  if (reflect) results.push(step('reflect', 'memory-reflect.js', [], quiet));
  return results;
}

const isMain = process.argv[1] &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const flags = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] ?? true;
  }
  const quiet = !!flags.quiet;
  const stampPath = join(nexus, '.last-maintenance');
  const lastRun = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : null;
  const days = flags['if-stale'] ? parseFloat(flags['if-stale']) : 0;

  if (days && !isStale(lastRun, days)) {
    if (!quiet) console.log(`memory-maintenance: skipped (last run ${lastRun}, < ${days}d ago)`);
    process.exit(0);
  }

  // Claim the run BEFORE working: stamp first so a second session started close behind
  // sees not-stale and skips, avoiding concurrent whole-file writeGraph on live brain data.
  writeFileSync(stampPath, new Date().toISOString(), 'utf8');
  if (!quiet) console.log('memory-maintenance: running sleep cycle');
  const results = runMaintenance({ reflect: !!flags.reflect, quiet });
  const okCount = results.filter(r => r.ok).length;
  if (!quiet) console.log(`memory-maintenance: ${okCount}/${results.length} steps ok`);
}
