#!/bin/bash
# PostToolUse hook: deterministic PR-create detection for session status lifecycle (issue #158).
# Zero model/claude CLI calls -- pure string match on the Bash tool_input.command
# already captured by the harness, then a bookkeeping call into session-namer.js.
#
# Session status lifecycle: started (SessionStart) -> pr (this hook) -> done (SessionEnd).
# Receives JSON on stdin: { "session_id": "...", "tool_name": "...", "tool_input": {...} }
export PATH="/c/nvm4w/nodejs:/c/Users/natha/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

[ "$TOOL" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

# Skip-if-no-signal guard: only a literal `gh pr create` invocation is a signal.
# Deliberately does NOT match `gh pr list`/`gh pr view`/etc -- string match only.
case "$CMD" in
  *"gh pr create"*) ;;
  *) exit 0 ;;
esac

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
[ -z "$SESSION_ID" ] && exit 0

node ~/dev/AgentSystem/tools/session-namer.js \
  --set-status=pr \
  --session="$SESSION_ID" 2>/dev/null || true

exit 0
