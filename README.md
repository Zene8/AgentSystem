# AgentSystem — Unified AI Agent Registry

This repository is the single source of truth for an AI agent fleet that runs across multiple CLIs (Claude Code, Gemini CLI, Copilot). It contains canonical agent definitions, memory, sync automation, and governance docs.

Top-level docs
- [AGENTS.md](AGENTS.md) — roster, roles, and decision authority (primary agent WIKI)
- [CLAUDE.md](CLAUDE.md) — Claude-specific configuration and memory guidance
- [docs/HANDOFF.md](docs/HANDOFF.md) — current state, blockers, and next steps
- [.agents/](.agents/) — canonical agent definitions (master files)
- `sync_agents_from_repo.ps1` — syncs `.agents/` → user CLI folders (`%USERPROFILE%\.claude`, `\.copilot`, `\.gemini`)

Quick start

**First time on a new machine:**
```powershell
.\install.ps1                          # checks prereqs, inits brain, syncs agents, creates labels
.\install.ps1 -Runner                  # also sets up self-hosted runner (requires admin)
```

**New repo (add AgentSystem to any project):**
```powershell
cd C:\path\to\your\repo
powershell -File C:\path\to\AgentSystem\tools\bootstrap-repo.ps1
```

**After editing agents:**
```powershell
powershell -File .\sync_agents_from_repo.ps1
```

**MCP server (exposes agent tools natively in Claude Code):**
```powershell
npm install
claude mcp add agentsystem -- node C:\path\to\AgentSystem\tools\mcp-server.js
```
MCP tools available after install: `agent_send_message`, `agent_list_inbox`, `graph_query`, `memory_read_brain`, `memory_read_agent`

Design principles
- Single source of truth: keep agent definitions in `.agents/` and sync to user CLI folders
- Per-agent model mappings are handled by the sync script to match each platform's model ids
- Memory is stored in `agents-memory/` and indexed by `MEMORY.md`

If you want a developer walkthrough or to propose doc deletions, open an issue referencing this README and the `AGENTS.md` entry for the affected agent.
