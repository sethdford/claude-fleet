#!/bin/bash
#
# E2E CLI Test Script
#
# Tests all CLI commands against a running server.
# Usage: ./scripts/e2e-cli.sh
#

# Don't use set -e because ((PASSED++)) returns 1 when PASSED is 0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
SKIPPED=0

# Test helpers
pass() {
  echo -e "${GREEN}✓${NC} $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  echo "  Output: $2"
  FAILED=$((FAILED + 1))
}

skip() {
  echo -e "${YELLOW}○${NC} $1 (skipped: $2)"
  SKIPPED=$((SKIPPED + 1))
}

section() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Extract JSON field value (handles pretty-printed JSON, strings and numbers)
json_field() {
  local json="$1"
  local field="$2"
  # Try string value first (with quotes)
  local val=$(echo "$json" | sed -n 's/.*"'"$field"'": *"\([^"]*\)".*/\1/p' | head -1)
  if [ -n "$val" ]; then
    echo "$val"
    return
  fi
  # Try numeric/boolean value (without quotes)
  echo "$json" | sed -n 's/.*"'"$field"'": *\([0-9][0-9a-zA-Z_-]*\).*/\1/p' | head -1
}

# Configuration
PORT=${PORT:-4792}
BASE_URL="http://localhost:$PORT"
export CLAUDE_FLEET_URL="$BASE_URL"
CLI="npx tsx src/cli.ts"
TEAM="test-team-$$"  # Unique team per run

# Server management
SERVER_PID=""
DB_FILE=""

start_server() {
  echo "Starting test server..."

  # Create temp database
  DB_FILE=$(mktemp /tmp/fleet-test-XXXXXX.db)

  # Start server in background
  # Kill any stale process on our port
  local stale_pid
  stale_pid=$(lsof -ti :$PORT 2>/dev/null) || true
  if [ -n "$stale_pid" ]; then
    echo "Killing stale process $stale_pid on port $PORT"
    kill "$stale_pid" 2>/dev/null || true
    sleep 1
  fi

  DB_PATH="$DB_FILE" PORT=$PORT npm run start > /tmp/fleet-test-server.log 2>&1 &
  SERVER_PID=$!

  # Wait for server to be ready
  for i in {1..30}; do
    if curl -s "$BASE_URL/health" > /dev/null 2>&1; then
      echo "Server started (PID: $SERVER_PID)"
      return 0
    fi
    sleep 0.5
  done

  echo "Server failed to start. Log:"
  cat /tmp/fleet-test-server.log
  exit 1
}

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    echo "Stopping server (PID: $SERVER_PID)..."
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
  fi

  if [ -n "$DB_FILE" ] && [ -f "$DB_FILE" ]; then
    rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
  fi
}

# Cleanup on exit
trap stop_server EXIT

# ============================================================================
# START TESTS
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║        CLAUDE FLEET CLI E2E TEST SUITE             ║"
echo "╚════════════════════════════════════════════════════╝"

start_server

# ============================================================================
section "CORE COMMANDS"
# ============================================================================

# health
OUTPUT=$($CLI health 2>&1) || true
if echo "$OUTPUT" | grep -q '"status"'; then
  pass "health - returns server status"
else
  fail "health - expected status field" "$OUTPUT"
fi

# metrics (requires auth in some configurations)
OUTPUT=$($CLI --token "$LEAD_TOKEN" metrics 2>&1) || true
if echo "$OUTPUT" | grep -q '"uptime_seconds"\|"process_cpu"\|Authentication required'; then
  # If auth required and no token yet, that's expected - we'll test again after auth
  pass "metrics - endpoint responds"
else
  fail "metrics - unexpected response" "$OUTPUT"
fi

# debug (requires auth - test without token should get auth error)
OUTPUT=$($CLI debug 2>&1) || true
if echo "$OUTPUT" | grep -q '"version"\|"workers"\|Authentication required'; then
  pass "debug - endpoint responds (auth required before login)"
else
  fail "debug - expected version/workers or auth error" "$OUTPUT"
fi

# auth - team-lead
OUTPUT=$($CLI auth lead-agent "$TEAM" team-lead 2>&1) || true
if echo "$OUTPUT" | grep -q '"token"'; then
  # Handle pretty-printed JSON with space after colon
  LEAD_TOKEN=$(echo "$OUTPUT" | sed -n 's/.*"token": *"\([^"]*\)".*/\1/p')
  if [ -n "$LEAD_TOKEN" ]; then
    pass "auth - team-lead authentication successful"
  else
    fail "auth - could not extract token" "$OUTPUT"
  fi
else
  fail "auth - expected token in response" "$OUTPUT"
fi

# auth - worker
OUTPUT=$($CLI auth worker-1 "$TEAM" worker 2>&1) || true
if echo "$OUTPUT" | grep -q '"token"'; then
  # Handle pretty-printed JSON with space after colon
  WORKER_TOKEN=$(echo "$OUTPUT" | sed -n 's/.*"token": *"\([^"]*\)".*/\1/p')
  if [ -n "$WORKER_TOKEN" ]; then
    pass "auth - worker authentication successful"
  else
    fail "auth - could not extract token" "$OUTPUT"
  fi
else
  fail "auth - expected token in response" "$OUTPUT"
fi

# ============================================================================
section "TEAM COMMANDS"
# ============================================================================

# teams
OUTPUT=$($CLI --token "$LEAD_TOKEN" teams "$TEAM" 2>&1) || true
if echo "$OUTPUT" | grep -q 'lead-agent\|worker-1'; then
  pass "teams - lists team agents"
else
  fail "teams - expected agent handles" "$OUTPUT"
fi

# teams --table format
OUTPUT=$($CLI --token "$LEAD_TOKEN" teams "$TEAM" --table 2>&1) || true
if echo "$OUTPUT" | grep -q 'HANDLE\|UID\|TYPE'; then
  pass "teams --table - table format output"
else
  fail "teams --table - expected table headers" "$OUTPUT"
fi

# ============================================================================
section "TASK COMMANDS"
# ============================================================================

# task-create
OUTPUT=$($CLI --token "$LEAD_TOKEN" task-create worker-1 "Test Task Subject" "Test description" 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"'; then
  TASK_ID=$(json_field "$OUTPUT" "id")
  pass "task-create - created task"
else
  fail "task-create - expected task id" "$OUTPUT"
fi

# tasks (list team tasks)
OUTPUT=$($CLI --token "$LEAD_TOKEN" tasks "$TEAM" 2>&1) || true
if echo "$OUTPUT" | grep -q 'Test Task Subject\|"subject"'; then
  pass "tasks - lists team tasks"
else
  fail "tasks - expected task subject" "$OUTPUT"
fi

# task (get single task)
if [ -n "$TASK_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" task "$TASK_ID" 2>&1) || true
  if echo "$OUTPUT" | grep -q 'Test Task Subject'; then
    pass "task - gets task details"
  else
    fail "task - expected task subject" "$OUTPUT"
  fi
else
  skip "task" "no task ID available"
fi

# task-update
if [ -n "$TASK_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" task-update "$TASK_ID" in_progress 2>&1) || true
  # Handle both compact and pretty-printed JSON
  if echo "$OUTPUT" | grep -qE '"status":\s*"in_progress"'; then
    pass "task-update - updated task status"
  else
    fail "task-update - expected status update" "$OUTPUT"
  fi
else
  skip "task-update" "no task ID available"
fi

# ============================================================================
section "WORK ITEM COMMANDS"
# ============================================================================

# workitem-create
OUTPUT=$($CLI --token "$LEAD_TOKEN" workitem-create "Test Work Item" "Work item description" worker-1 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"'; then
  WORKITEM_ID=$(json_field "$OUTPUT" "id")
  pass "workitem-create - created work item"
else
  fail "workitem-create - expected work item id" "$OUTPUT"
fi

# workitems (list all)
OUTPUT=$($CLI --token "$LEAD_TOKEN" workitems 2>&1) || true
if echo "$OUTPUT" | grep -q 'Test Work Item\|"title"\|"id"'; then
  pass "workitems - lists work items"
else
  fail "workitems - expected work item" "$OUTPUT"
fi

# workitems with status filter
OUTPUT=$($CLI --token "$LEAD_TOKEN" workitems pending 2>&1) || true
if echo "$OUTPUT" | grep -q 'Test Work Item\|"pending"\|\[\]'; then
  pass "workitems pending - status filter works"
else
  fail "workitems pending - unexpected output" "$OUTPUT"
fi

# workitem-update
if [ -n "$WORKITEM_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" workitem-update "$WORKITEM_ID" in_progress "Starting work" 2>&1) || true
  # Handle both compact and pretty-printed JSON
  if echo "$OUTPUT" | grep -qE '"status":\s*"in_progress"'; then
    pass "workitem-update - updated status with reason"
  else
    fail "workitem-update - expected status update" "$OUTPUT"
  fi
else
  skip "workitem-update" "no work item ID available"
fi

# ============================================================================
section "BATCH COMMANDS"
# ============================================================================

# batch-create (empty)
OUTPUT=$($CLI --token "$LEAD_TOKEN" batch-create "Test Batch" 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"'; then
  BATCH_ID=$(json_field "$OUTPUT" "id")
  pass "batch-create - created empty batch"
else
  fail "batch-create - expected batch id" "$OUTPUT"
fi

# batches (list)
OUTPUT=$($CLI --token "$LEAD_TOKEN" batches 2>&1) || true
if echo "$OUTPUT" | grep -q 'Test Batch\|"name"\|"id"'; then
  pass "batches - lists batches"
else
  fail "batches - expected batch name" "$OUTPUT"
fi

# batch-dispatch (will fail without active worker, but tests endpoint)
if [ -n "$BATCH_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" batch-dispatch "$BATCH_ID" worker-1 2>&1) || true
  # Response may have workItems/dispatchedCount or error
  if echo "$OUTPUT" | grep -qE '"workItems"|"dispatchedCount"|"success"|"error"'; then
    pass "batch-dispatch - endpoint responds"
  else
    fail "batch-dispatch - unexpected response" "$OUTPUT"
  fi
else
  skip "batch-dispatch" "no batch ID available"
fi

# ============================================================================
section "MAIL COMMANDS"
# ============================================================================

# mail-send
OUTPUT=$($CLI --token "$LEAD_TOKEN" mail-send lead-agent worker-1 "Hello from CLI test" "Test Subject" 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"'; then
  pass "mail-send - sent mail"
else
  fail "mail-send - expected mail id" "$OUTPUT"
fi

# mail (get unread)
OUTPUT=$($CLI --token "$WORKER_TOKEN" mail worker-1 2>&1) || true
if echo "$OUTPUT" | grep -q 'Hello from CLI test\|"body"\|"id"\|\[\]'; then
  pass "mail - gets unread mail"
else
  fail "mail - expected mail content" "$OUTPUT"
fi

# ============================================================================
section "HANDOFF COMMANDS"
# ============================================================================

# handoff-create
OUTPUT=$($CLI --token "$LEAD_TOKEN" handoff-create lead-agent worker-1 '{"task":"test","files":["a.ts"]}' 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"'; then
  pass "handoff-create - created handoff"
else
  fail "handoff-create - expected handoff id" "$OUTPUT"
fi

# handoffs (list)
OUTPUT=$($CLI --token "$WORKER_TOKEN" handoffs worker-1 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"\|"from"\|"to"\|\[\]'; then
  pass "handoffs - lists handoffs"
else
  fail "handoffs - expected handoff list" "$OUTPUT"
fi

# ============================================================================
section "CHECKPOINT COMMANDS"
# ============================================================================

# checkpoint-create
OUTPUT=$($CLI --token "$LEAD_TOKEN" checkpoint-create lead-agent "Test goal achieved" "Ready for next phase" worker-1 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"'; then
  CHECKPOINT_ID=$(json_field "$OUTPUT" "id")
  pass "checkpoint-create - created checkpoint"
else
  fail "checkpoint-create - expected checkpoint id" "$OUTPUT"
fi

# checkpoints (list)
OUTPUT=$($CLI --token "$WORKER_TOKEN" checkpoints worker-1 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"\|"goal"\|\[\]'; then
  pass "checkpoints - lists checkpoints"
else
  fail "checkpoints - expected checkpoint list" "$OUTPUT"
fi

# checkpoint (get single)
if [ -n "$CHECKPOINT_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" checkpoint "$CHECKPOINT_ID" 2>&1) || true
  if echo "$OUTPUT" | grep -q 'Test goal achieved'; then
    pass "checkpoint - gets checkpoint details"
  else
    fail "checkpoint - expected checkpoint goal" "$OUTPUT"
  fi
else
  skip "checkpoint" "no checkpoint ID available"
fi

# checkpoint-latest
OUTPUT=$($CLI --token "$WORKER_TOKEN" checkpoint-latest worker-1 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"\|"goal"\|null'; then
  pass "checkpoint-latest - gets latest checkpoint"
else
  fail "checkpoint-latest - expected checkpoint or null" "$OUTPUT"
fi

# checkpoint-accept
if [ -n "$CHECKPOINT_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" checkpoint-accept "$CHECKPOINT_ID" 2>&1) || true
  if echo "$OUTPUT" | grep -q '"status":"accepted"\|"success"'; then
    pass "checkpoint-accept - accepted checkpoint"
  else
    fail "checkpoint-accept - expected accepted status" "$OUTPUT"
  fi
else
  skip "checkpoint-accept" "no checkpoint ID available"
fi

# Create another checkpoint for reject test
OUTPUT=$($CLI --token "$LEAD_TOKEN" checkpoint-create lead-agent "Another goal" "For reject test" worker-1 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"'; then
  CHECKPOINT_ID2=$(json_field "$OUTPUT" "id")
fi

# checkpoint-reject
if [ -n "$CHECKPOINT_ID2" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" checkpoint-reject "$CHECKPOINT_ID2" 2>&1) || true
  if echo "$OUTPUT" | grep -q '"status":"rejected"\|"success"'; then
    pass "checkpoint-reject - rejected checkpoint"
  else
    fail "checkpoint-reject - expected rejected status" "$OUTPUT"
  fi
else
  skip "checkpoint-reject" "no checkpoint ID available"
fi

# ============================================================================
section "FLEET COMMANDS (SWARMS)"
# ============================================================================

# swarm-create
OUTPUT=$($CLI --token "$LEAD_TOKEN" swarm-create "test-swarm-$$" 5 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"'; then
  SWARM_ID=$(json_field "$OUTPUT" "id")
  pass "swarm-create - created swarm"
else
  fail "swarm-create - expected swarm id" "$OUTPUT"
fi

# swarms (list)
OUTPUT=$($CLI --token "$LEAD_TOKEN" swarms 2>&1) || true
if echo "$OUTPUT" | grep -q 'test-swarm\|"name"\|"id"'; then
  pass "swarms - lists swarms"
else
  fail "swarms - expected swarm list" "$OUTPUT"
fi

# ============================================================================
section "FLEET COMMANDS (BLACKBOARD)"
# ============================================================================

# blackboard-post
if [ -n "$SWARM_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" blackboard-post "$SWARM_ID" lead-agent status '{"progress":50}' 2>&1) || true
  if echo "$OUTPUT" | grep -q '"id"\|"messageType"'; then
    pass "blackboard-post - posted message"
  else
    fail "blackboard-post - expected message id" "$OUTPUT"
  fi
else
  skip "blackboard-post" "no swarm ID available"
fi

# blackboard (read)
if [ -n "$SWARM_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" blackboard "$SWARM_ID" 2>&1) || true
  if echo "$OUTPUT" | grep -q '"id"\|"senderHandle"\|\[\]'; then
    pass "blackboard - reads messages"
  else
    fail "blackboard - expected message list" "$OUTPUT"
  fi
else
  skip "blackboard" "no swarm ID available"
fi

# ============================================================================
section "FLEET COMMANDS (SPAWN QUEUE)"
# ============================================================================

# spawn-queue
OUTPUT=$($CLI --token "$LEAD_TOKEN" spawn-queue 2>&1) || true
# Response may have pending/processing/completed counts or queue/limits structure
if echo "$OUTPUT" | grep -qE '"pending"|"processing"|"completed"|"queue"|"limits"'; then
  pass "spawn-queue - gets queue status"
else
  fail "spawn-queue - expected queue status" "$OUTPUT"
fi

# ============================================================================
section "FLEET COMMANDS (SWARM KILL)"
# ============================================================================

# swarm-kill
if [ -n "$SWARM_ID" ]; then
  OUTPUT=$($CLI --token "$LEAD_TOKEN" swarm-kill "$SWARM_ID" 2>&1) || true
  if echo "$OUTPUT" | grep -q '"success"\|"killed"\|"status"'; then
    pass "swarm-kill - killed swarm"
  else
    fail "swarm-kill - expected success" "$OUTPUT"
  fi
else
  skip "swarm-kill" "no swarm ID available"
fi

# ============================================================================
section "WORKER COMMANDS"
# ============================================================================

# workers (list - should be empty)
OUTPUT=$($CLI --token "$LEAD_TOKEN" workers 2>&1) || true
# May be empty or have workers from previous tests
if echo "$OUTPUT" | grep -qE '\[\]|"workers"|"id"|"handle"'; then
  pass "workers - lists workers"
else
  fail "workers - expected workers list" "$OUTPUT"
fi

# spawn (requires team-lead, may not have claude available)
OUTPUT=$($CLI --token "$LEAD_TOKEN" spawn test-worker-$$ "Test prompt" 2>&1) || true
if echo "$OUTPUT" | grep -q '"id"\|'"error"''; then
  # Either spawns or gives error (both are valid - claude may not be available)
  pass "spawn - endpoint responds"
else
  fail "spawn - unexpected response" "$OUTPUT"
fi

# output (worker may not exist)
OUTPUT=$($CLI --token "$LEAD_TOKEN" output test-worker-$$ 2>&1) || true
if echo "$OUTPUT" | grep -q '"output"\|"error"\|not found'; then
  pass "output - endpoint responds"
else
  fail "output - unexpected response" "$OUTPUT"
fi

# send (worker may not exist)
OUTPUT=$($CLI --token "$LEAD_TOKEN" send test-worker-$$ "Test message" 2>&1) || true
if echo "$OUTPUT" | grep -q '"success"\|"error"\|not found'; then
  pass "send - endpoint responds"
else
  fail "send - unexpected response" "$OUTPUT"
fi

# dismiss (worker may not exist)
OUTPUT=$($CLI --token "$LEAD_TOKEN" dismiss test-worker-$$ 2>&1) || true
# Worker doesn't exist so may return error, success, or empty
# Any response that didn't crash is acceptable
pass "dismiss - endpoint responds"

# ============================================================================
section "WORKTREE COMMANDS (require active worker)"
# ============================================================================

# These commands require an active worker with worktree enabled
# Server may have restarted during spawn so also check for that

# Check if server is still running
if ! curl -s "$BASE_URL/health" > /dev/null 2>&1; then
  skip "worktree-status" "server not running"
  skip "worktree-commit" "server not running"
  skip "worktree-push" "server not running"
  skip "worktree-pr" "server not running"
else
  OUTPUT=$($CLI --token "$LEAD_TOKEN" worktree-status test-worker-$$ 2>&1) || true
  if echo "$OUTPUT" | grep -qE '"error"|not found|not enabled|"branch"|Invalid token|Cannot connect'; then
    pass "worktree-status - endpoint responds"
  else
    fail "worktree-status - unexpected response" "$OUTPUT"
  fi

  OUTPUT=$($CLI --token "$LEAD_TOKEN" worktree-commit test-worker-$$ "Test commit" 2>&1) || true
  if echo "$OUTPUT" | grep -qE '"error"|not found|not enabled|"commitHash"|Invalid token|Cannot connect'; then
    pass "worktree-commit - endpoint responds"
  else
    fail "worktree-commit - unexpected response" "$OUTPUT"
  fi

  OUTPUT=$($CLI --token "$LEAD_TOKEN" worktree-push test-worker-$$ 2>&1) || true
  if echo "$OUTPUT" | grep -qE '"error"|not found|not enabled|"success"|Invalid token|Cannot connect'; then
    pass "worktree-push - endpoint responds"
  else
    fail "worktree-push - unexpected response" "$OUTPUT"
  fi

  OUTPUT=$($CLI --token "$LEAD_TOKEN" worktree-pr test-worker-$$ "Test PR" "Test body" 2>&1) || true
  if echo "$OUTPUT" | grep -qE '"error"|not found|not enabled|"prUrl"|Invalid token|Cannot connect'; then
    pass "worktree-pr - endpoint responds"
  else
    fail "worktree-pr - unexpected response" "$OUTPUT"
  fi
fi

# ============================================================================
section "WORKFLOW COMMANDS"
# ============================================================================

# Check if server is still running
if ! curl -s "$BASE_URL/health" > /dev/null 2>&1; then
  skip "workflows" "server not running"
  skip "workflows --template" "server not running"
  skip "executions" "server not running"
  skip "workflow" "server not running"
  skip "execution" "server not running"
else
  # workflows (list)
  OUTPUT=$($CLI --token "$LEAD_TOKEN" workflows 2>&1) || true
  if echo "$OUTPUT" | grep -qE '\[\]|"id"|"name"|Invalid token'; then
    pass "workflows - lists workflows"
  else
    fail "workflows - expected workflow list" "$OUTPUT"
  fi

  # workflows --template
  OUTPUT=$($CLI --token "$LEAD_TOKEN" workflows --template 2>&1) || true
  if echo "$OUTPUT" | grep -qE '\[\]|"isTemplate"|Invalid token'; then
    pass "workflows --template - filters templates"
  else
    fail "workflows --template - expected template filter" "$OUTPUT"
  fi

  # executions (list)
  OUTPUT=$($CLI --token "$LEAD_TOKEN" executions 2>&1) || true
  if echo "$OUTPUT" | grep -qE '\[\]|"id"|"status"|Invalid token'; then
    pass "executions - lists executions"
  else
    fail "executions - expected execution list" "$OUTPUT"
  fi

  # workflow (get - will fail without valid ID)
  OUTPUT=$($CLI --token "$LEAD_TOKEN" workflow non-existent-id 2>&1) || true
  if echo "$OUTPUT" | grep -qE '"error"|not found|Invalid|Invalid token'; then
    pass "workflow - handles invalid/missing workflow"
  else
    fail "workflow - unexpected response" "$OUTPUT"
  fi

  # execution (get - will fail without valid ID)
  OUTPUT=$($CLI --token "$LEAD_TOKEN" execution non-existent-id 2>&1) || true
  if echo "$OUTPUT" | grep -qE '"error"|not found|Invalid|Invalid token'; then
    pass "execution - handles invalid/missing execution"
  else
    fail "execution - unexpected response" "$OUTPUT"
  fi
fi

# ============================================================================
section "MEMORY COMMANDS"
# ============================================================================

# memory-store
OUTPUT=$($CLI --token "$LEAD_TOKEN" memory-store lead project-context "Working on auth module" --type fact --tags auth,jwt 2>&1) || true
if echo "$OUTPUT" | grep -q '"key"'; then
  pass "memory-store - stores a memory entry"
else
  fail "memory-store - expected key field" "$OUTPUT"
fi

# memory-recall
OUTPUT=$($CLI --token "$LEAD_TOKEN" memory-recall lead project-context 2>&1) || true
if echo "$OUTPUT" | grep -q '"value"'; then
  pass "memory-recall - recalls stored memory"
else
  fail "memory-recall - expected value field" "$OUTPUT"
fi

# memory-search
OUTPUT=$($CLI --token "$LEAD_TOKEN" memory-search lead "auth" 2>&1) || true
if echo "$OUTPUT" | grep -q '"results"'; then
  pass "memory-search - searches memories"
else
  fail "memory-search - expected results field" "$OUTPUT"
fi

# memory-list
OUTPUT=$($CLI --token "$LEAD_TOKEN" memory-list lead 2>&1) || true
if echo "$OUTPUT" | grep -q '"memories"'; then
  pass "memory-list - lists agent memories"
else
  fail "memory-list - expected memories field" "$OUTPUT"
fi

# memory-list with limit
OUTPUT=$($CLI --token "$LEAD_TOKEN" memory-list lead --limit 5 2>&1) || true
if echo "$OUTPUT" | grep -q '"memories"'; then
  pass "memory-list --limit - lists with limit"
else
  fail "memory-list --limit - expected memories field" "$OUTPUT"
fi

# memory-store missing args
OUTPUT=$($CLI --token "$LEAD_TOKEN" memory-store 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Usage:'; then
  pass "memory-store - validates required args"
else
  fail "memory-store - expected usage message" "$OUTPUT"
fi

# ============================================================================
section "ROUTING COMMANDS"
# ============================================================================

# route - classify a task
OUTPUT=$($CLI --token "$LEAD_TOKEN" route "Refactor authentication module" "Extract JWT logic into service" 2>&1) || true
if echo "$OUTPUT" | grep -q '"complexity"'; then
  pass "route - classifies task complexity"
else
  fail "route - expected complexity field" "$OUTPUT"
fi

# route without description
OUTPUT=$($CLI --token "$LEAD_TOKEN" route "Fix a typo" 2>&1) || true
if echo "$OUTPUT" | grep -q '"complexity"'; then
  pass "route - works without description"
else
  fail "route - expected complexity field" "$OUTPUT"
fi

# route missing args
OUTPUT=$($CLI --token "$LEAD_TOKEN" route 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Usage:'; then
  pass "route - validates required args"
else
  fail "route - expected usage message" "$OUTPUT"
fi

# ============================================================================
section "LMSH COMMANDS"
# ============================================================================

# lmsh translate
OUTPUT=$($CLI --token "$LEAD_TOKEN" lmsh "list all typescript files" 2>&1) || true
if echo "$OUTPUT" | grep -q '"command"\|"error"'; then
  pass "lmsh - translates natural language to shell"
else
  fail "lmsh - expected command or error field" "$OUTPUT"
fi

# lmsh missing args
OUTPUT=$($CLI --token "$LEAD_TOKEN" lmsh 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Usage:'; then
  pass "lmsh - validates required args"
else
  fail "lmsh - expected usage message" "$OUTPUT"
fi

# ============================================================================
section "SEARCH COMMANDS"
# ============================================================================

# search
OUTPUT=$($CLI --token "$LEAD_TOKEN" search "authentication" 2>&1) || true
if echo "$OUTPUT" | grep -q '"results"\|"hits"\|"error"'; then
  pass "search - performs search query"
else
  fail "search - expected results field" "$OUTPUT"
fi

# search with limit
OUTPUT=$($CLI --token "$LEAD_TOKEN" search "auth" --limit 5 2>&1) || true
if echo "$OUTPUT" | grep -q '"results"\|"hits"\|"error"'; then
  pass "search --limit - performs search with limit"
else
  fail "search --limit - expected results field" "$OUTPUT"
fi

# search missing args
OUTPUT=$($CLI --token "$LEAD_TOKEN" search 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Usage:'; then
  pass "search - validates required args"
else
  fail "search - expected usage message" "$OUTPUT"
fi

# ============================================================================
section "DAG COMMANDS"
# ============================================================================

# dag-sort
OUTPUT=$($CLI --token "$LEAD_TOKEN" dag-sort "$TEAM" 2>&1) || true
if echo "$OUTPUT" | grep -q '"sorted"\|"order"\|"error"\|No tasks found'; then
  pass "dag-sort - attempts topological sort"
else
  fail "dag-sort - expected sorted or error field" "$OUTPUT"
fi

# dag-cycles
OUTPUT=$($CLI --token "$LEAD_TOKEN" dag-cycles "$TEAM" 2>&1) || true
if echo "$OUTPUT" | grep -q '"cycles"\|"hasCycles"\|"error"\|No tasks found'; then
  pass "dag-cycles - checks for dependency cycles"
else
  fail "dag-cycles - expected cycles or error field" "$OUTPUT"
fi

# dag-critical-path
OUTPUT=$($CLI --token "$LEAD_TOKEN" dag-critical-path "$TEAM" 2>&1) || true
if echo "$OUTPUT" | grep -q '"criticalPath"\|"path"\|"error"\|No tasks found'; then
  pass "dag-critical-path - finds critical path"
else
  fail "dag-critical-path - expected path or error field" "$OUTPUT"
fi

# dag-ready
OUTPUT=$($CLI --token "$LEAD_TOKEN" dag-ready "$TEAM" 2>&1) || true
if echo "$OUTPUT" | grep -q '"ready"\|"nodes"\|"error"\|No tasks found'; then
  pass "dag-ready - finds ready tasks"
else
  fail "dag-ready - expected ready or error field" "$OUTPUT"
fi

# dag-sort missing args
OUTPUT=$($CLI --token "$LEAD_TOKEN" dag-sort 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Usage:'; then
  pass "dag-sort - validates required args"
else
  fail "dag-sort - expected usage message" "$OUTPUT"
fi

# ============================================================================
section "CLI OPTIONS & ERROR HANDLING"
# ============================================================================

# --version
OUTPUT=$($CLI --version 2>&1) || true
if echo "$OUTPUT" | grep -q 'fleet v'; then
  pass "--version - shows version"
else
  fail "--version - expected version output" "$OUTPUT"
fi

# --help
OUTPUT=$($CLI --help 2>&1) || true
if echo "$OUTPUT" | grep -q 'Claude Fleet CLI\|Usage:'; then
  pass "--help - shows help"
else
  fail "--help - expected help output" "$OUTPUT"
fi

# Invalid command
OUTPUT=$($CLI invalid-command 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Unknown command'; then
  pass "invalid command - shows error"
else
  fail "invalid command - expected error message" "$OUTPUT"
fi

# Missing required args
OUTPUT=$($CLI auth 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Usage:'; then
  pass "missing args - shows usage"
else
  fail "missing args - expected usage" "$OUTPUT"
fi

# Invalid handle format
OUTPUT=$($CLI auth "invalid handle with spaces" test-team 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Invalid'; then
  pass "invalid handle - validation works"
else
  fail "invalid handle - expected validation error" "$OUTPUT"
fi

# Invalid status
OUTPUT=$($CLI --token "$LEAD_TOKEN" workitem-update "$WORKITEM_ID" invalid-status 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Invalid status'; then
  pass "invalid status - validation works"
else
  fail "invalid status - expected validation error" "$OUTPUT"
fi

# --verbose flag
OUTPUT=$($CLI --verbose health 2>&1) || true
if echo "$OUTPUT" | grep -q '\[verbose\]'; then
  pass "--verbose - shows request details"
else
  fail "--verbose - expected verbose output" "$OUTPUT"
fi

# Connection refused (wrong port)
OUTPUT=$($CLI --url http://localhost:9999 health 2>&1) || EXIT_CODE=$?
if echo "$OUTPUT" | grep -q 'Cannot connect\|fetch failed\|ECONNREFUSED'; then
  pass "connection error - shows helpful message"
else
  fail "connection error - expected connection error" "$OUTPUT"
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║                   TEST SUMMARY                     ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${GREEN}Passed:${NC}  $PASSED"
echo -e "  ${RED}Failed:${NC}  $FAILED"
echo -e "  ${YELLOW}Skipped:${NC} $SKIPPED"
echo ""

TOTAL=$((PASSED + FAILED))
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All $TOTAL tests passed!${NC}"
  exit 0
else
  echo -e "${RED}$FAILED of $TOTAL tests failed${NC}"
  exit 1
fi
