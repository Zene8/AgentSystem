'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig, projectSlug } = require('./secret-shield-config.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'secret-shield-config-test-'));
}

test('defaults with no .secret-shield.json present', () => {
  const cwd = tmpDir();
  const cfg = loadConfig(cwd, {});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.mode, 'obfuscate');
  assert.equal(cfg.detectors, null);
  assert.equal(cfg.entropy, true);
  assert.equal(cfg.rehydrate, false);
  assert.equal(cfg.allowUnshielded, false);
  assert.equal(cfg.failClosed, true);
  assert.deepEqual(cfg.localModel, { enabled: false, url: null, model: null });
  assert.deepEqual(cfg.pathRules, []);
  assert.equal(cfg.project, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
});

test('.secret-shield.json overrides a subset of defaults', () => {
  const cwd = tmpDir();
  fs.writeFileSync(
    path.join(cwd, '.secret-shield.json'),
    JSON.stringify({ entropy: false, detectors: ['SECRET_AWS_ACCESS_KEY'] })
  );
  const cfg = loadConfig(cwd, {});
  assert.equal(cfg.entropy, false);
  assert.deepEqual(cfg.detectors, ['SECRET_AWS_ACCESS_KEY']);
  // untouched fields keep defaults
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.rehydrate, false);
});

test('rehydrate defaults to false even when file sets other fields', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, '.secret-shield.json'), JSON.stringify({ enabled: true }));
  const cfg = loadConfig(cwd, {});
  assert.equal(cfg.rehydrate, false);
});

test('.secret-shield.json can explicitly opt in to rehydrate', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, '.secret-shield.json'), JSON.stringify({ rehydrate: true }));
  const cfg = loadConfig(cwd, {});
  assert.equal(cfg.rehydrate, true);
});

test('SECRET_SHIELD_ALLOW_UNSHIELDED=1 in env sets allowUnshielded', () => {
  const cwd = tmpDir();
  const cfg = loadConfig(cwd, { SECRET_SHIELD_ALLOW_UNSHIELDED: '1' });
  assert.equal(cfg.allowUnshielded, true);
});

test('SECRET_SHIELD_ALLOW_UNSHIELDED unset or not "1" leaves allowUnshielded false', () => {
  const cwd = tmpDir();
  assert.equal(loadConfig(cwd, {}).allowUnshielded, false);
  assert.equal(loadConfig(cwd, { SECRET_SHIELD_ALLOW_UNSHIELDED: '0' }).allowUnshielded, false);
  assert.equal(loadConfig(cwd, { SECRET_SHIELD_ALLOW_UNSHIELDED: 'true' }).allowUnshielded, false);
});

test('malformed JSON throws', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, '.secret-shield.json'), '{ not valid json');
  assert.throws(() => loadConfig(cwd, {}), /not valid JSON/);
});

test('project slug matches path.resolve(cwd).replace(/[^A-Za-z0-9]/g, "-")', () => {
  const cwd = tmpDir();
  const cfg = loadConfig(cwd, {});
  assert.equal(cfg.project, projectSlug(cwd));
  assert.equal(cfg.project, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
});
