# Agent System Handoff

**Last Updated:** 2026-05-25
**Status:** Dual-brain graph + universal bootstrap + remote control complete on `feat+dual-brain-graph-universal-control`. 51/51 tests passing. Pending: runner setup (one-time, requires elevation) + Sam audit + PR merge.

---

## Checkpoint: Dual-Brain Graph + Universal Control (2026-05-25)

**Branch:** `feat+dual-brain-graph-universal-control`
**Commits:** `2f91480` → `edb1f98` (20 commits)
**Test coverage:** 51 tests, 0 failures

### What shipped

**Sub-project 1 — Dual-Brain Graph Library** (`tools/graph/`)

| File | Purpose |
|------|---------|
| `graph-lib.js` | Core: `addEdge`, `updateVisitCount`, `updateConfidence`, `pruneOrphanedEdges`, `recomputeComposite`. Zero npm deps (built-ins only). ES modules. |
| `graph-init.js` | Populates repo brain from `git log` + AST import scan. Creates commit/hotfile/file/arch nodes + co-change/semantic edges. |
| `graph-query.js` | CLI: keyword search + composite ranking. `--json`, `--top=N`, `--brain-path` flags. |
| `graph-weight.js` | CLI: `visit`, `confidence`, `deprecate` commands. Validates edge exists before mutating. |
| `agent-brain-init.js` | Seeds 11 agent identity nodes in `~/.claude/agent-memory/nexus/agent-brain/`. Idempotent. |
| `known-repos.js` | Global repo registry: `readRegistry`, `writeRegistry`, `upsertRepo`, `findRepo`. |

**Edge weight formula:** `composite = co_change×0.20 + semantic×0.20 + visit_count×0.30 + confidence×0.30`

Agent brain at `~/.claude/agent-memory/nexus/agent-brain/` — user-global, never decays.
Repo brain at `nexus/<slug>/` — project-local, gitignored, regenerated from git/AST.

**Sub-project 2 — Universal Bootstrap** (`tools/`)

| File | Purpose |
|------|---------|
| `bootstrap-repo.ps1` | Idempotent one-shot: detect project type → install deps → inject CLAUDE.md block → run graph-init → register in known-repos.json → verify CLIs. |
| `claude-md-block.txt` | Template with `{{SLUG}}` placeholder injected into any repo's CLAUDE.md. |

AgentSystem self-bootstrapped: 93 nodes, 6 edges, registry entry at `~/.claude/agent-memory/nexus/known-repos.json`.

**Sub-project 3 — Remote Control**

| File | Purpose |
|------|---------|
| `tools/create-agent-labels.ps1` | Created 11 `agent:*` labels in GitHub (jarvis, friday, sam, ultron, pym, leo, nat, wanda, astra, threepio, r2d2). |
| `.github/workflows/agent-dispatch.yml` | Self-hosted runner: `agent:*` label → parse → ack comment → `claude -p "$task"` → result comment → remove label. |
| `.github/ISSUE_TEMPLATE/agent-task.md` | Phone-friendly issue template. |
| `tools/setup-runner.ps1` | One-time self-hosted runner setup as Windows service (requires elevation). |

**Phone workflow (after runner setup):**
```
GitHub mobile → New Issue → "Agent Task" template → Add label: agent:friday
→ Runner picks up → claude -p runs → result posted as comment → push notification
```

### One-time actions still needed

1. **Install self-hosted runner** (requires PowerShell as Administrator):
   ```powershell
   powershell -File tools/setup-runner.ps1
   ```
   Verify: `gh api repos/:owner/:repo/actions/runners --jq '.runners[] | {name, status}'`

2. **Sam audit + PR merge** — per hard gate rule, Sam must review before merge to main.

3. **Sync agents** after merge:
   ```powershell
   powershell -File sync_agents_from_repo.ps1
   ```

### Key graph CLI commands (post-bootstrap)

```bash
# Query repo brain
node tools/graph/graph-query.js agentsystem auth retry

# Record agent visit (strengthens edge)
node tools/graph/graph-weight.js visit agentsystem file-auth.js file-middleware.js

# Record outcome (positive = +0.1 confidence, negative = -0.15)
node tools/graph/graph-weight.js confidence agentsystem pattern-auth-retry outcome-1071 0.1

# Refresh repo brain after major commits
node tools/graph/graph-init.js agentsystem .

# Bootstrap a new repo
powershell -File tools/bootstrap-repo.ps1 -RepoPath C:\path\to\repo -Slug myrepo
```

---

## Current State

- Canonical agent definitions live in `.agents/agents/`.
- `sync_agents_from_repo.ps1` generates the user-level Claude, Copilot, Gemini, and Antigravity files.
- `README.md`, `CLAUDE.md`, and `AGENTS.md` are the active repo docs.
- Repo-level CLI agent folders are no longer authoritative.
- Backup copy: `repo-agent-backup-20260521-044914/`.

## Blocked Work

Use this section to track work that is blocked waiting on another agent or external dependency.
Jarvis monitors this section on startup (step 3 of startup checklist).

Format:
```
- **[DATE] [Blocking Agent] waiting on [Blocked-by Agent/System]:** [What is blocked] — [What is needed to unblock]
```

Current blockers:

_(none)_

## In-Flight Work

Work that is started but not yet complete. Link to GitHub issues.

- **PR #29** — memory files + production readiness. Sam audit in progress. After merge: `git tag v1.0-production-ready && git push origin v1.0-production-ready`

## Startup

Read these first:
1. `CLAUDE.md` (default agent, bypass, post-sync checklist)
2. `docs/HANDOFF.md` (this file — blockers and in-flight)
3. `AGENTS.md` (routing rules, domain ownership, coordination rules)
4. `.agents/memory/<agent>.md` (agent-specific decision log and session notes)
5. `.agents/AGENTS-MEMORY.md` (index of all agents' recent decisions)

## Architecture

- [AGENT-DEPENDENCY-MAP.md](AGENT-DEPENDENCY-MAP.md) — agent call chains, failure cascades, retry behavior
- [AGENT-INVOCATION-GUIDE.md](AGENT-INVOCATION-GUIDE.md) — how to invoke each agent per CLI

## Escalation & Incidents

- [ESCALATION-CONVENTIONS.md](ESCALATION-CONVENTIONS.md) — escalation matrix, SLAs, @-mention conventions
- [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) — runbooks for agent timeout, sync failure, security gate, CI/CD

## Performance & Reviews

- [METRICS-DASHBOARD.md](METRICS-DASHBOARD.md) — KPIs, weekly report template, baseline
- [REVIEW-CADENCE.md](REVIEW-CADENCE.md) — weekly/monthly/quarterly review schedule
- [QUARTERLY-REVIEW.md](QUARTERLY-REVIEW.md) — quarterly deep review procedure and checklist

## Next Quarterly Review

**Scheduled:** 2026-07-01 (Q3, first week)

## Working Rules

- Edit master agents in `.agents/agents/` only.
- Run `powershell -File .\sync_agents_from_repo.ps1` after agent changes.
- Treat `docs/HANDOFF.md` as the current-state log for in-flight work and blockers.
- Keep docs concise and aligned with the sync script behavior.

## Notes

- Claude output uses YAML frontmatter plus body.
- Copilot output uses YAML frontmatter plus body.
- Gemini output uses YAML frontmatter with slugged names.
- The inject scripts were legacy context helpers and are not part of the current sync flow.
