# Agent Decision Index

**Last Updated:** 2026-05-21  
**Maintained by:** Jarvis (updated weekly as part of startup ritual)

Quick-lookup table of each agent's most recent decision, current memory state, and key context for future invocations.

---

## Index Table

| Agent Name | Last Decision | Date | Key Context | Memory File |
|---|---|---|---|---|
| Jarvis | AD-10 system documentation unification complete | 2026-05-21 | CEO/orchestrator. All sessions start here. 8-step startup checklist. | [.agents/memory/jarvis.md](.agents/memory/jarvis.md) |
| Friday | Architecture & engineering standards enforced | 2026-05-21 | CTO. Hard gate: Sam must approve all main merges. Monthly review 2026-06-20. | [.agents/memory/friday.md](.agents/memory/friday.md) |
| Sam | Security audit gating all main merges | 2026-05-21 | CSO. Hard gate owner. Never bypassed without Jarvis written approval. | [.agents/memory/sam.md](.agents/memory/sam.md) |
| Nat | Business strategy, revenue, customer health | 2026-05-21 | CBO. Quarterly review participant. Escalations → Jarvis. | [.agents/memory/nat.md](.agents/memory/nat.md) |
| Ultron | Backend API / service / database / deployment | 2026-05-21 | Conflicts → Friday. Domain: backend services. | _(no memory file yet)_ |
| Astra | Frontend / component / UX / performance | 2026-05-21 | Design questions → Wanda. Conflicts → Friday. | _(no memory file yet)_ |
| Pym | Database schema / migrations / queries | 2026-05-21 | Conflicts → Friday. Domain: data layer. | _(no memory file yet)_ |
| Leo | DevOps / CI-CD / infrastructure / observability | 2026-05-21 | Conflicts → Friday. Domain: infra. | _(no memory file yet)_ |
| Wanda | Design / component design / design system | 2026-05-21 | Technical issues → Friday. Quarterly review participant. | _(no memory file yet)_ |
| Threepio | Docs / README / handoffs / PR descriptions | 2026-05-21 | Documentation agent. No escalation path — routes to domain expert. | _(no memory file yet)_ |
| general-coding | General coding tasks not matching a domain | 2026-05-21 | Fallback agent when no domain match. | _(no memory file yet)_ |

---

## Update Instructions (Jarvis Weekly Ritual)

1. After each significant session, update the relevant row with:
   - `Last Decision`: one-line summary of the most impactful decision made
   - `Date`: ISO date of that decision (YYYY-MM-DD)
   - `Key Context`: one-line note relevant to next invocation

2. If a new memory file is created for an agent, update the `Memory File` link.

3. Sort by last active date descending when reviewing — stale agents (>3 days no update) trigger step 5 of startup checklist.

---

## Full Decision Logs

Full session logs and decision history for each agent are stored in `.agents/memory/<agent>.md`.  
Template for new agents: [.agents/memory/TEMPLATE.md](.agents/memory/TEMPLATE.md)
