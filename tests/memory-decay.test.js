// tests/memory-decay.test.js
// Regression test: `node tools/memory-decay.js --brain=<slug>` must not hard-exit(1) when
// the brain's graph.json doesn't exist yet. A per-repo/agent brain is gitignored, so a fresh
// host (or a brain nothing has written to yet) legitimately has no graph.json -- that's a
// normal state, not a corruption (CLAUDE.md "Central brain"). Before the fix, memory-decay.js
// treated a missing graph.json as fatal, which took down the `weekly-memory-decay` scheduled
// job the moment any listed brain lacked a graph.json on the runner (run
// https://github.com/Zene8/AgentSystem/actions/runs/31288224604).
//
// node --test tests/memory-decay.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(repoRoot, 'tools', 'memory-decay.js');

function runDecay(memoryRoot, brain) {
  return execFileSync(process.execPath, [SCRIPT, `--brain=${brain}`], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_MEMORY_ROOT: memoryRoot },
  });
}

test('memory-decay: missing graph.json is skipped, not a fatal error', () => {
  const memoryRoot = mkdtempSync(join(tmpdir(), 'memory-decay-test-'));
  try {
    // No nexus/<brain>/graph.json exists under this fresh root at all.
    const stdout = runDecay(memoryRoot, 'never-initialized-brain');
    assert.match(stdout, /skipping/i, `expected a skip message, got: ${stdout}`);
    assert.doesNotMatch(stdout, /archived/i, 'a skip must not read like a real decay pass');

    const graphPath = join(memoryRoot, 'nexus', 'never-initialized-brain', 'graph.json');
    assert.equal(existsSync(graphPath), false, 'must not create a placeholder graph.json');
  } finally {
    rmSync(memoryRoot, { recursive: true, force: true });
  }
});

// --- #314: the job that reported success while decaying nothing --------------------------------
// `weekly-memory-decay` ran `--brain=agentsystem` on every schedule. Repo brains live at
// <repo>/nexus/<slug>/ and are gitignored (graph-init.js), so that slug names a path that cannot
// exist under ~/agent-memory/nexus/ on any host -- the skip above then made the run green.
// --all discovers the brains that are actually there; a host with none is an error, not a no-op.

function run(memoryRoot, args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_MEMORY_ROOT: memoryRoot },
  });
}

function runExpectingFailure(memoryRoot, args) {
  try {
    run(memoryRoot, args);
  } catch (err) {
    return { status: err.status, stderr: err.stderr || '', stdout: err.stdout || '' };
  }
  assert.fail('expected a non-zero exit');
}

// One stale edge (last visited long ago, no other signal) so a real decay pass has something to do.
function seedBrain(memoryRoot, brain) {
  const dir = join(memoryRoot, 'nexus', brain);
  mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString();
  // #375: discovery now requires positive evidence via the shared isBrainDir() -- a graph.json
  // needs a real (non-"unknown") `brain` field, matching what emptyGraph()/writeGraph() always
  // stamp on a genuine brain. A fixture without one is indistinguishable from stray non-brain
  // JSON (e.g. an Obsidian settings file) and would no longer be discovered at all.
  writeFileSync(join(dir, 'graph.json'), JSON.stringify({
    brain,
    nodes: ['a', 'b'],
    edges: [{
      source: 'a',
      target: 'b',
      weights: {
        co_change: 0, semantic: 0, _visit_raw: 4, visit_count: 4, last_visited: old,
        confidence: { n_confirms: 0, n_contradicts: 8 },
        valid_from: old, valid_until: null,
      },
      composite: 0.4,
    }],
  }, null, 2));
  return join(dir, 'graph.json');
}

function withRoot(fn) {
  const memoryRoot = mkdtempSync(join(tmpdir(), 'memory-decay-test-'));
  try {
    fn(memoryRoot);
  } finally {
    rmSync(memoryRoot, { recursive: true, force: true });
  }
}

test('memory-decay --all: a host with no brains is an error, not a silent success', () => {
  withRoot((memoryRoot) => {
    const { status, stderr } = runExpectingFailure(memoryRoot, ['--all']);
    assert.equal(status, 1);
    assert.match(stderr, /no brains found/i);
  });
});

test('memory-decay --all: discovers top-level and agent-brain/<agent> brains', () => {
  withRoot((memoryRoot) => {
    seedBrain(memoryRoot, 'personal-brain');
    seedBrain(memoryRoot, join('agent-brain', 'leo'));
    // agent-brain itself is a container, not a brain -- it must not be reported as one.
    const stdout = run(memoryRoot, ['--all', '--dry-run']);
    assert.match(stdout, /2 brain\(s\) found/);
    assert.match(stdout, /personal-brain/);
    assert.match(stdout, /agent-brain\/leo/);
    assert.doesNotMatch(stdout, /decay pass \[agent-brain\]/);
  });
});

test('memory-decay --all: archives stale edges and marks them inactive in weights', () => {
  withRoot((memoryRoot) => {
    const graphPath = seedBrain(memoryRoot, 'personal-brain');
    const stdout = run(memoryRoot, ['--all']);
    assert.match(stdout, /1 edges archived/);
    assert.match(stdout, /1 brain\(s\) processed, 1 edge\(s\) archived/);

    const edge = JSON.parse(readFileSync(graphPath, 'utf8')).edges[0];
    assert.notEqual(edge.weights.valid_until, null,
      'valid_until must be stamped inside weights -- that is where the active check reads it');

    // Second pass must find nothing left to archive. Before the fix it re-archived the same edge
    // every run, which is what "decays nothing, forever" actually looked like on disk.
    assert.match(run(memoryRoot, ['--all']), /0 edges archived/);
  });
});

test('memory-decay --require-graph: a named-but-missing brain fails loudly', () => {
  withRoot((memoryRoot) => {
    const { status, stderr } = runExpectingFailure(memoryRoot, ['--brain=personal-brain', '--require-graph']);
    assert.equal(status, 1);
    assert.match(stderr, /refusing to report success/i);
  });
});

test('memory-decay: --brain and --all are mutually exclusive', () => {
  withRoot((memoryRoot) => {
    const { status } = runExpectingFailure(memoryRoot, ['--brain=personal-brain', '--all']);
    assert.equal(status, 1);
  });
});

// Obsidian stores its graph-VIEW settings at `.obsidian/graph.json` -- same filename as a brain
// graph, completely unrelated content (collapse-filter, nodeSizeMultiplier, ...). Discovery keyed
// on the filename alone, so on the runner (~/agent-memory is an Obsidian vault) `.obsidian` was
// adopted as brain #1 and the decay pass died on `TypeError: graph.nodes is not iterable` before
// touching a single real brain. Two independent defects, so two independent tests.
test('memory-decay --all: dot-directories are not brains (.obsidian/graph.json is Obsidian config)', () => {
  withRoot((memoryRoot) => {
    seedBrain(memoryRoot, 'personal-brain');
    mkdirSync(join(memoryRoot, 'nexus', '.obsidian'), { recursive: true });
    writeFileSync(
      join(memoryRoot, 'nexus', '.obsidian', 'graph.json'),
      JSON.stringify({ 'collapse-filter': true, search: '', nodeSizeMultiplier: 1 }),
    );

    const stdout = run(memoryRoot, ['--all', '--dry-run']);
    assert.match(stdout, /1 brain\(s\) found/);
    assert.doesNotMatch(stdout, /\.obsidian/);
  });
});

test('memory-decay: a graph.json without a nodes array is skipped, not a crash', () => {
  withRoot((memoryRoot) => {
    seedBrain(memoryRoot, 'personal-brain');
    // Carries a real `brain` field so isBrainDir's discovery-level check accepts it as a
    // candidate -- only the deeper shape validation (nodes/edges arrays) can reject this one.
    const bogus = join(memoryRoot, 'nexus', 'notabrain');
    mkdirSync(bogus, { recursive: true });
    writeFileSync(join(bogus, 'graph.json'), JSON.stringify({ brain: 'notabrain', scale: 1, showTags: false }));

    const stdout = run(memoryRoot, ['--all', '--dry-run']);
    assert.match(stdout, /not a brain graph/i);
    assert.match(stdout, /1 brain\(s\) processed/);
  });
});

// --- The weekly-memory-decay job's push step (#482) -----------------------------------------
//
// On 2026-08-23 the decay pass logged `13 brain(s) processed, 831 edge(s) active` and the job went
// red anyway: the next step pushed the brain by calling tools/brain-sync.js RAW, so a merge conflict
// in `nexus/personal-brain/visits.log` came back as an anonymous exit 1. The job then raised
// `memory-decay-down` with a body telling a human that `no brains found` means the brain has no
// graph.json and to re-bootstrap -- over 13 healthy brains and a conflict in a different repo.
//
// These assertions are on the workflow YAML on purpose. Every part of this is a wiring decision that
// looks like redundancy to a later reader with a mandate to simplify, and each simplification
// re-opens #482 exactly.

const WORKFLOW = join(repoRoot, '.github', 'workflows', 'scheduled-tasks.yml');

// The `weekly-memory-decay:` job block, from its key to the next job at the same indent.
function decayJob() {
  const yml = readFileSync(WORKFLOW, 'utf8');
  const start = yml.indexOf('\n  weekly-memory-decay:');
  assert.ok(start > 0, 'the weekly-memory-decay job is gone from scheduled-tasks.yml');
  const rest = yml.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

// The body of one `run: |` step, dedented. Returns null when the step is not a block scalar.
function stepRun(job, name) {
  const at = job.indexOf(`- name: ${name}`);
  assert.ok(at > 0, `step "${name}" is gone`);
  const after = job.slice(at);
  const m = after.match(/\n(\s+)run: \|\n([\s\S]*?)(?=\n\s*- name: |\n?$)/);
  if (!m) return null;
  return m[2];
}

test('decay push: goes through brain-sync-run.js, never brain-sync.js raw', () => {
  const job = decayJob();
  const push = stepRun(job, 'Push the decayed brain');
  assert.ok(push, 'the push step must be a `run: |` block -- a one-liner cannot classify an exit code');

  assert.match(push, /tools\/brain-sync-run\.js/,
    'the push must go through the wrapper: it holds the sync lock, classifies the failure, and '
    + 'raises the per-host brain-sync-conflict alert. A raw brain-sync.js call does none of that (#482)');
  assert.doesNotMatch(push, /tools\/brain-sync\.js(?!.*--status)/,
    'a raw brain-sync.js invocation is back in the push step -- that is the #482 regression itself');
});

test('decay push: exit 3 is a pass, exit 2 and every other code is red, under -e', () => {
  // Actually executed rather than pattern-matched, because the trap here is shell behaviour:
  // Actions runs step bash with `-e` even when the body sets its own options (#460), so a
  // non-zero `node` would abort the step before any classification could run. `set +e` around
  // the call is the whole fix and only running it proves it is there.
  const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
  if (bash.status !== 0) return; // no bash on this host; the Linux runner has one

  const push = stepRun(decayJob(), 'Push the decayed brain');
  const scriptFor = (rc) => push
    // Stand in for brain-sync-run.js at a chosen exit code. The `${{ }}` expression is left
    // untouched by GitHub only at runtime, so strip the whole invocation line.
    // A subshell, not a bare `exit`: `exit` would terminate the step script itself and never
    // reach the classification this test is about.
    .replace(/^\s*node "\$\{\{[^\n]*brain-sync-run\.js"\s*$/m, `  ( exit ${rc} )`)
    .replace(/"\$GITHUB_STEP_SUMMARY"/g, '"$SUMMARY"');

  assert.notEqual(scriptFor(3), push,
    'the stand-in substitution matched nothing, so this test would be asserting on the real call');

  const run = (rc) => spawnSync('bash', ['-e', '-c', scriptFor(rc)], {
    encoding: 'utf8',
    env: { ...process.env, SUMMARY: '/dev/null' },
  });

  const ok = run(0);
  assert.equal(ok.status, 0, `exit 0 must pass: ${ok.stderr}`);

  const conflict = run(3);
  assert.equal(conflict.status, 0,
    'exit 3 means brain-sync-run already raised a correctly-keyed alert about the brain checkout. '
    + 'Failing here is a second red run and a second issue about one problem');
  assert.match(conflict.stdout, /::warning::/,
    'a pass with no warning is a silent non-push -- the decayed graphs never left the host');
  assert.match(conflict.stdout, /brain-sync-conflict-/,
    'the warning must name the alert key that actually holds the problem');
  assert.doesNotMatch(conflict.stdout, /::error::/);

  for (const rc of [1, 2, 4]) {
    const bad = run(rc);
    assert.equal(bad.status, rc,
      `exit ${rc} must stay red: nothing was diagnosed and nobody was alerted, so a green run `
      + 'there is an outage that reports itself nowhere. "Could not tell" stays red');
    assert.match(bad.stdout + bad.stderr, /::error::/);
  }
});

test('decay push: an exit-3 push cannot resolve memory-decay-down', () => {
  // The #467 trap. Exiting 0 on a classified conflict makes `success()` true, so a clear-the-alert
  // step gated on the JOB would close memory-decay-down on a run that never pushed anything.
  const job = decayJob();
  const clear = job.slice(job.indexOf('- name: Clear the human-needed alert'));
  const cond = clear.match(/\n\s*if: ([^\n]*)/)[1];
  assert.match(cond, /steps\.decay\.outcome == 'success'/,
    'the clear step must be gated on the decay step itself, not on the job succeeding');
  assert.match(job, /\n\s*id: decay\n/, 'the decay step needs the id the gate refers to');

  const push = stepRun(job, 'Push the decayed brain');
  assert.doesNotMatch(push, /human-needed\.js/,
    'the push step must not raise memory-decay-down: exit 3 is already alerted under the '
    + 'per-host brain-sync key, and exit 2 falls through to the job-level failure() step');
});

test('decay alert: memory-decay-down no longer misdiagnoses a push failure', () => {
  // With per-run failure emails off, the human-needed issue is the only signal there is. #482's
  // body sent someone to re-bootstrap 13 healthy brains because this text claimed the push mode.
  const job = decayJob();
  const raise = job.slice(job.indexOf('- name: Raise the human-needed alert'));
  const why = raise.match(/--why "([\s\S]*?)" \\/)[1];
  const action = raise.match(/--action "([\s\S]*?)" \\/)[1];

  assert.match(why + action, /brain-sync-conflict/,
    'the alert must name where a sync failure actually reports, or the reader has nowhere to go');
  // The bootstrap advice must stay bound to the one log line that means it. Unconditionally
  // telling a reader to re-bootstrap is what made #482 worse than silence: it named a remedy for
  // a fault the same run had already disproved.
  const trigger = action.indexOf('no brains found');
  const remedy = action.indexOf('bootstrap-repo');
  assert.ok(trigger >= 0, 'the log line that actually means "re-bootstrap" is no longer quoted');
  assert.ok(remedy > trigger && remedy - trigger < 160,
    'the bootstrap-repo advice is no longer attached to the `no brains found` condition');
  assert.doesNotMatch(action, /A push failure means the ~\/agent-memory checkout needs attention/,
    'the old text claimed the push mode for this key, which is what made it lie');
});
