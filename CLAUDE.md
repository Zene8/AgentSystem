# Claude Code — Usage & Memory

This file explains Claude-specific conventions and where to find authoritative agent definitions and memory.

## Default Agent

```yaml
default_agent: jarvis
```

Jarvis is the default entry point for all sessions. If no agent is specified, Jarvis loads automatically.
To bypass: use `--agent=<name>` on the CLI, or say "Be <AgentName>:" at the start of your message.
See AGENTS.md for full bypass documentation and routing rules.

Where to edit agents
- Master agent definitions: `.agents/agents/*.md` (commit changes here)
- Agent memory and session logs: `.agents/agents-memory/` and `agents-memory/`

Sync process
- Run `sync_agents_from_repo.ps1` from the repo root to push the canonical definitions into user CLI config folders (`%USERPROFILE%\.claude`, `%USERPROFILE%\.copilot`, `%USERPROFILE%\.gemini`). The script also converts formats (markdown → JSON) for non-Claude CLIs.

Claude-specific notes
- Claude agent files produced by the sync have YAML frontmatter followed by the agent's behavior/instructions in the body.
- Memory path used by agents: `%USERPROFILE%\.claude\agents-memory\` for runtime session persistence.
- Current handoff: [docs/HANDOFF.md](docs/HANDOFF.md)

Validation and troubleshooting
- If an agent fails to load, check for:
  - Missing YAML frontmatter `---` block
  - `name:` in frontmatter being a non-empty slug (lowercase, hyphens)
  - Body present after the frontmatter (agent behavior)

Developer checklist
1. Edit `.agents/agents/<agent>.md` (use existing master format)
2. Run `powershell -File sync_agents_from_repo.ps1`
3. Verify `%USERPROFILE%\.claude\agents\<agent>.md` loads in your Claude CLI

Post-sync verification
- Verify default agent loads: start `claude` with no flags — Jarvis should greet you
- Verify named agent loads: `claude @friday` should load Friday (CTO)
- Verify sync log: check `.agents/sync.log` for any ERROR lines
- Verify memory files exist: `.agents/memory/<agent>.md` for each agent in roster

Bypass pattern
- Invoke directly: `claude @ultron` or say "Be Ultron:" in conversation
- When to bypass: specific well-scoped task, known agent, no cross-domain coordination needed
- When NOT to bypass: ambiguous task, spans multiple domains, needs prioritization against current goals
- See AGENTS.md "Bypassing Jarvis" section for full guidance

Contact / Escalation
- For sync script or model mapping issues, raise an issue and tag `friday` and `sam` for review.
- Full agent documentation: see AGENTS.md

## Shared Memory Root (cross-CLI)

All CLIs read/write the same memory at `~/agent-memory/nexus/`.
This is neutral — not CLI-specific. Claude, Gemini, and Copilot all use the same path.

Initialize: `node tools/personal-brain-init.js --name="Your Name" --email="you@example.com"`
Migrate existing data: `node tools/migrate-memory.js` (moves `~/.claude/agent-memory/` → `~/agent-memory/`)

| Memory type | Path |
|-------------|------|
| User brain | `~/agent-memory/nexus/personal-brain/user-brain.md` |
| Agent inboxes | `~/agent-memory/nexus/inbox/<AgentName>.md` |
| Agent brain | `~/agent-memory/nexus/agent-brain/` |
| SONA patterns | `~/agent-memory/nexus/sona-patterns.md` |
| Shared outcomes | `~/agent-memory/nexus/shared/` |
| Known repos | `~/agent-memory/nexus/known-repos.json` |

Override path: set `AGENT_MEMORY_ROOT` env var.

## Autonomous Mode ("do work")

Tell any agent "do work", "continue", or "keep going" and they will:
1. Read user brain: `~/agent-memory/nexus/personal-brain/user-brain.md`
2. Check open GitHub issues (`gh issue list --state=open`)
3. Pick highest priority by label (priority:high > priority:medium > unlabeled)
4. Execute the full issue workflow without further prompting

No confirmation needed for reversible actions.

## Standard Issue Workflow (all agents follow this)

Every task, from any entry point (Jarvis, Friday, direct agent), follows this pattern:

| Step | Command |
|------|---------|
| Check issues | `gh issue list --state=open` |
| Create (complex task) | `gh issue create` × 2 — Design + Implementation |
| Create (simple task) | `gh issue create` × 1 |
| Branch from dev | `git checkout dev && git checkout -b issue-{N}-{slug}` |
| Do work | Dispatch to workers |
| PR to dev | `gh pr create --base dev` |
| Merge | `gh pr merge {N} --squash --delete-branch` |
| Close | `gh issue close {N} --comment "Resolved in PR #{pr}"` |

## Hierarchical Swarms (Claude Code only)

Jarvis can spawn multiple Friday instances; Friday can spawn multiple workers.
Use `claude -p "<task>" --agent=<name>` for parallel execution.
Gemini/Copilot: same agent definitions, same memory, execute sequentially.

## Phone Workflow

GitHub mobile → New Issue → "Agent Task" template → Add label: `agent:friday`
Runner picks up → `claude -p "$task"` runs → result posted as comment → push notification

## SONA Patterns

All agents log patterns to `~/agent-memory/nexus/sona-patterns.md` after significant work.
Format: S (situation) → O (observation) → N (nodes) → A (action taken) + success flag.
Agents read this file to avoid repeating past mistakes and reuse winning approaches.

<!-- AGENT-SYSTEM-BOOTSTRAP: do not remove this block -->
## Agent System Context (auto-injected by bootstrap-repo.ps1)

- Agent routing: see `~/.claude/CLAUDE.md`
- Agent brain: `~/agent-memory/nexus/agent-brain/`
- Repo brain: `nexus/agentsystem/` (run `node tools/graph/graph-init.js agentsystem .` to refresh)
- Query graph: `node tools/graph/graph-query.js agentsystem <keywords>`
- Update weights: `node tools/graph/graph-weight.js visit agentsystem <source> <target>`
- Known repos: `~/agent-memory/nexus/known-repos.json`
<!-- END AGENT-SYSTEM-BOOTSTRAP -->
