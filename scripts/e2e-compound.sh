#!/bin/bash

# E2E Integration Test for Compounding Machine
# Tests: Static files, Auth, Snapshot API, Seeded data, Time series,
#        HTML/CSS/JS content, WebSocket, Auth requirements

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PORT=${PORT:-4799}
SERVER_URL="${CLAUDE_FLEET_URL:-http://localhost:$PORT}"
SERVER_PID=""
DB_PATH="/tmp/e2e-compound-fleet.db"
LOG_FILE="/tmp/e2e-compound-server.log"

# Auth tokens
LEAD_TOKEN=""
LEAD_UID=""
WORKER_TOKEN=""

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

# --- Helpers ---

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

api_status() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"
  local token="${4:-}"

  if [[ -n "$data" && -n "$token" ]]; then
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "${SERVER_URL}${endpoint}" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $token" \
      -d "$data"
  elif [[ -n "$token" ]]; then
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "${SERVER_URL}${endpoint}" \
      -H "Authorization: Bearer $token"
  else
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "${SERVER_URL}${endpoint}"
  fi
}

extract_field() {
  local json="$1"
  local field="$2"
  echo "$json" | sed -n "s/.*\"${field}\":\"\([^\"]*\)\".*/\1/p" | head -1
}

extract_number() {
  local json="$1"
  local field="$2"
  echo "$json" | sed -n "s/.*\"${field}\":\([0-9.]*\).*/\1/p" | head -1
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
    echo "         Response (first 200 chars): $(echo "$response" | head -c 200)"
    return 0
  fi
}

assert_status() {
  local actual="$1"
  local expected="$2"
  local test_name="$3"

  if [[ "$actual" == "$expected" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  [PASS] $test_name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  [FAIL] $test_name - expected $expected, got $actual"
  fi
}

assert_not_empty() {
  local value="$1"
  local test_name="$2"

  if [[ -n "$value" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  [PASS] $test_name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  [FAIL] $test_name - value was empty"
  fi
}

assert_gt_zero() {
  local value="$1"
  local test_name="$2"

  # Handle empty value
  if [[ -z "$value" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  [FAIL] $test_name - value was empty"
    return 0
  fi

  # Compare as integer (strip decimal)
  local int_val
  int_val=$(echo "$value" | cut -d. -f1)
  if [[ "$int_val" -gt 0 ]] 2>/dev/null; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  [PASS] $test_name (value: $value)"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  [FAIL] $test_name - expected > 0, got $value"
  fi
}

# --- Start ---

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║     CLAUDE FLEET COMPOUND MACHINE E2E TEST         ║"
echo "╚════════════════════════════════════════════════════╝"
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

# ================================================================
#  SECTION 1: STATIC FILE SERVING
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 1: STATIC FILE SERVING"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

STATUS=$(api_status GET /compound/)
assert_status "$STATUS" "200" "GET /compound/ returns 200"

HTML=$(api GET /compound/)
assert_contains "$HTML" "<!doctype html>" "compound/index.html has HTML doctype"
assert_contains "$HTML" "Compounding Machine" "compound/index.html contains title"

STATUS=$(api_status GET /compound/styles/compound.css)
assert_status "$STATUS" "200" "GET /compound/styles/compound.css returns 200"

STATUS=$(api_status GET /compound/dist/main.js)
assert_status "$STATUS" "200" "GET /compound/dist/main.js returns 200"

# ================================================================
#  SECTION 2: AUTHENTICATION
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 2: AUTHENTICATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

AUTH_RESP=$(api POST /auth '{"teamName":"compound-test","handle":"test-lead","agentType":"team-lead"}')
LEAD_TOKEN=$(extract_field "$AUTH_RESP" "token")
LEAD_UID=$(extract_field "$AUTH_RESP" "uid")
assert_not_empty "$LEAD_TOKEN" "team-lead auth returns valid token"

WORKER_AUTH=$(api POST /auth '{"teamName":"compound-test","handle":"test-worker","agentType":"worker"}')
WORKER_TOKEN=$(extract_field "$WORKER_AUTH" "token")
assert_not_empty "$WORKER_TOKEN" "worker auth returns valid token"

# ================================================================
#  SECTION 3: COMPOUND SNAPSHOT API — EMPTY FLEET
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 3: COMPOUND SNAPSHOT — EMPTY FLEET"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

STATUS=$(api_status GET /compound/snapshot "" "$LEAD_TOKEN")
assert_status "$STATUS" "200" "GET /compound/snapshot returns 200"

SNAPSHOT=$(api GET /compound/snapshot "" "$LEAD_TOKEN")
assert_contains "$SNAPSHOT" '"workers":\[\]' "snapshot has empty workers array"
assert_contains "$SNAPSHOT" '"swarms":\[\]' "snapshot has empty swarms array"
assert_contains "$SNAPSHOT" '"total"' "snapshot tasks has total field"
assert_contains "$SNAPSHOT" '"compoundRate"' "snapshot rates has compoundRate"
assert_contains "$SNAPSHOT" '"timestamp"' "snapshot has timestamp field"

# ================================================================
#  SECTION 4: SEED FLEET DATA
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 4: SEED FLEET DATA"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "  Creating swarm..."
SWARM_RESP=$(api POST /swarms '{"name":"test-swarm","maxAgents":10}' "$LEAD_TOKEN")
SWARM_ID=$(extract_field "$SWARM_RESP" "id")
assert_not_empty "$SWARM_ID" "swarm created with ID"

echo "  Creating tasks..."
TASK1=$(api POST /tasks '{"subject":"Test task 1","teamName":"compound-test","toHandle":"test-worker","fromHandle":"test-lead","fromUid":"'"$LEAD_UID"'"}' "$LEAD_TOKEN")
TASK1_ID=$(extract_field "$TASK1" "id")

TASK2=$(api POST /tasks '{"subject":"Test task 2","teamName":"compound-test","toHandle":"test-worker","fromHandle":"test-lead","fromUid":"'"$LEAD_UID"'"}' "$LEAD_TOKEN")

echo "  Depositing pheromone trail..."
api POST /pheromones '{"swarmId":"'"$SWARM_ID"'","depositorHandle":"test-worker","resourceId":"src/main.ts","resourceType":"file","trailType":"touch","intensity":0.8}' "$LEAD_TOKEN" > /dev/null

echo "  Upserting belief..."
api POST /beliefs '{"swarmId":"'"$SWARM_ID"'","agentHandle":"test-worker","subject":"code-quality","beliefType":"observation","content":"Code is clean","confidence":0.9}' "$LEAD_TOKEN" > /dev/null

echo "  Recording credit transaction..."
api POST /credits/transaction '{"swarmId":"'"$SWARM_ID"'","agentHandle":"test-worker","amount":50,"type":"task_completion","description":"Completed task"}' "$LEAD_TOKEN" > /dev/null

echo "  Seeding complete."

# ================================================================
#  SECTION 5: COMPOUND SNAPSHOT — WITH DATA
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 5: COMPOUND SNAPSHOT — WITH DATA"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

STATUS=$(api_status GET /compound/snapshot "" "$LEAD_TOKEN")
assert_status "$STATUS" "200" "GET /compound/snapshot with data returns 200"

SNAPSHOT=$(api GET /compound/snapshot "" "$LEAD_TOKEN")
assert_contains "$SNAPSHOT" '"swarms":\[{' "snapshot swarms has entries"
assert_contains "$SNAPSHOT" '"total":' "snapshot tasks has total field"
assert_contains "$SNAPSHOT" '"byStatus"' "snapshot tasks has byStatus"

# Check intelligence for our swarm
assert_contains "$SNAPSHOT" "\"$SWARM_ID\"" "snapshot intelligence has our swarm ID"
assert_contains "$SNAPSHOT" '"totalBeliefs"' "intelligence has belief stats"
assert_contains "$SNAPSHOT" '"activeTrails"' "intelligence has pheromone stats"
assert_contains "$SNAPSHOT" '"leaderboard"' "intelligence has leaderboard"

# Check uptime exists (may be 0 if test runs within first second)
assert_contains "$SNAPSHOT" '"uptime"' "snapshot has uptime field"

# ================================================================
#  SECTION 6: TIME SERIES ACCUMULATION
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 6: TIME SERIES ACCUMULATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Call snapshot multiple times to build time series
echo "  Building time series (3 calls)..."
for i in 1 2 3; do
  api GET /compound/snapshot "" "$LEAD_TOKEN" > /dev/null
  sleep 1
done

SNAPSHOT=$(api GET /compound/snapshot "" "$LEAD_TOKEN")
assert_contains "$SNAPSHOT" '"timeSeries":\[{' "snapshot has non-empty timeSeries"
assert_contains "$SNAPSHOT" '"tasksCompleted"' "time series points have tasksCompleted"
assert_contains "$SNAPSHOT" '"activeWorkers"' "time series points have activeWorkers"
assert_contains "$SNAPSHOT" '"compoundRate":' "rates has compoundRate number"

# ================================================================
#  SECTION 7: HTML CONTENT VALIDATION
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 7: HTML CONTENT VALIDATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HTML=$(api GET /compound/)
assert_contains "$HTML" 'id="network-graph"' "HTML has network-graph SVG"
assert_contains "$HTML" 'id="growth-chart"' "HTML has growth-chart canvas"
assert_contains "$HTML" 'id="lineage-tree"' "HTML has lineage-tree SVG"
assert_contains "$HTML" 'id="activity-list"' "HTML has activity-list div"

# ================================================================
#  SECTION 8: CSS CONTENT VALIDATION
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 8: CSS CONTENT VALIDATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

CSS=$(api GET /compound/styles/compound.css)
assert_contains "$CSS" "\.panel" "CSS has .panel class"
assert_contains "$CSS" "#0d1117" "CSS has GitHub Dark background color"
assert_contains "$CSS" "@keyframes" "CSS has keyframe animations"

# ================================================================
#  SECTION 9: JAVASCRIPT BUNDLE VALIDATION
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 9: JAVASCRIPT BUNDLE VALIDATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

JS=$(api GET /compound/dist/main.js)
JS_LEN=${#JS}

if [[ $JS_LEN -gt 100 ]]; then
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  [PASS] JS bundle is non-empty ($JS_LEN chars)"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  [FAIL] JS bundle too small ($JS_LEN chars)"
fi

assert_contains "$JS" "/auth" "JS bundle contains /auth endpoint reference"
assert_contains "$JS" "WebSocket" "JS bundle contains WebSocket reference"

# ================================================================
#  SECTION 10: WEBSOCKET CONNECTION
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 10: WEBSOCKET CONNECTION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

WS_RESULT=$(node -e "
  const WebSocket = require('ws');
  const ws = new WebSocket('${SERVER_URL/http/ws}/ws');
  const results = [];

  ws.on('open', () => {
    results.push('connected');
    ws.send(JSON.stringify({ type: 'auth', token: '$LEAD_TOKEN' }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      results.push(msg.type || 'unknown');
      if (msg.type === 'authenticated' || results.length >= 3) {
        ws.close();
      }
    } catch {
      results.push('parse-error');
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log(JSON.stringify(results));
    process.exit(0);
  });

  ws.on('error', (err) => {
    console.log(JSON.stringify(['error', err.message]));
    process.exit(1);
  });

  setTimeout(() => {
    console.log(JSON.stringify(results.length > 0 ? results : ['timeout']));
    ws.close();
    process.exit(results.length > 0 ? 0 : 1);
  }, 5000);
" 2>/dev/null || echo '["error"]')

assert_contains "$WS_RESULT" "connected" "WebSocket connects successfully"
assert_contains "$WS_RESULT" "authenticated" "WebSocket auth returns authenticated"

# Check clean close (result is an array, not containing "error")
if echo "$WS_RESULT" | grep -qv '"error"'; then
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  [PASS] WebSocket closes cleanly"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  [FAIL] WebSocket had errors: $WS_RESULT"
fi

# ================================================================
#  SECTION 11: AUTH REQUIRED FOR SNAPSHOT
# ================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SECTION 11: AUTH REQUIRED FOR SNAPSHOT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

STATUS=$(api_status GET /compound/snapshot)
assert_status "$STATUS" "401" "GET /compound/snapshot without token returns 401"

STATUS=$(api_status GET /compound/snapshot "" "invalid-token-12345")
# Server returns 403 for invalid tokens (vs 401 for missing tokens)
if [[ "$STATUS" == "401" || "$STATUS" == "403" ]]; then
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  [PASS] GET /compound/snapshot with invalid token returns $STATUS"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  [FAIL] GET /compound/snapshot with invalid token - expected 401 or 403, got $STATUS"
fi

# ================================================================
#  TEST SUMMARY
# ================================================================
echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║                   TEST SUMMARY                     ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "  Passed:  $PASS_COUNT"
echo "  Failed:  $FAIL_COUNT"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
  echo "All $PASS_COUNT tests passed!"
  exit 0
else
  echo "$FAIL_COUNT of $((PASS_COUNT + FAIL_COUNT)) tests failed"
  exit 1
fi
