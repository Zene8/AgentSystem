#!/usr/bin/env node
// secret-shield.js — inspect and control the secret shield (issue #222).
//
//   node tools/secret-shield.js status                 config, vault location, counts
//   node tools/secret-shield.js scan <path>            what WOULD be redacted in a file (dry run)
//   node tools/secret-shield.js vault list             placeholders, types, hashes — never values
//   node tools/secret-shield.js vault forget <token>   drop one mapping
//   node tools/secret-shield.js audit [n]              last n audit lines (default 20)
//
// `vault list` and `audit` deliberately never print a secret value. The whole point of the vault is
// that the plaintext lives in exactly one place; a CLI that echoes it back is a second place.
//
// ESM (tools/ rule), but the shield modules are CommonJS (hooks/ rule), hence createRequire.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isMainModule } from './is-main.js';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const { loadConfig } = require(path.join(REPO, 'hooks', 'lib', 'secret-shield-config.cjs'));
const { openVault } = require(path.join(REPO, 'hooks', 'lib', 'secret-shield-vault.cjs'));
const { detect } = require(path.join(REPO, 'hooks', 'lib', 'secret-shield-detect.cjs'));
const { shieldDir } = require(path.join(REPO, 'hooks', 'lib', 'secret-shield-redact.cjs'));

const HOME = process.env.SECRET_SHIELD_HOME || os.homedir();

function cmdStatus(cwd) {
  let config;
  try {
    config = loadConfig(cwd, process.env);
  } catch (err) {
    console.error(`config error: ${err.message}`);
    return 1;
  }

  console.log('secret-shield status');
  console.log(`  cwd          ${cwd}`);
  console.log(`  project      ${config.project}`);
  console.log(`  enabled      ${config.enabled}   mode: ${config.mode}`);
  console.log(`  entropy      ${config.entropy}`);
  console.log(`  rehydrate    ${config.rehydrate}${config.rehydrate ? '' : '   (off by default — placeholders are NOT substituted back)'}`);
  console.log(`  failClosed   ${config.failClosed}`);
  console.log(`  bypass       ${config.allowUnshielded}${config.allowUnshielded ? '   *** OUTPUT IS NOT SHIELDED ***' : ''}`);
  console.log(`  localModel   ${config.localModel.enabled ? config.localModel.model : 'disabled'}`);
  console.log(`  dir          ${shieldDir(HOME)}`);

  let vault;
  try {
    vault = openVault({ project: config.project, home: HOME });
  } catch (err) {
    console.log(`  vault        UNREADABLE — ${err.message}`);
    console.log('               (the shield fails closed while this is true: tool output is withheld)');
    return 1;
  }
  const entries = vault.list();
  console.log(`  vault        ${entries.length} mapping(s) at ${vault.path}`);
  vault.close();

  // Whether the hooks are actually WIRED is the difference between working and inert — see the
  // hooks note in CLAUDE.md. Report it rather than let a green status imply coverage.
  const settings = path.join(HOME, '.claude', 'settings.json');
  let wired = false;
  try {
    wired = fs.readFileSync(settings, 'utf8').includes('secret-shield-hook.js');
  } catch { /* no settings file: not wired */ }
  console.log(`  installed    ${wired ? 'yes' : 'NO — run: node tools/deploy-hooks.js'}`);
  return 0;
}

function cmdScan(cwd, target) {
  if (!target) { console.error('usage: secret-shield.js scan <path>'); return 2; }
  const file = path.resolve(cwd, target);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`cannot read ${file}: ${err.code || err.message}`);
    return 1;
  }
  let config;
  try { config = loadConfig(cwd, process.env); } catch { config = { detectors: null, entropy: true }; }

  const found = detect(text, { detectors: config.detectors, entropy: config.entropy !== false });
  if (found.length === 0) { console.log(`${file}: nothing detected`); return 0; }

  // Report line numbers and types only. Printing the value — or even a prefix of it — would put the
  // secret in this terminal's scrollback and in the transcript of whoever ran it.
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;
  console.log(`${file}: ${found.length} detection(s)`);
  for (const d of found) {
    console.log(`  line ${lineOf(d.start)}  ${d.type}  (${d.detector}, ${d.confidence}, ${d.value.length} bytes)`);
  }
  return 0;
}

function cmdVault(cwd, sub, arg) {
  let config;
  try { config = loadConfig(cwd, process.env); } catch (err) { console.error(err.message); return 1; }

  let vault;
  try {
    vault = openVault({ project: config.project, home: HOME });
  } catch (err) {
    console.error(`vault unreadable: ${err.message}`);
    return 1;
  }

  if (sub === 'list') {
    const entries = vault.list();
    if (entries.length === 0) console.log('vault is empty');
    for (const e of entries) {
      console.log(`${e.placeholder}  ${e.type}  sha256:${e.valueSha256.slice(0, 12)}  ${e.len} bytes  ${e.firstSeen}`);
    }
    vault.close();
    return 0;
  }

  if (sub === 'forget') {
    if (!arg) { console.error('usage: secret-shield.js vault forget <placeholder>'); vault.close(); return 2; }
    const ok = vault.forget(arg);
    console.log(ok ? `forgot ${arg}` : `no such placeholder: ${arg}`);
    vault.close();
    return ok ? 0 : 1;
  }

  vault.close();
  console.error('usage: secret-shield.js vault list|forget <placeholder>');
  return 2;
}

function cmdAudit(n) {
  const file = path.join(shieldDir(HOME), 'audit.jsonl');
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    console.log('no audit log yet');
    return 0;
  }
  for (const line of lines.slice(-n)) console.log(line);
  return 0;
}

function main(argv) {
  const cwd = process.cwd();
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case 'status': case undefined: return cmdStatus(cwd);
    case 'scan': return cmdScan(cwd, rest[0]);
    case 'vault': return cmdVault(cwd, rest[0], rest[1]);
    case 'audit': return cmdAudit(Number(rest[0]) || 20);
    default:
      console.error('usage: secret-shield.js status | scan <path> | vault list|forget <placeholder> | audit [n]');
      return 2;
  }
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

export { main };
