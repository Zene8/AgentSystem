#!/usr/bin/env node
/**
 * Repo allowlist validator
 * Validates repo slugs against known-repos.json
 * Prevents path traversal and arbitrary filesystem access
 */

/**
 * Validate and resolve a repo slug
 * @param {string} slug - Repo slug (e.g., 'agentsystem')
 * @param {object} knownRepos - Loaded known-repos.json object
 * @returns {{slug: string, path: string}} Validated repo entry
 * @throws {Error} If repo not in allowlist or slug is invalid
 */
export function validateRepo(slug, knownRepos) {
  // Reject invalid slugs (path traversal, absolute paths)
  if (!slug || typeof slug !== 'string') {
    throw new Error('Invalid repo slug: must be non-empty string');
  }

  if (slug.includes('/') || slug.includes('\\') || slug.includes('..') || slug.startsWith('/')) {
    throw new Error('Invalid repo slug: no paths allowed, use slug only');
  }

  // Case-insensitive lookup
  const repo = knownRepos.repos?.find(r => r.slug?.toLowerCase() === slug.toLowerCase());
  if (!repo) {
    throw new Error(`Repo "${slug}" not in allowlist`);
  }

  return {
    slug: repo.slug,
    path: repo.path,
  };
}

export default { validateRepo };
