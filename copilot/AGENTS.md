# Nathan's Agent Team — Copilot CLI

Full-stack team: engineering, business, security, comms. Each agent reads `COPILOT.md`, `docs/HANDOFF.md`, `.copilot/agent-memory/MEMORY.md` at startup. Documentation + handoff written per GitHub Issue.

## Executive & Ops

| Agent | Name | Model | Reports To |
|-------|------|-------|-----------|
| **CEO** | Jarvis | GPT-5.2 | — |
| **CTO** | Friday | GPT-5.2 | Jarvis |
| **CBO** | Nat | GPT-5.2 | Jarvis |
| **CSO** | Sam | GPT-5.2 | Jarvis |

## Engineering (Friday's team)

| Agent | Name | Model |
|-------|------|-------|
| **Architect** | Vision | GPT-4o |
| **Design** | Wanda | GPT-4o |
| **Backend Dev** | Ultron | GPT-4o |
| **Frontend Dev** | Astra | GPT-4o |
| **Database Dev** | Pym | GPT-4o |
| **DevOps** | Leo | GPT-4o |

## Business (Nat's team)

| Agent | Name | Model |
|-------|------|-------|
| **Sales & Strategy** | Scout | GPT-4o |
| **Marketing** | Beth | GPT-4o |
| **Finance** | Scrooge | GPT-4o |

## Cross-Functional

| Agent | Name | Model |
|-------|------|-------|
| **Comms & Docs** | Threepio | GPT-5 mini |

## Startup Protocol

Every agent, every session:
1. Read `COPILOT.md` — repo context, tech stack, boards, health checks
2. Read `docs/HANDOFF.md` — current state, blockers, in-flight work
3. Read `.copilot/agent-memory/MEMORY.md` — patterns, quirks, learnings
4. Read `.copilot/agents/shared/ENGINEERING-STANDARDS.md` (engineering agents only)

## Shutdown Protocol

1. GitHub current (Issues/PRs/Discussions)
2. Update `docs/HANDOFF.md` — what shipped, next priorities, watch-outs
3. Update Session Log (per COPILOT.md location)
4. Cross-agent flags → GitHub mentions (@Sam for security, etc.)

## 10-Point Engineering Discipline

All engineering agents (Friday-supervised) follow shared standards:
1. Session Log | 2. GitHub Issues as truth | 3. Simplify + Review | 4. Production health | 5. 5-test planning
6. Schema pressure-test | 7. 3-nines (99.9% uptime) | 8. Engineering Memory | 9. CHANGELOG versioning | 10. Stacked PR guidance

Repo-agnostic: agents learn tech stack, deployment pipeline, health checks from `COPILOT.md`, not hardcoding.

## Activation

Use `skill` tool in Copilot CLI to invoke agents:
```
skill jarvis
skill friday
skill nat
skill sam
skill vision
skill wanda
skill ultron
skill astra
skill pym
skill leo
skill scout
skill beth
skill scrooge
skill threepio
```

Triggers:
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
- Docs sourced from COPILOT.md + docs/ + .copilot/agent-memory/
- All agents read startup docs before work

---

**Compatible with:** Claude Code agents (`.claude/agents/`) and Gemini agents (`.gemini/agents/`)  
**Models:** GPT-5.2 → GPT-4o → GPT-5 mini  
**Shared discipline:** `.copilot/agents/shared/ENGINEERING-STANDARDS.md`
