#!/bin/bash
# Ensure node/jq resolve even if the parent process's PATH predates their
# installation (e.g. a long-lived daemon started before nvm4w/jq existed).
export PATH="/c/nvm4w/nodejs:/c/Users/natha/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"

# SessionEnd hook: finalize session with done marker and generate handoff doc.
# Receives JSON on stdin: { "session_id": "...", ... }
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
CWD=$(pwd)

# Apply done marker to mark session as finished
if [ "$SESSION_ID" != "unknown" ]; then
  node ~/dev/AgentSystem/tools/session-namer.js \
    --finalize-close \
    --session="$SESSION_ID" 2>/dev/null || true
fi

# Generate handoff doc at repo root
if [ -d "$CWD" ]; then
  node ~/dev/AgentSystem/tools/generate-handoff.js \
    --cwd="$CWD" >/dev/null 2>&1 || true
fi

exit 0
