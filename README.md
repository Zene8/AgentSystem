# AgentSystem — Unified AI Agent Registry

This repository is the single source of truth for an AI agent fleet that runs across multiple CLIs (Claude Code, Gemini CLI, Copilot). It contains canonical agent definitions, memory, sync automation, and governance docs.

Top-level docs
- [AGENTS.md](AGENTS.md) — roster, roles, and decision authority (primary agent WIKI)
- [CLAUDE.md](CLAUDE.md) — Claude-specific configuration and memory guidance
- [docs/HANDOFF.md](docs/HANDOFF.md) — current state, blockers, and next steps
- [.agents/](.agents/) — canonical agent definitions (master files)
- `sync_agents_from_repo.ps1` — syncs `.agents/` → user CLI folders (`%USERPROFILE%\.claude`, `\.copilot`, `\.gemini`)

Quick start
1. Edit or add an agent under `.agents/agents/` (follow the existing master format)
2. Run the sync to push user copies:
```powershell
powershell -File .\sync_agents_from_repo.ps1
```

Design principles
- Single source of truth: keep agent definitions in `.agents/` and sync to user CLI folders
- Per-agent model mappings are handled by the sync script to match each platform's model ids
- Memory is stored in `agents-memory/` and indexed by `MEMORY.md`

If you want a developer walkthrough or to propose doc deletions, open an issue referencing this README and the `AGENTS.md` entry for the affected agent.
