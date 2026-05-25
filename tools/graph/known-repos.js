// known-repos.js — global registry of bootstrapped repos
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
  const idx = registry.repos.findIndex(r => r.slug === entry.slug);
  if (idx >= 0) {
    const repos = [...registry.repos];
    repos[idx] = { ...repos[idx], ...record };
    return { ...registry, repos };
  }
  return { ...registry, repos: [...registry.repos, record] };
}

export function findRepo(registry, slug) {
  return registry.repos.find(r => r.slug === slug) ?? null;
}
