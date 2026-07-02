#!/usr/bin/env node
// memory-classify.js — classify + extract facts from pasted text across memory tiers.
// Mirrors memory-capture.js's buildCapturePrompt/parseCaptureFacts shape, but the LLM
// also decides which memory tier (personal/repo/agent) each fact belongs to, given the
// known repo slugs and agent roster as context. Conservative by design: unknown/invalid
// tier or target always falls back to personal — never guesses a repo/agent that doesn't exist.

const MAX_FACTS = 8;
const VALID_TIERS = new Set(['personal', 'repo', 'agent']);

// Fixed roster — matches the agent set documented in ~/.claude/CLAUDE.md.
export const AGENT_ROSTER = [
  'jarvis', 'friday', 'sam', 'nat', 'ultron', 'pym', 'leo', 'astra', 'wanda', 'threepio', 'r2d2',
];

// Pure: build the classify+extract prompt for pasted text.
export function buildClassifyPrompt(text, { repos = [], agents = [] } = {}) {
  return [
    'You are a memory extraction + routing engine reading pasted text.',
    'Extract ONLY facts that are ALL of:',
    '  (a) durable — true beyond this session (preferences, decisions, stable context, corrections, patterns)',
    '  (b) specific — a concrete fact, not a task description or question',
    '  (c) high-precision — you are certain, not inferring',
    '',
    'EXCLUDE: one-off task details, speculation, ephemeral state.',
    `Cap: at most ${MAX_FACTS} facts. If none qualify, output exactly: NONE`,
    '',
    'For EACH fact, decide which memory tier it belongs to:',
    '  - "personal" — about the user themselves (identity, preferences, workflow, goals). Default when unsure.',
    `  - "repo" — a technical fact about ONE specific repo. target must be exactly one of: ${repos.join(', ') || '(none known)'}`,
    `  - "agent" — a learned pattern about ONE specific agent. target must be exactly one of: ${agents.join(', ') || '(none known)'}`,
    '',
    'Output ONLY one JSON object per line, no preamble, no explanation, no markdown fences:',
    '{"fact": "...", "tier": "personal", "target": ""}',
    '{"fact": "...", "tier": "repo", "target": "agentsystem"}',
    '{"fact": "...", "tier": "agent", "target": "friday"}',
    '',
    '--- TEXT START ---',
    text.slice(0, 8000),
    '--- TEXT END ---',
  ].join('\n');
}

// Pure: parse LLM output into { fact, tier, target } objects.
// Skips malformed lines. Coerces unknown/invalid tier or target back to personal.
export function parseClassifiedFacts(raw, { repos = [], agents = [] } = {}) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === 'NONE') return [];

  const repoSet = new Set(repos);
  const agentSet = new Set(agents);
  const out = [];

  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    let obj;
    try { obj = JSON.parse(l); } catch { continue; }
    if (!obj || typeof obj.fact !== 'string' || !obj.fact.trim()) continue;

    let tier = VALID_TIERS.has(obj.tier) ? obj.tier : 'personal';
    let target = typeof obj.target === 'string' ? obj.target.trim() : '';

    if (tier === 'repo' && !repoSet.has(target)) { tier = 'personal'; target = ''; }
    if (tier === 'agent' && !agentSet.has(target)) { tier = 'personal'; target = ''; }
    if (tier === 'personal') target = '';

    out.push({ fact: obj.fact.trim(), tier, target });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}
