#!/bin/bash
# Ensure node/jq resolve even if the parent process's PATH predates their
# installation (e.g. a long-lived daemon started before nvm4w/jq existed).
export PATH="/c/nvm4w/nodejs:/c/Users/natha/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"

# UserPromptSubmit hook: finalize session name as soon as the first user prompt arrives.
# This ensures sessions get named even when Stop hook never fires (crash/teardown).
# Safe to run on every prompt — cmdFinalizeEarly is idempotent (no-ops if already named).
# Receives JSON on stdin: { "session_id": "...", "prompt": "...", ... }
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).session_id||'')}catch{process.stdout.write('')}})" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Run in background — must not block the user's prompt from being submitted
node ~/dev/AgentSystem/tools/session-namer.js \
  --finalize-early \
  --session="$SESSION_ID" 2>/dev/null &

exit 0
