#!/usr/bin/env node
// memory-reconcile.js — mem0-style ADD/UPDATE/DELETE/NOOP reconciliation for brain facts.
// Pure functions only. Zero npm dependencies.
// All stateful callers (brain-remember.js) import reconcileFact and use its output.

import { execFileSync } from 'node:child_process';

// Words too common to distinguish meaning. Minimal set for personal-brain domain.
const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','shall','can','i','me',
  'my','he','she','it','we','they','them','their','this','that','these','those',
  'prefers','prefer','uses','use','likes','like','wants','want','needs','need',
]);

// Tokenize: lowercase, normalize separators, remove stopwords, deduplicate, length ≥ 3.
// Numeric tokens (e.g. "6", "10", "12") are kept — they signal value changes in preferences.
export function tokenize(text) {
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w.length >= 1 && (w.length >= 3 || /^\d+$/.test(w)) && !STOPWORDS.has(w))
  )];
}

// Jaccard similarity between two token arrays. Returns 0 for empty inputs.
export function jaccardSimilarity(a, b) {
  if (!a.length && !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  const intersection = [...sa].filter(t => sb.has(t)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : intersection / union;
}

// Default LLM: shells `claude -p`. Injectable for tests — never call this in unit tests.
// Exported so brain-remember.js can inject it as the production default.
// Non-essential background feature (dedup judge) -- pinned to the cheapest tier, see
// memory-reflect.js for why (bare `claude -p` inherits the CLI's default model).
export const defaultLlm = (prompt) =>
  execFileSync('claude', ['-p', prompt, '--model', 'claude-haiku-4-5-20251001'], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, AGENT_MEMORY_CAPTURE: '1' } });

// Pure: build a prompt asking the LLM to classify newFact against candidates.
// Returns prompt string.
export function buildReconcilePrompt(newFact, candidateFacts) {
  const numbered = candidateFacts.map((f, i) => `${i}: ${f}`).join('\n');
  return [
    'You are a memory reconciliation engine. Decide how a NEW fact relates to EXISTING facts.',
    '',
    'EXISTING facts (numbered):',
    numbered,
    '',
    `NEW fact: ${newFact}`,
    '',
    'Rules:',
    '- If the NEW fact contradicts or supersedes one existing fact (same topic, different value) → respond: UPDATE <index>',
    '- If the NEW fact is already captured by an existing fact → respond: NOOP <index>',
    '- If the NEW fact is genuinely new information → respond: ADD',
    '',
    'Respond with ONLY one line: ADD, NOOP <index>, or UPDATE <index>. No explanation.',
  ].join('\n');
}

// Pure: parse LLM output into { action, supersedes? }.
// Falls back to { action: 'ADD' } on unrecognised output.
export function parseReconcileResponse(text) {
  const line = text.trim().split('\n')[0].trim().toUpperCase();
  const updateM = line.match(/^UPDATE\s+(\d+)$/);
  if (updateM) return { action: 'UPDATE', supersedes: parseInt(updateM[1], 10) };
  const noopM = line.match(/^NOOP\s+(\d+)$/);
  if (noopM) return { action: 'NOOP', supersedes: parseInt(noopM[1], 10) };
  if (line === 'ADD') return { action: 'ADD' };
  return { action: 'ADD' }; // safe fallback on malformed output
}

// Detect whether newFact should ADD, UPDATE, or NOOP relative to a list of existing facts.
//
// Three-tier gate:
//   1. Exact match or Jaccard ≥ noopThreshold  → NOOP  (no LLM)
//   2. Shares ≥1 significant token with ANY existing fact → LLM judge (if llm provided)
//      LLM failure/timeout → safe fallback to ADD (never lose data)
//   3. No shared token at all → ADD (no LLM)
//
// When llm is absent (legacy callers / unit tests without stub):
//   Falls back to pure Jaccard thresholds — same behaviour as before this change.
//   This preserves all existing tests that call detectAction without an llm option.
//
// Returns { action, supersedes?: number, similarity?: number }
// supersedes is the index into existingFacts of the fact to supersede.
export function detectAction(newFact, existingFacts, {
  noopThreshold = 0.85,
  updateThreshold = 0.45,
  llm,
} = {}) {
  if (!existingFacts.length) return { action: 'ADD' };

  const newNorm = newFact.replace(/^[-*]\s*/, '').trim().toLowerCase();
  const newTokens = tokenize(newFact);

  let bestSimilarity = 0;
  let bestIndex = -1;
  let anySharedToken = false;

  for (let i = 0; i < existingFacts.length; i++) {
    const existNorm = existingFacts[i].replace(/^[-*]\s*/, '').trim().toLowerCase();

    // Exact string match → NOOP immediately.
    if (existNorm === newNorm) return { action: 'NOOP', supersedes: i, similarity: 1 };

    const existTokens = tokenize(existingFacts[i]);
    const sim = jaccardSimilarity(newTokens, existTokens);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestIndex = i;
    }

    // Track whether any existing fact shares ≥1 significant token.
    if (!anySharedToken && newTokens.some(t => existTokens.includes(t))) {
      anySharedToken = true;
    }
  }

  // Near-identical: NOOP without LLM.
  if (bestSimilarity >= noopThreshold) {
    return { action: 'NOOP', supersedes: bestIndex, similarity: bestSimilarity };
  }

  // Ambiguous band: shares at least one significant token but NOT near-identical.
  // If an LLM is provided, delegate to it — this is the contradiction-detection path.
  // Without LLM (legacy/test callers), fall back to pure Jaccard thresholds.
  if (anySharedToken && llm) {
    const prompt = buildReconcilePrompt(newFact, existingFacts);
    try {
      const raw = llm(prompt);
      const parsed = parseReconcileResponse(raw);
      // Guard: supersedes index must be in range.
      if ((parsed.action === 'UPDATE' || parsed.action === 'NOOP') &&
          (parsed.supersedes === undefined || parsed.supersedes >= existingFacts.length)) {
        return { action: 'ADD', similarity: bestSimilarity };
      }
      return { ...parsed, similarity: bestSimilarity };
    } catch {
      // LLM failure → safe fallback; never lose data.
      return { action: 'ADD', similarity: bestSimilarity };
    }
  }

  // Jaccard-only fallback (no llm provided, or no shared token).
  if (bestSimilarity >= updateThreshold) return { action: 'UPDATE', supersedes: bestIndex, similarity: bestSimilarity };
  return { action: 'ADD', similarity: bestSimilarity };
}

// Return a bullet line struck-through with a supersession date marker.
// Output: `- ~~<original text>~~ <!-- superseded:YYYY-MM-DD -->`
export function supersedeFact(bulletLine, date = new Date().toISOString().slice(0, 10)) {
  const text = bulletLine.replace(/^[-*]\s*/, '').trim();
  return `- ~~${text}~~ <!-- superseded:${date} -->`;
}

// High-level reconciler for brain-remember.js. Operates on raw markdown.
// Extracts bullets from `section`, runs detectAction, applies mutation.
//
// Returns { md, action, supersededText }
// - NOOP:   md unchanged, supersededText null
// - ADD:    new bullet appended under section, supersededText null
// - UPDATE: old bullet struck-through in-place, new bullet appended, supersededText = old text
//
// llm: injectable LLM function (defaults to real `claude -p`). Pass a stub in tests.
//
// Tier-2 deferral (out of scope): cross-section contradictions.
// Comparison is section-scoped — a fact in "Code style" does not supersede
// a fact in "Preferences" even if semantically related.
export function reconcileFact(raw, newFact, section = 'Session Notes', { llm } = {}) {
  const cleanFact = newFact.replace(/^[-*]\s*/, '').trim();
  if (!cleanFact) return { md: raw, action: 'NOOP', supersededText: null };

  // Collect existing bullets from the section.
  const lines = raw.split('\n');
  const headerIdx = lines.findIndex(l => {
    const m = l.match(/^#{1,3}\s+(.+?)\s*$/);
    return m && m[1].toLowerCase() === section.toLowerCase();
  });

  // Gather section bullets (text only, not struck-through superseded ones).
  const existingBullets = [];
  const existingIndices = [];
  if (headerIdx !== -1) {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (/^#{1,3}\s+/.test(lines[i])) break;
      const m = lines[i].match(/^[-*]\s+(.+)$/);
      if (m && !m[1].includes('~~')) {
        existingBullets.push(m[1].trim());
        existingIndices.push(i);
      }
    }
  }

  const { action, supersedes } = detectAction(cleanFact, existingBullets, { llm });

  if (action === 'NOOP') {
    return { md: raw, action: 'NOOP', supersededText: null };
  }

  const today = new Date().toISOString().slice(0, 10);
  let mutated = [...lines];

  if (action === 'UPDATE' && supersedes !== undefined) {
    // Strike through the stale fact at its original line index.
    const lineIdx = existingIndices[supersedes];
    const oldText = mutated[lineIdx];
    const supersededText = existingBullets[supersedes];
    mutated[lineIdx] = supersedeFact(oldText, today);

    // Append the new fact right after the struck-through line.
    mutated.splice(lineIdx + 1, 0, `- ${cleanFact}`);

    return { md: mutated.join('\n'), action: 'UPDATE', supersededText };
  }

  // ADD: append under section (create section if missing).
  const rebuildRaw = mutated.join('\n');
  const { md: added } = appendBullet(rebuildRaw, cleanFact, section);
  return { md: added, action: 'ADD', supersededText: null };
}

// Minimal append helper — insert `fact` bullet under `section`, create section if missing.
function appendBullet(raw, fact, section) {
  const bullet = `- ${fact}`;
  const lines = raw.split('\n');
  const headerIdx = lines.findIndex(l => {
    const m = l.match(/^#{1,3}\s+(.+?)\s*$/);
    return m && m[1].toLowerCase() === section.toLowerCase();
  });
  if (headerIdx === -1) {
    const tail = raw.endsWith('\n') ? '' : '\n';
    return { md: `${raw}${tail}\n## ${section}\n\n${bullet}\n` };
  }
  let end = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^#{1,3}\s+/.test(lines[i])) { end = i; break; }
  }
  let insertAt = headerIdx + 1;
  for (let i = headerIdx + 1; i < end; i++) {
    if (lines[i].trim() !== '') insertAt = i + 1;
  }
  lines.splice(insertAt, 0, bullet);
  return { md: lines.join('\n') };
}
