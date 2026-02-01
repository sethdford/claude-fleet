#!/bin/bash

# E2E Integration Test for Swarm Intelligence APIs
# Tests: Pheromones, Beliefs, Credits, Consensus, Bidding, Payoffs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PORT=${PORT:-4798}
SERVER_URL="${CLAUDE_FLEET_URL:-http://localhost:$PORT}"
SERVER_PID=""
DB_PATH="/tmp/e2e-swarm-intel-fleet.db"
LOG_FILE="/tmp/e2e-swarm-intel-server.log"

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

# Test assertion helper
assert_contains() {
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

assert_not_empty() {
  local value="$1"
  local test_name="$2"

  if [[ -n "$value" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  [PASS] $test_name"
    return 0
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  [FAIL] $test_name - value was empty"
    return 1
  fi
}

echo ""
echo "========================================================================"
echo "          Claude Fleet - Swarm Intelligence E2E Tests                   "
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
LEAD_RESPONSE=$(api POST /auth '{"handle":"swarm-lead","teamName":"swarm-team","agentType":"team-lead"}')
LEAD_UID=$(echo "$LEAD_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
LEAD_TOKEN=$(echo "$LEAD_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$LEAD_UID" ]] || [[ -z "$LEAD_TOKEN" ]]; then
  echo "[E2E] FAIL: Authentication failed"
  echo "$LEAD_RESPONSE"
  exit 1
fi
echo "[E2E] Authenticated as: $LEAD_UID"

# Swarm ID for all tests
SWARM_ID="swarm-intel-test"

# ============================================================================
# PHEROMONE TESTS (6 endpoints)
# ============================================================================
echo ""
echo "--- PHEROMONE TESTS ---"

# Test 1: POST /pheromones - Deposit trail
echo "[E2E] Testing pheromone deposit..."
PHEROMONE_RESPONSE=$(api POST /pheromones "{
  \"swarmId\": \"$SWARM_ID\",
  \"depositorHandle\": \"scout-1\",
  \"resourceId\": \"src/index.ts\",
  \"resourceType\": \"file\",
  \"trailType\": \"touch\",
  \"intensity\": 0.8,
  \"metadata\": {\"note\": \"Found interesting code\"}
}" "$LEAD_TOKEN")
TRAIL_ID=$(echo "$PHEROMONE_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
assert_not_empty "$TRAIL_ID" "Pheromone deposit returns ID"

# Deposit another trail for testing
api POST /pheromones "{
  \"swarmId\": \"$SWARM_ID\",
  \"depositorHandle\": \"scout-2\",
  \"resourceId\": \"src/index.ts\",
  \"resourceType\": \"file\",
  \"trailType\": \"success\",
  \"intensity\": 0.9
}" "$LEAD_TOKEN" > /dev/null

# Test 2: GET /pheromones/:swarmId - Query trails
echo "[E2E] Testing pheromone query..."
QUERY_RESPONSE=$(api GET "/pheromones/$SWARM_ID" "" "$LEAD_TOKEN")
assert_contains "$QUERY_RESPONSE" '"trails"' "Query returns trails array"
assert_contains "$QUERY_RESPONSE" '"count"' "Query returns count"

# Test 3: GET /pheromones/:swarmId/resource/:resourceId - Resource trails
echo "[E2E] Testing resource trails..."
RESOURCE_RESPONSE=$(api GET "/pheromones/$SWARM_ID/resource/src%2Findex.ts" "" "$LEAD_TOKEN")
assert_contains "$RESOURCE_RESPONSE" '"trails"' "Resource trails returns array"

# Test 4: GET /pheromones/:swarmId/activity - Resource activity
echo "[E2E] Testing resource activity..."
ACTIVITY_RESPONSE=$(api GET "/pheromones/$SWARM_ID/activity" "" "$LEAD_TOKEN")
assert_contains "$ACTIVITY_RESPONSE" '"activity"' "Activity returns array"

# Test 5: POST /pheromones/decay - Trigger decay
echo "[E2E] Testing pheromone decay..."
DECAY_RESPONSE=$(api POST /pheromones/decay "{
  \"swarmId\": \"$SWARM_ID\",
  \"decayRate\": 0.1,
  \"minIntensity\": 0.01
}" "$LEAD_TOKEN")
assert_contains "$DECAY_RESPONSE" '"success":true' "Decay returns success"

# Test 6: GET /pheromones/:swarmId/stats - Stats
echo "[E2E] Testing pheromone stats..."
STATS_RESPONSE=$(api GET "/pheromones/$SWARM_ID/stats" "" "$LEAD_TOKEN")
assert_contains "$STATS_RESPONSE" '"activeTrails"' "Stats returns activeTrails"

# ============================================================================
# BELIEF TESTS (5 endpoints)
# ============================================================================
echo ""
echo "--- BELIEF TESTS ---"

# Test 7: POST /beliefs - Upsert belief
echo "[E2E] Testing belief upsert..."
BELIEF_RESPONSE=$(api POST /beliefs "{
  \"swarmId\": \"$SWARM_ID\",
  \"agentHandle\": \"analyst-1\",
  \"subject\": \"task:auth-refactor\",
  \"beliefType\": \"knowledge\",
  \"confidence\": 0.85,
  \"beliefValue\": \"Estimated 4 hours, medium complexity\"
}" "$LEAD_TOKEN")
# Belief IDs are numeric, not UUID strings
assert_contains "$BELIEF_RESPONSE" '"id":' "Belief upsert returns ID"

# Test 8: GET /beliefs/:swarmId/:handle - Get beliefs
echo "[E2E] Testing get beliefs..."
BELIEFS_RESPONSE=$(api GET "/beliefs/$SWARM_ID/analyst-1" "" "$LEAD_TOKEN")
assert_contains "$BELIEFS_RESPONSE" '"beliefs"' "Get beliefs returns array"

# Test 9: POST /beliefs/meta - Upsert meta-belief
echo "[E2E] Testing meta-belief upsert..."
META_RESPONSE=$(api POST /beliefs/meta "{
  \"swarmId\": \"$SWARM_ID\",
  \"agentHandle\": \"swarm-lead\",
  \"aboutHandle\": \"analyst-1\",
  \"metaType\": \"reliability\",
  \"confidence\": 0.75,
  \"beliefValue\": \"Highly accurate estimations based on past performance\"
}" "$LEAD_TOKEN")
# Meta-belief IDs are numeric
assert_contains "$META_RESPONSE" '"id":' "Meta-belief upsert returns ID"

# Test 10: GET /beliefs/:swarmId/consensus/:subject - Swarm consensus
echo "[E2E] Testing swarm consensus..."
CONSENSUS_RESPONSE=$(api GET "/beliefs/$SWARM_ID/consensus/task%3Aauth-refactor" "" "$LEAD_TOKEN")
assert_contains "$CONSENSUS_RESPONSE" '"subject"' "Consensus returns subject"

# Test 11: GET /beliefs/:swarmId/stats - Stats
echo "[E2E] Testing belief stats..."
BELIEF_STATS=$(api GET "/beliefs/$SWARM_ID/stats" "" "$LEAD_TOKEN")
assert_contains "$BELIEF_STATS" '"totalBeliefs"' "Belief stats returns totalBeliefs"

# ============================================================================
# CREDIT TESTS (7 endpoints)
# ============================================================================
echo ""
echo "--- CREDIT TESTS ---"

# Test 12: POST /credits/transaction - Record transaction (initialize credits)
echo "[E2E] Testing credit transaction..."
TRANS_RESPONSE=$(api POST /credits/transaction "{
  \"swarmId\": \"$SWARM_ID\",
  \"agentHandle\": \"worker-1\",
  \"transactionType\": \"earn\",
  \"amount\": 100,
  \"referenceType\": \"task\",
  \"referenceId\": \"init-task\",
  \"reason\": \"Initial allocation\"
}" "$LEAD_TOKEN")
assert_contains "$TRANS_RESPONSE" '"balance"' "Transaction returns balance"

# Initialize another agent
api POST /credits/transaction "{
  \"swarmId\": \"$SWARM_ID\",
  \"agentHandle\": \"worker-2\",
  \"transactionType\": \"earn\",
  \"amount\": 50,
  \"referenceType\": \"task\",
  \"referenceId\": \"init-task-2\",
  \"reason\": \"Initial allocation\"
}" "$LEAD_TOKEN" > /dev/null

# Test 13: GET /credits/:swarmId/:handle - Get credits
echo "[E2E] Testing get credits..."
CREDITS_RESPONSE=$(api GET "/credits/$SWARM_ID/worker-1" "" "$LEAD_TOKEN")
assert_contains "$CREDITS_RESPONSE" '"balance"' "Get credits returns balance"
assert_contains "$CREDITS_RESPONSE" '"reputationScore"' "Get credits returns reputation"

# Test 14: GET /credits/:swarmId/leaderboard - Leaderboard
echo "[E2E] Testing leaderboard..."
LEADERBOARD=$(api GET "/credits/$SWARM_ID/leaderboard" "" "$LEAD_TOKEN")
assert_contains "$LEADERBOARD" '"leaderboard"' "Leaderboard returns array"

# Test 15: POST /credits/transfer - Transfer credits
echo "[E2E] Testing credit transfer..."
TRANSFER=$(api POST /credits/transfer "{
  \"swarmId\": \"$SWARM_ID\",
  \"fromHandle\": \"worker-1\",
  \"toHandle\": \"worker-2\",
  \"amount\": 20,
  \"reason\": \"Payment for help\"
}" "$LEAD_TOKEN")
assert_contains "$TRANSFER" '"success":true' "Transfer returns success"

# Test 16: GET /credits/:swarmId/:handle/history - History
echo "[E2E] Testing credit history..."
HISTORY=$(api GET "/credits/$SWARM_ID/worker-1/history" "" "$LEAD_TOKEN")
assert_contains "$HISTORY" '"transactions"' "History returns transactions"

# Test 17: GET /credits/:swarmId/stats - Stats
echo "[E2E] Testing credit stats..."
CREDIT_STATS=$(api GET "/credits/$SWARM_ID/stats" "" "$LEAD_TOKEN")
assert_contains "$CREDIT_STATS" '"totalAgents"' "Credit stats returns totalAgents"

# Test 18: POST /credits/reputation - Update reputation
echo "[E2E] Testing reputation update..."
REPUTATION=$(api POST /credits/reputation "{
  \"swarmId\": \"$SWARM_ID\",
  \"agentHandle\": \"worker-1\",
  \"success\": true,
  \"weight\": 0.1
}" "$LEAD_TOKEN")
assert_contains "$REPUTATION" '"newReputation"' "Reputation update returns newReputation"

# ============================================================================
# CONSENSUS TESTS (6 endpoints)
# ============================================================================
echo ""
echo "--- CONSENSUS TESTS ---"

# Test 19: POST /consensus/proposals - Create proposal
echo "[E2E] Testing proposal creation..."
PROPOSAL_RESPONSE=$(api POST /consensus/proposals "{
  \"swarmId\": \"$SWARM_ID\",
  \"proposerHandle\": \"swarm-lead\",
  \"title\": \"Switch to TypeScript strict mode\",
  \"description\": \"Enable strict TypeScript for better type safety\",
  \"proposalType\": \"decision\",
  \"options\": [\"approve\", \"reject\", \"defer\"],
  \"quorumValue\": 0.5
}" "$LEAD_TOKEN")
PROPOSAL_ID=$(echo "$PROPOSAL_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
assert_not_empty "$PROPOSAL_ID" "Proposal creation returns ID"

# Test 20: GET /consensus/:swarmId/proposals - List proposals
echo "[E2E] Testing proposal list..."
PROPOSALS=$(api GET "/consensus/$SWARM_ID/proposals" "" "$LEAD_TOKEN")
assert_contains "$PROPOSALS" '"proposals"' "List proposals returns array"

# Test 21: GET /consensus/proposals/:id - Get proposal
echo "[E2E] Testing get proposal..."
PROPOSAL=$(api GET "/consensus/proposals/$PROPOSAL_ID" "" "$LEAD_TOKEN")
assert_contains "$PROPOSAL" '"title"' "Get proposal returns title"

# Test 22: POST /consensus/proposals/:id/vote - Cast vote
echo "[E2E] Testing vote casting..."
VOTE1=$(api POST "/consensus/proposals/$PROPOSAL_ID/vote" "{
  \"voterHandle\": \"worker-1\",
  \"voteValue\": \"approve\",
  \"rationale\": \"Good for maintainability\"
}" "$LEAD_TOKEN")
assert_contains "$VOTE1" '"id"' "Vote casting returns vote ID"

# Cast another vote
api POST "/consensus/proposals/$PROPOSAL_ID/vote" "{
  \"voterHandle\": \"worker-2\",
  \"voteValue\": \"approve\"
}" "$LEAD_TOKEN" > /dev/null

# Test 23: POST /consensus/proposals/:id/close - Close proposal
echo "[E2E] Testing proposal close..."
CLOSE=$(api POST "/consensus/proposals/$PROPOSAL_ID/close" '{}' "$LEAD_TOKEN")
assert_contains "$CLOSE" '"winner"' "Close proposal returns winner"

# Test 24: GET /consensus/:swarmId/stats - Stats
echo "[E2E] Testing consensus stats..."
CONSENSUS_STATS=$(api GET "/consensus/$SWARM_ID/stats" "" "$LEAD_TOKEN")
assert_contains "$CONSENSUS_STATS" '"totalProposals"' "Consensus stats returns totalProposals"

# ============================================================================
# BIDDING TESTS (8 endpoints)
# ============================================================================
echo ""
echo "--- BIDDING TESTS ---"

# First authenticate worker-1 and worker-2 for bidding tests
WORKER1_RESPONSE=$(api POST /auth '{"handle":"worker-1","teamName":"swarm-team","agentType":"worker"}')
WORKER1_UID=$(echo "$WORKER1_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$WORKER1_UID" ]]; then
  echo "[E2E] FAIL: Worker-1 authentication failed"
  exit 1
fi

WORKER2_RESPONSE=$(api POST /auth '{"handle":"worker-2","teamName":"swarm-team","agentType":"worker"}')
WORKER2_UID=$(echo "$WORKER2_RESPONSE" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$WORKER2_UID" ]]; then
  echo "[E2E] FAIL: Worker-2 authentication failed"
  exit 1
fi
echo "[E2E] Authenticated workers for bidding tests"

# Create a task assigned to worker-1 (it will be reassigned via bidding)
TASK_RESPONSE=$(api POST /tasks "{
  \"fromUid\": \"$LEAD_UID\",
  \"toHandle\": \"worker-1\",
  \"teamName\": \"swarm-team\",
  \"subject\": \"Refactor authentication module\",
  \"description\": \"Modernize the auth system\"
}" "$LEAD_TOKEN")
TASK_ID=$(echo "$TASK_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "[E2E] Created task: $TASK_ID"

# Test 25: POST /bids - Submit bid
echo "[E2E] Testing bid submission..."
BID_RESPONSE=$(api POST /bids "{
  \"swarmId\": \"$SWARM_ID\",
  \"taskId\": \"$TASK_ID\",
  \"bidderHandle\": \"worker-1\",
  \"bidAmount\": 30,
  \"estimatedDuration\": 7200000,
  \"rationale\": \"I have experience with auth systems\"
}" "$LEAD_TOKEN")
BID_ID=$(echo "$BID_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
assert_not_empty "$BID_ID" "Bid submission returns ID"

# Submit another bid
BID2_RESPONSE=$(api POST /bids "{
  \"swarmId\": \"$SWARM_ID\",
  \"taskId\": \"$TASK_ID\",
  \"bidderHandle\": \"worker-2\",
  \"bidAmount\": 25,
  \"estimatedDuration\": 10800000,
  \"rationale\": \"Will do thorough job\"
}" "$LEAD_TOKEN")
BID2_ID=$(echo "$BID2_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Test 26: GET /bids/task/:taskId - Get task bids
echo "[E2E] Testing get task bids..."
TASK_BIDS=$(api GET "/bids/task/$TASK_ID" "" "$LEAD_TOKEN")
assert_contains "$TASK_BIDS" '"bids"' "Get task bids returns array"

# Test 27: GET /bids/:id - Get bid
echo "[E2E] Testing get bid..."
BID=$(api GET "/bids/$BID_ID" "" "$LEAD_TOKEN")
assert_contains "$BID" '"bidAmount"' "Get bid returns bidAmount"

# Test 28: POST /bids/task/:taskId/evaluate - Evaluate bids
echo "[E2E] Testing bid evaluation..."
EVAL=$(api POST "/bids/task/$TASK_ID/evaluate" '{}' "$LEAD_TOKEN")
assert_contains "$EVAL" '"evaluations"' "Evaluate bids returns evaluations"

# Test 29: DELETE /bids/:id - Withdraw bid
echo "[E2E] Testing bid withdrawal..."
WITHDRAW=$(api DELETE "/bids/$BID2_ID?handle=worker-2" "" "$LEAD_TOKEN")
assert_contains "$WITHDRAW" '"success":true' "Withdraw bid returns success"

# Test 30: POST /bids/:id/accept - Accept bid
echo "[E2E] Testing bid acceptance..."
ACCEPT=$(api POST "/bids/$BID_ID/accept" '{"settleCredits":true}' "$LEAD_TOKEN")
assert_contains "$ACCEPT" '"bid"' "Accept bid returns bid"

# Create another task for auction test
TASK2_RESPONSE=$(api POST /tasks "{
  \"fromUid\": \"$LEAD_UID\",
  \"toHandle\": \"worker-2\",
  \"teamName\": \"swarm-team\",
  \"subject\": \"Write unit tests\",
  \"description\": \"Add test coverage\"
}" "$LEAD_TOKEN")
TASK2_ID=$(echo "$TASK2_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

# Give worker-2 more credits for bidding
api POST /credits/transaction "{
  \"swarmId\": \"$SWARM_ID\",
  \"agentHandle\": \"worker-2\",
  \"transactionType\": \"earn\",
  \"amount\": 100,
  \"referenceType\": \"task\",
  \"referenceId\": \"bonus-task\",
  \"reason\": \"Bonus allocation\"
}" "$LEAD_TOKEN" > /dev/null

# Submit bids for auction
api POST /bids "{
  \"swarmId\": \"$SWARM_ID\",
  \"taskId\": \"$TASK2_ID\",
  \"bidderHandle\": \"worker-1\",
  \"bidAmount\": 20,
  \"estimatedDuration\": 3600000
}" "$LEAD_TOKEN" > /dev/null

api POST /bids "{
  \"swarmId\": \"$SWARM_ID\",
  \"taskId\": \"$TASK2_ID\",
  \"bidderHandle\": \"worker-2\",
  \"bidAmount\": 15,
  \"estimatedDuration\": 5400000
}" "$LEAD_TOKEN" > /dev/null

# Test 31: POST /bids/task/:taskId/auction - Run auction
echo "[E2E] Testing auction..."
AUCTION=$(api POST "/bids/task/$TASK2_ID/auction" '{"auctionType":"second-price"}' "$LEAD_TOKEN")
assert_contains "$AUCTION" '"winner"' "Auction returns winner"

# Test 32: GET /bids/:swarmId/stats - Stats
echo "[E2E] Testing bidding stats..."
BID_STATS=$(api GET "/bids/$SWARM_ID/stats" "" "$LEAD_TOKEN")
assert_contains "$BID_STATS" '"totalBids"' "Bidding stats returns totalBids"

# ============================================================================
# PAYOFF TESTS (3 endpoints)
# ============================================================================
echo ""
echo "--- PAYOFF TESTS ---"

# Test 33: POST /payoffs - Define payoff
echo "[E2E] Testing payoff definition..."
PAYOFF_RESPONSE=$(api POST /payoffs "{
  \"taskId\": \"$TASK_ID\",
  \"swarmId\": \"$SWARM_ID\",
  \"payoffType\": \"completion\",
  \"baseValue\": 50,
  \"multiplier\": 1.2,
  \"decayRate\": 0.1
}" "$LEAD_TOKEN")
assert_contains "$PAYOFF_RESPONSE" '"task_id"' "Define payoff returns task_id"

# Add bonus payoff
api POST /payoffs "{
  \"taskId\": \"$TASK_ID\",
  \"swarmId\": \"$SWARM_ID\",
  \"payoffType\": \"bonus\",
  \"baseValue\": 10,
  \"multiplier\": 1.0
}" "$LEAD_TOKEN" > /dev/null

# Test 34: GET /payoffs/:taskId - Get payoffs
echo "[E2E] Testing get payoffs..."
PAYOFFS=$(api GET "/payoffs/$TASK_ID" "" "$LEAD_TOKEN")
assert_contains "$PAYOFFS" '"payoff_type"' "Get payoffs returns payoff_type"

# Test 35: GET /payoffs/:taskId/calculate - Calculate payoff
echo "[E2E] Testing payoff calculation..."
CALC=$(api GET "/payoffs/$TASK_ID/calculate" "" "$LEAD_TOKEN")
assert_contains "$CALC" '"totalPayoff"' "Calculate payoff returns totalPayoff"
assert_contains "$CALC" '"breakdown"' "Calculate payoff returns breakdown"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "========================================================================"
echo "                    E2E SWARM INTELLIGENCE TEST RESULTS                 "
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
echo "  Tested endpoints:"
echo "    - Pheromones: 6 endpoints (deposit, query, resource, activity, decay, stats)"
echo "    - Beliefs: 5 endpoints (upsert, get, meta, consensus, stats)"
echo "    - Credits: 7 endpoints (get, leaderboard, transfer, transaction, history, stats, reputation)"
echo "    - Consensus: 6 endpoints (create, list, get, vote, close, stats)"
echo "    - Bidding: 8 endpoints (submit, task-bids, get, evaluate, withdraw, accept, auction, stats)"
echo "    - Payoffs: 3 endpoints (define, get, calculate)"
echo ""
echo "  Total: 35 endpoints tested"
echo "========================================================================"
echo ""

exit 0
