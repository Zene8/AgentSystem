'use strict';
// UserPromptSubmit hook — lightweight intent router. Injects an advisory routing hint so the
// main loop answers trivial/identity queries INLINE (cheaply) instead of spawning a heavyweight
// agent (the "47k tokens for 'who am I'" problem), and points domain work at the right lead.
// Hint is advisory context only — it cannot reroute the prompt (harness limitation).
//
// Trust augmentation: dynamically imports tools/agent-trust.js (ESM, repo-side) and appends
// the lead agent's trust score to the hint. Falls back silently on any error — hint still emits.

const os = require('os');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const PB = '~/agent-memory/nexus/personal-brain';
const TRUST_SCORES_PATH = path.join(os.homedir(), 'agent-memory', 'nexus', 'trust-scores.md');
const AGENT_TRUST_PATH = path.join(os.homedir(), 'AgentSystem', 'tools', 'agent-trust.js');

function classify(promptRaw) {
  const p = (promptRaw || '').toLowerCase().trim();
  if (!p) return '';

  // Identity / memory lookups → answer inline from the graph, NO heavyweight agent.
  if (/\b(who am i|what'?s my name|what do you know about me|my (preferences|profile)|remind me who i am)\b/.test(p)) {
    return `ROUTING HINT: identity/memory query. Answer INLINE — do NOT spawn a heavyweight agent. ` +
      `Use: node tools/graph/graph-query.js personal-brain <keywords> --brain-path=${PB} --record-access`;
  }

  // Strong domain signals → suggest the lead (advisory; main loop still decides).
  if (/\b(deploy|ci\/?cd|pipeline|infra|terraform|runner|docker|kubernetes)\b/.test(p)) return hint('Leo (DevOps)');
  if (/\b(security|vulnerab|audit|cve|secret|phi|compliance)\b/.test(p)) return hint('Sam (security — hard gate on main merges)');
  if (/\b(schema|migration|prisma|sql|database|query plan)\b/.test(p)) return hint('Pym (database)');
  if (/\b(pricing|gtm|revenue|market|sales|forecast|strategy|customer)\b/.test(p)) return hint('Nat (business)');
  if (/\b(readme|changelog|docs|documentation|release notes|announcement)\b/.test(p)) return hint('Threepio (docs)');
  if (/\b(code|bug|fix|refactor|api|test|pr|merge|build|backend|frontend|component)\b/.test(p)) return hint('Friday (engineering — dispatches Ultron/Astra/etc)');

  return '';
}

function hint(agentDisplay) {
  return `ROUTING HINT: domain signal → ${agentDisplay}. Route there unless this is genuinely cross-domain/CEO-level (then Jarvis). Trivial sub-questions can be answered inline.`;
}

// Asynchronously augment a routing hint with trust score from trust-scores.md.
// Returns the original hint on any failure — never throws, always fast.
async function augmentWithTrust(baseHint, agentDisplay) {
  if (!baseHint || !agentDisplay) return baseHint;
  try {
    if (!fs.existsSync(AGENT_TRUST_PATH)) return baseHint;
    const { parseTrustScores, composeHintWithTrust } = await import(pathToFileURL(AGENT_TRUST_PATH).href);
    const md = fs.existsSync(TRUST_SCORES_PATH) ? fs.readFileSync(TRUST_SCORES_PATH, 'utf8') : '';
    const scores = parseTrustScores(md);
    return composeHintWithTrust(baseHint, agentDisplay, scores);
  } catch {
    return baseHint;
  }
}

module.exports = { classify };

if (require.main === module) {
  let input = '';
  process.stdin.on('data', d => (input += d));
  process.stdin.on('end', async () => {
    let prompt = '';
    try { prompt = JSON.parse(input || '{}').prompt || ''; } catch { /* ignore */ }

    // Identify which domain branch matched to pass its agent display name for trust lookup.
    const p = (prompt || '').toLowerCase().trim();
    let matched = '';
    if (/\b(deploy|ci\/?cd|pipeline|infra|terraform|runner|docker|kubernetes)\b/.test(p)) matched = 'Leo (DevOps)';
    else if (/\b(security|vulnerab|audit|cve|secret|phi|compliance)\b/.test(p)) matched = 'Sam (security — hard gate on main merges)';
    else if (/\b(schema|migration|prisma|sql|database|query plan)\b/.test(p)) matched = 'Pym (database)';
    else if (/\b(pricing|gtm|revenue|market|sales|forecast|strategy|customer)\b/.test(p)) matched = 'Nat (business)';
    else if (/\b(readme|changelog|docs|documentation|release notes|announcement)\b/.test(p)) matched = 'Threepio (docs)';
    else if (/\b(code|bug|fix|refactor|api|test|pr|merge|build|backend|frontend|component)\b/.test(p)) matched = 'Friday (engineering — dispatches Ultron/Astra/etc)';

    const base = classify(prompt);
    const augmented = matched ? await augmentWithTrust(base, matched) : base;
    process.stdout.write(augmented);
    process.exit(0);
  });
}
