---
name: daily-briefing
description: >
  Life-OS morning rundown. Reads inbox + calendar (via MCP connectors: Gmail,
  Microsoft 365, Google Calendar, Google Chat), open GitHub work-items, PRs/CI,
  and the life repo's current objectives — then writes a prioritised briefing to
  ~/life/briefings/YYYY-MM-DD.md and prints it. Triggers on "daily briefing",
  "life brief", "morning rundown", "check my comms", "/daily-briefing".
  Read-only by default; auto-triage is opt-in and gated (see step 4).
---

Gather deterministically first, summarise second. This is the life-scoped
superset of the dev-only `standup` skill.

**Source of truth = the Notion "Life OS"** (home page `3a7e23f1-17bd-819c-a3e3-cd262e8d0c60`).
The `~/life` git repo is a dormant backup only — read it just as a fallback.

## 1. Anchor — what does today serve? (read from Notion)

Via the Notion MCP (`notion-fetch`, `notion-query-data-sources`):
- **Now** page (`3a7e23f1-17bd-81eb-9d01-e0ba99fbf5f1`) → this week's focus + quarter/year outcomes.
- **Projects** data source (`b8e1ee15-ba07-438c-bed9-a5865dbacdf9`), rows where `Status = active` → active projects + their Goal/Objective relation + `GitHub` link.
- **Values** page (`3a7e23f1-17bd-81cb-b5c6-e333c5f4f285`) → for the value-alignment flags in step 3.

If the Notion MCP is unavailable this session (headless/cron), fall back to the
`~/life` git mirror (`now.md`, `objectives/**/project.md`, `values.md`) and note
it may be stale. Every later section is ranked by how it moves the focus + active projects.

## 2. Gather (all read-only; run in parallel where possible)

**Comms — MCP connectors.** The canonical account set + priority lives in
`~/life/accounts.md`. Each connector is authed to ONE account at a time — pull
from whatever each is currently signed into, order by the priority in
`accounts.md`, and mark any listed account the connector can't reach this
session as "not connected". Only call connectors actually available this session
(absent in headless/cron — if so, mark "unavailable: connector offline" and
continue, don't guess):
- Gmail: `search_threads` with `newer_than:1d is:unread` and `newer_than:2d is:important` → subjects, senders, snippets. One pass per connected account.
- Microsoft 365 mail: same intent via the M365 connector (authenticate first if it returns unauthenticated).
- Google Calendar: `list_events` for today + tomorrow → times, titles, attendees, conflicts.
- Google Chat: `list_messages` / unread mentions (optional; skip if noisy).

**GitHub — cross-repo via `gh search`** (needs a user-authed token; `gh issue list`
is single-repo and has no `repository` field — don't use it here):
```bash
gh search issues --assignee=@me --state=open --json number,title,repository,updatedAt --limit 30
gh search prs --author=@me --state=open --json number,title,repository,url --limit 30
```
If `gh` is offline or the token lacks user scope (`gh api user` → 401), mark the
GitHub section "unavailable" — note that GitHub notifications also arrive in the
hub inbox, so they're partly covered there. Work-items due/started = open issues
labeled `work-item`/`feature`/`epic` on the repos in the `GitHub` field of the
active Notion projects (from step 1).
Blockers = failing PR checks, calendar conflicts, or "important" unread >2 days old.

## 3. Write the briefing

Write to `~/life/briefings/$(date +%F).md` (this file is gitignored by default).
Sections, in this fixed priority order — omit a section only if genuinely empty:

1. **Today serves** — this week's focus + the 1–3 objectives today should move.
2. **Calendar** — today's events chronologically; flag conflicts + prep needed.
3. **Inbox — action needed** — messages needing a reply/decision, most urgent first, grouped by account. Each: sender, one-line ask, suggested next action.
4. **Inbox — FYI** — everything else unread, one line each.
5. **Work-items** — GitHub issues due/started on active projects, grouped by project.
6. **PRs / CI** — anything waiting on you; failing CI first.
7. **Flags** — anything conflicting with values/objectives, or dropped balls (stale important mail, overdue work-items).

Keep it skimmable. Then print the same brief to the user.

## 4. Auto-triage — OPT-IN, GATED (default: OFF)

Do **not** send, archive, label, or reply to anything unless BOTH are true:
1. `~/life/triage-rules.yml` exists and defines the rule that matches, and
2. that rule's `mode` is `auto` (else the rule is `suggest` → propose only).

If `triage-rules.yml` is missing or a rule is `suggest`, produce a **dry-run
plan** in the briefing under "Proposed triage" — "would archive X, would draft
reply to Y" — and take no action. Sending email and archiving are irreversible;
never act on an unmatched or `suggest` rule. See `references/triage-rules.example.yml`.

Never auto-send a reply to a human unless a matching rule is explicitly
`mode: auto` AND `allow_send: true`. Drafts (`create_draft`) are safe and
preferred — they wait for the user in Gmail.
