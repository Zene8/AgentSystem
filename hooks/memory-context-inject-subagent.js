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

// Deployed copies live in ~/.claude/hooks where "../tools" does not exist — every
// candidate is existence-checked so the hook works from both the repo and the
// deployed location (root cause of the silent memory-injection outage, 2026-07-12).
const TOOLS = [
  process.env.AGENT_TOOLS_ROOT,
  path.resolve(__dirname, '..', 'tools'),
  path.join(require('node:os').homedir(), 'dev', 'AgentSystem', 'tools'),
].find((p) => { try { return p && fs.existsSync(path.join(p, 'memory-context.js')); } catch { return false; } });

// Claude Code's SubagentStart payload field naming isn't guaranteed across versions — probe
// the common candidates defensively rather than assuming one exact key.
function extractAgentName(payload) {
  if (!payload) return '';
  return String(
    payload.subagent_type || payload.agent_type || payload.agent || payload.name || ''
  ).trim();
}

// Pull task keywords from the spawn prompt so the injected slice is task-relevant,
// not just tier-relevant. Top ~8 distinctive words (>=4 chars, deduped) is enough for
// BM25 to bias retrieval without shipping the whole prompt to a subprocess arg.
function extractKeywords(payload) {
  const prompt = String(payload?.prompt || payload?.task || payload?.description || '');
  if (!prompt) return '';
  const words = prompt.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [];
  return [...new Set(words)].slice(0, 8).join(' ');
}
module.exports = { extractAgentName, extractKeywords };

if (require.main === module) {
  let agent = '';
  let cwd = process.cwd();
  let keywords = '';

  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(raw);
    agent = extractAgentName(payload);
    cwd = payload.cwd || cwd;
    keywords = extractKeywords(payload);
  } catch {
    // Malformed/missing stdin — proceed with empty agent name (worker-tier default).
  }

  let out = '';
  try {
    const args = [path.join(TOOLS, 'memory-context.js'), '--subagent', `--agent=${agent}`, `--cwd=${cwd}`];
    if (keywords) args.push(`--keywords=${keywords}`);
    out = execFileSync(process.execPath, args, { timeout: 1800, encoding: 'utf8' });
  } catch {
    // Never block subagent start on a memory-context failure.
  }

  process.stdout.write(out && out.trim() ? out.trim() : 'OK');
}
