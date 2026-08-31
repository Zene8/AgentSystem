// secret-shield-no-sync.test.js — the vault must never replicate off this host (#222, Sam F4).
//
// The vault is `<home>/.claude/secret-shield/`: AES-256-GCM ciphertext next to the raw 32-byte key
// that decrypts it. Anything that copies those two files together copies the plaintext.
//
// `~/agent-memory` is a checkout of a git repo shared by EVERY host (see CLAUDE.md, "Central
// brain"), and this repo's sync tooling commits and pushes it on a 15-minute timer. So a tool that
// swept `~/.claude/**` into the brain — or wrote the shield dir under `~/agent-memory` — would push
// the vault key to every machine and into git history, silently, with a green exit code. This test
// exists so that a future edit to the sync tooling fails here instead.
//
// It is a STRUCTURAL check, not a behavioural one: it reads the sources. That is the point — the
// leak would be introduced by a source change, and it would never show up in a passing run of the
// sync tools themselves.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything that reads, writes, commits or pushes ~/agent-memory.
const BRAIN_TOOLS = [
  'tools/brain-sync.js',
  'tools/brain-sync-run.js',
  'tools/brain-join.sh',
  'tools/brain-remember.js',
  'tools/bootstrap-repo.js',
  'hooks/continuous-sync-hook.js',
];

test('no agent-memory sync tool touches ~/.claude at all', () => {
  for (const rel of BRAIN_TOOLS) {
    const file = path.join(REPO, rel);
    if (!fs.existsSync(file)) continue; // renamed/removed: the other tests here still hold
    const src = fs.readFileSync(file, 'utf8');
    // Strip comments so prose explaining this very rule does not trip it: line comments,
    // shell comments, and block-comment continuation lines (` * ...`) alike.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|#|\*|\/\*)/.test(l))
      .join('\n');
    assert.ok(
      !code.includes('.claude'),
      `${rel} references ~/.claude. The brain is pushed to a repo shared by every host, so ` +
        `anything reachable from a brain-sync path can replicate the secret-shield vault key. ` +
        `If this reference is genuinely safe, narrow it and add it to this test deliberately.`
    );
  }
});

test('the shield directory lives under ~/.claude, never under ~/agent-memory', () => {
  const redact = fs.readFileSync(path.join(REPO, 'hooks', 'lib', 'secret-shield-redact.cjs'), 'utf8');
  const vault = fs.readFileSync(path.join(REPO, 'hooks', 'lib', 'secret-shield-vault.cjs'), 'utf8');
  for (const [name, src] of [['redact', redact], ['vault', vault]]) {
    assert.ok(
      !src.includes('agent-memory') && !src.includes('nexus'),
      `${name} module names an agent-memory path — the vault must not be written into the shared brain`
    );
    assert.match(src, /'\.claude'/, `${name} module should resolve the shield dir under .claude`);
  }
});

test('no repo tool other than the shield itself names the secret-shield directory', () => {
  const dirs = ['tools', 'hooks', 'hooks/lib'];
  const offenders = [];
  for (const dir of dirs) {
    const full = path.join(REPO, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (!/\.(js|cjs|mjs|sh|ps1)$/.test(f)) continue;
      if (f.startsWith('secret-shield')) continue; // the shield may name its own home
      const src = fs.readFileSync(path.join(full, f), 'utf8');
      if (src.includes('secret-shield/') || src.includes("'secret-shield'")) {
        // deploy-hooks.js registers the hook by filename; that is not a directory reference.
        if (src.includes('secret-shield-hook') && !src.includes('secret-shield/')) continue;
        offenders.push(`${dir}/${f}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'these files name the secret-shield vault directory. Only the shield may. A copy, tar, or ' +
      'sync of that path moves the vault key off this host: ' + offenders.join(', ')
  );
});
