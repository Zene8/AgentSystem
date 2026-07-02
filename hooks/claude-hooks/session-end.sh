#!/bin/bash
# Ensure node/jq resolve even if the parent process's PATH predates their
# installation (e.g. a long-lived daemon started before nvm4w/jq existed).
export PATH="/c/nvm4w/nodejs:/c/Users/natha/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"

# Stop hook: log session cost + tokens to nexus session log, then auto-name session
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG="$HOME/agent-memory/nexus/session-log.jsonl"
mkdir -p "$(dirname "$LOG")"

# Real Stop-hook fields (verified against the Claude Code hooks reference 2026-07-02):
# session_id, transcript_path, cwd, permission_mode, turn_number, stop_reason, and
# optionally agent_type/agent_id. There is NO cost_usd or usage field on this payload --
# real per-turn token usage + model name live in the transcript JSONL itself, which is
# why session-cost-compute.js reads transcript_path instead of guessing from stdin.
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")
AGENT=$(echo "$INPUT" | jq -r '.agent_type // "main"' 2>/dev/null || echo "main")

COMPUTED=$(node ~/dev/AgentSystem/tools/session-cost-compute.js "$TRANSCRIPT_PATH" 2>/dev/null)
COST=$(echo "$COMPUTED" | jq -r '.cost_usd // 0' 2>/dev/null || echo "0")
IN_TOK=$(echo "$COMPUTED" | jq -r '.in_tok // 0' 2>/dev/null || echo "0")
OUT_TOK=$(echo "$COMPUTED" | jq -r '.out_tok // 0' 2>/dev/null || echo "0")

echo "{\"ts\":\"$TIMESTAMP\",\"session\":\"$SESSION_ID\",\"agent\":\"$AGENT\",\"cost_usd\":$COST,\"in_tok\":$IN_TOK,\"out_tok\":$OUT_TOK}" >> "$LOG"

# Auto-name the session from first user prompt
if [ "$SESSION_ID" != "unknown" ]; then
  node ~/dev/AgentSystem/tools/session-namer.js \
    --finalize \
    --session="$SESSION_ID" 2>/dev/null || true
fi

exit 0
