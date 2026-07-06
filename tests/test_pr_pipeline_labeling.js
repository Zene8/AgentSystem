'use strict';

// Contract tests for the branch/title classification logic used by
// .github/workflows/pr-automation.yml's "Add spec/implementation label
// based on branch/title" step (issue #162, Part B4).
//
// The workflow itself runs bash regex inside a GitHub Actions `run:` block,
// which can't be `require()`d directly. These tests mirror the exact bash
// conditions in JS so the classification rules have unit coverage and any
// future edit to the workflow's regex can be cross-checked here first.
//
// Bash source of truth (kept in sync manually — see workflow file):
//   if [[ "$BRANCH" =~ issue-[0-9]+-spec ]] || [[ "$TITLE" =~ ^\[(Spec|Plan)\] ]]; then
//     -> spec
//   elif [[ "$BRANCH" =~ issue-[0-9]+- ]] && ! [[ "$BRANCH" =~ issue-[0-9]+-spec ]]; then
//     -> implementation
//   fi

import test from 'node:test';
import assert from 'node:assert/strict';

function classify(branch, title) {
  const isSpecBranch = /issue-[0-9]+-spec/.test(branch);
  const isSpecTitle = /^\[(Spec|Plan)\]/.test(title);
  if (isSpecBranch || isSpecTitle) return 'spec';

  const isIssueBranch = /issue-[0-9]+-/.test(branch);
  if (isIssueBranch && !isSpecBranch) return 'implementation';

  return null;
}

test('classify: issue-N-spec branch -> spec', () => {
  assert.equal(classify('issue-162-spec-purpose-alignment', 'Some title'), 'spec');
});

test('classify: [Spec] title prefix -> spec regardless of branch', () => {
  assert.equal(classify('feature/whatever', '[Spec] Purpose alignment'), 'spec');
});

test('classify: [Plan] title prefix -> spec regardless of branch', () => {
  assert.equal(classify('feature/whatever', '[Plan] Purpose alignment'), 'spec');
});

test('classify: [Plan] must be a prefix, not merely present anywhere in title', () => {
  // Regression guard: an earlier draft used `^\[Spec\]|\[Plan\]` which is
  // mis-precedenced (only the left side of `|` is anchored), so titles like
  // "Fix bug (see [Plan] doc)" would incorrectly classify as spec even
  // though a plain issue-N- implementation branch is in play.
  assert.equal(
    classify('issue-162-purpose-alignment', 'Fix bug (see [Plan] doc)'),
    'implementation'
  );
});

test('classify: issue-N- implementation branch -> implementation', () => {
  assert.equal(classify('issue-162-purpose-alignment', 'Purpose alignment fixes'), 'implementation');
});

test('classify: non-issue branch, non-spec title -> no label', () => {
  assert.equal(classify('chore/cleanup', 'Chore: cleanup'), null);
});

test('classify: issue-N-spec branch takes precedence over implementation match', () => {
  assert.equal(classify('issue-9-spec-design', 'Design'), 'spec');
});

// Contract test for .github/workflows/ci-failure-notify.yml's PR-number
// resolution: it treats `.pull_requests[0].number` as absent for any
// non-pull_request-triggered workflow_run (e.g. a direct push), which the
// workflow's `if:` guard is expected to skip entirely.
function extractPrNumber(workflowRunEvent, pullRequests) {
  if (workflowRunEvent !== 'pull_request') return null;
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) return null;
  return pullRequests[0].number ?? null;
}

test('extractPrNumber: pull_request event with PR array -> number', () => {
  assert.equal(extractPrNumber('pull_request', [{ number: 42 }]), 42);
});

test('extractPrNumber: push event (not pull_request) -> null, no-op', () => {
  assert.equal(extractPrNumber('push', [{ number: 42 }]), null);
});

test('extractPrNumber: pull_request event but empty PR array -> null', () => {
  assert.equal(extractPrNumber('pull_request', []), null);
});
