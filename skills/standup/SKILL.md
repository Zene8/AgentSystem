---
name: standup
description: >
  Pull-based morning brief — inbox, open PRs/issues, CI status, yesterday's
  merges, blockers. Triggers on "standup", "morning brief", "what's my status",
  "daily rundown", "/standup". Zero-AI data gathering via gh + repo tools;
  model only summarizes what's fetched.
---

Gather deterministically first, summarize second. Run in the target repo directory (bash on Windows: Git Bash; avoid PowerShell `&&`).

## 1. Gather (all read-only, run in parallel where possible)

```bash
node tools/agent-message.js --list --to=<YourAgentName>
gh pr list --state=open --json number,title,author,updatedAt,statusCheckRollup
gh issue list --state=open --assignee=@me --json number,title,labels,updatedAt
gh pr list --search "assignee:@me" --state=merged --json number,title,mergedAt --limit 10
```

Yesterday's merges (filter the merged-PR list above to `mergedAt` within the last 24h), and blockers = any open PR whose `statusCheckRollup` contains a `FAILURE`/`ERROR` conclusion, or any high-priority inbox message from `agent-message.js`.

## 2. Summarize

Produce a short brief with four sections, in this order:
1. **Inbox** — high-priority messages first
2. **Open PRs** — flag any with failing CI
3. **Open issues assigned to you**
4. **Yesterday's merges**

Do not re-fetch data the model could guess — every fact above must come from a command output. If a `gh` call fails (offline, rate-limited), report that section as "unavailable" rather than guessing.
