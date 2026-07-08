---
name: model-check
description: >
  Before starting a big task, verify the model/effort tier actually fits the
  work — flag high-effort/opus spend on rote tasks and under-powered models
  on architecture work. Triggers on "model check", "is this the right
  model", "am I overspending on this", "model-check", before spawning any
  worker with non-default effort.
---

## Procedure

1. **Classify the task** using the same buckets Friday uses:
   - SIMPLE: docs, read-only, grep/search, single file, rename/format
   - STANDARD: feature implementation, bug fix, 1-15 files
   - COMPLEX: architecture, security, >15 files, cross-cutting, design decisions
2. **Check what's about to be spent** — model tier and effort level requested for the worker/session.
3. **Mismatch table**:
   | Task class | Right-sized | Overkill (flag) | Underpowered (flag) |
   |---|---|---|---|
   | SIMPLE | haiku, low effort | opus/sonnet high effort | — |
   | STANDARD | sonnet, default effort | opus max effort | haiku |
   | COMPLEX | opus, high/max effort | — | haiku, low effort |
4. **If overkill**: say so explicitly and suggest the cheaper tier — e.g. "This is a mechanical rename across 2 files, SIMPLE tier. Opus max effort is overkill; use haiku low effort or caveman:cavecrew-builder." Reference the swarm-sizing rule (#164): rote subtasks get low effort, architecture/security get high/max.
5. **If underpowered**: flag the risk — e.g. "This touches auth + DB schema + 20 files, COMPLEX. Haiku/low-effort risks a shallow pass; use opus/sonnet with high effort or route to the domain worker (Pym/Ultron) instead."
6. **Cross-check actual cost after the fact** (optional, if the task already ran):
   ```bash
   node ~/dev/AgentSystem/tools/session-cost.js --top
   ```
   Compare against the classification — repeated overkill on the same task type is a pattern worth a decision-log entry (see `decision` skill).
7. Report one line: task class, requested tier, verdict (fits / overkill / underpowered), and the suggested tier if it doesn't fit. Don't block the task — this is advisory, not a gate.
