'use strict';
// SubagentStart hook (#120) — inject a COMPACT, tiered memory slice into every spawned
// subagent (Agent tool or `claude --bg --agent X`). Fixes: subagents previously got agent .md
// + CLAUDE.md but no memory context, and routinely skipped the "query memory manually" ritual,
// leaving the swarm memory-blind below the top level.
//
// Tiering (see tools/memory-context.js: agentTier): leads (jarvis/friday/sam/nat) get a
// trimmed 3-layer slice (user facts + repo + agent-brain + sona); everyone else is a worker
// and gets repo facts + their own agent-brain nodes only — no personal user facts.
//
// Non-blocking: any failure to read/parse stdin or run the tool degrades to plain 'OK',
// never blocks subagent start.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const TOOLS = process.env.AGENT_TOOLS_ROOT ||
  path.resolve(__dirname, '..', 'tools');

// Claude Code's SubagentStart payload field naming isn't guaranteed across versions — probe
// the common candidates defensively rather than assuming one exact key.
function extractAgentName(payload) {
  if (!payload) return '';
  return String(
    payload.subagent_type || payload.agent_type || payload.agent || payload.name || ''
  ).trim();
}
module.exports = { extractAgentName };

if (require.main === module) {
  let agent = '';
  let cwd = process.cwd();

  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(raw);
    agent = extractAgentName(payload);
    cwd = payload.cwd || cwd;
  } catch {
    // Malformed/missing stdin — proceed with empty agent name (worker-tier default).
  }

  let out = '';
  try {
    const args = [path.join(TOOLS, 'memory-context.js'), '--subagent', `--agent=${agent}`, `--cwd=${cwd}`];
    out = execFileSync(process.execPath, args, { timeout: 1800, encoding: 'utf8' });
  } catch {
    // Never block subagent start on a memory-context failure.
  }

  process.stdout.write(out && out.trim() ? out.trim() : 'OK');
}
