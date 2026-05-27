# AgentSystem — Installation Guide

Complete step-by-step setup for every supported CLI. Follow the section for your CLI(s).
All three CLIs share the same agents and memory — install once, use everywhere.

---

## Prerequisites (all CLIs)

| Tool | Install | Check |
|------|---------|-------|
| Node.js ≥ 20 | [nodejs.org](https://nodejs.org) | `node --version` |
| Git | [git-scm.com](https://git-scm.com) | `git --version` |
| GitHub CLI | [cli.github.com](https://cli.github.com) | `gh --version` |

Authenticate GitHub CLI:
```bash
gh auth login
```

---

## Step 1 — Clone the repo

```powershell
git clone https://github.com/Zene8/AgentSystem.git
cd AgentSystem
```

---

## Step 2 — First-time machine setup

Run once per machine. Idempotent — safe to re-run.

```powershell
.\install.ps1
```

This will:
- Check all prerequisites
- Initialize your personal brain at `~/agent-memory/nexus/personal-brain/user-brain.md`
- Sync all 11 agents to `~/.claude/agents/`, `~/.copilot/agents/`, `~/.gemini/agents/`
- Create GitHub labels in the current repo (`agent:friday`, `priority:high`, etc.)
- Print a summary with any warnings

Optional — also set up the self-hosted Actions runner (required for autonomous GitHub issue workflow):
```powershell
# Run PowerShell as Administrator
.\install.ps1 -Runner
```

---

## Step 3 — CLI-specific setup

### Claude Code

**Install:**
```bash
npm install -g @anthropic-ai/claude-code
```

**Use agents:**
```bash
claude @friday     # engineering (CTO)
claude @jarvis     # strategy / CEO
claude @nat        # business / CBO
claude @sam        # security audit
claude @ultron     # backend
claude @pym        # database
claude @leo        # DevOps / CI-CD
claude @astra      # frontend
claude @wanda      # design
claude @threepio   # docs / comms
claude @r2d2       # fallback / exploratory
```

**Install MCP server** (exposes agent tools natively — recommended):
```bash
npm install
claude mcp add agentsystem -- node /full/path/to/AgentSystem/tools/mcp-server.js
```

After MCP install, these tools are available in every Claude Code session:
- `agent_send_message` — message any agent inbox
- `agent_list_inbox` — read inbox
- `agent_archive_inbox` — archive inbox
- `graph_query` — query Bayesian graph memory
- `memory_read_brain` — read your personal brain
- `memory_read_agent` — read any agent's memory

**Verify:**
```bash
claude @friday
# Friday should greet you with inbox check and pending items
```

---

### Gemini CLI

**Install:**
```bash
npm install -g @google/generative-ai-cli
# or follow: https://github.com/google-gemini/gemini-cli
```

**Authenticate:**
```bash
gemini auth login
```

**Use agents:**

Agents are synced to `~/.gemini/agents/`. Gemini CLI loads them from there automatically.

```bash
gemini @friday     # engineering
gemini @jarvis     # strategy
gemini @nat        # business
```

Same agent roster and routing rules as Claude Code. Memory is shared — agents see the same `~/agent-memory/nexus/` graph.

Gemini executes agents **sequentially** (no parallel swarm spawning). Friday will dispatch workers one at a time rather than simultaneously.

**Verify:**
```bash
gemini @friday
# Should load Friday agent with correct model: gemini-3-flash-preview
```

---

### GitHub Copilot

**Install:**
- VS Code: install "GitHub Copilot" + "GitHub Copilot Chat" extensions
- CLI: `gh extension install github/gh-copilot`

**Authenticate:**
```bash
gh auth login   # already done in prerequisites
```

**Use agents:**

Agents are synced to `~/.copilot/agents/`. Copilot Chat loads them in VS Code.

In VS Code Copilot Chat panel:
```
@friday implement the auth endpoint
@jarvis what should we prioritize this week
@sam audit this PR
```

Or via CLI:
```bash
gh copilot suggest "@friday review PR #52"
```

Same agents, same memory, sequential execution.

**Verify:**
In VS Code → Copilot Chat → type `@friday` → should autocomplete with the agent.

---

## Step 4 — Bootstrap a repo

Run once per repo to add AgentSystem context (graph memory, CLAUDE.md block, known-repos registry).

```powershell
cd C:\path\to\your\repo
powershell -File C:\path\to\AgentSystem\tools\bootstrap-repo.ps1
```

Optional flags:
```powershell
# Specify slug and primary CLI
powershell -File tools\bootstrap-repo.ps1 -Slug "myapp" -PrimaryCli claude

# Skip graph-init if repo has no history yet
powershell -File tools\bootstrap-repo.ps1 -SkipGraphInit
```

What it does:
- Runs `graph-init` to build Bayesian graph of the repo
- Injects an agent-system block into `CLAUDE.md` (idempotent)
- Registers the repo in `~/agent-memory/nexus/known-repos.json`

---

## Step 5 — Self-hosted runner (for autonomous GitHub issue workflow)

Without this, the `agent-dispatch.yml` and `sam-audit.yml` CI workflows will queue but never run.

```powershell
# Run as Administrator
powershell -File tools\setup-runner.ps1
```

Or use `install.ps1 -Runner` (also requires admin).

After setup the runner registers as a Windows service and starts automatically on reboot.

**Verify runner is online:**
```bash
gh run list --limit 5
# Should show "completed" or "in_progress" runs, not "queued"
```

---

## Step 6 — Personal brain (optional but recommended)

Your personal brain stores preferences, goals, and context that all agents read at startup.

```bash
node tools/personal-brain-init.js --name="Your Name" --email="you@example.com"
```

File created at: `~/agent-memory/nexus/personal-brain/user-brain.md`

Edit this file to tell agents about:
- Your preferred communication style
- Current projects and priorities
- Tech stack preferences
- Things agents should always/never do

---

## Using the autonomous workflow (GitHub mobile → agent does work)

Once the runner is set up:

1. Open GitHub on your phone
2. Create a new issue
3. Add label: `agent:friday` (or any `agent:*` label)
4. Agent picks up the issue, executes full workflow (branch → code → PR → Sam audit)
5. When ready, agent posts a comment: "✅ Ready to merge — reply /merge to proceed"
6. Reply `/merge` → agent merges and closes the issue

Priority labels: `priority:high`, `priority:medium`, `priority:low`

---

## After editing agents

When you change any agent definition in `.agents/agents/`:

```powershell
powershell -File sync_agents_from_repo.ps1
```

Syncs to all 3 CLIs immediately.

---

## Verification checklist

```powershell
# Agents present (expect 11 each)
ls ~/.claude/agents/*.md | Measure-Object
ls ~/.copilot/agents/*.md | Measure-Object
ls ~/.gemini/agents/*.md | Measure-Object

# Memory exists
ls ~/agent-memory/nexus/

# Personal brain
cat ~/agent-memory/nexus/personal-brain/user-brain.md

# Config synced
ls ~/.claude/agents/config/

# MCP server (should start and print nothing — Ctrl+C to exit)
node tools/mcp-server.js

# Run tests
npm test
```

---

## Troubleshooting

**Agent not found in CLI**
→ Re-run `sync_agents_from_repo.ps1` from the AgentSystem repo root.

**MCP tools not available in Claude Code**
→ Check `claude mcp list` — agentsystem should appear.
→ Re-add: `claude mcp add agentsystem -- node /path/to/AgentSystem/tools/mcp-server.js`

**CI workflows queue but never run**
→ Self-hosted runner not set up. Run `install.ps1 -Runner` as Administrator.

**`/merge` comment not triggering merge**
→ Runner offline. Check: `gh run list` for queued runs.

**Graph query returns no results**
→ Graph not initialized for this repo. Run `bootstrap-repo.ps1` from the repo root.

**Personal brain not found**
→ Run `node tools/personal-brain-init.js --name="Your Name"`
