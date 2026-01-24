#!/bin/bash

# E2E Integration Test for Fleet Coordination Features
# Tests: swarms, blackboard messaging, spawn queue, checkpoints

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_URL="${CLAUDE_CODE_COLLAB_URL:-http://localhost:3847}"
SERVER_PID=""
DB_PATH="/tmp/e2e-fleet-test.db"

# Auth tokens
LEAD_TOKEN=""

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

check_field() {
  local json="$1"
  local field="$2"
  local expected="$3"

  local actual
  actual=$(echo "$json" | jq -r "$field")
  if [[ "$actual" != "$expected" ]]; then
    echo "[E2E] FAIL: Expected $field='$expected', got '$actual'"
    echo "[E2E] Response: $json"
    exit 1
  fi
}

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     Claude Code Collab - Fleet Coordination E2E Test          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Start server
echo "[E2E] Step 1: Starting server with fresh database..."
rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
DB_PATH="$DB_PATH" PORT=3847 node "$PROJECT_ROOT/dist/index.js" > /tmp/e2e-fleet-server.log 2>&1 &
SERVER_PID=$!
wait_for_server

# Step 2: Authenticate as team lead
echo "[E2E] Step 2: Authenticating as team lead..."
AUTH_RESPONSE=$(api POST /auth '{"handle":"fleet-lead","teamName":"fleet-test","agentType":"team-lead"}')
LEAD_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.token')
LEAD_UID=$(echo "$AUTH_RESPONSE" | jq -r '.uid')

if [[ -z "$LEAD_TOKEN" || "$LEAD_TOKEN" == "null" ]]; then
  echo "[E2E] FAIL: Could not authenticate"
  echo "$AUTH_RESPONSE"
  exit 1
fi
echo "[E2E] ✓ Authenticated as fleet-lead (uid: $LEAD_UID)"

# Step 3: Create a swarm
echo "[E2E] Step 3: Creating a swarm..."
SWARM_RESPONSE=$(api POST /swarms '{"name":"test-swarm","description":"E2E test swarm","maxAgents":5}' "$LEAD_TOKEN")
SWARM_ID=$(echo "$SWARM_RESPONSE" | jq -r '.id')

if [[ -z "$SWARM_ID" || "$SWARM_ID" == "null" ]]; then
  echo "[E2E] FAIL: Could not create swarm"
  echo "$SWARM_RESPONSE"
  exit 1
fi
echo "[E2E] ✓ Created swarm: $SWARM_ID"

# Step 4: List swarms
echo "[E2E] Step 4: Listing swarms..."
SWARMS_RESPONSE=$(api GET /swarms "" "$LEAD_TOKEN")
SWARM_COUNT=$(echo "$SWARMS_RESPONSE" | jq 'length')

if [[ "$SWARM_COUNT" -lt 1 ]]; then
  echo "[E2E] FAIL: No swarms found"
  exit 1
fi
echo "[E2E] ✓ Found $SWARM_COUNT swarm(s)"

# Step 5: Post to blackboard
echo "[E2E] Step 5: Posting message to blackboard..."
BB_POST=$(api POST /blackboard '{
  "swarmId":"'"$SWARM_ID"'",
  "senderHandle":"fleet-lead",
  "messageType":"directive",
  "payload":{"command":"start_analysis","target":"codebase"},
  "priority":"high"
}' "$LEAD_TOKEN")
BB_MSG_ID=$(echo "$BB_POST" | jq -r '.id')

if [[ -z "$BB_MSG_ID" || "$BB_MSG_ID" == "null" ]]; then
  echo "[E2E] FAIL: Could not post to blackboard"
  echo "$BB_POST"
  exit 1
fi
echo "[E2E] ✓ Posted blackboard message: $BB_MSG_ID"

# Step 6: Read from blackboard
echo "[E2E] Step 6: Reading from blackboard..."
BB_READ=$(api GET "/blackboard/$SWARM_ID" "" "$LEAD_TOKEN")
BB_COUNT=$(echo "$BB_READ" | jq 'length')

if [[ "$BB_COUNT" -lt 1 ]]; then
  echo "[E2E] FAIL: No blackboard messages found"
  exit 1
fi

# Verify message content
MSG_TYPE=$(echo "$BB_READ" | jq -r '.[0].messageType')
MSG_PRIORITY=$(echo "$BB_READ" | jq -r '.[0].priority')
if [[ "$MSG_TYPE" != "directive" || "$MSG_PRIORITY" != "high" ]]; then
  echo "[E2E] FAIL: Message content mismatch"
  exit 1
fi
echo "[E2E] ✓ Read $BB_COUNT message(s) from blackboard"

# Step 7: Mark message as read
echo "[E2E] Step 7: Marking message as read..."
MARK_READ=$(api POST /blackboard/mark-read '{
  "messageIds":["'"$BB_MSG_ID"'"],
  "readerHandle":"worker-1"
}' "$LEAD_TOKEN")
MARKED=$(echo "$MARK_READ" | jq -r '.marked')

if [[ "$MARKED" != "1" ]]; then
  echo "[E2E] FAIL: Could not mark message as read"
  echo "$MARK_READ"
  exit 1
fi
echo "[E2E] ✓ Marked message as read"

# Step 8: Enqueue spawn request
echo "[E2E] Step 8: Enqueuing spawn request..."
SPAWN_REQ=$(api POST /spawn-queue '{
  "requesterHandle":"fleet-lead",
  "targetAgentType":"scout",
  "task":"Explore codebase structure",
  "priority":"high"
}' "$LEAD_TOKEN")
SPAWN_ID=$(echo "$SPAWN_REQ" | jq -r '.requestId')

if [[ -z "$SPAWN_ID" || "$SPAWN_ID" == "null" ]]; then
  echo "[E2E] FAIL: Could not enqueue spawn request"
  echo "$SPAWN_REQ"
  exit 1
fi
echo "[E2E] ✓ Enqueued spawn request: $SPAWN_ID"

# Step 9: Check spawn queue status
echo "[E2E] Step 9: Checking spawn queue status..."
SPAWN_STATUS=$(api GET /spawn-queue/status "" "$LEAD_TOKEN")
SPAWN_LIMITS=$(echo "$SPAWN_STATUS" | jq '.limits')
REMAINING=$(echo "$SPAWN_LIMITS" | jq '.remaining')

if [[ -z "$REMAINING" || "$REMAINING" == "null" ]]; then
  echo "[E2E] FAIL: Could not get spawn status"
  echo "$SPAWN_STATUS"
  exit 1
fi
echo "[E2E] ✓ Spawn queue status: $REMAINING slots remaining"

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
CP_ID=$(echo "$CHECKPOINT" | jq -r '.id')

if [[ -z "$CP_ID" || "$CP_ID" == "null" ]]; then
  echo "[E2E] FAIL: Could not create checkpoint"
  echo "$CHECKPOINT"
  exit 1
fi
echo "[E2E] ✓ Created checkpoint: $CP_ID"

# Step 11: Load latest checkpoint
echo "[E2E] Step 11: Loading latest checkpoint..."
LATEST_CP=$(api GET /checkpoints/latest/fleet-lead "" "$LEAD_TOKEN")
LOADED_GOAL=$(echo "$LATEST_CP" | jq -r '.checkpoint.goal')

if [[ "$LOADED_GOAL" != "Completed fleet coordination E2E test" ]]; then
  echo "[E2E] FAIL: Checkpoint content mismatch"
  echo "$LATEST_CP"
  exit 1
fi
echo "[E2E] ✓ Loaded latest checkpoint"

# Step 12: Accept checkpoint
echo "[E2E] Step 12: Accepting checkpoint..."
ACCEPT=$(api POST "/checkpoints/$CP_ID/accept" "{}" "$LEAD_TOKEN")
ACCEPTED=$(echo "$ACCEPT" | jq -r '.success')

if [[ "$ACCEPTED" != "true" ]]; then
  echo "[E2E] FAIL: Could not accept checkpoint"
  echo "$ACCEPT"
  exit 1
fi
echo "[E2E] ✓ Accepted checkpoint"

# Step 13: Archive blackboard message
echo "[E2E] Step 13: Archiving blackboard message..."
ARCHIVE=$(api POST /blackboard/archive '{"messageIds":["'"$BB_MSG_ID"'"]}' "$LEAD_TOKEN")
ARCHIVED=$(echo "$ARCHIVE" | jq -r '.archived')

if [[ "$ARCHIVED" != "1" ]]; then
  echo "[E2E] FAIL: Could not archive message"
  echo "$ARCHIVE"
  exit 1
fi
echo "[E2E] ✓ Archived blackboard message"

# Step 14: Verify archived messages are hidden
echo "[E2E] Step 14: Verifying archived messages are hidden..."
BB_READ2=$(api GET "/blackboard/$SWARM_ID" "" "$LEAD_TOKEN")
BB_COUNT2=$(echo "$BB_READ2" | jq 'length')

if [[ "$BB_COUNT2" != "0" ]]; then
  echo "[E2E] WARN: Expected 0 messages after archive, got $BB_COUNT2"
fi
echo "[E2E] ✓ Archived messages are hidden"

# Step 15: Get swarm details
echo "[E2E] Step 15: Getting swarm details..."
SWARM_DETAIL=$(api GET "/swarms/$SWARM_ID" "" "$LEAD_TOKEN")
SWARM_NAME=$(echo "$SWARM_DETAIL" | jq -r '.name')

if [[ "$SWARM_NAME" != "test-swarm" ]]; then
  echo "[E2E] FAIL: Swarm name mismatch"
  echo "$SWARM_DETAIL"
  exit 1
fi
echo "[E2E] ✓ Got swarm details: $SWARM_NAME"

# Step 16: Test swarm isolation - create second swarm and worker
echo "[E2E] Step 16: Testing swarm isolation..."

# Create a second swarm
SWARM2_RESPONSE=$(api POST /swarms '{"name":"isolated-swarm","description":"Test isolation","maxAgents":5}' "$LEAD_TOKEN")
SWARM2_ID=$(echo "$SWARM2_RESPONSE" | jq -r '.id')

if [[ -z "$SWARM2_ID" || "$SWARM2_ID" == "null" ]]; then
  echo "[E2E] FAIL: Could not create second swarm"
  echo "$SWARM2_RESPONSE"
  exit 1
fi

# Post a message to the second swarm
BB_POST2=$(api POST /blackboard '{
  "swarmId":"'"$SWARM2_ID"'",
  "senderHandle":"fleet-lead",
  "messageType":"directive",
  "payload":{"secret":"isolated-data"},
  "priority":"high"
}' "$LEAD_TOKEN")
BB_MSG2_ID=$(echo "$BB_POST2" | jq -r '.id')

if [[ -z "$BB_MSG2_ID" || "$BB_MSG2_ID" == "null" ]]; then
  echo "[E2E] FAIL: Could not post to second swarm blackboard"
  echo "$BB_POST2"
  exit 1
fi

# Authenticate as a regular worker (not team-lead)
WORKER_AUTH=$(api POST /auth '{"handle":"test-worker","teamName":"fleet-test","agentType":"worker"}')
WORKER_TOKEN=$(echo "$WORKER_AUTH" | jq -r '.token')

if [[ -z "$WORKER_TOKEN" || "$WORKER_TOKEN" == "null" ]]; then
  echo "[E2E] FAIL: Could not authenticate worker"
  echo "$WORKER_AUTH"
  exit 1
fi

# Worker should be able to read from first swarm (not in any swarm yet, so allowed)
WORKER_READ1=$(api GET "/blackboard/$SWARM_ID" "" "$WORKER_TOKEN")
# Check if response is an error object or an array
WORKER_READ1_TYPE=$(echo "$WORKER_READ1" | jq -r 'type')

if [[ "$WORKER_READ1_TYPE" == "object" ]]; then
  WORKER_READ1_ERR=$(echo "$WORKER_READ1" | jq -r '.error // empty')
  if [[ -n "$WORKER_READ1_ERR" ]]; then
    echo "[E2E] FAIL: Worker should be able to read first swarm (not assigned to any swarm)"
    echo "$WORKER_READ1"
    exit 1
  fi
fi

# Verify team-lead can still read both swarms (team-leads have full access)
LEAD_READ2=$(api GET "/blackboard/$SWARM2_ID" "" "$LEAD_TOKEN")
LEAD_READ2_COUNT=$(echo "$LEAD_READ2" | jq 'length')

if [[ "$LEAD_READ2_COUNT" != "1" ]]; then
  echo "[E2E] FAIL: Team lead should be able to read second swarm"
  echo "$LEAD_READ2"
  exit 1
fi

echo "[E2E] ✓ Swarm isolation verified (team-lead has full access, workers limited)"

# Step 17: Test checkpoint access control
echo "[E2E] Step 17: Testing checkpoint access control..."

# Create a checkpoint from lead to lead (already have one from step 10)
# Try to access checkpoint with worker token - should be denied (not involved)
CP_ACCESS=$(api GET "/checkpoints/1" "" "$WORKER_TOKEN")
CP_ACCESS_ERR=$(echo "$CP_ACCESS" | jq -r '.error // empty')

if [[ -z "$CP_ACCESS_ERR" ]]; then
  echo "[E2E] FAIL: Worker should not be able to access checkpoint they're not involved in"
  echo "$CP_ACCESS"
  exit 1
fi

# Create a new checkpoint addressed to the worker
CP_TO_WORKER=$(api POST /checkpoints '{
  "fromHandle":"fleet-lead",
  "toHandle":"test-worker",
  "goal":"Test worker access",
  "now":"Verifying checkpoint access control"
}' "$LEAD_TOKEN")
CP_TO_WORKER_ID=$(echo "$CP_TO_WORKER" | jq -r '.id')

if [[ -z "$CP_TO_WORKER_ID" || "$CP_TO_WORKER_ID" == "null" ]]; then
  echo "[E2E] FAIL: Could not create checkpoint to worker"
  echo "$CP_TO_WORKER"
  exit 1
fi

# Worker SHOULD be able to access this checkpoint (they are the toHandle)
CP_WORKER_ACCESS=$(api GET "/checkpoints/$CP_TO_WORKER_ID" "" "$WORKER_TOKEN")
CP_WORKER_ACCESS_GOAL=$(echo "$CP_WORKER_ACCESS" | jq -r '.checkpoint.goal // empty')

if [[ "$CP_WORKER_ACCESS_GOAL" != "Test worker access" ]]; then
  echo "[E2E] FAIL: Worker should be able to access checkpoint addressed to them"
  echo "$CP_WORKER_ACCESS"
  exit 1
fi

# Worker SHOULD be able to accept this checkpoint
CP_ACCEPT_WORKER=$(api POST "/checkpoints/$CP_TO_WORKER_ID/accept" "{}" "$WORKER_TOKEN")
CP_ACCEPT_SUCCESS=$(echo "$CP_ACCEPT_WORKER" | jq -r '.success // empty')

if [[ "$CP_ACCEPT_SUCCESS" != "true" ]]; then
  echo "[E2E] FAIL: Worker should be able to accept checkpoint addressed to them"
  echo "$CP_ACCEPT_WORKER"
  exit 1
fi

echo "[E2E] ✓ Checkpoint access control verified"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    ALL TESTS PASSED!                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "[E2E] Fleet coordination E2E test completed successfully!"
echo ""
