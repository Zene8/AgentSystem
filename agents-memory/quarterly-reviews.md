# Quarterly Review Cadence

**Version:** 3.0 (Security monthly + quarterly, Engineering quarterly, Business quarterly)

---

## Review Schedule

### Security (Sam)

- **Monthly:** Policy updates, vendor BAA status, access audit
  - Time: ~2 hours
  - Artifacts: Monthly checklist (policy changes, new vendors, access changes)
  - Escalation: Any HIGH risks or new vendors without BAA → flag Jarvis

- **Quarterly (Jan/Apr/Jul/Oct):** Deep dive review
  - Time: ~4 hours
  - Scope: Threat landscape, compliance roadmap, SOC-2 progress, FedRAMP readiness, audit findings
  - Output: Quarterly security report (threats + mitigations + roadmap)
  - Approval: Sam → Jarvis

### Engineering (Friday)

- **Quarterly (Feb/May/Aug/Nov):** Execution + architecture review
  - Time: ~3 hours per project
  - Scope per repo: Schema health, test coverage trends, performance baselines, infrastructure debt, tech risk register
  - Cross-repo: Architecture alignment, dependency chains, scaling readiness
  - Output: Quarterly engineering report (health + risks + roadmap)
  - Approval: Friday → Jarvis

### Business (Nat)

- **Quarterly (Mar/Jun/Sep/Dec):** GTM + financial review
  - Time: ~3 hours
  - Scope: Revenue vs target, pipeline health, unit economics, market positioning, competitive landscape, GTM execution
  - Output: Quarterly business report (metrics + market position + strategy adjustments)
  - Approval: Nat → Jarvis

### CEO (Jarvis)

- **Monthly:** Risk synthesis (first Monday of month, post all other reviews)
  - Reads: Sam's monthly, Friday's latest Decision Log, Nat's pipeline
  - Output: Monthly risk summary (HIGH items, escalation decisions)

- **Quarterly:** Org health review (week after all quarterly reviews due)
  - Reads: Security deep dive, Engineering report, Business report
  - Scope: Org structure health, process execution, agent autonomy calibration, cross-repo visibility, resource allocation
  - Output: Quarterly CEO review (org health + strategic adjustments)
  - Approval: Jarvis → Human (for major pivots/budget decisions)

---

## Monthly Security Review (Sam)

**When:** First Friday of every month
**Duration:** ~2 hours
**Artifact:** Add entry to agents-memory/sam.md "Monthly Reviews" section

```markdown
### Monthly Review — [Month] [Year]

**Date:** [ISO date]
**Reviewed by:** Sam
**Status:** Complete

#### Policy Changes
- [Policy update if any]

#### Vendors
- New: [vendor name] (BAA: [status])
- Updated: [vendor] (contract change: [what changed])

#### Access Audit
- New accounts provisioned: [count]
- Removed: [count]
- Anomalies: [if any]

#### Risks Surfaced
- [HIGH/MEDIUM/LOW: description] (mitigation: [if exists])

#### Escalations to Jarvis
- [if any]
```

---

## Quarterly Security Review (Sam)

**When:** Last week of Jan/Apr/Jul/Oct
**Duration:** ~4 hours
**Artifact:** New file agents-memory/security/[quarter]-[year].md OR append to agents-memory/sam.md "Quarterly Reviews" section

```markdown
## Quarterly Security Review — Q[N] [Year]

**Date:** [ISO date]
**Reviewed by:** Sam
**Approved by:** Jarvis [date]

### Threat Landscape
- New threat categories identified: [list]
- Escalation in [threat category]: [context]
- Mitigation actions: [list]

### Compliance Roadmap
- **Target:** [SOC-2/FedRAMP/HIPAA/other]
- **Status:** [% complete]
- **Blockers:** [if any]
- **Timeline:** [adjusted if needed]

### SOC-2 Progress
- Auditor: [firm name]
- Last audit: [date]
- Findings: [count] (resolved: [count], open: [count])
- Next audit: [target date]

### Vendor Security
- New vendors evaluated: [count]
- BAAs signed: [count]
- Pending: [if any]

### Critical Findings
- [HIGH/MEDIUM findings from this quarter]

### Recommendations for Next Quarter
- [list]
```

---

## Quarterly Engineering Review (Friday)

**When:** Last week of Feb/May/Aug/Nov
**Duration:** ~3 hours per project (consolidated if single-repo)
**Artifact:** New file agents-memory/engineering/[quarter]-[year].md OR append to agents-memory/friday.md "Quarterly Reviews" section

```markdown
## Quarterly Engineering Review — Q[N] [Year]

**Date:** [ISO date]
**Reviewed by:** Friday
**Approved by:** Jarvis [date]

### Per-Repo Health

#### [Repo Name]
- **Schema Health:** [description: normalized, indexes optimized, query plans reviewed]
- **Test Coverage:** [%] (target: [%], trend: ↑/↓/→)
- **Performance Baselines:** [list key metrics vs baseline]
- **Infrastructure Debt:** [list items, severity]

### Cross-Repo Architecture
- **Alignment:** [any misalignment between repos]
- **Dependency Chains:** [any critical cross-repo dependencies at risk]
- **Scaling Readiness:** [QPS capacity, growth runway at current trajectory]

### Technical Risks
- [HIGH/MEDIUM items from tech risk register]

### 11 Principles Compliance
- **Pressure-testing discipline:** [assessment]
- **Manual deploy incidents:** [count YTD, zero target]
- **Test coverage on releases:** [% of PRs with tests]
- **Regression test adoption:** [% of bug fixes with regression test]

### Recommendations for Next Quarter
- [list with effort estimates]

### Escalations
- [if any agent dependencies or conflicts]
```

---

## Quarterly Business Review (Nat)

**When:** Last week of Mar/Jun/Sep/Dec
**Duration:** ~3 hours
**Artifact:** New file agents-memory/business/[quarter]-[year].md OR append to agents-memory/nat.md "Quarterly Reviews" section

```markdown
## Quarterly Business Review — Q[N] [Year]

**Date:** [ISO date]
**Reviewed by:** Nat
**Approved by:** Jarvis [date]

### Financial Metrics
- **Revenue:** $[amount] (target: $[amount], YoY: %)
- **Pipeline:** $[amount] (stage breakdown if multi-stage)
- **Unit Economics:** CAC $[x], LTV $[y], payback [months]
- **Burn/Growth:** [status]

### Pipeline Health
- **Stage distribution:** [% in discovery, proposal, negotiation, contract, closed]
- **Velocity:** [deals closed this quarter] (trend: ↑/↓/→)
- **Stalled deals:** [count, context if >expected]

### Market Position
- **Competitive landscape changes:** [new entrants, incumbent moves]
- **Market share estimate:** [if known]
- **Customer sentiment:** [positive/mixed/concerning, sources]

### GTM Execution
- **Campaign [name]:** [results vs plan]
- **Sales team:** [headcount, retention, productivity]
- **Sales process:** [changes made this quarter]

### Customer Health
- **NPS:** [score, trend]
- **Churn:** [% this quarter, trend]
- **Growth accounts:** [count, expansion revenue]

### Strategic Adjustments
- [if any changes to positioning, pricing, target segment]

### Recommendations for Next Quarter
- [list with lead times]

### Escalations
- [if any blocker or resource need]
```

---

## Quarterly CEO Review (Jarvis)

**When:** Week after all quarterly reviews due
**Duration:** ~2 hours
**Artifact:** Append to agents-memory/jarvis.md "Quarterly Reviews" section

```markdown
## Quarterly CEO Review — Q[N] [Year]

**Date:** [ISO date]
**Reviewed by:** Jarvis
**Synthesis of:** Sam's security review, Friday's engineering review, Nat's business review

### Org Health
- **Agent autonomy calibration:** [assessment: are agents making decisions at right level, or escalating too much/too little]
- **Process execution:** [how well did startup ritual, monthly risk review work]
- **Cross-repo visibility:** [anything missed by current scanning approach]
- **Memory currency:** [are Decision Logs staying current]

### Strategic Alignment
- [Do security roadmap, engineering roadmap, business roadmap align toward shared goals]
- [Any pivot needed based on market, threat landscape, or engineering constraints]

### Resource Allocation
- [Do agent roles, team distribution support next quarter's commitments]
- [Hiring/reallocation needs]

### Major Decisions This Quarter
- [log any CEO decisions made, impact]

### Open Loops
- [any unresolved escalations or decisions hanging]

### Escalations to Human
- [HIGH risks, budget >threshold, hiring decisions, board items]

### Recommendations for Next Quarter
- [list with owners + timelines]
```

---

## Approval Log

**Location:** agents-memory/MEMORY.md "Approval Log" section

Track who approved what, when:

```markdown
## Approval Log

### Security Reviews Approved
- Q1 2026: [date approved by Jarvis]
- Q2 2026: [date approved by Jarvis]

### Engineering Reviews Approved
- Q1 2026: [date approved by Jarvis]
- Q2 2026: [date approved by Jarvis]

### Business Reviews Approved
- Q1 2026: [date approved by Jarvis]
- Q2 2026: [date approved by Jarvis]

### CEO Strategic Reviews (Escalated to Human)
- Q1 2026: [date, decision, human who approved]
- Q2 2026: [date, decision, human who approved]
```

---

## Key Principles

1. **Quarterly = Zoom Out.** Not status updates. Trend analysis, strategic questions, resource needs.
2. **Monthly = Zoom In.** Policy changes, compliance audits, risk identification.
3. **Approvals chain:** Agent writes → Jarvis reads/approves → human approves if escalation.
4. **No surprises.** Reviews are synthesis of Decision Log + memory. No new information should appear in reviews.
5. **Actionable outputs.** Each review should surface 2-3 recommendations for next quarter.

