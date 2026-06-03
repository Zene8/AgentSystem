#!/usr/bin/env node
// brain-remember.js — agent-driven write-back (MemGPT-style self-edit).
// Agents call this when they learn a durable fact about the user.
// Appends the fact to user-brain.md under a section, dedups, then re-splits to graph nodes.
// Usage: node tools/brain-remember.js --fact="..." [--section="Session Notes"]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentMemoryRoot } from './graph/graph-lib.js';
import { splitPersonalBrain } from './personal-brain-split.js';
import { reconcileFact, defaultLlm } from './memory-reconcile.js';

// Pure: insert a fact bullet under `section` in markdown `raw`.
// Dedup: skips if the same fact text already exists (case-insensitive). Creates section if missing.
// Returns { md, added }.
export function appendFactToBrain(raw, fact, section = 'Session Notes') {
  const clean = fact.replace(/^[-*]\s*/, '').trim();
  if (!clean) return { md: raw, added: false };
  const bullet = `- ${clean}`;

  const lines = raw.split('\n');
  const norm = s => s.replace(/^[-*]\s*/, '').trim().toLowerCase();
  if (lines.some(l => norm(l) === norm(bullet))) return { md: raw, added: false };

  const headerIdx = lines.findIndex(l => {
    const m = l.match(/^#{1,3}\s+(.+?)\s*$/);
    return m && m[1].toLowerCase() === section.toLowerCase();
  });

  if (headerIdx === -1) {
    const tail = raw.endsWith('\n') ? '' : '\n';
    return { md: `${raw}${tail}\n## ${section}\n\n${bullet}\n`, added: true };
  }

  // Find insertion point: last non-empty line before the next header (or EOF).
  let end = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^#{1,3}\s+/.test(lines[i])) { end = i; break; }
  }
  let insertAt = headerIdx + 1;
  for (let i = headerIdx + 1; i < end; i++) {
    if (lines[i].trim() !== '') insertAt = i + 1;
  }
  lines.splice(insertAt, 0, bullet);
  return { md: lines.join('\n'), added: true };
}

export function remember({ fact, section = 'Session Notes', llm } = {}) {
  if (!fact) return { ok: false, message: 'no fact provided', added: false };
  const brainPath = join(agentMemoryRoot(), 'nexus', 'personal-brain', 'user-brain.md');
  if (!existsSync(brainPath)) return { ok: false, message: 'user-brain.md not found', added: false };

  const raw = readFileSync(brainPath, 'utf8');
  const { md, action, supersededText } = reconcileFact(raw, fact, section, { llm: llm ?? defaultLlm });
  if (action === 'NOOP') return { ok: true, added: false, action: 'NOOP', message: 'already known (deduped)' };

  writeFileSync(brainPath, md, 'utf8');
  const split = splitPersonalBrain();
  return { ok: true, added: true, action, section, supersededText, split };
}

const isMain = process.argv[1] &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const args = process.argv.slice(2);
  const flags = {};
  for (const a of args) {
    const m = a.match(/^--([\w-]+)=(.*)$/);
    if (m) flags[m[1]] = m[2];
  }
  if (!flags.fact) { console.error('Usage: brain-remember.js --fact="..." [--section="..."]'); process.exit(1); }
  const r = remember({ fact: flags.fact, section: flags.section });
  if (!r.ok) { console.error(`brain-remember: ${r.message}`); process.exit(1); }
  console.log(r.added ? `remembered → [${r.section}]: ${flags.fact}` : `brain-remember: ${r.message}`);
}
