---
name: handoff-brief
description: >
  Generate a dispatch brief for a worker/subagent — verbatim ask, definition
  of done, constraints, and a don't-touch list. Triggers on "write a dispatch
  brief", "brief this worker", "handoff-brief", before spawning any Agent/CLI
  background worker on a nontrivial task.
---

## Procedure

Produce exactly these four sections — a worker starts with zero context, so nothing implied is transmitted:

1. **Verbatim ask** — quote the user's/issue's actual request, don't paraphrase away detail. Include the issue number and a `gh issue view <N>` pointer if one exists.
2. **Definition of done** — a numbered checklist that is objectively checkable (tests pass, file exists, PR opened to X, etc.) — not vague ("make it good").
3. **Constraints** — anything the worker must not violate: tech stack, style conventions, path-scoped rules from `CLAUDE.md`, security/compliance requirements, known traps (pull from `trap-check` skill if relevant).
4. **Don't-touch list** — explicit files/directories/workflows the worker must leave alone (e.g. `.github/workflows/**`, `~/.claude/settings.json` permission keys) and why.

Keep it terse and complete — a smart colleague who just walked in should be able to execute from this brief alone, without asking "wait, what does this depend on?" Do not include your own reasoning process or exploration history, only what the worker needs.
