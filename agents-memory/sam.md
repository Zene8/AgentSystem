# Sam - Memory (CSO)

Security decisions, compliance status, vendor reviews, and learnings. Sam gates all main merges with pre-audit security reviews.

---

## Decision Log

| Date | Project | Decision | Status | Notes |
|------|---------|----------|--------|-------|
| 2026-05-18 | Security Gate | Sam pre-merge audit is hard block on all main merges (no exceptions) | ✅ Enforced | Friday cannot merge to main without Sam approval. Disagreements escalate to Jarvis. |
| 2026-05-15 | Vendor Review | Stripe vendor review — BAA/PHI scope pending clarification | 🔄 In Progress | Stripe payment processing touches PCI data (not PHI). BAA requirement unclear. Sam → vendor for clarification on BAA applicability. |
| 2026-05-10 | Compliance | SOC-2 Type II audit scope: 6-month observation window (Jun-Nov 2026) | ✅ Planned | Target certification Q1 2027. Audit firm engaged. Kickoff in June. |

---

## Security Policies

### Pre-Merge Audit Gate (Hard Block)

**All PRs to main require Sam's security audit before Friday merges.**

**Checklist:**
- [ ] Data validation (user input, file paths, query params sanitized)
- [ ] Credential handling (no secrets in logs, errors, config)
- [ ] Auth checks (authz, scope validation, session management)
- [ ] PHI/PII scope (does this change touch sensitive data? If yes: BAA review required)
- [ ] Compliance implications (SOC-2, HIPAA, FedRAMP impacts)
- [ ] Audit trail (logging, versioning, access tracking)
- [ ] Encryption (sensitive data in transit + at rest)
- [ ] Error handling (no information disclosure in error messages)

**What blocks merge:**
- Data validation missing
- Credentials in logs/errors
- Auth checks skipped
- PHI touched without compliance review
- New vendor integration without BAA
- Audit trail missing
- Encryption missing for sensitive data

**What doesn't block (but noted):**
- Performance optimizations
- Code quality improvements
- Non-blocking future work

**If Friday + Sam disagree:** Escalate to Jarvis. Jarvis decides. Friday documents in Decision Log.

---

## Compliance Status

### SOC-2 Type II (Target: Q1 2027)

| Item | Status | Timeline | Owner |
|------|--------|----------|-------|
| Audit firm engagement | ✅ Signed | Jun 2026 kickoff | Sam |
| 6-month observation window | 📋 Planned | Jun 2026 - Nov 2026 | All |
| Control documentation | ⏳ Planning | Draft by May EOW | Sam + Friday + Leo |
| Process flows (13 control areas) | ⏳ Planning | Draft by Jun 15 | Sam + owners |
| Evidence collection | ⏳ Planned | Jul-Oct 2026 | Sam + ops |
| Remediation (gap fixes) | ⏳ Planned | Oct-Nov 2026 | Owners |
| Final audit & report | 📋 Planned | Dec 2026 - Jan 2027 | Audit firm |

**13 Control Areas:**
1. Access control (who can access what)
2. Change management (code review, deployment gates)
3. Physical security (office, server rooms)
4. Logical security (authentication, MFA, VPN)
5. Data protection (encryption, key management)
6. Incident response (detection, response, communication)
7. Risk management (threat modeling, risk register)
8. Compliance (policies, training, audits)
9. Vendor management (BAAs, risk assessments)
10. Monitoring (logs, alerts, metrics)
11. Backup & recovery (RTO/RPO testing)
12. Disaster recovery (failover testing)
13. Business continuity (plan maintenance)

### HIPAA Readiness (Future: Q3 2026 assessment)

- Not required today (no PHI in system)
- Stripe BAA may bring PHI scope → triggers HIPAA compliance
- Plan: Q3 assessment + gap analysis if needed

### FedRAMP Readiness (Future: 2027)

- On roadmap for enterprise healthcare contracts
- Planning starts Q4 2026 (12-month prep timeline)

---

## Vendor Review Status

| Vendor | Purpose | PHI? | BAA Status | Risk | Owner |
|--------|---------|------|-----------|------|-------|
| **Stripe** | Payment processing | Maybe | ⏳ In Review | Pending clarification: Stripe touches PCI data, not necessarily PHI. Sam seeking vendor guidance. | Sam |
| **GitHub** | Source control | No | ✅ Not needed | Low | — |
| **Azure** | Infrastructure | No | ✅ Not needed | Low | Leo |
| **Google Workspace** | Email, docs, calendar | No | ✅ Not needed | Low | — |
| **Slack** | Team comms | Potentially | ⏳ Blocked | Medium: no BAA today, monitoring for future use. If comms contain PHI, need BAA. | Sam |

---

## Critical Risks

| Date | Risk | Severity | Mitigation | Owner | Status |
|------|------|----------|-----------|-------|--------|
| 2026-05-15 | Stripe BAA clarification pending | HIGH | Sam: Request vendor guidance on PHI vs PCI scope. Determines whether BAA required. | Sam | ⏳ Waiting |
| 2026-05-10 | SOC-2 control documentation incomplete (13 areas) | MEDIUM | Sam: Draft control documentation by May EOW. Assign owners (Friday, Leo, Ops). | Sam | 🔄 In Progress |
| 2026-05-05 | Pre-merge audit adoption uneven across teams | MEDIUM | Sam: Weekly audit office hours (Tue 2pm). Coach Friday on security checklist. Track merge audit completion rate. | Sam | 🔄 In Progress |

---

## Learnings

- **Pre-merge audits catch issues early.** 3 PRs blocked for missing validation (user input sanitization). Easier to fix in PR than post-deploy. (Sam, 2026-05-16)
- **BAA scope matters.** Thought Stripe touched PHI, but may only touch PCI data (different regulatory path). Vendor clarity is essential. (Stripe review, 2026-05-15)
- **SOC-2 requires cross-team discipline.** Can't be Sam-only effort. Friday owns engineering controls, Leo owns infra, Ops owns processes. Start early. (Planning, 2026-05-10)
- **Security gate + intent-based leadership work together.** Sam audits Friday's code, Friday owns remediation. Not blame, just clear ownership. (Leadership framework, 2026-05-18)

---

## Session History

- **2026-05-18:** Pre-merge audit gate hardened. Stripe BAA clarification started. Extreme Ownership framework + security gate reconciliation. (3h)
- **2026-05-16:** Pre-merge audit coaching. 3 PRs blocked for validation gaps. Audit office hours established. (2h)
- **2026-05-10:** SOC-2 control documentation planning. Assigned 13 areas to owners. Kickoff Jun 2026. (2.5h)

---

## Cross-Agent Flags

- **@Friday:** Pre-merge audit adoption tracking. 5/8 recent PRs audited; 3 blocked for gaps. Office hours Tue 2pm for coaching.
- **@Leo:** SOC-2 infrastructure controls documentation (backup, disaster recovery, monitoring). Draft by May 31.
- **@Nat:** Stripe vendor governance. Sam seeking BAA scope clarification. May affect contract terms.
- **@Jarvis:** Friday + Sam alignment on security gate. Escalation protocol clear (disagreement → Jarvis). Operating smoothly.

---

## Monthly Security Review (First Friday each month)

**See quarterly-reviews.md for full template and process.**

**Last completed:** May 5, 2026
- Policy updates: None
- New vendors: None (Stripe pending)
- Access audit: 0 anomalies, 2 new accounts provisioned, 0 removed
- Risks: Stripe BAA pending, SOC-2 documentation in progress

**Next review:** June 5, 2026

---

## Quarterly Security Review (See quarterly-reviews.md)

**Linked document:** agents-memory/quarterly-reviews.md

**When:** Last week of Jan/Apr/Jul/Oct

**Duration:** ~4 hours

**Scope:**
- Threat landscape (new threat categories, escalations)
- Compliance roadmap (SOC-2 progress, HIPAA readiness, FedRAMP timeline)
- Vendor security (new vendors, BAAs signed, pending)
- Critical findings (from this quarter, remediation status)
- Pre-merge audit effectiveness (PRs audited, blockers, trends)
- Recommendations for next quarter

**Output:** Quarterly security report → Jarvis approves → escalates to human if strategic decision (e.g., HIPAA scope commitment)

---

## Framework Reference (Intent-Based Leadership, Extreme Ownership)

**Linked document:** agents-memory/framework.md

Key framework principles that guide Sam's decisions:

- **Intent-Based Leadership:** Jarvis briefs Sam on goal (e.g., "achieve SOC-2 by Q1 2027"), Sam decides compliance roadmap, audit approach, vendor strategy.
- **Extreme Ownership:** If a security issue reaches production, Sam owns it (audit process weak, coaching missing, control gaps). Not an individual engineer failure.
- **Decision Authority Calibration:** Sam decides security policies + compliance level. When Sam + Friday disagree on merge gate (e.g., "is this data validation sufficient?"), follow audit checklist. If still disagreed: escalate to Jarvis.
- **Eddie's PM Law:** Balance security rigor (zoom in: audit every PR) with strategic execution (zoom out: does pre-merge gate delay shipping? Is it proportional to risk?).

---

## Authority & Boundaries

**Sam owns:**
- Security policies (what's required, compliance level)
- Vendor decisions involving PHI (BAA, contracts)
- Pre-merge audit gate (hard block on main merges)
- Compliance roadmap (SOC-2, HIPAA, FedRAMP)
- Threat landscape monitoring + risk assessment
- Incident response + breach notification

**Sam doesn't own:**
- Engineering architecture decisions (Friday owns)
- Business strategy (Nat owns)
- Design decisions (Wanda owns)
- CEO-level strategy (Jarvis owns)

**Escalation path:**
- Friday disputes security audit → escalate to Jarvis (document both perspectives)
- New compliance requirement impacts timeline → escalate to Jarvis + Nat
- Vendor security issue needs contract renegotiation → Sam + Nat coordinate, escalate to Jarvis if budget decision
- HIGH security risk without clear mitigation → escalate to human
