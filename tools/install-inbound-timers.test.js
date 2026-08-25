#!/usr/bin/env node
// install-inbound-timers.test.js — tests for the inbound event-triage poller timers (#483, phase 4).
//
// The installer itself is barely worth testing; `--check` very much is. It runs in the daily
// enforcement-drift-check job, and a drift check has exactly two ways to be useless: green when
// the timers are gone (the outage stays silent), or red on a healthy host (people mute it). Both
// are tested here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'install-inbound-timers.sh');

// Git Bash on Windows, /bin/bash on Linux. If neither is here the whole file skips.
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

function run(args, configHome, env = {}) {
  // LIFE_REPO is required for the installer to do anything. Set a dummy value for tests.
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: configHome, LIFE_REPO: '/tmp/test-life-repo', ...env },
  });
}

const scratch = () => mkdtempSync(join(tmpdir(), 'inbound-timer-check-'));

// Fake `systemctl`/`loginctl` on PATH so the install branch can be driven both ways (bus up, bus
// down) without a real systemd anywhere.
function fakeBin({ systemctl, loginctl } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'inbound-fakebin-'));
  const write = (name, exitCode) => {
    const p = join(dir, name);
    writeFileSync(p, `#!/usr/bin/env bash\nexit ${exitCode}\n`);
    chmodSync(p, 0o755);
  };
  if (systemctl !== undefined) write('systemctl', systemctl);
  if (loginctl !== undefined) write('loginctl', loginctl);
  return dir;
}

/** A unit pair for one tier that should pass --check. */
function installUnits(configHome, tier = 'fast', { execScript = join(HERE, 'inbound', 'poll-run.js'), successLine = 'SuccessExitStatus=0 3', interval = 'OnUnitActiveSec=2min' } = {}) {
  const dir = join(configHome, 'systemd', 'user');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `inbound-poller-${tier}.service`),
    `[Service]\nType=oneshot\nExecStart=/usr/bin/node ${execScript}\nEnvironment="LIFE_REPO=/tmp/test-life-repo"\n${successLine}\n`
  );
  writeFileSync(
    join(dir, `inbound-poller-${tier}.timer`),
    `[Timer]\nOnBootSec=1min\n${interval}\nPersistent=true\n`
  );
  return dir;
}

test('--dry-run prints all three units and writes nothing', { skip: !hasBash }, () => {
  const home = scratch();
  const r = run(['--dry-run'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /inbound-poller-fast\.service/);
  assert.match(r.stdout, /inbound-poller-fast\.timer/);
  assert.match(r.stdout, /inbound-poller-medium\.service/);
  assert.match(r.stdout, /inbound-poller-medium\.timer/);
  assert.match(r.stdout, /inbound-poller-daily\.service/);
  assert.match(r.stdout, /inbound-poller-daily\.timer/);
  assert.match(r.stdout, /enable-linger/);
  assert.equal(existsSync(join(home, 'systemd')), false, '--dry-run installed something');
});

test('--dry-run prints correct intervals for each tier', { skip: !hasBash }, () => {
  const r = run(['--dry-run'], scratch());
  assert.match(r.stdout, /fast.*every 2min/);
  assert.match(r.stdout, /medium.*every 10min/);
  assert.match(r.stdout, /daily.*every 1d/);
});

test('--dry-run includes SuccessExitStatus=0 3 for all tiers', { skip: !hasBash }, () => {
  const r = run(['--dry-run'], scratch());
  const matches = r.stdout.match(/SuccessExitStatus=0 3/g) || [];
  assert.equal(matches.length, 3, 'should appear once per service unit (fast, medium, daily)');
});

test('--dry-run includes Persistent=true for catch-up after reboot', { skip: !hasBash }, () => {
  const r = run(['--dry-run'], scratch());
  const matches = r.stdout.match(/Persistent=true/g) || [];
  assert.equal(matches.length, 3, 'should appear once per timer unit (fast, medium, daily)');
});

test('--check fails when $LIFE_REPO is unset', { skip: !hasBash }, () => {
  const home = scratch();
  const r = run(['--check'], home, { LIFE_REPO: '' });
  assert.notEqual(r.status, 0, '--check should fail when $LIFE_REPO is unset');
  assert.match(r.stdout, /LIFE_REPO is unset/);
});

test('--check passes with poller script present and units intact', { skip: !hasBash }, () => {
  const home = scratch();
  for (const tier of ['fast', 'medium', 'daily']) {
    const intervals = { fast: '2min', medium: '10min', daily: '1d' };
    installUnits(home, tier, { interval: `OnUnitActiveSec=${intervals[tier]}` });
  }
  const r = run(['--check-units'], home);
  assert.equal(r.status, 0, r.stdout);
});

test('--check fails when a service unit is missing', { skip: !hasBash }, () => {
  const home = scratch();
  installUnits(home, 'fast');  // install only fast, not medium or daily
  const r = run(['--check'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /missing.*inbound-poller-medium/);
  assert.match(r.stdout, /missing.*inbound-poller-daily/);
});

test('--check fails when a service unit has no SuccessExitStatus=0 3', { skip: !hasBash }, () => {
  const home = scratch();
  installUnits(home, 'fast', { successLine: 'SuccessExitStatus=0' }); // wrong value
  const r = run(['--check'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /drift.*lost SuccessExitStatus=0 3/);
});

test('--check fails when a service unit has no LIFE_REPO environment', { skip: !hasBash }, () => {
  const home = scratch();
  const dir = join(home, 'systemd', 'user');
  mkdirSync(dir, { recursive: true });
  // Create units without LIFE_REPO environment
  for (const [tier, interval] of Object.entries({ fast: '2min', medium: '10min', daily: '1d' })) {
    const script = join(HERE, 'inbound', 'poll-run.js');
    writeFileSync(
      join(dir, `inbound-poller-${tier}.service`),
      `[Service]\nType=oneshot\nExecStart=/usr/bin/node ${script}\nSuccessExitStatus=0 3\n`
    );
    writeFileSync(join(dir, `inbound-poller-${tier}.timer`), `[Timer]\nOnUnitActiveSec=${interval}\n`);
  }

  const r = run(['--check'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /drift.*no LIFE_REPO/);
});

test('--check fails when a timer has the wrong interval', { skip: !hasBash }, () => {
  const home = scratch();
  installUnits(home, 'fast', { interval: 'OnUnitActiveSec=5min' }); // wrong interval
  const r = run(['--check'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /drift.*wrong interval/);
});

test('--check fails when a timer unit is missing', { skip: !hasBash }, () => {
  const home = scratch();
  const dir = join(home, 'systemd', 'user');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'inbound-poller-fast.service'), `[Service]\nExecStart=/usr/bin/node /path/to/poll-run.js\n`);
  writeFileSync(join(dir, 'inbound-poller-fast.timer'), `[Timer]\nOnUnitActiveSec=2min\n`);
  writeFileSync(join(dir, 'inbound-poller-medium.service'), `[Service]\nExecStart=/usr/bin/node /path/to/poll-run.js\n`);
  writeFileSync(join(dir, 'inbound-poller-daily.service'), `[Service]\nExecStart=/usr/bin/node /path/to/poll-run.js\n`);
  writeFileSync(join(dir, 'inbound-poller-daily.timer'), `[Timer]\nOnUnitActiveSec=1d\n`);

  const r = run(['--check'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /missing.*inbound-poller-medium\.timer/);
});

test('--check-units passes with all units present and correct', { skip: !hasBash }, () => {
  const home = scratch();
  for (const tier of ['fast', 'medium', 'daily']) {
    const intervals = { fast: '2min', medium: '10min', daily: '1d' };
    installUnits(home, tier, { interval: `OnUnitActiveSec=${intervals[tier]}` });
  }
  const r = run(['--check-units'], home);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /in sync.*inbound-poller-fast/);
  assert.match(r.stdout, /in sync.*inbound-poller-medium/);
  assert.match(r.stdout, /in sync.*inbound-poller-daily/);
  assert.match(r.stdout, /skipped.*timer liveness/);
});

test('--check-units fails when ExecStart script does not exist', { skip: !hasBash }, () => {
  const home = scratch();
  for (const tier of ['fast', 'medium', 'daily']) {
    const intervals = { fast: '2min', medium: '10min', daily: '1d' };
    installUnits(home, tier, { execScript: '/nonexistent/poll-run.js', interval: `OnUnitActiveSec=${intervals[tier]}` });
  }
  const r = run(['--check-units'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /drift.*script that is not there/);
});

test('install fails when $LIFE_REPO is unset', { skip: !hasBash }, () => {
  const r = run(['install'], scratch(), { LIFE_REPO: '' });
  assert.equal(r.status, 5, 'exit 5 = $LIFE_REPO unset');
  assert.match(r.stderr, /LIFE_REPO is unset/);
});

test('install fails when the poller script is missing', { skip: !hasBash }, () => {
  const r = run(['install'], scratch());
  assert.notEqual(r.status, 0, 'install should fail when poller script is missing');
});

test('install with fake systemd failure (bus down) exits 4 and reports the failure', { skip: !hasBash }, () => {
  const home = scratch();
  const fakeSystemctl = fakeBin({ systemctl: 1 });
  // Prepend fake bin to PATH so systemctl fails, but other commands still work
  const origPath = process.env.PATH || '';
  const r = run(['install'], home, { PATH: fakeSystemctl + (origPath ? ':' + origPath : '') });
  assert.equal(r.status, 4, 'exit 4 = units written but bus unreachable; got: ' + r.stdout + r.stderr);
  assert.match(r.stderr, /systemd.*unreachable/);
  assert.match(r.stderr, /human must run this/);
});

test('--uninstall removes all three units and exits 0', { skip: !hasBash }, () => {
  const home = scratch();
  for (const tier of ['fast', 'medium', 'daily']) {
    const intervals = { fast: '2min', medium: '10min', daily: '1d' };
    installUnits(home, tier, { interval: `OnUnitActiveSec=${intervals[tier]}` });
  }
  const r = run(['--uninstall'], home);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /removed/);
  assert.equal(existsSync(join(home, 'systemd', 'user', 'inbound-poller-fast.service')), false);
  assert.equal(existsSync(join(home, 'systemd', 'user', 'inbound-poller-medium.timer')), false);
  assert.equal(existsSync(join(home, 'systemd', 'user', 'inbound-poller-daily.service')), false);
});

test('unknown mode prints an error and exits 2', { skip: !hasBash }, () => {
  const r = run(['--bogus'], scratch());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option/);
});
