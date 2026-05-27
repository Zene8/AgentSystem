#!/usr/bin/env node
// migrate-memory.js — migrate agent memory from ~/.claude/agent-memory/ to ~/agent-memory/
// Run once after upgrading to cross-CLI shared memory path.
// Idempotent — safe to re-run. Does not delete source files.
//
// Usage: node tools/migrate-memory.js [--dry-run]

import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { agentMemoryRoot } from './graph/graph-lib.js';

const dryRun = process.argv.includes('--dry-run');
const src = join(homedir(), '.claude', 'agent-memory');
const dst = agentMemoryRoot();

if (!existsSync(src)) {
  console.log(`Nothing to migrate — ${src} does not exist.`);
  process.exit(0);
}

if (src === dst) {
  console.log(`Source and destination are the same (${src}). Nothing to do.`);
  process.exit(0);
}

let copied = 0;
let skipped = 0;

function copyRecursive(srcDir, dstDir) {
  if (!existsSync(dstDir)) {
    if (!dryRun) mkdirSync(dstDir, { recursive: true });
    console.log(`  mkdir ${dstDir}`);
  }
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, dstPath);
    } else {
      if (existsSync(dstPath)) {
        skipped++;
      } else {
        console.log(`  copy ${relative(homedir(), srcPath)} → ${relative(homedir(), dstPath)}`);
        if (!dryRun) copyFileSync(srcPath, dstPath);
        copied++;
      }
    }
  }
}

console.log(`migrate-memory: ${src} → ${dst}${dryRun ? ' (DRY RUN)' : ''}\n`);
copyRecursive(src, dst);
console.log(`\nDone. Copied: ${copied}, Skipped (already exist): ${skipped}`);
if (dryRun) console.log('Re-run without --dry-run to apply.');
else console.log(`Source files at ${src} preserved. Remove manually if desired.`);
