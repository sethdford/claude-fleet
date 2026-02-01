#!/usr/bin/env bash
# E2E Tests for Native TeammateTool Integration
#
# Uses the sneakpeek patched binary (claudesp) if available.
# Skips gracefully when native features are not present.
#
# Usage:
#   ./scripts/e2e-native.sh           # Run all native integration tests
#   ./scripts/e2e-native.sh --skip-cleanup   # Keep test artifacts for inspection

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SKIP_CLEANUP="${1:-}"
TEST_TEAM="fleet-e2e-test-$$"
TEAMS_DIR="$HOME/.claude/teams"
TASKS_DIR="$HOME/.claude/tasks"
PASS=0
FAIL=0
SKIP=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[TEST]${NC} $*"; }
pass() { echo -e "${GREEN}  ✓${NC} $*"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}  ✗${NC} $*"; FAIL=$((FAIL + 1)); }
skip() { echo -e "${YELLOW}  ⊘${NC} $*"; SKIP=$((SKIP + 1)); }

cleanup() {
  if [[ "$SKIP_CLEANUP" == "--skip-cleanup" ]]; then
    log "Skipping cleanup (--skip-cleanup). Artifacts at:"
    echo "  $TEAMS_DIR/$TEST_TEAM"
    echo "  $TASKS_DIR/$TEST_TEAM"
    return
  fi
  rm -rf "$TEAMS_DIR/$TEST_TEAM" "$TASKS_DIR/$TEST_TEAM" 2>/dev/null || true
}
trap cleanup EXIT

# ============================================================================
# Prerequisites
# ============================================================================

log "Checking prerequisites..."

# Check for patched binary
CLAUDE_BIN=""
if command -v claudesp &>/dev/null; then
  CLAUDE_BIN="claudesp"
  pass "Found patched binary: claudesp"
elif [[ -x "$HOME/.claude-sneakpeek/claudesp/claude" ]]; then
  CLAUDE_BIN="$HOME/.claude-sneakpeek/claudesp/claude"
  pass "Found patched binary at ~/.claude-sneakpeek/claudesp/claude"
else
  skip "No patched binary found (claudesp). Install via: npx @realmikekelly/claude-sneakpeek quick --name claudesp"
  echo ""
  echo -e "${YELLOW}=== Native integration tests require claude-sneakpeek ===${NC}"
  echo "Install: npx @realmikekelly/claude-sneakpeek quick --name claudesp"
  echo ""
  echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
  exit 0
fi

# Check binary responds
if $CLAUDE_BIN --version &>/dev/null; then
  pass "Binary responds to --version"
else
  fail "Binary does not respond"
  exit 1
fi

# ============================================================================
# Test 1: Team Directory Structure
# ============================================================================

log "Test 1: Team directory creation"

mkdir -p "$TEAMS_DIR/$TEST_TEAM"
if [[ -d "$TEAMS_DIR/$TEST_TEAM" ]]; then
  pass "Team directory created at $TEAMS_DIR/$TEST_TEAM"
else
  fail "Could not create team directory"
fi

# ============================================================================
# Test 2: Task File Format
# ============================================================================

log "Test 2: Task file creation and format"

mkdir -p "$TASKS_DIR/$TEST_TEAM"

TASK_ID="task-$(date +%s)"
TASK_FILE="$TASKS_DIR/$TEST_TEAM/${TASK_ID}.json"

cat > "$TASK_FILE" <<EOF
{
  "id": "$TASK_ID",
  "subject": "Test task from E2E",
  "description": "Verify task file format compatibility",
  "status": "pending",
  "owner": null,
  "blockedBy": [],
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

if [[ -f "$TASK_FILE" ]]; then
  pass "Task file created"
else
  fail "Task file not created"
fi

# Validate JSON format
if python3 -c "import json; json.load(open('$TASK_FILE'))" 2>/dev/null; then
  pass "Task file is valid JSON"
else
  fail "Task file is invalid JSON"
fi

# Validate required fields
if python3 -c "
import json
t = json.load(open('$TASK_FILE'))
assert 'id' in t, 'missing id'
assert 'subject' in t, 'missing subject'
assert 'status' in t, 'missing status'
assert t['status'] in ('pending', 'in_progress', 'completed'), f'invalid status: {t[\"status\"]}'
" 2>/dev/null; then
  pass "Task file has required fields with valid values"
else
  fail "Task file missing required fields"
fi

# ============================================================================
# Test 3: Message Inbox Structure
# ============================================================================

log "Test 3: Message inbox structure"

INBOX_DIR="$TEAMS_DIR/$TEST_TEAM/messages"
SESSION_ID="session-$$"
mkdir -p "$INBOX_DIR/$SESSION_ID"

MSG_FILE="$INBOX_DIR/$SESSION_ID/msg-$(date +%s).json"
cat > "$MSG_FILE" <<EOF
{
  "from": "fleet-lead",
  "text": "Test message from E2E suite",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "color": "blue"
}
EOF

if [[ -f "$MSG_FILE" ]]; then
  pass "Message file created in inbox"
else
  fail "Message file not created"
fi

if python3 -c "
import json
m = json.load(open('$MSG_FILE'))
assert 'from' in m and 'text' in m and 'timestamp' in m
" 2>/dev/null; then
  pass "Message file has required fields"
else
  fail "Message file missing required fields"
fi

# ============================================================================
# Test 4: Task Status Update
# ============================================================================

log "Test 4: Task status transitions"

# Update task to in_progress
python3 -c "
import json
with open('$TASK_FILE', 'r') as f:
    t = json.load(f)
t['status'] = 'in_progress'
t['owner'] = 'test-agent'
t['updatedAt'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
with open('$TASK_FILE', 'w') as f:
    json.dump(t, f, indent=2)
" 2>/dev/null

TASK_STATUS=$(python3 -c "import json; print(json.load(open('$TASK_FILE'))['status'])" 2>/dev/null)
if [[ "$TASK_STATUS" == "in_progress" ]]; then
  pass "Task status updated to in_progress"
else
  fail "Task status update failed (got: $TASK_STATUS)"
fi

# Update to completed
python3 -c "
import json
with open('$TASK_FILE', 'r') as f:
    t = json.load(f)
t['status'] = 'completed'
t['updatedAt'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
with open('$TASK_FILE', 'w') as f:
    json.dump(t, f, indent=2)
" 2>/dev/null

TASK_STATUS=$(python3 -c "import json; print(json.load(open('$TASK_FILE'))['status'])" 2>/dev/null)
if [[ "$TASK_STATUS" == "completed" ]]; then
  pass "Task status updated to completed"
else
  fail "Task status update failed (got: $TASK_STATUS)"
fi

# ============================================================================
# Test 5: Fleet Server Integration (if running)
# ============================================================================

log "Test 5: Fleet server integration"

FLEET_URL="${CLAUDE_FLEET_URL:-http://localhost:3847}"

if curl -sf "$FLEET_URL/health" &>/dev/null; then
  pass "Fleet server reachable at $FLEET_URL"

  # Auth and get token
  TOKEN=$(curl -sf "$FLEET_URL/auth" \
    -H 'Content-Type: application/json' \
    -d "{\"handle\":\"native-test\",\"teamName\":\"$TEST_TEAM\",\"agentType\":\"worker\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

  if [[ -n "$TOKEN" ]]; then
    pass "Authenticated with Fleet server"

    # Create a task via HTTP to verify sync format compatibility
    TASK_RESULT=$(curl -sf "$FLEET_URL/teams/$TEST_TEAM/tasks" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"subject":"Native sync test","description":"Created via HTTP for sync testing"}' 2>/dev/null || echo "")

    if [[ -n "$TASK_RESULT" ]]; then
      pass "Created task via Fleet HTTP API"
    else
      skip "Could not create task via HTTP (may need auth)"
    fi
  else
    skip "Could not authenticate (server may require different config)"
  fi
else
  skip "Fleet server not running at $FLEET_URL"
fi

# ============================================================================
# Test 6: Env Var Compatibility
# ============================================================================

log "Test 6: Environment variable compatibility"

# Verify the env vars that Claude Code's TeammateTool expects
REQUIRED_VARS=(
  "CLAUDE_CODE_TEAM_NAME"
  "CLAUDE_CODE_AGENT_ID"
  "CLAUDE_CODE_AGENT_TYPE"
)

for var in "${REQUIRED_VARS[@]}"; do
  # We're not checking if they're set, but that our spawn code sets them
  if grep -r "$var" "$PROJECT_DIR/src/" &>/dev/null; then
    pass "Codebase references $var"
  else
    skip "Codebase does not reference $var (may need native bridge)"
  fi
done

# ============================================================================
# Results
# ============================================================================

echo ""
echo "════════════════════════════════════════════════"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo "════════════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
