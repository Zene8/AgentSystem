#!/usr/bin/env bash
# install.sh -- First-time AgentSystem setup (Linux / macOS)
# Idempotent -- safe to re-run.
#
# Usage:
#   ./install.sh
#   NAME="Your Name" EMAIL="you@example.com" ./install.sh
#   ./install.sh --skip-labels

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "   ${GREEN}OK${NC}  $1"; }
warn() { echo -e "   ${YELLOW}!!${NC}  $1"; }
fail() { echo -e "   ${RED}XX${NC}  $1"; }
step() { echo -e "\n${CYAN}>> $1${NC}"; }

SKIP_LABELS=0
for arg in "$@"; do [[ "$arg" == "--skip-labels" ]] && SKIP_LABELS=1; done

PASS=0; WARN=0; FAIL_COUNT=0

# 1. Prerequisites
step "Checking prerequisites"
for cmd in node git gh; do
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd  $($cmd --version 2>&1 | head -1)"
    ((PASS++))
  else
    fail "$cmd not found - install before continuing"
    ((FAIL_COUNT++))
  fi
done

for cli in claude; do
  if command -v "$cli" &>/dev/null; then ok "$cli CLI found"
  else warn "$cli CLI not found (sync will skip it)"; fi
done

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "\n${RED}FATAL: $FAIL_COUNT prerequisite(s) missing. Fix above, then re-run.${NC}"
  exit 1
fi

# 2. Personal brain
step "Initializing personal brain"
NAME="${NAME:-$(git config user.name 2>/dev/null || echo 'User')}"
EMAIL="${EMAIL:-$(git config user.email 2>/dev/null || echo '')}"
node "$SCRIPT_DIR/tools/personal-brain-init.js" --name="$NAME" --email="$EMAIL"
ok "Personal brain ready"
((PASS++))

# 3. Sync agents
step "Syncing agents to all CLIs"
node "$SCRIPT_DIR/tools/sync-agents.js"
ok "Agents synced"
((PASS++))

# 4. GitHub labels
if [ "$SKIP_LABELS" -eq 0 ]; then
  step "Creating GitHub labels"
  if gh auth status &>/dev/null 2>&1; then
    AGENTS="jarvis friday sam ultron pym leo nat wanda astra threepio r2d2"
    for agent in $AGENTS; do
      if gh label list --limit 200 2>/dev/null | grep -q "agent:$agent"; then
        echo "  Exists: agent:$agent"
      else
        gh label create "agent:$agent" --color "0075ca" --description "Dispatch to $agent agent" 2>/dev/null \
          && echo "  Created: agent:$agent" || true
      fi
    done
    ok "Labels ready"
    ((PASS++))
  else
    warn "gh not authenticated - skipping labels (run: gh auth login)"
    ((WARN++))
  fi
else
  echo "  -- Labels skipped (--skip-labels)"
fi

# 5. Runner note (Linux/Mac manual setup)
step "Self-hosted runner"
warn "Runner must be set up manually on Linux/Mac:"
echo "     GitHub > repo Settings > Actions > Runners > New self-hosted runner"
echo "     Choose Linux or macOS, follow the on-screen commands"
((WARN++))

# Summary
echo ""
echo "======================================="
echo " AgentSystem install complete"
echo "  Pass: $PASS  Warn: $WARN  Fail: $FAIL_COUNT"
echo "======================================="
echo ""
echo " Start working:"
echo "   claude @friday              - engineering tasks"
echo "   claude @jarvis              - strategy / cross-domain"
echo "   claude @nat                 - business / GTM"
echo ""
echo " New repo:"
echo "   node $SCRIPT_DIR/tools/bootstrap-repo.js  (or bootstrap-repo.ps1 on Windows)"
echo ""
echo " After editing agents:"
echo "   node $SCRIPT_DIR/tools/sync-agents.js"
echo ""
if [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW} Warnings above - check output and re-run if needed.${NC}"
fi