// sweep-repos.test.js — the multi-repo sweep target set (#403).
//
// The bug being locked down: the sweep covered one hardcoded repo, and a repo's GitHub identity
// cannot be recovered from its registry slug (`genie` is `arboreyecare/genie`, NOT `Zene8/genie`).
// So the load-bearing assertions are (a) the owner comes from the checkout's real origin remote,
// and (b) a slug with no checkout on this host is skipped rather than thrown on — the registry is
// shared by every host, so most entries are legitimately absent from any given one.
//
// Real temp git repos, no injected fakes: deriving the remote IS the thing under test.
//
// Run: node --test tools/sweep-repos.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepableRepos } from './sweep-repos.js';
import { parseGitHubSlug, githubSlugForRepo, isGitHubSlug, upsertRepo } from './graph/known-repos.js';

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'sweep-repos-'));
  test.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function gitRepoWithOrigin(parent, name, url) {
  const p = join(parent, name);
  mkdirSync(p, { recursive: true });
  execFileSync('git', ['init'], { cwd: p, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', url], { cwd: p, stdio: 'ignore' });
  return p;
}

function registry(dir, repos) {
  const p = join(dir, 'known-repos.json');
  writeFileSync(p, JSON.stringify({ version: '1.0', repos }), 'utf8');
  return p;
}

test('parseGitHubSlug handles https, ssh, .git and trailing slash', () => {
  assert.equal(parseGitHubSlug('https://github.com/arboreyecare/genie.git'), 'arboreyecare/genie');
  assert.equal(parseGitHubSlug('https://github.com/Zene8/Basely'), 'Zene8/Basely');
  assert.equal(parseGitHubSlug('git@github.com:Zene8/AgentSystem.git'), 'Zene8/AgentSystem');
  assert.equal(parseGitHubSlug('ssh://git@github.com/Zene8/AgentSystem.git'), 'Zene8/AgentSystem');
  assert.equal(parseGitHubSlug('https://github.com/Zene8/AgentSystem/'), 'Zene8/AgentSystem');
});

test('parseGitHubSlug returns null for a non-GitHub or absent remote', () => {
  assert.equal(parseGitHubSlug('https://gitlab.com/Zene8/thing.git'), null);
  assert.equal(parseGitHubSlug(''), null);
  assert.equal(parseGitHubSlug(undefined), null);
});

test('the sweep set spans every checkout present, with the owner read from origin — not the slug', () => {
  const d = tmp();
  // The #403 shapes exactly: a registry entry recording NO github field, whose real owner
  // (arboreyecare) differs from the org the slug sits under (Zene8).
  const genie = gitRepoWithOrigin(d, 'genie', 'https://github.com/arboreyecare/genie.git');
  const basely = gitRepoWithOrigin(d, 'Basely', 'git@github.com:Zene8/Basely.git');
  const path = registry(d, [
    { slug: 'genie', paths: { linux: genie, win32: 'C:/nope' } },
    { slug: 'basely', paths: { linux: basely, win32: 'C:/nope' } },
  ]);

  const { repos } = sweepableRepos({ registryPath: path, platform: 'linux' });

  assert.deepEqual(repos.map(r => r.github), ['arboreyecare/genie', 'Zene8/Basely']);
  assert.notEqual(repos[0].github, 'Zene8/genie'); // the guess the slug would have produced
  assert.equal(repos[0].source, 'git-remote');
});

test('a slug with no checkout on this host is skipped, not thrown on', () => {
  const d = tmp();
  const here = gitRepoWithOrigin(d, 'here', 'https://github.com/Zene8/AgentSystem.git');
  const path = registry(d, [
    { slug: 'agentsystem', paths: { linux: here } },
    { slug: 'ghost', paths: { linux: join(d, 'does-not-exist') } },
    { slug: 'windows-only', paths: { win32: 'C:/Users/natha/dev/thing' } },
  ]);

  const { repos, skipped } = sweepableRepos({ registryPath: path, platform: 'linux' });

  assert.deepEqual(repos.map(r => r.slug), ['agentsystem']);
  assert.deepEqual(skipped.map(s => s.slug), ['ghost', 'windows-only']);
  assert.equal(skipped[0].reason, 'no-checkout-on-this-host');
});

test('a checkout with no GitHub origin is skipped, not swept', () => {
  const d = tmp();
  const plain = join(d, 'plain');
  mkdirSync(plain);                                                  // not a git repo at all
  const gitlab = gitRepoWithOrigin(d, 'gl', 'https://gitlab.com/x/y.git');
  const path = registry(d, [
    { slug: 'plain', paths: { linux: plain } },
    { slug: 'gl', paths: { linux: gitlab } },
  ]);

  const { repos, skipped } = sweepableRepos({ registryPath: path, platform: 'linux' });

  assert.deepEqual(repos, []);
  assert.deepEqual(skipped.map(s => s.reason), ['no-github-origin-remote', 'no-github-origin-remote']);
});

test('a recorded github field is used verbatim, and works where git cannot answer', () => {
  const d = tmp();
  const plain = join(d, 'plain');
  mkdirSync(plain);                                                  // no git, no origin
  const path = registry(d, [{ slug: 'genie', github: 'arboreyecare/genie', paths: { linux: plain } }]);

  const { repos } = sweepableRepos({ registryPath: path, platform: 'linux' });

  assert.deepEqual(repos.map(r => [r.github, r.source]), [['arboreyecare/genie', 'registry']]);
});

test('both registry shapes coexist — a lagging entry without github still sweeps', () => {
  // known-repos.json syncs on its own schedule in the private agent-memory repo, so a host can run
  // this tool against a registry that predates the field. Mixed input must yield BOTH repos.
  const d = tmp();
  const derived = gitRepoWithOrigin(d, 'genie', 'https://github.com/arboreyecare/genie.git');
  const recorded = gitRepoWithOrigin(d, 'as', 'https://github.com/Zene8/AgentSystem.git');
  const path = registry(d, [
    { slug: 'genie', paths: { linux: derived } },
    { slug: 'agentsystem', github: 'Zene8/AgentSystem', paths: { linux: recorded } },
  ]);

  const { repos } = sweepableRepos({ registryPath: path, platform: 'linux' });

  assert.deepEqual(repos.map(r => r.github), ['arboreyecare/genie', 'Zene8/AgentSystem']);
  assert.deepEqual(repos.map(r => r.source), ['git-remote', 'registry']);
});

test('githubSlugForRepo ignores a malformed recorded field and falls back to origin', () => {
  const d = tmp();
  const p = gitRepoWithOrigin(d, 'g', 'https://github.com/arboreyecare/genie.git');
  assert.equal(githubSlugForRepo({ github: 'not a slug' }, p), 'arboreyecare/genie');
  assert.equal(githubSlugForRepo({ github: '' }, p), 'arboreyecare/genie');
  assert.equal(isGitHubSlug('owner/name'), true);
  assert.equal(isGitHubSlug('owner'), false);
});

test('upsertRepo records github, and re-bootstrap without it preserves what is there', () => {
  let reg = { version: '1.0', repos: [] };
  reg = upsertRepo(reg, { slug: 'genie', path: '/x/genie', github: 'arboreyecare/genie' });
  assert.equal(reg.repos[0].github, 'arboreyecare/genie');
  reg = upsertRepo(reg, { slug: 'genie', path: '/x/genie' });        // e.g. run on a host with no origin
  assert.equal(reg.repos[0].github, 'arboreyecare/genie');
});
