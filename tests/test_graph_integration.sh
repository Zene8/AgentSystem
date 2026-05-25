#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()   { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_SLUG="test-graph-$(date +%s)"
NEXUS_DIR="$REPO_ROOT/nexus/$TEST_SLUG"

# On Windows/Git-Bash, node needs Windows-style paths; cygpath converts them.
# On Linux/macOS, cygpath is absent — fall back to identity.
to_node_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    echo "$1"
  fi
}

REPO_ROOT_N="$(to_node_path "$REPO_ROOT")"

cleanup() { rm -rf "$NEXUS_DIR"; }
trap cleanup EXIT

echo "=== Test: graph-init creates repo brain ==="
node "$REPO_ROOT/tools/graph/graph-init.js" "$TEST_SLUG" "$REPO_ROOT_N" 2>/dev/null
[ -f "$NEXUS_DIR/graph.json" ] && ok "graph.json created" || fail "graph.json missing"
[ -d "$NEXUS_DIR/nodes" ]      && ok "nodes/ dir created" || fail "nodes/ dir missing"
[ -f "$NEXUS_DIR/INDEX.md" ]   && ok "INDEX.md created"   || fail "INDEX.md missing"

echo "=== Test: graph-init idempotent ==="
NEXUS_DIR_N="$(to_node_path "$NEXUS_DIR")"
NODES_BEFORE=$(node -e "const g=JSON.parse(require('fs').readFileSync('$(echo "$NEXUS_DIR_N" | sed "s/\\\\/\\\\\\\\/g")/graph.json','utf8')); console.log(g.nodes.length)")
node "$REPO_ROOT/tools/graph/graph-init.js" "$TEST_SLUG" "$REPO_ROOT_N" 2>/dev/null
NODES_AFTER=$(node -e "const g=JSON.parse(require('fs').readFileSync('$(echo "$NEXUS_DIR_N" | sed "s/\\\\/\\\\\\\\/g")/graph.json','utf8')); console.log(g.nodes.length)")
[ "$NODES_BEFORE" = "$NODES_AFTER" ] && ok "idempotent: node count stable" || fail "idempotent: node count changed ($NODES_BEFORE -> $NODES_AFTER)"

echo "=== Test: graph-init creates hotfile nodes ==="
HOTFILES=$(ls "$NEXUS_DIR/nodes/hotfile-"* 2>/dev/null | wc -l)
[ "$HOTFILES" -gt 0 ] && ok "hotfile nodes created ($HOTFILES)" || fail "no hotfile nodes"

echo "=== Test: graph-init creates commit nodes ==="
COMMITS=$(ls "$NEXUS_DIR/nodes/commit-"* 2>/dev/null | wc -l)
[ "$COMMITS" -gt 0 ] && ok "commit nodes created ($COMMITS)" || fail "no commit nodes"

echo "=== Test: graph-init creates file nodes ==="
FILE_NODES=$(ls "$NEXUS_DIR/nodes/file-"* 2>/dev/null | wc -l)
[ "$FILE_NODES" -gt 0 ] && ok "file nodes created ($FILE_NODES)" || fail "no file nodes"

echo "=== Test: graph.json has valid structure ==="
GRAPH_FILE="$(echo "$NEXUS_DIR_N" | sed 's/\\/\\\\/g')/graph.json"
node -e "
const g = JSON.parse(require('fs').readFileSync('$GRAPH_FILE', 'utf8'));
if (g.version !== '1.0') process.exit(1);
if (g.brain !== 'repo') process.exit(1);
if (!Array.isArray(g.nodes)) process.exit(1);
if (!Array.isArray(g.edges)) process.exit(1);
console.log('valid');
" 2>/dev/null && ok "graph.json structure valid" || fail "graph.json invalid structure"

echo "=== Test: graph-query returns results ==="
QUERY_OUT=$(node "$REPO_ROOT/tools/graph/graph-query.js" "$TEST_SLUG" agent 2>/dev/null)
[ -n "$QUERY_OUT" ] && ok "graph-query returns output" || fail "graph-query returned nothing"

echo "=== Test: graph-query --json outputs valid JSON ==="
node "$REPO_ROOT/tools/graph/graph-query.js" "$TEST_SLUG" agent --json 2>/dev/null \
  | node -e "try { const d=require('fs').readFileSync(0,'utf8'); JSON.parse(d); console.log('ok'); } catch(e) { process.exit(1); }" \
  && ok "graph-query --json valid" || fail "graph-query --json invalid"

echo ""
echo "========================================"
printf "  PASSED: %d\n" $PASS
printf "  FAILED: %d\n" $FAIL
echo "========================================"
[ $FAIL -eq 0 ] && echo "RESULT: PASSED" && exit 0 || echo "RESULT: FAILED" && exit 1
