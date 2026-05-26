import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { readRegistry, writeRegistry, upsertRepo, findRepo } from '../tools/graph/known-repos.js';

function tmp() {
  const d = join(tmpdir(), `kr-test-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

test('readRegistry returns empty registry if file missing', () => {
  const dir = tmp();
  const reg = readRegistry(join(dir, 'known-repos.json'));
  assert.equal(reg.version, '1.0');
  assert.deepEqual(reg.repos, []);
  rmSync(dir, { recursive: true });
});

test('upsertRepo adds new entry', () => {
  const dir = tmp();
  const path = join(dir, 'known-repos.json');
  let reg = readRegistry(path);
  reg = upsertRepo(reg, { slug: 'myrepo', path: '/tmp/myrepo', primary_cli: 'claude' });
  assert.equal(reg.repos.length, 1);
  assert.equal(reg.repos[0].slug, 'myrepo');
  assert.equal(reg.repos[0].bootstrap_complete, true);
  rmSync(dir, { recursive: true });
});

test('upsertRepo updates existing entry idempotent', () => {
  const dir = tmp();
  const path = join(dir, 'known-repos.json');
  let reg = readRegistry(path);
  reg = upsertRepo(reg, { slug: 'myrepo', path: '/tmp/myrepo', primary_cli: 'claude' });
  reg = upsertRepo(reg, { slug: 'myrepo', path: '/tmp/myrepo-new', primary_cli: 'gemini' });
  assert.equal(reg.repos.length, 1);
  assert.equal(reg.repos[0].path, '/tmp/myrepo-new');
  assert.equal(reg.repos[0].primary_cli, 'gemini');
  rmSync(dir, { recursive: true });
});

test('findRepo returns entry by slug', () => {
  const dir = tmp();
  const path = join(dir, 'known-repos.json');
  let reg = readRegistry(path);
  reg = upsertRepo(reg, { slug: 'target', path: '/a', primary_cli: 'claude' });
  reg = upsertRepo(reg, { slug: 'other', path: '/b', primary_cli: 'claude' });
  const found = findRepo(reg, 'target');
  assert.equal(found.path, '/a');
  assert.equal(findRepo(reg, 'nope'), null);
  rmSync(dir, { recursive: true });
});

test('writeRegistry + readRegistry round-trip', () => {
  const dir = tmp();
  const path = join(dir, 'known-repos.json');
  let reg = readRegistry(path);
  reg = upsertRepo(reg, { slug: 'rt', path: '/rt', primary_cli: 'claude' });
  writeRegistry(path, reg);
  const loaded = readRegistry(path);
  assert.equal(loaded.repos.length, 1);
  assert.equal(loaded.repos[0].slug, 'rt');
  rmSync(dir, { recursive: true });
});
