// sam_audit_bypass_record.test.js — a label bypass must leave a record, and no skip path may
// resolve the cannot-run alert (#450).
//
// Measured on PR #444 (merged 2026-08-17T21:53:39Z): the real audit failed at 21:36 and raised
// `sam-audit-cannot-run` = issue #445; the `bypass-sam-audit` label went on; run 32073337501 at
// 21:52:50 took the label path, logged one line — `APPROVED without Claude audit: Bypassed via PR
// label (bypass-sam-audit/bypass-audit)` — and reported the required check SUCCESS. Ten files
// merged unaudited, including `hooks/claude-hooks/guard-git.sh`, `hooks/antigravity-bridge.js` and
// `tools/sync-agents.js`. Nothing outside that log said so.
//
// Two properties are pinned here, and they pull in opposite directions on purpose:
//   1. the bypass path must be LOUD — it names the PR and the files it waved through;
//   2. the bypass path must not be TRUSTED — it may not resolve `sam-audit-cannot-run`, because it
//      never ran the claude CLI the alert is about. Neither may any other precheck-skip path.
//
// The scripts are extracted from the shipped workflow and compiled the way actions/github-script
// compiles them, so there is one copy of this logic and the test exercises the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractBlockScalars } from '../tools/workflow-lint.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Overridable so the fail-before/pass-after proof is reproducible without touching the tree:
//   git worktree add --detach /tmp/pre origin/main
//   SAM_AUDIT_WORKFLOW=/tmp/pre/.github/workflows/sam-audit.yml node --test tests/sam_audit_bypass_record.test.js
const WORKFLOW = process.env.SAM_AUDIT_WORKFLOW
  || join(HERE, '..', '.github', 'workflows', 'sam-audit.yml');
const workflowText = readFileSync(WORKFLOW, 'utf8');

const scripts = extractBlockScalars(workflowText).filter(b => b.key === 'script').map(b => b.body);

/** The one script that declares `pr.draft` — the precheck. */
function precheckSource() {
  const match = scripts.filter(s => s.includes('pr.draft'));
  assert.equal(match.length, 1, `expected exactly one precheck script, found ${match.length}`);
  return match[0];
}

/**
 * The no-audit approval review. Both fast path and audited path call createReview; only the fast
 * path reads the precheck's `skip_reason`, since only it has a reason instead of a verdict.
 */
function approvalSource() {
  const match = scripts.filter(s => s.includes('createReview') && s.includes('outputs.skip_reason'));
  assert.equal(match.length, 1, `expected exactly one no-audit approval script, found ${match.length}`);
  return match[0];
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Compile a github-script body, substituting the `${{ ... }}` workflow expressions Actions would
 * have interpolated before the runner ever saw JavaScript. Only `toJSON(steps.X.outputs.Y)` is
 * supported, because that is the only form these two scripts use — anything else is a new shape
 * and should fail loudly here rather than silently compile to garbage.
 */
function compile(source, stepOutputs = {}) {
  const substituted = source.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (whole, expr) => {
    const m = /^toJSON\(steps\.([\w-]+)\.outputs\.([\w-]+)\)$/.exec(expr);
    assert.ok(m, `unsupported workflow expression in script: ${whole}`);
    return JSON.stringify(stepOutputs[m[2]] ?? '');
  });
  return new AsyncFunction('github', 'context', 'core', substituted);
}

const FILES = ['tools/sync-agents.js', 'hooks/claude-hooks/guard-git.sh', 'docs/harness-support.md'];

/** Run the precheck against a synthetic PR and return the outputs it set. */
async function runPrecheck({ draft = false, labels = [], files = FILES } = {}) {
  const outputs = {};
  const core = {
    setOutput: (k, v) => { outputs[k] = v; },
    info: () => {}, warning: () => {},
  };
  const context = {
    repo: { owner: 'Zene8', repo: 'AgentSystem' },
    payload: { pull_request: { number: 444, draft, labels: labels.map(name => ({ name })) } },
  };
  const github = {
    paginate: async () => files.map(filename => ({ filename })),
    rest: { pulls: { listFiles: () => {} } },
  };
  await compile(precheckSource())(github, context, core);
  return outputs;
}

/** Run the no-audit approval step against precheck outputs and return the review body posted. */
async function runApproval(stepOutputs) {
  const reviews = [];
  const github = {
    rest: { pulls: { createReview: async (args) => { reviews.push(args); } } },
  };
  const context = {
    repo: { owner: 'Zene8', repo: 'AgentSystem' },
    payload: { pull_request: { number: 444 } },
  };
  await compile(approvalSource(), stepOutputs)(github, context, { info: () => {} });
  assert.equal(reviews.length, 1, 'the fast path must post exactly one review');
  return reviews[0].body;
}

// ── The bypass path must be distinguishable from the other skips ───────────────────────────────

test('the label bypass sets a bypass output the later steps can gate on', async () => {
  // Pre-fix there is no such output at all, so every downstream record is unreachable: the
  // approval body, the human-needed alert, everything. This is the load-bearing assertion.
  const out = await runPrecheck({ labels: ['bypass-sam-audit'] });
  assert.equal(out.skip, 'true');
  assert.equal(out.approve, 'true');
  assert.equal(out.bypass, 'true', 'the bypass path must announce itself, not just skip quietly');
});

test('the alternate bypass-audit label spelling is recorded too', async () => {
  // Both spellings unlock the merge, so both must leave a record. Fixing one is a half-fix that
  // reads as done.
  const out = await runPrecheck({ labels: ['bypass-audit'] });
  assert.equal(out.bypass, 'true');
});

test('the bypass names the files it waved through, and counts them exactly', async () => {
  // "A bypass happened" is not actionable; "these three files merged unread" is. #444's record
  // has to be able to name `guard-git.sh`, or a reviewer cannot tell an unaudited hook from an
  // unaudited README.
  const out = await runPrecheck({ labels: ['bypass-sam-audit'] });
  assert.equal(out.bypass_file_count, '3');
  for (const f of FILES) {
    assert.ok(out.bypass_files.includes(f), `the record must name ${f}, got: ${out.bypass_files}`);
  }
});

test('a large PR elides the file list but keeps the count honest', async () => {
  // The record lands in a GitHub issue body. A 300-file list buries the point — but a truncated
  // count would understate the blast radius, which is the one number a reviewer triages on.
  const many = Array.from({ length: 300 }, (_, i) => `tools/f${i}.js`);
  const out = await runPrecheck({ labels: ['bypass-sam-audit'], files: many });
  assert.equal(out.bypass_file_count, '300', 'the count is never truncated');
  assert.match(out.bypass_files, /and 260 more/);
  assert.ok(out.bypass_files.length < 2000, 'the list must stay readable in an issue body');
});

test('the other skip paths do NOT set bypass', async () => {
  // If docs-only or spec set it, every routine docs PR would open a "unaudited code merged" alert
  // and the signal would be worthless inside a week.
  for (const kase of [
    { name: 'draft', args: { draft: true } },
    { name: 'spec', args: { labels: ['spec'] } },
    { name: 'docs-only', args: { files: ['docs/a.md', 'README.md'] } },
    { name: 'audited', args: { files: ['tools/a.js'] } },
  ]) {
    const out = await runPrecheck(kase.args);
    assert.equal(out.bypass, 'false', `the ${kase.name} path must not claim a bypass`);
  }
});

test('hoisting the file listing did not break the docs-only verdict', async () => {
  // The listFiles call moved above the label checks so the bypass path can read it. The docs-only
  // decision consumes the same list and must be unchanged by the move.
  assert.equal((await runPrecheck({ files: ['docs/a.md', 'b.md'] })).skip, 'true');
  assert.equal((await runPrecheck({ files: ['docs/a.md', 'tools/b.js'] })).skip, 'false');
  assert.equal((await runPrecheck({ files: [] })).skip, 'false', 'an empty PR is not docs-only');
});

// ── The record on the PR itself ────────────────────────────────────────────────────────────────

test('the bypass approval says the code was NOT audited', async () => {
  const body = await runApproval({
    skip_reason: 'Bypassed via PR label (bypass-sam-audit/bypass-audit)',
    bypass: 'true',
    bypass_files: FILES.join(', '),
  });
  assert.match(body, /WITHOUT AUDIT/, 'the bypass review must not read like a passed audit');
  assert.match(body, /unaudited code reaches `main`/);
  assert.match(body, /guard-git\.sh/, 'the review names what was not read');
  assert.equal(
    /no model audit required/.test(body), false,
    'an audit WAS required on the bypass path — it was skipped, which is the opposite claim'
  );
});

test('the docs-only approval keeps its accurate wording', async () => {
  const body = await runApproval({
    skip_reason: 'docs-only change (docs/** and *.md files only)',
    bypass: 'false',
  });
  assert.match(body, /no model audit required/, 'docs-only genuinely needs no audit');
  assert.equal(/WITHOUT AUDIT/.test(body), false);
});

test('both approval bodies keep the markers pr-guard.js gates on', async () => {
  // tools/pr-guard.js requires a github-actions[bot] review whose body contains both `Sam (CSO)`
  // and `APPROVED:`. Losing either on the bypass path would make the hatch unusable — removing the
  // hatch is explicitly not this change's call.
  for (const bypass of ['true', 'false']) {
    const body = await runApproval({ skip_reason: 'r', bypass, bypass_files: 'a.js' });
    assert.ok(body.includes('Sam (CSO)'), `pr-guard marker missing (bypass=${bypass})`);
    assert.ok(body.includes('APPROVED:'), `pr-guard marker missing (bypass=${bypass})`);
  }
});

// ── The alert, and what may and may not close it ───────────────────────────────────────────────

test('a step raises a per-PR human-needed alert on the bypass path', () => {
  const step = /- name: Record that a label bypass approved unaudited code[\s\S]*?(?=\n {6}- name:|\n {6}#)/
    .exec(workflowText);
  assert.ok(step, 'no step records the bypass — a bypass invisible after the fact is #450');
  const src = step[0];
  assert.match(src, /if:\s*steps\.precheck\.outputs\.bypass == 'true'/,
    'the record must fire on the bypass output, not on any skip');
  assert.match(src, /human-needed\.js[\s\S]{0,120}raise "sam-audit-bypassed-pr\$PR"/,
    'the alert key must carry the PR number');
  assert.match(src, /steps\.precheck\.outputs\.bypass_files/, 'the alert must name the files');
});

test('the bypass alert key is per-PR, so a second bypass inside 20h is not swallowed', () => {
  // human-needed.js de-dupes by key and comments at most once per PING_WINDOW_HOURS. A shared
  // `sam-audit-bypassed` key would drop the second bypass of the day entirely — the same
  // invisibility this change exists to remove.
  assert.equal(
    /raise "?sam-audit-bypassed(?!-pr)/.test(workflowText), false,
    'a bare `sam-audit-bypassed` key silently swallows concurrent bypasses on different PRs'
  );
});

test('the file list reaches the shell through env, never through a ${{ }} interpolation', () => {
  // The list is built from the PR's own filenames, so it is attacker-controlled: a branch carrying
  // a file named `a";id;"` interpolated into `run:` source becomes shell code the runner executes.
  // GitHub expands `${{ }}` BEFORE bash ever sees the script, so quoting inside the script cannot
  // save it — only `env:` can. Guarded rather than merely fixed because the unsafe form is shorter
  // and reads as equivalent.
  const step = /- name: Record that a label bypass approved unaudited code[\s\S]*?(?=\n {6}- name:|\n {6}#)/
    .exec(workflowText);
  assert.ok(step);
  const runBlock = step[0].slice(step[0].indexOf('\n        run: |'));
  assert.equal(
    /\$\{\{\s*steps\.precheck\.outputs\.bypass_files/.test(runBlock), false,
    'bypass_files must not be interpolated into the run: script — pass it via env:'
  );
  assert.match(step[0], /^ +FILES: \$\{\{ steps\.precheck\.outputs\.bypass_files \}\}$/m);
  assert.match(runBlock, /\$FILES/, 'the script must read the env var it was given');
});

test('no precheck-skip path resolves the cannot-run alert', () => {
  // The decision this change makes deliberately, guarded because the tempting edit is invisible:
  // none of draft / docs-only / spec / bypass runs the claude CLI, so none of them is evidence the
  // audit path works. Resolving from the bypass would be worst — the bypass is reached for BECAUSE
  // the audit is broken, so it would erase #445 at the moment it mattered.
  const step = /- name: Clear the cannot-run alert once an audit completes\n\s+if:([^\n]*)/
    .exec(workflowText);
  assert.ok(step, 'the clear step is gone — the alert would now never close at all');
  const cond = step[1];
  assert.match(cond, /steps\.review\.outputs\.status/, 'only a real verdict may clear the alert');
  assert.equal(
    /precheck/.test(cond), false,
    `a skip path must not clear sam-audit-cannot-run, got if:${cond}`
  );
});

test('the cannot-run alert no longer claims every PR to main is unmergeable', () => {
  // It was false and measurably so: PR #444 merged while #445 was open. An alert that overstates
  // gets read as noise, and this one is the only signal that the gate is down.
  assert.equal(
    /Every PR to \\`main\\` is unmergeable/.test(workflowText), false,
    'sam-audit.yml still overclaims — docs-only, spec and bypass PRs all merge without the CLI'
  );
  assert.match(workflowText, /bypass-sam-audit\\`-labeled PRs still pass without touching the CLI/,
    'the alert must say what a green check elsewhere does and does not prove');
});

test('the bypass hatch itself is intact', () => {
  // Explicitly Nathan's call, not this change's: the record must not have quietly become a block.
  assert.match(precheckSource(), /labels\.includes\('bypass-sam-audit'\) \|\| labels\.includes\('bypass-audit'\)/);
  assert.equal((/exit 1/.test(
    /- name: Record that a label bypass approved unaudited code[\s\S]*?(?=\n {6}- name:|\n {6}#)/
      .exec(workflowText)?.[0] ?? ''
  )), false, 'the record step must not fail the check — that would remove the hatch');
});

test('the record step has an absolute node path available to it', () => {
  // The `tools` step resolves node because the self-hosted runner's service PATH does not include
  // ~/.local/bin. It used to skip on every skip path, which would leave the record step invoking
  // an empty string.
  const step = /- name: Resolve gh\/claude absolute paths for runner service context\n[\s\S]*?if:([^\n]*)/
    .exec(workflowText);
  assert.ok(step);
  assert.match(step[1], /steps\.precheck\.outputs\.bypass == 'true'/,
    'without this the bypass record runs `"" tools/human-needed.js` and silently records nothing');
});
