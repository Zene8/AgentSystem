#!/bin/bash
# Ensure node/jq resolve even if the parent process's PATH predates their
# installation (e.g. a long-lived daemon started before nvm4w/jq existed).
export PATH="/c/nvm4w/nodejs:/c/Users/natha/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"

# PreCompact hook: generate handoff doc before context compaction (manual /compact or auto-compact near limit).
# Receives JSON on stdin: { "session_id": "...", "cwd": "...", "trigger": "manual|auto", ... }
# Fire-and-forget in background so this never blocks compaction.
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
TRIGGER=$(echo "$INPUT" | jq -r '.trigger // "unknown"' 2>/dev/null)

if [ -z "$CWD" ]; then
  CWD=$(pwd)
fi

# Run in background to avoid blocking compaction
( node ~/dev/AgentSystem/tools/generate-handoff.js \
    --cwd="$CWD" \
    --trigger="$TRIGGER" >/dev/null 2>&1 & ) || true

exit 0
