#!/bin/bash

# E2E Integration Test for Claude Fleet
# Tests the full flow: auth -> create task -> message -> complete task

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PORT=${PORT:-4794}
SERVER_URL="${CLAUDE_FLEET_URL:-http://localhost:$PORT}"
SERVER_PID=""
DB_PATH="/tmp/e2e-test-fleet.db"

# Auth tokens (set after authentication)
LEAD_TOKEN=""
WORKER_TOKEN=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    echo "[E2E] Stopping server (PID: $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
}

trap cleanup EXIT

# API helper that includes auth token if provided
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
      exit 1
    fi
    sleep 1
  done
  echo "[E2E] Server is ready"
}

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║          Claude Fleet - E2E Integration Test                  ║"
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

DB_PATH="$DB_PATH" PORT=$PORT node "$PROJECT_ROOT/dist/index.js" > /tmp/e2e-server.log 2>&1 &
SERVER_PID=$!
wait_for_server

# Step 2: Simulate Team Lead authentication
echo "[E2E] Step 2: Team Lead authenticating..."
LEAD_RESPONSE=$(api POST /auth '{"handle":"lead","teamName":"e2e-team","agentType":"team-lead"}')
LEAD_UID=$(echo "$LEAD_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
LEAD_TOKEN=$(echo "$LEAD_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$LEAD_UID" ]] || [[ -z "$LEAD_TOKEN" ]]; then
  echo "[E2E] FAIL: Lead authentication failed"
  echo "$LEAD_RESPONSE"
  exit 1
fi
echo "[E2E]   Lead UID: $LEAD_UID"

# Step 3: Simulate Worker authentication
echo "[E2E] Step 3: Worker authenticating..."
WORKER_RESPONSE=$(api POST /auth '{"handle":"worker","teamName":"e2e-team","agentType":"worker"}')
WORKER_UID=$(echo "$WORKER_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
WORKER_TOKEN=$(echo "$WORKER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$WORKER_UID" ]] || [[ -z "$WORKER_TOKEN" ]]; then
  echo "[E2E] FAIL: Worker authentication failed"
  echo "$WORKER_RESPONSE"
  exit 1
fi
echo "[E2E]   Worker UID: $WORKER_UID"

# Step 4: Lead creates a task for worker
echo "[E2E] Step 4: Lead creating task for worker..."
TASK_RESPONSE=$(api POST /tasks "{
  \"fromUid\": \"$LEAD_UID\",
  \"toHandle\": \"worker\",
  \"teamName\": \"e2e-team\",
  \"subject\": \"Implement user authentication\",
  \"description\": \"Create JWT-based login system with refresh tokens\"
}" "$LEAD_TOKEN")
TASK_ID=$(echo "$TASK_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$TASK_ID" ]]; then
  echo "[E2E] FAIL: Task creation failed"
  echo "$TASK_RESPONSE"
  exit 1
fi
echo "[E2E]   Task ID: $TASK_ID"

# Step 5: Worker checks their tasks
echo "[E2E] Step 5: Worker checking assigned tasks..."
TASKS_RESPONSE=$(api GET "/teams/e2e-team/tasks" "" "$WORKER_TOKEN")
if ! echo "$TASKS_RESPONSE" | grep -q "Implement user authentication"; then
  echo "[E2E] FAIL: Task not found in team tasks"
  echo "$TASKS_RESPONSE"
  exit 1
fi
echo "[E2E]   Task found in team task list"

# Step 6: Lead broadcasts to team
echo "[E2E] Step 6: Lead broadcasting to team..."
BROADCAST_RESPONSE=$(api POST "/teams/e2e-team/broadcast" "{
  \"from\": \"$LEAD_UID\",
  \"text\": \"Sprint started! Check your assigned tasks.\"
}" "$LEAD_TOKEN")
BROADCAST_ID=$(echo "$BROADCAST_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$BROADCAST_ID" ]]; then
  echo "[E2E] FAIL: Broadcast failed"
  echo "$BROADCAST_RESPONSE"
  exit 1
fi
echo "[E2E]   Broadcast sent: $BROADCAST_ID"

# Step 7: Worker starts working on task
echo "[E2E] Step 7: Worker starting task..."
UPDATE_RESPONSE=$(api PATCH "/tasks/$TASK_ID" '{"status":"in_progress"}' "$WORKER_TOKEN")
if ! echo "$UPDATE_RESPONSE" | grep -q '"in_progress"'; then
  echo "[E2E] FAIL: Task status update failed"
  echo "$UPDATE_RESPONSE"
  exit 1
fi
echo "[E2E]   Task status: in_progress"

# Step 8: Worker sends message to lead
echo "[E2E] Step 8: Creating chat between lead and worker..."
CHAT_RESPONSE=$(api POST /chats "{\"uid1\":\"$LEAD_UID\",\"uid2\":\"$WORKER_UID\"}" "$WORKER_TOKEN")
CHAT_ID=$(echo "$CHAT_RESPONSE" | grep -o '"chatId":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$CHAT_ID" ]]; then
  echo "[E2E] FAIL: Chat creation failed"
  echo "$CHAT_RESPONSE"
  exit 1
fi
echo "[E2E]   Chat ID: $CHAT_ID"

echo "[E2E] Step 9: Worker sending message to lead..."
MSG_RESPONSE=$(api POST "/chats/$CHAT_ID/messages" "{
  \"from\": \"$WORKER_UID\",
  \"text\": \"I've started working on the auth task. Should I use JWT or session-based auth?\"
}" "$WORKER_TOKEN")
MSG_ID=$(echo "$MSG_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$MSG_ID" ]]; then
  echo "[E2E] FAIL: Message send failed"
  echo "$MSG_RESPONSE"
  exit 1
fi
echo "[E2E]   Message sent: $MSG_ID"

# Step 10: Lead replies
echo "[E2E] Step 10: Lead replying..."
REPLY_RESPONSE=$(api POST "/chats/$CHAT_ID/messages" "{
  \"from\": \"$LEAD_UID\",
  \"text\": \"Use JWT with short-lived access tokens and longer refresh tokens.\"
}" "$LEAD_TOKEN")
REPLY_ID=$(echo "$REPLY_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$REPLY_ID" ]]; then
  echo "[E2E] FAIL: Reply failed"
  echo "$REPLY_RESPONSE"
  exit 1
fi
echo "[E2E]   Reply sent: $REPLY_ID"

# Step 11: Check messages in chat
echo "[E2E] Step 11: Verifying chat messages..."
MESSAGES_RESPONSE=$(api GET "/chats/$CHAT_ID/messages" "" "$WORKER_TOKEN")
MSG_COUNT=$(echo "$MESSAGES_RESPONSE" | grep -o '"id"' | wc -l | tr -d ' ')
if [[ "$MSG_COUNT" -lt 2 ]]; then
  echo "[E2E] FAIL: Expected at least 2 messages, got $MSG_COUNT"
  echo "$MESSAGES_RESPONSE"
  exit 1
fi
echo "[E2E]   Found $MSG_COUNT messages in chat"

# Step 12: Worker marks chat as read
echo "[E2E] Step 12: Worker marking chat as read..."
READ_RESPONSE=$(api POST "/chats/$CHAT_ID/read" "{\"uid\":\"$WORKER_UID\"}" "$WORKER_TOKEN")
if ! echo "$READ_RESPONSE" | grep -q '"success":true'; then
  echo "[E2E] FAIL: Mark as read failed"
  echo "$READ_RESPONSE"
  exit 1
fi
echo "[E2E]   Chat marked as read"

# Step 13: Worker completes task
echo "[E2E] Step 13: Worker completing task..."
COMPLETE_RESPONSE=$(api PATCH "/tasks/$TASK_ID" '{"status":"resolved"}' "$WORKER_TOKEN")
if ! echo "$COMPLETE_RESPONSE" | grep -q '"resolved"'; then
  echo "[E2E] FAIL: Task completion failed"
  echo "$COMPLETE_RESPONSE"
  exit 1
fi
echo "[E2E]   Task status: resolved"

# Step 14: Verify final state
echo "[E2E] Step 14: Verifying final state..."
HEALTH_RESPONSE=$(api GET /health)
AGENTS=$(echo "$HEALTH_RESPONSE" | grep -o '"agents":[0-9]*' | cut -d':' -f2)
CHATS=$(echo "$HEALTH_RESPONSE" | grep -o '"chats":[0-9]*' | cut -d':' -f2)
MESSAGES=$(echo "$HEALTH_RESPONSE" | grep -o '"messages":[0-9]*' | cut -d':' -f2)

echo "[E2E]   Agents: $AGENTS"
echo "[E2E]   Chats: $CHATS"
echo "[E2E]   Messages: $MESSAGES"

if [[ "$AGENTS" -lt 2 ]] || [[ "$CHATS" -lt 1 ]] || [[ "$MESSAGES" -lt 2 ]]; then
  echo "[E2E] FAIL: Final state verification failed"
  exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    E2E TEST PASSED                            ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  ✓ Server startup                                             ║"
echo "║  ✓ Team Lead authentication + JWT token                       ║"
echo "║  ✓ Worker authentication + JWT token                          ║"
echo "║  ✓ Task creation and assignment (authenticated)               ║"
echo "║  ✓ Team broadcast (authenticated)                             ║"
echo "║  ✓ Task status updates (open → in_progress → resolved)        ║"
echo "║  ✓ Chat creation (authenticated)                              ║"
echo "║  ✓ Message exchange (authenticated)                           ║"
echo "║  ✓ Mark as read (authenticated)                               ║"
echo "║  ✓ Final state verification                                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

exit 0
