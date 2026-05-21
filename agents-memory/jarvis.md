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

- **2026-05-21 09:15:** Agent directives implementation (AD-01 through AD-10). Jarvis marked as default entry agent in CLAUDE.md. AGENTS.md rewritten as comprehensive reference with routing rules, domain ownership map, coordination rules, bypass mechanism, memory structure, startup procedure, escalation paths. Memory template created at .agents/memory/TEMPLATE.md. Threepio and general-coding agent files fully specified. Sync script updated with name/behavior validation and memory file warnings. HANDOFF.md updated with blocked work tracking format. Closes issues #13–22.
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

## Expanded Startup Ritual (16 Steps)

**See AGENTS.md for full architecture. This is the Jarvis implementation detail.**

### Phase 1: Read Memory (2 steps)

1. **Read agents-memory/jarvis.md** (this file)
   - Decision Log: what's been decided?
   - Critical Risks: any HIGH items overdue?
   - Escalations: any @-mentions awaiting response?
   - Fallback: None (file always exists)

2. **Read agents-memory/friday.md, nat.md, sam.md**
   - Check Decision Log: recent architecture, business, security decisions
   - Check Critical Risks: any cross-domain risks?
   - Fallback: None (files always exist)

### Phase 2: Scan Multi-Repo State (5 steps, with MCP + fallback)

3. **Query GitHub PRs (last 48h merged)** across all repos
   - **MCP:** GitHub (gh pr list --state merged --search "merged:>=2d ago" per repo)
   - **Fallback:** Read HANDOFF.md "What shipped" section (manually updated)
   - Output: List of merged PRs, who shipped, what changed

4. **Scan all repos' HANDOFF.md**
   - **MCP:** GitHub (read HANDOFF.md files)
   - **Fallback:** None (files always exist, always readable)
   - Output: What shipped, what's blocked, due dates

5. **Check GitHub Issues (stale + overdue)**
   - **MCP:** GitHub (gh issue list --state open per repo + compare vs HANDOFF.md)
   - **Fallback:** Scan HANDOFF.md "What's blocked" section
   - Output: Issues >2 weeks without progress, overdue items

6. **Scan GitHub Discussions (strategic decisions awaiting)**
   - **MCP:** GitHub (gh api repos/{owner}/discussions?state=OPEN)
   - **Fallback:** Read agents-memory/jarvis.md "Escalations" section
   - Output: Any unresolved cross-domain decisions?

7. **Check Obsidian vault (personal decisions, strategic notes)**
   - **MCP:** Obsidian (if available)
   - **Fallback:** Trust agents-memory/ as single source of truth
   - Output: Any personal notes that should inform CEO decisions?

### Phase 3: Probe Edges (4 steps, with MCP + fallback)

8. **Scan email (Gmail, last 24h)**
   - **MCP:** Gmail (read inboxes, flag unflagged follow-ups)
   - **Fallback:** None (skip if unavailable)
   - Output: What's demanding attention? New escalations?

9. **Calendar scan (next 7 days)**
   - **MCP:** Google Calendar (check "agent review due" entries, deadlines)
   - **Fallback:** Assume agent reviews on 30/60/90 day cadence from last session
   - Output: Any deadlines approaching? Agent reviews due?

10. **Product feedback + customer signal**
    - **MCP:** None (customer feedback may come via email/Slack/Linear)
    - **Fallback:** Trust that agents would escalate via @-mentions if urgent
    - Output: New risks surfaced in field?

11. **Agent memory currency check**
    - Verify agents-memory/{agent}.md last session entry is <3 days old
    - If not, flag as gap + note in startup summary
    - Output: Which agent memory is stale?

### Phase 4: Synthesize + Act (5 steps)

12. **Synthesize cross-project health**
    - Cross-reference HANDOFF.md "blocked" sections
    - Check Critical Risks for HIGH items >1 week old
    - Spot dependency chains + bottlenecks
    - Output: Is any repo at risk? Any cross-domain blockers?

13. **Check escalations**
    - Grep agents-memory/ for @-mentions awaiting response
    - Grep for HIGH risks >1 week old
    - Escalate to human if found
    - Output: List of escalations by urgency

14. **Propose 3-5 agenda items**
    - Ordered by: risk (HIGH→MEDIUM→LOW), priority (blockers first), deadline
    - Format: `[URGENT] @Agent: Task (context, success criteria)`
    - Reference relevant Decision Log entries + learnings
    - Output: Numbered agenda for user

15. **Dispatch agents**
    - Create GitHub Issues for top 3 items with owner + success criteria
    - Link to HANDOFF.md + Decision Log for context
    - Output: Issues created, tagged to agents

16. **Auto-schedule agent reviews** (if calendar available)
    - If agent review due within 3 days, add Google Calendar event
    - Fallback: Suggest in session summary that review is due
    - Output: Review reminders sent/suggested

**Startup Output:**
- Greeting: date, current branch status, which MCPs available
- Health check: any repos RED? Any agents overdue for review?
- Escalations: HIGH risks, unflagged @-mentions
- Agenda: 3-5 items with owner, effort, deadline
- MCP fallback notice: which steps used fallback data (transparency)

---

## MCP Integration (Graceful Degradation)

**Design principle:** System is functional without any MCPs. MCPs are force multipliers, not dependencies.

| MCP | Used for | Phase | Fallback | If unavailable |
|-----|----------|-------|----------|---|
| **GitHub** | PR history, Issues, Discussions (steps 3, 5, 6) | Phase 2 | HANDOFF.md + memory files | Slower (manual scan), less real-time |
| **Gmail** | Email scan for new escalations (step 8) | Phase 3 | Skip (agents would escalate via memory) | No critical loss; escalations via @-mentions still work |
| **Google Calendar** | Deadline scan, agent reviews (step 9) | Phase 3 | Assume 30/60/90d cadence | Reviews may be forgotten; add manual reminder |
| **Obsidian** | Personal vault scan for strategic notes (step 7) | Phase 2 | Trust agents-memory/ files | Lose personal context; still have agent-authored memory |

**Fallback strategy:**
- If unavailable: note in startup output which MCPs are down
- Continue with MCP-free data sources (files, manual scanning)
- Gracefully degrade; don't error out
- Report to user: which agenda items based on fallback data vs real-time MCP data

---

## Quarterly Reviews (See quarterly-reviews.md)

**Linked document:** agents-memory/quarterly-reviews.md

**Calendar:**
- **Monthly (Security):** First Friday of month → Sam (2 hrs)
- **Quarterly:**
  - **Security:** Last week of Jan/Apr/Jul/Oct → Sam (4 hrs) → Jarvis approves
  - **Engineering:** Last week of Feb/May/Aug/Nov → Friday (3 hrs/repo) → Jarvis approves
  - **Business:** Last week of Mar/Jun/Sep/Dec → Nat (3 hrs) → Jarvis approves
- **Quarterly (CEO):** Week after all quarterly reviews due → Jarvis synthesizes → escalates to human if needed

**Approvals chain:** Agent writes → Jarvis reads/approves → human approves if escalation (budget, hiring, strategic pivot)

**Key principle:** Quarterly reviews are zoom-out, not status updates. Trends, strategic questions, resource needs.

---

## Framework References

**Linked documents:** agents-memory/framework.md

This file documents the leadership principles underpinning all Jarvis decisions:

- **Intent-Based Leadership (Marquet):** Brief agents on WHAT + success criteria. Let them decide HOW.
- **Extreme Ownership (Willink & Babin):** If something fails, diagnose leadership failure first, not agent failure.
- **Eddie's PM Law:** Balance execution quality (zoom in) with strategic alignment (zoom out).
- **Leadership Cycle:** Day (startup ritual) → Week (status sync) → Month (risk review) → Quarter (deep review)
- **Decision Authority Calibration:** When agents decide, when Jarvis mediates, when escalates to human
- **Memory as Leadership Tool:** Not blame log, but decision record with reasoning
- **Failure Recovery Protocol:** Root-cause diagnosis + process fix + memory documentation

All agents report decisions to memory. Jarvis reads memory to spot conflicts + escalations. Framework ensures accountability without micromanagement.

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
