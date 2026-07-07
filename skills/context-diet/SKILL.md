---
name: context-diet
description: >
  Mid-session context reset — summarize essentials, restate standing
  constraints, drop dead context. Triggers on "context diet", "trim
  context", "summarize where we are", "clean up context", when a long
  session is dragging or before a compaction is likely.
---

## Procedure

1. **Restate the current goal** in one sentence — what is the user actually trying to get done right now (not the whole session history).
2. **List standing constraints** that must survive the trim: don't-touch files/paths, required labels, branch name, issue number, any explicit user preference stated this session.
3. **List load-bearing facts** — file paths, function signatures, decisions made, test results — anything a later step will need verbatim. Drop everything else: exploratory reads that didn't pan out, tool output already superseded, dead-end approaches.
4. **Drop, don't summarize, dead ends** — a dead end doesn't need a summary, just a one-line note that it was tried and rejected (and why, if it's a reusable lesson).
5. Output the trimmed context as: `## Goal` / `## Constraints` / `## Load-bearing facts` / `## Rejected approaches (1-line each)`. This becomes the new working context — proceed from it, don't re-derive from full history.
