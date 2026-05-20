# Claude Code Configuration

## Project Overview
Nathan's Unified AI Agent System is a distributed multi-CLI orchestration framework that synchronizes agent definitions, roles, and memory across Claude Code, Gemini CLI, and Copilot CLI. The system implements a 10-point engineering discipline and 4-D methodology (Deconstruct → Diagnose → Develop → Deliver) for autonomous agent collaboration. Agents operate within clear decision authority boundaries, escalate conflicts via GitHub, and maintain a shared knowledge base for real-time visibility across all active work.

## Tech Stack
- **Language(s):** JavaScript/TypeScript (Node.js), PowerShell (sync automation), Markdown (documentation)
- **Framework(s):** Claude Code CLI, Gemini CLI, Copilot CLI (multi-platform agent orchestration)
- **Key Libraries:** GitHub API (for issue tracking and sync), MCP (Model Context Protocol for agent integration)
- **Deployment:** Git-based source of truth with CLI config sync via PowerShell (`sync_agents_from_repo.ps1`)

## Architecture Highlights
The system is organized as a **distributed multi-agent framework** where:
- **Single source of truth:** `.agents/` directory in root repo (git-versioned) contains shared agent definitions, workflows, and rules
- **CLI sync layers:** Each CLI (Claude Code, Gemini, Copilot) maintains its own config directory (`.claude/`, `.gemini/`, `.copilot/`) that mirrors definitions from `.agents/`
- **Agent autonomy:** 10 agents operate across executive, engineering, and business domains with clear decision authority levels (Autonomous, Domain, Hard Gate)
- **Memory system:** `.agents/memory/` tracks quarterly reviews, decision logs, and engineering learnings
- **Escalation pattern:** Conflicts resolved via @-mentions, GitHub Discussions, and intent-based leadership (Marquet/Willink/Babin framework)

## Running Locally
```bash
# Clone and setup
git clone https://github.com/nathan/agent-system.git
cd agent-system

# Sync agents to Claude Code (run from project root)
powershell -File sync_agents_from_repo.ps1

# View agent roster
cat AGENTS.md

# Check shared engineering standards
cat .agents/rules/ENGINEERING-STANDARDS.md
```

## Key Commands
- `sync_agents_from_repo.ps1` — Sync agent definitions from repo to all CLI configs
- `git add .agents/` — Stage shared agent definitions
- `git log --oneline` — View agent/system updates
- Review: `AGENTS.md` (roster + authority), `AGENTS-MEMORY.md` (decisions + learnings)

## Hooks
```yaml
hooks:
  after_edit:
    - run: powershell -File sync_agents_from_repo.ps1
      fail_mode: warn
      description: Auto-sync agent definitions to all CLI configs
```

## Testing Strategy
- **Unit tests:** Agent definition validation (verify all required fields, no role conflicts)
- **Integration tests:** CLI config sync consistency (claude/.agents matches repo/.agents)
- **Manual testing:** Invoke each agent via CLI trigger and verify correct startup behavior
- **Quarterly reviews:** Security, engineering, business discipline audits per AGENTS.md

## Code Style
See `.agents/rules/ENGINEERING-STANDARDS.md` for shared standards across all agents:
- Type hints in TypeScript/JavaScript
- Pydantic validation at I/O boundaries
- GitHub issues in real-time with agent + product labels
- Session Log entries for each PR shipped
- No long-lived stacked PRs (merge to main ASAP)
- 3-Nines discipline (99.9% uptime) for services

## Git Workflow
1. Create branch: `git checkout -b feature/agent-name-improvement`
2. Edit agent definitions in `.agents/agents/` or memory in `.agents/memory/`
3. Commit: `git commit -m "feat(agents): [description] - synced via $CLI"`
4. Sync: `powershell -File sync_agents_from_repo.ps1`
5. Push: `git push origin feature/agent-name-improvement`
6. Create PR, request code review from Friday (CTO) and Sam (CSO)
7. **Hard gate:** Sam (CSO) must approve all main merges (security audit required)

## When to Ask for Help
- Multi-agent workflow changes affecting >2 agents
- Decision authority clarifications (jurisdiction disputes)
- Agent autonomy policy changes
- Security/compliance implications (escalate to Sam)
- Cross-CLI sync issues (coordinate with sync automation)
- Memory system updates (quarterly reviews, decision logs)
