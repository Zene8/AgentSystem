#!/usr/bin/env node
// issue-close.js — close a GitHub issue ONLY if the referenced fix commit is
// reachable from origin/main. Enforces the verify-before-close routine (#151).
//
// Usage: node tools/issue-close.js <issue-number> --commit <sha> [--comment "extra text"]

import { execFileSync } from 'node:child_process';

export function commitLanded(sha, { exec = execFileSync } = {}) {
  try {
    exec('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: 'pipe' });
  } catch { /* offline — fall through to local check */ }
  try {
    exec('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

export function parseArgs(argv) {
  const issue = argv.find(a => /^\d+$/.test(a));
  const ci = argv.indexOf('--commit');
  const commit = ci !== -1 ? argv[ci + 1] : null;
  const xi = argv.indexOf('--comment');
  const extra = xi !== -1 ? argv[xi + 1] : '';
  const ni = argv.indexOf('--not-planned');
  const notPlanned = ni !== -1 ? (argv[ni + 1] ?? '') : null;
  return { issue, commit, extra, notPlanned };
}

// No-fix close path (#747-class issues): closes with GitHub's "not planned" state reason and a
// comment that makes the category unmistakable, so nobody later reads it as "fixed". `exec` is
// injectable for testing, same DI pattern as commitLanded above.
export function closeNotPlanned(issue, reason, { exec = execFileSync } = {}) {
  const body = `Closed as not planned: ${reason}`;
  exec('gh', ['issue', 'close', issue, '--reason', 'not planned', '--comment', body], { stdio: 'inherit' });
  return body;
}

import { resolve } from 'node:path';
import { isMainModule } from './is-main.js';
const isMain = isMainModule(import.meta.url);
if (isMain) {
  const { issue, commit, extra, notPlanned } = parseArgs(process.argv.slice(2));

  if (commit && notPlanned !== null) {
    console.error('Usage: --commit and --not-planned are mutually exclusive. Pick one.');
    process.exit(2);
  }

  if (notPlanned !== null) {
    // No-fix close path (#747-class issues): the reason is mandatory so a not-planned
    // close can never be mistaken for a claim that a defect was fixed.
    if (!notPlanned.trim()) {
      console.error('Usage: --not-planned requires a non-empty reason.');
      process.exit(2);
    }
    if (!issue) {
      console.error('Usage: node tools/issue-close.js <issue-number> --not-planned "<reason>"');
      process.exit(2);
    }
    closeNotPlanned(issue, notPlanned);
  } else {
    if (!issue || !commit) {
      console.error('Usage: node tools/issue-close.js <issue-number> --commit <sha> [--comment "text"]');
      process.exit(2);
    }
    if (!commitLanded(commit)) {
      console.error(`REFUSED: commit ${commit} is not reachable from origin/main. Land the fix first.`);
      process.exit(1);
    }
    const body = `Fixed in ${commit} (verified reachable from origin/main).${extra ? ' ' + extra : ''}`;
    execFileSync('gh', ['issue', 'close', issue, '--comment', body], { stdio: 'inherit' });
  }
}
