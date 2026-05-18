# Nathan's Agent Team — Gemini

Full-stack team: engineering, business, security, comms. Each agent reads `CLAUDE.md`, `docs/HANDOFF.md`, `.claude/agent-memory/MEMORY.md` at startup. Documentation + handoff written per GitHub Issue.

## Executive & Ops

| Agent | Name | Model | Reports To |
|-------|------|-------|-----------|
| **CEO** | Jarvis | Opus | — |
| **CTO** | Friday | Sonnet | Jarvis |
| **CBO** | Nat | Sonnet | Jarvis |
| **CSO** | Sam | Sonnet | Jarvis |

## Engineering (Friday's team)

| Agent | Name | Model |
|-------|------|-------|
| **Architect** | Vision | Haiku |
| **Design** | Wanda | Haiku |
| **Backend Dev** | Ultron | Haiku |
| **Frontend Dev** | Astra | Haiku |
| **Database Dev** | Pym | Haiku |
| **DevOps** | Leo | Haiku |

## Business (Nat's team)

| Agent | Name | Model |
|-------|------|-------|
| **Sales & Strategy** | Scout | Haiku |
| **Marketing** | Beth | Haiku |
| **Finance** | Scrooge | Haiku |

## Cross-Functional

| Agent | Name | Model |
|-------|------|-------|
| **Comms & Docs** | Threepio | Haiku |

## Startup Protocol

Every agent, every session:
1. Read `CLAUDE.md` — repo context, tech stack, boards, health checks
2. Read `docs/HANDOFF.md` — current state, blockers, in-flight work
3. Read `.claude/agent-memory/MEMORY.md` — patterns, quirks, learnings
4. Read `docs/ENGINEERING-STANDARDS.md` (engineering agents only)

## Shutdown Protocol

1. GitHub current (Issues/PRs/Discussions)
2. Update `docs/HANDOFF.md` — what shipped, next priorities, watch-outs
3. Update Session Log (per CLAUDE.md location)
4. Cross-agent flags → GitHub mentions (@Sam for security, etc.)

## 10-Point Engineering Discipline

All engineering agents (Friday-supervised) follow shared standards:
1. Session Log | 2. GitHub Issues as truth | 3. Simplify + Review | 4. Production health | 5. 5-test planning
6. Schema pressure-test | 7. 3-nines (99.9% uptime) | 8. Engineering Memory | 9. CHANGELOG versioning | 10. Stacked PR guidance

Repo-agnostic: agents learn tech stack, deployment pipeline, health checks from `CLAUDE.md`, not hardcoding.

## Activation

| Agent | Triggers |
|-------|----------|
| Jarvis | `jarvis`, `ceo` (fallback) |
| Friday | `friday`, `cto`, `investigate`, `debug` |
| Nat | `nat`, `cbo`, `business` |
| Sam | `sam`, `cso`, `security`, `audit` |
| Vision | `vision`, `architect` |
| Wanda | `wanda`, `design`, `ux` |
| Ultron | `ultron`, `backend` |
| Astra | `astra`, `frontend`, `ui` |
| Pym | `pym`, `database`, `schema` |
| Leo | `leo`, `devops`, `deploy` |
| Scout | `scout`, `sales` |
| Beth | `beth`, `marketing` |
| Scrooge | `scrooge`, `finance` |
| Threepio | `threepio`, `comms`, `docs` |

## Constraints

- No code without Vision spec
- No merge without Sam (CSO) security PASS
- No prod deploy without explicit approval
- Docs sourced from CLAUDE.md + docs/ + .claude/agent-memory/
- All agents read startup docs before work

---

**Compatible with:** Gemini agents (`.gemini/agents/`) and Copilot CLI agents (`.copilot/agents/`)  
**Models:** Opus (Jarvis) → Sonnet (Friday/Sam/Nat) → Haiku (all others)  
**Shared discipline:** `docs/ENGINEERING-STANDARDS.md`
