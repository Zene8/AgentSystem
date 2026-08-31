'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { openVault } = require('./secret-shield-vault.cjs');
const { FIXTURES } = require('./secret-shield-fixtures.cjs');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'secret-shield-vault-test-'));
}

const PROJECT = 'test-project';

test('allocate is deterministic and idempotent for the same value', () => {
  const home = tmpHome();
  const vault = openVault({ project: PROJECT, home });
  const p1 = vault.allocate(FIXTURES.awsAccessKeyFake, 'SECRET_AWS_ACCESS_KEY');
  const p2 = vault.allocate(FIXTURES.awsAccessKeyFake, 'SECRET_AWS_ACCESS_KEY');
  assert.equal(p1, p2);
  vault.close();
});

test('two different values of the same type get _01__ and _02__', () => {
  const home = tmpHome();
  const vault = openVault({ project: PROJECT, home });
  const p1 = vault.allocate('sk-fakeFakeFakeFakeFake1', 'SECRET_OPENAI_KEY');
  const p2 = vault.allocate('sk-fakeFakeFakeFakeFake2', 'SECRET_OPENAI_KEY');
  assert.equal(p1, '__SECRET_OPENAI_KEY_01__');
  assert.equal(p2, '__SECRET_OPENAI_KEY_02__');
  vault.close();
});

test('placeholder survives close + reopen from disk (turn 1 / turn 10 criterion)', () => {
  const home = tmpHome();
  const secret = FIXTURES.githubTokenFake;
  const vault1 = openVault({ project: PROJECT, home });
  const placeholder1 = vault1.allocate(secret, 'SECRET_GITHUB_TOKEN');
  vault1.close();

  const vault2 = openVault({ project: PROJECT, home });
  const placeholder2 = vault2.allocate(secret, 'SECRET_GITHUB_TOKEN');
  assert.equal(placeholder2, placeholder1);
  assert.equal(vault2.lookup(placeholder1), secret);
  vault2.close();
});

test('lookup round-trips the exact value; unknown placeholder is null', () => {
  const home = tmpHome();
  const vault = openVault({ project: PROJECT, home });
  const secret = FIXTURES.slackToken;
  const placeholder = vault.allocate(secret, 'SECRET_SLACK_TOKEN');
  assert.equal(vault.lookup(placeholder), secret);
  assert.equal(vault.lookup('__SECRET_SLACK_TOKEN_99__'), null);
  vault.close();
});

test('list() output contains no value bytes', () => {
  const home = tmpHome();
  const vault = openVault({ project: PROJECT, home });
  const secret = 'sk-ant-api03-fakeFakeFakeFakeFakeFakeFakeFake';
  vault.allocate(secret, 'SECRET_ANTHROPIC_KEY');
  const listing = vault.list();
  const json = JSON.stringify(listing);
  assert.equal(json.includes(secret), false);
  assert.ok(listing.length >= 1);
  assert.ok(listing[0].placeholder);
  assert.ok(listing[0].valueSha256);
  assert.equal(listing[0].valueSha256, crypto.createHash('sha256').update(secret, 'utf8').digest('hex'));
  vault.close();
});

test('forget removes a placeholder immediately and after reopen', () => {
  const home = tmpHome();
  const secret = 'AIzaFakeFakeFakeFakeFakeFakeFakeFakeFak';
  const vault1 = openVault({ project: PROJECT, home });
  const placeholder = vault1.allocate(secret, 'SECRET_GCP_KEY');
  assert.equal(vault1.forget(placeholder), true);
  assert.equal(vault1.lookup(placeholder), null);
  vault1.close();

  const vault2 = openVault({ project: PROJECT, home });
  assert.equal(vault2.lookup(placeholder), null);
  vault2.close();
});

test('forget on unknown placeholder returns false', () => {
  const home = tmpHome();
  const vault = openVault({ project: PROJECT, home });
  assert.equal(vault.forget('__SECRET_GCP_KEY_01__'), false);
  vault.close();
});

test('vault file is encrypted at rest: raw bytes do not contain the plaintext secret', () => {
  const home = tmpHome();
  const secret = 'super-secret-plaintext-marker-value-12345';
  const vault = openVault({ project: PROJECT, home });
  vault.allocate(secret, 'SECRET_ENTROPY');
  vault.close();

  const raw = fs.readFileSync(vault.path);
  assert.equal(raw.includes(Buffer.from(secret, 'utf8')), false);
});

test('fail closed: corrupted vault file (flipped byte) throws on open, no secret in message', () => {
  const home = tmpHome();
  const secret = 'corruption-test-secret-value-abcdef123456';
  const vault = openVault({ project: PROJECT, home });
  vault.allocate(secret, 'SECRET_JWT');
  vault.close();

  const raw = fs.readFileSync(vault.path);
  raw[raw.length - 1] ^= 0xff; // flip last byte of ciphertext
  fs.writeFileSync(vault.path, raw);

  assert.throws(
    () => openVault({ project: PROJECT, home }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes(secret), false);
      return true;
    }
  );
});

test('fail closed: truncated vault file throws on open, no secret in message, and does not fall back to a fresh vault', () => {
  const home = tmpHome();
  const secret = 'truncation-test-secret-value-ghijkl789012';
  const vault = openVault({ project: PROJECT, home });
  const placeholder = vault.allocate(secret, 'SECRET_STRIPE_KEY');
  vault.close();

  const raw = fs.readFileSync(vault.path);
  fs.writeFileSync(vault.path, raw.subarray(0, Math.floor(raw.length / 2)));
  void placeholder; // unused beyond documenting what was allocated before truncation

  assert.throws(
    () => openVault({ project: PROJECT, home }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes(secret), false);
      return true;
    }
  );
});

test('key file is created once and reused across openVault calls (no rotation)', () => {
  const home = tmpHome();
  const vault1 = openVault({ project: PROJECT, home });
  vault1.close();
  const keyFile = path.join(home, '.claude', 'secret-shield', 'vault.key');
  assert.ok(fs.existsSync(keyFile));
  const key1 = fs.readFileSync(keyFile);

  const vault2 = openVault({ project: PROJECT, home });
  vault2.close();
  const key2 = fs.readFileSync(keyFile);

  assert.equal(Buffer.compare(key1, key2), 0);
});

if (process.platform !== 'win32') {
  test('vault dir and files are mode 600/700 on POSIX', () => {
    const home = tmpHome();
    const vault = openVault({ project: PROJECT, home });
    vault.allocate('posix-mode-check-secret-value', 'SECRET_CONNECTION_STRING');
    vault.close();

    const dir = path.join(home, '.claude', 'secret-shield');
    const dirMode = fs.statSync(dir).mode & 0o777;
    const fileMode = fs.statSync(vault.path).mode & 0o777;
    const keyMode = fs.statSync(path.join(dir, 'vault.key')).mode & 0o777;

    assert.equal(dirMode, 0o700);
    assert.equal(fileMode, 0o600);
    assert.equal(keyMode, 0o600);
  });
}
