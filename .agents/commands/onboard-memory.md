---
description: Extract and store memory facts from a prompt, message, or session transcript
allowed-tools: Bash(node /home/natha/dev/AgentSystem/tools/memory-onboard.js *)
---

Onboard memory from a prompt, message, or session into the personal brain.

## Your task

The user invoked: `/onboard-memory {{args}}`

Determine which mode to use based on args:

**If args start with a UUID or session ID prefix (8+ hex chars):**
Run session mode — extract facts from that session's transcript:
```
node /home/natha/dev/AgentSystem/tools/memory-onboard.js --session=<id>
```

**If args are plain text (a prompt or message):**
Run text mode — extract facts from the inline text:
```
node /home/natha/dev/AgentSystem/tools/memory-onboard.js --text="<args>"
```

**If args start with `--fact=` or look like a single clear statement:**
Run fact mode — write directly without LLM extraction:
```
node /home/natha/dev/AgentSystem/tools/memory-onboard.js --fact="<args>"
```

**If no args given:**
Ask the user: "What do you want to onboard? You can paste a message, give a session ID, or state a fact directly."

After running, report what was stored: list each new fact written, or confirm "already known" if nothing new was added.

Optional: the user can suffix `--section="..."` to target a specific brain section (default: Session Notes).
