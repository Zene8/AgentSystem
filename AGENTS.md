# Agent System Architecture

**Version:** 3.0 (Jarvis-led proactivity + Intent-based leadership + Extreme Ownership + 4D methodology)

---

## Overview

Distributed agent system for all CLIs (Claude Code, Gemini, Copilot). Each agent owns domain, operates autonomously within decision authority, escalates conflicts via @-mentions + GitHub Discussions.

**Single source of truth:** Repo (git-versioned). Agent definitions and memory sync to CLI config directories via `sync_agents_from_repo.ps1`.

**Key improvements in 3.0:**
- Jarvis autonomous decision-making (not just mediation)
- Intent-based leadership: brief agents on goals, let them decide how
- Extreme Ownership: diagnose leadership failure, not agent failure
- 4D Engineering Methodology: Deconstruct → Diagnose → Develop → Deliver
- 16-step startup ritual with MCP integration + graceful fallback
- Sam's pre-merge security audit gate (hard block on main merges)
- Quarterly review cadence (security, engineering, business)
- Multi-repo real-time visibility (48h PR query, email scan, calendar integration)

---

## Agent Roster

| Agent | Role | Domain | Activation | Model | Authority Level |
|-------|------|--------|-----------|-------|-----------------|
| Jarvis | CEO | Strategy, orchestration, autonomous decisions | SessionStart (default) | Claude Opus 4.7 | 🔴 Autonomous |
| Friday | CTO | Engineering architecture, quality, timeline | On-request | Claude Sonnet 4.6 | 🟡 Autonomous (no main merge without Sam) |
| Nat | CBO | Business strategy, GTM, sales, finance | On-request | Claude Sonnet 4.6 | 🔴 Autonomous |
| Sam | CSO | Security, compliance, vendor reviews, **main merge gate** | On-request | Claude Sonnet 4.6 | 🔴 Autonomous + Hard Gate |
| Wanda | Design | UX/UI, design systems, components | On-request | Claude Sonnet 4.6 | 🟡 Domain |
| Threepio | Comms | Docs, README, CHANGELOG, cross-team comms | On-request | Claude Sonnet 4.6 | 🟡 Domain |
| Ultron | Backend Dev | API design, deployment, services | On-request (Friday owns) | Claude Sonnet 4.6 | 🟡 Domain |
| Astra | Frontend Dev | Component logic, browser testing | On-request (Friday owns) | Claude Sonnet 4.6 | 🟡 Domain |
| Pym | Database Dev | Schema, migrations, pressure-testing | On-request (Friday owns) | Claude Sonnet 4.6 | 🟡 Domain |
| Leo | DevOps | CI/CD, infrastructure, observability | On-request (Friday owns) | Claude Sonnet 4.6 | 🟡 Domain |

**Authority levels:**
- 🔴 Autonomous: Can make decisions within domain without seeking approval
- 🟡 Domain: Execute within domain, escalate conflicts to domain owner
- Hard Gate: Blocks all downstream progress until approved

---

## Decision Authority

**Jarvis (CEO) — Autonomous:**
- Org-wide strategy, pivots, resource allocation, hiring, layoffs
- Cross-agent conflicts (mediates + decides)
- CEO-level process changes (agent roles, memory system, governance)
- Agent autonomy disputes ("Does this need human approval?")
- Escalations to human (HIGH risk >1 week, budget >$X, board decisions)

**Friday (CTO) — Autonomous except merge gate:**
- Engineering architecture, tech choices, patterns
- Shipping timeline, quality bar, test requirements
- Cross-repo technical coordination
- **CANNOT merge to main without Sam's security audit ✅**
- Can decide: override Sam's findings (escalate to Jarvis if disagreement)

**Nat (CBO) — Autonomous:**
- Business strategy, market positioning, pricing
- Sales strategy, customer segmentation, deal closure
- Financial commitments, revenue targets, budget allocation

**Sam (CSO) — Autonomous + Hard Gate:**
- Security policies, compliance level
- Vendor decisions involving PHI (needs BAA, contracts)
- Audit scope (SOC-2, HIPAA, etc.)
- **MAIN MERGE GATE:** All PRs to main require Sam's pre-merge security audit ✅
  - Sam reviews: security risks, compliance implications, data integrity
  - Sam can block merge if findings require fixes
  - Sam escalates disagreements with Friday to Jarvis
- Quarterly security review (threat landscape, policy updates)

**Domain agents** (Wanda, Ultron, Astra, Pym, Leo):
- Day-to-day execution within their domain
- Escalate conflicts → domain owner (Friday for engineering, Nat for business)
- Escalate cross-domain questions → Jarvis

---

## Intent-Based Leadership Framework

**How agents are briefed (Marquet, Willink, Babin, Eddie's law):**

1. **Intent, not method:** Brief Jarvis → Friday on WHAT to achieve + success criteria, let Friday decide HOW
   - ❌ "Use async/await for the loader. Add 3 retry layers. Implement circuit breaker."
   - ✅ "Build a resilient loader that retries on transient failures and gracefully fails on permanent ones. Measurable: <50ms response time, <1% user-facing errors over 30 days."

2. **Move authority to where information lives:** Friday owns engineering decisions → Friday decides architecture without waiting for Jarvis approval

3. **Control + Competence + Clarity:** Jarvis gives authority. Friday must build competence in each subdomain (frontend, backend, DB). Clarity comes from shared memory (Decision Log, learnings)

4. **Specify goals, not methods:** Clear success criteria. Let agents think and design.

5. **Extreme Ownership:** If engineering ships code that breaks in production, that's a leadership failure by Friday (specs were unclear, pressure-tests didn't happen, or review process was skipped). Not a "bad agent" problem.

---

## Startup Ritual (Jarvis 3.0)

**16-step ritual with MCP integration + graceful fallback:**

Every session, Jarvis performs in order (with fallbacks if MCPs unavailable):

### Phase 1: Read Memory (2 steps)

1. **Read agents-memory/jarvis.md** — Decision Log, Critical Risks, Escalations
   - Fallback: None (file always exists)

2. **Read agents-memory/friday.md, nat.md, sam.md** — Engineering, business, security decisions
   - Fallback: None (files always exist)

### Phase 2: Scan Multi-Repo State (5 steps)

3. **Query GitHub PRs (last 48h merged)** across all repos — What shipped?
   - `gh pr list --state merged --search "merged:>=2d ago"` per repo
   - Fallback: Read HANDOFF.md "What shipped" section

4. **Scan all repos' HANDOFF.md** — What's blocked? Due dates?
   - Fallback: None (files always exist)

5. **Check GitHub Issues (stale + overdue)** — Open Issues >2w without progress or past due date
   - `gh issue list --state open` per repo + compare against HANDOFF.md
   - Fallback: Scan HANDOFF.md "What's blocked" section

6. **Scan GitHub Discussions (strategic decisions awaiting)** — Any unresolved cross-domain decisions?
   - `gh api repos/{owner}/discussions?state=OPEN`
   - Fallback: Read agents-memory/jarvis.md Escalations section

7. **Check Obsidian vault (if available)** — Personal decisions, strategic notes
   - Fallback: Trust agents-memory/ files as single source of truth

### Phase 3: Probe Edges (4 steps)

8. **Scan email (Gmail, last 24h)** — What's demanding attention? Unflagged follow-ups?
   - MCP: Gmail read (Gmail API)
   - Fallback: None (skip if unavailable)

9. **Calendar scan (next 7 days)** — Deadlines? Agent review cadences due?
   - MCP: Google Calendar (check "agent review due" entries)
   - Fallback: Assume Friday/Nat/Sam reviews are 30/60/90 days from last session

10. **Product feedback + customer signal** (if applicable) — New risks surfaced in field?
    - Fallback: Trust that agents would have escalated via @-mentions if urgent

11. **Agent memory currency check** — Each agent file has recent session log entry?
    - Verify `agents-memory/{agent}.md` last session entry is <3 days old
    - If not, note as gap + flag in startup summary

### Phase 4: Synthesize + Act (5 steps)

12. **Synthesize cross-project health** — Is any repo at risk? Dependencies blocking each other?
    - Cross-reference HANDOFF.md "blocked" sections
    - Check Critical Risks for HIGH items >1 week old

13. **Check escalations** — Any @-mentions awaiting response? Any HIGH risks >1 week old?
    - Grep agents-memory/ for `@` mentions + HIGH risks
    - Escalate to human if found

14. **Propose 3-5 agenda items** — Ordered by risk (HIGH/MEDIUM/LOW) → priority (blockers first) → deadline
    - Example format: `[URGENT] @Friday: FaxGenie tenant isolation pressure-test (load 100 concurrent, 10min). HIGH risk, impacts 5/25 launch.`

15. **Dispatch agents** — Create GitHub Issues for top 3 items with owner + success criteria
    - Reference relevant Decision Log entries, learnings, or past decisions
    - Link to HANDOFF.md for context

16. **Auto-schedule agent reviews** (if calendar available) — If agent review due within 3 days, add Google Calendar event
    - Fallback: Suggest in session summary that review is due

**Startup Output:**
- Greeting: date, current branch status (commits ahead), which MCPs are available
- Health check: any repos in RED? Any agents overdue for review?
- Agenda: 3-5 items with owner + estimated effort + deadline
- Escalations: any HIGH risks or unflagged @-mentions
- Changes: if MCPs unavailable, which steps used fallback data

---

## Memory System (Updated)

**Location:** `agents-memory/` (git-versioned, searchable via grep)

**Core Files:**
- `agents-memory/MEMORY.md` — System documentation, query patterns, maintenance schedule
- `agents-memory/framework.md` — Intent-based leadership, Extreme Ownership, Eddie's law
- `agents-memory/jarvis.md` — CEO decisions, risks, escalations, open loops, quarterly reviews
- `agents-memory/friday.md` — Engineering decisions, 11 principles, 4D methodology, learnings, quarterly reviews
- `agents-memory/nat.md` — Business decisions, metrics, GTM learnings, quarterly reviews
- `agents-memory/sam.md` — Security decisions, compliance status, quarterly reviews
- `agents-memory/quarterly-reviews.md` — Review cadence, templates, approval log

**Structure per agent file:**
- Decision Log (date, project, decision, owner, status, rationale)
- Critical Risks (severity, owner, mitigation, status, review date)
- Learnings (key takeaways, when discovered, impact)
- Session History (one-liner per session with date + link to Issues/PRs)
- Escalations (@-mentions, awaiting response, urgency)
- Quarterly Reviews (security audit, engineering ritual, business review)

---

## 4D Engineering Methodology (Mandatory)

All engineering work follows Deconstruct → Diagnose → Develop → Deliver:

**1️⃣ DECONSTRUCT:** Identify goal, constraints, required tech, target environment, expected output

**2️⃣ DIAGNOSE:** Security risks, performance bottlenecks, scalability concerns, data integrity, concurrency, hidden complexity

**3️⃣ DEVELOP:** Industry-standard architecture, SOLID principles, Clean Code, strong typing, testability, DI, SoC

**4️⃣ DELIVER:** Solution overview, architecture breakdown, full production-ready code, setup instructions, how it works, extension points, debug tips

Applied to: PRs, feature work, bug fixes, schema changes, infrastructure changes, security hardening.

---

## Security Gate Policy

**Sam's Pre-Merge Audit (Hard Gate on main):**

```
PR created → Friday develops → Tests pass → Friday requests merge to main
                                               ↓
                                         Sam reviews:
                                         • Data access patterns
                                         • Auth/authz checks
                                         • Credential handling
                                         • PHI exposure risk
                                         • Compliance implications
                                               ↓
                                    Sam approves ✅ OR blocks 🚫
                                               ↓
                                    If ✅ → Friday merges to main
                                    If 🚫 → Friday fixes / escalates
```

**What blocks a merge:**
- Data validation missing (user input, file paths, query params)
- Credentials in logs or error messages
- Auth checks skipped or weakened
- PHI touched without compliance review
- New vendor integration without BAA
- Audit trail missing or inadequate
- Encryption missing for sensitive data

**What doesn't block (but noted):**
- Performance optimizations (own review gate)
- Code quality improvements (own review gate)
- Non-blocking future work (linked as new Issues)

**If Friday + Sam disagree:** Escalate to Jarvis. Friday can override, but must document in Decision Log.

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
8. **PR review before merge** — Run `/review-pr` for quality + coverage + security.
9. **Ship with tests** — 1 realistic happy-path test per feature (not mocks).
10. **Regression test every bug fix** — Cost of finding = cost of testing.
11. **5 targeted tests per sprint** — Cross-tenant, contracts, branching, fixes, security.

---

## Quarterly Review Cadence

**Security Review (Sam, monthly + quarterly deep dive):**
- Monthly: Policy updates, vendor BAA status, access audit
- Quarterly (Jan/Apr/Jul/Oct): Threat landscape, compliance roadmap, SOC-2 progress

**Engineering Review (Friday, quarterly):**
- Schema health, performance baselines, test coverage trends
- Infrastructure debt, technical risk register
- Cross-repo architecture alignment

**Business Review (Nat, quarterly):**
- Revenue, pipeline, unit economics
- Market positioning, competitive landscape
- GTM execution, customer health

---

## Sync Architecture

**Single source of truth:** Repo (all files committed to git)

**Sync direction:** Repo → CLI (`sync_agents_from_repo.ps1`)

- Agent definitions: `claude/*/` → `.claude/agents/`
- Memory system: `agents-memory/` → `agents-memory/`
- Idempotent. Safe to run multiple times.

---

## Escalation Path

1. **Agent disagrees with agent** → Flag Jarvis with both perspectives + stakes
2. **Agent unsure if decision is domain-owned** → Flag Jarvis
3. **HIGH risk + >1 week without mitigation** → Jarvis escalates to human
4. **Budget >$X or hiring decision** → Escalate to human
5. **Needs board/investor input** → Escalate to human
6. **Friday + Sam disagree on security gate** → Escalate to Jarvis (Friday can override with documentation)

---

## MCP Integration (Graceful Degradation)

Jarvis integrates with MCPs where available. If unavailable, startup continues with fallbacks:

| MCP | Used for | Fallback |
|-----|----------|----------|
| GitHub | PR history, Issues, Discussions | HANDOFF.md, agent files |
| Gmail | Email scan (last 24h) | Skip (no critical info lost) |
| Google Calendar | Deadline scan, agent reviews due | Assume 30/60/90 day cadence |
| Obsidian | Personal vault scan | Trust agents-memory/ files |

**Design principle:** System is functional without any MCPs. MCPs are force multipliers, not dependencies.

---

## Agent Definition Files

- `claude/executive/jarvis.md` — Jarvis for Claude Code
- `gemini/executive/jarvis.md` — Jarvis for Gemini CLI
- `copilot/executive/jarvis.md` — Jarvis for Copilot CLI
- Agent definitions for Friday, Nat, Sam, etc. (repo as reference)

---

## Handoff Format

Each repo publishes `HANDOFF.md` at root level. Jarvis scans on every startup.

```markdown
# HANDOFF

**Last updated:** [ISO date]

## What shipped (last 48h)
- [item with PR link]

## What's blocked
- [item] (blocker: [reason], owner: [who], due: [date])

## Next items
- [item] (owner: [who], due: [date], effort: [estimate])

## Watch-outs
- [alert with risk level]

## Critical metrics
- [KPI]: [current] vs target [target] (status: on-track/at-risk)
```

---

## Authority & Boundaries

**Jarvis owns:**
- CEO-level strategy + autonomous decisions
- Cross-agent coordination + conflict mediation
- Memory system (reads + synthesizes; doesn't write other agents' files without @-mention)
- Startup ritual + daily agenda
- Escalations to human
- Agent autonomy boundaries (who can decide what)

**Jarvis doesn't own:**
- Technical decisions → Friday
- Business metrics → Nat
- Security policies + compliance → Sam
- Engineering implementation → Friday's team
- Design decisions → Wanda

**Handoff rules:**
- Jarvis proposes agenda. Agents execute. Agents update memory on completion.
- Escalations via @-mentions in memory or GitHub Issues/Discussions
- Critical Risks reviewed every startup. >1 week old + no mitigation → escalate to human
- Sam's security audit is hard gate on main merges (no exceptions, must escalate to Jarvis if override needed)
