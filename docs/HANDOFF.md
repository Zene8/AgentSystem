# Agent System Handoff

**Last Updated:** 2026-05-21
**Status:** Canonical agents, docs, and sync output are unified.

## Current State

- Canonical agent definitions live in `.agents/agents/`.
- `sync_agents_from_repo.ps1` generates the user-level Claude, Copilot, Gemini, and Antigravity files.
- `README.md`, `CLAUDE.md`, and `AGENTS.md` are the active repo docs.
- Repo-level CLI agent folders are no longer authoritative.
- Backup copy: `repo-agent-backup-20260521-044914/`.

## Blocked Work

Use this section to track work that is blocked waiting on another agent or external dependency.
Jarvis monitors this section on startup (step 3 of startup checklist).

Format:
```
- **[DATE] [Blocking Agent] waiting on [Blocked-by Agent/System]:** [What is blocked] — [What is needed to unblock]
```

Current blockers:

_(none)_

## In-Flight Work

Work that is started but not yet complete. Link to GitHub issues.

_(none at this time — see GitHub Issues for current sprint)_

## Startup

Read these first:
1. `CLAUDE.md` (default agent, bypass, post-sync checklist)
2. `docs/HANDOFF.md` (this file — blockers and in-flight)
3. `AGENTS.md` (routing rules, domain ownership, coordination rules)
4. `.agents/memory/<agent>.md` (agent-specific decision log and session notes)

## Working Rules

- Edit master agents in `.agents/agents/` only.
- Run `powershell -File .\sync_agents_from_repo.ps1` after agent changes.
- Treat `docs/HANDOFF.md` as the current-state log for in-flight work and blockers.
- Keep docs concise and aligned with the sync script behavior.

## Notes

- Claude output uses YAML frontmatter plus body.
- Copilot output uses YAML frontmatter plus body.
- Gemini output uses YAML frontmatter with slugged names.
- The inject scripts were legacy context helpers and are not part of the current sync flow.
