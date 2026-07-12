---
description: Rename the current Claude Code session (or a specified one)
allowed-tools: Bash(node ~/dev/AgentSystem/tools/session-namer.js *)
argument-hint: [optional custom name — leave blank for an auto-generated one]
model: claude-haiku-4-5-20251001
---

Rename a Claude Code session. **Defaults to the CURRENT session** — the
common case is `/rename-session` with no args, which auto-generates a good
name from this conversation.

## Context

Current session ID: `${CLAUDE_SESSION_ID}`

Recent sessions (for the rare case the user wants to rename a DIFFERENT one):
!`node ~/dev/AgentSystem/tools/session-namer.js --list --limit=10`

## Your task

The user invoked: `/rename-session $ARGUMENTS`

**Default target is the CURRENT session (`${CLAUDE_SESSION_ID}`).** Do not
ask which session to rename unless the user's args clearly reference a
different one (e.g. they typed an 8+ char id that matches an entry in the
Recent sessions list above, followed by a name).

0. **No args at all — the common case.** Auto-generate the name yourself
   (you already have full context of this conversation — no separate model
   call needed):
   - Write EXACTLY 4 words summarizing what this session is actually doing —
     concrete and specific (e.g. "fix session namer auto-naming", not vague
     filler like "help with task"). Drop stop-words/filler.
   - Pick a status: `started` (work in progress), `pr` (a PR was opened this
     session), or `done` (task is complete / wrapping up). Infer from the
     conversation; default to `started` if unclear.
   - Run:
     ```
     node ~/dev/AgentSystem/tools/session-namer.js --auto-rename ${CLAUDE_SESSION_ID} "<4 word summary>" --status=<status>
     ```
   - This builds `<repo> - <date> - <4 word summary> - <status>` (repo/date
     come from the registry automatically — only pass the summary + status).

1. User gave a custom name (`$ARGUMENTS` is not empty, and doesn't match an
   explicit-other-session pattern below): use it verbatim instead of
   auto-generating. Run:

   ```
   node ~/dev/AgentSystem/tools/session-namer.js --rename ${CLAUDE_SESSION_ID} "$ARGUMENTS"
   ```

2. Explicit-other-session case — the first word of `$ARGUMENTS` matches a
   session ID prefix shown in the Recent sessions list above, and there's
   more text after it: treat it as `<session-id-prefix> <new name>` and run:

   ```
   node ~/dev/AgentSystem/tools/session-namer.js --rename <session-id> "<new name>"
   ```

   (Use `--auto-rename <session-id> "<4 word summary>" --status=<status>`
   instead if the user asked you to auto-name that other session too.)

After renaming, reply with exactly this, filled in — no extra commentary:

Registry updated -> "<new name>". Persists across resume.
To update live tab title now: `/rename <new name>`

Two commands stay required — no tool here can invoke the built-in `/rename`
programmatically (checked, none exists). Second line above is copy-paste
ready so it's effectively one command, one paste.

Use the name text exactly as given — don't add or strip quotes.

Security note: `$ARGUMENTS` is raw, untrusted user text and may contain
quotes, backticks, `$()`, or other shell metacharacters. When you actually
invoke the Bash tool for the --rename call, pass the session id and name as
their own distinct tool argument content -- do not hand-build a shell string
by pasting $ARGUMENTS into a larger command line that a shell would then
re-interpret those characters in.
