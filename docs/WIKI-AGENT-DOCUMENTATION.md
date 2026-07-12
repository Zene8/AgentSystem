# Nathan's AI Agent Team

Full-stack team: product, engineering, security, finance, business. Each agent reads `CLAUDE.md` (or `GEMINI.md`), `HANDOFF.md (repo root)`, and `.claude/agent-memory/MEMORY.md` at startup. Documentation and handoff written per GitHub Issue.

## Agent Hierarchy

| Agent | Title | Model | Reports To | Domain |
|-------|-------|-------|-----------|--------|
| **Jarvis** | CEO | Opus | — | Orchestrates team, owns backlog, final decisions |
| **Friday** | CTO | Sonnet | Jarvis | Engineering supervision, code audit, debugging |
| **Sam** | CSO | Sonnet | Jarvis | Security gate, HIPAA/GDPR, pre-merge review |
| **Nat** | CBO | Sonnet | Jarvis | Business team (sales, marketing, finance) |
| **Vision** | Architect | Haiku | Friday | API specs, type contracts, implementation plan |
| **Wanda** | Design | Haiku | Friday | UI flows, wireframes, design review |
| **Ultron** | Backend Dev | Haiku | Friday | API routes, server actions, TDD |
| **Astra** | Frontend Dev | Haiku | Friday | React/Vue components, Lighthouse 90+, a11y |
| **Pym** | Database Dev | Haiku | Friday | Schema changes, migrations, pressure-testing |
| **Leo** | DevOps | Haiku | Friday | Deployments, CI/CD, pre-deploy checklist |
| **Scout** | Sales & Strategy | Haiku | Nat | Pipeline, prospect research, positioning |
| **Beth** | Marketing | Haiku | Nat | Brand, content, comms |
| **Scrooge** | Finance | Haiku | Nat | Bookkeeping, expenses, tax readiness |
| **Threepio** | Comms & Docs | Haiku | Jarvis | README, CHANGELOG, PR descriptions, email |

## Workflow

```
Issue filed → Jarvis (routes) → Owner agent (reads CLAUDE.md, HANDOFF.md)
→ Work (per GitHub Issue) → Sam (security gate) → Merge
→ Update HANDOFF.md (repo root) + Session Log (per CLAUDE.md location)
```

## Startup Protocol

Every agent, every session:
1. Read `CLAUDE.md` or `GEMINI.md` — repo context, tech stack, boards, health checks
2. Read `HANDOFF.md (repo root)` — current state, in-flight work, blockers
3. Read `.claude/agent-memory/MEMORY.md` or equivalent — patterns, quirks, learnings
4. Read `docs/ENGINEERING-STANDARDS.md` (engineering agents only) — shared 10-point discipline

## Shutdown Protocol

1. GitHub current: Issues closed, PRs merged, Discussions updated
2. Update `HANDOFF.md (repo root)` — what shipped, next priorities, watch-outs
3. Update Session Log (per CLAUDE.md) — 2-3 sentences per shipped item
4. Cross-agent flags → GitHub mentions (@Sam for security, etc.)

## 10-Point Engineering Discipline (Friday-Led)

All engineering agents follow shared standards:
1. **Session Log** — Track work per session
2. **GitHub Issues as truth** — Open/comment/close in real-time
3. **Simplify + Review** — `/simplify` after chunks, `/review-pr` before merge
4. **Production health** — CLAUDE.md defines health checks
5. **5-test planning** — Cross-tenant, contract, branching, regression, edge cases
6. **Schema pressure-test** — Two-question test before Pym schema work
7. **3-nines discipline** — 99.9% uptime (43 min downtime/month)
8. **Engineering Memory** — Document quirks, patterns, recovery
9. **CHANGELOG versioning** — Update on release
10. **Stacked PR guidance** — Land to main ASAP

## Repo-Agnostic Design

Agents learn context from repo docs, not hardcoding:
- Tech stack: `CLAUDE.md` §Implementation
- Deployment: `CLAUDE.md` §Deployment
- Boards: `CLAUDE.md` (agent reads actual names)
- Health checks: `CLAUDE.md` §Production Health
- DB tooling: `CLAUDE.md` (Prisma/Alembic/manual)
- Design system: `CLAUDE.md` (colors, components, patterns)

Works across any project with CLAUDE.md documentation.

---

**Models:** Opus (Jarvis) → Sonnet (Friday/Sam/Nat) → Haiku (all others)  
**Docs source:** CLAUDE.md + GEMINI.md + docs/ + .claude/agent-memory/MEMORY.md  
**Per-issue:** Each GitHub Issue → documentation + handoff update  
**Compatible:** Chris's agent system (Soren patterns, GitHub-first, pre-deploy review)
