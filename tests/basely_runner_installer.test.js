// tools/install-basely-runners.sh keeps Zene8/Basely's CI alive through a billing outage (#530),
// which makes it load-bearing for a DIFFERENT repo's merge gate. These tests cover the parts that
// fail silently: a unit whose ExecStart points somewhere else, and a --check that could report
// success for a runner that was never registered.
//
// Nothing here touches the real $HOME, systemd or GitHub — HOME and XDG_CONFIG_HOME are redirected
// into a temp dir and only --dry-run / --check-units are exercised, since those are the two modes
// that make no network call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'install-basely-runners.sh');

function run(args, { home, instances = 1 } = {}) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        INSTANCES: String(instances),
      },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

// A registered runner as it exists on disk: an executable run.sh plus the .runner file config.sh
// writes. Both matter — see the two faults asserted below.
function fakeRunner(home, n, { registered = true, unpacked = true } = {}) {
  const dir = join(home, `actions-runner-basely-${n}`);
  mkdirSync(dir, { recursive: true });
  if (unpacked) {
    writeFileSync(join(dir, 'run.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(dir, 'run.sh'), 0o755);
  }
  if (registered) writeFileSync(join(dir, '.runner'), '{"gitHubUrl":"https://github.com/Zene8/Basely"}');
  return dir;
}

function installUnit(home, n, body) {
  const unitDir = join(home, '.config', 'systemd', 'user');
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(join(unitDir, `actions-runner-basely-${n}.service`), body);
}

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'basely-runner-test-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('--dry-run points ExecStart at the runner it supervises and never writes', () => {
  withHome((home) => {
    const { code, stdout } = run(['--dry-run'], { home });
    assert.equal(code, 0);
    // Compared against WorkingDirectory rather than against $HOME as this process sees it: on
    // Windows the bash in use reports a POSIX $HOME that does not match the native path, and the
    // property that matters is that both lines name the same runner directory.
    const workdir = /WorkingDirectory=(.*)/.exec(stdout)[1].trim();
    assert.match(workdir, /actions-runner-basely-1$/);
    assert.ok(stdout.includes(`ExecStart=${workdir}/run.sh`), stdout);
    // Restart=always is the whole point of running under systemd rather than a bare nohup: a
    // runner that exits on a network blip and stays down looks identical to a billing outage.
    assert.match(stdout, /Restart=always/);
    // KillMode=process, not the default control-group: a stop must not kill the job the runner
    // spawned mid-step.
    assert.match(stdout, /KillMode=process/);
    const { code: c2, stdout: s2 } = run(['--check-units'], { home });
    assert.equal(c2, 1, '--dry-run must not have created anything for --check-units to find');
    assert.match(s2, /not unpacked/);
  });
});

test('--dry-run honours INSTANCES', () => {
  withHome((home) => {
    const { stdout } = run(['--dry-run'], { home, instances: 3 });
    for (const n of [1, 2, 3]) assert.match(stdout, new RegExp(`instance ${n}\\b`));
  });
});

test('--check-units passes when every runner is registered and its unit matches', () => {
  withHome((home) => {
    fakeRunner(home, 1);
    const generated = run(['--dry-run'], { home }).stdout.split('\n').slice(1).join('\n');
    installUnit(home, 1, generated);
    const { code, stdout } = run(['--check-units'], { home });
    assert.equal(code, 0, stdout);
    assert.match(stdout, /1 runner\(s\) registered, units in sync/);
  });
});

test('an unpacked but never-registered runner is a fault, not a pass', () => {
  // run.sh present and a unit that starts cleanly, but no .runner: the service goes active, the
  // listener exits immediately, and every dispatched job queues forever with nothing red anywhere.
  withHome((home) => {
    fakeRunner(home, 1, { registered: false });
    installUnit(home, 1, run(['--dry-run'], { home }).stdout.split('\n').slice(1).join('\n'));
    const { code, stdout } = run(['--check-units'], { home });
    assert.equal(code, 1);
    assert.match(stdout, /never registered/);
  });
});

test('a unit pointing at a different path is a fault (#362 class)', () => {
  // A unit file that exists and parses is not a unit that runs the right thing. This is the
  // hand-written-unit case the installer was written to end: the first pair on the real host had a
  // typo'd ExecStart and failed 203/EXEC.
  withHome((home) => {
    fakeRunner(home, 1);
    installUnit(home, 1, [
      '[Service]',
      'Type=simple',
      `WorkingDirectory=${home}/actions-runner-basely-`,
      `ExecStart=${home}/actions-runner-basely-/run.sh`,
      'Restart=always',
    ].join('\n'));
    const { code, stdout } = run(['--check-units'], { home });
    assert.equal(code, 1);
    assert.match(stdout, /differs from what this script generates/);
  });
});

test('a registered runner with no unit at all is a fault', () => {
  withHome((home) => {
    fakeRunner(home, 1);
    const { code, stdout } = run(['--check-units'], { home });
    assert.equal(code, 1);
    assert.match(stdout, /has no unit at/);
  });
});

test('--check-units reports every faulty instance, not just the first', () => {
  withHome((home) => {
    fakeRunner(home, 1, { registered: false });
    fakeRunner(home, 2, { unpacked: false, registered: false });
    const { code, stdout } = run(['--check-units'], { home, instances: 2 });
    assert.equal(code, 1);
    assert.match(stdout, /2 fault\(s\)/);
  });
});
