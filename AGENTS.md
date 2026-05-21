# Agent System Reference

This file is the agent wiki. Canonical definitions live in `.agents/agents/`, and per-agent memory lives in `agents-memory/`.

## Roster

| Agent | Role | Authority |
|---|---|---|
| Jarvis | CEO, cross-agent coordination, escalations | Autonomous |
| Friday | CTO, engineering architecture and delivery | Autonomous (Sam gate for main) |
| Nat | CBO, strategy and GTM | Autonomous |
| Sam | CSO, security and compliance | Autonomous + Hard Gate |
| Wanda | Design, UX/UI, systems | Domain |
| Threepio | Comms and docs | Domain |
| Ultron | Backend | Domain |
| Astra | Frontend | Domain |
| Pym | Database | Domain |
| Leo | DevOps | Domain |
| General Coding | General-purpose coding help | Domain |

## Source of Truth

- `.agents/agents/<agent>.md` — master agent definition
- `agents-memory/<agent>.md` — decision log and session notes
- `sync_agents_from_repo.ps1` — generates user-level Claude, Copilot, Gemini, and Antigravity copies

## Model Policy

- Jarvis: Opus, `gemini-3.1-pro-preview`, `gpt-5.2-codex`
- Friday / Nat / Sam: Sonnet, `gemini-2.5-pro`, `gpt-5.4-mini`
- Threepio: Haiku, `gemini-3.1-flash-lite-preview`, `gpt-5-mini`
- All other agents: Haiku, `gemini-3-flash-preview`, `gpt-5-mini`

## Operating Rules

- Keep agent definitions in `.agents/` and sync them to user CLI folders.
- Use `README.md` for the repo entry point and `CLAUDE.md` for Claude-specific usage.
- If a model mapping or agent policy changes, update the sync script first, then regenerate outputs.

## WIKI Links

- `README.md` — repo overview and quick start
- `CLAUDE.md` — Claude usage and troubleshooting
- `agents-memory/MEMORY.md` — memory index

## Cleanup Notes

If you want to archive obsolete documentation, do it intentionally with a timestamped backup folder and keep the canonical docs above as the only active entry points.
