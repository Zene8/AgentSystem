'use strict';
// secret-shield-vault.cjs — encrypted at-rest store mapping secret values <-> stable
// placeholders, per docs/secret-shield-contract.md.
//
// Crypto: AES-256-GCM. Key is 32 random bytes generated once at
// <home>/.claude/secret-shield/vault.key and reused forever (never rotated by this module).
// Each save picks a fresh random 12-byte nonce (GCM standard IV length) and stores
// `nonce || authTag || ciphertext` concatenated in the `.vault` file. The auth tag (16 bytes,
// produced by cipher.getAuthTag()) is what makes tampering / truncation fail loudly instead of
// silently: GCM decryption throws if the tag doesn't verify, and that throw is what gives us
// fail-closed behavior on a corrupted file.
//
// FAIL CLOSED: if the vault file exists but does not decrypt/authenticate, openVault THROWS.
// It never falls back to a fresh empty vault over an existing file — a reused placeholder would
// silently come to mean a different secret than it used to.
//
// Never render a secret value in a log, error, or thrown message (repo rule, see
// hooks/guard-secrets.js). Errors thrown here name only file paths, byte counts, and generic
// crypto failure descriptions.
//
// Windows note: fs.chmod / fs.chmodSync to 0o600 / 0o700 is effectively a NO-OP on win32 (Node
// applies only the read-only bit, not POSIX owner/group/other bits). We call chmod anyway on
// every platform for the hosts where it matters, but this file must never be read as a claim
// that vault files are access-restricted on Windows — they are not enforced by this module on
// that platform. See docs/secret-shield-contract.md.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32; // AES-256
const NONCE_LEN = 12; // GCM standard IV length
const TAG_LEN = 16; // GCM auth tag length

function secretShieldDir(home) {
  return path.join(home, '.claude', 'secret-shield');
}

function keyPath(home) {
  return path.join(secretShieldDir(home), 'vault.key');
}

function vaultPath(home, project) {
  return path.join(secretShieldDir(home), `${project}.vault`);
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** Attempt chmod; no-op-safe on win32 (see file header). Swallows errors on purpose — a
 *  permission tweak failing must not stop the vault from working. */
function tryChmod(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    /* best-effort only */
  }
}

function ensureDir(home) {
  const dir = secretShieldDir(home);
  fs.mkdirSync(dir, { recursive: true });
  tryChmod(dir, 0o700);
  return dir;
}

/** Load the AES-256 key, creating it (32 random bytes) on first use. Never rotated here. */
function loadOrCreateKey(home) {
  ensureDir(home);
  const kp = keyPath(home);
  if (fs.existsSync(kp)) {
    const buf = fs.readFileSync(kp);
    if (buf.length !== KEY_LEN) {
      throw new Error(`secret-shield: vault key file has unexpected length (expected ${KEY_LEN} bytes)`);
    }
    return buf;
  }
  const key = crypto.randomBytes(KEY_LEN);
  fs.writeFileSync(kp, key, { mode: 0o600 });
  tryChmod(kp, 0o600);
  return key;
}

/** Encrypt a JS object to the on-disk layout: nonce || authTag || ciphertext. */
function encryptState(key, stateObj) {
  const nonce = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, nonce);
  const plaintext = Buffer.from(JSON.stringify(stateObj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, authTag, ciphertext]);
}

/** Decrypt the on-disk layout back to a JS object. Throws (fail closed) on any tamper,
 *  truncation, or wrong key — never falls back to an empty state. */
function decryptState(key, fileBuf) {
  if (!Buffer.isBuffer(fileBuf) || fileBuf.length < NONCE_LEN + TAG_LEN) {
    throw new Error('secret-shield: vault file is truncated or malformed');
  }
  const nonce = fileBuf.subarray(0, NONCE_LEN);
  const authTag = fileBuf.subarray(NONCE_LEN, NONCE_LEN + TAG_LEN);
  const ciphertext = fileBuf.subarray(NONCE_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, nonce);
  decipher.setAuthTag(authTag);
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Do not leak any detail about *why* it failed (could hint at ciphertext structure).
    throw new Error('secret-shield: vault file failed to decrypt/authenticate — refusing to open (fail closed)');
  }
  try {
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new Error('secret-shield: vault file decrypted but contained invalid JSON — refusing to open (fail closed)');
  }
}

function emptyState() {
  return {
    // byValueHash: sha256(value) -> { placeholder, type, value, firstSeen, len }
    byValueHash: {},
    // counters: type -> next counter to allocate
    counters: {},
  };
}

function formatPlaceholder(type, n) {
  const nn = String(n).padStart(2, '0');
  return `__${type}_${nn}__`;
}

function openVault({ project, home } = {}) {
  if (!project || typeof project !== 'string') {
    throw new Error('secret-shield: openVault requires a { project } slug');
  }
  const resolvedHome = home || os.homedir();
  const key = loadOrCreateKey(resolvedHome);
  const vp = vaultPath(resolvedHome, project);

  let state;
  if (fs.existsSync(vp)) {
    const fileBuf = fs.readFileSync(vp);
    state = decryptState(key, fileBuf); // throws on corruption — fail closed, by design.
  } else {
    state = emptyState();
  }

  // Index placeholder -> hash for lookup(), built from the loaded state.
  const byPlaceholder = new Map();
  for (const [hash, entry] of Object.entries(state.byValueHash)) {
    byPlaceholder.set(entry.placeholder, hash);
  }

  let dirty = false;

  function persist() {
    if (!dirty) return;
    ensureDir(resolvedHome);
    const encrypted = encryptState(key, state);
    fs.writeFileSync(vp, encrypted, { mode: 0o600 });
    tryChmod(vp, 0o600);
    dirty = false;
  }

  function allocate(value, type) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('secret-shield: allocate requires a non-empty string value');
    }
    if (typeof type !== 'string' || type.length === 0) {
      throw new Error('secret-shield: allocate requires a non-empty string type');
    }
    const hash = sha256Hex(value);
    const existing = state.byValueHash[hash];
    if (existing) return existing.placeholder;

    const next = (state.counters[type] || 0) + 1;
    state.counters[type] = next;
    const placeholder = formatPlaceholder(type, next);

    state.byValueHash[hash] = {
      placeholder,
      type,
      value,
      firstSeen: new Date().toISOString(),
      len: value.length,
    };
    byPlaceholder.set(placeholder, hash);
    dirty = true;
    persist();
    return placeholder;
  }

  function lookup(placeholder) {
    const hash = byPlaceholder.get(placeholder);
    if (!hash) return null;
    const entry = state.byValueHash[hash];
    return entry ? entry.value : null;
  }

  function placeholderFor(value) {
    if (typeof value !== 'string') return null;
    const hash = sha256Hex(value);
    const entry = state.byValueHash[hash];
    return entry ? entry.placeholder : null;
  }

  /**
   * Every value this vault has ever redacted, WITH the plaintext, for the egress sweep in
   * secret-shield-redact.cjs. `list()` deliberately withholds values because it backs a
   * user-facing CLI; this one exists because the redactor cannot do its job without them.
   *
   * Why the redactor needs it: the detectors are contextual. `AWS_SECRET_ACCESS_KEY=<v>` is
   * recognised, a bare `<v>` on stdout is not — so a value that was rehydrated into a shell
   * command comes back UNMATCHED and leaks. A known-value sweep closes that hole by construction:
   * once a value has entered the vault, it can never appear in a tool result again, in any
   * context, whether or not a pattern recognises it. Caught by `the leak test`.
   *
   * Sorted longest-first so a value that contains another is replaced before its substring.
   */
  function knownValues() {
    return Object.values(state.byValueHash)
      .map((entry) => ({ value: entry.value, placeholder: entry.placeholder, type: entry.type }))
      .filter((e) => typeof e.value === 'string' && e.value.length > 0)
      .sort((a, b) => b.value.length - a.value.length);
  }

  function list() {
    return Object.entries(state.byValueHash).map(([hash, entry]) => ({
      placeholder: entry.placeholder,
      type: entry.type,
      valueSha256: hash,
      firstSeen: entry.firstSeen,
      len: entry.len,
    }));
  }

  function forget(placeholder) {
    const hash = byPlaceholder.get(placeholder);
    if (!hash) return false;
    delete state.byValueHash[hash];
    byPlaceholder.delete(placeholder);
    dirty = true;
    persist();
    return true;
  }

  function close() {
    persist();
  }

  return {
    allocate,
    lookup,
    placeholderFor,
    knownValues,
    list,
    forget,
    path: vp,
    close,
  };
}

module.exports = { openVault };
