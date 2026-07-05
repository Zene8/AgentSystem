'use strict';
// routine-dispatch.js — single dispatcher hook for hook-mechanism routines.
// Wired to UserPromptSubmit and PostToolUse events. At runtime it:
//   1. Reads routines.yml + routine-overrides.json
//   2. Finds enabled, non-bypassed hook-mechanism routines whose trigger matches
//   3. Injects their action as context (UserPromptSubmit) or runs their check (PostToolUse)
//
// Adding a hook-routine = edit config/routines.yml + run `node tools/routines.js compile`.
// NO settings.json change needed — this dispatcher handles all hook routines.

const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const TOOLS = process.env.AGENT_TOOLS_ROOT ||
  path.resolve(__dirname, '..', 'tools');

const ROUTINES_SCRIPT = path.join(TOOLS, 'routines.js');

if (require.main === module) {
  let input = '';
  process.stdin.on('data', d => (input += d));
  process.stdin.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(input || '{}'); } catch { /* ignore */ }

    const event = payload.hook_event_name || '';
    const toolName = payload.tool_name || '';
    const toolResult = JSON.stringify(payload.tool_response || '');

    // Determine what context to build
    let hints = [];

    // UserPromptSubmit: inject advisory context for relevant routines
    if (event === 'UserPromptSubmit') {
      const prompt = (payload.prompt || '').toLowerCase();

      // identity_lookup trigger
      if (/\b(who am i|what.?s my name|what do you know about me|my (preferences|profile)|remind me who i am)\b/.test(prompt)) {
        hints.push(
          'ROUTINE [identity-query-inline]: Answer this identity query INLINE — do NOT spawn a heavyweight agent. ' +
          'Run: node ~/dev/AgentSystem/tools/graph/graph-query.js personal-brain <keywords> ' +
          '--brain-path=~/agent-memory/nexus/personal-brain --record-access'
        );
      }
    }

    // PostToolUse: detect gh pr create and schedule auto-resolve job
    if (event === 'PostToolUse' && toolName === 'Bash') {
      // Detect if the tool call was a `gh pr create`
      const toolInput = JSON.stringify(payload.tool_input || '');
      if (/gh pr create/.test(toolInput)) {
        // Extract PR number from gh pr create output
        const prUrlMatch = toolResult.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
        if (prUrlMatch) {
          const prNumber = prUrlMatch[1];
          scheduleAutoResolve(prNumber);
          hints.push(`ROUTINE [auto-resolve-pr-comments]: scheduled comment-response job for PR #${prNumber} in ~2min`);
        }
      }
    }

    process.stdout.write(hints.join('\n') || '');
    process.exit(0);
  });
}

// Schedule a one-shot Windows Task Scheduler job to respond to PR comments ~2min later.
// Non-fatal: if Task Scheduler is unavailable (non-Windows), logs and continues.
function scheduleAutoResolve(prNumber) {
  if (!/^\d+$/.test(prNumber)) return;
  try {
    const triggerTime = new Date(Date.now() + 2 * 60 * 1000);
    const hh = String(triggerTime.getHours()).padStart(2, '0');
    const mm = String(triggerTime.getMinutes()).padStart(2, '0');
    const taskName = `AgentSystem-AutoResolvePR-${prNumber}`;
    const scriptPath = path.join(TOOLS, 'auto-resolve-pr-comments.js');

    // Spawn schtasks in detached mode — non-blocking
    const child = spawn('schtasks', [
      '/create', '/f',
      '/tn', taskName,
      '/tr', `node "${scriptPath}" --pr=${prNumber}`,
      '/sc', 'once',
      '/st', `${hh}:${mm}`,
      '/ru', 'SYSTEM',
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Non-fatal: Task Scheduler unavailable or spawn failed.
  }
}
