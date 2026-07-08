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
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { loadRoutingRules } = require('./routing-config');

const PB = '~/agent-memory/nexus/personal-brain';
const TRUST_SCORES_PATH = path.join(os.homedir(), 'agent-memory', 'nexus', 'trust-scores.md');
const AGENT_TRUST_PATH = path.join(os.homedir(), 'dev', 'AgentSystem', 'tools', 'agent-trust.js');
const GRAPH_QUERY_PATH = path.join(os.homedir(), 'dev', 'AgentSystem', 'tools', 'graph', 'graph-query.js');
const KNOWN_REPOS_PATH = path.join(os.homedir(), 'agent-memory', 'nexus', 'known-repos.json');
// #124: routing accuracy telemetry — one line per routed prompt, joined against actual-agent
// entries appended by hooks/sona-writeback-hook.js (same promptHash) by tools/routing-report.js.
const ROUTING_LOG_PATH = path.join(os.homedir(), 'agent-memory', 'nexus', 'routing-log.jsonl');
const { execFileSync } = require('child_process');

// Stable short hash of a prompt's text, shared with sona-writeback-hook.js so a hint record
// and the eventual actual-agent record for the same prompt can be joined by routing-report.js.
function promptHash(promptRaw) {
  return crypto.createHash('sha1').update((promptRaw || '').trim()).digest('hex').slice(0, 16);
}

// Append one JSONL line to routing-log.jsonl. Never throws — telemetry must not affect routing.
function logRoutingEvent(record) {
  try {
    fs.mkdirSync(path.dirname(ROUTING_LOG_PATH), { recursive: true });
    fs.appendFileSync(ROUTING_LOG_PATH, JSON.stringify(record) + '\n');
  } catch { /* non-fatal */ }
}

// #121: task-aware memory injection. Static SessionStart core is now trimmed to 3 nodes
// (identity/role/hard-pref); this fires ONCE per session on the first substantive prompt
// (>= MIN_WORDS) and runs graph-query's existing BM25 retrieval (no re-implementation) over
// personal-brain + the detected repo brain, injecting top relevant nodes and recording access
// via --record-access so relevance feeds importance (graph-query.js already does the write).
const MIN_WORDS = 10;
// #170: top-4 -> top-2 (memory injection diet) plus a hard score floor below.
const RETRIEVAL_TOP = 2;
// #170: BM25 composite score floor. Score scale is ~0-1 (edgeScore*0.4 + keywordScore*0.6,
// each already normalized to [0,1] in graph-query.js), with an importance boost that can push
// it up to 1.5x for high-importance nodes. 0.15 is chosen as "clearly more than noise" on that
// scale — it's well above what a single incidental keyword match produces, while still letting
// genuinely relevant low-importance nodes through. Anything below this isn't worth the tokens.
const SCORE_FLOOR = 0.15;

// #170: trivial-prompt bail. Acks/continuations carry no task signal worth spending retrieval
// tokens on — skip memory injection entirely for these without even extracting keywords.
const ACK_REGEX = /^(ok|yes|no|sure|continue|merge it|go|do it|thanks?)\b/i;
const MIN_PROMPT_LEN = 15;

function isTrivialPrompt(promptRaw) {
  const p = (promptRaw || '').trim();
  if (p.length < MIN_PROMPT_LEN) return true;
  if (ACK_REGEX.test(p)) return true;
  return false;
}

// Extract keywords: drop stopwords-ish short tokens, keep the rest. Cheap, no NLP dependency.
function extractKeywords(promptRaw) {
  return (promptRaw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 12);
}

// Once-per-session marker: keyed by transcript_path (stable per session) if provided, else
// session_id, else a process-lifetime fallback. Lives in os.tmpdir() — mirrors the pattern of
// other session-scoped state files in this codebase (e.g. sona-writeback-hook's offset files).
function markerPath(payload) {
  const key = (payload && (payload.transcript_path || payload.session_id)) || 'unknown-session';
  const safe = key.replace(/[^a-zA-Z0-9]/g, '_').slice(-120);
  return path.join(os.tmpdir(), `memory-router-injected-${safe}.marker`);
}

function alreadyInjected(marker) {
  try { return fs.existsSync(marker); } catch { return false; }
}

function markInjected(marker) {
  try { fs.writeFileSync(marker, String(Date.now())); } catch { /* non-fatal */ }
}

// Detect the repo slug for the given cwd via known-repos.json, without importing the ESM
// memory-context.js module (memory-router.js is CommonJS) — a light local re-implementation
// of the same "cwd is under repo.path" match used by tools/memory-context.js:detectRepo.
function detectRepoSlug(cwd) {
  try {
    if (!fs.existsSync(KNOWN_REPOS_PATH)) return null;
    const registry = JSON.parse(fs.readFileSync(KNOWN_REPOS_PATH, 'utf8'));
    const norm = p => path.resolve(p || '').replace(/\\/g, '/').toLowerCase();
    const cwdNorm = norm(cwd);
    for (const repo of registry.repos || []) {
      const repoNorm = norm(repo.path);
      if (repoNorm && cwdNorm.startsWith(repoNorm)) return repo.slug;
    }
  } catch { /* non-fatal */ }
  return null;
}

// Run graph-query.js as a subprocess (reuses its existing BM25 scoring + --record-access
// write-back verbatim — no duplicated retrieval logic) against one brain, returns
// { nodeId, score } pairs (score omitted -> 0 for legacy string-only output).
function queryBrain(slug, brainPathFlag, keywords, cwd) {
  if (!fs.existsSync(GRAPH_QUERY_PATH) || keywords.length === 0) return [];
  try {
    const args = [GRAPH_QUERY_PATH, slug, ...keywords, `--top=${RETRIEVAL_TOP}`, '--json', '--record-access'];
    if (brainPathFlag) args.push(`--brain-path=${brainPathFlag}`);
    const out = execFileSync(process.execPath, args, { timeout: 1200, encoding: 'utf8', cwd: cwd || process.cwd() });
    const parsed = JSON.parse(out);
    const direct = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.direct) ? parsed.direct : []);
    return direct
      .map(r => (typeof r === 'string' ? { nodeId: r, score: 0 } : { nodeId: r.nodeId, score: r.score || 0 }))
      .filter(r => r.nodeId);
  } catch {
    return [];
  }
}

// #170: per-session dedup of injected node ids, so the same pattern is never injected twice in
// one session. Lives in os.tmpdir(), keyed the same way as markerPath (transcript_path first,
// falling back to session_id) — mirrors the existing marker-file pattern in this file.
function dedupPath(payload) {
  const key = (payload && (payload.transcript_path || payload.session_id)) || 'unknown-session';
  const safe = key.replace(/[^a-zA-Z0-9]/g, '_').slice(-120);
  return path.join(os.tmpdir(), `memory-router-dedup-${safe}.json`);
}

function loadInjectedIds(dedupFile) {
  try {
    const raw = fs.readFileSync(dedupFile, 'utf8');
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveInjectedIds(dedupFile, idsSet) {
  try { fs.writeFileSync(dedupFile, JSON.stringify([...idsSet])); } catch { /* non-fatal */ }
}

// Retrieve task-relevant nodes across personal-brain + the detected repo brain. Never throws;
// returns '' (no injection) on any failure, including timeout — this must stay well under the
// hook's timeout budget (<1.5s target per #121 DoD).
// #170: applies a score floor, excludes ids already injected this session, and reports the
// final set of injected ids back to the caller (via the returned `injected` array on result)
// so the caller can persist them to the session dedup file.
function retrieveTaskContext(promptRaw, cwd, excludeIds) {
  const exclude = excludeIds || new Set();
  const keywords = extractKeywords(promptRaw);
  if (keywords.length === 0) return { text: '', injected: [] };

  const personal = queryBrain('personal-brain', PB, keywords, cwd);
  const slug = detectRepoSlug(cwd);
  const repoNodes = slug ? queryBrain(slug, null, keywords, cwd) : [];

  const candidates = [...personal, ...repoNodes]
    .filter(r => r.score >= SCORE_FLOOR)
    .filter(r => !exclude.has(r.nodeId))
    .sort((a, b) => b.score - a.score)
    .slice(0, RETRIEVAL_TOP);

  if (candidates.length === 0) return { text: '', injected: [] };
  const ids = candidates.map(r => r.nodeId);
  const text = `RELEVANT MEMORY (task-aware retrieval): ${ids.join(', ')} — query full content with graph-query.js if needed.`;
  return { text, injected: ids };
}

// #124: domain rules now live in config/routing.yml (single source of truth, loaded via
// hooks/routing-config.js) instead of a hardcoded array here — so the router and jarvis.md's
// routing table (generated by tools/generate-routing-table.js) can never drift again.
// #114 history (why these specific rules exist) is preserved as comments in config/routing.yml.
const DOMAIN_RULES = loadRoutingRules();

// Returns { id, agentDisplay } for the first matching rule, or null if none match.
function matchDomain(p) {
  for (const rule of DOMAIN_RULES) {
    if (rule.regex.test(p)) return { id: rule.id, agentDisplay: rule.hintDisplay };
  }
  return null;
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
  return matched ? hint(matched.agentDisplay) : '';
}

function hint(agentDisplay) {
  return `ROUTING HINT: domain signal → ${agentDisplay}. Route there unless this is genuinely cross-domain/CEO-level (then Jarvis). Trivial sub-questions can be answered inline.`;
}

// Asynchronously augment a routing hint with trust score from trust-scores.md.
// Returns the original hint on any failure — never throws, always fast.
//
// #118: a cold-start dynamic import() of agent-trust.js plus a graph-scale trust-scores.md
// read/parse can be slow enough to risk the hook's configured timeout (5s in settings.json).
// Since this augmentation is purely cosmetic (the base hint is already correct/complete),
// race it against a short internal timeout and fall back to the un-augmented hint rather than
// risk the whole hook getting killed and the routing hint being dropped entirely.
const TRUST_AUGMENT_TIMEOUT_MS = 1500;

async function augmentWithTrust(baseHint, agentDisplay) {
  if (!baseHint || !agentDisplay) return baseHint;
  const attempt = (async () => {
    if (!fs.existsSync(AGENT_TRUST_PATH)) return baseHint;
    const { parseTrustScores, composeHintWithTrust } = await import(pathToFileURL(AGENT_TRUST_PATH).href);
    const md = fs.existsSync(TRUST_SCORES_PATH) ? fs.readFileSync(TRUST_SCORES_PATH, 'utf8') : '';
    const scores = parseTrustScores(md);
    return composeHintWithTrust(baseHint, agentDisplay, scores);
  })();
  const timeout = new Promise(resolve => setTimeout(() => resolve(baseHint), TRUST_AUGMENT_TIMEOUT_MS));
  try {
    return await Promise.race([attempt, timeout]);
  } catch {
    return baseHint;
  }
}

module.exports = {
  classify, matchDomain, DOMAIN_RULES,
  extractKeywords, markerPath, alreadyInjected, detectRepoSlug, retrieveTaskContext,
  promptHash, logRoutingEvent, ROUTING_LOG_PATH,
  isTrivialPrompt, dedupPath, loadInjectedIds, saveInjectedIds,
  SCORE_FLOOR, RETRIEVAL_TOP, MIN_PROMPT_LEN, ACK_REGEX,
};

if (require.main === module) {
  let input = '';
  process.stdin.on('data', d => (input += d));
  process.stdin.on('end', async () => {
    let payload = {};
    try { payload = JSON.parse(input || '{}'); } catch { /* ignore */ }
    const prompt = payload.prompt || '';

    // Identify which domain branch matched to pass its agent display name for trust lookup
    // (single source of truth: config/routing.yml, see #114/#124).
    const p = (prompt || '').toLowerCase().trim();
    const matched = matchDomain(p);

    const base = classify(prompt);
    const augmented = matched ? await augmentWithTrust(base, matched.agentDisplay) : base;

    // #124: log the hint (branch id + agent) so routing-report.js can later join it against
    // the actual agent used (logged by hooks/sona-writeback-hook.js) via the shared promptHash.
    if (p) {
      logRoutingEvent({
        ts: new Date().toISOString(),
        promptHash: promptHash(prompt),
        hint: matched ? matched.id : 'none',
        agentHint: matched ? matched.agentDisplay.split(' ')[0] : null,
      });
    }

    // #121/#170: fire task-aware retrieval on substantive, non-trivial prompts, deduped per
    // session against previously-injected node ids (rather than a hard once-per-session gate —
    // a later prompt on a different topic can still surface new, not-yet-injected nodes).
    // Wrapped defensively — a throw here must never take down the pre-existing routing-hint
    // output below (queryBrain/detectRepoSlug already degrade gracefully on their own, but this
    // guards the orchestration glue itself too).
    let taskContext = '';
    try {
      const wordCount = prompt.split(/\s+/).filter(Boolean).length;
      if (wordCount >= MIN_WORDS && !isTrivialPrompt(prompt)) {
        const dedupFile = dedupPath(payload);
        const alreadyInjectedIds = loadInjectedIds(dedupFile);
        const result = retrieveTaskContext(prompt, payload.cwd || process.cwd(), alreadyInjectedIds);
        if (result.text) {
          taskContext = result.text;
          for (const id of result.injected) alreadyInjectedIds.add(id);
          saveInjectedIds(dedupFile, alreadyInjectedIds);
        }
      }
    } catch { /* never let task-aware retrieval break the base routing hint */ }

    const parts = [augmented, taskContext].filter(Boolean);
    process.stdout.write(parts.join('\n'));
    process.exit(0);
  });
}
