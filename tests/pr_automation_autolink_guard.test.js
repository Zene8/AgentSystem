'use strict';

// Regression coverage for issue #469: pr-automation.yml's "Autolink PR" job hard-failed
// (run 32180587412, PR #453) when a branch-derived issue number does not exist in this repo —
// `gh` exited non-zero mid-step under Actions' inherited `bash -e`, turning a correct "nothing to
// copy" case into a red run and a failure email.
//
// The "Extract linked issue number from head branch" step already resolves the number defensively
// (added by #457/#458) so the job exits 0 either way, but it announced a skip with a plain `echo`
// instead of the `::notice::` annotation the issue's Definition of Done asks for, and had no test.
// This extracts the real `run:` block and executes it under the exact flags Actions uses
// (`bash --noprofile --norc -e -o pipefail`), with a stubbed `gh`, so the assertions run against
// the actual script GitHub executes rather than a JS reimplementation of its logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const WORKFLOW = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.github',
  'workflows',
  'pr-automation.yml'
);
const STEP = '- name: Extract linked issue number from head branch';

function extractRunBlock() {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
  const stepAt = lines.findIndex((l) => l.trim() === STEP);
  assert.notEqual(stepAt, -1, `step not found in ${WORKFLOW} — was it renamed?`);
  const runAt = lines.findIndex((l, i) => i > stepAt && l.trim() === 'run: |');
  assert.notEqual(runAt, -1, 'no `run: |` after the step');

  const body = [];
  const indent = lines[runAt].search(/\S/) + 2;
  for (let i = runAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() !== '' && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  const script = body.join('\n');
  assert.match(script, /BASH_REMATCH\[1\]/, 'extracted the wrong block — no issue-N regex in it');
  return script;
}

// Stub `gh`: only handles the `gh api repos/.../issues/N --jq ...` call this step makes.
// Behavior is selected by $STUB_GH_MODE so each test controls whether the number resolves.
const GH_STUB = `#!/usr/bin/env bash
case "$STUB_GH_MODE" in
  resolve-issue) echo "issue"; exit 0 ;;
  resolve-pr) echo "pr"; exit 0 ;;
  not-found)
    echo "GraphQL: Could not resolve to an issue or pull request with the number of \${STUB_GH_NUM:-0}. (repository.issue)" >&2
    exit 1
    ;;
  *) echo "unhandled STUB_GH_MODE: $STUB_GH_MODE" >&2; exit 2 ;;
esac
`;

function run(script, { branch, mode }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'autolink-guard-'));
  const binDir = path.join(dir, 'bin');
  mkdirSync(binDir);
  const ghPath = path.join(binDir, 'gh');
  writeFileSync(ghPath, GH_STUB);
  chmodSync(ghPath, 0o755);

  const scriptPath = path.join(dir, 'step.sh');
  writeFileSync(scriptPath, script);

  const outputPath = path.join(dir, 'github_output');
  writeFileSync(outputPath, '');

  // Actions runs a bash `run:` block as `bash --noprofile --norc -e -o pipefail {0}` — the -e
  // is what turned an unresolved `gh` call into a hard failure before #457/#458.
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', scriptPath],
    {
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        HEAD_REF: branch,
        REPO: 'Zene8/AgentSystem',
        GITHUB_OUTPUT: outputPath,
        STUB_GH_MODE: mode,
      },
      encoding: 'utf8',
    }
  );
  result.output_file = readFileSync(outputPath, 'utf8');
  return result;
}

test('issue number that does not resolve in this repo: exits 0, empty output, ::notice:: names the number', () => {
  const script = extractRunBlock();
  const result = run(script, { branch: 'issue-747-not-planned-close', mode: 'not-found' });

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
  assert.match(
    result.stdout,
    /::notice::/,
    `expected a ::notice:: annotation naming the unresolved issue; stdout was:\n${result.stdout}`
  );
  assert.match(result.stdout, /747/, 'the notice must name the branch-derived issue number');
  assert.match(result.output_file, /issue_number=\n/, 'issue_number output must be empty on a non-resolving number');
});

test('issue number resolving to a PR (not an issue): exits 0, empty output, ::notice::', () => {
  const script = extractRunBlock();
  const result = run(script, { branch: 'issue-453-something', mode: 'resolve-pr' });

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
  assert.match(result.stdout, /::notice::/, 'a PR-not-issue resolution should also notice, not silently skip');
  assert.match(result.output_file, /issue_number=\n/, 'issue_number output must be empty when #N is a PR');
});

test('issue number that resolves to a real issue: exits 0, output carries the number (unchanged behavior)', () => {
  const script = extractRunBlock();
  const result = run(script, { branch: 'issue-166-purpose-alignment', mode: 'resolve-issue' });

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
  assert.match(result.output_file, /issue_number=166\n/, 'a resolving number must still be published for downstream steps');
});
