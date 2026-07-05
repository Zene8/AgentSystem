import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixSettingsText, loadCanonicalHashes } from './caveman-cache-fix.js';

test('loadCanonicalHashes reads hashes from nested "plugins" key (installed_plugins.json v2 shape)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-cache-fix-'));
  fs.mkdirSync(path.join(dir, 'plugins'));
  fs.writeFileSync(
    path.join(dir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'caveman@caveman': [{ version: '0d95a81d35a9', gitCommitSha: '0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0' }] },
    })
  );
  const hashes = loadCanonicalHashes(dir);
  assert.equal(hashes['caveman@caveman'], '0d95a81d35a9');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rewrites stale plugin cache hash to canonical hash', () => {
  const text = JSON.stringify({
    hooks: { SubagentStart: [{ command: 'node /c/Users/natha/.claude/plugins/cache/caveman/caveman/25d22f864ad6/src/hooks/caveman-activate.js' }] },
    statusLine: { command: 'node /c/Users/natha/.claude/plugins/cache/caveman/caveman/25d22f864ad6/src/hooks/statusline.js' },
  });
  const { fixed, changed, findings } = fixSettingsText(text, { 'caveman@caveman': '0d95a81d35a9' });
  assert.equal(changed, 2);
  assert.equal(findings[0].staleHash, '25d22f864ad6');
  assert.equal(findings[0].canonicalHash, '0d95a81d35a9');
  assert.ok(fixed.includes('0d95a81d35a9'));
  assert.ok(!fixed.includes('25d22f864ad6'));
});

test('no-op when hash already canonical', () => {
  const text = 'node /c/Users/natha/.claude/plugins/cache/caveman/caveman/0d95a81d35a9/src/hooks/caveman-activate.js';
  const { changed } = fixSettingsText(text, { 'caveman@caveman': '0d95a81d35a9' });
  assert.equal(changed, 0);
});

test('no-op when plugin has no canonical hash entry', () => {
  const text = 'node /c/Users/natha/.claude/plugins/cache/unknown/unknown/deadbeef1234/hook.js';
  const { changed } = fixSettingsText(text, { 'caveman@caveman': '0d95a81d35a9' });
  assert.equal(changed, 0);
});
