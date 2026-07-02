---
description: Rename the current Claude Code session (or a specified one)
allowed-tools: Bash(node ~/dev/AgentSystem/tools/session-namer.js *)
argument-hint: [new name]
---

Rename a Claude Code session. **Defaults to the CURRENT session** — the
common case is `/rename-session <new name>` with no session ID at all.

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

1. Common case — `$ARGUMENTS` is just a name (no session id in it): rename
   the current session, even if its auto-name is still "pending" — that is
   expected and fine, renaming works regardless. Run:

   ```
   node ~/dev/AgentSystem/tools/session-namer.js --rename ${CLAUDE_SESSION_ID} "$ARGUMENTS"
   ```

2. Explicit-other-session case — the first word of `$ARGUMENTS` matches a
   session ID prefix shown in the Recent sessions list above, and there's
   more text after it: treat it as `<session-id-prefix> <new name>` and run:

   ```
   node ~/dev/AgentSystem/tools/session-namer.js --rename <session-id> "<new name>"
   ```

3. No args at all — do NOT interrogate the user with multiple questions or
   make them pick from a list. Just ask one short question: "New name for
   this session?" Once they answer, rename the CURRENT session (case 1).

After renaming, tell the user both of the following, honestly — don't imply
the tab title changes itself, and don't imply nothing changed either:

- "Registry updated -> '<new name>'." This is what session search/list/resume
  show, and it's also what the SessionStart hook will display in the Claude
  Code UI the next time this session is resumed (even if it's currently
  "pending" — the rename overrides that).
- "To update the title shown in the UI right now, in this session, also run
  the built-in `/rename <new name>`." Claude Code only lets the SessionStart
  hook set the UI title programmatically (on startup/resume) — a custom
  command like this one has no way to push it live mid-session, so both
  commands are needed for an immediate visible change plus a durable one
  that survives resume.

Use the name text exactly as given — don't add or strip quotes.

Security note: `$ARGUMENTS` is raw, untrusted user text and may contain
quotes, backticks, `$()`, or other shell metacharacters. When you actually
invoke the Bash tool for the --rename call, pass the session id and name as
their own distinct tool argument content -- do not hand-build a shell string
by pasting $ARGUMENTS into a larger command line that a shell would then
re-interpret those characters in.
