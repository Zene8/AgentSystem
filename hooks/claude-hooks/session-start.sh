#!/bin/bash
# Ensure node/jq resolve even if the parent process's PATH predates their
# installation (e.g. a long-lived daemon started before nvm4w/jq existed).
export PATH="/c/nvm4w/nodejs:/c/Users/natha/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"

# SessionStart hook: register session in naming registry, emit the visible
# Claude Code session title, and sweep pending sessions in the background.
# Receives JSON on stdin: { "session_id": "...", "source": "startup|resume|clear|compact", "session_title": "...", "transcript_path": "..." }
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SOURCE=$(echo "$INPUT" | jq -r '.source // empty' 2>/dev/null)
EXISTING_TITLE=$(echo "$INPUT" | jq -r '.session_title // empty' 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

CWD=$(pwd)

node ~/dev/AgentSystem/tools/session-namer.js \
  --register \
  --session="$SESSION_ID" \
  --cwd="$CWD" 2>/dev/null || true

# Sweep: retroactively finalize any sessions stuck at "pending" from prior crashes.
# Runs in background so it does not block session startup. All output suppressed --
# stdout must stay clean for the sessionTitle JSON emitted below.
node ~/dev/AgentSystem/tools/session-namer.js --sweep >/dev/null 2>&1 &

# Emit the visible Claude Code session title (same effect as /rename). Only
# SessionStart can set this, and only for source=startup|resume (Claude Code
# ignores sessionTitle on clear/compact) -- see
# https://code.claude.com/docs/en/hooks.md. Never clobber a title the user
# already set explicitly (session_title from stdin is non-empty).
if { [ "$SOURCE" = "startup" ] || [ "$SOURCE" = "resume" ] || [ -z "$SOURCE" ]; } && [ -z "$EXISTING_TITLE" ]; then
  # On resume of an already-named session this is the real name (marker kept);
  # on a fresh session it's "<repo>/<branch>" -- the transcript-derived name
  # then shows on the *next* resume (platform limit: only SessionStart can set
  # the title, and it only fires at startup/resume, never mid-session).
  TITLE=$(node ~/dev/AgentSystem/tools/session-namer.js --print-title --session="$SESSION_ID" --cwd="$CWD" 2>/dev/null)
  if [ -n "$TITLE" ]; then
    node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',sessionTitle:process.argv[1]}}))" "$TITLE"
  fi
fi

exit 0
