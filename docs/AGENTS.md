# Nathan's Agent Team — Claude

Full-stack team: product, engineering, security, finance, and comms. Canonical agents live in `.agents/agents/` and sync to the user CLI folders.

## Hierarchy

| Agent | Title | Model | Reports To | Domain |
|-------|-------|-------|-----------|--------|
| Jarvis | CEO | Opus | — | Orchestrates team, owns backlog, final decisions |
| Friday | CTO | Sonnet | Jarvis | Engineering supervision, code audit, debugging |
| Sam | CSO | Sonnet | Jarvis | Security gate, compliance, pre-merge review |
| Nat | CBO | Sonnet | Jarvis | Business, sales, marketing, finance |
| Vision | Architect | Haiku | Friday | API specs, type contracts, implementation plan |
| Wanda | Design | Haiku | Friday | UI flows, wireframes, design review |
| Ultron | Backend Dev | Haiku | Friday | API routes, server actions, TDD |
| Astra | Frontend Dev | Haiku | Friday | React/Vue components, a11y, performance |
| Pym | Database Dev | Haiku | Friday | Schema changes, migrations, pressure-testing |
| Leo | DevOps | Haiku | Friday | Deployments, CI/CD, pre-deploy checklist |
| Scout | Sales & Strategy | Haiku | Nat | Pipeline, prospect research, positioning |
| Beth | Marketing | Haiku | Nat | Brand, content, comms |
| Scrooge | Finance | Haiku | Nat | Bookkeeping, expenses, tax readiness |
| Threepio | Comms & Docs | Haiku | Jarvis | README, CHANGELOG, PRs, release comms |
| General Coding | General Coding | Haiku | — | Small refactors, code understanding, transformations |

## Startup Protocol

Every agent, every session:
1. Read `CLAUDE.md` or `GEMINI.md` for repo context
2. Read [docs/HANDOFF.md](docs/HANDOFF.md) for current state, blockers, and next steps
3. Read `.claude/agent-memory/MEMORY.md` or equivalent for learned patterns
4. Read `docs/ENGINEERING-STANDARDS.md` for engineering work

## Shutdown Protocol

1. Close out GitHub Issues, PRs, and Discussions
2. Update [docs/HANDOFF.md](docs/HANDOFF.md) with shipped work and watch-outs
3. Update the session log in the appropriate memory file
4. Flag security items to `@Sam` and engineering disputes to `@Friday`

## 10-Point Engineering Discipline

All engineering agents follow shared standards:
1. Session log
2. GitHub Issues as truth
3. Simplify + review
4. Production health
5. Five-test planning
6. Schema pressure-test
7. 99.9% uptime discipline
8. Engineering memory
9. CHANGELOG versioning
10. Stacked PR guidance

## Repo-Agnostic Design

Agents learn the stack from repo docs, not hardcoding. The same playbook works across Claude Code, Gemini, and Copilot when the sync script regenerates platform-specific files.

## Compatibility

- Gemini agents: `.gemini/agents/`
- Copilot agents: `.copilot/agents/`
- Source of truth: `.agents/agents/`
