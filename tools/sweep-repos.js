#!/usr/bin/env node
// sweep-repos.js — which GitHub repos should a fleet-wide sweep cover ON THIS HOST?
//
// Answers the one question the daily-triage STEP 4 GitHub sweep never asked (#403). That step runs
// its `gh` commands in $HOME/dev/AgentSystem, so every command resolves against Zene8/AgentSystem
// and red CI, unlabeled issues and stale drafts in the other checkouts are not *missed* — they are
// never looked at. Confirmed 2026-08-13: Zene8/Basely draft PR #851 had only the GitGuardian check
// and a Dependabot run that failed the night before; neither could appear in that day's sweep.
//
// A repo's GitHub identity CANNOT be guessed from its registry slug: `genie` is `arboreyecare/genie`,
// not `Zene8/genie`. It is read from the recorded `github` field, else from the checkout's origin.
//
// Usage:
//   node tools/sweep-repos.js            # one `owner/name` per line — feed straight to `gh --repo`
//   node tools/sweep-repos.js --json     # full detail, including why a slug was skipped
//   node tools/sweep-repos.js --verbose  # human report on stderr
//
// Exit 0 with at least one repo, 1 when the registry yields none (a sweep of nothing is a bug, not
// a clean run — that is precisely the #403 failure mode).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from './is-main.js';
import { agentMemoryRoot } from './graph/graph-lib.js';
import { readRegistry, repoPathForHost, githubSlugForRepo, isGitHubSlug } from './graph/known-repos.js';

export const DEFAULT_REGISTRY = join(agentMemoryRoot(), 'nexus', 'known-repos.json');

/**
 * Sweepable repos for this host, plus the slugs that were skipped and why.
 *
 * A slug with no checkout here is SKIPPED, never fatal: the registry is shared by every host, so
 * "not on this machine" is the normal state of most entries and must not take the sweep down.
 *
 * @returns {{repos: Array<{slug,path,github,source}>, skipped: Array<{slug,reason,path}>}}
 */
export function sweepableRepos({ registryPath = DEFAULT_REGISTRY, platform = process.platform } = {}) {
  const repos = [];
  const skipped = [];
  for (const repo of readRegistry(registryPath).repos ?? []) {
    const slug = repo?.slug ?? '(unnamed)';
    const path = repoPathForHost(repo, platform);
    if (!path || !existsSync(path)) {
      skipped.push({ slug, reason: 'no-checkout-on-this-host', path: path ?? null });
      continue;
    }
    const github = githubSlugForRepo(repo, path);
    if (!github) {
      skipped.push({ slug, reason: 'no-github-origin-remote', path });
      continue;
    }
    repos.push({ slug, path, github, source: isGitHubSlug(repo?.github) ? 'registry' : 'git-remote' });
  }
  return { repos, skipped };
}

function main() {
  const args = process.argv.slice(2);
  const result = sweepableRepos();
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const r of result.repos) console.log(r.github);
    if (args.includes('--verbose')) {
      for (const r of result.repos) console.error(`  sweep: ${r.slug} → ${r.github} (${r.source}) @ ${r.path}`);
      for (const s of result.skipped) console.error(`  skip:  ${s.slug} — ${s.reason}`);
    }
  }
  if (result.repos.length === 0) {
    console.error(`sweep-repos: no sweepable repos from ${DEFAULT_REGISTRY} — a sweep would cover nothing.`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
