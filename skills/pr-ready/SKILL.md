---
name: pr-ready
description: >
  Pre-flight check before marking a PR ready for review — tests, lint,
  self-review of the diff, description quality, labels — then flips the PR
  from draft to ready (which fires the Sam security-audit gate). Triggers on
  "mark this PR ready", "pr-ready", "is this PR ready to merge", "flip to
  ready for review".
---

## Procedure — run every step; do not skip to the flip

1. **Tests**: `node --test tests/` (or the project's test command). Must exit 0. If any test fails, STOP — not ready.
2. **Lint/typecheck** if the repo defines one (check `package.json` scripts). Must pass.
3. **Self-review the diff**:
   ```bash
   git diff main...HEAD --stat
   git diff main...HEAD
   ```
   Look for: leftover debug prints, TODOs without a tracking issue, secrets/keys, files that shouldn't be touched (check the task's don't-touch list).
4. **Description quality** — `gh pr view <N> --json body,title` — confirm the body has a Summary and a Test plan, and closes the right issue (`Closes #N`).
5. **Labels** — `gh pr view <N> --json labels` — apply any missing required label (e.g. `implementation`).
6. **Flip to ready** (only after 1–5 all pass):
   ```bash
   gh pr ready <N>
   ```
   This fires the Sam pre-merge security audit — do not merge until Sam approves and the user confirms with `/merge`.
7. Report a checklist of what passed/failed for each step above — never just "done."
