# Agent System Handoff

**Last Updated:** 2026-05-21
**Status:** Canonical agents, docs, and sync output are unified.

## Current State

- Canonical agent definitions live in `.agents/agents/`.
- `sync_agents_from_repo.ps1` generates the user-level Claude, Copilot, Gemini, and Antigravity files.
- `README.md`, `CLAUDE.md`, and `AGENTS.md` are the active repo docs.
- Repo-level CLI agent folders are no longer authoritative.
- Backup copy: `repo-agent-backup-20260521-044914/`.

## Startup

Read these first:
1. `CLAUDE.md` or `GEMINI.md`
2. `docs/HANDOFF.md`
3. `.claude/agent-memory/MEMORY.md` or the matching agent memory file

## Working Rules

- Edit master agents in `.agents/agents/` only.
- Run `powershell -File .\sync_agents_from_repo.ps1` after agent changes.
- Treat `docs/HANDOFF.md` as the current-state log for in-flight work.
- Keep docs concise and aligned with the sync script behavior.

## Notes

- Claude output uses YAML frontmatter plus body.
- Copilot output uses YAML frontmatter plus body.
- Gemini output uses YAML frontmatter with slugged names.
- The inject scripts were legacy context helpers and are not part of the current sync flow.
