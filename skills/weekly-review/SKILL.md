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

Read and keep the raw text:
- `~/life/identity/objectives.md` → current "This week's focus" + quarter objectives
- Active projects: `~/life/projects/*/project.md` where `Status: active` — note each project's GitHub `owner/repo`.

Every section below is measured against these.

## 2. Gather (all read-only; run in parallel where possible)

**Briefings — the week's daily record.** Read the last 7 dated briefings:
```bash
ls ~/life/briefings/*.md | tail -7
```
These are the ground truth for what happened day-to-day; mine them for
commitments made and dropped.

**GitHub — closed/merged in the last 7 days:**
```bash
gh issue list --state=closed --assignee=@me --search "closed:>=$(date -d '7 days ago' +%F)" --json number,title,labels,closedAt,repository
gh pr list --search "assignee:@me merged:>=$(date -d '7 days ago' +%F)" --state=merged --json number,title,mergedAt,repository
gh issue list --state=open --assignee=@me --json number,title,labels,updatedAt,repository
```
Moved = closed work-items + merged PRs. Stalled = open issues labeled
`work-item`/`feature`/`epic` whose `updatedAt` is 7+ days old.

If any `gh` call fails (offline, rate-limited), mark that section
"unavailable" and continue — do not guess closed/merged work.

## 3. Write the review

Write to `~/life/reviews/$(date +%G-W%V).md` and print the same to the user.
Sections, in this fixed order — omit one only if genuinely empty:

1. **What moved** — closed work-items + merged PRs, grouped by project.
2. **What stalled** — open work-items untouched 7+ days, grouped by project, with age.
3. **Progress vs objectives** — for each quarter objective, what this week advanced it (cite the moved items) and what's still open.
4. **Proposed focus — next week** — 1–3 items for the coming week's "This week's focus", drawn from stalled work + objective gaps.

Keep it skimmable.

## 4. Update objectives — PROPOSE, then confirm (default: no write)

The proposed "This week's focus" in section 4 is a **proposal only**. Do
**not** edit `~/life/identity/objectives.md` until the user explicitly
confirms the new focus. Ask: "Update this week's focus to the above?" and
wait. Only on a yes, replace the "This week's focus" block in
`objectives.md` — leave quarter objectives untouched. Never silently rewrite
objectives.
