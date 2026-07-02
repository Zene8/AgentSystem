---
description: Quickly rename a Claude Code session in the session registry
allowed-tools: Bash(node ~/dev/AgentSystem/tools/session-namer.js *)
---

Rename a session in the session registry.

## Context

Recent sessions:
!`node ~/dev/AgentSystem/tools/session-namer.js --list --limit=10`

## Your task

The user invoked: `/rename-session {{args}}`

Parse the args as: `<session-id-prefix> <new name>`

- If no args given, list recent sessions and ask the user which session to rename and what name to use.
- If only a session ID is given (no new name), show that session's current name and ask for the new name.
- If both session ID and new name are provided, run:

```
node ~/dev/AgentSystem/tools/session-namer.js --rename <session-id> "<new name>"
```

The session ID can be a short prefix (first 8 chars). The new name is everything after the first word in args.

After renaming, confirm: "Renamed to: <new name>"
