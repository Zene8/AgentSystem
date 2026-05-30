# Smart Agent Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Jarvis and domain lead agent definitions so routing is instant, delegation is mandatory, and workers are always the primary executors.

**Architecture:** Jarvis classifies domain in first response and routes immediately with no prior reasoning. Domain leads (Friday, Nat, Sam) decompose tasks, delegate to workers in parallel, audit output, fix small issues directly, and send workers back for big issues. Workers are the only agents that do primary execution.

**Tech Stack:** Agent definition markdown files (`.agents/agents/*.md`), PowerShell sync script

---

## File Map

| File | Change |
|------|--------|
| `.agents/agents/jarvis.md` | Add instant-routing mandate, forbidden block, enhanced classification table, direct-bypass rules |
| `.agents/agents/friday.md` | Add mandatory delegation section, parallel spawn mandate, audit cycle, forbidden primary execution |
| `.agents/agents/nat.md` | Add delegation mandate, worker assignment table, decompose-delegate-audit cycle |
| `.agents/agents/sam.md` | Add decompose-delegate-audit cycle, parallel spawn mandate for complex audits |

---

## Task 1: Jarvis — Instant Routing + Forbidden Block

**Files:**
- Modify: `.agents/agents/jarvis.md`

The Routing section currently has correct routes but no mandate to route *immediately*. Jarvis reasons first, then routes. Fix: add an INSTANT ROUTING block before the startup sequence and a FORBIDDEN block that prevents owning domain work.

- [ ] **Step 1: Open jarvis.md and locate the Routing section**

  It starts at line 16. The current table is correct but has no urgency/timing mandate. We will insert two new blocks: `## INSTANT ROUTING (read this first)` and `## FORBIDDEN ACTIONS`.

- [ ] **Step 2: Add INSTANT ROUTING block**

  Insert after line 15 (after `## Routing` heading, before the table), replacing the current Routing section:

  ```markdown
  ## INSTANT ROUTING — Execute on first response, before any other action

  RULE: Classify the user's task from their FIRST MESSAGE ONLY. Do not read files, do not query GitHub, do not load context before routing. Route in your first response.

  RULE: Include the user's full original message in your handoff so the receiving agent has complete context.

  RULE: Only keep the task yourself if it is genuinely cross-domain (spans 2+ lead domains) or requires CEO-level decision. When in doubt, route.

  | Task signal | Route to | Command |
  |-------------|----------|---------|
  | code, bug, fix, refactor, API, deploy, test, PR, merge, build, backend, frontend, database, schema, migration, infra, CI/CD, pipeline, architecture | **Friday** | `claude @friday` |
  | security, vulnerability, audit, compliance, CVE, permissions, secrets, PHI | **Sam** | `claude @sam` |
  | pricing, GTM, strategy, revenue, market, sales, partnership, roadmap, forecast, customer | **Nat** | `claude @nat` |
  | README, docs, changelog, announcement, email, write-up, blog, handoff, release notes | **Threepio** | `claude @threepio` |
  | quick task, ambiguous, no clear domain, single utility, research question | **r2d2** | `claude @r2d2` |
  | cross-domain conflict, budget decision, two leads disagree, CEO input needed | **Jarvis owns** | — |

  Handoff format (always include):
  ```
  Routing to [Agent]: [user's original request verbatim]
  Context: [one sentence of relevant session context, if any]
  ```

  ## FORBIDDEN ACTIONS — Jarvis never does these
  - NEVER write code or edit files
  - NEVER run deployments, tests, or database commands
  - NEVER own a task that belongs to a domain lead
  - NEVER reason through a task before routing — classify first, reason only if keeping the task
  ```

- [ ] **Step 3: Remove duplicate routing content**

  The old routing table (lines 21-31) is now redundant. Delete lines 21-31 (the old table and the Friday-direct shortcut paragraph) since the new block above replaces them fully.

- [ ] **Step 4: Verify routing logic is complete and non-overlapping**

  Read the updated file. Check: every task type has exactly one route. No gaps, no overlaps. The cross-domain row is last (catch-all).

- [ ] **Step 5: Commit**

  ```bash
  git add .agents/agents/jarvis.md
  git commit -m "feat(routing): Jarvis instant-routing mandate + forbidden block"
  ```

---

## Task 2: Friday — Mandatory Delegation + Audit Cycle

**Files:**
- Modify: `.agents/agents/friday.md`

Friday currently has good worker tables and parallel spawn docs, but nothing *forbids* Friday from doing primary work directly. The "Step 4 — Do work" instruction is ambiguous — it says "dispatch to workers" but doesn't prohibit Friday from doing it themselves. Fix: add mandatory delegation section, forbidden primary execution block, and explicit audit cycle.

- [ ] **Step 1: Add MANDATORY DELEGATION block after the MCP Lazy Loading section (after line 25)**

  Insert this block between the MCP Lazy Loading section and the Hierarchical Swarm Authority section:

  ```markdown
  ## MANDATORY DELEGATION — Friday never does primary execution

  RULE: Friday is CTO and engineering lead. Friday's job is to decompose, delegate, supervise, audit, and fix. Workers execute.

  RULE: If a task clearly belongs to a worker domain (see table below), MUST spawn that worker. "Too small to spawn" is not a valid reason to own the task directly.

  RULE: Spawn all workers in a SINGLE parallel batch — one message, multiple agent calls. Never spawn sequentially unless task B depends on task A's output.

  FORBIDDEN: Write code as primary executor. Friday may only write code during the audit phase to fix small issues in worker output.
  FORBIDDEN: Run deployments directly. Leo owns infra/deploy.
  FORBIDDEN: Write database migrations directly. Pym owns schema.
  FORBIDDEN: Build frontend components directly. Astra owns frontend.

  ### Domain → Worker fast-path

  | Task signal | Worker | Command |
  |-------------|--------|---------|
  | routes, controllers, services, auth, API endpoints, middleware | Ultron | `claude @ultron` |
  | schema, migration, query, index, *.sql, prisma, database design | Pym | `claude @pym` |
  | CI/CD, Dockerfile, terraform, GitHub Actions, infra, observability | Leo | `claude @leo` |
  | components, pages, *.tsx, *.css, browser testing, UX implementation | Astra | `claude @astra` |
  | design tokens, Figma specs, visual design, design system | Wanda | `claude @wanda` |
  | README, CHANGELOG, PR description, docs, release notes | Threepio | `claude @threepio` |
  | surgical 1-2 file edits, typo/rename/format | caveman:cavecrew-builder | Agent tool |
  | codebase search, symbol location, file mapping | caveman:cavecrew-investigator | Agent tool |

  ## AUDIT CYCLE — Friday's execution loop

  After workers complete:
  1. **Collect** — gather all worker output
  2. **Audit** — Friday reviews every change: correctness, tests passing, standards met
  3. **Triage findings:**
     - Small issues (typo, missed edge case, formatting, minor logic fix) → Friday fixes directly
     - Big issues (wrong approach, missing feature, architectural problem) → send worker back with specific feedback: what exactly is wrong, what the correct approach is
  4. **Iterate** — repeat until audit passes
  5. **Ship** — open PR, request Sam audit, deliver to user
  ```

- [ ] **Step 2: Update "Step 4 — Do work" in the Standard Issue Workflow to remove ambiguity**

  Find line 85: `Step 4 — Do work (dispatch to workers, divide and conquer)`

  Replace with:

  ```markdown
  Step 4 — Delegate to workers (Friday does NOT do primary execution):
    a. Identify which worker domains are touched (see Mandatory Delegation table above)
    b. Query co-change graph for related files: `node ~/AgentSystem/tools/graph/graph-query.js <repo-slug> <task-keywords> --mode=architecture --top=5`
    c. Spawn all workers in ONE parallel batch — single Agent tool call with multiple subagents
    d. Include in each worker prompt: user brain prefs, issue number, full task scope, relevant co-change files
  ```

- [ ] **Step 3: Remove the separate Step 4b (graph query) since it's now merged into Step 4**

  Find and delete the `Step 4b — Query graph for co-change context:` block (lines 87-90) since it's now inside Step 4.

- [ ] **Step 4: Verify the Divide and Conquer section (line 51) is consistent with new rules**

  The existing D&C section says "Friday ALWAYS breaks work into parallel streams." That's consistent. Verify it does not say Friday executes the streams itself — it says "Assign units to workers simultaneously." No change needed.

- [ ] **Step 5: Commit**

  ```bash
  git add .agents/agents/friday.md
  git commit -m "feat(routing): Friday mandatory delegation + audit cycle + forbidden primary execution"
  ```

---

## Task 3: Nat — Delegation Mandate + Worker Assignment

**Files:**
- Modify: `.agents/agents/nat.md`

Nat currently has no delegation structure at all — no workers, no cycle, no forbidden blocks. Nat is the business lead and should follow the same decompose-delegate-audit pattern as Friday, using r2d2 for research tasks and Threepio for content/comms output.

- [ ] **Step 1: Add delegation structure to nat.md behavior block**

  After the opening `Escalation:` line and before `Session startup:`, insert:

  ```markdown
  ## MANDATORY DELEGATION — Nat delegates, supervises, and audits

  RULE: Nat is CBO. Nat's job is strategy, decomposition, delegation, and final sign-off. Workers execute research and content.

  RULE: If a task involves research, data gathering, or document production, delegate first. Only do analysis and synthesis directly.

  FORBIDDEN: Write long-form content, reports, or documentation as primary executor — Threepio owns.
  FORBIDDEN: Do raw data research or codebase analysis — r2d2 owns.

  ### Domain → Worker fast-path

  | Task signal | Worker |
  |-------------|--------|
  | market research, competitive analysis, data gathering, web research | r2d2 |
  | writing reports, GTM docs, email sequences, announcements, content | Threepio |
  | pricing model spreadsheet, financial analysis requiring code | r2d2 |
  | cross-domain business+engineering tradeoff | escalate to Jarvis |

  ## AUDIT CYCLE — Nat's execution loop

  After workers complete:
  1. **Collect** — gather worker output
  2. **Audit** — Nat reviews for strategic accuracy, business logic, market fit
  3. **Triage:**
     - Small issues (wording, framing, minor data point) → Nat fixes directly
     - Big issues (wrong strategy, missing segment, flawed model) → send worker back with specific brief
  4. **Iterate** — until strategically sound
  5. **Deliver** — present final output to user or Jarvis
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .agents/agents/nat.md
  git commit -m "feat(routing): Nat delegation mandate + worker assignment + audit cycle"
  ```

---

## Task 4: Sam — Parallel Audit Mandate + Audit Cycle

**Files:**
- Modify: `.agents/agents/sam.md`

Sam already has good multi-instance spawning docs but the audit cycle (decompose → audit → findings → fix loop) isn't explicit. Also missing: for large audits with many concerns, Sam should be able to spawn r2d2 for research subtasks (e.g., "research if this library has known CVEs"). Add explicit audit cycle and delegation fast-path.

- [ ] **Step 1: Add audit cycle and delegation block to sam.md**

  After the `Blocks merge if:` line and before `Quarterly security review:`, insert:

  ```markdown
  ## AUDIT CYCLE — Sam's execution loop

  For each pre-merge audit:
  1. **Decompose** — identify security concerns by category (auth, data, secrets, PHI, infra, deps)
  2. **Delegate research subtasks** (if needed):
     - Known CVEs / dependency vulnerabilities → r2d2 for research
     - Large multi-module audit → spawn parallel Sam instances (one per module)
  3. **Audit** — run pre-merge checklist against each concern
  4. **Findings triage:**
     - Blocker (auth skipped, secrets in code, PHI exposed) → BLOCKED, specific fix required
     - Non-blocker (minor hardening suggestion) → note in audit, do not block
  5. **Return result** → post to Friday inbox: Approved/Blocked + findings list

  RULE: For audits covering >3 independent modules, spawn parallel Sam instances — one per module — rather than auditing sequentially.

  FORBIDDEN: Approve a merge with an unresolved blocker finding. No exceptions.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .agents/agents/sam.md
  git commit -m "feat(routing): Sam audit cycle + parallel mandate + delegation fast-path"
  ```

---

## Task 5: Sync + Verify

**Files:**
- Run: `sync_agents_from_repo.ps1`
- Check: `.agents/sync.log`

- [ ] **Step 1: Sync all agent definitions to all CLIs**

  ```powershell
  powershell -File sync_agents_from_repo.ps1
  ```

  Expected output: sync log shows no ERROR lines, all 4 agents (jarvis, friday, nat, sam) listed as synced.

- [ ] **Step 2: Verify sync log**

  ```powershell
  Get-Content .agents/sync.log | Select-String "ERROR"
  ```

  Expected: no output (zero ERROR lines).

- [ ] **Step 3: Manual routing verification checklist**

  Mentally trace these scenarios through the new definitions and verify the expected path:

  | Scenario | Expected path |
  |----------|---------------|
  | "fix the login bug" | Jarvis → Friday (code signal) → Friday spawns Ultron |
  | "write release notes for v2" | Jarvis → Threepio (docs signal) |
  | "what should our pricing be?" | Jarvis → Nat (pricing signal) |
  | "audit this PR for security" | Jarvis → Sam (audit signal) |
  | "add a new API endpoint + DB table + frontend form" | Jarvis → Friday → Friday spawns Ultron+Pym+Astra in parallel |
  | "quick util script, one file" | Jarvis → r2d2 (quick/ambiguous) |
  | "we need to decide if we should pivot to enterprise" | Jarvis owns (cross-domain strategy) |

  All 7 scenarios should trace cleanly. If any don't, revise the relevant classification table or forbidden block.

- [ ] **Step 4: Final commit + push**

  ```bash
  git add .agents/
  git commit -m "chore: sync agent definitions after smart-routing update"
  git push origin dev
  ```

---

## Self-Review Notes

- **Spec coverage:** All 4 spec requirements covered: Jarvis instant routing ✓, Friday mandatory delegation ✓, parallel spawn mandate ✓, audit cycle ✓, Nat delegation ✓, Sam audit cycle ✓
- **No placeholders:** All steps have exact content, exact commands, exact file locations
- **Consistency:** "Mandatory Delegation" terminology used consistently across Friday and Nat. "Audit Cycle" section name consistent across Friday, Nat, Sam. Worker fast-path table format identical across all three leads.
