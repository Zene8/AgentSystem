---
name: postmortem
description: >
  Structured 5-whys root-cause analysis on a failure (bug, incident, bad
  merge), then append the root cause and a reusable trap to sona-patterns.md.
  Triggers on "postmortem", "why did this fail", "5 whys", "root cause this",
  after any production incident or a bug that took multiple attempts to fix.
---

## Procedure

1. **State the failure** as an observed fact (symptom), not a diagnosis: "X returned 500 when Y" not "X is broken."
2. **5 Whys** — ask "why" against the previous answer, five times or until you hit a root cause that is either (a) a decision that was made, or (b) a missing check/test. Write out all five, don't skip to a guess at #5.
3. **Verify the root cause** — don't accept the last "why" on faith; reproduce it if possible (see `verify-claim` skill) or point to the exact log line/diff/config that proves it.
4. **Identify the fix AND the prevention** — the fix resolves this instance; the prevention (test, lint rule, doc note, trap) stops the class of bug.
5. **Append to the pattern log**:
   ```bash
   cat >> ~/agent-memory/nexus/sona-patterns.md <<'EOF'

   ### [short-name] — YYYY-MM-DD — <YourAgentName>
   **S:** [task type, tech stack, constraints]
   **O:** [root cause found via 5-whys]
   **N:** [files/nodes involved]
   **A:** [fix + prevention] | success: yes
   EOF
   ```
6. If the trap is generic enough to hit other tasks (not just this repo), also add it as a bullet to the standing trap list referenced by the `trap-check` skill.
