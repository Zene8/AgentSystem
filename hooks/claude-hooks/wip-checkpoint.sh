#!/bin/bash
# PostToolUse hook: auto-stage modified files on feature branches
# Prevents losing work between sessions
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

# Only act on file modification tools
case "$TOOL" in
  Write|Edit|NotebookEdit) ;;
  *) exit 0 ;;
esac

FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
[ -z "$FILE" ] && exit 0
[ ! -f "$FILE" ] && exit 0

DIR=$(dirname "$FILE")

# Must be in a git repo
git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Skip main/master — don't auto-stage there
BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null)
case "$BRANCH" in
  main|master) exit 0 ;;
esac

# Stage the file
git -C "$DIR" add "$FILE" 2>/dev/null
exit 0
