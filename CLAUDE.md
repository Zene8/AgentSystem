# AgentSystem

## Agent Management
- Edit: `.agents/agents/<name>.md`
- Sync to all CLIs: `powershell -File sync_agents_from_repo.ps1`
- Verify: check `.agents/sync.log` for ERROR lines

## Memory
Root: `~/agent-memory/nexus/` — shared across Claude, Gemini, Copilot

## Path-Scoped Rules

These rules only activate when touching matching files (Claude Code `paths:` feature):

- **Database / schema files** (`*.sql`, `prisma/**`, `*.prisma`):
  Pym domain. Run migrations in dev first. Never `prisma migrate deploy` without approval.

- **Agent definitions** (`.agents/**`):
  Edit `.agents/agents/<name>.md`, then run `powershell -File sync_agents_from_repo.ps1` to sync to all CLIs.

- **CI/CD workflows** (`.github/workflows/**`):
  Test on feature branch before merging. Self-hosted runner required for agent-dispatch.yml.

- **Memory tools** (`tools/**`):
  No npm deps. Pure Node.js builtins + graph-lib.js imports only.

- **Test files** (`tests/**`, `**/*.test.js`):
  Run `node --test <file>` before committing. All tests must pass on dev before PR to main.
