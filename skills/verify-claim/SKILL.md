---
name: verify-claim
description: >
  Take an "X works" / "this is fixed" claim and drive the actual flow (run
  the command, hit the endpoint, exercise the UI) to return evidence or a
  refutation. Triggers on "verify this works", "prove it", "does this
  actually work", "verify-claim", before marking any task done. Evidence
  before assertion — never confirm a claim from reading code alone.
---

## Procedure

1. **Restate the claim** in one falsifiable sentence: "X, given input Y, produces Z."
2. **Find the smallest real exercise** of the claim — prefer, in order:
   - an existing test that covers it (`node --test <file>` / project test runner)
   - running the actual command/script/endpoint with real input
   - starting the app and driving the flow (browser tool, curl, CLI invocation)
   Do NOT accept "the code looks correct" as verification.
3. **Run it** and capture the literal output (exit code, stdout/stderr, HTTP status, screenshot). On Windows Git Bash, check exit code with `echo $?` immediately after the command — do not rely on `&&` chains masking failures.
4. **Compare** actual output to the claim from step 1.
5. **Report**:
   - `VERIFIED: <claim>` + the exact command and output that proves it, or
   - `REFUTED: <claim>` + the exact command and output that contradicts it, or
   - `UNVERIFIABLE: <reason>` if no real exercise was possible (e.g. missing credentials) — this is not a pass.

Never write "should work" or "looks correct" as a substitute for step 3. If pressed for time, verify the highest-risk part of the claim, not the easiest part.
