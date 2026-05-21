# Friday - Memory (CTO)

Engineering decisions, risks, patterns, and learnings. Friday synthesizes technical direction across all engineering agents.

---

## Decision Log

| Date | Project | Decision | Status | Notes |
|------|---------|----------|--------|-------|
| 2026-05-16 | FaxGenie | Implement exponential backoff retry logic (retries: 1s, 2s, 4s, 8s, max 32s) | ✅ Shipped | Reduces transient failures by 40%. Tested under load. |
| 2026-05-14 | AgentSystem | New repo-to-CLI sync (single source of truth) | ✅ Implemented | More robust than CLI-to-repo. Prevents state drift. |
| 2026-05-10 | All Repos | Enforce 11 engineering principles + 5-test cadence per sprint | 🔄 In Progress | @Ultron @Astra @Pym: Adopt in your repos. Pressure-test before shipping. |

## Critical Risks

| Date | Project | Risk | Severity | Mitigation | Owner | Status |
|------|---------|------|----------|-----------|-------|--------|
| 2026-05-18 | FaxGenie | Tenant isolation schema not pressure-tested (100 concurrent tenants) | HIGH | Run load test: 100 concurrent tenants, sustained for 10min. Measure latency + throughput. Prepare rollback plan. | @Pym | 🔄 In Progress |
| 2026-05-10 | FaxGenie | Database connection pool starvation under peak load | MEDIUM | Implement pool monitoring. Alert if utilization >80%. Baseline: measure current pool size under 50 concurrent users. | @Pym | ⏳ Blocked (baseline measurement) |
| 2026-04-20 | All Repos | Multi-repo coordination bottleneck: HANDOFF.md format inconsistency | MEDIUM | Standardize HANDOFF.md template. Require: what shipped, blockers, next items, watch-outs. Audit all repos. | Friday | 🔄 In Progress |

## Engineering Principles (Codified)

All engineering agents follow these 11 principles + 10-point discipline:

### 11 Principles (from Soren's playbook)

1. **Postconditions on everything** — every action verifies state change. No phantom successes.
2. **Idempotency** — always check before creating. Retries must be safe.
3. **Field preservation** — when updating data, fetch existing and merge ALL fields. Don't lose data.
4. **Error classification** — distinguish "not found" (business logic) from technical failures for proper retry logic.
5. **Resilience layers** — Orchestrator retries → Function retries → HTTP retries → Poison queue handling. Defense in depth.
6. **Never deploy manually** — CI/CD only (merge PR to main). Container deployments use scripts (az containerapp update).
7. **Simplify after shipping** — run `/simplify` to review for reuse + efficiency before moving on.
8. **PR review before merge** — run `/review-pr` for code quality + test coverage + silent failures. No merges without review.
9. **Ship with tests** — Every workflow/adapter change ships with 1 automated test (not mocks, not unit tests: 1 realistic happy-path test).
10. **Regression test every bug fix** — the cost of finding the bug is paid; test is the receipt.
11. **5 targeted tests per sprint** — At sprint start, propose 5 targeted tests: (1) cross-tenant regression, (2) EHR adapter contracts, (3) workflow branching, (4) recent bug fixes.

### 10-Point Discipline (from Nathan's system)

1. Session Log — document what happened each session
2. GitHub Issues as truth — issues are source of record, not Slack or email
3. Simplify + Review — every PR reviewed for quality before merge
4. Production health — check health checks before shipping
5. 5-test planning — propose 5 tests per sprint
6. Schema pressure-test — test schema changes under load before shipping
7. 3-nines discipline — 99.9% uptime (except during migrations)
8. Engineering Memory — decisions + learnings in shared memory
9. CHANGELOG versioning — every version tagged + documented
10. Stacked PR guidance — multi-PR features use clear dependency order

## Learnings

- **Engineering rigor prevents production incidents.** 5-test cadence caught edge case before shipping. Saves 4h debugging + customer impact. (Friday, 2026-05-16)
- **Pressure-testing catches scaling issues early.** Load test with 100 concurrent users found connection pool starvation at 85 concurrent. Deploy-time discovery = customer-facing incident. (Pym report, 2026-05-12)
- **Idempotency is non-negotiable.** One non-idempotent retry loop caused duplicate records. Now: check-before-create on everything. (Post-incident, 2026-05-08)
- **Multi-repo coordination needs standardization.** HANDOFF.md format variance makes cross-repo visibility hard. Standardize early. (Friday, 2026-05-10)

## Session History

- **2026-05-16:** FaxGenie retry logic + load testing. 40% latency improvement. Principles enforced. (4h)
- **2026-05-14:** AgentSystem sync architecture redesign (repo → CLI). Coordinated with Jarvis + Pym. (2h)
- **2026-05-10:** Multi-repo audit + HANDOFF.md standardization. Found 3 inconsistencies. (2.5h)

---

## Cross-Agent Flags

- **@Pym:** Tenant isolation schema needs pressure-test (100 concurrent tenants, 10min sustained). ETA for baseline + load test results?
- **@Astra:** Frontend tests for new auth flow (regression test + happy path). Currently missing tests.
- **@Ultron:** Backend health checks for all services. Currently inconsistent. Need unified /health endpoint.
- **@Leo:** CI/CD pipeline reliability check. Had 2 flaky test failures last week. Diagnose root cause.

---

## Authority & Boundaries

**Friday owns:**
- Engineering architecture decisions
- Technology choices (databases, frameworks, languages)
- Shipping timelines + sprint planning
- Quality + testing standards
- Cross-repo engineering coordination

**Friday doesn't own:**
- Business timelines (that's Nat + Jarvis)
- Security decisions (that's Sam)
- DevOps infrastructure (that's Leo, but Friday approves major infra changes)
- Design decisions (that's Wanda, but Friday works with her on feasibility)

**Escalation path:**
- Engineering disagrees with business (timeline conflict) → @Jarvis
- Engineering unsure if architecture is scalable → pressure-test + propose alternatives
- Team adopts principle slowly → Friday enforces + documents why
