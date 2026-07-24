---
name: weekly-review
description: >
  Life-OS week-in-review rollup. Reads the week's daily briefings, closed
  GitHub work-items + merged PRs from the last 7 days, and current objectives
  — then writes a review to ~/life/reviews/YYYY-Www.md and prints it: what
  moved, what stalled, progress vs quarter objectives, and a proposed focus
  for the coming week. Triggers on "weekly review", "week in review",
  "/weekly-review". Read-only gather; objective edits are gated (see step 4).
---

Gather deterministically first, summarise second. This is the weekly counterpart
to `daily-briefing` — reuse its `gh` gather intent for the GitHub sections.

Life repo lives at `~/life` (override with `$LIFE_REPO`). If it doesn't exist,
tell the user to run the life-os skeleton setup and stop.

## 1. Anchor — what did this week serve?

Read from **Notion** (source of truth; home `3a7e23f1-17bd-819c-a3e3-cd262e8d0c60`) via the Notion MCP:
- **Now** page (`3a7e23f1-17bd-81eb-9d01-e0ba99fbf5f1`) → current "This week's focus" + quarter/year outcomes.
- **Projects** data source (`b8e1ee15-ba07-438c-bed9-a5865dbacdf9`), `Status = active` — note each project's `GitHub` link.

Fall back to the dormant `~/life` git mirror only if the Notion MCP is unavailable.

Every section below is measured against these.

## 2. Gather (all read-only; run in parallel where possible)

**Briefings — the week's daily record.** Read the last 7 dated briefings:
```bash
ls ~/life/briefings/*.md | tail -7
```
These are the ground truth for what happened day-to-day; mine them for
commitments made and dropped.

**GitHub — cross-repo via `gh search` (last 7 days):**
```bash
gh search issues --assignee=@me --state=closed --json number,title,repository,closedAt "closed:>=$(date -d '7 days ago' +%F)"
gh search prs --author=@me --state=merged --json number,title,repository "merged:>=$(date -d '7 days ago' +%F)"
gh search issues --assignee=@me --state=open --json number,title,repository,updatedAt --limit 50
```
Moved = closed work-items + merged PRs. Stalled = open issues labeled
`work-item`/`feature`/`epic` whose `updatedAt` is 7+ days old.

If any `gh` call fails (offline, rate-limited), mark that section
"unavailable" and continue — do not guess closed/merged work.

## 3. Write the review

Create a Notion page titled `Review <YYYY-Www>` under the Life OS home
(`notion-create-pages`, parent page_id `3a7e23f1-17bd-819c-a3e3-cd262e8d0c60`) and
print the same to the user. Sections, in this fixed order — omit one only if genuinely empty:

1. **What moved** — closed work-items + merged PRs, grouped by project.
2. **What stalled** — open work-items untouched 7+ days, grouped by project, with age.
3. **Progress vs objectives** — for each quarter objective, what this week advanced it (cite the moved items) and what's still open.
4. **Proposed focus — next week** — 1–3 items for the coming week's "This week's focus", drawn from stalled work + objective gaps.

Keep it skimmable.

## 4. Update objectives — PROPOSE, then confirm (default: no write)

The proposed "This week's focus" in section 4 is a **proposal only**. Do
**not** edit the Notion **Now** page until the user explicitly confirms the new
focus. Ask: "Update this week's focus to the above?" and wait. Only on a yes,
update the "This week's focus" section of the Now page
(`3a7e23f1-17bd-81eb-9d01-e0ba99fbf5f1`, via `notion-update-page`) — leave the
quarter/year outcomes untouched. Never silently rewrite the near-term plan.
