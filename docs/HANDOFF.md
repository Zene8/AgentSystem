# Agent System Handoff

**Last Updated:** 2026-06-30
**Status:** main consolidated. PRs #89 (mission-control docs) + #90 (session rename + memory onboarding) merged to main; both feature branches deleted. No stashes. Sam pre-merge gate PASS. Follow-up #92 filed.

---

## Checkpoint: Branch Unification + main Consolidation (2026-06-30)

**Actor:** r2d2 (dispatched by Nathan)

**What happened:**
- Merged both open feature branches into `main` (local `--no-ff`), pushed `7c54439..c4f6717`.
  - `issue-rename-memory-onboard` → PR #90 (auto-closed on merge): `+671` lines — `tools/memory-onboard.js` (new), `tools/session-namer.js` `--rename`, `/rename-session` + `/onboard-memory` command stubs, 2 test files.
  - `issue-82-mission-control-docs` → PR #89 (auto-closed on merge): `+624` lines — `docs/mission-control.md` + HANDOFF/invocation-guide edits.
- Deleted both branches local + origin after `git branch --merged main` confirmation.
- **Stashes:** none existed — nothing deleted.

**Gate:** Sam hard-gate pre-merge audit = **PASS** (10/10 checklist clear; no shell injection — `execFileSync` array form; no secrets/PHI; no npm-dep violations). One non-blocker: theoretical read-only `../` path-traversal in `resolveTranscript()` — gated by user-owned registry. Tests 17/17 pass. First audit process died mid-run; re-run completed clean.

**Follow-up filed:** [Issue #92](https://github.com/Zene8/AgentSystem/issues/92) — add explicit `path.resolve()` bounds check in `resolveTranscript()` to enforce the invariant against future refactors.

**Issues:** No issue cleanly completed. Epic #82 stays open (7 children live: #83–#88, #91). Progress comment posted on #82.

---

## Checkpoint: Branch Cleanup + Token Efficiency (2026-05-27)

**PRs merged:** #55 (personal brain, issue workflow, swarms, install.ps1, model tiers, Sam CI gate) → dev

**Branches deleted:** `worktree-feat+personal-brain-issue-workflow-swarms`, `worktree-agent-af8d503bcf50159ef` (identical to dev), `feat/dual-brain-graph-universal-control` (stale tracking ref pruned)

**Hook written:** `C:\Users\natha\.claude\hooks\tool-output-compress.js` — PostToolUse compress for outputs > 5000 chars. Pipe-tested, working.

**Pending manual action (auto-mode blocked direct settings edit):**
Apply two changes to `~/.claude/settings.json` — see [Issue #56](https://github.com/Zene8/AgentSystem/issues/56) for exact JSON.

**Repo audit:** `shanraisshan/claude-code-best-practice` — 4 actionable items filed as [Issue #57](https://github.com/Zene8/AgentSystem/issues/57) (effort overrides, path-scoped rules, per-agent hooks, isolation docs).

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

- **[2026-05-27] User waiting on self:** Apply settings.json changes from Issue #56 — auto mode hard gate blocked agent edit. 2-minute manual fix.
- **[2026-06-30] Leo/Ultron waiting on agy maintainer:** Resolve agy persistence model for Mission Control (Issue #85) — does `agy` support `--bg`, or must it be tmux-wrapped? Blocks implementation of Antigravity dispatcher.
- **[2026-06-30] All waiting on Jarvis:** Move webhook server code from `~/AgentSystem/tools/` (un-versioned) into main repo for git tracking (Issue #82 open question). Currently divergent from `/home/natha/dev/AgentSystem`.

## In-Flight Work

Work that is started but not yet complete. Link to GitHub issues.

- **[Issue #56](https://github.com/Zene8/AgentSystem/issues/56)** — apply `autoCompactEnabled` + PostToolUse compress hook to `~/.claude/settings.json`. Manual edit required. Hook script already at `~/.claude/hooks/tool-output-compress.js`.
- **[Issue #57](https://github.com/Zene8/AgentSystem/issues/57)** — implement effort overrides, path-scoped CLAUDE.md rules, per-agent hooks, isolation docs from shanraisshan audit.
- **[Issues #82–#88](https://github.com/Zene8/AgentSystem/milestone/3)** — Mission Control epic: Always-on remote session dispatch for Claude Code + Antigravity. Spec complete (docs/mission-control.md). Implementation in parallel: security audit (#83), versioning (#84), agy dispatcher (#85), repo picker (#86), frontend (#87), boot resilience (#88). **Two live risks noted:** (1) daemon service currently FAILED (status: check systemd logs); (2) webhook code in ~/AgentSystem/tools/ is un-versioned.

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
- [mission-control.md](mission-control.md) — Always-on remote session dispatch (Claude Code + Antigravity CLI). Architecture, HTTP API contract, harness dispatch matrix, security model, persistence/boot resilience. Maps to issues #82–#88.

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
