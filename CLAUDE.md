# AgentSystem

## Agent Management
- Edit: `.agents/agents/<name>.md`
- Sync to all CLIs: `node tools/sync-agents.js` (all platforms)
- Verify: check `.agents/sync.log` for ERROR lines

## Memory
Root: `~/agent-memory/nexus/` — shared across Claude, Antigravity

Onboard a repo (CLAUDE.md block + graph brain + registry): `node tools/bootstrap-repo.js [repoPath]`
Onboard every git repo under a dir (also creates the global brains): `node tools/bootstrap-repo.js --all ~/dev`
Cross-platform (Node.js, builtins only); idempotent. The per-repo `nexus/` brain is gitignored.

## Routines Engine

Agent routines are defined in `config/routines.yml` and enforced hard by default. To add a new routine: add a YAML entry with `id`, `description`, `trigger`, `mechanism` (`agent-rule`|`hook`|`cron`), `enforce: hard`, `enabled: true`, and `action`. Then run `node tools/routines.js compile` to regenerate `.agents/rules/routines.generated.md`. To bypass a routine without editing the registry: `node tools/routines.js bypass <id>`. See `docs/memory-and-routing-redesign.md` → "Routines engine" section.

## Path-Scoped Rules

These rules only activate when touching matching files (Claude Code `paths:` feature):

- **Database / schema files** (`*.sql`, `prisma/**`, `*.prisma`):
  Pym domain. Run migrations in dev first. Never `prisma migrate deploy` without approval.

- **Agent definitions** (`.agents/**`):
Edit `.agents/agents/<name>.md`, then run `node tools/sync-agents.js` to sync to all CLIs.

- **CI/CD workflows** (`.github/workflows/**`):
  Test on feature branch before merging. Self-hosted runner required for agent-dispatch.yml.
  **Single point of failure (see #115):** `agent-dispatch.yml`, `sam-audit.yml`, and sync-verification
  workflows all pin `runs-on: self-hosted`. If that runner is offline, dispatched `/agent`, `/merge`,
  `/close` comments and label triggers silently no-op — no PR comment, no failure signal, nothing
  queues or retries. `.github/workflows/runner-health-check.yml` runs on a schedule and opens/updates
  a tracking issue labeled `runner:down` if the self-hosted runner has no recent job; check that issue
  (or `gh api repos/:owner/:repo/actions/runners`) if a dispatched command appears to hang.

- **Memory tools** (`tools/**`):
  No npm deps. Pure Node.js builtins + graph-lib.js imports only.

- **Test files** (`tests/**`, `**/*.test.js`):
  Run `node --test <file>` before committing. All tests must pass on dev before PR to main.

<!-- AGENT-SYSTEM-BOOTSTRAP: do not remove this block -->
## Agent System Context (auto-injected by bootstrap-repo.ps1)

- Agent routing: see `~/.claude/CLAUDE.md`
- Agent brain: `~/agent-memory/nexus/agent-brain/`
- Repo brain: `nexus/agentsystem/` (run `node tools/graph/graph-init.js agentsystem .` to refresh)
- Query graph: `node tools/graph/graph-query.js agentsystem <keywords>`
- Update weights: `node tools/graph/graph-weight.js visit agentsystem <source> <target>`
- Known repos: `~/agent-memory/nexus/known-repos.json`
- Shared memory: `~/agent-memory/nexus/` — same path for Claude, Gemini, Copilot
<!-- END AGENT-SYSTEM-BOOTSTRAP -->
