#!/usr/bin/env node
// tools/email-alert-watcher.js — lightweight watcher that scans Gmail for Azure alerts and health check failures,
// then automatically creates labeled GitHub issues in target repositories.

import { execFileSync } from 'node:child_process';
import { parseFlagsOrExit } from './cli-args.js';

const USAGE = 'Usage: node tools/email-alert-watcher.js [--dry-run] [--harness claude|agy] [--help]';

function main() {
  const args = process.argv.slice(2);
  const flags = parseFlagsOrExit(args, {
    usage: USAGE,
    allowed: ['dry-run', 'harness', 'help']
  });

  const dryRun = !!flags['dry-run'];
  const harness = flags['harness'] || 'claude';

  console.log(`[INFO] Starting Gmail alert watcher (harness: ${harness}, dry-run: ${dryRun})...`);

  // Prompt that instructs a cheap model (haiku/flash) to check emails and create issues.
  const prompt = `
Check Gmail for recent Azure alerts or Genie/Arborgenie health check reports (emails matching query 'subject:"Azure Alert" OR subject:"Health Report" OR from:azure').
Read the most recent unread threads. If a thread indicates a failed health check or critical alert:
1. Identify the target repository (e.g. Zene8/genie for Genie alerts, Zene8/AgentSystem for AgentSystem alerts).
2. Create a new GitHub issue in that repository containing the failure/alert details using the gh CLI.
   - Title: "[Incident]: Azure Alert - <Alert Name>" or "[Incident]: Health Check Failure - <Service Name>"
   - Label: "ai-actionable", "incident"
   - Body: Include the email body, error message/stack trace, and timestamp.
3. If no failed reports or alerts are found, do nothing.
Ensure you use the 'Bash' tool to run the gh command.
  `.trim();

  try {
    if (dryRun) {
      console.log(`[dry-run] would run ${harness} with prompt:\n${prompt}`);
      return;
    }

    if (harness === 'claude') {
      execFileSync('claude', [
        '--agent', 'r2d2',
        '--model', 'claude-haiku-4-5-20251001',
        '-p', prompt
      ], { stdio: 'inherit' });
    } else {
      execFileSync('agy', [
        '--agent', 'r2d2',
        '--model', 'gemini-3.1-flash-lite-preview',
        '-p', prompt
      ], { stdio: 'inherit' });
    }

    console.log('[SUCCESS] Watcher run completed.');
  } catch (err) {
    console.error(`[ERROR] Watcher execution failed: ${err.message}`);
    process.exit(1);
  }
}

import { isMainModule } from './is-main.js';

if (isMainModule(import.meta.url)) {
  main();
}
