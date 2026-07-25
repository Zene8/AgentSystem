---
name: inbox-capture
description: >
  On-demand "convert my actionable inbox into Notion Tasks now". Reads unread
  actionable mail (via MCP connectors: Gmail, Zoho/Basely), matches each to an
  active Notion Project, and proposes one Notion Task per message. Same triage
  + task-creation as daily-briefing step 2, but standalone and DRY-RUN by
  default — nothing is created, trashed, or labelled without explicit
  confirmation. Triggers on "capture inbox", "inbox to tasks", "triage to
  tasks", "/inbox-capture".
---

Gather deterministically first, propose second. **Source of truth = the Notion
"Life OS"** — actionable items become **Notion Tasks** in the Tasks DS
(`de298f1e-3642-4702-a604-f57daa356ce5`), linked to an active Project.

## 1. Read actionable mail — MCP connectors

Only call connectors available this session. Headless/cron → absent → report
**"connectors offline"** and stop. Never fabricate mail.

- **Gmail** (hub `nathanj91905`) — ALL folders/labels, not just Inbox:
  `search_threads` `newer_than:3d -in:sent -in:draft -in:trash -in:spam -in:chats`
  (no `in:inbox` — catches filtered/labelled mail) → sender, subject, snippet, link.
- **Zoho/Basely** (account `6906367000000002002`) — ALL folders: use
  `ZohoMail_SearchEmails` `searchKey: "fromDate:<DD-MMM-YYYY>"` (spans Inbox +
  Notification + Newsletter; bare `listEmails` returns only one folder).

Triage each message into the three buckets:
- **True spam** (unsolicited junk/phishing/cold outreach) → propose marking **Spam** (trains the filter — use sparingly, never on a legit sender).
- **Unimportant** (legit but valueless: notifications, changelogs, sign-in alerts, job blasts, delivery notices) → propose **Delete (Trash)**, not spam.
- **Actionable** (needs a reply/decision/action) → propose a Notion Task.
- **FYI** (important, not actionable) → summarise + propose a label/archive.

## 2. Match each actionable message to a project

Query **Projects** (`b8e1ee15-ba07-438c-bed9-a5865dbacdf9`, via
`notion-query-data-sources`) for `Status='active'`. Match by sender domain,
subject keywords, or project name:

`@arborgenie.com` / Chris/Luke/Becca / Azure "genie" → **Arbor Genie** ·
`@basely.co.uk` → **Basely** · `@durham.ac.uk` + COMP1098 / "Futures in STEM" /
teaching → teaching projects or **Durham University** · Companies House /
housing / tenancy / banking-personal → **Personal Life Management** ·
recruiters / job offers → **Job Search**. No confident match → **Personal Life
Management**, note "reassign".

## 3. Propose tasks — DRY-RUN (default)

One skimmable list, one line per proposed task:

> **<title>** → <Project> — from <sender>: "<subject>" (<link>) [Priority, Due]

Title = the action, terse. Priority = high if deadline/CEO/time-sensitive.
`Due` = stated date if any. Also list proposed spam-trashes and FYI labels.

Then ask: "Create these N tasks?" Wait for explicit confirmation. Only on a
yes, create each via `notion-create-pages` (parent
`data_source_id=de298f1e-3642-4702-a604-f57daa356ce5`): `Status`="Not started",
`Project`=matched, `Priority`, `Due`; page body = sender + subject + one-line
ask + link.

## 4. Source email — offer, then confirm separately

After tasks are created, offer to trash spam / label/archive the source
emails — a **separate** confirmation, not part of the task-creation yes.
Spam → Trash (recoverable), never permanent delete. **Never auto-send** a
reply; drafts only, on request.
