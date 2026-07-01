# Jarvis Memory & Decision Log

**Last updated:** 2026-05-20  
**Owner:** Nathan (human)  
**Memory maintained by:** Jarvis (CEO agent)

---

## Critical Decisions (Q2 2026)

| Date | Decision | Rationale | Status |
|------|----------|-----------|--------|
| 2026-05-20 | Add weekly cadence (Saturday review) | Chris's system reviews weekly; catch drift early | ✅ Implementing |
| 2026-05-20 | Promote Wanda/Threepio to Sonnet 4.6 | Design + comms tier work needs better reasoning | ✅ Approved |
| 2026-05-20 | Streamline startup: 16→8 steps | Batch GitHub queries, parallel MCP checks, skip redundant | ✅ Approved |
| 2026-05-20 | Unify memory system across 3 CLIs | All CLIs treat `.agents/memory/` as authoritative | ✅ Approved |

---

## Critical Risks (>1 week old)

None currently.

---

## Escalations Awaiting Resolution

None pending.

---

## Agent Review Schedule

| Agent | Cadence | Next Due | Last Review | Focus |
|-------|---------|----------|-------------|-------|
| Friday (CTO) | Monthly | 2026-06-20 | (init) | Architecture, engineering backlog, merge gate status |
| Nat (CBO) | Monthly | 2026-06-20 | (init) | Revenue, GTM, customer health |
| Sam (CSO) | Monthly | 2026-06-20 | (init) | Compliance, security incidents, vendor decisions |
| Wanda (Design) | Quarterly | 2026-07-15 | (init) | Design system health, accessibility, token coverage |
| Threepio (Comms) | Quarterly | 2026-07-15 | (init) | Doc coverage, release quality, cross-team comms |
| Ultron (Backend) | 6-week | 2026-07-01 | (init) | API stability, service health, deployment |
| Astra (Frontend) | 6-week | 2026-07-01 | (init) | Browser compat, Core Web Vitals, component stability |
| Pym (Database) | 6-week | 2026-07-01 | (init) | Schema health, migration readiness, perf |
| Leo (DevOps) | 6-week | 2026-07-01 | (init) | CI/CD reliability, infra drift, incident response |

---

## Session Log

- **2026-05-20 (init):** Comparison with Chris's system complete. Improvements approved by Nathan. Implementing: weekly cadence, model tier adjustments, startup optimization, memory unification.

### 2026-06-26 — Basely launch-readiness audit ("better than HackerRank?")
**Decision:** NOT launch-ready as a "superior HackerRank alternative." Conditional-GO as a focused scenario-assessment MVP after P0 fixes.
**Key findings:**
- Grading is FORKED: real Docker test-exec grading lives in apps/containerview/apps/api/src/grading/ (GradingService.runTests, language-aware, NetworkMode none + CapDrop ALL). Separate LLM grader at apps/basely/src/app/api/grade-sandbox/route.ts is ORPHANED (0 callers) and writes to InterviewSession (Int id) while real path writes Submission/TestResult (uuid). Two disconnected scoring systems = P0 architecture risk + non-deterministic LLM scores.
- scripts/validate-grading-accuracy.mjs is an empty stub (// test) — grading accuracy unproven. PR #325 claims validator.
- No hidden/visible test-case model (testCases = single Json blob). No custom question builder with hidden cases. ~7 languages parsed vs HackerRank 35+. ~15 scenario templates vs 2000+ library.
- Stripe billing is STRONG: signature verified, idempotent, all 4 lifecycle events, downgrade clears services. P0: checkLimit() ignores subscription.status (past_due/cancelled keep premium). Seat-revocation-on-downgrade + invoice.payment_succeeded land in unmerged PR #328.
- Email infra real (Resend, 9 templates incl assessment invite). E2E invite->take->score works.
- P0 gap: NO employer notification when candidate submits (no Inngest trigger, no Notification.create on completion).
- Missing vs HackerRank: video proctoring (none), plagiarism detection (none), live collaboration/pair-programming (none), ATS integrations (none), scheduled-interview meeting links + calendar/ICS + reminders (none). Anti-cheat partial (LockdownManager + ProctorLog tab/paste telemetry exists).
- Session replay (event-timeline, not video) built in unmerged PR #321/#300, absent on current branch.
**Action:** Returned prioritized P0-P3 ticket list to Friday. Repositioning recommended: "real-world scenario interviews + AI copilot" not "more questions than HackerRank."
