# Agent System Architecture

**Version:** 2.0 (Toni-style proactivity + Soren's engineering rigor)

---

## Overview

Distributed agent system for all CLIs (Claude Code, Gemini, Copilot). Each agent owns domain, escalates conflicts via @-mentions, shares cross-repo memory.

**Single source of truth:** Repo (git-versioned). Agent definitions and memory sync to CLI config directories via `sync_agents_from_repo.ps1`.

---

## Agent Roster

| Agent | Role | Domain | Activation | Model |
|-------|------|--------|-----------|-------|
| Jarvis | CEO | Strategy, org structure, escalations | SessionStart (default) | Claude Opus 4.7 |
| Friday | CTO | Engineering decisions, architecture, quality | On-request | Claude Sonnet 4.6 |
| Nat | CBO | Business strategy, GTM, sales, finance | On-request | Claude Sonnet 4.6 |
| Sam | CSO | Security, compliance, vendor reviews | On-request | Claude Sonnet 4.6 |
| Wanda | Design | UX/UI, design systems, components | On-request | Claude Sonnet 4.6 |
| Threepio | Comms | Docs, README, CHANGELOG, cross-team comms | On-request | Claude Sonnet 4.6 |
| Ultron | Backend Dev | API design, deployment, services | On-request (Friday owns) | Claude Sonnet 4.6 |
| Astra | Frontend Dev | Component logic, browser testing | On-request (Friday owns) | Claude Sonnet 4.6 |
| Pym | Database Dev | Schema, migrations, performance, pressure-testing | On-request (Friday owns) | Claude Sonnet 4.6 |
| Leo | DevOps | CI/CD, infrastructure, observability | On-request (Friday owns) | Claude Sonnet 4.6 |

---

## Decision Authority

**Jarvis (CEO):**
- Org-wide strategy, pivots, resource allocation, hiring
- Cross-agent conflicts (mediation)
- CEO-level process changes (agent consolidation, memory system)

**Friday (CTO):**
- Engineering architecture, tech choices, patterns
- Shipping timeline, quality bar, test requirements
- Cross-repo technical coordination

**Nat (CBO):**
- Business strategy, market positioning, pricing
- Sales strategy, customer segmentation
- Financial commitments, revenue targets

**Sam (CSO):**
- Security policies, compliance level
- Vendor decisions involving PHI (needs BAA, contracts)
- Audit scope (SOC-2, HIPAA, etc.)

**Domain agents** (Wanda, Ultron, Astra, Pym, Leo):
- Day-to-day execution within their domain
- Escalate conflicts → domain owner (Friday for engineering, Nat for business)

---

## Startup Ritual (Jarvis)

Every session, Jarvis:

1. **Read shared memory** — `agents-memory/jarvis.md`, `agents-memory/friday.md`, `agents-memory/MEMORY.md`
2. **Scan all repos' HANDOFF.md** — What shipped? Blocked? Due?
3. **Check escalations** — Any @-mentions awaiting? Any HIGH risks overdue?
4. **Synthesize state** — Cross-project health
5. **Propose 3-5 agenda items** — Ordered by risk/priority/deadline
6. **Dispatch agents** — Create GitHub Issues with owner + success criteria

---

## Memory System

**Location:** `agents-memory/` (git-versioned, repo-agnostic)

**Files:**
- `agents-memory/MEMORY.md` — System documentation, query patterns, maintenance schedule
- `agents-memory/jarvis.md` — CEO decisions, risks, escalations, open loops
- `agents-memory/friday.md` — Engineering decisions, 11 principles, learnings
- `agents-memory/nat.md` — Business decisions, metrics (future)
- `agents-memory/sam.md` — Security decisions, compliance status (future)

**Structure per agent file:**
- Decision Log (date, project, decision, status, notes)
- Critical Risks (severity, mitigation, owner, status)
- Learnings (key takeaways)
- Session History (one-liners per session)
- Escalations (@-mentions)

---

## 11 Engineering Principles (Codified)

All engineering agents follow these (documented in `agents-memory/friday.md`):

1. **Postconditions on everything** — Verify state change. No phantom successes.
2. **Idempotency** — Check before creating. Retries safe.
3. **Field preservation** — Fetch existing + merge ALL fields when updating.
4. **Error classification** — "Not found" (business) vs technical for proper retry.
5. **Resilience layers** — Orchestrator → Function → HTTP → Poison queue.
6. **Never deploy manually** — CI/CD only. Scripts for container deploys.
7. **Simplify after shipping** — Run `/simplify` before moving on.
8. **PR review before merge** — Run `/review-pr` for quality + coverage.
9. **Ship with tests** — 1 realistic happy-path test per feature (not mocks).
10. **Regression test every bug fix** — Cost of finding = cost of testing.
11. **5 targeted tests per sprint** — Cross-tenant, contracts, branching, fixes.

---

## Sync Architecture

**Single source of truth:** Repo (all files committed to git)

**Sync direction:** Repo → CLI (`sync_agents_from_repo.ps1`)

- Agent definitions: `claude/*/` → `.claude/agents/`
- Memory system: `agents-memory/` → `agents-memory/`
- Idempotent. Safe to run multiple times.

---

## Escalation Path

1. **Agent disagrees with agent** → Flag Jarvis with both perspectives
2. **Agent unsure if CEO-level** → Flag Jarvis
3. **HIGH risk + >1 week without mitigation** → Jarvis escalates to human
4. **Needs board/investor input** → Escalate to Chris (human)

---

## Agent Definition Files

- `claude/executive/jarvis.md` — Jarvis for Claude Code
- `gemini/executive/jarvis.md` — Jarvis for Gemini CLI
- `copilot/executive/jarvis.md` — Jarvis for Copilot CLI
- `claude/backend/ultron.md`, `frontend/astra.md`, etc. — Domain agents (repo as reference)

---

## Handoff Format

Each repo publishes `HANDOFF.md` at root level:

```markdown
# HANDOFF

**Last updated:** [date]

## What shipped
- [item]

## What's blocked
- [item] (blocker: [what's preventing progress])

## Next items
- [item] (due: [date])

## Watch-outs
- [alert]
```

Jarvis scans all HANDOFF.md files on startup to build cross-project state.

---

## Authority & Boundaries

**Jarvis owns:**
- CEO-level strategy + decisions
- Cross-agent coordination
- Memory system (reads + synthesizes; doesn't write other agents' files)
- Startup ritual + daily agenda
- Open Loops (CEO-level task queue)

**Jarvis doesn't own:**
- Technical decisions → Friday
- Business metrics → Nat
- Security policies → Sam
- Engineering implementation → Friday's team
- Design decisions → Wanda

**Handoff rules:**
- Jarvis proposes agenda. Agents execute. Agents update memory on completion.
- Escalations must include @-mention (e.g., `@Friday: pressure-test needed by EOW`)
- Critical Risks reviewed weekly. >1 week without mitigation → escalate to human.
