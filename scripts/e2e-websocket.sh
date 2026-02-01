#!/bin/bash

# E2E Integration Test for WebSocket API
# Tests: Connection, Authentication, Subscriptions, Real-time Events

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PORT=${PORT:-4800}
SERVER_URL="${CLAUDE_FLEET_URL:-http://localhost:$PORT}"
WS_URL="ws://localhost:$PORT/ws"
SERVER_PID=""
DB_PATH="/tmp/e2e-websocket-fleet.db"
LOG_FILE="/tmp/e2e-websocket-server.log"

# Auth tokens
LEAD_TOKEN=""

# Counters
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    echo "[E2E] Stopping server (PID: $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
}

trap cleanup EXIT

# API helper
api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"
  local token="${4:-}"

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
      cat "$LOG_FILE" || true
      exit 1
    fi
    sleep 1
  done
  echo "[E2E] Server is ready"
}

# WebSocket test helper - runs Node.js inline script
ws_test() {
  local test_name="$1"
  local token="$2"
  local test_script="$3"

  local result
  result=$(node -e "
const WebSocket = require('ws');

const ws = new WebSocket('$WS_URL');
const token = '$token';
const results = [];
let messageCount = 0;

ws.on('open', () => {
  $test_script
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  results.push(msg);
  messageCount++;
});

ws.on('error', (err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});

// Wait for messages and then output results
setTimeout(() => {
  ws.close();
  console.log(JSON.stringify({ results, count: messageCount }));
}, 500);
" 2>&1) || true

  echo "$result"
}

# Test assertion helper
assert_ws_response() {
  local response="$1"
  local pattern="$2"
  local test_name="$3"

  if echo "$response" | grep -q "$pattern"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  [PASS] $test_name"
    return 0
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  [FAIL] $test_name - expected pattern '$pattern'"
    echo "         Response: $response"
    return 1
  fi
}

echo ""
echo "========================================================================"
echo "            Claude Fleet - WebSocket E2E Tests                          "
echo "========================================================================"
echo ""

# Step 1: Start server
echo "[E2E] Starting server with fresh database..."
rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
# Kill any stale process on our port
STALE_PID=$(lsof -ti :$PORT 2>/dev/null) || true
if [[ -n "$STALE_PID" ]]; then
  echo "[E2E] Killing stale process $STALE_PID on port $PORT"
  kill "$STALE_PID" 2>/dev/null || true
  sleep 1
fi

DB_PATH="$DB_PATH" PORT=$PORT node "$PROJECT_ROOT/dist/index.js" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
wait_for_server

# Step 2: Authenticate
echo "[E2E] Authenticating as team lead..."
LEAD_RESPONSE=$(api POST /auth '{"handle":"ws-lead","teamName":"ws-team","agentType":"team-lead"}')
LEAD_UID=$(echo "$LEAD_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
LEAD_TOKEN=$(echo "$LEAD_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$LEAD_UID" ]] || [[ -z "$LEAD_TOKEN" ]]; then
  echo "[E2E] FAIL: Authentication failed"
  echo "$LEAD_RESPONSE"
  exit 1
fi
echo "[E2E] Authenticated as: $LEAD_UID"

# Also authenticate a worker
WORKER_RESPONSE=$(api POST /auth '{"handle":"ws-worker","teamName":"ws-team","agentType":"worker"}')
WORKER_UID=$(echo "$WORKER_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
WORKER_TOKEN=$(echo "$WORKER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo ""
echo "--- WEBSOCKET TESTS ---"

# Test 1: Ping/Pong
echo "[E2E] Testing ping/pong..."
PING_RESULT=$(ws_test "ping" "$LEAD_TOKEN" '
  ws.send(JSON.stringify({ type: "ping" }));
')
assert_ws_response "$PING_RESULT" '"type":"pong"' "Ping returns pong"

# Test 2: Authentication
echo "[E2E] Testing WebSocket authentication..."
AUTH_RESULT=$(ws_test "auth" "$LEAD_TOKEN" "
  ws.send(JSON.stringify({ type: 'auth', token: token }));
")
assert_ws_response "$AUTH_RESULT" '"type":"authenticated"' "Authentication returns authenticated"
assert_ws_response "$AUTH_RESULT" '"uid"' "Authentication returns uid"

# Test 3: Subscribe without auth should fail
echo "[E2E] Testing subscribe without auth..."
UNAUTH_RESULT=$(ws_test "unauth-subscribe" "$LEAD_TOKEN" '
  ws.send(JSON.stringify({ type: "subscribe", chatId: "test-chat" }));
')
assert_ws_response "$UNAUTH_RESULT" '"type":"error"' "Unauthenticated subscribe returns error"
assert_ws_response "$UNAUTH_RESULT" 'Authentication required' "Error message mentions authentication"

# Test 4: Subscribe with auth
echo "[E2E] Testing authenticated subscribe..."
SUB_RESULT=$(ws_test "subscribe" "$LEAD_TOKEN" "
  // First authenticate
  ws.send(JSON.stringify({ type: 'auth', token: token }));
  // Then subscribe after a short delay
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'subscribe', chatId: 'test-chat-123' }));
  }, 100);
")
assert_ws_response "$SUB_RESULT" '"type":"subscribed"' "Subscribe returns subscribed"
assert_ws_response "$SUB_RESULT" '"chatId":"test-chat-123"' "Subscribe returns chatId"

# Test 5: Invalid token
echo "[E2E] Testing invalid token..."
INVALID_RESULT=$(ws_test "invalid-auth" "" '
  ws.send(JSON.stringify({ type: "auth", token: "invalid-token" }));
')
assert_ws_response "$INVALID_RESULT" '"type":"error"' "Invalid token returns error"

# Test 6: Multiple messages
echo "[E2E] Testing multiple messages..."
MULTI_RESULT=$(ws_test "multi" "$LEAD_TOKEN" "
  ws.send(JSON.stringify({ type: 'ping' }));
  ws.send(JSON.stringify({ type: 'ping' }));
  ws.send(JSON.stringify({ type: 'auth', token: token }));
")
assert_ws_response "$MULTI_RESULT" '"count":3' "Multiple messages all received"

# Test 7: Real-time event broadcast (create a chat and message, check WS receives it)
echo "[E2E] Testing real-time message broadcast..."

# Create a chat first
CHAT_RESPONSE=$(api POST /chats "{\"uid1\":\"$LEAD_UID\",\"uid2\":\"$WORKER_UID\"}" "$LEAD_TOKEN")
CHAT_ID=$(echo "$CHAT_RESPONSE" | grep -o '"chatId":"[^"]*"' | cut -d'"' -f4)

if [[ -n "$CHAT_ID" ]]; then
  # Subscribe and send message in parallel
  BROADCAST_RESULT=$(node -e "
const WebSocket = require('ws');
const http = require('http');

const ws = new WebSocket('$WS_URL');
const token = '$LEAD_TOKEN';
const chatId = '$CHAT_ID';
const leadUid = '$LEAD_UID';
const results = [];

ws.on('open', () => {
  // Authenticate
  ws.send(JSON.stringify({ type: 'auth', token }));

  // Subscribe after auth
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'subscribe', chatId }));
  }, 50);

  // Send HTTP message after subscribe
  setTimeout(() => {
    const data = JSON.stringify({ from: leadUid, text: 'Hello WebSocket!' });
    const options = {
      hostname: 'localhost',
      port: ${PORT},
      path: '/chats/' + chatId + '/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    };
    const req = http.request(options, (res) => {});
    req.write(data);
    req.end();
  }, 150);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  results.push(msg);
});

setTimeout(() => {
  ws.close();
  // Check if we got a new_message event
  const hasNewMessage = results.some(r => r.type === 'new_message');
  console.log(JSON.stringify({ results, hasNewMessage }));
}, 500);
" 2>&1) || true

  assert_ws_response "$BROADCAST_RESULT" '"hasNewMessage":true' "Real-time message broadcast received"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  [FAIL] Real-time message broadcast - could not create chat"
fi

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "========================================================================"
echo "                    E2E WEBSOCKET TEST RESULTS                          "
echo "========================================================================"
echo ""
echo "  Passed: $PASS_COUNT"
echo "  Failed: $FAIL_COUNT"
echo ""

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "  STATUS: FAILED"
  echo ""
  exit 1
fi

echo "  STATUS: PASSED"
echo ""
echo "  Tested WebSocket features:"
echo "    - Ping/Pong heartbeat"
echo "    - JWT Authentication"
echo "    - Unauthenticated subscribe rejection"
echo "    - Authenticated chat subscription"
echo "    - Invalid token handling"
echo "    - Multiple message handling"
echo "    - Real-time message broadcast"
echo ""
echo "  Total: 9 assertions"
echo "========================================================================"
echo ""

exit 0
