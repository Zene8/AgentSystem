---
name: scope
description: >
  Decompose an incoming task into independent modules, decide solo vs. swarm
  by the 3-module rule, and output a dispatch plan with per-subtask effort
  tiers. Triggers on "scope this task", "how should I break this down",
  "plan the dispatch", "/scope", before spawning any workers on a
  multi-file task.
---

## Procedure

1. **List the independent modules/streams** the task touches (e.g. backend route, DB migration, frontend component, docs). "Independent" = no shared file, can be worked without waiting on another stream's output.
2. **Apply the swarm-sizing rule**: fewer than 3 genuinely independent streams → assign to ONE worker (still delegate to the matching domain worker; do not do it yourself). 3+ independent streams → parallel swarm, one worker per stream.
3. **Classify each subtask's complexity**:
   - SIMPLE: docs, single file, read-only, grep/lookup → low effort, small model
   - STANDARD: 1–15 files, one feature/bugfix → default effort
   - COMPLEX: architecture, security, cross-cutting, >15 files → high/max effort
4. **Output a dispatch plan** as a table: `stream | worker | effort tier | files touched | depends-on`.
5. Flag any stream that's ambiguous or contradicts a prior decision (`node tools/decision-log.js --search --query="<keywords>"`) before dispatching — resolve or escalate, don't guess.
