# Agent Decision Review Cadence

**Last Updated:** 2026-05-21  
**Owner:** Jarvis (CEO)

Structured review schedule for agent decisions, system health, and performance trends.

---

## Review Schedule

### Weekly — Friday Metrics Pulse (Every Friday, async)
**Who:** Friday (CTO)  
**Duration:** 30 min  
**Output:** Weekly report posted to `.agents/memory/friday.md`  
**Covers:**
- Decision volume, escalation %, reversal %
- Execution time p50/p95
- CI health, sync success rate
- Any metric outside target — flag and assign owner

**Calendar:** No meeting; Friday posts report each Friday end-of-week.

---

### Monthly — Friday CTO Review (1st Monday of each month, 2h)
**Who:** Friday (CTO)  
**Duration:** 2h  
**Output:** Monthly summary appended to `.agents/memory/friday.md`  
**Schedule:** First occurrence: 2026-06-01  
**Covers:**
- Last month's escalations and reversals (review decisions, check patterns)
- Engineering backlog velocity
- Architecture health (debt, scaling concerns)
- Test coverage trends
- Deployment incident rate
- Cross-agent technical coordination review
- Subdomain agent performance (Ultron, Astra, Pym, Leo)

**Success criteria for healthy system:**
- Escalation % < 15%
- Reversal % < 5%
- p50 execution time < 2h
- Zero security incidents
- Sync success rate > 99%

---

### Sam — Every Main Merge (Hard Gate, on-demand)
**Who:** Sam (CSO)  
**Trigger:** Every PR targeting `main`  
**SLA:** 8h from PR open to review  
**Output:** Approval or blocking comment on PR  
**Covers:** Security audit per Sam's domain  
**Override:** Only Jarvis with written justification — never bypassed silently.

---

### Quarterly — System Deep Review (1st week of Jan/Apr/Jul/Oct, 4h)
**Who:** Jarvis (CEO), Friday (CTO), Sam (CSO), Nat (CBO)  
**Duration:** 4h  
**Schedule:** 2026-07-01 (next occurrence after system launch)  
**Output:** Quarterly review findings doc in `.agents/memory/` with timestamp  
**Covers:** See QUARTERLY-REVIEW.md for full checklist  

---

## Decision Log

All decisions are logged in `.agents/memory/<agent>.md` with date and tags.  
Index of recent decisions: [.agents/AGENTS-MEMORY.md](.agents/AGENTS-MEMORY.md)

---

## Calendar Invites

**Monthly CTO Review:** Recurring first Monday of each month, 2h block.  
Email template for invite:
```
Subject: Monthly CTO Review — [Month YYYY]

Agenda:
1. Last month metrics (escalations, reversals, p50/p95)
2. Architecture health check
3. Test coverage and CI status
4. Next month engineering priorities

Attendees: Friday (CTO)
Output: Monthly summary in .agents/memory/friday.md
```

**Quarterly System Review:** See QUARTERLY-REVIEW.md for invite template.

---

## Success Criteria by Role

| Role | "Healthy System" Looks Like |
|---|---|
| Friday (CTO) | Escalation < 15%, no security incidents, p50 < 2h, sync > 99% |
| Sam (CSO) | Zero security incidents post-merge, all main merges reviewed |
| Nat (CBO) | Business decisions made within 24h SLA, no customer-impacting bugs |
| Jarvis (CEO) | All agents active, no agent stale >3 days, metrics trending toward targets |
| Wanda | Design decisions not reversed due to technical oversight |
