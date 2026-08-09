#!/usr/bin/env node
// install-brain-sync-timer.sh — the host timer that covers a machine with no session on it (#341).
//
// The installer itself is barely worth testing; `--check` very much is. It runs in the daily
// enforcement-drift job, and a drift check has exactly two ways to be useless: green when the timer
// is gone (the outage stays silent, which is #340), or red on a healthy host (people mute it, and
// then the outage stays silent anyway). Both are tested here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'install-brain-sync-timer.sh');

// Git Bash on Windows, /bin/bash on Linux. If neither is here the whole file skips rather than
// failing — a missing bash says nothing about the timer.
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

function run(args, configHome) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: configHome },
  });
}

const scratch = () => mkdtempSync(join(tmpdir(), 'timer-check-'));

/** A unit pair that should pass --check: real script path, conflict exit code, repeat interval. */
function installUnits(configHome, { execScript = join(HERE, 'brain-sync-run.js'), successLine = 'SuccessExitStatus=0 3', interval = 'OnUnitActiveSec=15min' } = {}) {
  const dir = join(configHome, 'systemd', 'user');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brain-sync.service'),
    `[Service]\nType=oneshot\nExecStart=/usr/bin/node ${execScript}\n${successLine}\n`);
  writeFileSync(join(dir, 'brain-sync.timer'),
    `[Timer]\nOnBootSec=2min\n${interval}\nPersistent=true\n`);
  return dir;
}

test('--dry-run prints both units and writes nothing', { skip: !hasBash }, () => {
  const home = scratch();
  const r = run(['--dry-run'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /brain-sync\.service/);
  assert.match(r.stdout, /brain-sync\.timer/);
  assert.match(r.stdout, /enable-linger/, 'without linger the timer dies at logout, which is the whole point');
  assert.equal(existsSync(join(home, 'systemd')), false, '--dry-run installed something');
});

test('--dry-run keeps the conflict exit code out of systemd failure territory', { skip: !hasBash }, () => {
  const r = run(['--dry-run'], scratch());
  assert.match(r.stdout, /SuccessExitStatus=0 3/,
    'exit 3 means "conflict found, human alerted" — without this systemd reads a working sync as failed');
  assert.match(r.stdout, /Persistent=true/, 'a host that was off must catch up, not skip the missed window');
});

test('--check fails when the timer was never installed', { skip: !hasBash }, () => {
  const r = run(['--check-units'], scratch());
  assert.equal(r.status, 1, 'a host with no timer reported healthy');
  assert.match(r.stdout, /missing/);
});

test('--check passes on a healthy install', { skip: !hasBash }, () => {
  const home = scratch();
  installUnits(home);
  const r = run(['--check-units'], home);
  assert.equal(r.status, 0, `healthy install reported drift:\n${r.stdout}`);
  assert.match(r.stdout, /in sync/);
});

test('--check passes even though the unit was written from a different checkout path', { skip: !hasBash }, () => {
  // The CI job checks out into the runner workspace; the installed unit points at ~/dev/AgentSystem.
  // Byte-comparing the generated unit would fail here, on a host that is entirely fine.
  const home = scratch();
  installUnits(home);
  const r = run(['--check-units'], home);
  assert.equal(r.status, 0, r.stdout);
});

test('--check catches a unit pointing at a checkout that moved', { skip: !hasBash }, () => {
  const home = scratch();
  installUnits(home, { execScript: join(scratch(), 'gone', 'brain-sync-run.js') });
  const r = run(['--check-units'], home);
  assert.equal(r.status, 1, 'a timer running a script that no longer exists reported healthy');
  assert.match(r.stdout, /not there/);
});

test('--check catches a service that would mark a raised alert as a failure', { skip: !hasBash }, () => {
  const home = scratch();
  installUnits(home, { successLine: '' });
  const r = run(['--check-units'], home);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /SuccessExitStatus/);
});

test('--check catches a timer that would fire once and never again', { skip: !hasBash }, () => {
  const home = scratch();
  installUnits(home, { interval: '' });
  const r = run(['--check-units'], home);
  assert.equal(r.status, 1, 'a one-shot timer looks installed and syncs the host exactly once');
  assert.match(r.stdout, /repeat interval/);
});

test('plain --check never calls units-on-disk healthy on its own', { skip: !hasBash }, () => {
  // The unit files here were fabricated, never enabled — the installed-but-inert shape. Whether
  // systemd can be reached depends on the host (CI runner: yes; Git Bash on Windows: no), so what
  // is asserted is that --check either reports the timer down or says it could not look, and never
  // just prints "in sync" and stops. --check-units is the only way to opt out of that half.
  const home = scratch();
  installUnits(home);
  const r = run(['--check'], home);
  assert.match(r.stdout, /INACTIVE|cannot reach the user systemd bus/);
  if (/INACTIVE/.test(r.stdout)) {
    assert.equal(r.status, 1, 'a timer that is not scheduled to run was reported as healthy');
  }
});

test('--uninstall leaves no units behind', { skip: !hasBash }, () => {
  const home = scratch();
  const dir = installUnits(home);
  const r = run(['--uninstall'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(dir), []);
});
