#!/bin/bash
# Ensure node/jq resolve even if the parent process's PATH predates their
# installation (e.g. a long-lived daemon started before nvm4w/jq existed).
export PATH="/c/nvm4w/nodejs:/c/Users/natha/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"

# Stop hook: log session cost + tokens to nexus session log, then auto-name session
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG="$HOME/agent-memory/nexus/session-log.jsonl"
mkdir -p "$(dirname "$LOG")"

SESSION_ID=$(echo "$INPUT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);process.stdout.write(o.session_id||'unknown')}catch{process.stdout.write('unknown')}})" 2>/dev/null || echo "unknown")
COST=$(echo "$INPUT" | jq -r '.cost_usd // 0' 2>/dev/null || echo "0")
IN_TOK=$(echo "$INPUT" | jq -r '.usage.input_tokens // 0' 2>/dev/null || echo "0")
OUT_TOK=$(echo "$INPUT" | jq -r '.usage.output_tokens // 0' 2>/dev/null || echo "0")
AGENT=$(echo "$INPUT" | jq -r '.agent // "unknown"' 2>/dev/null || echo "unknown")

echo "{\"ts\":\"$TIMESTAMP\",\"session\":\"$SESSION_ID\",\"agent\":\"$AGENT\",\"cost_usd\":$COST,\"in_tok\":$IN_TOK,\"out_tok\":$OUT_TOK}" >> "$LOG"

# Auto-name the session from first user prompt
if [ "$SESSION_ID" != "unknown" ]; then
  node ~/dev/AgentSystem/tools/session-namer.js \
    --finalize \
    --session="$SESSION_ID" 2>/dev/null || true
fi

exit 0
