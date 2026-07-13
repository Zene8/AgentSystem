'use strict';
// Stop hook — routine compliance telemetry. "enforce: hard" agent-rule routines are
// injected text, not mechanical gates (#119): nothing previously measured whether agents
// actually followed them. This hook replays the session's Bash/PowerShell commands from
// the transcript and mechanically checks the routines that ARE checkable:
//
//   fix-pr-until-green   — `gh pr create` must be followed by a pr-guard.js run
//   post-merge-cleanup   — `gh pr merge` must use --delete-branch (or delete the branch later)
//   verify-before-close  — no direct `gh issue close`; issue-close.js is the sanctioned path
//
// One record per session is appended to ~/agent-memory/nexus/routine-compliance.jsonl:
//   { ts, sessionId, checked: [ids], violations: [{ routineId, evidence }] }
// Summarize with: node tools/routine-compliance-report.js
//
// Never throws, never blocks Stop: every step degrades to a no-op on failure.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COMPLIANCE_LOG_PATH = path.join(os.homedir(), 'agent-memory', 'nexus', 'routine-compliance.jsonl');

// Ordered list of shell commands the assistant ran this session.
function commandsFromTranscript(transcriptPath) {
  const commands = [];
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return commands; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const msg = entry && entry.message;
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block && block.type === 'tool_use' && (block.name === 'Bash' || block.name === 'PowerShell')
          && block.input && typeof block.input.command === 'string') {
        commands.push(block.input.command);
      }
    }
  }
  return commands;
}

const snippet = (cmd) => cmd.replace(/\s+/g, ' ').trim().slice(0, 160);

// Each check gets the ordered command list; returns violations [{ routineId, evidence }].
const CHECKS = [
  {
    id: 'fix-pr-until-green',
    check(commands) {
      const violations = [];
      commands.forEach((cmd, i) => {
        if (!/\bgh\s+pr\s+create\b/.test(cmd)) return;
        const guarded = commands.slice(i + 1).some(c => /pr-guard(\.js)?\b/.test(c));
        if (!guarded) violations.push({ routineId: 'fix-pr-until-green', evidence: `PR created without a later pr-guard run: ${snippet(cmd)}` });
      });
      return violations;
    },
  },
  {
    id: 'post-merge-cleanup',
    check(commands) {
      const violations = [];
      commands.forEach((cmd, i) => {
        if (!/\bgh\s+pr\s+merge\b/.test(cmd)) return;
        if (/--delete-branch\b/.test(cmd)) return;
        const deletedLater = commands.slice(i + 1).some(c =>
          /\bgit\s+push\s+\S+\s+--delete\b/.test(c) || /git\/refs\/heads\//.test(c) || /\bgit\s+branch\s+-[dD]\b/.test(c));
        if (!deletedLater) violations.push({ routineId: 'post-merge-cleanup', evidence: `PR merged without branch deletion: ${snippet(cmd)}` });
      });
      return violations;
    },
  },
  {
    id: 'verify-before-close',
    check(commands) {
      return commands
        .filter(cmd => /\bgh\s+issue\s+close\b/.test(cmd) && !/issue-close\.js\b/.test(cmd))
        .map(cmd => ({ routineId: 'verify-before-close', evidence: `direct gh issue close (use tools/issue-close.js): ${snippet(cmd)}` }));
    },
  },
];

// Pure core, unit-testable: commands in, session record out.
function evaluateCompliance(commands, sessionId, now = new Date().toISOString()) {
  const violations = [];
  for (const c of CHECKS) {
    try { violations.push(...c.check(commands)); } catch { /* one broken check must not kill the rest */ }
  }
  return { ts: now, sessionId: sessionId || 'unknown', checked: CHECKS.map(c => c.id), violations };
}

function main() {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let payload = {};
  try { payload = JSON.parse(input); } catch { /* not JSON */ }
  const transcriptPath = payload.transcript_path || payload.transcriptPath;
  if (!transcriptPath) return;
  const commands = commandsFromTranscript(transcriptPath);
  if (!commands.length) return; // nothing checkable this session
  const record = evaluateCompliance(commands, payload.session_id || payload.sessionId);
  try {
    fs.mkdirSync(path.dirname(COMPLIANCE_LOG_PATH), { recursive: true });
    fs.appendFileSync(COMPLIANCE_LOG_PATH, JSON.stringify(record) + '\n');
  } catch { /* telemetry is best-effort */ }
}

if (require.main === module) {
  try { main(); } catch { /* never block Stop */ }
}

module.exports = { commandsFromTranscript, evaluateCompliance, CHECKS, COMPLIANCE_LOG_PATH };
