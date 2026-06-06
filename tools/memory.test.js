import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveSubcommand } from './memory.js';

const TOOLS = '/fake/tools';
const NEXUS = '/fake/nexus';
const opts = { toolsDir: TOOLS, nexus: NEXUS };

// Integration: actually dispatch through the CLI to a real subtool and confirm output
// reaches stdout (guards against the execFile-swallows-output / wrong-stdio class of bug).
test('memory.js dispatches and pipes subtool output to stdout (integration)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mem-cli-'));
  try {
    mkdirSync(path.join(root, 'nexus', 'personal-brain'), { recursive: true });
    writeFileSync(path.join(root, 'nexus', 'known-repos.json'), JSON.stringify({ repos: [] }));
    const memJs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.js');
    const r = spawnSync('node', [memJs, 'context'], {
      encoding: 'utf8',
      env: { ...process.env, AGENT_MEMORY_ROOT: root },
    });
    assert.strictEqual(r.status, 0, `exit 0, got ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /Memory Context/, 'dispatched subtool output must reach stdout');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recall maps keywords to graph-query with brain-path and record-access', () => {
  const r = resolveSubcommand(['recall', 'auth', 'middleware'], opts);
  assert.equal(r.tool, path.join(TOOLS, 'graph', 'graph-query.js'));
  assert.ok(r.args.includes('personal-brain'));
  assert.ok(r.args.includes('auth'));
  assert.ok(r.args.includes('middleware'));
  assert.ok(r.args.some(a => a.startsWith('--brain-path=')));
  assert.ok(r.args.includes('--record-access'));
});

test('recall passes extra flags through', () => {
  const r = resolveSubcommand(['recall', 'foo', '--top=5', '--mode=debugging'], opts);
  assert.ok(r.args.includes('--top=5'));
  assert.ok(r.args.includes('--mode=debugging'));
  assert.ok(r.args.includes('foo'));
});

test('context maps to memory-context.js, passes rest args', () => {
  const r = resolveSubcommand(['context', '--core=5'], opts);
  assert.equal(r.tool, path.join(TOOLS, 'memory-context.js'));
  assert.deepEqual(r.args, ['--core=5']);
});

test('remember maps to brain-remember.js, passes rest args', () => {
  const r = resolveSubcommand(['remember', '--fact=hello', '--section=Work'], opts);
  assert.equal(r.tool, path.join(TOOLS, 'brain-remember.js'));
  assert.deepEqual(r.args, ['--fact=hello', '--section=Work']);
});

test('reflect maps to memory-reflect.js, passes rest args', () => {
  const r = resolveSubcommand(['reflect', '--dry-run'], opts);
  assert.equal(r.tool, path.join(TOOLS, 'memory-reflect.js'));
  assert.deepEqual(r.args, ['--dry-run']);
});

test('maintain maps to memory-maintenance.js, passes rest args', () => {
  const r = resolveSubcommand(['maintain', '--if-stale=3', '--quiet'], opts);
  assert.equal(r.tool, path.join(TOOLS, 'memory-maintenance.js'));
  assert.deepEqual(r.args, ['--if-stale=3', '--quiet']);
});

test('help returns help sentinel', () => {
  const r = resolveSubcommand(['help'], opts);
  assert.deepEqual(r, { help: true });
});

test('unknown subcommand returns help sentinel', () => {
  const r = resolveSubcommand(['bogus'], opts);
  assert.deepEqual(r, { help: true });
});

test('no subcommand (empty argv) returns help sentinel', () => {
  const r = resolveSubcommand([], opts);
  assert.deepEqual(r, { help: true });
});

test('recall brain-path points into nexus/personal-brain', () => {
  const myNexus = path.join('my', 'nexus');
  const r = resolveSubcommand(['recall', 'foo'], { toolsDir: TOOLS, nexus: myNexus });
  const brainArg = r.args.find(a => a.startsWith('--brain-path='));
  assert.ok(brainArg.includes('personal-brain'));
  assert.ok(brainArg.includes(myNexus));
});
