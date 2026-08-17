// known-repos.js — global registry of bootstrapped repos
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

export function readRegistry(registryPath) {
  if (!existsSync(registryPath)) return { version: '1.0', repos: [] };
  try {
    return JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch (e) {
    console.warn(`known-repos: malformed registry at ${registryPath} — returning empty. Error: ${e.message}`);
    return { version: '1.0', repos: [] };
  }
}

export function writeRegistry(registryPath, registry) {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

export function upsertRepo(registry, entry) {
  const today = new Date().toISOString().slice(0, 10);
  const record = {
    slug: entry.slug,
    path: entry.path,
    brain_path: entry.brain_path ?? `nexus/${entry.slug}/graph.json`,
    last_init: today,
    primary_cli: entry.primary_cli ?? 'claude',
    bootstrap_complete: true,
  };
  // Only set description when explicitly provided — otherwise the spread below
  // preserves any existing description on re-bootstrap (never clobber to empty).
  if (typeof entry.description === 'string' && entry.description.trim()) {
    record.description = entry.description.trim();
  }
  // Same rule for the GitHub identity: set it when known, otherwise let the spread below keep
  // whatever is already recorded. A slug is NOT a GitHub name (`genie` is `arboreyecare/genie`),
  // so this can only ever come from the checkout's origin remote — never be guessed.
  if (isGitHubSlug(entry.github)) record.github = entry.github.trim();
  const idx = registry.repos.findIndex(r => r.slug === entry.slug);
  if (idx >= 0) {
    const repos = [...registry.repos];
    repos[idx] = { ...repos[idx], ...record };
    return { ...registry, repos };
  }
  return { ...registry, repos: [...registry.repos, record] };
}

/**
 * The filesystem path for a repo ON THIS HOST.
 *
 * known-repos.json lives in ~/agent-memory, which is one registry SHARED by every host, so a single
 * `path` cannot be right everywhere: the laptop's checkouts are at `C:/Users/natha/dev/...` and the
 * Mission Control server's are under `/home/basely`. Until #220 this stored only the Windows paths,
 * so on Linux every entry pointed at a directory that does not exist — and stage 2 validates every
 * code item against this registry, which meant it could not dispatch a single one.
 *
 * Resolution order, first hit wins:
 *   1. `paths[process.platform]`  — explicit per-platform entry
 *   2. `path`                     — the legacy single field, still correct on the host that wrote it
 * Returns null when nothing resolves, which callers must treat as "not available here" rather than
 * as a bad slug — the repo may be perfectly valid on another host.
 */
export function repoPathForHost(repo, platform = process.platform) {
  if (!repo) return null;
  const fromMap = repo.paths && typeof repo.paths === 'object' ? repo.paths[platform] : null;
  return fromMap || repo.path || null;
}

export function findRepo(registry, slug) {
  return registry.repos.find(r => r.slug === slug) ?? null;
}

/** `owner/name` shape check — one slash, no whitespace, both halves non-empty. */
export function isGitHubSlug(v) {
  return typeof v === 'string' && /^[^/\s]+\/[^/\s]+$/.test(v.trim());
}

/**
 * `owner/name` from a git remote URL, or null when the remote is not GitHub.
 * Handles https, ssh (`git@github.com:o/n.git`), `ssh://`, and an optional `.git` / trailing slash.
 */
export function parseGitHubSlug(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null;
  const m = remoteUrl.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** origin's URL for a checkout, or null when the dir is not a git repo / has no origin. */
export function gitOriginUrl(repoPath) {
  try {
    // cwd, not `git -C`: same result, and it fails cleanly when repoPath does not exist.
    return execFileSync('git', ['remote', 'get-url', 'origin'],
      { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The GitHub `owner/name` for a registry entry: the recorded `github` field when present,
 * otherwise derived from the checkout's origin remote. Null when neither is available.
 *
 * Both shapes are accepted on purpose. known-repos.json lives in the separately-synced private
 * `agent-memory` repo, so a host can be running today's tooling against a registry that predates
 * the `github` field — deriving from origin keeps that host sweeping instead of silently covering
 * nothing.
 */
export function githubSlugForRepo(repo, repoPath) {
  if (isGitHubSlug(repo?.github)) return repo.github.trim();
  return repoPath ? parseGitHubSlug(gitOriginUrl(repoPath)) : null;
}
