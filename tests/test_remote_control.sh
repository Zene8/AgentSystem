#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

AGENTS=("jarvis" "friday" "sam" "ultron" "pym" "leo" "nat" "wanda" "astra" "threepio" "r2d2")

echo "=== Test: agent labels exist in repo ==="
for agent in "${AGENTS[@]}"; do
  LABEL="agent:$agent"
  gh label list 2>/dev/null | grep -q "$LABEL" \
    && ok "label exists: $LABEL" \
    || fail "label missing: $LABEL"
done

echo "=== Test: workflow file exists and is valid YAML ==="
[ -f ".github/workflows/agent-dispatch.yml" ] \
  && ok "workflow file exists" \
  || fail "workflow file missing"

node -e "
  const fs = require('fs');
  const content = fs.readFileSync('.github/workflows/agent-dispatch.yml', 'utf8');
  if (!content.includes('runs-on: self-hosted')) { console.error('missing self-hosted'); process.exit(1); }
  if (!content.includes('agent:')) { console.error('missing agent: trigger'); process.exit(1); }
  console.log('valid');
" 2>/dev/null && ok "workflow has required structure" || fail "workflow missing required structure"

echo "=== Test: issue template exists ==="
[ -f ".github/ISSUE_TEMPLATE/agent-task.md" ] \
  && ok "issue template exists" \
  || fail "issue template missing"

echo ""
echo "========================================"
printf "  PASSED: %d\n" $PASS
printf "  FAILED: %d\n" $FAIL
echo "========================================"
[ $FAIL -eq 0 ] && echo "RESULT: PASSED" && exit 0 || echo "RESULT: FAILED" && exit 1
