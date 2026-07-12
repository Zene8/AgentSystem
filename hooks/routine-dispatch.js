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

// Deployed copies live in ~/.claude/hooks where "../tools" does not exist — every
// candidate is existence-checked so the hook works from both locations (2026-07-12 audit).
const TOOLS = [
  process.env.AGENT_TOOLS_ROOT,
  path.resolve(__dirname, '..', 'tools'),
  path.join(os.homedir(), 'dev', 'AgentSystem', 'tools'),
].find((p) => { try { return p && fs.existsSync(path.join(p, 'auto-resolve-pr-comments.js')); } catch { return false; } });

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

    // UserPromptSubmit: identity-query hint intentionally NOT emitted here — memory-router.js
    // (also on UserPromptSubmit) owns that routine; emitting from both produced duplicate
    // hints on every identity prompt (2026-07-12 audit).

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
      // Absolute node path: the task runs under an account whose PATH may not include
      // the user's nvm4w node install — bare `node` silently fails there (2026-07-12 audit).
      '/tr', `"${process.execPath}" "${scriptPath}" --pr=${prNumber}`,
      '/sc', 'once',
      '/st', `${hh}:${mm}`,
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Non-fatal: Task Scheduler unavailable or spawn failed.
  }
}
