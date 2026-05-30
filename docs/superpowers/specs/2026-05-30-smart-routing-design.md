# Smart Agent Routing System — Design Spec
**Date:** 2026-05-30  
**Status:** Approved

## Problem

Current routing wastes tokens and delays execution:
- Jarvis (Opus/tier-3) reasons fully before delegating — expensive for tasks that have an obvious domain owner
- Friday owns domain work directly instead of delegating to workers (Ultron, Pym, Leo, Astra, etc.)
- Friday spawns workers sequentially or not at all, missing parallelism
- No hard enforcement — delegation is suggested, not required

## Design

### Routing Architecture

```
User request (Claude Code, no keywords needed)
     │
     ▼
Jarvis — instant domain classification (<1 message, no deep reasoning)
     │
     ├─ Engineering (code/arch/debug/deploy/test/PR) → Friday
     ├─ Business / GTM / pricing / strategy → Nat
     ├─ Security audit / compliance → Sam
     ├─ Docs / comms / README / changelog → Threepio
     ├─ Quick utility / cross-domain / no clear owner → r2d2
     └─ Cross-domain conflicts / CEO-level decisions → Jarvis owns
     
     ▼
Domain Lead receives task (Friday / Nat / Sam / Threepio / r2d2)
  Step 1. Decompose — break into subtasks, create issues if needed
  Step 2. Assess — does my team fit this better than me?
  Step 3. Delegate — spawn workers in parallel (not sequentially)
  Step 4. Collect — gather worker output
  Step 5. Audit — lead reviews all output
       ├─ Small issues → lead fixes directly
       └─ Big issues → send workers back with specific feedback loop
  Step 6. Ship — once clean, deliver to user
```

### Layer Responsibilities

| Agent | Role | Can do work directly? |
|-------|------|-----------------------|
| Jarvis | Route + cross-domain coordination only | Only cross-domain strategy |
| Friday | Engineering lead: decompose, delegate, audit | Audit fixes only |
| Nat | Business lead: decompose, delegate, audit | Audit fixes only |
| Sam | Security lead: decompose, delegate, audit | Audit fixes only |
| Threepio | Docs lead: can solo or delegate | Yes — docs often single-agent |
| r2d2 | Generalist fallback | Yes |
| Ultron/Pym/Leo/Astra/Wanda | Workers — primary executors | Yes — this is their job |

### Enforcement Rules (hard blocks in agent definitions)

**Jarvis:**
- `FORBIDDEN: write code, run commands, own any domain task`
- `FORBIDDEN: reason deeply before routing — classify and route in first response`
- `MUST: route to domain lead immediately, include full task context in handoff`

**Friday:**
- `FORBIDDEN: write code as primary executor — workers do primary execution`
- `FORBIDDEN: spawn workers sequentially — all parallel, single message`
- `MUST: delegate to domain worker if task fits their role`
- `ALLOWED: direct fixes during audit phase only`

**All domain leads (Nat, Sam):**
- Same delegation mandate as Friday, scoped to their domain

### Jarvis Classification Rules

Jarvis matches on first message only. No codebase reads, no context loading before routing.

| Signal | Route to |
|--------|----------|
| code, bug, fix, API, deploy, test, PR, merge, refactor, build, backend, frontend, database, infra, CI | Friday |
| pricing, GTM, strategy, revenue, market, sales, partnership, roadmap | Nat |
| security, vulnerability, audit, compliance, CVE, permissions | Sam |
| README, docs, changelog, announcement, email, write-up, blog | Threepio |
| ambiguous, mixed signals, no clear domain | r2d2 |
| cross-domain conflict, budget, CEO decision, two leads disagree | Jarvis owns |

### Friday Worker Assignment

Friday uses co-change graph query to identify related files, then maps to worker domains:

| Domain | Worker | Signals |
|--------|--------|---------|
| Backend / API / services | Ultron | routes, controllers, services, auth |
| Database / schema / migrations | Pym | *.sql, prisma, migrations |
| CI/CD / infra / observability | Leo | .github/workflows, Dockerfile, terraform |
| Frontend / components / UI | Astra | components, pages, *.tsx, *.css |
| Design / UX / design system | Wanda | figma, design tokens, UI spec |
| Docs within engineering | Threepio | README, CHANGELOG, docstrings |

Multi-domain tasks: Friday spawns all relevant workers in one parallel batch.

### Cost Profile

| Scenario | Before | After |
|----------|--------|-------|
| "fix API bug" | Jarvis reasons → Friday reasons → Ultron works | Jarvis routes (fast) → Friday delegates → Ultron works |
| "write README" | Jarvis reasons → Friday reasons → writes directly | Jarvis routes (fast) → Threepio writes |
| "build feature X" | Jarvis reasons → Friday works | Jarvis routes → Friday spawns Ultron+Pym+Astra parallel |
| Cross-domain strategy | Jarvis reasons + owns | No change — this is Jarvis's lane |

Jarvis Opus token spend drops to classification only (est. <200 tokens per routing decision).

## Files to Change

1. `.agents/agents/jarvis.md` — add instant-routing mandate, forbidden blocks, classification table
2. `.agents/agents/friday.md` — add mandatory delegation rules, parallel spawn mandate, audit-only direct work
3. `.agents/agents/nat.md` — add delegation mandate (mirrors Friday pattern)
4. `.agents/agents/sam.md` — add delegation mandate (mirrors Friday pattern)

## Out of Scope

- New tooling / infrastructure — this is agent definition changes only
- Changing worker agent definitions (Ultron, Pym, Leo, Astra, Wanda) — their escalation paths stay as-is
- r2d2 / Threepio — minor at most, no structural change needed
