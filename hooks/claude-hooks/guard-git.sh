#!/bin/bash
# PreToolUse hook: block destructive git ops on main/master without explicit user intent
INPUT=$(cat)

# --- Payload parsing: jq fast path, node fallback (#516) ---------------------
#
# This was jq-only:
#     TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
# With no jq on PATH — a freshly provisioned runner, or any host where it was
# never installed — jq's stderr went to /dev/null, TOOL came back empty, the
# `TOOL != Bash` check below matched, and the guard exited 0. Every git command
# was allowed, `git push origin main` included, and nothing said so anywhere.
# This is the only hook in the repo that MECHANICALLY blocks an action, so a
# silent no-op here is the whole control gone.
#
# node is the fallback because it is already a hard dependency of this hook set:
# every other hook under hooks/ IS a Node script, so a host that can run them
# has node. It walks a dotted path over the parsed payload instead of eval'ing
# an expression, so no part of the payload is ever executed.
GUARD_LOG="${GUARD_GIT_LOG:-$HOME/agent-memory/nexus/guard-git.log}"

# Uses `${VAR%/*}` rather than dirname, and swallows every failure: logging must
# never break a hook.
guard_log() {
  {
    # `${VAR%/*}` returns the string unchanged when it holds no `/` — mkdir'ing
    # that would create a directory named after the log file itself.
    _dir="${GUARD_LOG%/*}"
    if [ "$_dir" != "$GUARD_LOG" ]; then mkdir -p "$_dir"; fi
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >>"$GUARD_LOG"
  } 2>/dev/null || true
}

NODE_BIN=""
if command -v jq >/dev/null 2>&1; then
  PARSER=jq
elif command -v node >/dev/null 2>&1; then
  PARSER=node
  NODE_BIN=node
elif command -v nodejs >/dev/null 2>&1; then
  PARSER=node
  NODE_BIN=nodejs
else
  PARSER=none
fi

# Neither parser available. Deliberately NOT fail-closed: a PreToolUse hook that
# exits 2 denies every Bash call, which bricks the session — including the very
# commands needed to install jq or node. So allow, but be loud about it in the
# log and on stderr: an unguarded host must be visible, not silently unprotected.
#
# There is no `node tools/human-needed.js raise` call here on purpose. That alert
# is itself a Node script, and node being absent is the precondition of this
# branch, so shelling out to it would fail exactly when it is needed and the
# failure would be invisible. The log line IS the alert channel for this state.
if [ "$PARSER" = none ]; then
  guard_log "UNGUARDED neither jq nor node found on PATH - guard-git.sh is INERT on this host, every git command is allowed, including a direct push to main. Install jq or node. PATH=$PATH"
  echo "guard-git.sh: UNGUARDED - neither jq nor node on PATH, so the git safety guard is INERT on this host (logged to $GUARD_LOG). Install jq or node." >&2
  exit 0
fi

# Dotted-path reader over the parsed payload. The payload arrives on stdin, not
# argv — a Bash command line can be large and argv is size-capped.
NODE_EXTRACT='let raw="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>{raw+=c});process.stdin.on("end",()=>{let v;try{v=JSON.parse(raw);for(const k of process.argv[1].split(".")){v=(v===null||v===undefined)?undefined:v[k];}}catch(e){v=undefined;}process.stdout.write(typeof v==="string"?v:"");});'

# $1 = jq filter, $2 = the equivalent dotted path for the node fallback.
json_field() {
  case "$PARSER" in
    jq) printf '%s' "$INPUT" | jq -r "$1" 2>/dev/null ;;
    node) printf '%s' "$INPUT" | "$NODE_BIN" -e "$NODE_EXTRACT" "$2" 2>/dev/null ;;
  esac
}

TOOL=$(json_field '.tool_name // ""' 'tool_name')

if [ "$TOOL" != "Bash" ]; then
  # A non-empty payload that yields no tool_name is a malformed or unexpected
  # envelope, not another tool — same allow, but it should not be silent.
  if [ -n "$INPUT" ] && [ -z "$TOOL" ]; then
    guard_log "payload carried no tool_name (parser=$PARSER); allowed without inspection"
  fi
  exit 0
fi

CMD=$(json_field '.tool_input.command // ""' 'tool_input.command')

# --- Segment the command, then match within a segment (#284) -----------------
#
# Every rule below inspects command TEXT, so a rule written as one flat regex
# matches a word that belongs to a *different* command in the same compound
# line. That is how the force-push rule blocked
#   git push -u origin <branch> && git log origin/main -1
# — the flag came from the push, the "main" came from the log, and nothing tied
# them to the same command.
#
# Splitting on the shell's command separators and letting grep do its normal
# per-line matching scopes every rule to one command at a time, which kills that
# whole class in one place instead of per-regex. Splitting only ever narrows a
# match, so no true positive is lost: a real `git push --force origin main` has
# no separator in it and stays one segment.
SEGMENTS=$(printf '%s\n' "$CMD" | tr '&|;' '\n\n\n')

# --- Token-anchored fragments ------------------------------------------------
#
# The second half of #284: `-f` and `main` were matched as bare SUBSTRINGS, so
# `-f` matched inside the branch name `issue-275-fix-...` and `main` matched
# inside anything. Both must be whole shell tokens.
GIT_PUSH='(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)'
# Force flags as standalone tokens, including bundled short forms (-fu, -uf).
# The leading separator means `--follow-tags` cannot match: after the first `-`
# the pattern needs an `f`, and it finds `-`.
FORCE='(^|[[:space:]])(--force|--force-with-lease|-[a-zA-Z]*f[a-zA-Z]*)([[:space:]]|$)'
# A ref that actually lands on the default branch: a bare `main`/`master` token
# or any `<src>:main` refspec. `maintenance-branch` and `feat/main-menu` are not
# matches, because the token must END right after main/master.
MAIN_REF='(^|[[:space:]])(main|master|[^[:space:]]*:(main|master))([[:space:]]|$)'

# Block: force push to main/master.
# (A subset of the next rule — kept for the more specific message.)
if printf '%s\n' "$SEGMENTS" | grep -E "$GIT_PUSH" | grep -E "$FORCE" | grep -qE "$MAIN_REF"; then
  echo "BLOCKED: Force push to main/master detected. Use 'git push --force-with-lease' or get explicit user approval." >&2
  exit 2
fi

# Block: ANY push to main/master, forced or not.
#
# The force rule above left a plain push to main wide open, while
# skills/daily-triage/SKILL.md states "Never push to `main` in any repo" as a hard limit. That was
# prose with nothing behind it. It became load-bearing once the unattended 05:00/13:00 run was
# cleared to dispatch code items against a CLIENT repo (arboreyecare/genie, #220) — an agent could
# have written straight to a client's default branch and nothing in the stack would have stopped it.
#
# Matches the ref forms that actually land on main: a bare `main`/`master` final ref, `HEAD:main`,
# and `-u origin main`. Any other branch is untouched, which is what draft-PR work needs, and
# `maintenance-branch` does not false-positive.
if printf '%s\n' "$SEGMENTS" | grep -E "$GIT_PUSH" | grep -qE "$MAIN_REF"; then
  echo "BLOCKED: direct write to main/master. Use a branch and open a PR - see the hard limits in skills/daily-triage/SKILL.md." >&2
  exit 2
fi

# Block: hard reset on main/master (branch-aware check).
#
# Two more #284-class defects fixed here:
#  - it was `grep -qP`, but the pattern is plain ERE. On any host whose grep
#    lacks -P (BSD/macOS) grep exits 2, the `&&` short-circuits, and this guard
#    is silently inert — a blocking rule that never blocks.
#  - it only matched `--hard HEAD|origin`, so `git reset --hard <sha>` and
#    `git reset --hard @{u}` walked straight through a rule whose message
#    claims to stop hard resets on main. Any hard reset while ON main is what
#    this is for, so it no longer requires a particular target.
if printf '%s\n' "$SEGMENTS" | grep -qE '(^|[[:space:]])git[[:space:]]+reset[[:space:]]+.*--hard([[:space:]]|$)' \
   && git branch --show-current 2>/dev/null | grep -qE '^(main|master)$'; then
  echo "BLOCKED: Hard reset on main/master. Checkout a branch first." >&2
  exit 2
fi

# Warn (don't block): nuclear clean.
# The old `git clean -[^-]*f[^-]*d` let `[^-]*` run across spaces, so it fired on
# an ordinary `git clean -x foo.f bar.d`. Require real flag tokens instead, in
# either order and bundled or separate.
CLEAN_FORCE='(^|[[:space:]])(--force|-[a-zA-Z]*f[a-zA-Z]*)([[:space:]]|$)'
CLEAN_DIRS='(^|[[:space:]])(--directory|-[a-zA-Z]*d[a-zA-Z]*)([[:space:]]|$)'
if printf '%s\n' "$SEGMENTS" | grep -E '(^|[[:space:]])git[[:space:]]+clean([[:space:]]|$)' \
   | grep -E "$CLEAN_FORCE" | grep -qE "$CLEAN_DIRS"; then
  echo "WARNING: git clean -fd will delete untracked files. Proceeding." >&2
fi

# Block: direct gh issue close.
# Enforces the verify-before-close routine (#151). Issues must only be closed
# via the verification script tools/issue-close.js.
GH_CLOSE='(^|[[:space:]])gh[[:space:]]+issue[[:space:]]+close([[:space:]]|$)'
if printf '%s\n' "$SEGMENTS" | grep -qE "$GH_CLOSE"; then
  echo "BLOCKED: direct 'gh issue close' is forbidden. Use 'node tools/issue-close.js <issue-number> --commit <sha>' instead to verify the fix has landed on main." >&2
  exit 2
fi

exit 0
