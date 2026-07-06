#!/usr/bin/env node
// deploy-hooks.js — sync repo runtime files to ~/.claude so fixes actually reach runtime.
// Fixes #150: hooks drift (repo fixed, installed copies stale, bugs keep firing).
//
// Usage:
//   node tools/deploy-hooks.js           # deploy: copy changed files, print per-file status
//   node tools/deploy-hooks.js --check   # dry-run: exit 1 if any drift, print drift summary
//
// Pure Node.js builtins only (repo rule for tools/).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_HOME = join(homedir(), '.claude');

// Mapping: repo source -> install destination.
// hooks/*.js and hooks/claude-hooks/*.sh -> ~/.claude/hooks/
// webhook server -> ~/.claude/remote-control-server.js
function buildManifest() {
  const manifest = [];
  const hooksDir = join(REPO, 'hooks');
  for (const f of readdirSync(hooksDir)) {
    if (f.endsWith('.js') && !f.endsWith('.test.js')) {
      manifest.push({ src: join(hooksDir, f), dest: join(CLAUDE_HOME, 'hooks', f) });
    }
  }
  const shDir = join(hooksDir, 'claude-hooks');
  if (existsSync(shDir)) {
    for (const f of readdirSync(shDir)) {
      if (f.endsWith('.sh')) {
        manifest.push({ src: join(shDir, f), dest: join(CLAUDE_HOME, 'hooks', f) });
      }
    }
  }
  const server = join(REPO, 'tools', 'mission-control', 'webhook-server.js');
  if (existsSync(server)) {
    manifest.push({ src: server, dest: join(CLAUDE_HOME, 'remote-control-server.js') });
  }
  return manifest;
}

function sha(path) {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
  catch { return null; }
}

export function diffManifest(manifest = buildManifest()) {
  const out = [];
  for (const { src, dest } of manifest) {
    const srcHash = sha(src);
    if (srcHash === null) continue;
    const destHash = sha(dest);
    out.push({
      src, dest, name: basename(src),
      status: destHash === null ? 'missing' : destHash === srcHash ? 'same' : 'drift',
    });
  }
  return out;
}

export function deploy(manifest = buildManifest()) {
  const results = diffManifest(manifest);
  for (const r of results) {
    if (r.status !== 'same') {
      mkdirSync(dirname(r.dest), { recursive: true });
      writeFileSync(r.dest, readFileSync(r.src));
      r.deployed = true;
    }
  }
  return results;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1]);
if (isMain) {
  const check = process.argv.includes('--check');
  const results = check ? diffManifest() : deploy();
  let drift = 0;
  for (const r of results) {
    if (r.status === 'same') { if (!check) continue; }
    else drift++;
    console.log(`${r.status.padEnd(7)} ${r.name}${r.deployed ? '  -> deployed' : ''}`);
  }
  if (check) {
    console.log(drift ? `\n${drift} file(s) drifted — run: node tools/deploy-hooks.js` : 'in sync');
    process.exit(drift ? 1 : 0);
  } else {
    console.log(`\n${drift ? drift + ' file(s) deployed' : 'already in sync'}`);
  }
}
