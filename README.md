# AgentSystem

Global multi-agent system infrastructure. Agent prompt files live in `~/.claude/agents/` and `~/.gemini/agents/`.

## Contents

- `docs/specs/` — Design documents for the agent system
- `docs/plans/` — Implementation plans

## Agent Files

| Location | Purpose |
|----------|---------|
| `~/.claude/agents/config/` | Shared manifests (models, MCPs, tools) |
| `~/.claude/agents/executive/` | CEO, CIO, COO |
| `~/.claude/agents/engineering/` | Architect, devs, reviewer, auditor |
| `~/.claude/agents/devops/` | DevOps |
| `~/.claude/hooks/agent-context-inject.js` | SessionStart context injection hook |
| `~/.gemini/agents/` | Gemini CLI equivalents |

## Adding a New MCP

1. Edit `~/.claude/agents/config/mcps.yml`
2. Add server config to `~/.claude/settings.json`
3. All agents pick it up next session

## Adding a New Agent

1. Create `~/.claude/agents/<group>/<role>.md`
2. Add to CEO delegation list
3. Create Gemini equivalent at `~/.gemini/agents/<group>/<role>.md`
