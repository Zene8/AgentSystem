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

### 2026-06-30 — Branch unification on main (r2d2)
**Decision:** Merged both open feature branches into main locally (user chose local merge over PR flow), pushed, deleted branches after merge confirmed.
**What landed:** PR #90 (session rename + memory onboarding tools, +671) + PR #89 (mission-control docs, +624), both auto-closed on merge. Branches `issue-rename-memory-onboard` + `issue-82-mission-control-docs` deleted local+origin. No stashes existed.
**Gate:** Sam pre-merge audit PASS (hard gate enforced despite user's local-merge choice). First audit process died mid-run — re-ran to completion. Tests 17/17.
**Non-blocker → follow-up:** Issue #92 filed — path.resolve() bounds check in resolveTranscript() (memory-onboard.js). Read-only traversal, gated by user-owned registry; hardening only.
**Not closed:** Epic #82 stays open (children #83–#88, #91 live). Posted progress comment.
**Guardrail win:** Refused literal "delete stale/merged branches" — both held ~1300 lines unmerged work. Merged first, deleted only after --merged confirmation.

---

## Session 2026-06-30 — genie dev cycle (Chris OOO prep, WS1/WS2)

**Context:** Chris (boss) OOO Europe 6/27–7/8, is merge gate. Batch of messages → 3 workstreams. Nathan priority: "we must get ws1 done." Goal per #2066: review-ready, don't merge (Chris triggers on 7/8).

**Landed (6 PRs, all hold for 7/8):**
- WS1 (engagement metrics): #2103 spec, #2109 FE (badge visibility + icon color + detail counts), #2110 backend (delivery audit — ✓3/4 = real async Telnyx webhook lag, NOT a bug). Issues #2102/2104/2105/2106.
- WS2 (observability): #2111 daily health email (#2067) — Sam APPROVED, PHI-gated, no Belissa gate; #2112 alerts (#2108) — Nathan added to action groups; #2113 Reports tab (#2107) — 4 eng + 6 clinical cards.
- Follow-ups: #2114 (Phase-3 custom metrics — #2108 clinical alerts silently never-fire until orchestrator emits them; #2107 already computes the values, reuse).
- Cleanup: 15 worktrees + 15 merged branches removed (audited each for dirty/unpushed/unmerged first; 1 locked held). Spike: psql-genie IS reachable from GH Actions via firewall add/remove.

**Corrections logged:** repo merges to `main` directly (not dev). Engagement-delivery-tracking + #2017 already MERGED (not in-flight as first thought).

**KEY OPERATIONAL LESSON — background agents die on session teardown.** This session's parent process exited repeatedly (/background + resumes); every Agent-tool background run (Friday ×4, r2d2, Leo) got killed mid-task. `claude --bg` daemon also died. **Mitigation that worked: mandate commit+push after EVERY logical step (empty-commit-first on branch create).** Committed work survives; Jarvis rescues partial state from disk + finishes the PR. WS1 FE + #2067 both landed this way despite crashes. For long agent work in unstable sessions: commit-first is non-negotiable.

**Concurrency guardrail:** honored memory rule (concurrent git-mutating agents corrupt shared genie checkout) — ran cleanup solo before dispatching WS2; ran #2108+#2107 in parallel only via `isolation: worktree`.

**Contradiction w/ prior memory:** "named agents fabricate (0-tool-call fake results)" did NOT reproduce — Friday/Leo/Sam/r2d2 all produced real verifiable commits + PRs tonight. That prior lesson may be stale.

**WS3 (pre-existing 2 open PRs, done after closeout on Nathan follow-up):** #2064 (feat #710 backend) was BEHIND → `gh pr update-branch` → up-to-date, checks green, review-ready (awaits Chris; he left non-blocking "chat mockup" comment). #1957 (feat #1919 relevance-ranked exemplars) was DIRTY draft → Friday rebased onto main (290-commit drift), 1 conflict in `pathway_author_context.py` resolved preserving the feature AND reconciling with #2027 operator_exemplar_kinds + workflow_kind/attachments; undrafted; gates pass local; CI running → CLEAN. Both hold for 7/8. Total session: 6 new PRs + 2 pre-existing PRs review-ready.

**Still on Nathan (non-eng):** log payroll hours (Chris needs for Thurs payroll), Q3 planning chat next week, standing-hours arrangement decision (Chris researching compliance).
