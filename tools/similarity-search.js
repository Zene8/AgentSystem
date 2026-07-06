#!/usr/bin/env node
// similarity-search.js — BM25-based fact similarity and contradiction detection
// Pure functions only. Zero npm dependencies.
// Used by brain-remember.js to detect conflicting facts at write time.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './graph/graph-lib.js';

// Tokenize for similarity — strip punctuation, lowercase, minimal normalization.
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0);
}

// Extract significant tokens from a fact (those that carry semantic meaning).
// Subject: "user", "i", "my" + noun/adjective
// Object: the value being described, e.g. "npm", "pnpm", "dark mode"
// Cheap heuristic: tokens after first 2 words are likely values.
export function extractTokens(fact) {
  const tokens = tokenize(fact);
  if (tokens.length < 3) return tokens;

  // All tokens are significant for matching
  return tokens;
}

// Jaccard similarity between two token lists.
export function jaccardSimilarity(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter(t => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Detect whether two facts have conflicting polarity/value.
// Cheap heuristic: same subject tokens, but key values differ.
// Example: "user prefers npm" vs "user prefers pnpm" → same subject (user, prefers), different value (npm vs pnpm)
// Another example: "i use vim for editing" vs "i use emacs for editing" → same subject (i, use), different secondary (vim vs emacs)
export function hasConflictingPolarity(fact1, fact2) {
  const tokens1 = extractTokens(fact1);
  const tokens2 = extractTokens(fact2);

  if (tokens1.length < 2 || tokens2.length < 2) return false;

  // Strategy: check first N tokens as "subject skeleton" (e.g., "user prefers", "i use")
  // The number of subject tokens is roughly 33% of the total (accounting for filler words already removed)
  const subjectLen = Math.max(2, Math.floor(Math.min(tokens1.length, tokens2.length) / 3));
  const subject1 = tokens1.slice(0, subjectLen);
  const subject2 = tokens2.slice(0, subjectLen);
  const rest1 = tokens1.slice(subjectLen);
  const rest2 = tokens2.slice(subjectLen);

  const subjectSim = jaccardSimilarity(subject1, subject2);
  const restSim = jaccardSimilarity(rest1, rest2);

  // Conflict: high subject similarity but the rest has significant differences
  // (allowing up to 70% similarity in the rest part, which accounts for common modifiers like "for", "to", etc.)
  return subjectSim > 0.5 && restSim <= 0.7 && rest1.length > 0 && rest2.length > 0;
}

// Find high-overlap candidates for a new fact from a list of existing node objects.
// Returns top 3 candidates, each with { nodeId, similarity, hasConflict }.
// nodeObjects: array of { id, content } where content is the markdown file content
export function findHighOverlapCandidates(newFact, nodeObjects, { top = 3, similarityThreshold = 0.45 } = {}) {
  const newTokens = extractTokens(newFact);
  if (newTokens.length === 0) return [];

  const candidates = [];
  for (const node of nodeObjects) {
    const { id, content, frontmatter } = node;

    // Skip already-superseded nodes
    if (frontmatter && frontmatter.superseded_by) continue;

    // Extract text from node content body (not ID, to avoid diluting similarity)
    const { body } = parseFrontmatter(content);
    const nodeTokens = extractTokens(body);

    if (nodeTokens.length === 0) continue;

    const similarity = jaccardSimilarity(newTokens, nodeTokens);
    if (similarity >= similarityThreshold) {
      const hasConflict = hasConflictingPolarity(newFact, body);
      candidates.push({ nodeId: id, similarity, hasConflict });
    }
  }

  // Sort by similarity (highest first), return top N
  return candidates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, top);
}

// Load all nodes from a brain directory for similarity searching.
// Returns array of { id, content, frontmatter }
export function loadNodesForSearch(nodesDir, graphNodeIds = []) {
  const nodes = [];
  for (const nodeId of graphNodeIds) {
    const nodePath = join(nodesDir, `${nodeId}.md`);
    if (!existsSync(nodePath)) continue;
    try {
      const content = readFileSync(nodePath, 'utf8');
      const { frontmatter } = parseFrontmatter(content);
      nodes.push({ id: nodeId, content, frontmatter });
    } catch {
      // Non-fatal: skip malformed nodes
    }
  }
  return nodes;
}

// Update a node's frontmatter to mark it as superseded.
// Returns the updated content.
export function markSuperseded(content, newNodeId, date = new Date().toISOString().slice(0, 10)) {
  const { frontmatter, body } = parseFrontmatter(content);
  const updated = {
    ...frontmatter,
    superseded_by: newNodeId,
    superseded_date: date,
  };
  const toYaml = (obj) => {
    return Object.entries(obj).map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`;
        if (k === 'connections') {
          return `${k}:\n${v.map(s => `  - "${s}"`).join('\n')}`;
        }
        return `${k}: [${v.map(s => String(s)).join(', ')}]`;
      }
      return `${k}: ${v}`;
    }).join('\n') + '\n';
  };
  return `---\n${toYaml(updated)}---\n\n${body.trimStart()}`;
}
