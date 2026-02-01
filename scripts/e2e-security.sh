#!/bin/bash

# E2E Security Tests
# Tests: Role enforcement, permission checks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PORT=${PORT:-4795}
SERVER_URL="${CLAUDE_FLEET_URL:-http://localhost:$PORT}"
SERVER_PID=""
DB_PATH="/tmp/e2e-security-fleet.db"

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    echo "[E2E] Stopping server (PID: $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
}

trap cleanup EXIT

COORD_TOKEN=""
WORKER_TOKEN=""

api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"
  local token="${4:-$COORD_TOKEN}"

  if [[ -n "$data" && -n "$token" ]]; then
    curl -s -X "$method" "${SERVER_URL}${endpoint}" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $token" \
      -d "$data"
  elif [[ -n "$data" ]]; then
    curl -s -X "$method" "${SERVER_URL}${endpoint}" \
      -H "Content-Type: application/json" \
      -d "$data"
  elif [[ -n "$token" ]]; then
    curl -s -X "$method" "${SERVER_URL}${endpoint}" \
      -H "Authorization: Bearer $token"
  else
    curl -s -X "$method" "${SERVER_URL}${endpoint}"
  fi
}

wait_for_server() {
  local max_attempts=30
  local attempt=0

  while ! curl -s "${SERVER_URL}/health" > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $max_attempts ]]; then
      echo "[E2E] FAIL: Server did not start within 30 seconds"
      exit 1
    fi
    sleep 1
  done
  echo "[E2E] Server is ready"
}

expect_403() {
  local response="$1"
  local action="$2"

  if echo "$response" | grep -q '"error":"Insufficient permissions"'; then
    echo "[E2E]   ✓ $action correctly denied (403)"
    return 0
  else
    echo "[E2E]   ✗ FAIL: $action should be denied but got:"
    echo "$response"
    return 1
  fi
}

expect_success() {
  local response="$1"
  local action="$2"

  if echo "$response" | grep -q '"error"'; then
    echo "[E2E]   ✗ FAIL: $action should succeed but got error:"
    echo "$response"
    return 1
  else
    echo "[E2E]   ✓ $action succeeded"
    return 0
  fi
}

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║      Claude Code Collab - Security E2E Test                   ║"
echo "║      Role Enforcement & Permission Checks                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Start fresh server
echo "[E2E] Step 1: Starting server with fresh database..."
rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
# Kill any stale process on our port
STALE_PID=$(lsof -ti :$PORT 2>/dev/null) || true
if [[ -n "$STALE_PID" ]]; then
  echo "[E2E] Killing stale process $STALE_PID on port $PORT"
  kill "$STALE_PID" 2>/dev/null || true
  sleep 1
fi

DB_PATH="$DB_PATH" PORT=$PORT node "$PROJECT_ROOT/dist/index.js" > /tmp/e2e-security-server.log 2>&1 &
SERVER_PID=$!
wait_for_server

# Step 2: Authenticate agents
echo "[E2E] Step 2: Authenticating team-lead and worker..."
COORD_RESPONSE=$(api POST /auth '{"handle":"coordinator","teamName":"security-test","agentType":"team-lead"}' "")
COORD_UID=$(echo "$COORD_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
COORD_TOKEN=$(echo "$COORD_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "[E2E]   Team-lead authenticated: $COORD_UID"

WORKER_RESPONSE=$(api POST /auth '{"handle":"worker1","teamName":"security-test","agentType":"worker"}' "")
WORKER_UID=$(echo "$WORKER_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
WORKER_TOKEN=$(echo "$WORKER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "[E2E]   Worker authenticated: $WORKER_UID"

# ============================================================================
# Role Enforcement Tests - Worker Should Be Denied
# ============================================================================

echo ""
echo "─────────────────── WORKER PERMISSION DENIALS ───────────────────"
echo ""

ERRORS=0

# Test 1: Worker tries to spawn
echo "[E2E] Test 1: Worker tries to spawn worker..."
RESULT=$(api POST /orchestrate/spawn '{"handle":"malicious","initialPrompt":"test"}' "$WORKER_TOKEN")
expect_403 "$RESULT" "spawn" || ERRORS=$((ERRORS + 1))

# Test 2: Worker tries to dismiss
echo "[E2E] Test 2: Worker tries to dismiss worker..."
RESULT=$(api POST /orchestrate/dismiss/some-worker '' "$WORKER_TOKEN")
expect_403 "$RESULT" "dismiss" || ERRORS=$((ERRORS + 1))

# Test 3: Worker tries to broadcast
echo "[E2E] Test 3: Worker tries to broadcast..."
RESULT=$(api POST /teams/security-test/broadcast "{\"from\":\"$WORKER_UID\",\"text\":\"malicious\"}" "$WORKER_TOKEN")
expect_403 "$RESULT" "broadcast" || ERRORS=$((ERRORS + 1))

# Test 4: Worker tries to dispatch batch
echo "[E2E] Test 4: Worker tries to dispatch batch..."
RESULT=$(api POST /batches/test-batch/dispatch '{"workerHandle":"target"}' "$WORKER_TOKEN")
expect_403 "$RESULT" "dispatch" || ERRORS=$((ERRORS + 1))

# Test 5: Worker tries to push worktree
echo "[E2E] Test 5: Worker tries to push worktree..."
RESULT=$(api POST /orchestrate/worktree/test/push '' "$WORKER_TOKEN")
expect_403 "$RESULT" "push" || ERRORS=$((ERRORS + 1))

# Test 6: Worker tries to create PR
echo "[E2E] Test 6: Worker tries to create PR..."
RESULT=$(api POST /orchestrate/worktree/test/pr '{"title":"Test","body":"Test PR"}' "$WORKER_TOKEN")
expect_403 "$RESULT" "create PR" || ERRORS=$((ERRORS + 1))

# ============================================================================
# Role Enforcement Tests - Team-Lead Should Be Allowed
# ============================================================================

echo ""
echo "─────────────────── TEAM-LEAD PERMISSION GRANTS ─────────────────"
echo ""

# Test 7: Team-lead CAN spawn
echo "[E2E] Test 7: Team-lead spawns worker..."
RESULT=$(api POST /orchestrate/spawn '{"handle":"legit-worker","initialPrompt":"exit immediately"}' "$COORD_TOKEN")
expect_success "$RESULT" "spawn" || ERRORS=$((ERRORS + 1))
sleep 2

# Test 8: Team-lead CAN broadcast
echo "[E2E] Test 8: Team-lead broadcasts..."
RESULT=$(api POST /teams/security-test/broadcast "{\"from\":\"$COORD_UID\",\"text\":\"Hello team\"}" "$COORD_TOKEN")
expect_success "$RESULT" "broadcast" || ERRORS=$((ERRORS + 1))

# Test 9: Team-lead CAN dismiss
echo "[E2E] Test 9: Team-lead dismisses worker..."
RESULT=$(api POST /orchestrate/dismiss/legit-worker '' "$COORD_TOKEN")
expect_success "$RESULT" "dismiss" || ERRORS=$((ERRORS + 1))

# ============================================================================
# Additional Security Tests
# ============================================================================

echo ""
echo "─────────────────── ADDITIONAL SECURITY TESTS ───────────────────"
echo ""

# Test 10: Missing auth token
echo "[E2E] Test 10: Request without auth token..."
RESULT=$(curl -s -X POST "${SERVER_URL}/orchestrate/spawn" \
  -H "Content-Type: application/json" \
  -d '{"handle":"unauthorized"}')
if echo "$RESULT" | grep -q '"error":"Authentication required"'; then
  echo "[E2E]   ✓ Unauthenticated request rejected"
else
  echo "[E2E]   ✗ FAIL: Should require authentication"
  ERRORS=$((ERRORS + 1))
fi

# Test 11: Invalid auth token
echo "[E2E] Test 11: Request with invalid token..."
RESULT=$(curl -s -X POST "${SERVER_URL}/orchestrate/spawn" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token-here" \
  -d '{"handle":"unauthorized"}')
if echo "$RESULT" | grep -q '"error":"Invalid token"'; then
  echo "[E2E]   ✓ Invalid token rejected"
else
  echo "[E2E]   ✗ FAIL: Should reject invalid token"
  ERRORS=$((ERRORS + 1))
fi

# Test 12: Workers CAN do non-privileged operations
echo "[E2E] Test 12: Worker can read workers list..."
RESULT=$(api GET /orchestrate/workers '' "$WORKER_TOKEN")
if echo "$RESULT" | grep -q '\['; then
  echo "[E2E]   ✓ Worker can read (non-privileged operation)"
else
  echo "[E2E]   ✗ FAIL: Worker should be able to read"
  ERRORS=$((ERRORS + 1))
fi

# ============================================================================
# Results
# ============================================================================

echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo "╔═══════════════════════════════════════════════════════════════╗"
  echo "║            SECURITY E2E TEST PASSED                           ║"
  echo "╠═══════════════════════════════════════════════════════════════╣"
  echo "║  Role Enforcement:                                            ║"
  echo "║  ✓ Workers denied: spawn, dismiss, broadcast, dispatch        ║"
  echo "║  ✓ Workers denied: push, create PR                            ║"
  echo "║  ✓ Team-leads allowed: spawn, broadcast, dismiss              ║"
  echo "║                                                               ║"
  echo "║  Authentication:                                              ║"
  echo "║  ✓ Missing token rejected                                     ║"
  echo "║  ✓ Invalid token rejected                                     ║"
  echo "║  ✓ Workers can perform non-privileged operations              ║"
  echo "╚═══════════════════════════════════════════════════════════════╝"
  echo ""
  exit 0
else
  echo "╔═══════════════════════════════════════════════════════════════╗"
  echo "║            SECURITY E2E TEST FAILED                           ║"
  echo "║            $ERRORS error(s) found                                  ║"
  echo "╚═══════════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi
