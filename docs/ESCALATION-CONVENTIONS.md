# Escalation Conventions and SLAs

**Last Updated:** 2026-05-21  
**Owner:** Jarvis (CEO) / Friday (CTO)

---

## Escalation Matrix

| Decision Type | Escalation Path | Owner | SLA | Channel |
|---|---|---|---|---|
| Architecture decision | Friday → Jarvis if stalled | Friday | 4h | GitHub Discussion |
| Security block (pre-merge) | Sam → Friday → Jarvis if >8h | Sam | 8h | GitHub PR comment + @sam |
| Backend conflict | Ultron → Friday | Friday | 4h | GitHub Issue @friday |
| Frontend conflict | Astra → Friday | Friday | 4h | GitHub Issue @friday |
| DB migration failure | Pym → Friday | Friday | 4h | GitHub Issue @friday |
| DevOps/CI-CD failure | Leo → Friday | Friday | 2h | GitHub Issue @friday |
| Design conflict | Wanda → Friday | Friday | 4h | GitHub Issue @friday |
| Business strategy conflict | Nat → Jarvis | Jarvis | 24h | GitHub Discussion @jarvis |
| Agent timeout / stall (>30min) | Any → Jarvis | Jarvis | 2h | GitHub Discussion @jarvis |
| Memory sync failure | Leo → Friday | Friday | 1h | GitHub Issue @friday |
| Security incident | Sam → Jarvis | Jarvis | 30 min | GitHub Discussion @jarvis + @sam |
| CEO-level decision | Jarvis → Nathan (human) | Nathan | 24h | Email / calendar |

---

## @-Mention Conventions

| Handle | Agent | When to Use |
|---|---|---|
| `@friday` | Friday (CTO) | Architecture calls, technical conflicts, engineering blockers |
| `@sam` | Sam (CSO) | Security review requests, pre-merge gates, compliance questions |
| `@jarvis` | Jarvis (CEO) | Escalations unresolved by domain agent, strategy pivots, agent conflicts |
| `@nat` | Nat (CBO) | Business/revenue/customer health questions |
| `@wanda` | Wanda (Design) | Design system questions, component design review |
| `@leo` | Leo (DevOps) | CI/CD failures, infrastructure changes |
| `@ultron` | Ultron (Backend) | Backend API/service questions |
| `@pym` | Pym (Database) | Schema, migration, query questions |
| `@astra` | Astra (Frontend) | UI/UX, component, frontend performance |
| `@threepio` | Threepio (Docs) | Documentation requests, PR descriptions, handoffs |

---

## Urgent Escalation Path

For blockers lasting **>30 minutes** that prevent work from proceeding:

1. Post in GitHub Discussions under category **"Agent Incidents"** with title format:  
   `[URGENT] [Agent] blocked on [issue] — [elapsed time]`
2. @-mention Jarvis + the blocking agent
3. If no response in 2h, Nathan (human) is the final escalation — email or calendar invite

---

## Response SLAs by Agent

| Agent | Role | SLA |
|---|---|---|
| Jarvis | CEO / Orchestrator | 2h |
| Friday | CTO | 4h |
| Sam | CSO / Security | 8h |
| Leo | DevOps | 2h |
| Ultron | Backend | 2h |
| Pym | Database | 4h |
| Astra | Frontend | 4h |
| Wanda | Design | 4h |
| Nat | Business | 24h |
| Threepio | Docs | 30 min |

---

## Escalation Post Template

Use this format when posting an escalation to GitHub Discussions or Issues:

```
**Escalation — [Decision Type]**

**Agent:** [Who is escalating]
**Blocking:** [What work is blocked]
**Elapsed Time:** [How long the block has existed]
**SLA Breach:** [Yes/No — state SLA]

**What was attempted:**
[Steps already tried]

**What is needed:**
[Specific decision or action needed to unblock]

**Impact if unresolved:**
[What fails or is delayed]

**Escalation path:** [Next owner per escalation matrix]
```
