/**
 * agent-trust.js — parse trust-scores.md and look up agent trust scores.
 *
 * Exported as pure functions so they can be unit-tested with injected fixtures
 * and also dynamically imported by the CommonJS memory-router.js hook.
 *
 * Format B (on-disk): frontmatter + markdown table with columns
 *   Agent | Score | Tasks | Last Updated | Notes
 * where Score is a 0–1 float (or trailing % stripped / divided by 100).
 */

export const TRUST_THRESHOLD = 0.6;

/**
 * parseTrustScores(md) → { [agentLower]: number }
 *
 * Parses the markdown table in the trust-scores.md file.
 * Handles: 0-1 floats ("0.82"), percentage strings ("82%"), missing rows.
 * Returns empty object if the table cannot be found or parsed.
 */
export function parseTrustScores(md) {
  if (!md || typeof md !== 'string') return {};

  const lines = md.split('\n');
  let inTable = false;
  let headerParsed = false;
  let scoreColIndex = -1;
  const result = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) { inTable = false; headerParsed = false; continue; }

    const cells = trimmed.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);

    if (!headerParsed) {
      const lc = cells.map(c => c.toLowerCase());
      scoreColIndex = lc.indexOf('score');
      if (scoreColIndex === -1) scoreColIndex = lc.indexOf('success rate');
      if (scoreColIndex !== -1) { inTable = true; headerParsed = true; }
      continue;
    }

    // separator row: |---|---|
    if (trimmed.replace(/[\s|:-]/g, '') === '') continue;

    if (!inTable || scoreColIndex === -1 || cells.length <= scoreColIndex) continue;

    const agentRaw = cells[0];
    const scoreRaw = cells[scoreColIndex];
    if (!agentRaw || !scoreRaw) continue;

    const agent = agentRaw.toLowerCase().trim();
    let score;
    if (scoreRaw.endsWith('%')) {
      score = parseFloat(scoreRaw) / 100;
    } else {
      score = parseFloat(scoreRaw);
    }
    if (!isNaN(score)) result[agent] = score;
  }

  return result;
}

/**
 * trustFor(agent, scores) → number | null
 *
 * Returns the trust score for the given agent name (case-insensitive).
 * Returns null if not found.
 */
export function trustFor(agent, scores) {
  if (!agent || !scores) return null;
  const key = agent.toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(scores, key) ? scores[key] : null;
}

/**
 * composeHintWithTrust(baseHint, agentDisplayName, scores) → string
 *
 * Appends a trust annotation to a routing hint.
 * agentDisplayName is e.g. "Leo (DevOps)" — we extract the first token as the key.
 * If trust < TRUST_THRESHOLD: appends a "consider review / pair" warning.
 * If trust is unknown: appends nothing (hint passes through unchanged).
 */
export function composeHintWithTrust(baseHint, agentDisplayName, scores) {
  if (!baseHint) return baseHint;
  if (!agentDisplayName || !scores) return baseHint;

  const key = agentDisplayName.split(/[\s(]/)[0].toLowerCase();
  const score = trustFor(key, scores);
  if (score === null) return baseHint;

  const pct = Math.round(score * 100);
  const warning = score < TRUST_THRESHOLD ? ' — trust low: consider review or pair' : '';
  return `${baseHint} [trust: ${pct}%${warning}]`;
}
