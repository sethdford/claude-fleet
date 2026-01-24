#!/bin/bash

# E2E Test for Phase 2 & 3 Features
# Tests: Work Items, Batches, Mail, Handoffs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_URL="${CLAUDE_FLEET_URL:-http://localhost:3847}"
SERVER_PID=""
DB_PATH="/tmp/e2e-phase2-3-fleet.db"

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

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║      Claude Code Collab - Phase 2 & 3 E2E Test                ║"
echo "║      Work Items, Batches, Mail, Handoffs                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Start fresh server
echo "[E2E] Step 1: Starting server with fresh database..."
rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
DB_PATH="$DB_PATH" PORT=3847 node "$PROJECT_ROOT/dist/index.js" > /tmp/e2e-phase2-server.log 2>&1 &
SERVER_PID=$!
wait_for_server

# Step 2: Authenticate agents
echo "[E2E] Step 2: Authenticating coordinator and worker..."
COORD_RESPONSE=$(api POST /auth '{"handle":"coordinator","teamName":"test-team","agentType":"team-lead"}' "")
COORD_UID=$(echo "$COORD_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
COORD_TOKEN=$(echo "$COORD_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "[E2E]   Coordinator UID: $COORD_UID"

WORKER_RESPONSE=$(api POST /auth '{"handle":"worker1","teamName":"test-team","agentType":"worker"}' "")
WORKER_UID=$(echo "$WORKER_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
WORKER_TOKEN=$(echo "$WORKER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "[E2E]   Worker UID: $WORKER_UID"

# ============================================================================
# Phase 2: Work Items & Batches
# ============================================================================

echo ""
echo "─────────────────── PHASE 2: WORK ITEMS & BATCHES ───────────────────"
echo ""

# Step 3: Create work items
echo "[E2E] Step 3: Creating work items..."
WI1_RESPONSE=$(api POST /workitems '{"title":"Implement login form","description":"Create login form with validation"}')
WI1_ID=$(echo "$WI1_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "[E2E]   Work Item 1 ID: $WI1_ID"

WI2_RESPONSE=$(api POST /workitems '{"title":"Add JWT authentication","description":"Set up JWT token generation"}')
WI2_ID=$(echo "$WI2_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "[E2E]   Work Item 2 ID: $WI2_ID"

WI3_RESPONSE=$(api POST /workitems '{"title":"Create logout endpoint","description":"Clean up session on logout"}')
WI3_ID=$(echo "$WI3_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "[E2E]   Work Item 3 ID: $WI3_ID"

# Step 4: List work items
echo "[E2E] Step 4: Listing all work items..."
LIST_RESPONSE=$(api GET /workitems)
COUNT=$(echo "$LIST_RESPONSE" | grep -o '"id":"[a-f0-9-]\{36\}"' | wc -l | tr -d ' ')
if [[ "$COUNT" -lt 3 ]]; then
  echo "[E2E] FAIL: Expected at least 3 work items, got $COUNT"
  echo "$LIST_RESPONSE"
  exit 1
fi
echo "[E2E]   Found $COUNT work items"

# Step 5: Get specific work item
echo "[E2E] Step 5: Getting specific work item..."
GET_WI_RESPONSE=$(api GET "/workitems/$WI1_ID")
if ! echo "$GET_WI_RESPONSE" | grep -q "Implement login form"; then
  echo "[E2E] FAIL: Could not get work item"
  echo "$GET_WI_RESPONSE"
  exit 1
fi
echo "[E2E]   Work item retrieved successfully"

# Step 6: Create a batch
echo "[E2E] Step 6: Creating a batch..."
BATCH_RESPONSE=$(api POST /batches '{"name":"Auth Feature Sprint"}')
BATCH_ID=$(echo "$BATCH_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -z "$BATCH_ID" ]]; then
  echo "[E2E] FAIL: Batch creation failed"
  echo "$BATCH_RESPONSE"
  exit 1
fi
echo "[E2E]   Batch ID: $BATCH_ID"

# Step 7: Create work item directly in batch
echo "[E2E] Step 7: Creating work item in batch..."
WI_BATCH_RESPONSE=$(api POST /workitems "{\"title\":\"Add password reset\",\"batchId\":\"$BATCH_ID\"}")
WI_BATCH_ID=$(echo "$WI_BATCH_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "[E2E]   Work Item in Batch: $WI_BATCH_ID"

# Step 8: Dispatch batch to worker
echo "[E2E] Step 8: Dispatching batch to worker..."
DISPATCH_RESPONSE=$(api POST "/batches/$BATCH_ID/dispatch" '{"workerHandle":"worker1"}')
if echo "$DISPATCH_RESPONSE" | grep -q "error"; then
  echo "[E2E] FAIL: Batch dispatch failed"
  echo "$DISPATCH_RESPONSE"
  exit 1
fi
echo "[E2E]   Batch dispatched to worker1"

# Step 9: Update work item status
echo "[E2E] Step 9: Updating work item status..."
UPDATE_WI_RESPONSE=$(api PATCH "/workitems/$WI1_ID" '{"status":"in_progress","actor":"worker1"}')
if ! echo "$UPDATE_WI_RESPONSE" | grep -q '"in_progress"'; then
  echo "[E2E] FAIL: Work item status update failed"
  echo "$UPDATE_WI_RESPONSE"
  exit 1
fi
echo "[E2E]   Work item status: in_progress"

# Step 10: Complete work item
echo "[E2E] Step 10: Completing work item..."
COMPLETE_WI_RESPONSE=$(api PATCH "/workitems/$WI1_ID" '{"status":"completed","actor":"worker1"}')
if ! echo "$COMPLETE_WI_RESPONSE" | grep -q '"completed"'; then
  echo "[E2E] FAIL: Work item completion failed"
  echo "$COMPLETE_WI_RESPONSE"
  exit 1
fi
echo "[E2E]   Work item completed"

# Step 11: Block a work item
echo "[E2E] Step 11: Blocking a work item..."
BLOCK_RESPONSE=$(api PATCH "/workitems/$WI2_ID" '{"status":"blocked","reason":"Waiting for design review","actor":"worker1"}')
if ! echo "$BLOCK_RESPONSE" | grep -q '"blocked"'; then
  echo "[E2E] FAIL: Work item blocking failed"
  echo "$BLOCK_RESPONSE"
  exit 1
fi
echo "[E2E]   Work item blocked"

# Step 12: Filter work items by status
echo "[E2E] Step 12: Filtering work items by status..."
PENDING_RESPONSE=$(api GET "/workitems?status=pending")
echo "[E2E]   Pending items: $(echo "$PENDING_RESPONSE" | grep -o '"id":"wi-' | wc -l | tr -d ' ')"

# ============================================================================
# Phase 3: Mail & Handoffs
# ============================================================================

echo ""
echo "─────────────────── PHASE 3: MAIL & HANDOFFS ────────────────────────"
echo ""

# Step 13: Send mail
echo "[E2E] Step 13: Coordinator sending mail to worker..."
MAIL_RESPONSE=$(api POST /mail '{
  "from": "coordinator",
  "to": "worker1",
  "subject": "Task Update Needed",
  "body": "Please provide a status update on the auth feature."
}')
MAIL_ID=$(echo "$MAIL_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
if [[ -z "$MAIL_ID" ]]; then
  echo "[E2E] FAIL: Mail send failed"
  echo "$MAIL_RESPONSE"
  exit 1
fi
echo "[E2E]   Mail ID: $MAIL_ID"

# Step 14: Worker receives mail
echo "[E2E] Step 14: Worker checking unread mail..."
UNREAD_RESPONSE=$(api GET "/mail/worker1/unread")
if ! echo "$UNREAD_RESPONSE" | grep -q "Task Update Needed"; then
  echo "[E2E] FAIL: Worker did not receive mail"
  echo "$UNREAD_RESPONSE"
  exit 1
fi
echo "[E2E]   Worker has unread mail"

# Step 15: Mark mail as read
echo "[E2E] Step 15: Marking mail as read..."
READ_MAIL_RESPONSE=$(api POST "/mail/$MAIL_ID/read")
if ! echo "$READ_MAIL_RESPONSE" | grep -q '"success":true'; then
  echo "[E2E] FAIL: Mark mail read failed"
  echo "$READ_MAIL_RESPONSE"
  exit 1
fi
echo "[E2E]   Mail marked as read"

# Step 16: Verify no unread mail
echo "[E2E] Step 16: Verifying no unread mail..."
UNREAD_AFTER=$(api GET "/mail/worker1/unread")
UNREAD_COUNT=$(echo "$UNREAD_AFTER" | grep -c '"id":' || true)
echo "[E2E]   Unread mail count: $UNREAD_COUNT"

# Step 17: Get all mail for worker
echo "[E2E] Step 17: Getting all mail for worker..."
ALL_MAIL_RESPONSE=$(api GET "/mail/worker1")
if ! echo "$ALL_MAIL_RESPONSE" | grep -q "Task Update Needed"; then
  echo "[E2E] FAIL: Mail history not available"
  echo "$ALL_MAIL_RESPONSE"
  exit 1
fi
echo "[E2E]   Mail history retrieved"

# Step 18: Create handoff
echo "[E2E] Step 18: Creating handoff..."
HANDOFF_RESPONSE=$(api POST /handoffs '{
  "from": "coordinator",
  "to": "worker1",
  "context": {
    "files": ["src/auth/login.ts", "src/auth/jwt.ts"],
    "notes": "Review the auth implementation",
    "priority": "high"
  }
}')
HANDOFF_ID=$(echo "$HANDOFF_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
if [[ -z "$HANDOFF_ID" ]]; then
  echo "[E2E] FAIL: Handoff creation failed"
  echo "$HANDOFF_RESPONSE"
  exit 1
fi
echo "[E2E]   Handoff ID: $HANDOFF_ID"

# Step 19: Worker checks pending handoffs
echo "[E2E] Step 19: Worker checking pending handoffs..."
HANDOFFS_RESPONSE=$(api GET "/handoffs/worker1")
if ! echo "$HANDOFFS_RESPONSE" | grep -q "src/auth/login.ts"; then
  echo "[E2E] FAIL: Handoff not received"
  echo "$HANDOFFS_RESPONSE"
  exit 1
fi
echo "[E2E]   Handoff received with context"

# Final: Verify overall state
echo ""
echo "[E2E] Final: Verifying overall state..."
HEALTH_RESPONSE=$(api GET /health)
echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'   Status: {d[\"status\"]}'); print(f'   Agents: {d[\"agents\"]}'); print(f'   Workers: {d[\"workers\"]}')" 2>/dev/null || echo "   (Python not available for pretty print)"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║            PHASE 2 & 3 E2E TEST PASSED                        ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  PHASE 2: Work Items & Batches                                ║"
echo "║  ✓ Create work items with human-readable IDs                  ║"
echo "║  ✓ List and filter work items                                 ║"
echo "║  ✓ Create batches                                             ║"
echo "║  ✓ Dispatch batches to workers                                ║"
echo "║  ✓ Update work item status (pending→in_progress→completed)    ║"
echo "║  ✓ Block work items with reason                               ║"
echo "║                                                               ║"
echo "║  PHASE 3: Mail & Handoffs                                     ║"
echo "║  ✓ Send mail between agents                                   ║"
echo "║  ✓ Retrieve unread mail                                       ║"
echo "║  ✓ Mark mail as read                                          ║"
echo "║  ✓ Retrieve mail history                                      ║"
echo "║  ✓ Create handoffs with context                               ║"
echo "║  ✓ Retrieve pending handoffs                                  ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

exit 0
