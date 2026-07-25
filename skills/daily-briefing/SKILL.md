---
name: daily-briefing
description: >
  Life-OS daily comms/PM cadence. Reads inbox across accounts + today/tomorrow
  calendar (via MCP connectors: Gmail, Zoho/Basely, Google Calendar, Google
  Chat), then TRIAGES every message into spam / actionable / FYI: trashes spam,
  turns actionable items into Notion Tasks linked to the right Project, and
  labels+summarises FYIs. Also surfaces open overdue/high-priority/stale Notion
  Tasks, today's events, upcoming bills, and GitHub issues on code projects.
  Prints a concise digest. Triggers on "daily briefing", "morning rundown",
  "check my comms", "/daily-briefing". Auto-drafts a reply for every actionable
  (waiting for one click); only ever auto-SENDS the evidence-grounded case.
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

**Idempotency (this is a scheduled daily run).** Process only mail **newer than
the last run, or still unread** — NOT a fixed rolling window that re-covers days
already handled. Anchor on the timestamp of the most recent task you created last
run (or the digest archived under `Life OS/briefings/`, step 4); absent that,
fall back to unread + last 24h. Re-seeing an already-triaged thread must be a
no-op.

- **Gmail** (hub `nathanj91905`) — **ALL folders/labels, not just Inbox.**
  Forwarded/filtered mail often skips the Inbox straight to a label, so do NOT
  scope to `in:inbox`. Use `search_threads` `-in:sent -in:draft -in:trash
  -in:spam -in:chats` scoped to since-last-run (`after:<epoch>` or `is:unread`) →
  sender, subject, snippet, link.
- **Zoho/Basely** (account `6906367000000002002`) — **ALL folders.** Zoho
  auto-sorts into separate `Inbox`, `Notification`, and `Newsletter` folders (all
  type Inbox), so a bare `ZohoMail_listEmails` only returns ONE folder and misses
  the rest. Use `ZohoMail_SearchEmails` with `searchKey: "fromDate:<DD-MMM-YYYY>"`
  (since last run) — SearchEmails spans every folder (excludes Spam/Trash by
  default), catching Notification + Newsletter too.
- **Google Chat**: usually **unavailable** (Arbor Genie Workspace restricts the
  Chat API → "not found"); attempt once, skip on error.
- **Google Calendar** — **read-only here.** `list_events` today + tomorrow →
  times, titles, attendees, conflicts. Never create events in this step.
- **Google Drive** (optional): used in step 2/4 for archiving. If the connector
  is absent, skip archiving gracefully — don't fail the run.

Then, once, load active Projects (Projects DS, `Status='active'`) so triage in
step 2 can match. Cache the list for the run.

## 2. Triage every message into ONE bucket, and act

For each message across all inboxes:

1. **True spam** — unsolicited junk, phishing, cold outreach from strangers you
   have no relationship with. → mark **Spam** (Gmail/Zoho) so the filter learns.
   Use **sparingly**: marking a legit sender as spam wrongly trains future mail.
2. **Unimportant** — legit but no value to you: notifications, changelogs,
   expected security/sign-in alerts, subscribed job blasts, delivery notices,
   closed-PR/issue emails. → **Delete (move to Trash, recoverable)**. Do NOT mark
   spam. Ignore afterwards.
3. **Actionable** — needs a reply, decision, or an action from Nathan.
   **Dedup first:** query the Tasks DS for an existing **open** (not-Done) task
   matching the same sender + subject/ask. If found → **skip, no duplicate.**
   Otherwise create a **Notion Task** (`notion-create-pages`, parent
   `data_source_id=de298f1e-3642-4702-a604-f57daa356ce5`):
   - `Name` = the action, terse.
   - `Project` = matched active project (see hints below).
   - `Status` = "Not started".
   - `Priority` = inferred (high if a deadline, a CEO/time-sensitive ask; else
     medium/low).
   - `Due` = the stated date if any. **A deadline sets `Due` — it does NOT create
     a calendar event.** (Calendar events are only for genuine meetings Nathan
     agreed to, never for due dates.)
   - Page **body** = provenance: sender, subject, one-line ask, message link;
     plus the Drive link if an attachment was archived (below).
   - **Auto-draft the reply** (`create_draft`; Zoho `ZohoMail_sendReplyEmail`
     saved as draft, not sent) so a one-click send is waiting. Draft only — do
     **NOT** auto-send here (evidence-grounded auto-send: see Safety).
   - **Attachment?** (contract, bank statement, invoice, official doc) → save it
     to Google Drive under `Life OS/<Project>/` and put the Drive link in the
     task body. Skip gracefully if the Drive connector is absent.
4. **Important but not actionable** — FYI worth knowing (a heads-up from Chris,
   a real update). → **summarise** in the digest AND **sort** it (apply a label
   / archive). No task. If it carries an important attachment (statement,
   official doc), still archive it to Drive under `Life OS/<Project>/`.

**Project matching hints:** `@arborgenie.com` / Chris/Luke/Becca / Azure
"genie" alerts → **Arbor Genie**. `@basely.co.uk` → **Basely**.
`@durham.ac.uk` + COMP1098 / "Futures in STEM" / teaching → the teaching
projects or **Durham University**. **Companies House → Basely.** Housing /
tenancy / personal banking → **Personal Life Management**. Recruiters / job
offers → **Job Search**. No confident match → put under **Personal Life
Management** and note "reassign".

**Nathan's triage preferences:**
- **Recruiting / job-board mail:** software-engineering roles → FYI (Job Search); **non-SWE** (management consulting, finance, generic blasts) → **Trash** (unimportant), no task.
- **Side gigs** (e.g. Snorkel / expert-network work): Nathan's plate is full — treat routine side-gig mail (onboarding, office hours, admin) as **unimportant → Trash**; only make a task if it's genuinely high-value or time-critical.

## 3. Surface what's already open

- **Notion Tasks** overdue or `Priority='high'` and not Done — query Tasks DS.
- **Stale-task nudge** — also list Tasks that are `Not started` and untouched
  for **7+ days** (last-edited > 7d ago). Gentle nudge, not overdue.
- **Today's calendar** — chronological; flag conflicts + prep.
- **Finance radar** — upcoming payments/bills spotted in mail (direct debits,
  card statements, invoices due) → list in digest **with their dates**. If one
  needs an action (dispute, top-up, cancel), task it with a `Due` per step 2.
- **GitHub issues — SURFACE ONLY, never mirror into Notion.** Code issues live
  in GitHub; copying them to Notion causes drift. Read assigned/in-sprint issues
  and list them in the digest:
  - **Genie:** Project 8 → "Next Up" column → issues assigned to **@Zene8**.
    Projects-v2 views need a GraphQL/`gh project` read; **if that view isn't
    readable via the API, fall back** to open issues in `arboreyecare/genie`
    assigned to @Zene8 in the current milestone/sprint.
  - **Basely + AgentSystem:** open issues in `Zene8/Basely` and
    `Zene8/AgentSystem` assigned to @Zene8.
  ```bash
  gh issue list --repo arboreyecare/genie --assignee Zene8 --state open \
    --json number,title,url,milestone --limit 30   # fallback for Genie
  ```
  If `gh api user` → 401 or `gh` offline, mark GitHub "unavailable" (GitHub
  notifications also land in the hub inbox, so partly covered there).

## 4. Print the digest

Concise, skimmable:

- **N spam trashed** (count only).
- **M tasks created** — list each: `title → Project` (link); note "+ draft" when
  a reply draft is waiting.
- **K FYIs** — one line each.
- **Calendar** — today's events; conflicts flagged.
- **Finance** — upcoming bills/payments with dates.
- **Open tasks** — overdue / high-priority first; then stale (`Not started` 7d+).
- **GitHub** — assigned/in-sprint issues (surfaced, not tasked).

**Archive the digest** to Google Drive at `Life OS/briefings/YYYY-MM-DD` (used
also as the idempotency anchor for the next run). Skip gracefully if Drive is
absent.

## 5. Cadence roll-ups (self-triggering)

After the digest, check today's date and chain the heavier reviews:

- **Sunday** → also run the **`weekly-review`** skill.
- **Last day of the month** → also do the monthly roll-up (weekly-review's
  monthly pass).

## Safety (non-negotiable)

- **True spam → Spam label, used sparingly** (it trains the filter, so never on a
  legit sender). Everything else unwanted → **Trash (recoverable)**. Never
  permanent-delete.
- **Auto-send is allowed ONLY for evidence-grounded replies.** You may send a
  reply automatically when BOTH hold: (a) the message asks something whose answer
  is directly available in **Notion** (a Task/Project/Outcome/note) or **GitHub**
  (an issue/PR/commit/status), and (b) the reply is purely that factual info — a
  status, date, link, or confirmation — that the evidence fully supports. Cite the
  source you used in the reply. Anything needing a decision, commitment, opinion,
  new information, or not fully grounded → **draft only** (`create_draft`). When
  in doubt, draft — never send.
- **Every actionable gets a waiting draft** (step 2.3). A draft is safe: it sends
  nothing until Nathan clicks. Only the evidence-grounded case above may go out
  automatically.
- Creating tasks, drafts, labelling, archiving (incl. to Drive), trashing are
  auto-OK. **Never create calendar events except for a real meeting Nathan
  agreed to** — deadlines are `Due` fields, not events.
- Connectors absent → "connectors offline", create nothing, don't guess.
