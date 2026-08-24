// autolink_issue_resolution.test.js — regression coverage for #469.
//
// `.github/workflows/pr-automation.yml`'s "Extract linked issue number from head branch" step
// (job `pr-opened`, `Autolink PR`) resolves a branch-derived `issue-<N>` segment exactly ONCE,
// so a number that does not exist in this repo (or belongs to a PR, not an issue) is reported as
// absent rather than reaching `gh issue view` downstream under this job's inherited `bash -e`
// (#457). #469's remaining ask on top of that fix: every skip path must emit a `::notice::`
// annotation naming the number/branch, not a plain `echo`, and the job must still exit 0.
//
// This test extracts the real `run: |` bodies from the workflow YAML (the same technique
// workflow_errexit.test.js uses — tools/tests take no npm deps, so no YAML parser) and executes
// the extraction step under the real Actions bash flags (`-e -o pipefail`) with a stubbed `gh`
// on PATH, so the assertions are against the script that ships, not a re-implementation of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WF_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '.github', 'workflows', 'pr-automation.yml'
);
const workflowSrc = fs.readFileSync(WF_PATH, 'utf8').replace(/\r\n/g, '\n');

// Pull the body of a step's `run: |` block: everything indented past the block's own margin.
// (Same approach as workflow_errexit.test.js's extractRun.)
function extractRun(src, stepName) {
  const start = src.indexOf(`- name: ${stepName}`);
  assert.notStrictEqual(start, -1, `no step named "${stepName}" — the parse is stale`);
  const rest = src.slice(start);
  const run = rest.match(/\n(\s+)run: \|\n/);
  assert.ok(run, `step "${stepName}" has no \`run: |\` block`);
  const bodyIndent = run[1].length + 2;
  const lines = rest.slice(run.index + run[0].length).split('\n');
  const body = [];
  for (const line of lines) {
    if (line.trim() === '') { body.push(''); continue; }
    if (line.search(/\S/) < bodyIndent) break;
    body.push(line.slice(bodyIndent));
  }
  return body.join('\n');
}

// Pull the block of lines for a whole step (from its `- name:` line up to, but not including,
// the next `- name:` at the same nesting), so we can inspect its `if:` guard as well as its body.
function extractStepBlock(src, stepName) {
  const start = src.indexOf(`- name: ${stepName}`);
  assert.notStrictEqual(start, -1, `no step named "${stepName}" — the parse is stale`);
  const rest = src.slice(start);
  const next = rest.slice(1).search(/\n\s+- name:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const extractStepName = 'Extract linked issue number from head branch';
const copyStepName = 'Copy labels + milestone from linked issue';

const extractBody = extractRun(workflowSrc, extractStepName);
const copyBlock = extractStepBlock(workflowSrc, copyStepName);

// ── Static assertions on the YAML itself ────────────────────────────────────────────────────

test('all three skip paths in the extraction step emit ::notice::, not a plain echo', () => {
  assert.match(
    extractBody,
    /echo "::notice::Branch '\$BRANCH' carries no issue-<N> segment/,
    'no-issue-number-in-branch path must be a ::notice:: annotation'
  );
  assert.match(
    extractBody,
    /echo "::notice::Issue #\$\{N\} from branch '\$BRANCH' does not resolve/,
    'unresolvable-number path must be a ::notice:: annotation'
  );
  assert.match(
    extractBody,
    /echo "::notice::#\$\{N\} resolves to a pull request, not an issue/,
    'resolves-to-a-PR path must be a ::notice:: annotation'
  );
  // The diagnostic "gh said:" detail stays a plain echo underneath the notice — it is not itself
  // the annotation and should not create a second one.
  assert.match(extractBody, /echo "  gh said: \$\{RESOLVED\}"/);
  assert.doesNotMatch(extractBody, /echo "::notice::\s*$/m);
});

test('every skip path still sets issue_number= empty and exits 0 (never reaches gh issue view)', () => {
  // Each of the three `if`/skip blocks must pair its notice with an empty issue_number and exit 0
  // before falling through to the resolved-number code path.
  const skipBlocks = extractBody.split(/echo "::notice::/).slice(1);
  assert.equal(skipBlocks.length, 3, 'expected exactly 3 ::notice:: skip paths');
  for (const block of skipBlocks) {
    const head = block.split(/\n\s*\n|echo "Branch/)[0]; // just this if-block, roughly
    assert.match(block.slice(0, 200), /issue_number=" >> "\$GITHUB_OUTPUT"/);
    assert.match(block.slice(0, 200), /exit 0/);
  }
});

test('invariant: the label/milestone copy step never resolves a branch-derived number itself', () => {
  // The bug this issue closes was exactly this: a second, unguarded resolution of the
  // branch-derived number inside the copy step. Pin that ISSUE_NUM there comes only from the
  // extraction step's output, never from re-deriving it from $BRANCH/HEAD_REF.
  assert.match(
    copyBlock,
    /ISSUE_NUM="\$\{\{ steps\.linked\.outputs\.issue_number \}\}"/,
    'Copy step must source ISSUE_NUM from steps.linked.outputs.issue_number'
  );
  assert.doesNotMatch(
    copyBlock,
    /HEAD_REF|BRANCH|issue-\(\[0-9\]\+\)/,
    'Copy step must not re-derive an issue number from the branch — that is the #469 bug shape'
  );
  assert.match(
    copyBlock,
    /if: steps\.linked\.outputs\.issue_number != ''/,
    'Copy step must remain gated on a non-empty resolved issue_number'
  );
});

// ── Behavioural assertions: execute the shipped bash under real Actions flags ───────────────

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

function runExtractStep({ branch, ghMode }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autolink-'));
  const outputFile = path.join(dir, 'github_output');
  fs.writeFileSync(outputFile, '');

  // A stub `gh` on PATH ahead of the real one, driven by GH_MODE:
  //   notfound  -> `gh api repos/.../issues/N` fails, as it does for a nonexistent number
  //   pr        -> resolves, but is a pull request
  //   issue     -> resolves as a real issue
  const ghStub = path.join(dir, 'gh');
  fs.writeFileSync(ghStub, `#!/usr/bin/env bash
if [ "\$1" = "api" ]; then
  case "$GH_MODE" in
    notfound)
      echo "GraphQL: Could not resolve to an issue or pull request with the number of 747. (repository.issue)" >&2
      exit 1
      ;;
    pr)
      echo "pr"
      exit 0
      ;;
    issue)
      echo "issue"
      exit 0
      ;;
  esac
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`);
  fs.chmodSync(ghStub, 0o755);

  const result = spawnSync(
    'bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', extractBody],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        HEAD_REF: branch,
        REPO: 'Zene8/AgentSystem',
        GITHUB_OUTPUT: outputFile,
        GH_MODE: ghMode ?? '',
      },
    }
  );

  const output = fs.readFileSync(outputFile, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...result, output };
}

test('unresolvable path (#469): no gh issue view call, ::notice:: emitted, issue_number empty, exit 0',
  { skip: !hasBash && 'bash not available' },
  () => {
    const { status, stdout, output } = runExtractStep({
      branch: 'issue-747-not-planned-close',
      ghMode: 'notfound',
    });
    assert.equal(status, 0, 'step must exit 0 on an unresolvable branch-derived number');
    assert.match(stdout, /::notice::Issue #747 from branch 'issue-747-not-planned-close' does not resolve/);
    assert.match(stdout, /gh said:.*Could not resolve/);
    assert.match(output, /^issue_number=\s*$/m, 'issue_number output must be set empty');
  }
);

test('no issue-<N> segment in branch: ::notice::, empty issue_number, exit 0 (no gh call at all)',
  { skip: !hasBash && 'bash not available' },
  () => {
    const { status, stdout, output } = runExtractStep({ branch: 'chore/tidy-readme' });
    assert.equal(status, 0);
    assert.match(stdout, /::notice::Branch 'chore\/tidy-readme' carries no issue-<N> segment/);
    assert.match(output, /^issue_number=\s*$/m);
  }
);

test('branch number resolves to a PULL REQUEST: ::notice::, empty issue_number, exit 0',
  { skip: !hasBash && 'bash not available' },
  () => {
    const { status, stdout, output } = runExtractStep({
      branch: 'issue-453-some-work',
      ghMode: 'pr',
    });
    assert.equal(status, 0);
    assert.match(stdout, /::notice::#453 resolves to a pull request, not an issue/);
    assert.match(output, /^issue_number=\s*$/m);
  }
);

test('resolving path: issue_number is set, no ::notice:: emitted, exit 0', { skip: !hasBash && 'bash not available' }, () => {
  const { status, stdout, output } = runExtractStep({
    branch: 'issue-296-linked-issue-gate',
    ghMode: 'issue',
  });
  assert.equal(status, 0);
  assert.doesNotMatch(stdout, /::notice::/);
  assert.match(stdout, /Branch 'issue-296-linked-issue-gate' -> issue #296 \(resolved\)\./);
  assert.match(output, /^issue_number=296\s*$/m);
});

// ── The copy step still does the work when gated open (no regression) ──────────────────────

test('Copy labels + milestone step still performs BOTH the label and milestone copy', () => {
  const copyBody = extractRun(workflowSrc, copyStepName);
  assert.match(copyBody, /gh issue view "\$\{ISSUE_NUM\}".*--json labels/);
  assert.match(copyBody, /gh pr edit "\$\{PR_NUMBER\}".*--add-label "\$LABELS"/);
  assert.match(copyBody, /gh issue view "\$\{ISSUE_NUM\}".*--json milestone/);
  assert.match(copyBody, /gh pr edit "\$\{PR_NUMBER\}".*--milestone "\$MILESTONE"/);
});
