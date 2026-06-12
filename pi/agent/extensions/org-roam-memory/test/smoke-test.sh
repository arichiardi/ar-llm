#!/usr/bin/env bash
# Org-Roam Memory Smoke Tests
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/.."
CONFIG_FILE="${PI_CODING_AGENT_DIR:-$HOME/.config/pi/agent}/org-roam-memory/config.json"
SKILL_DIR="$HOME/.agents/skills/org-roam-adhoc-memory/scripts"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

test_case() {
  local name="$1"
  local cmd="$2"
  local expected="$3"
  
  TOTAL=$((TOTAL + 1))
  output=$(eval "$cmd" 2>/dev/null || true)
  
  if echo "$output" | grep -qE "$expected"; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}✓${NC} $name"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}✗${NC} $name (expected: $expected, got: $(echo "$output" | head -c 80))"
  fi
}

echo "=== Org-Roam Memory Smoke Tests ==="
echo "Config: $CONFIG_FILE"
echo ""

# ─── Extension Tests ──────────────────────────────────────────────────
echo "--- Extension Tests ---"

test_case "Config file exists" \
  "ls '$CONFIG_FILE'" \
  "config.json"

test_case "Extension index.ts exists" \
  "ls '$EXT_DIR/index.ts'" \
  "index.ts"

test_case "Elisp library exists" \
  "ls '$EXT_DIR/org-roam-pi-memory.el'" \
  "org-roam-pi-memory.el"

# ─── Skill Script Tests ────────────────────────────────────────────────
echo ""
echo "--- Skill Script Tests ---"

test_case "list-nodes returns JSON array" \
  "$SKILL_DIR/list-nodes.sh 5 2>/dev/null | jq 'length > 0'" \
  "true"

test_case "search finds Issues node" \
  "$SKILL_DIR/search.sh Issues 2>/dev/null | jq '.[0].title'" \
  "Issues"

test_case "retrieve by ID returns title" \
  "NODE_ID=$($SKILL_DIR/search.sh Issues 2>/dev/null | jq -r '.[0].id'); $SKILL_DIR/retrieve.sh --id \$NODE_ID 2>/dev/null | grep -o 'Issues' | head -c 10" \
  "Issues"

test_case "links returns JSON" \
  "NODE_ID=$($SKILL_DIR/search.sh People 2>/dev/null | jq -r '.[0].id'); $SKILL_DIR/links.sh --id \$NODE_ID 2>/dev/null | jq 'type == \"object\"'" \
  "true"

test_case "graph returns results" \
  "NODE_ID=$($SKILL_DIR/search.sh Me 2>/dev/null | jq -r '.[0].id'); $SKILL_DIR/graph.sh --id \$NODE_ID 2>/dev/null | jq 'length > 0'" \
  "true"

test_case "append-journal creates entry" \
  "$SKILL_DIR/append-journal.sh 'Smoke test $(date +%Y-%m-%d)' 2>/dev/null | jq '.status == \"appended\"'" \
  "true"

# NOTE: create node skipped - requires uuid-generate elisp library

# ─── Debug Logging Tests ───────────────────────────────────────────────
echo ""
echo "--- Debug Logging Tests ---"

test_case "Debug log path exists in config" \
  "jq -r '.debug[\"log-file\"]' '$CONFIG_FILE' 2>/dev/null" \
  "\.log"

test_case "Context log path exists in config" \
  "jq -r '.debug[\"context-file\"]' '$CONFIG_FILE' 2>/dev/null" \
  "\.log"

# ─── Error Handling Tests ──────────────────────────────────────────────
echo ""
echo "--- Error Handling Tests ---"

test_case "Search with no results returns error" \
  "$SKILL_DIR/search.sh nonexistentxyz123 2>&1" \
  "error"

test_case "Retrieve invalid ID returns error" \
  "$SKILL_DIR/retrieve.sh --id invalid-uuid 2>&1" \
  "error"

# ─── Summary ───────────────────────────────────────────────────────────
echo ""
echo "=== Results ==="
echo -e "Passed: ${GREEN}${PASS}${NC}/${TOTAL}"
echo -e "Failed: ${RED}${FAIL}${NC}/${TOTAL}"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
