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
const AGENT_TRUST_PATH = path.join(os.homedir(), 'dev', 'AgentSystem', 'tools', 'agent-trust.js');

// Single source of truth for domain routing, shared by classify() and the CLI trust-lookup
// path below (#114: previously duplicated as two independently-maintained regex lists that
// had drifted — this table is matched top-to-bottom, first hit wins, mirroring jarvis.md's
// routing table).
// #114: infra/deploy/CI and schema/migration/DB route to Friday (CTO), matching jarvis.md.
// Friday is the domain lead and dispatches worker-tier agents (Leo for infra, Pym for schema)
// internally — routing straight to Leo/Pym here contradicted jarvis.md and let prompts bypass
// Friday's ownership entirely.
// #114: bare "audit" (e.g. "audit my config") is not itself a security signal and was
// misrouting non-security work to Sam — tightened to require an explicit security phrase.
// #114: r2d2 fallback added for one-off scripts/lookups/utility tasks with no domain-lead fit,
// mirroring jarvis.md's "one-off scripts, web lookups, quick calculations" → r2d2 row.
const DOMAIN_RULES = [
  [/\b(deploy|ci\/?cd|pipeline|infra|terraform|runner|docker|kubernetes)\b/, 'Friday (engineering — dispatches Leo for infra/CI)'],
  [/\b(security audit|vulnerab|cve|compliance audit|secrets? (leak|exposure|scan)|phi\b)/, 'Sam (security — hard gate on main merges)'],
  [/\b(schema|migration|prisma|sql|database|query plan)\b/, 'Friday (engineering — dispatches Pym for schema/DB)'],
  [/\b(pricing|gtm|revenue|market|sales|forecast|strategy|customer)\b/, 'Nat (business)'],
  [/\b(readme|changelog|docs|documentation|release notes|announcement)\b/, 'Threepio (docs)'],
  [/\b(code|bug|fix|refactor|api|test|pr|merge|build|backend|frontend|component)\b/, 'Friday (engineering — dispatches Ultron/Astra/etc)'],
  [/\b(one-?off script|quick calculation|quick lookup|web lookup|utility task)\b/, 'r2d2 (general technical worker — no domain lead fit)'],
];

// Returns the agent display name for the first matching rule, or '' if none match.
function matchDomain(p) {
  for (const [re, agentDisplay] of DOMAIN_RULES) {
    if (re.test(p)) return agentDisplay;
  }
  return '';
}

function classify(promptRaw) {
  const p = (promptRaw || '').toLowerCase().trim();
  if (!p) return '';

  // Identity / memory lookups → answer inline from the graph, NO heavyweight agent.
  if (/\b(who am i|what'?s my name|what do you know about me|my (preferences|profile)|remind me who i am)\b/.test(p)) {
    return `ROUTING HINT: identity/memory query. Answer INLINE — do NOT spawn a heavyweight agent. ` +
      `Use: node tools/graph/graph-query.js personal-brain <keywords> --brain-path=${PB} --record-access`;
  }

  const matched = matchDomain(p);
  return matched ? hint(matched) : '';
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

module.exports = { classify, matchDomain, DOMAIN_RULES };

if (require.main === module) {
  let input = '';
  process.stdin.on('data', d => (input += d));
  process.stdin.on('end', async () => {
    let prompt = '';
    try { prompt = JSON.parse(input || '{}').prompt || ''; } catch { /* ignore */ }

    // Identify which domain branch matched to pass its agent display name for trust lookup
    // (single source of truth: DOMAIN_RULES, see #114).
    const p = (prompt || '').toLowerCase().trim();
    const matched = matchDomain(p);

    const base = classify(prompt);
    const augmented = matched ? await augmentWithTrust(base, matched) : base;
    process.stdout.write(augmented);
    process.exit(0);
  });
}
