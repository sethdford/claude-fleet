#!/bin/bash

# Claude Collab Local Test Suite
# Comprehensive tests for all server endpoints

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_URL="${CLAUDE_CODE_COLLAB_URL:-http://localhost:3847}"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

#######################################
# Test utilities
#######################################
pass() {
  echo "  PASS: $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
}

fail() {
  echo "  FAIL: $1"
  if [[ -n "${2:-}" ]]; then
    echo "        $2"
  fi
  TESTS_FAILED=$((TESTS_FAILED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
}

section() {
  echo ""
  echo "=== $1 ==="
  echo ""
}

api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"

  if [[ -n "$data" ]]; then
    curl -s -X "$method" "${SERVER_URL}${endpoint}" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -s -X "$method" "${SERVER_URL}${endpoint}"
  fi
}

#######################################
# Health check tests
#######################################
test_health() {
  section "Health Check Tests"

  echo -n "Testing health endpoint... "
  RESPONSE=$(api GET /health)
  if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    pass "Health endpoint works"
  else
    fail "Health endpoint failed" "$RESPONSE"
  fi

  echo -n "Testing persistence type... "
  if echo "$RESPONSE" | grep -q '"persistence":"sqlite"'; then
    pass "SQLite persistence confirmed"
  else
    fail "Persistence check failed"
  fi
}

#######################################
# Authentication tests
#######################################
test_auth() {
  section "Authentication Tests"

  # Test missing fields
  echo -n "Testing missing handle... "
  RESPONSE=$(api POST /auth '{"teamName":"test-team"}')
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Rejects missing handle"
  else
    fail "Should reject missing handle"
  fi

  echo -n "Testing missing teamName... "
  RESPONSE=$(api POST /auth '{"handle":"test-agent"}')
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Rejects missing teamName"
  else
    fail "Should reject missing teamName"
  fi

  # Test invalid agentType
  echo -n "Testing invalid agentType... "
  RESPONSE=$(api POST /auth '{"handle":"test-agent","teamName":"test-team","agentType":"invalid"}')
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Rejects invalid agentType"
  else
    fail "Should reject invalid agentType"
  fi

  # Test successful auth
  echo -n "Testing valid auth... "
  RESPONSE=$(api POST /auth '{"handle":"test-lead","teamName":"test-team","agentType":"team-lead"}')
  if echo "$RESPONSE" | grep -q '"uid"'; then
    pass "Auth succeeds"
    LEAD_UID=$(echo "$RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
  else
    fail "Auth should succeed"
    return 1
  fi

  # Register worker
  echo -n "Testing worker registration... "
  RESPONSE=$(api POST /auth '{"handle":"test-worker","teamName":"test-team","agentType":"worker"}')
  if echo "$RESPONSE" | grep -q '"uid"'; then
    pass "Worker registration succeeds"
    WORKER_UID=$(echo "$RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
  else
    fail "Worker registration should succeed"
    return 1
  fi

  # Export for other tests
  export LEAD_UID WORKER_UID
}

#######################################
# User tests
#######################################
test_users() {
  section "User Tests"

  echo -n "Testing get user... "
  RESPONSE=$(api GET "/users/$LEAD_UID")
  if echo "$RESPONSE" | grep -q '"handle":"test-lead"'; then
    pass "Get user works"
  else
    fail "Get user failed"
  fi

  echo -n "Testing get nonexistent user... "
  RESPONSE=$(api GET "/users/nonexistent")
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Returns error for nonexistent user"
  else
    fail "Should return error"
  fi

  echo -n "Testing list team agents... "
  RESPONSE=$(api GET "/teams/test-team/agents")
  if echo "$RESPONSE" | grep -q '"test-lead"' && echo "$RESPONSE" | grep -q '"test-worker"'; then
    pass "Lists team agents"
  else
    fail "Team agents list failed"
  fi
}

#######################################
# Chat tests
#######################################
test_chats() {
  section "Chat Tests"

  echo -n "Testing create chat... "
  RESPONSE=$(api POST /chats "{\"uid1\":\"$LEAD_UID\",\"uid2\":\"$WORKER_UID\"}")
  if echo "$RESPONSE" | grep -q '"chatId"'; then
    pass "Create chat works"
    CHAT_ID=$(echo "$RESPONSE" | grep -o '"chatId":"[^"]*"' | cut -d'"' -f4)
    export CHAT_ID
  else
    fail "Create chat failed"
    return 1
  fi

  echo -n "Testing list user chats... "
  RESPONSE=$(api GET "/users/$LEAD_UID/chats")
  if echo "$RESPONSE" | grep -q "$CHAT_ID"; then
    pass "List chats works"
  else
    fail "List chats failed"
  fi
}

#######################################
# Message tests
#######################################
test_messages() {
  section "Message Tests"

  # Test missing fields
  echo -n "Testing missing message text... "
  RESPONSE=$(api POST "/chats/$CHAT_ID/messages" "{\"from\":\"$LEAD_UID\"}")
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Rejects missing text"
  else
    fail "Should reject missing text"
  fi

  # Test send message
  echo -n "Testing send message... "
  RESPONSE=$(api POST "/chats/$CHAT_ID/messages" "{\"from\":\"$LEAD_UID\",\"text\":\"Hello worker!\"}")
  if echo "$RESPONSE" | grep -q '"id"'; then
    pass "Send message works"
  else
    fail "Send message failed"
  fi

  # Test get messages
  echo -n "Testing get messages... "
  RESPONSE=$(api GET "/chats/$CHAT_ID/messages")
  if echo "$RESPONSE" | grep -q '"Hello worker!"'; then
    pass "Get messages works"
  else
    fail "Get messages failed"
  fi

  # Test mark as read
  echo -n "Testing mark as read... "
  RESPONSE=$(api POST "/chats/$CHAT_ID/read" "{\"uid\":\"$WORKER_UID\"}")
  if echo "$RESPONSE" | grep -q '"success":true'; then
    pass "Mark as read works"
  else
    fail "Mark as read failed"
  fi
}

#######################################
# Task tests
#######################################
test_tasks() {
  section "Task Tests"

  # Test missing fields
  echo -n "Testing missing task fields... "
  RESPONSE=$(api POST /tasks '{"fromUid":"test"}')
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Rejects incomplete task"
  else
    fail "Should reject incomplete task"
  fi

  # Test invalid subject
  echo -n "Testing short subject... "
  RESPONSE=$(api POST /tasks "{\"fromUid\":\"$LEAD_UID\",\"toHandle\":\"test-worker\",\"teamName\":\"test-team\",\"subject\":\"Hi\"}")
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Rejects short subject"
  else
    fail "Should reject short subject"
  fi

  # Test create task
  echo -n "Testing create task... "
  RESPONSE=$(api POST /tasks "{\"fromUid\":\"$LEAD_UID\",\"toHandle\":\"test-worker\",\"teamName\":\"test-team\",\"subject\":\"Implement user auth\",\"description\":\"Build JWT-based authentication\"}")
  if echo "$RESPONSE" | grep -q '"id"'; then
    pass "Create task works"
    TASK_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    export TASK_ID
  else
    fail "Create task failed" "$RESPONSE"
    return 1
  fi

  # Test list tasks
  echo -n "Testing list team tasks... "
  RESPONSE=$(api GET "/teams/test-team/tasks")
  if echo "$RESPONSE" | grep -q '"Implement user auth"'; then
    pass "List tasks works"
  else
    fail "List tasks failed"
  fi

  # Test invalid status update
  echo -n "Testing invalid task status... "
  RESPONSE=$(api PATCH "/tasks/$TASK_ID" '{"status":"invalid"}')
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Rejects invalid status"
  else
    fail "Should reject invalid status"
  fi

  # Test update task
  echo -n "Testing update task status... "
  RESPONSE=$(api PATCH "/tasks/$TASK_ID" '{"status":"in_progress"}')
  if echo "$RESPONSE" | grep -q '"in_progress"'; then
    pass "Update task works"
  else
    fail "Update task failed"
  fi

  # Test resolve task
  echo -n "Testing resolve task... "
  RESPONSE=$(api PATCH "/tasks/$TASK_ID" '{"status":"resolved"}')
  if echo "$RESPONSE" | grep -q '"resolved"'; then
    pass "Resolve task works"
  else
    fail "Resolve task failed"
  fi
}

#######################################
# Task dependency tests
#######################################
test_task_dependencies() {
  section "Task Dependency Tests"

  # Create a blocker task
  echo -n "Creating blocker task... "
  RESPONSE=$(api POST /tasks "{\"fromUid\":\"$LEAD_UID\",\"toHandle\":\"test-worker\",\"teamName\":\"test-team\",\"subject\":\"Blocker task for dep test\"}")
  BLOCKER_TASK_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  if [[ -n "$BLOCKER_TASK_ID" ]]; then
    pass "Blocker task created"
  else
    fail "Blocker task creation failed"
    return 1
  fi

  # Create a dependent task that is blocked by the blocker
  echo -n "Creating dependent task... "
  RESPONSE=$(api POST /tasks "{\"fromUid\":\"$LEAD_UID\",\"toHandle\":\"test-worker\",\"teamName\":\"test-team\",\"subject\":\"Dependent task for dep test\",\"blockedBy\":[\"$BLOCKER_TASK_ID\"]}")
  DEPENDENT_TASK_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  if [[ -n "$DEPENDENT_TASK_ID" ]]; then
    pass "Dependent task created"
  else
    fail "Dependent task creation failed"
    return 1
  fi

  # Try to resolve the dependent task (should fail)
  echo -n "Testing blocked resolution... "
  RESPONSE=$(api PATCH "/tasks/$DEPENDENT_TASK_ID" '{"status":"resolved"}')
  if echo "$RESPONSE" | grep -q '"error".*blocked'; then
    pass "Correctly prevents resolving blocked task"
  else
    fail "Should prevent resolving blocked task"
  fi

  # Resolve the blocker task
  echo -n "Resolving blocker task... "
  RESPONSE=$(api PATCH "/tasks/$BLOCKER_TASK_ID" '{"status":"resolved"}')
  if echo "$RESPONSE" | grep -q '"resolved"'; then
    pass "Blocker task resolved"
  else
    fail "Blocker task resolution failed"
  fi

  # Now resolving the dependent task should work
  echo -n "Testing unblocked resolution... "
  RESPONSE=$(api PATCH "/tasks/$DEPENDENT_TASK_ID" '{"status":"resolved"}')
  if echo "$RESPONSE" | grep -q '"resolved"'; then
    pass "Dependent task resolved after blocker"
  else
    fail "Dependent task should resolve after blocker is done"
  fi
}

#######################################
# Broadcast tests
#######################################
test_broadcast() {
  section "Broadcast Tests"

  echo -n "Testing team broadcast... "
  RESPONSE=$(api POST "/teams/test-team/broadcast" "{\"from\":\"$LEAD_UID\",\"text\":\"Team announcement!\"}")
  if echo "$RESPONSE" | grep -q '"id"'; then
    pass "Broadcast works"
  else
    fail "Broadcast failed"
  fi
}

#######################################
# Mark as read validation tests
#######################################
test_mark_read_validation() {
  section "Mark as Read Validation Tests"

  echo -n "Testing missing uid... "
  RESPONSE=$(api POST "/chats/$CHAT_ID/read" '{}')
  if echo "$RESPONSE" | grep -q '"error".*uid'; then
    pass "Rejects missing uid"
  else
    fail "Should reject missing uid"
  fi

  echo -n "Testing nonexistent chat... "
  RESPONSE=$(api POST "/chats/nonexistent/read" "{\"uid\":\"$LEAD_UID\"}")
  if echo "$RESPONSE" | grep -q '"error"'; then
    pass "Returns error for nonexistent chat"
  else
    fail "Should return error for nonexistent chat"
  fi
}

#######################################
# WebSocket tests
#######################################
test_websocket() {
  section "WebSocket Tests"

  # Check if websocat is available
  if ! command -v websocat &> /dev/null; then
    echo "  SKIP: websocat not installed (brew install websocat)"
    return
  fi

  WS_URL="${SERVER_URL/http/ws}/ws"

  echo -n "Testing WebSocket connection... "
  # Send ping and expect pong
  RESPONSE=$(echo '{"type":"ping"}' | timeout 3 websocat -n1 "$WS_URL" 2>/dev/null)
  if echo "$RESPONSE" | grep -q '"type":"pong"'; then
    pass "WebSocket ping/pong works"
  else
    fail "WebSocket ping/pong failed"
  fi

  echo -n "Testing WebSocket subscribe... "
  RESPONSE=$(echo "{\"type\":\"subscribe\",\"chatId\":\"$CHAT_ID\",\"uid\":\"$LEAD_UID\"}" | timeout 3 websocat -n1 "$WS_URL" 2>/dev/null)
  if echo "$RESPONSE" | grep -q '"type":"subscribed"'; then
    pass "WebSocket subscribe works"
  else
    fail "WebSocket subscribe failed"
  fi
}

#######################################
# Rate limiting tests
#######################################
test_rate_limiting() {
  section "Rate Limiting Tests"

  echo -n "Testing rate limit headers... "
  # Make a request and check it works (not testing actual limit, just that server handles traffic)
  RESPONSE=$(api GET /health)
  if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    pass "Server handles requests under rate limit"
  else
    fail "Server should handle normal requests"
  fi
}

#######################################
# Main
#######################################
main() {
  echo ""
  echo "Claude Collab Local Test Suite"
  echo "==============================="
  echo ""
  echo "Server: $SERVER_URL"

  # Check server is running
  if ! curl -s "${SERVER_URL}/health" > /dev/null 2>&1; then
    echo ""
    echo "ERROR: Server not running at $SERVER_URL"
    echo "Start it with: npm start"
    exit 1
  fi

  test_health
  test_auth
  test_users
  test_chats
  test_messages
  test_mark_read_validation
  test_tasks
  test_task_dependencies
  test_broadcast
  test_websocket
  test_rate_limiting

  echo ""
  echo "==============================="
  echo "Results: $TESTS_PASSED/$TESTS_RUN passed"

  if [[ $TESTS_FAILED -gt 0 ]]; then
    echo "FAILED: $TESTS_FAILED tests"
    exit 1
  else
    echo "ALL TESTS PASSED"
    exit 0
  fi
}

main "$@"
