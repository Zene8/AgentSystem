#!/bin/bash
# PreToolUse hook: block destructive git ops on main/master without explicit user intent
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

if [ "$TOOL" != "Bash" ]; then
  exit 0
fi

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

# Block: force push to main/master
if echo "$CMD" | grep -qE 'git push.+(--force|-f).*(main|master)|git push.*(main|master).+(--force|-f)'; then
  echo "BLOCKED: Force push to main/master detected. Use 'git push --force-with-lease' or get explicit user approval." >&2
  exit 2
fi

# Block: hard reset on main/master (branch-aware check)
if echo "$CMD" | grep -qP 'git reset --hard (HEAD|origin)' && git branch --show-current 2>/dev/null | grep -qE '^(main|master)$'; then
  echo "BLOCKED: Hard reset on main/master. Checkout a branch first." >&2
  exit 2
fi

# Warn (don't block): nuclear clean
if echo "$CMD" | grep -qE 'git clean -[^-]*f[^-]*d|git clean -fd'; then
  echo "WARNING: git clean -fd will delete untracked files. Proceeding." >&2
fi

exit 0
