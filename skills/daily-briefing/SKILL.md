---
name: daily-briefing
description: >
  Life-OS daily comms/PM cadence. Reads inbox across accounts + today/tomorrow
  calendar (via MCP connectors: Gmail, Zoho/Basely, Google Calendar, Google
  Chat), then TRIAGES every message into spam / actionable / FYI: trashes spam,
  turns actionable items into Notion Tasks linked to the right Project, and
  labels+summarises FYIs. Also surfaces open overdue/high-priority Notion Tasks,
  today's events, and GitHub PRs waiting on code projects. Prints a concise
  digest. Triggers on "daily briefing", "morning rundown", "check my comms",
  "/daily-briefing". Never auto-sends email; drafts only, on request.
---

Gather deterministically first, act second. **Source of truth = the Notion
"Life OS"** (home page `3a7e23f1-17bd-819c-a3e3-cd262e8d0c60`). The actionable
layer IS the Notion **Tasks** database — there is no "Now" / "this week's focus"
page. Triaging inboxes into Tasks-linked-to-Projects is the whole job.

Notion data sources:
- **Tasks** `de298f1e-3642-4702-a604-f57daa356ce5` — props: `Name`(title),
  `Project`(relation→Projects), `Status`(Not started/In progress/Done),
  `Due`(date), `Priority`(high/medium/low). Create via `notion-create-pages`
  with parent `data_source_id`.
- **Projects** `b8e1ee15-ba07-438c-bed9-a5865dbacdf9` — query with
  `notion-query-data-sources` for `Status='active'`; read each project's
  `GitHub` link.

## 1. Gather (read-only; parallel where possible)

Only call connectors available this session. **Headless/cron → connectors
absent → report "connectors offline", create nothing, don't guess.**

- **Gmail** (hub `nathanj91905`): `search_threads` `newer_than:1d is:unread`
  and `newer_than:2d is:important` → sender, subject, snippet, link.
- **Zoho/Basely**: `ZohoMail_listEmails` / `ZohoMail_SearchEmails` on the
  Basely account → same fields.
- **Google Chat**: `list_messages` / unread mentions (optional; skip if noisy).
- **Google Calendar**: `list_events` today + tomorrow → times, titles,
  attendees, conflicts.

Then, once, load active Projects (Projects DS, `Status='active'`) so triage in
step 2 can match. Cache the list for the run.

## 2. Triage every message into ONE bucket, and act

For each message across all inboxes:

1. **Spam / junk** — promos, cold-recruiter spam, unwanted newsletters,
   no-action notifications. → move to **Trash (recoverable)** or mark Spam
   (Gmail `label_thread`/trash; Zoho `markThreadSpam`/`moveThreads` to Trash).
   Auto-OK. Ignore afterwards.
2. **Actionable** — needs a reply, decision, or an action from Nathan. →
   create a **Notion Task** (`notion-create-pages`, parent
   `data_source_id=de298f1e-3642-4702-a604-f57daa356ce5`):
   - `Name` = the action, terse.
   - `Project` = matched active project (see hints below).
   - `Status` = "Not started".
   - `Priority` = inferred (high if a deadline, a CEO/time-sensitive ask; else
     medium/low).
   - `Due` = the stated date if any.
   - Page **body** = provenance: sender, subject, one-line ask, message link.
   - Do **NOT** auto-reply.
3. **Important but not actionable** — FYI worth knowing (a heads-up from Chris,
   a real update). → **summarise** in the digest AND **sort** it (apply a label
   / archive). No task.

**Project matching hints:** `@arborgenie.com` / Chris/Luke/Becca / Azure
"genie" alerts → **Arbor Genie**. `@basely.co.uk` → **Basely**.
`@durham.ac.uk` + COMP1098 / "Futures in STEM" / teaching → the teaching
projects or **Durham University**. Companies House / housing / tenancy /
banking-personal → **Personal Life Management**. Recruiters / job offers →
**Job Search**. No confident match → put under **Personal Life Management** and
note "reassign".

## 3. Surface what's already open

- **Notion Tasks** overdue or `Priority='high'` and not Done — query Tasks DS.
- **Today's calendar** — chronological; flag conflicts + prep.
- **GitHub PRs** waiting on you, on active code projects. Cross-repo via
  `gh search` (needs user-authed token; `gh issue list` is single-repo — don't
  use it here):
  ```bash
  gh search prs --author=@me --state=open --json number,title,repository,url --limit 30
  ```
  Repos = the `GitHub` field of active projects. If `gh api user` → 401 or `gh`
  offline, mark GitHub "unavailable" (note: GitHub notifications also land in
  the hub inbox, so partly covered there).

## 4. Print the digest

Concise, skimmable, no file written:

- **N spam trashed** (count only).
- **M tasks created** — list each: `title → Project` (link).
- **K FYIs** — one line each.
- **Calendar** — today's events; conflicts flagged.
- **Open tasks** — overdue / high-priority, most urgent first.
- **PRs** — waiting on you, if any.

## Safety (non-negotiable)

- Spam → **Trash (recoverable)**, never permanent delete.
- **Auto-send is allowed ONLY for evidence-grounded replies.** You may send a
  reply automatically when BOTH hold: (a) the message asks something whose answer
  is directly available in **Notion** (a Task/Project/Outcome/note) or **GitHub**
  (an issue/PR/commit/status), and (b) the reply is purely that factual info — a
  status, date, link, or confirmation — that the evidence fully supports. Cite the
  source you used in the reply. Anything needing a decision, commitment, opinion,
  new information, or not fully grounded → **draft only** (`create_draft`). When
  in doubt, draft — never send.
- Creating tasks, labelling, archiving, trashing are auto-OK.
- Connectors absent → "connectors offline", create nothing, don't guess.
