# Dual-Brain Graph + Universal Control — Design Spec

**Date:** 2026-05-25
**Status:** Approved
**Branch:** `worktree-feat+dual-brain-graph-universal-control`

---

## Overview

Three sub-projects, built in order:

| # | Sub-project | Depends on |
|---|-------------|------------|
| 1 | **Dual-Brain Graph** — repo brain + agent brain with weighted edges | nothing |
| 2 | **Universal Bootstrap** — any repo, any CLI, zero-friction setup | brain (to populate) |
| 3 | **Remote Control** — phone → agent dispatch via GitHub Actions + SSH | bootstrap |

---

## Sub-project 1: Dual-Brain Graph

### Architecture

Two completely separate graphs. Same file format, different roots, different lifetimes.

```
~/.claude/agent-memory/nexus/
└── agent-brain/
    ├── graph.json          ← edge structure + all weights
    ├── nodes/
    │   ├── pattern-*.md    ← reusable decision patterns
    │   ├── agent-*.md      ← per-agent identity nodes
    │   └── outcome-*.md    ← task outcome records
    └── INDEX.md

AgentSystem/nexus/<project-slug>/
├── graph.json              ← edge structure + all weights
├── nodes/
│   ├── file-*.md           ← AST-derived code nodes
│   ├── commit-*.md         ← git history nodes
│   ├── arch-*.md           ← architecture decision nodes
│   └── hotfile-*.md        ← high-churn file signals
└── INDEX.md
```

**Separation rationale:** Repo brain decays with the project. Agent brain compounds forever across all projects. Mixing them contaminates agent identity with stale repo context.

### Node Types

**Agent Brain:**

| Type | ID prefix | Content | Created when |
|------|-----------|---------|--------------|
| Decision pattern | `pattern-` | Reusable approach + success criteria | `/task-outcome` with positive result |
| Agent identity | `agent-` | Domain, authority, known biases | First agent session |
| Task outcome | `outcome-` | What was done, result, confidence delta | Every significant task |
| Cross-domain link | `xdomain-` | Agent collaboration touchpoints | Agents collaborate across domains |

**Repo Brain:**

| Type | ID prefix | Content | Created when |
|------|-----------|---------|--------------|
| Code file | `file-` | Module purpose, exports, deps | `graph-init` / AST scan |
| Commit | `commit-` | What changed, why, impact | `graph-init` / git log parse |
| Architecture decision | `arch-` | ADR-style, options considered | Manual or PR merge |
| Hot file | `hotfile-` | High-churn files (coupling signal) | `graph-init` / git log --stat |

### Edge Schema (`graph.json`)

```json
{
  "version": "1.0",
  "brain": "agent|repo",
  "project_slug": "agentsystem",
  "nodes": ["pattern-auth-retry", "agent-friday", "outcome-1071"],
  "edges": [
    {
      "source": "pattern-auth-retry",
      "target": "agent-friday",
      "weights": {
        "co_change": 0.0,
        "semantic": 0.74,
        "visit_count": 8,
        "confidence": 0.91
      },
      "composite": 0.82
    }
  ]
}
```

### Weight Dimensions

| Dimension | Range | Updated by | Meaning |
|-----------|-------|-----------|---------|
| `co_change` | 0.0–1.0 | `graph-init` only | Files/nodes that change together |
| `semantic` | 0.0–1.0 | `graph-init` only | Keyword overlap (no LLM calls) |
| `visit_count` | 0–N (normalized) | Every agent read/write | Access frequency |
| `confidence` | 0.0–1.0 | `/task-outcome` | Pattern led to good outcomes |
| `composite` | 0.0–1.0 | Recomputed on any weight change | Traversal score |

**Composite formula:**
```
composite = (co_change × 0.20) + (semantic × 0.20) + (normalized_visits × 0.30) + (confidence × 0.30)
```

Weights are tunable per brain type (repo brain may weight `co_change` higher; agent brain weights `confidence` higher).

### Weight Update Rules

```
co_change    → graph-init only (git log analysis, normalized per repo)
semantic     → graph-init only (TF-IDF keyword overlap between node content)
visit_count  → +1 on every agent node read or write; normalized to [0,1] across graph
confidence   → /task-outcome: success +0.1, failure -0.15, clamped [0.0, 1.0]
composite    → recomputed immediately after any weight change
```

No LLM calls for weight computation. Pure heuristics — fast, cheap, deterministic.

### Connection Creation Rules

- **Repo brain edges:** Created by `graph-init` script (git analysis + file import scan)
- **Agent brain edges:** Created by agents at write time — when writing `outcome-X`, agent declares which `pattern-Y` nodes it used; edges written directly to `graph.json`
- **Pending edges:** A wikilink `[[node-id]]` in a `.md` file with no corresponding `graph.json` entry = pending edge with weight 0.0 on all dimensions, created on first traversal

### Node File Format

```markdown
---
id: pattern-auth-retry
type: pattern
brain: agent
created: 2026-05-25
relevance_keywords: [auth, retry, resilience, token]
connections:
  - "[[agent-friday]]"
  - "[[outcome-1071]]"
---

# Pattern: Auth Retry with Backoff

Retry transient auth failures (5xx, network) with exponential backoff.
Never retry permanent failures (401, 403).

**Success criteria:** <50ms p99 on retry path, <1% user-facing auth errors.
**Confidence:** 0.91 (8 successful uses)
```

---

## Sub-project 2: Universal Bootstrap

### Script: `bootstrap-repo.ps1`

Run once per repo on any machine. Idempotent — safe to re-run.

**Steps:**
1. Clone repo (or detect existing checkout)
2. Detect project type (Node/Python/Go/Rust) → install deps
3. Inject CLAUDE.md context block (agent routing, memory paths, brain location)
4. Run `graph-init` → populate repo brain nodes + edges for this project
5. Agent brain already at `~/.claude/agent-memory/nexus/agent-brain/` — no copy needed
6. Verify CLIs present: `claude`, `gemini`, `copilot` — warn if missing, don't fail
7. Register repo in `~/.claude/agent-memory/nexus/known-repos.json`

### `known-repos.json`

Global registry — every repo the agent system knows about:

```json
{
  "version": "1.0",
  "repos": [
    {
      "slug": "agentsystem",
      "path": "C:/Users/natha/AgentSystem",
      "brain_path": "nexus/agentsystem/graph.json",
      "last_init": "2026-05-25",
      "primary_cli": "claude",
      "bootstrap_complete": true
    }
  ]
}
```

Any CLI on any machine reads this → instantly knows where all brains live → agent orients in any repo without manual setup.

### `graph-init` Script: `tools/graph-init.ps1`

Populates repo brain from scratch (or refreshes existing):

```
1. git log --stat → build commit nodes + co_change edge weights
2. Scan imports/requires in source files → build file nodes + semantic edges
3. git log --follow -- <file> → compute churn score → hotfile nodes
4. Read existing arch-*.md in docs/ → create arch nodes
5. Write all nodes to nexus/<slug>/nodes/
6. Write edge structure + weights to nexus/<slug>/graph.json
7. Update INDEX.md
```

---

## Sub-project 3: Remote Control

### Primary: Self-hosted GitHub Actions Runner

**Flow:**
```
Phone (GitHub mobile app)
  → Create issue: title = task, body = details
  → Add label: agent:friday (or agent:jarvis, agent:ultron, etc.)
  → GitHub Actions triggers self-hosted runner (Windows machine)
  → Runner: echo "$ISSUE_BODY" | claude --agent=$AGENT > result.txt
  → Runner posts result.txt as issue comment
  → Phone gets push notification
```

**Dispatch workflow** (`.github/workflows/agent-dispatch.yml`):

```yaml
name: Agent Dispatch
on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]

jobs:
  dispatch:
    runs-on: self-hosted
    if: |
      (github.event_name == 'issues' && startsWith(github.event.label.name, 'agent:')) ||
      (github.event_name == 'issue_comment' && startsWith(github.event.comment.body, '/agent '))
    steps:
      - name: Extract agent + task
        id: parse
        run: |
          if [ "${{ github.event_name }}" = "issues" ]; then
            AGENT="${{ github.event.label.name }}"
            AGENT="${AGENT#agent:}"
            TASK="${{ github.event.issue.body }}"
          else
            COMMENT="${{ github.event.comment.body }}"
            AGENT=$(echo "$COMMENT" | awk '{print $2}')
            TASK=$(echo "$COMMENT" | tail -n +2)
          fi
          echo "agent=$AGENT" >> $GITHUB_OUTPUT
          echo "$TASK" > /tmp/task.txt

      - name: Run agent
        run: |
          claude --agent=${{ steps.parse.outputs.agent }} < /tmp/task.txt > /tmp/result.txt 2>&1

      - name: Post result
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const result = fs.readFileSync('/tmp/result.txt', 'utf8');
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Agent Result\n\`\`\`\n${result}\n\`\`\``
            });
```

**Issue labels to create in repo:**
`agent:jarvis`, `agent:friday`, `agent:ultron`, `agent:sam`, `agent:pym`, `agent:leo`, `agent:nat`, `agent:wanda`, `agent:astra`, `agent:threepio`

### Secondary: SSH via Termius (Interactive)

- Install Termius on phone
- SSH profile → Windows machine
- Run `claude @friday` directly in terminal
- Full back-and-forth, no latency overhead
- Use for complex interactive sessions; GitHub Issues for fire-and-forget tasks

### Runner Setup (one-time)

```powershell
# On Windows machine — run once
# Download runner from GitHub repo Settings > Actions > Runners
# Configure with repo token
./config.cmd --url https://github.com/nathanjones/AgentSystem --token <TOKEN>
# Install as Windows service (always-on)
./svc.sh install
./svc.sh start
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `graph.json` missing | Bootstrap creates empty graph; nodes added on first init |
| Node `.md` file missing for an edge entry | Edge marked `orphaned: true`; pruned on next `graph-init` |
| `visit_count` overflow | Normalized to [0,1] on recompute — raw count stored separately |
| `confidence` hits 0.0 | Node flagged `deprecated: true`; excluded from traversal; retained for history |
| GitHub Actions runner offline | Issue sits labeled, no comment; runner picks up when machine wakes |
| CLI not found on runner | Workflow step fails with clear error posted as comment |

---

## Testing

- `graph-init` idempotency: run twice, same output
- Edge weight bounds: all dimensions clamped to declared ranges
- `visit_count` normalization: 1000 visits across 10 nodes → max normalized = 1.0
- `confidence` decay: 5 failures on `confidence=0.5` → reaches 0.0, node flagged
- `bootstrap-repo.ps1` idempotency: run twice, `known-repos.json` has one entry
- GitHub Actions dispatch: label → comment round-trip test with mock runner
- Orphaned edge pruning: delete a node `.md`, run graph-init, edge removed

---

## Open Questions (resolved)

- **Obsidian compatibility:** Mental model only. No plugin requirements.
- **LLM for semantic weights:** No. Keyword overlap only. Cost = $0.
- **Remote control infra:** Self-hosted runner (async) + Termius SSH (interactive). No always-on API server.
- **Brain storage location:** Agent brain at `~/.claude/agent-memory/nexus/agent-brain/` (user-global). Repo brain at `AgentSystem/nexus/<slug>/` (repo-local, gitignored for large graphs).
