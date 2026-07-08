---
name: replicate-bug
description: >
  Turn a bug report into a failing test FIRST, then fix it. Triggers on "fix
  this bug", "replicate this bug", "this is broken", "replicate-bug", any
  bug-fix task — enforces test-before-fix discipline so every fix ships with
  a regression test.
---

## Procedure — do not write the fix before step 3 passes (red)

1. **Read the bug report** and restate it as a precise input → expected output → actual output triple.
2. **Locate the test file** that should cover this area (`tests/**/*.test.js` or project convention). If none exists, create one in the matching location.
3. **Write a test that reproduces the bug** — it must fail against current code for the right reason (not a typo in the test itself). Run it:
   ```bash
   node --test tests/<file>.test.js
   ```
   Confirm RED: the test fails, and the failure message matches the bug (not an unrelated error).
4. **Implement the fix** — smallest change that makes the test pass without breaking others.
5. **Run the full suite** — the new test must go GREEN and no other test may regress:
   ```bash
   node --test tests/
   ```
6. Report: the failing-test commit message and the fix commit, plus the before/after test output. Never claim a bug is fixed without a test that would have caught it.
