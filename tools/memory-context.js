#!/usr/bin/env node
// memory-context.js — three-layer scoped read for agent startup.
// Merges: (1) global user brain (hot index), (2) active-project brain (detected from cwd),
// (3) recent episodic (latest SONA patterns). One cheap, oriented load instead of ls+read.
// Usage: node tools/memory-context.js [--cwd=PATH] [--recent=3]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentMemoryRoot, readGraph, parseFrontmatter } from './graph/graph-lib.js';

// Pure: find the repo whose path is a prefix of cwd (longest match wins). Returns slug or null.
export function detectProject(cwd, registry) {
  const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const c = norm(cwd);
  let best = null;
  for (const repo of registry.repos || []) {
    const rp = norm(repo.path);
    if (c === rp || c.startsWith(rp + '/')) {
      if (!best || rp.length > norm(best.path).length) best = repo;
    }
  }
  return best ? best.slug : null;
}

// Pure: given an array of { id, importance } objects (any order), return the top-N ids
// by descending importance. All facts remain queryable via graph-query; this is just the
// working-set cap for injected context (human working memory ≈ 4-7 chunks, Cowan 2001).
export function selectCoreFacts(facts, n) {
  return facts
    .slice()
    .sort((a, b) => b.importance - a.importance)
    .slice(0, n)
    .map(f => f.id);
}

function hotUserFacts(nexus) {
  const dir = join(nexus, 'personal-brain');
  const graphPath = join(dir, 'graph.json');
  if (!existsSync(graphPath)) return [];
  const graph = readGraph(graphPath);
  const out = [];
  for (const nodeId of graph.nodes) {
    const p = join(dir, 'nodes', `${nodeId}.md`);
    if (!existsSync(p)) continue;
    const { frontmatter } = parseFrontmatter(readFileSync(p, 'utf8'));
    if (frontmatter.hot === true) out.push({ id: nodeId, importance: parseFloat(frontmatter.importance ?? 0) || 0 });
  }
  return out;
}

function recentSona(nexus, n) {
  const p = join(nexus, 'sona-patterns.md');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n')
    .filter(l => l.startsWith('### '))
    .slice(-n)
    .map(l => l.replace(/^###\s+/, '').trim());
}

export function buildContext({ cwd = process.cwd(), recent = 3, core = 7 } = {}) {
  const nexus = join(agentMemoryRoot(), 'nexus');
  const registryPath = join(nexus, 'known-repos.json');
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : { repos: [] };
  const slug = detectProject(cwd, registry);

  const allFacts = hotUserFacts(nexus);
  const userCore = selectCoreFacts(allFacts, core);
  const userTotal = allFacts.length;

  const projectGraphPath = slug ? join(nexus, slug, 'graph.json') : null;
  const projectNodes = projectGraphPath && existsSync(projectGraphPath) ? readGraph(projectGraphPath).nodes.length : 0;
  const sona = recentSona(nexus, recent);

  return { slug, userCore, userTotal, projectNodes, sona };
}

function render(ctx) {
  const lines = [];
  lines.push('## Memory Context');
  lines.push('');
  const remainder = ctx.userTotal - ctx.userCore.length;
  const moreHint = remainder > 0 ? ` (+${remainder} more — query with graph-query)` : '';
  lines.push(`**User (top ${ctx.userCore.length} of ${ctx.userTotal}, by importance):** ${ctx.userCore.join(', ') || '(none)'}${moreHint}`);
  lines.push('');
  if (ctx.slug) {
    lines.push(`**Project [${ctx.slug}]:** ${ctx.projectNodes} nodes in brain — query: \`graph-query.js ${ctx.slug} <keywords>\``);
  } else {
    lines.push('**Project:** cwd not in a registered repo');
  }
  lines.push('');
  lines.push(`**Recent patterns:** ${ctx.sona.join(' | ') || '(none)'}`);
  return lines.join('\n');
}

const isMain = process.argv[1] &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const flags = {};
  for (const a of process.argv.slice(2)) { const m = a.match(/^--([\w-]+)=(.*)$/); if (m) flags[m[1]] = m[2]; }
  const ctx = buildContext({ cwd: flags.cwd || process.cwd(), recent: parseInt(flags.recent || '3'), core: parseInt(flags.core || '7') });
  console.log(render(ctx));
}
