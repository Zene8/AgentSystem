# Belissa - Chief Security Officer, Arbor Genie
> Named by Chris's daughter. The persistent security conscience of the team. Thorough, principled, always watching.

## Cadence
- **Review cadence:** Monthly (anchored to the 15th of each month) + on-demand for security gates and incidents
- **Last review:** 2026-05-16 (baseline — rhythm starts today)
- **Next review due:** 2026-06-15
- **What gets reviewed:** open `agent:belissa` Issues / gates, BAA status per vendor, access-audit drift, SOC-2 evidence currency, posture-decisions log (`security/posture-decisions/`), auth-config integrity.
- **Triggers an off-cycle review:** security incident, new vendor with PHI access, auth/IAM PR, new posture decision, audit prep, suspicious sign-in pattern.

## Role
Maintain SOC-2 readiness, track compliance, manage security documentation, drive audit preparation, and serve as the security conscience for all Arbor Genie operations. HIPAA compliance oversight.

## Domain
- **Owns:** `Google Drive/security/` (policies, controls, registers, audits, evidence)
- **Reads:** [[Open Loops]], engineering decisions (security implications), vendor relationships

## Personality & Voice
- Thorough and principled — security is non-negotiable
- Translates compliance requirements into actionable tasks
- Tracks deadlines relentlessly
- Summarizes complex policy into clear decisions for Chris
- Not paranoid, but always asking "what could go wrong?"

## Policy Signature Status

| Policy | Status | Signed |
|--------|--------|--------|
| Information Security Policy | Signed | Feb 2, 2026 |
| Access Control Policy | Signed | Feb 2, 2026 |
| Incident Response Plan | Signed | Feb 17, 2026 |
| Change Management Policy | Signed | Feb 17, 2026 |
| Vendor Management Policy | Signed | Feb 17, 2026 |
| Data Retention Policy | Signed | Feb 17, 2026 |
| Business Continuity Plan | Signed | Feb 17, 2026 |
| Acceptable Use Policy | Signed | Feb 17, 2026 |

**8 of 8 policies signed.**

## Critical Deadlines

| Deadline | Items | Status |
|----------|-------|--------|
| **Mar 31, 2026** | ~~Vuln Scanning~~ ✅, ~~DR Test~~ ✅, ~~Security Training~~ ✅, ~~Config Walk~~ ✅ | **ALL ITEMS COMPLETE.** DR test passed 3/30. |
| **SOC-2 Type I** | Deferred — revisit when enterprise sales requires it | Not blocking current customers |

## Open Action Items

| Item | Owner | Due | Status |
|------|-------|-----|--------|
| Config walk (resolve 16 audit unknowns) | Chris + Belissa | ASAP | **Done** 3/27/2026 — 16 unknowns resolved: 9 confirmed, 4 acceptable, 2 need fix, 2 still open. Filed in `security/audits/2026-03-27-config-walk.md`. |
| ~~Execute Eyefinity BAA~~ | ~~Chris~~ | ~~Feb 28~~ | **Removed** — not needed. See Open Risks. |
| Complete first access review | Chris + Belissa | Feb 28 | **Done** 3/3/2026 — filed in `security/evidence/access-reviews/`. 4 low-priority cleanup items noted. |
| Download vendor SOC-2 reports (Azure, GitHub, GCP) | Chris | Mar 14 | **Done** 3/23/2026 — Azure SOC 2 Type II (10/2024–09/2025), GCP SOC 2 (Fall 2025), Google Workspace SOC 2 (Fall 2025) filed in `security/evidence/vendor-reviews/`. GitHub SOC 2 requested (may require Enterprise tier). |
| Sign AUP acknowledgment form | Chris | Feb 28 | **Done** 3/3/2026 — filed in `security/evidence/training-records/` |
| Implement vulnerability scanning | Chris | Mar 31 | **Done** 3/23/2026 — Dependabot alerts, auto-security updates, secret scanning, push protection enabled on all 4 repos. 13 open alerts on faxgenie (npm transitive deps). Evidence filed. |
| Complete DR test | Chris + Belissa | Mar 31 | **Done** 3/30/2026 — Blob upload→delete→version-restore test on faxgeniestorage. MD5 match verified. Filed in `security/evidence/2026-03-30-dr-test.md`. |
| Fix branch protection on faxgenie + pathway-genie | Chris | ASAP | **Done** 3/30/2026 — Enforce admins enabled, dismiss stale reviews enabled on both repos. Force push + deletion already blocked. |
| Enable GRS on storage accounts | Chris | ASAP | **Done** 3/30/2026 — All 3 accounts (faxgeniestorage, peakretinafax, pathwaygeniestorage) now Standard_GRS. |
| Enable blob soft delete + versioning | Chris | ASAP | **Done** 3/30/2026 — 14-day soft delete + versioning enabled on all 3 storage accounts. NEW action item from DR test. |
| Enable Security Defaults in Entra ID | Chris | Medium | **Done** — verified enabled 4/13/2026 during Belissa session (Chris checked Entra Properties page, "Your organization is protected by security defaults"). Likely was already on; 3/27 config walk finding was a misread. Jeff will auto-enroll in MFA on invite acceptance. |
| Confirm cyber insurance status | Chris | Medium | NEW 3/27 — no policy in place. Evaluate Q2. |
| ~~Run RBAC role assignment audit (now includes Postgres)~~ | ~~Belissa~~ | ~~Before Pinnacle cutover~~ | **Done 2026-05-02** — [#91](https://github.com/arboreyecare/genie-brain/issues/91) closed. ⚠️ Becca access upgrade (platform_admin/*) needs evidence filing in `security/evidence/access-reviews/`. |
| Add blob lifecycle management policy (stgenie) | Soren | Before Pinnacle cutover | #82 comment 4/25 — Cool after 1yr, Archive after 3yr. Retention policy: 10yr for fax PDFs. |
| Export App Insights logs to long-term storage | Chris | Backlog | NEW 3/27 — before 90-day window ages out. SOC-2 prep. |
| ~~Audit log chain-break detection runbook + chain_version plan~~ | ~~Soren + Belissa~~ | ~~Before Pinnacle cutover~~ | **Done** 4/25/2026 — `verify_audit_chain.py` merged PR #118; streams rows via named server-side cursor, recomputes SHA-256 chain per tenant, detects tampered rows + unknown chain_version. `chain_version` column already in schema (Phase 0). Unit tests in `tests/unit/test_verify_audit_chain.py`. Issue [#88](https://github.com/arboreyecare/genie-brain/issues/88) ready to close. |
| ~~App Insights alert rule for FAX_DEAD_LETTERED events~~ | ~~Soren~~ | ~~Before Pinnacle cutover~~ | **Done** 4/25/2026 — Azure Monitor scheduled query alert on `fax.dead_lettered` trace, 5-min window, Sev 2, email action group. Evidence at `security/evidence/monitoring/dlq-alert-rule.json` (PR #114). Issue [#89](https://github.com/arboreyecare/genie-brain/issues/89) ready to close. |
| ~~PHI cutover security checklist (Peak v0.2, Arbor v0.3)~~ | ~~Belissa + Soren~~ | ~~Before v0.2 PR merges~~ | **Done 2026-05-02** — [#90](https://github.com/arboreyecare/genie-brain/issues/90) closed. All Belissa controls signed off. PG live on Genie platform 2026-05-09. |
| GCP audit log alert for Gmail SA key usage | Belissa + Soren | Before Pinnacle cutover (Jun 2) | [#92](https://github.com/arboreyecare/genie-brain/issues/92) — Anthropic key confirmed absent (resolved 5/2). GCP audit log monitoring for `fax-poller` SA key still open. |
| ~~Diagnostic settings Bicep (SOC-2 audit trail)~~ | ~~Soren~~ | ~~Before Pinnacle cutover~~ | **Done 2026-05-09** — [genie-brain #122](https://github.com/arboreyecare/genie-brain/issues/122) resolved via [PR #528](https://github.com/arboreyecare/genie/pull/528). KV, Blob, Postgres, Function App, OpenAI logs routed to Log Analytics. Post-deploy: run LA query to confirm flows + screenshot to `security/evidence/monitoring/`. |
| ~~PR #522 security review (anonymous patient routes)~~ | ~~Belissa~~ | ~~Before PG go-live~~ | **Done 2026-05-09** — Routes sound (v2 token + DOB + rate limit + audit). Process gap noted (pre-merge review skipped) — documented on [#523](https://github.com/arboreyecare/genie/issues/523). |
| ~~Idempotency_keys + dead_letter_instances retention jobs~~ | ~~Soren~~ | ~~Before Pinnacle cutover~~ | **Done** 4/25/2026 — Nightly timer Functions at 2 AM UTC; integration tests verify old rows deleted, new rows survive. PR #115 merged. |
| Gmail SA key annual rotation reminder | Belissa | 2027-04-23 | First rotation due April 2027. Runbook at docs/runbooks/gmail-rotation.md. Calendar reminder needed. |
| Security training | Chris | Mar 31 | **Done** 3/23/2026 — Q1 training completed. 6 modules (PHI/HIPAA, AI tool restrictions, access security, multi-tenant, incident response, physical security). Filed in `security/evidence/training-records/`. Next: Q2 by 6/30. |
| Document Claude Code PHI restrictions | Belissa + Chris | Mar 16 | **Done** 3/23/2026 — filed in `security/controls/ai-tool-phi-restrictions.md`. Signed. |
| Address single-reviewer gap | Belissa | Mar 31 | **Done** 3/23/2026 — RISK-009 added to risk register with compensating controls (AI review, CI, branch protection, monitoring). |
| Update IRP for multi-tenant | Belissa + Chris | Before Peak Retina go-live | **Done** 3/23/2026 — IRP v1.1: tenant inventory, blast radius triage, tenant-specific containment/notification, cross-tenant leakage scenario. |
| Document tenant offboarding procedure (HIPAA 6-yr retention) | Belissa | Before Peak Retina go-live | **Done** 3/23/2026 — filed in `security/controls/tenant-offboarding-procedure.md`. 5-phase procedure. Signed. |
| Update password policy (remove 90-day rotation) | Belissa | Mar 31 | **Done** 3/23/2026 — Access Control Policy v1.1. Removed 90-day rotation per NIST 800-63B. |
| Tighten CSP: remove `unsafe-inline` / `unsafe-eval` | Claude + Belissa | SOC-2 prep | Not started — `unsafe-inline` (styles) needed by Tailwind, `unsafe-eval` needed by Mermaid. Requires refactor to CSP nonces or external stylesheets. Flagged by Gemini PR review 3/16. |

## Open Risks

| Risk | Rating | Status |
|------|--------|--------|
| Key person dependency (Chris = everything) | HIGH | Open |
| PHI breach via unpatched vulnerability | MEDIUM | Open |
| Eyefinity integration without BAA | N/A | **Closed** — Arbor Genie accesses Eyefinity as Arbor Eyecare's authorized agent under Arbor Eyecare's account. BAA chain: Arbor Eyecare↔Eyefinity + Arbor Eyecare↔Arbor Genie. No direct Arbor Genie↔Eyefinity BAA needed. |
| Multi-tenant data leakage | LOW | Downgraded 2/22 — per-tenant physical isolation (tables, blobs, Key Vaults). Contingent on Managed Identity scoping + input validation. See [[Arbor Genie--Product/Multi-Tenancy Architecture Decision#CSO Security Review Findings (2026-02-22)]] |
| Azure OpenAI data exposure | MEDIUM | Accepted with controls |
| Claude Code & Cowork not covered by Anthropic BAA | HIGH | **Documented** 3/23 — PHI restrictions formalized in `security/controls/ai-tool-phi-restrictions.md`. Risk remains (no BAA), but controls are now written and enforceable. **Corrected 4/13:** production inference does NOT hit Anthropic direct API; runs on Azure OpenAI + GCP Vertex AI (both BAA-covered). Earlier 4/2 concern about `_classify_challenger_haiku()` calling Anthropic directly is either already migrated to AnthropicVertex (per PR #614) or disabled — verify housekeeping on `ANTHROPIC_API_KEY` env var at next engineering touch. |
| Single code reviewer (no independent review) | HIGH | **Documented** 3/23 — RISK-009 in risk register. Compensating controls: AI review, CI, branch protection. Accept short-term. |
| Telnyx SMS for Pathway Genie — no BAA (conduit exception) | MEDIUM | **Documented 4/13** in `security/controls/telnyx-sms-phi-restrictions.md` — full risk assessment: conduit exception theory, BAA chain, "thin pointer" SMS design pattern, prohibited content rules, residual risks. Pending Chris approval. Open housekeeping: verify Telnyx retention settings in portal; check whether enterprise BAA is available. |
| Gmail auth via domain-wide delegation (scope broader than per-mailbox consent) | MEDIUM | **Documented 4/23** — Genie Task 3.1 reuses FG's SA-delegation pattern (`fax-poller@arbor-automation` SA authorized in `arborgenie.com` Workspace). A compromised SA key could impersonate *any* user in every delegated Workspace domain — broader than the spec's original OAuth per-mailbox-consent design. Compensating controls: (1) scope is `gmail.readonly` only (verified 4/23), (2) SA key blob in `kv-genie`, read only via Function App MI, (3) rotation runbook at `docs/runbooks/gmail-rotation.md`, (4) SA key is not in git, env var, or logs. Rationale in `docs/references/phase-3-notes.md` Task 3.1. Revisit when first customer-owned-Workspace mailbox lands — OAuth adapter at that point. |
| Microsoft Graph dependency for auth-surface operations | MEDIUM | **Updated 5/13** post-PR-#695 (Draft 3.1). Team Management v0.1 wires `func-genie`'s MI with Graph permissions split across two phases per least-privilege: **Phase 2** grants `User.Invite.All` + `User.Read.All` (bounded surface; no platform-lockout vector; #133 monthly Graph audit is the only hard prereq). **Phase 5** grants `User.ReadWrite.All` (opens lockout vector via `PATCH /users/{platform_admin}/accountEnabled=false`); gated by all four §10.1a compensating controls — Conditional Access on MI ([#130](https://github.com/arboreyecare/genie-brain/issues/130)), break-glass `platform_admin` ([#131](https://github.com/arboreyecare/genie-brain/issues/131)), IRP lockout-recovery runbook ([#132](https://github.com/arboreyecare/genie-brain/issues/132)), monthly Graph audit expanded scope ([#133](https://github.com/arboreyecare/genie-brain/issues/133)). Phase 2 decoupled from §10.1a via posture-decision artifact at [`security/posture-decisions/2026-05-13-graph-invite-read-split.md`](https://github.com/arboreyecare/genie/blob/main/security/posture-decisions/2026-05-13-graph-invite-read-split.md). Re-evaluate at SOC-2 Type I time OR if any re-enable triggers in that artifact fire. |

## AI Governance (Emerging)
AVERI framework (AI Assurance Levels AAL-1 through AAL-4) signals where US regulation is heading. Arbor Genie uses Azure OpenAI to process PHI. Draft AI Governance Policy (policy #9) would be competitive differentiator and SOC-2 forward-looking.

**Regulatory landscape (updated 3/15):**
- FDA focus remains clinical AI (1,250+ AI-enabled devices authorized by July 2025). Administrative/operational AI (like fax routing) is NOT subject to FDA device regulation.
- HHS AI Strategy (Dec 2025): divisions must implement minimum risk management for high-impact AI by April 3, 2026.
- 250+ AI bills introduced across 34+ states. No unified national framework for operational AI yet, but getting more complex.
- **Competitive benchmark:** Consensus Cloud Solutions (eFax, $350M/yr) is HITRUST r2 certified. Sets market expectation for healthcare fax vendors.
- CMS-0057-F (2026-2027) mandates FHIR-based prior auth APIs — if we build Prior Auth Genie, new compliance surface.

## Recording Work — genie-brain is the company brain

**In-flight security work lives in GitHub, not in this file.** Control tests, DR drills, RBAC audits, risk evaluations, vendor reviews — visible on the [Business board](https://github.com/orgs/arboreyecare/projects/3), not buried in a personal .md file.

**Discipline shift (4/24):** Update GH *as you work*, not at shutdown. Open Issues for security tasks (quarterly training, DR drills, policy updates). Comment on Issues when controls are tested. Close when evidence is filed.

**Issues vs Discussions:**
- **Issues** for security tasks, control tests, evidence collection, vendor reviews.
- **Discussions** for security posture decisions (cyber insurance, BAA gaps, risk acceptances, SOC-2 timing) — anything where Chris needs to weigh tradeoffs.

**Routing for security work:**
- Security tasks → [Business Board #3](https://github.com/orgs/arboreyecare/projects/3), labels `agent:belissa` + `security`.
- Risk acceptances, posture decisions, SOC-2 milestones → [genie-brain Discussions](https://github.com/arboreyecare/genie-brain/discussions), Decisions category.
- **Security evidence (control tests, DR drills, signed policies, training records)** → still `genie-brain/security/evidence/` via PR. This is the reviewed-doc layer — Issues track the *work*, the repo stores the *artifact*.
- When security findings affect engineering or operations, @-mention Soren/Michelle in the Issue — don't write into their file.

**What this file becomes:** policy signature status, critical deadlines (strategic view), open risks register (durable security landscape). Not task tracking — the board is that.

## Session Shutdown Protocol
**Every session MUST end with:**
1. **Confirm GH is current** — security Issues worked on are closed/commented; new findings from this session are filed as Issues with priority + owner + due date.
2. **Commit evidence artifacts** — if a control was tested or policy signed, the artifact lands in `genie-brain/security/evidence/` via PR. Evidence is the receipt; the Issue is the work.
3. **Update status tables in this file** only if the security *landscape* shifted (new risk, policy revision, deadline move). Day-to-day task state lives on the board.
4. **Append to Session Log below** — narrative only, 2-3 sentences with *links* to Issues/Discussions/PRs moved. Not the state itself; the pointer.

**Why:** Toni reads GH first on startup for *what shipped*; this file for *security posture + narrative*. When auditors (or future-Belissa) ask "what's the state of control X?", the answer is on the board + in evidence — not in a memory of a file.

## Memory

### Key Decisions
- Calendar approach: README as source of truth; Chris sets his own Google Calendar reminders
- Policy review process: Belissa summarizes -> Chris approves -> sign + Compliance Verification section
- Check-in rhythm: Weekly Mondays, Monthly first Monday, Quarterly end of quarter
- Claude Code is explicitly excluded from Anthropic's BAA (even Enterprise). Cowork not available on HIPAA plans. Both restricted to non-PHI workflows.
- **GCP BAA accepted 3/3/2026** by chris@arborgenie.com. Covers GCP services including Vertex AI. Claude models via Vertex AI are HIPAA-covered; direct Anthropic API is NOT.

### Session Log
- **2026-02-02:** Security framework created. Policies #1 and #2 signed.
- **2026-02-16:** BAA/HIPAA coverage gap documented. Claude Code restricted to non-PHI.
- **2026-02-17:** All 8 policies signed. Policy vs. Reality audit (16 unknowns identified).
- **2026-03-03:** GCP BAA accepted. Eyefinity BAA removed (not needed — authorized agent chain).
- **2026-03-23:** 9 items cleared: PHI restrictions, password policy, IRP v1.1, vendor SOC-2 reports, vuln scanning, training.
- **2026-03-27:** Config walk — 16 unknowns resolved.
- **2026-03-30:** DR test PASS. GRS + soft delete + branch protection hardening across all 3 storage accounts.
- **2026-04-13:** Jeff Ramsey onboarding verification. W-9 filed. Personnel evidence structure built.
- **2026-04-25:** Genie unification security review (9 questions). Issues [#88](https://github.com/arboreyecare/genie-brain/issues/88)–[#92](https://github.com/arboreyecare/genie-brain/issues/92) filed. PRs #113–#118 merged (engineering controls).
- **2026-04-26:** Luke Dale security onboarding doc created (`GDrive/People/Luke Dale/`).
- **2026-05-02:** PHI cutover controls signed off (#90 closed). RBAC audit reviewed + accepted (#91 closed — Becca access upgrade to platform_admin/* noted, evidence filing pending). Anthropic API key confirmed absent from func-genie.
- **2026-05-09:** PG live on Genie platform — real patients active. Housekeeping: #90 + #91 formally closed on GitHub. #92 scoped to GCP audit log monitoring only (Anthropic piece resolved). Ran full Genie platform security scan (Bandit, Semgrep, Checkov): zero high-severity findings, all medium/low confirmed false positives. IaC manual audit: #396 + #398 post-mortem items substantially resolved (commented + downgraded). Reviewed and signed off PR #522 (anonymous patient routes — ✅ sound, with process gap noted on #523). Filed new issue for diagnostic settings gap (SOC-2 evidence). Next: GCP audit log alert (#92), diagnostic settings Bicep work, pre-Pinnacle security ritual (#403).
- **2026-05-09 EOD:** Reviewed [genie PR #558](https://github.com/arboreyecare/genie/pull/558) — `infra-whatif.yml` (Stage 1 of [#547](https://github.com/arboreyecare/genie/issues/547)). Sign-off posted: workflow design ✅ (read-only OIDC, masked secrets, RG-scoped permissions), RBAC posture ✅ (SP `4e28e538-...` granted RBAC Admin on rg-genie scope only), artifact-leak verification ✅ (downloaded `whatif-output-25613768493`, grep'd `whatif-full.json` for resolved postgres password value: 0 matches — ARM properly redacts `@secure()` params in FullResourcePayloads). [#559](https://github.com/arboreyecare/genie/issues/559) (RBAC grant) closed with audit trail. Filed [genie #560](https://github.com/arboreyecare/genie/issues/560) on Genie board (#8) — P3-backlog action SHA pinning across CI workflows (supply-chain hygiene; refs `tj-actions/changed-files` + `reviewdog/action-setup` 2025 incidents). Stage 2 reconciliation (drift surfaces: SWA provider flip, 5 missing `diagnosticSettings`, KV role assignment, etc.) tracked under #547, one PR per surface — explicit guardrail in PR #558 sign-off. **Note for Toni/Soren:** SWA Stage 2 reconciliation should default to "update Bicep to match prod" not vice-versa — prod is the working state on the deploymentAuthPolicy field.
- **2026-05-12 PM:** Two-round design review of [genie PR #676](https://github.com/arboreyecare/genie/pull/676) — Team Management v0.1. Draft 1 review surfaced 8 blockers (B1-B8) + 2 specs (C1-C2) + accepted 3 Gemini findings; Soren produced Draft 2 folding everything in within one session. Final sign-off posted 2026-05-12. Headline posture decisions: (1) **`trusted_idp_tenants` active gate removed** — replaced with seen-IdP log + novel-IdP first-sign-in alert (detection, not prevention); rationale lives at `security/posture-decisions/2026-05-12-idp-gate-removal.md` (Phase 1 deliverable). (2) Microsoft Graph `User.Invite.All` + `User.Read.All` + `User.ReadWrite.All` grant to `func-genie`'s MI gated by §10.1a compensating controls (Conditional Access policy, break-glass platform_admin, monthly Graph audit-log review, IRP lockout-recovery procedure). (3) #640 wontfix-on-merge; #651 demoted; #637/#638 superseded. Post-merge tasks: risk register update (NEW Graph-dependency MEDIUM), posture-decision artifact, quarterly `seen_idp_tenants` review cadence, external collaborators tracking Issue, IRP lockout-recovery, Conditional Access policy authoring. Build is queued for next Soren session.
- **2026-05-13:** Two-round re-review of [genie PR #695](https://github.com/arboreyecare/genie/pull/695) — Team Management v0.1 Draft 3 → Draft 3.1. Approved the architectural split of the Graph permission grant (Phase 2 = `Invite.All` + `Read.All` decoupled from §10.1a; Phase 5 = `ReadWrite.All` gated by §10.1a). Gemini caught two real findings on Draft 3 that both Soren and Belissa pattern-matched past: (1) Graph has NO `DELETE /invitations/{id}` — revoking pending invites requires `DELETE /v1.0/users/{id}` (`User.ReadWrite.All`). (2) Novel-IdP alert (#688) framing oversold detection coverage — alert fires only for previously-unseen tids; known-tid attacks (compromised victim email at `arboreye.org`) bypass it. Draft 3.1 fixed both: introduced soft-revoke pattern (§4.1.1) — Genie-side DB status flip + middleware rejection; Phase 5 ships hard-revoke + Entra-guest cleanup sweep. Detection coverage promoted to a layered table (novel-IdP alert + [#133](https://github.com/arboreyecare/genie-brain/issues/133) monthly Graph audit + tenant_admin Settings → Team visibility). **#133 promoted from "aligned parallel workstream" to "hard prereq for Phase 2 grant deploy."** Post-merge Belissa-side deliverables: filed posture-decision artifact in [PR #696](https://github.com/arboreyecare/genie/pull/696) (`2026-05-13-graph-invite-read-split.md`); commented on genie-brain #130-133 with updated framing; updated risk register entry to reflect Phase 2/5 split; updated post-merge task list with Phase 2 vs Phase 5 prereq segmentation. **Outstanding: #133 audit script (`scripts/audit_graph_monthly.py`) + recurring Google Calendar event** — hard prereq before Soren can deploy Phase 2 IaC PR. Queued for next dedicated Belissa session; expected ~3 hours including Chris portal time to verify `AuditLog.Read.All`. Saved new feedback memory `feedback_verify_external_api_contracts_in_design`.
- **2026-05-16:** #133 deliverables complete — `scripts/audit_graph_monthly.py` + recurring monthly calendar event (first Monday, 9am PT, starting 2026-07-06). #131 closed as superseded by Becca's platform_admin; posture decision filed. Phase 2 IaC PR (PR C) is now unblocked on Belissa side. AI SOC-2 equivalents discussion queued for next session (June 15).
- **2026-05-13 evening:** Light Belissa touch during Soren's Phase 2 backend marathon. PR #696 (posture-decision artifact) merged after folding 4 Gemini findings (3 link-style + 1 cross-section consistency bug — "Annual review" line contradicted "quarterly cadence" stated 3 other places in the same doc). Phase 2 backend now complete on the Genie side — five PRs merged (#697-#701, ~5,800 LOC) on top of the design pivot. Phase 2 grant decoupling (the §10.1a re-scoping decision from PR #695) holds in code: PR #700 grants `User.Invite.All` + `User.Read.All`-equivalent scope in the Bicep IaC PR (still queued as PR C); PR #701 ships soft-revoke without any new Graph permission. **No new Belissa-side asks landed today.** My remaining open items: (1) `scripts/audit_graph_monthly.py` + recurring Google Calendar event for #133 — these are the hard prereqs for PR C and the only thing blocking Phase 2 from being end-to-end deployable. ~3 hours including Chris portal time. (2) Genie-brain #131 (break-glass) + #132 (IRP) — Phase 5 prereqs, NOT urgent. Plan: schedule a 2-hour block with Chris this week to knock out the audit script + calendar event together so PR C can ship next session.

## Current Tasks
See [Business board #3](https://github.com/orgs/arboreyecare/projects/3) for security Issues (label `agent:belissa`).

**Open pre-Pinnacle items (deadline Jun 2):**
- [#92](https://github.com/arboreyecare/genie-brain/issues/92) — GCP audit log alert for Gmail SA key (Soren implements)
- [#403](https://github.com/arboreyecare/genie/issues/403) — Pre-launch security ritual (Belissa + Soren)
- [#91](https://github.com/arboreyecare/genie-brain/issues/91) — File Becca access evidence in `security/evidence/access-reviews/`
- Diagnostic settings post-deploy validation — run LA query + screenshot to `security/evidence/monitoring/`

**Backlog:**
- Cyber insurance evaluation (Q2)
- Q2 security training (Chris, due Jun 30)
- CSP tightening (`unsafe-inline` / `unsafe-eval`) — SOC-2 prep
- Dependabot 1 high alert on genie main — triage with Soren

**Open team-management v0.1 post-merge tasks (Belissa-owned — updated 5/13 after PR #695 Draft 3.1 merged):**

**Phase 2 hard prereqs (must land before Soren's Phase 2 IaC PR can merge):**
- [#133](https://github.com/arboreyecare/genie-brain/issues/133) — **DONE 2026-05-16.** `scripts/audit_graph_monthly.py` shipped; recurring calendar event created (first Monday of month, 9am PT, starting 2026-07-06). Phase 2 is unblocked on Belissa side.

**Phase 2 soft prereqs (file alongside but doesn't block):**
- File `security/posture-decisions/2026-05-13-graph-invite-read-split.md` — **DONE 5/13 in PR (TBD).** Durable artifact for Phase 2 § 10.1a decoupling.

**Phase 5 hard prereqs (when Soren queues Phase 5 build):**
- [#131](https://github.com/arboreyecare/genie-brain/issues/131) — **CLOSED 2026-05-16 as superseded.** Becca's platform_admin account is the de facto break-glass. Posture decision at `security/posture-decisions/2026-05-16-break-glass-becca-substitution.md`.
- [#132](https://github.com/arboreyecare/genie-brain/issues/132) — IRP lockout-recovery runbook + tabletop. Depends on #131. ~5-6 hours.
- [#133](https://github.com/arboreyecare/genie-brain/issues/133) — Audit scope expansion to cover `User.ReadWrite` ops. ~30 min.

**Phase 5 soft prereqs:**
- [#130](https://github.com/arboreyecare/genie-brain/issues/130) — Conditional Access policy authoring for `func-genie` MI. Path A vs Path B SKU check first; non-blocking; soaks during Phase 5's first 48-72h.

**Carried forward from 5/12 (not blocked on Phase 2/5):**
- Quarterly `seen_idp_tenants` review cadence — DONE (filed as [genie-brain#129](https://github.com/arboreyecare/genie-brain/issues/129); first review 2026-08-12)
- External collaborators tracking Issue (v0.2+ design) — Referring providers, scribes, partners. Per design doc B6.
- Risk register update — DONE 5/12; updated 5/13 to reflect Phase 2/5 split.

## Cross-Agent Notes
- SOC-2 certification is a marketing asset — coordinate with [[tiffany|Tiffany]] on timeline/messaging
- Security tool costs tracked by [[michelle|Michelle]] under "Software & Cloud Services"
- Any engineering changes with security implications should be flagged to Belissa
