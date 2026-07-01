#!/bin/bash
# SessionStart hook: register session in naming registry + sweep pending sessions
# Receives JSON on stdin: { "session_id": "...", "transcript_path": "..." }
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).session_id||'')}catch{process.stdout.write('')}})" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

CWD=$(pwd)

node ~/dev/AgentSystem/tools/session-namer.js \
  --register \
  --session="$SESSION_ID" \
  --cwd="$CWD" 2>/dev/null || true

# Sweep: retroactively finalize any sessions stuck at "pending" from prior crashes.
# Runs in background so it does not block session startup.
node ~/dev/AgentSystem/tools/session-namer.js --sweep 2>/dev/null &

exit 0
