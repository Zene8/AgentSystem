# Agent System Reference

Comprehensive reference for the agent system. Canonical definitions live in `.agents/agents/`, per-agent memory in `.agents/memory/`, and session notes in `agents-memory/`.

For Claude-specific setup, see `CLAUDE.md`. For in-flight blockers, see `docs/HANDOFF.md`.

---

## Agent Roster

| Agent | Role | Model | Authority |
|-------|------|-------|-----------|
| **Jarvis** | CEO — default entry, cross-agent coordination, escalations | Opus | Autonomous |
| **Friday** | CTO — engineering architecture and delivery | Sonnet | Autonomous (Sam gate for main merges) |
| **Nat** | CBO — strategy and GTM | Sonnet | Autonomous |
| **Sam** | CSO — security, compliance, vendor review | Sonnet | Autonomous + Hard Gate |
| **Wanda** | Design — UX/UI, design system, tokens | Sonnet | Domain |
| **Threepio** | Comms & Docs — README, CHANGELOG, PR descriptions, handoffs | Sonnet | Domain |
| **Ultron** | Backend — APIs, services, deployment | Haiku | Domain |
| **Astra** | Frontend — components, UX, performance | Haiku | Domain |
| **Pym** | Database — schema, migrations, queries | Haiku | Domain |
| **Leo** | DevOps — CI/CD, infrastructure, observability | Haiku | Domain |
| **General Coding** | Fallback — coding tasks that don't fit a specialist | Haiku | Domain |

**Default entry agent:** Jarvis. Override with `--agent=<name>` or see "Bypassing Jarvis" below.

---

## Routing Rules

When a request matches a pattern, dispatch to the listed agent. Match the most specific pattern first. If no pattern matches, Jarvis determines routing.

| Pattern | Primary Agent | Escalation |
|---------|--------------|------------|
| Backend API / Service / Deployment | Ultron | Conflicts → Friday |
| Database schema / migrations / queries | Pym | Conflicts → Friday |
| Frontend / Component / UX / Performance | Astra | Design questions → Wanda; conflicts → Friday |
| Design / Component design / Design system / Tokens | Wanda | Technical issues → Friday; conflicts → Jarvis |
| DevOps / CI-CD / Infrastructure / Observability | Leo | Conflicts → Friday |
| Security / Compliance / Auth / Vendor review | Sam | Hard gate on all main merges |
| Business strategy / Revenue / Pricing / Customer health | Nat | Conflicts → Jarvis |
| Leadership / Orchestration / Cross-domain | Jarvis | — |
| Docs / README / Handoffs / Release notes / PR descriptions | Threepio | Direction conflicts → Friday; announcements → Nat |
| Architecture / Tech decisions / Design review | Friday | Escalates to Jarvis |

**Ambiguous cases:**
- "Auth in frontend" → Astra (implementation) + Sam (audit)
- "Database schema + API" → coordinate via Jarvis; Pym owns schema, Ultron owns API layer
- "Design system + frontend component" → Wanda designs, Astra implements

---

## Domain Ownership Map

| Domain | Owner | Others Can Read? | Notes |
|--------|-------|-----------------|-------|
| Backend APIs / Services | Ultron | All | Ultron approves API contracts |
| Database Schema / Migrations | Pym | Ultron (read), Sam (audit) | Pym signs off all schema changes |
| Frontend Components / UX | Astra | All | — |
| Design System / Tokens | Wanda | Astra (implementation) | Wanda owns visual language |
| DevOps / CI-CD / Infrastructure | Leo | All | Leo owns deployment gates |
| Security Policies / Compliance | Sam | All (audit) | Sam is hard gate on main merges |
| Architecture / Tech Decisions | Friday | All | Friday owns ADRs and tech direction |
| Business Strategy / Revenue | Nat | Jarvis | Nat owns GTM and customer health |
| GitHub Discussions (Decisions) | Jarvis | All | Jarvis owns decision record |
| README / Docs / Handoffs | Threepio | All | Threepio owns documentation quality |

**Cross-domain rule:** If a task spans multiple domains (e.g., backend API + frontend), coordinate via Jarvis. Note outcomes in both agent memories and `docs/HANDOFF.md`.

---

## Coordination Rules

1. **Each agent owns their domain.** Don't write to another agent's memory or folders without flagging it.
2. **Cross-domain work is coordinated via Jarvis.** Note in both agent memories and `docs/HANDOFF.md`.
3. **GitHub Issues are the task model.** All work tracked as Issues. Agent memories link to Issues, not vice-versa.
4. **Memory stays in agent file.** Session logs, decisions, and learnings belong in `.agents/memory/{agent}.md`.
5. **HANDOFF.md is for blockers.** If Agent A is blocked waiting on Agent B, note it in `docs/HANDOFF.md`. Jarvis monitors this on startup.
6. **Escalation is transparent.** When escalating to Jarvis, state why in GitHub Discussion or agent memory.
7. **Bypass is documented.** Users can invoke agents directly to skip Jarvis. The agent respects the direct request.
8. **Sync script is authoritative.** Run `sync_agents_from_repo.ps1` after any agent definition change.

**Exception:** Ephemeral thinking within a single session doesn't need coordination. Only decisions and blockers that outlive the session require documentation.

---

## Bypassing Jarvis

If you have a specific, well-scoped task and want to skip Jarvis orchestration, invoke the agent directly.

### CLI Methods

- **Claude Code (named agent):** `claude @ultron`
- **In conversation:** "Be Ultron: review this API"
- **With argument hint:** `claude @friday --focus=api-layer`

### When to Bypass

- You have a specific, well-scoped task (e.g., "fix this bug in the auth service")
- You know which agent should handle it
- You don't need cross-domain coordination
- You don't need work prioritized against current goals

### When NOT to Bypass

- Task is ambiguous or spans multiple domains
- You need the current goal/priority context
- You need cross-team coordination or a decision record
- You're unsure which agent owns the task

---

## Memory Structure

All agent memory follows the template at `.agents/memory/TEMPLATE.md`.

Sections:
- **Session Log** — one line per session, append only, date-stamped
- **Operational Patterns** — decision heuristics and domain rules
- **Key Decisions** — table of date / decision / context / impact
- **Cadence** — review schedule and checklist
- **Learnings** — surprises and future-behavior changes

Memory files live at `.agents/memory/{agent}.md`. Jarvis enforces memory updates on shutdown (step 8 of startup checklist).

---

## Startup Procedure

Jarvis runs an 8-step startup on every session. See `.agents/agents/jarvis.md` for the full definition.

Summary:
1. Read `agents-memory/jarvis.md` — decisions, blockers, review schedule
2. [PARALLEL] GitHub: last-48h PRs, stale issues, unresolved Discussions
3. Scan `HANDOFF.md` blocked section + review due dates
4. [PARALLEL] Email (last 24h) + calendar (next 7d)
5. Scan `.agents/memory/` for stale agents (no entry >3 days)
6. Identify blockers, risks, decisions needed
7. Synthesize and brief user with agenda + decision queue
8. Execute + append outcomes to `agents-memory/jarvis.md`

---

## Escalation Paths

```
User
 └─▶ Jarvis (default entry, orchestration)
       ├─▶ Friday (CTO) ──────── architecture, tech decisions, merge gate
       │     └─▶ Sam (CSO) ───── security audit, hard gate on main
       ├─▶ Nat (CBO) ─────────── business strategy, GTM
       ├─▶ Ultron ─────────────── backend APIs
       │     └─▶ Pym ─────────── database (if API touches schema)
       ├─▶ Astra ──────────────── frontend
       │     └─▶ Wanda ──────── design (if UX questions arise)
       ├─▶ Leo ────────────────── DevOps / CI-CD
       ├─▶ Threepio ───────────── docs and comms
       └─▶ Sam ────────────────── security (any agent, any time)
```

**Hard gate:** Sam must review ALL main branch merges. No exceptions. Friday can override with documented justification to Jarvis.

---

## Source of Truth

| File | Purpose |
|------|---------|
| `.agents/agents/<agent>.md` | Master agent definition |
| `.agents/memory/<agent>.md` | Agent decision log and session notes |
| `.agents/memory/TEMPLATE.md` | Memory structure template |
| `agents-memory/<agent>.md` | Runtime session persistence (CLI) |
| `sync_agents_from_repo.ps1` | Generates user-level Claude, Copilot, Gemini, Antigravity copies |
| `CLAUDE.md` | Claude-specific usage, default agent, bypass pattern |
| `docs/HANDOFF.md` | Current-state log for in-flight and blocked work |
| `README.md` | Repo overview and quick start |

---

## Model Policy

| Agent | Claude | Gemini | Copilot |
|-------|--------|--------|---------|
| Jarvis | claude-opus-4-7 | gemini-3.1-pro-preview | gpt-5.2-codex |
| Friday / Nat / Sam | claude-sonnet-4-6 | gemini-2.5-pro | gpt-5.4-mini |
| Threepio | claude-sonnet-4-6 | gemini-3.1-flash-lite-preview | gpt-5-mini |
| All other agents | claude-haiku-4-5-20251001 | gemini-3-flash-preview | gpt-5-mini |

If a model mapping changes, update `sync_agents_from_repo.ps1` first, then regenerate outputs.
