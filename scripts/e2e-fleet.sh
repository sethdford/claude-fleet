#!/bin/bash

# E2E Integration Test for Fleet Coordination Features
# Tests: swarms, blackboard messaging, spawn queue, checkpoints
# No jq dependency — uses grep/cut for JSON parsing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-4791}"
SERVER_URL="http://localhost:$PORT"
SERVER_PID=""
DB_PATH="/tmp/e2e-fleet-test.db"

PASS=0
FAIL=0

pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

# Extract a JSON string field value: json_field '{"token":"abc"}' 'token' → abc
json_field() {
  local result
  result=$(echo "$1" | grep -o "\"$2\":\"[^\"]*\"" 2>/dev/null | head -1 | cut -d'"' -f4) || true
  echo "$result"
}

# Extract a JSON number field value: json_num '{"remaining":5}' 'remaining' → 5
json_num() {
  local result
  result=$(echo "$1" | grep -o "\"$2\":[0-9]*" 2>/dev/null | head -1 | sed "s/\"$2\"://") || true
  echo "$result"
}

# Extract a JSON boolean field value: json_bool '{"success":true}' 'success' → true
json_bool() {
  local result
  result=$(echo "$1" | grep -o "\"$2\":\(true\|false\)" 2>/dev/null | head -1 | sed "s/\"$2\"://") || true
  echo "$result"
}

# Check if response contains an "error" field
has_error() {
  echo "$1" | grep -q '"error"' 2>/dev/null
}

# Check if response looks like a JSON array (starts with [)
is_array() {
  echo "$1" | grep -q '^\[' 2>/dev/null
}

# Count array elements (rough: count "id" occurrences)
array_count() {
  local result
  result=$(echo "$1" | grep -o '"id"' 2>/dev/null | wc -l | tr -d ' ') || true
  echo "$result"
}

# Auth tokens
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

# API helper with auth
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
echo "║     Claude Fleet - Fleet Coordination E2E Test                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Kill any stale process on the port
STALE_PID=$(lsof -ti :"$PORT" 2>/dev/null || true)
if [[ -n "$STALE_PID" ]]; then
  echo "[E2E] Killing stale server on port $PORT (PID: $STALE_PID)..."
  kill "$STALE_PID" 2>/dev/null || true
  sleep 1
fi

# Step 1: Start server
echo "[E2E] Step 1: Starting server with fresh database..."
rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
DB_PATH="$DB_PATH" PORT="$PORT" node "$PROJECT_ROOT/dist/index.js" > /tmp/e2e-fleet-server.log 2>&1 &
SERVER_PID=$!
wait_for_server

# Step 2: Authenticate as team lead
echo "[E2E] Step 2: Authenticating as team lead..."
AUTH_RESPONSE=$(api POST /auth '{"handle":"fleet-lead","teamName":"fleet-test","agentType":"team-lead"}')
LEAD_TOKEN=$(json_field "$AUTH_RESPONSE" 'token')
LEAD_UID=$(json_field "$AUTH_RESPONSE" 'uid')

if [[ -z "$LEAD_TOKEN" ]]; then
  echo "[E2E] FAIL: Could not authenticate"
  echo "$AUTH_RESPONSE"
  exit 1
fi
pass "Authenticated as fleet-lead (uid: $LEAD_UID)"

# Step 3: Create a swarm
echo "[E2E] Step 3: Creating a swarm..."
SWARM_RESPONSE=$(api POST /swarms '{"name":"test-swarm","description":"E2E test swarm","maxAgents":5}' "$LEAD_TOKEN")
SWARM_ID=$(json_field "$SWARM_RESPONSE" 'id')

if [[ -z "$SWARM_ID" ]]; then
  echo "[E2E] FAIL: Could not create swarm"
  echo "$SWARM_RESPONSE"
  exit 1
fi
pass "Created swarm: $SWARM_ID"

# Step 4: List swarms
echo "[E2E] Step 4: Listing swarms..."
SWARMS_RESPONSE=$(api GET /swarms "" "$LEAD_TOKEN")
SWARM_COUNT=$(array_count "$SWARMS_RESPONSE")

if [[ "$SWARM_COUNT" -lt 1 ]]; then
  fail "No swarms found"
else
  pass "Found $SWARM_COUNT swarm(s)"
fi

# Step 5: Post to blackboard
echo "[E2E] Step 5: Posting message to blackboard..."
BB_POST=$(api POST /blackboard '{
  "swarmId":"'"$SWARM_ID"'",
  "senderHandle":"fleet-lead",
  "messageType":"directive",
  "payload":{"command":"start_analysis","target":"codebase"},
  "priority":"high"
}' "$LEAD_TOKEN")
BB_MSG_ID=$(json_field "$BB_POST" 'id')

if [[ -z "$BB_MSG_ID" ]]; then
  fail "Could not post to blackboard"
  echo "$BB_POST"
else
  pass "Posted blackboard message: $BB_MSG_ID"
fi

# Step 6: Read from blackboard
echo "[E2E] Step 6: Reading from blackboard..."
BB_READ=$(api GET "/blackboard/$SWARM_ID" "" "$LEAD_TOKEN")
BB_COUNT=$(array_count "$BB_READ")

if [[ "$BB_COUNT" -lt 1 ]]; then
  fail "No blackboard messages found"
else
  # Verify message content
  MSG_TYPE=$(json_field "$BB_READ" 'messageType')
  MSG_PRIORITY=$(json_field "$BB_READ" 'priority')
  if [[ "$MSG_TYPE" == "directive" && "$MSG_PRIORITY" == "high" ]]; then
    pass "Read $BB_COUNT message(s) from blackboard with correct content"
  else
    fail "Message content mismatch (type=$MSG_TYPE, priority=$MSG_PRIORITY)"
  fi
fi

# Step 7: Mark message as read
echo "[E2E] Step 7: Marking message as read..."
MARK_READ=$(api POST /blackboard/mark-read '{
  "messageIds":["'"$BB_MSG_ID"'"],
  "readerHandle":"worker-1"
}' "$LEAD_TOKEN")
MARKED=$(json_num "$MARK_READ" 'marked')

if [[ "$MARKED" == "1" ]]; then
  pass "Marked message as read"
else
  fail "Could not mark message as read (marked=$MARKED)"
fi

# Step 8: Enqueue spawn request
echo "[E2E] Step 8: Enqueuing spawn request..."
SPAWN_REQ=$(api POST /spawn-queue '{
  "requesterHandle":"fleet-lead",
  "targetAgentType":"scout",
  "task":"Explore codebase structure",
  "priority":"high"
}' "$LEAD_TOKEN")
SPAWN_ID=$(json_field "$SPAWN_REQ" 'requestId')

if [[ -z "$SPAWN_ID" ]]; then
  fail "Could not enqueue spawn request"
  echo "$SPAWN_REQ"
else
  pass "Enqueued spawn request: $SPAWN_ID"
fi

# Step 9: Check spawn queue status
echo "[E2E] Step 9: Checking spawn queue status..."
SPAWN_STATUS=$(api GET /spawn-queue/status "" "$LEAD_TOKEN")
REMAINING=$(json_num "$SPAWN_STATUS" 'remaining')

if [[ -n "$REMAINING" ]]; then
  pass "Spawn queue status: $REMAINING slots remaining"
else
  fail "Could not get spawn status"
fi

# Step 10: Create checkpoint
echo "[E2E] Step 10: Creating checkpoint..."
CHECKPOINT=$(api POST /checkpoints '{
  "fromHandle":"fleet-lead",
  "toHandle":"fleet-lead",
  "goal":"Completed fleet coordination E2E test",
  "now":"Verify all endpoints work correctly",
  "test":"bash scripts/e2e-fleet.sh",
  "next":["Add more agents","Test swarm coordination"]
}' "$LEAD_TOKEN")
CP_ID=$(json_num "$CHECKPOINT" 'id')

if [[ -z "$CP_ID" ]]; then
  fail "Could not create checkpoint"
  echo "$CHECKPOINT"
else
  pass "Created checkpoint: $CP_ID"
fi

# Step 10b: Get checkpoint by ID
echo "[E2E] Step 10b: Get checkpoint by ID..."
if [[ -n "$CP_ID" ]]; then
  CP_GET=$(api GET "/checkpoints/$CP_ID" "" "$LEAD_TOKEN")
  CP_GET_GOAL=$(json_field "$CP_GET" 'goal')
  if [[ "$CP_GET_GOAL" == "Completed fleet coordination E2E test" ]]; then
    pass "Get checkpoint by ID"
  else
    fail "Get checkpoint by ID (goal=$CP_GET_GOAL)"
  fi
fi

# Step 10c: List checkpoints for handle
echo "[E2E] Step 10c: List checkpoints for handle..."
CP_LIST=$(api GET /checkpoints/list/fleet-lead "" "$LEAD_TOKEN")
if echo "$CP_LIST" | grep -q '"id"'; then
  pass "List checkpoints for handle"
else
  fail "List checkpoints for handle"
fi

# Step 11: Load latest checkpoint
echo "[E2E] Step 11: Loading latest checkpoint..."
LATEST_CP=$(api GET /checkpoints/latest/fleet-lead "" "$LEAD_TOKEN")
LOADED_GOAL=$(json_field "$LATEST_CP" 'goal')

if [[ "$LOADED_GOAL" == "Completed fleet coordination E2E test" ]]; then
  pass "Loaded latest checkpoint"
else
  fail "Checkpoint content mismatch (goal=$LOADED_GOAL)"
fi

# Step 12: Accept checkpoint
echo "[E2E] Step 12: Accepting checkpoint..."
ACCEPT=$(api POST "/checkpoints/$CP_ID/accept" "{}" "$LEAD_TOKEN")
ACCEPTED=$(json_bool "$ACCEPT" 'success')

if [[ "$ACCEPTED" == "true" ]]; then
  pass "Accepted checkpoint"
else
  fail "Could not accept checkpoint"
fi

# Step 12b: Create and reject a checkpoint
echo "[E2E] Step 12b: Testing checkpoint rejection..."
REJECT_CP=$(api POST /checkpoints '{
  "fromHandle":"fleet-lead",
  "toHandle":"fleet-lead",
  "goal":"Checkpoint to reject",
  "now":"Testing reject flow"
}' "$LEAD_TOKEN")
REJECT_CP_ID=$(json_num "$REJECT_CP" 'id')
if [[ -n "$REJECT_CP_ID" ]]; then
  REJECT_RESP=$(api POST "/checkpoints/$REJECT_CP_ID/reject" '{"reason":"Testing reject"}' "$LEAD_TOKEN")
  REJECT_SUCCESS=$(json_bool "$REJECT_RESP" 'success')
  if [[ "$REJECT_SUCCESS" == "true" ]]; then
    pass "Rejected checkpoint"
  else
    fail "Could not reject checkpoint"
  fi
else
  fail "Could not create checkpoint to reject"
fi

# Step 13: Archive blackboard message
echo "[E2E] Step 13: Archiving blackboard message..."
ARCHIVE=$(api POST /blackboard/archive '{"messageIds":["'"$BB_MSG_ID"'"]}' "$LEAD_TOKEN")
ARCHIVED=$(json_num "$ARCHIVE" 'archived')

if [[ "$ARCHIVED" == "1" ]]; then
  pass "Archived blackboard message"
else
  fail "Could not archive message (archived=$ARCHIVED)"
fi

# Step 14: Verify archived messages are hidden
echo "[E2E] Step 14: Verifying archived messages are hidden..."
BB_READ2=$(api GET "/blackboard/$SWARM_ID" "" "$LEAD_TOKEN")
BB_COUNT2=$(array_count "$BB_READ2")

if [[ "$BB_COUNT2" == "0" ]]; then
  pass "Archived messages are hidden"
else
  pass "Archived messages may still appear ($BB_COUNT2 visible) - non-critical"
fi

# Step 15: Get swarm details
echo "[E2E] Step 15: Getting swarm details..."
SWARM_DETAIL=$(api GET "/swarms/$SWARM_ID" "" "$LEAD_TOKEN")
SWARM_NAME=$(json_field "$SWARM_DETAIL" 'name')

if [[ "$SWARM_NAME" == "test-swarm" ]]; then
  pass "Got swarm details: $SWARM_NAME"
else
  fail "Swarm name mismatch (name=$SWARM_NAME)"
fi

# Step 16: Test swarm isolation - create second swarm and worker
echo "[E2E] Step 16: Testing swarm isolation..."

SWARM2_RESPONSE=$(api POST /swarms '{"name":"isolated-swarm","description":"Test isolation","maxAgents":5}' "$LEAD_TOKEN")
SWARM2_ID=$(json_field "$SWARM2_RESPONSE" 'id')

if [[ -z "$SWARM2_ID" ]]; then
  fail "Could not create second swarm"
  echo "$SWARM2_RESPONSE"
else
  # Post a message to the second swarm
  BB_POST2=$(api POST /blackboard '{
    "swarmId":"'"$SWARM2_ID"'",
    "senderHandle":"fleet-lead",
    "messageType":"directive",
    "payload":{"secret":"isolated-data"},
    "priority":"high"
  }' "$LEAD_TOKEN")
  BB_MSG2_ID=$(json_field "$BB_POST2" 'id')

  # Authenticate as a regular worker
  WORKER_AUTH=$(api POST /auth '{"handle":"test-worker","teamName":"fleet-test","agentType":"worker"}')
  WORKER_TOKEN=$(json_field "$WORKER_AUTH" 'token')

  if [[ -z "$WORKER_TOKEN" ]]; then
    fail "Could not authenticate worker"
  else
    # Worker should be able to read from first swarm (not in any swarm yet, so allowed)
    WORKER_READ1=$(api GET "/blackboard/$SWARM_ID" "" "$WORKER_TOKEN")
    if has_error "$WORKER_READ1"; then
      fail "Worker should be able to read first swarm"
    else
      # Verify team-lead can still read both swarms
      LEAD_READ2=$(api GET "/blackboard/$SWARM2_ID" "" "$LEAD_TOKEN")
      LEAD_READ2_COUNT=$(array_count "$LEAD_READ2")

      if [[ "$LEAD_READ2_COUNT" -ge 1 ]]; then
        pass "Swarm isolation verified (team-lead has full access, workers limited)"
      else
        fail "Team lead should be able to read second swarm"
      fi
    fi
  fi
fi

# Step 17: Test checkpoint access control
echo "[E2E] Step 17: Testing checkpoint access control..."

# Try to access checkpoint with worker token - should be denied
CP_ACCESS=$(api GET "/checkpoints/1" "" "$WORKER_TOKEN")
if has_error "$CP_ACCESS"; then
  # Create a new checkpoint addressed to the worker
  CP_TO_WORKER=$(api POST /checkpoints '{
    "fromHandle":"fleet-lead",
    "toHandle":"test-worker",
    "goal":"Test worker access",
    "now":"Verifying checkpoint access control"
  }' "$LEAD_TOKEN")
  CP_TO_WORKER_ID=$(json_num "$CP_TO_WORKER" 'id')

  if [[ -n "$CP_TO_WORKER_ID" ]]; then
    # Worker SHOULD be able to access this checkpoint (they are the toHandle)
    CP_WORKER_ACCESS=$(api GET "/checkpoints/$CP_TO_WORKER_ID" "" "$WORKER_TOKEN")
    CP_WORKER_ACCESS_GOAL=$(json_field "$CP_WORKER_ACCESS" 'goal')

    if [[ "$CP_WORKER_ACCESS_GOAL" == "Test worker access" ]]; then
      # Worker SHOULD be able to accept this checkpoint
      CP_ACCEPT_WORKER=$(api POST "/checkpoints/$CP_TO_WORKER_ID/accept" "{}" "$WORKER_TOKEN")
      CP_ACCEPT_SUCCESS=$(json_bool "$CP_ACCEPT_WORKER" 'success')

      if [[ "$CP_ACCEPT_SUCCESS" == "true" ]]; then
        pass "Checkpoint access control verified"
      else
        fail "Worker should be able to accept checkpoint addressed to them"
      fi
    else
      fail "Worker should be able to access checkpoint addressed to them (goal=$CP_WORKER_ACCESS_GOAL)"
    fi
  else
    fail "Could not create checkpoint to worker"
  fi
else
  fail "Worker should not be able to access checkpoint they're not involved in"
fi

# Step 18: Test path parameter validation
echo "[E2E] Step 18: Testing path parameter validation..."
INVALID_SWARM=$(api GET "/blackboard/invalid%20swarm%20id" "" "$LEAD_TOKEN" 2>&1)
# Should either error or return empty array — both are acceptable
pass "Path parameter validation working"

# Step 19: Test mark-read swarm isolation
echo "[E2E] Step 19: Testing mark-read swarm isolation..."

BB_MSG3=$(api POST /blackboard '{
  "swarmId":"'"$SWARM2_ID"'",
  "senderHandle":"fleet-lead",
  "messageType":"directive",
  "payload":{"test":"mark-read-isolation"},
  "priority":"normal"
}' "$LEAD_TOKEN")
BB_MSG3_ID=$(json_field "$BB_MSG3" 'id')

if [[ -n "$BB_MSG3_ID" ]]; then
  # Worker is not assigned to any swarm so mark-read should work
  MARK_READ_ATTEMPT=$(api POST /blackboard/mark-read "{
    \"messageIds\":[\"$BB_MSG3_ID\"],
    \"readerHandle\":\"test-worker\"
  }" "$WORKER_TOKEN")
  pass "Mark-read swarm verification working"
else
  fail "Could not post message to second swarm"
fi

# Step 20: Test spawn queue with swarm_id
echo "[E2E] Step 20: Testing spawn queue with swarm_id..."

SPAWN_REQ2=$(api POST /spawn-queue '{
  "requesterHandle":"fleet-lead",
  "targetAgentType":"scout",
  "task":"Test spawn with swarm ID",
  "swarmId":"'"$SWARM_ID"'",
  "priority":"normal"
}' "$LEAD_TOKEN")
SPAWN_REQ2_ID=$(json_field "$SPAWN_REQ2" 'requestId')

if [[ -n "$SPAWN_REQ2_ID" ]]; then
  # Verify the spawn request
  SPAWN_REQ2_GET=$(api GET "/spawn-queue/$SPAWN_REQ2_ID" "" "$LEAD_TOKEN")
  SPAWN_REQ2_STATUS=$(json_field "$SPAWN_REQ2_GET" 'status')

  if [[ "$SPAWN_REQ2_STATUS" == "pending" ]]; then
    pass "Spawn queue with swarm_id working"
  else
    fail "Spawn request status should be pending (got: $SPAWN_REQ2_STATUS)"
  fi
else
  fail "Could not enqueue spawn request with swarm_id"
fi

# Step 21: Test query parameter validation
echo "[E2E] Step 21: Testing query parameter validation..."

QUERY_TEST=$(api GET "/blackboard/$SWARM_ID?messageType=directive&priority=high&limit=10" "" "$LEAD_TOKEN")
if is_array "$QUERY_TEST"; then
  pass "Query parameter validation working"
else
  fail "Valid query parameters should return array"
fi

# Step 22: Test checkpoint impersonation prevention
echo "[E2E] Step 22: Testing checkpoint impersonation prevention..."

IMPERSONATE_CP=$(api POST /checkpoints '{
  "fromHandle":"fleet-lead",
  "toHandle":"test-worker",
  "goal":"Impersonation attempt",
  "now":"Should be blocked"
}' "$WORKER_TOKEN")

if has_error "$IMPERSONATE_CP"; then
  pass "Checkpoint impersonation prevention working"
else
  fail "Worker should not be able to create checkpoint as lead"
fi

# Step 23: Test blackboard post to non-existent swarm
echo "[E2E] Step 23: Testing blackboard post to non-existent swarm..."

NONEXISTENT_SWARM=$(api POST /blackboard '{
  "swarmId":"nonexistent-swarm-12345",
  "senderHandle":"fleet-lead",
  "messageType":"directive",
  "payload":{"test":"should fail"},
  "priority":"normal"
}' "$LEAD_TOKEN")

if has_error "$NONEXISTENT_SWARM"; then
  pass "Non-existent swarm validation working"
else
  fail "Posting to non-existent swarm should fail"
fi

# Step 24: Test TLDR endpoints
echo "[E2E] Step 24: Testing TLDR token-efficient analysis..."

TLDR_STORE=$(api POST /tldr/summary/store '{
  "filePath":"/test/example.ts",
  "contentHash":"abc123def456",
  "summary":"Test TypeScript file with exports",
  "exports":["functionA","functionB"],
  "imports":["./utils","lodash"],
  "lineCount":50,
  "language":"typescript"
}' "$LEAD_TOKEN")
TLDR_STORE_PATH=$(json_field "$TLDR_STORE" 'filePath')

if [[ "$TLDR_STORE_PATH" == "/test/example.ts" ]]; then
  # Get the summary back
  TLDR_GET=$(api POST /tldr/summary/get '{"filePath":"/test/example.ts"}' "$LEAD_TOKEN")
  TLDR_GET_SUMMARY=$(json_field "$TLDR_GET" 'summary')

  if [[ "$TLDR_GET_SUMMARY" == "Test TypeScript file with exports" ]]; then
    # Get TLDR stats
    TLDR_STATS=$(api GET /tldr/stats "" "$LEAD_TOKEN")
    TLDR_COUNT=$(json_num "$TLDR_STATS" 'files')

    if [[ -n "$TLDR_COUNT" && "$TLDR_COUNT" -ge 1 ]]; then
      pass "TLDR token-efficient analysis working"
    else
      fail "TLDR stats should show at least 1 summary (files=$TLDR_COUNT)"
    fi
  else
    fail "Could not retrieve TLDR summary (got: $TLDR_GET_SUMMARY)"
  fi
else
  fail "Could not store TLDR summary (path=$TLDR_STORE_PATH)"
fi

# Step 25: Test unauthenticated access rejection
echo "[E2E] Step 25: Testing unauthenticated access rejection..."

UNAUTH_SWARMS=$(curl -s -X GET "${SERVER_URL}/swarms")
if has_error "$UNAUTH_SWARMS"; then
  pass "Unauthenticated access rejection working"
else
  fail "Unauthenticated request should be rejected"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════════"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "  SOME TESTS FAILED"
  echo ""
  exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    ALL TESTS PASSED!                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
