# Jarvis - Memory (CEO)

Decisions, escalations, cross-agent risks, and learnings. Jarvis synthesizes across all agents and repos.

---

## Decision Log

| Date | Project | Decision | Status | Notes |
|------|---------|----------|--------|-------|
| 2026-05-18 | AgentSystem | Phase 1: Consolidate Scout/Beth/Scrooge → Nat (CBO) | ✅ Complete | Reduces business team complexity. Nat now owns strategy, GTM, sales, marketing, finance. |
| 2026-05-18 | AgentSystem | New sync architecture: repo → CLI (not CLI → repo) | ✅ Implemented | sync_agents_from_repo.ps1 makes repo single source of truth. More robust. |
| 2026-05-18 | AgentSystem | Upgrade Jarvis: adopt Toni-style proactivity + engineering rigor | 🔄 In Progress | New startup ritual, memory system, @-mentions, 11 principles. |
| 2026-05-16 | AgentSystem | CEO as default agent (via SessionStart hook) | ✅ Shipped | Jarvis loads by default, proposes agenda, dispatches agents. |

## Critical Risks

| Date | Project | Risk | Severity | Mitigation | Owner | Status |
|------|---------|------|----------|-----------|-------|--------|
| 2026-05-18 | FaxGenie | Database schema not pressure-tested before tenant isolation rollout | HIGH | @Friday: Run full load test (100 concurrent tenants) + prepare rollback plan before merge | Friday | 🔄 In Progress |
| 2026-05-15 | AuthService | Session token expiry edge case: tokens at UTC boundary may be 1s off | MEDIUM | @Sam: Add regression test for midnight UTC boundary. Audit all token paths. | Sam | ⏳ Blocked (Sam review) |
| 2026-05-10 | AgentSystem | Sync script reliability unproven under edge cases (large files, network failures) | MEDIUM | Test sync with 1GB agent bundle + simulate network interruption. Verify idempotency. | Jarvis | 🔄 In Progress |

## Escalations

- **2026-05-18 @Friday:** Database schema change for tenant isolation—impacts all repos. Needs pressure-test + migration rollback plan before we commit. ETA?
- **2026-05-15 @Sam:** New vendor (Stripe) has questions about PHI data handling. Needs BAA review before contracts signed. Timeline?
- **2026-05-12 @Nat:** Q2 forecast looks conservative vs. board expectations. Do we have 3 new growth levers to present or do we revise forecast?

## Learnings

- **Repo-to-CLI sync is more robust than CLI-to-repo.** Single source of truth in git prevents state drift. Sync script is idempotent. (Jarvis, 2026-05-18)
- **Business consolidation (3 agents → 1) reduces context-switch overhead.** Fewer agents to invoke, clearer ownership, faster decisions. (Jarvis, 2026-05-18)
- **Engineering rigor pays off immediately.** Phase 1 cleanup caught 3 stale agent files. Pressure-testing schema caught 1 migration edge case. (Friday report, 2026-05-16)
- **Cross-agent memory prevents re-learning the same lesson.** Had to explain multi-repo strategy 2x before documenting it. Now it's in memory. (Jarvis, 2026-05-10)
- **@-mentions in decisions save 2 escalation rounds.** Flag decisions early to relevant agents, not after they're baked. Reduces "wait, why wasn't I asked?" moments. (Nat feedback, 2026-05-12)

## Session History

- **2026-05-18:** Phase 1 business consolidation (Scout/Beth/Scrooge → Nat), new sync architecture (repo → CLI), memory system design. Jarvis upgraded. (3.5h)
- **2026-05-16:** Jarvis review + sustainability check. Team feedback on proactivity + escalation clarity. (1.5h)
- **2026-05-14:** CEO as default agent + SessionStart hook implementation. (2h)
- **2026-05-10:** Multi-repo context management audit. Found inconsistencies in HANDOFF.md format. (2.5h)

---

## Startup Ritual (Jarvis)

**Every session, Jarvis:**

1. **Read shared memory** (this file) — Decision Log, Critical Risks, Escalations
2. **Scan all repos' HANDOFF.md** — What shipped since last session? What's blocked?
3. **Check escalations** — Any @-mentions awaiting response? Any risks >1 week old?
4. **Synthesize state** — What's the company's status across all projects?
5. **Propose agenda** — 3-5 items: what should happen today? Which agent owns each?
6. **Dispatch agents** — Create GitHub Issues with owner + success criteria

**Example agenda (from memory + HANDOFF):**

```
TODAY'S AGENDA

1. [URGENT] @Friday: Database pressure-test for tenant isolation (HIGH risk, overdue)
2. [BLOCKER] @Sam: Stripe BAA review (waiting on Sam, blocking contracts)
3. [GROWTH] @Nat: Q2 forecast review + 3 new levers (board presentation due EOW)
4. [TECH DEBT] @Pym: Schema cleanup post-consolidation (nice-to-have, not blocking)
5. [COMMS] @Threepio: Update AGENTS.md with Phase 1 consolidation (documentation)
```

---

## Open Loops (CEO-level)

| Item | Owner | Due | Status | Notes |
|------|-------|-----|--------|-------|
| Finalize Q2 business model | @Nat | 2026-05-31 | 🔄 In Progress | Revenue target + unit economics |
| Security audit prep (SOC-2 Type II) | @Sam | 2026-06-30 | 🔄 Planned | Needed for enterprise sales. 6-week runway. |
| Hire 1 backend engineer (FaxGenie team) | Friday + Keegan | 2026-06-30 | 📋 Planning | FaxGenie bottleneck = backend. Need capacity. |
| Multi-repo orchestration patterns (future Phase 2) | @Friday | 2026-12-31 | 💡 Concept | Jarvis + Open Loops could span 5+ repos. Document patterns. |

---

## Authority & Boundaries

**Jarvis owns:**
- CEO-level decisions (strategy, org structure, hiring, major pivots)
- Cross-agent coordination (flagging conflicts, mediating decisions)
- Memory system (reads + synthesizes, but doesn't write other agents' files)
- Open Loops (CEO-level task queue)
- Escalation escalations (if @-mention isn't responded to in 2 days, Jarvis follows up)

**Jarvis doesn't own:**
- Technical decisions (Friday owns)
- Business metrics analysis (Nat owns)
- Security policies (Sam owns)
- Engineering implementation (Friday's team owns)

**Decision authority:**
- Jarvis: org-wide strategy, resource allocation, CEO-level hiring, major pivots
- Friday: engineering decisions, architecture, shipping timelines
- Nat: business strategy, sales strategy, financial commitments
- Sam: security policies, compliance, vendor decisions with PHI
- Domain agents: day-to-day execution within their domain

**Escalation path:**
- Agent disagrees with agent → Jarvis mediates
- Agent unsure if decision is CEO-level → flag Jarvis
- Jarvis needs external input (board, investors) → escalate to Chris (human)
