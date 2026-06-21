# AgentSystem

## Agent Management
- Edit: `.agents/agents/<name>.md`
- Sync to all CLIs: `powershell -File sync_agents_from_repo.ps1`
- Verify: check `.agents/sync.log` for ERROR lines

## Memory
Root: `~/agent-memory/nexus/` — shared across Claude, Antigravity

## Routines Engine

Agent routines are defined in `config/routines.yml` and enforced hard by default. To add a new routine: add a YAML entry with `id`, `description`, `trigger`, `mechanism` (`agent-rule`|`hook`|`cron`), `enforce: hard`, `enabled: true`, and `action`. Then run `node tools/routines.js compile` to regenerate `.agents/rules/routines.generated.md`. To bypass a routine without editing the registry: `node tools/routines.js bypass <id>`. See `docs/memory-and-routing-redesign.md` → "Routines engine" section.

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
