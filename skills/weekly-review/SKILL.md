---
name: weekly-review
description: >
  Life-OS week-in-review rollup. Reads active Notion Projects + Tasks
  (done/created/stalled in the last 7 days) and closed/merged GitHub work from
  code projects, then writes a review as a Notion page under the Life OS home
  and prints it: what moved, what stalled, and proposed next-week priorities
  (which Tasks to mark high-priority, which Projects to focus). Triggers on
  "weekly review", "week in review", "/weekly-review". Read-only gather; the
  priority proposal is gated (see step 3).
---

Gather deterministically first, summarise second. **Source of truth = the
Notion "Life OS"** (home `3a7e23f1-17bd-819c-a3e3-cd262e8d0c60`). There is no
"Now" / "this week's focus" page — the actionable layer is the **Tasks**
database.

Notion data sources:
- **Tasks** `de298f1e-3642-4702-a604-f57daa356ce5` — `Name`, `Project`,
  `Status`(Not started/In progress/Done), `Due`, `Priority`(high/medium/low).
- **Projects** `b8e1ee15-ba07-438c-bed9-a5865dbacdf9` — `Status='active'`, each
  with a `GitHub` link.

## 1. Gather (read-only; parallel where possible)

Via the Notion MCP (`notion-query-data-sources`):
- **Projects** where `Status='active'` — note each `GitHub` link.
- **Tasks** touched in the last 7 days: `Status='Done'` (moved), created this
  week, and `Status='Not started'` aging (created 7+ days ago, still not
  started = stalled).

**GitHub — cross-repo via `gh search` (last 7 days)** on active-project repos:
```bash
gh search prs --author=@me --state=merged --json number,title,repository "merged:>=$(date -d '7 days ago' +%F)"
gh search issues --assignee=@me --state=closed --json number,title,repository,closedAt "closed:>=$(date -d '7 days ago' +%F)"
```
If a `gh` call fails (offline, rate-limited) or the Notion MCP is unavailable,
mark that section "unavailable" and continue — don't guess.

## 2. Write the review

Create a Notion page titled `Review <YYYY-Www>` under the Life OS home
(`notion-create-pages`, parent `page_id=3a7e23f1-17bd-819c-a3e3-cd262e8d0c60`)
and print the same. Sections, fixed order — omit one only if genuinely empty:

1. **What moved** — Tasks marked Done + merged PRs + closed issues, grouped by
   project; note project progress.
2. **What stalled** — Not-started Tasks aging (with age) + active projects
   untouched this week, grouped by project.
3. **Proposed priorities — next week** — 1–3 items: which Tasks to bump to
   `Priority='high'` / which projects to focus, drawn from stalled work.

Keep it skimmable.

**Monthly variant:** same gather, but also check progress against the
objectives/goals **Outcomes** (higher-level than weekly) and roll up four
weeks of moved/stalled instead of one.

## 3. Propose priorities — PROPOSE, then confirm (default: no write)

Section 3 is a **proposal only**. Do **not** change any Task's `Priority` or
`Status` until the user explicitly confirms. Ask: "Bump these Tasks to
high-priority?" and wait. Only on a yes, `notion-update-page` each named Task.
Never silently rewrite the plan.
