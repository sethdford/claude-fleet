#!/bin/bash

# E2E Tests for Rust-accelerated endpoints: Search, LMSH, DAG
# Tests the JS fallback paths (no native Rust required).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PORT=${PORT:-4830}
SERVER_URL="http://localhost:$PORT"
SERVER_PID=""
DB_PATH="/tmp/e2e-native-endpoints.db"

PASS=0
FAIL=0

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
}
trap cleanup EXIT

wait_for_server() {
  local max_attempts=30
  local attempt=0
  while ! curl -s "${SERVER_URL}/health" > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $max_attempts ]]; then
      echo "FAIL: Server did not start"
      exit 1
    fi
    sleep 0.5
  done
}

check() {
  local name=$1
  local field=$2
  local response=$3

  if echo "$response" | jq -e ".$field" > /dev/null 2>&1; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name  (response: $response)"
    FAIL=$((FAIL + 1))
  fi
}

check_status() {
  local name=$1
  local expected_status=$2
  local actual_status=$3

  if [[ "$actual_status" == "$expected_status" ]]; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name  (expected: $expected_status, got: $actual_status)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== E2E: Native Endpoints (Search, LMSH, DAG) ==="
echo ""

# Start server
cd "$PROJECT_ROOT"
PORT=$PORT JWT_SECRET="test-e2e-native" DB_PATH="$DB_PATH" node dist/index.js &
SERVER_PID=$!
wait_for_server

# Authenticate
TOKEN=$(curl -sf -X POST "${SERVER_URL}/auth" \
  -H 'Content-Type: application/json' \
  -d '{"handle":"lead","role":"team-lead","teamName":"e2e-native"}' | jq -r '.token')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "FAIL: Could not get auth token"
  exit 1
fi
echo "  Auth: OK"
echo ""

# ============================================================================
# SEARCH
# ============================================================================
echo "--- Search ---"

R=$(curl -sf -X POST "${SERVER_URL}/search" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"test"}')
check "POST /search" "results" "$R"

R=$(curl -sf "${SERVER_URL}/search/stats" \
  -H "Authorization: Bearer $TOKEN")
check "GET /search/stats" "documentCount" "$R"

# ============================================================================
# LMSH
# ============================================================================
echo "--- LMSH ---"

R=$(curl -sf -X POST "${SERVER_URL}/lmsh/translate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"input":"list all files"}')
check "POST /lmsh/translate" "command" "$R"

R=$(curl -sf "${SERVER_URL}/lmsh/aliases" \
  -H "Authorization: Bearer $TOKEN")
check "GET /lmsh/aliases" "aliases" "$R"

R=$(curl -sf -X POST "${SERVER_URL}/lmsh/aliases" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pattern":"deploy prod","command":"ssh prod deploy.sh"}')
check "POST /lmsh/aliases (create)" "success" "$R"

# Verify alias persisted
R=$(curl -sf "${SERVER_URL}/lmsh/aliases" \
  -H "Authorization: Bearer $TOKEN")
ALIAS_COUNT=$(echo "$R" | jq '.aliases | length')
if [[ "$ALIAS_COUNT" -ge 1 ]]; then
  echo "  PASS  GET /lmsh/aliases (verify persist)"
  PASS=$((PASS + 1))
else
  echo "  FAIL  GET /lmsh/aliases (verify persist)"
  FAIL=$((FAIL + 1))
fi

# ============================================================================
# DAG
# ============================================================================
echo "--- DAG ---"

NODES='{"nodes":[{"id":"a","priority":1,"estimatedDuration":10,"dependsOn":[]},{"id":"b","priority":2,"estimatedDuration":5,"dependsOn":["a"]}]}'
CYCLIC='{"nodes":[{"id":"a","priority":1,"estimatedDuration":10,"dependsOn":["b"]},{"id":"b","priority":2,"estimatedDuration":5,"dependsOn":["a"]}]}'
READY='{"nodes":[{"id":"a","priority":1,"estimatedDuration":10,"dependsOn":[]},{"id":"b","priority":2,"estimatedDuration":5,"dependsOn":["a"]}],"completed":["a"]}'

R=$(curl -sf -X POST "${SERVER_URL}/dag/sort" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$NODES")
check "POST /dag/sort" "order" "$R"

R=$(curl -sf -X POST "${SERVER_URL}/dag/cycles" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$CYCLIC")
check "POST /dag/cycles (cyclic)" "hasCycles" "$R"

# Verify cycle detection is correct
HAS_CYCLES=$(echo "$R" | jq '.hasCycles')
check_status "POST /dag/cycles (hasCycles=true)" "true" "$HAS_CYCLES"

# Also test non-cyclic
R=$(curl -sf -X POST "${SERVER_URL}/dag/cycles" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$NODES")
check "POST /dag/cycles (acyclic)" "hasCycles" "$R"
NO_CYCLES=$(echo "$R" | jq '.hasCycles')
check_status "POST /dag/cycles (hasCycles=false)" "false" "$NO_CYCLES"

R=$(curl -sf -X POST "${SERVER_URL}/dag/critical-path" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$NODES")
check "POST /dag/critical-path" "path" "$R"

R=$(curl -sf -X POST "${SERVER_URL}/dag/ready" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$READY")
check "POST /dag/ready" "ready" "$R"

# Verify 'b' is ready after 'a' is completed
READY_COUNT=$(echo "$R" | jq '.ready | length')
if [[ "$READY_COUNT" -ge 1 ]]; then
  echo "  PASS  POST /dag/ready (b is ready)"
  PASS=$((PASS + 1))
else
  echo "  FAIL  POST /dag/ready (b should be ready)"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
