---
name: inbox-capture
description: >
  Turn action-needed emails into GitHub work-items on the right project.
  Reads unread actionable mail (via MCP connectors: Gmail, Microsoft 365),
  matches each to an active life-repo project, and proposes a `work-item`
  issue per message. Triggers on "capture inbox", "inbox to issues",
  "triage to tasks", "/inbox-capture". DRY-RUN by default — nothing is
  created or archived without explicit confirmation.
---

Gather deterministically first, propose second. Life repo lives at `~/life`
(override with `$LIFE_REPO`).

## 1. Read actionable mail — MCP connectors

Only call connectors actually available this session. In headless/cron runs
they're absent — if none respond, report **"connectors offline"** and stop.
Never fabricate mail.
- Gmail: `search_threads` with `newer_than:3d is:unread` → sender, subject, snippet, thread link. One pass per connected account.
- Microsoft 365 mail: same intent via the M365 connector (authenticate first if it returns unauthenticated).

Keep only messages that need an action from the user (a reply, a decision, a
task). Drop pure FYI/newsletters.

## 2. Match each message to a project

Read active projects and their GitHub targets (projects live at any depth in the
objectives tree):
```bash
grep -rl 'Status: active' ~/life/objectives --include=project.md
```
For each `project.md`, read the GitHub `owner/repo` field. Match a message to
a project by sender domain, subject keywords, or project name. If a message
matches no project or is ambiguous, don't guess — flag it and ask which repo.

## 3. Propose issues — DRY-RUN (default)

Present one skimmable list, one line per proposed issue:

> `owner/repo` — **<title>** — from <sender>: "<subject>" (<link>)

Title = the action, terse. Body = one line: source sender + subject + thread
link. Label = `work-item`.

Then ask: "Create these N issues?" Wait for explicit confirmation. Only on a
yes, create each:
```bash
gh issue create --repo <owner/repo> --title "<title>" --body "From <sender>: <subject> — <link>" --label work-item
```
Never create issues without confirmation.

## 4. Source email — offer, then confirm separately

After issues are created, offer to archive or label the source emails — but
that is a **separate** confirmation. Do not archive/label as part of the
issue-creation yes. Archiving is irreversible; act only on its own explicit
yes, via the connector's label/archive tool.
