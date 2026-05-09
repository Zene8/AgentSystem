# Agentic System Design
**Date:** 2026-05-09  
**Status:** Approved  
**Approach:** Layered Config System (Option B)

---

## Overview

Global, CLI-agnostic multi-agent system. Agents live in `~/.claude/agents/`. Shared config manifests (`models.yml`, `mcps.yml`, `tools.yml`) decouple capabilities from roles — add an MCP once, all agents get it. A `SessionStart` hook injects the active project's context automatically. Gemini and Copilot receive equivalent agent files via COO sync.

---

## Directory Structure

```
~/.claude/
├── agents/
│   ├── config/
│   │   ├── models.yml              # model + effort per agent role
│   │   ├── tools.yml               # available CLI/bash tools
│   │   └── mcps.yml                # MCP server declarations
│   ├── executive/
│   │   ├── ceo.md                  # Opus — orchestrator, intake, delegates, supervises
│   │   ├── cio.md                  # Sonnet — brainstorming, GitHub issue creation
│   │   └── coo.md                  # Haiku — docs, Notion, LinkedIn, Drive, agent sync
│   ├── engineering/
│   │   ├── architect.md            # Sonnet — task brief → spec MD files
│   │   ├── tdd-test-writer.md      # Sonnet — failing tests before implementation
│   │   ├── backend-dev.md          # Sonnet — backend implementation
│   │   ├── frontend-dev.md         # Sonnet — frontend implementation
│   │   ├── database-dev.md         # Sonnet — schema/migrations (PAUSE gate)
│   │   ├── code-reviewer.md        # Sonnet — diffs, inline review comments
│   │   └── security-auditor.md     # Sonnet — audit, build check, best practices
│   ├── devops/
│   │   └── devops.md               # Sonnet — CI/CD, deployments (PAUSE gate)
│   └── shared/
│       └── context-preamble.md     # injected by hook at session start
├── hooks/
│   ├── caveman-activate.js         # existing
│   ├── caveman-mode-tracker.js     # existing
│   └── agent-context-inject.js     # NEW — project context + config injection
└── settings.json                   # hook registration + MCP server declarations
```

**Gemini equivalent:** `~/.gemini/agents/` — same role files, adapted syntax, no subagent dispatch.  
**Copilot:** `.github/copilot-instructions.md` per repo — condensed engineer role, COO-managed.

---

## Agent Pipeline & Data Flow

```
You
 │
 ├─ prompt goal / task  OR  CEO pulls GitHub issues + Notion/Drive
 │
 ▼
CEO (Opus)
 ├─ synthesizes backlog → prioritized task list
 ├─ writes task briefs → docs/agents/tasks/YYYY-MM-DD-<slug>.md
 │
 ├─▶ CIO (Sonnet) ← async, independent
 │     brainstorms new approaches → creates GitHub issues
 │
 ├─▶ ARCHITECT (Sonnet)
 │     reads task brief → writes spec MD → CEO reviews
 │
 ├─▶ TDD-TEST-WRITER (Sonnet)
 │     reads spec → writes failing tests (behavior + security)
 │
 ├─▶ BACKEND-DEV / FRONTEND-DEV / DATABASE-DEV (Sonnet)
 │     reads spec + tests → implements → all tests must pass
 │     DATABASE-DEV: ⏸ PAUSE — user approval required
 │
 ├─▶ CODE-REVIEWER (Sonnet)
 │     diffs changes → inline comments → flags blockers
 │
 ├─▶ SECURITY-AUDITOR (Sonnet)
 │     audits impl → build check → best practices
 │     on fail: loops back to relevant dev agent
 │
 ├─▶ DEVOPS (Sonnet)
 │     prepares deploy artifacts + CI/CD config
 │     ⏸ PAUSE — user approval before any prod touch
 │
 └─▶ CEO commits + pushes + merges
       ⏸ PAUSE — user approval before push to main

COO (Haiku) ← async, on-demand
  updates Notion, Google Drive, LinkedIn, docs
  syncs agent files to ~/.gemini/agents/ and project .github/copilot-instructions.md
```

**Stateless handoffs:** agents read MD files, not conversation history.  
**Loop on failure:** failed tests or audit → agent retries internally, escalates to CEO only if stuck.  
**State tracking:** CEO updates GitHub issue comments (open = in progress, closed = done).

---

## Approval Gates

| Trigger | Gate |
|---------|------|
| Push to main / merge PR | ⏸ User approval |
| DB schema migration | ⏸ User approval |
| Infra / cloud changes | ⏸ User approval |
| All other operations | Autonomous |

---

## Dynamic Context Injection

`agent-context-inject.js` fires on `SessionStart`:

1. Detects `cwd` → finds nearest `CLAUDE.md`, `GEMINI.md`, or `AGENT_INSTRUCTIONS.md`
2. Reads `config/models.yml` + `config/mcps.yml` + `config/tools.yml`
3. Prepends unified preamble to system prompt:

```
=== ACTIVE PROJECT CONTEXT ===
[CLAUDE.md contents]

=== AVAILABLE MODELS ===
[models.yml]

=== AVAILABLE MCPS ===
[mcps.yml]

=== AVAILABLE TOOLS ===
[tools.yml]
```

**To add new MCP:** edit `~/.claude/agents/config/mcps.yml` + `~/.claude/settings.json`. All agents pick it up next session.  
**Project overrides:** `.claude/agents/overrides/<agent>.md` — hook merges on top of global agent.

---

## Config Manifests

### `config/models.yml`
```yaml
agents:
  ceo:             { model: claude-opus-4-7,   effort: high }
  cio:             { model: claude-sonnet-4-6, effort: high }
  architect:       { model: claude-sonnet-4-6, effort: high }
  tdd-test-writer: { model: claude-sonnet-4-6, effort: normal }
  backend-dev:     { model: claude-sonnet-4-6, effort: normal }
  frontend-dev:    { model: claude-sonnet-4-6, effort: normal }
  database-dev:    { model: claude-sonnet-4-6, effort: normal }
  code-reviewer:   { model: claude-sonnet-4-6, effort: normal }
  security-auditor:{ model: claude-sonnet-4-6, effort: high }
  devops:          { model: claude-sonnet-4-6, effort: high }
  coo:             { model: claude-haiku-4-5,  effort: normal }
gemini_equivalents:
  ceo:     gemini-2.5-pro
  default: gemini-2.5-flash
```

### `config/mcps.yml`
```yaml
# Edit here to add new MCPs — propagates to all agents on next session
servers:
  - name: gmail
  - name: google-calendar
  - name: google-drive
  - name: github
  - name: playwright
  - name: notion       # add server config when connected
  - name: linear       # add server config when connected
```

### `config/tools.yml`
```yaml
cli:
  - claude    # Claude Code CLI
  - gemini    # Gemini CLI
  - gh        # GitHub CLI
  - git
  - npm
  - npx
  - az        # Azure CLI
  - wrangler  # Cloudflare
bash:
  - allowed: true
  - escalate_destructive: true  # pause before rm -rf, force-push, etc.
```

---

## Agent Prompt Skeleton

Every agent file follows this structure — concise, no fluff:

```markdown
# <ROLE NAME> — <one-line purpose>
Model: <from models.yml> | Effort: <high|normal>

## Role
One paragraph. What this agent owns. Nothing else.

## Inputs
What it reads (task brief path, spec path, test results, etc.)

## Outputs
What it produces (spec MD, test files, implementation, audit report)

## Behavior
Numbered steps. Precise. No ambiguity.

## Constraints
Hard rules. Approval gates. What it never does alone.
```

---

## CEO Session Start Behavior

```
1. Read active project CLAUDE.md / GEMINI.md for stack context
2. Query GitHub: open issues, assigned milestones, recent PRs
3. Check Notion/Google Drive if linked (via MCP)
4. Synthesize → ordered task list (priority: blocked > P0 > P1 > P2)
5. For each task: write docs/agents/tasks/YYYY-MM-DD-<slug>.md
6. Dispatch agents per pipeline
7. Report status to user before first dispatch
```

---

## Gemini & Copilot Parity

| Feature | Claude | Gemini | Copilot |
|---------|--------|--------|---------|
| Global agents | `~/.claude/agents/` | `~/.gemini/agents/` | ❌ (workspace only) |
| Context injection | Hook (SessionStart) | `GEMINI.md` auto-load | `copilot-instructions.md` |
| Subagent dispatch | Native Agent tool | Manual session spawn | ❌ |
| MCP support | Full | Partial | Limited |
| Sync owner | — | COO agent | COO agent (per-repo PR) |

---

## Future Extensibility

- **New MCP:** add to `mcps.yml` + `settings.json`. Done.
- **New agent role:** create `~/.claude/agents/<group>/<role>.md`. Reference in CEO delegation list.
- **New project:** create project `CLAUDE.md`. Hook injects it automatically. No agent edits needed.
- **New CLI:** add to `tools.yml`. COO propagates to Gemini/Copilot configs.
