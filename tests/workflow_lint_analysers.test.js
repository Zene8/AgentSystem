// #319: workflow-lint.yml runs actionlint with `-shellcheck= -pyflakes=`, disabling two of
// actionlint's four analysers. That was deliberate so the new gate landed green instead of red
// (see the comment above the `actionlint` step in workflow-lint.yml) — but it means real
// findings (SC2086/SC2001 in ci-failure-notify.yml, at minimum) go uncaught, and nothing here
// says so anywhere a reader trips over it.
//
// This test fails once those flags disable an analyser and passes once they don't. It cannot by
// itself prove actionlint is clean with shellcheck+pyflakes enabled — that needs the actionlint
// binary, shellcheck and pyflakes installed on the box running the test, which is a runner
// environment concern, not something a repo-only Node test can assert. It only pins the workflow
// source: the flags must not silently reappear once removed.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW_LINT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.github',
  'workflows',
  'workflow-lint.yml',
);

test('workflow-lint.yml does not disable actionlint analysers', () => {
  const text = readFileSync(WORKFLOW_LINT, 'utf8');
  const disabled = [];
  if (/-shellcheck=(\s|$)/.test(text)) disabled.push('-shellcheck=');
  if (/-pyflakes=(\s|$)/.test(text)) disabled.push('-pyflakes=');
  assert.deepStrictEqual(
    disabled,
    [],
    `workflow-lint.yml disables actionlint analyser(s): ${disabled.join(', ')} — see #319`,
  );
});
