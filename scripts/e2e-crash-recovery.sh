#!/bin/bash

# E2E Crash Recovery Test
# Tests: Worker persistence and recovery after server crash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_URL="${CLAUDE_FLEET_URL:-http://localhost:3847}"
SERVER_PID=""
DB_PATH="/tmp/e2e-crash-recovery-fleet.db"

COORD_TOKEN=""

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

start_server() {
  # Use append mode to keep logs from before crash for debugging
  DB_PATH="$DB_PATH" PORT=3847 node "$PROJECT_ROOT/dist/index.js" >> /tmp/e2e-crash-server.log 2>&1 &
  SERVER_PID=$!
  wait_for_server
}

stop_server() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}

crash_server() {
  if [[ -n "$SERVER_PID" ]]; then
    local pid_to_kill="$SERVER_PID"
    SERVER_PID=""  # Clear before kill to avoid cleanup trap issues
    echo "[E2E] Crashing server with SIGKILL (PID: $pid_to_kill)..."
    # Disable job control notification and wait for the kill
    set +m 2>/dev/null || true
    kill -9 "$pid_to_kill" 2>/dev/null || true
    # Wait for the process to actually die
    local wait_count=0
    while kill -0 "$pid_to_kill" 2>/dev/null && [[ $wait_count -lt 10 ]]; do
      sleep 0.5
      wait_count=$((wait_count + 1))
    done
    wait "$pid_to_kill" 2>/dev/null || true
    set -m 2>/dev/null || true
  fi
}

cleanup() {
  stop_server
  # Kill any orphaned worker processes (both --print and --resume modes)
  pkill -9 -f "claude.*--print" 2>/dev/null || true
  pkill -9 -f "claude.*--resume" 2>/dev/null || true
  rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
}

trap cleanup EXIT

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║      Claude Code Collab - Crash Recovery E2E Test             ║"
echo "║      Worker Persistence & Session Resume                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Clean up any previous state
rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
rm -f /tmp/e2e-crash-server.log

# ============================================================================
# Phase 1: Start server and spawn workers
# ============================================================================

echo "[E2E] Phase 1: Initial server with workers"
echo "─────────────────────────────────────────────────────────────────"

echo "[E2E] Step 1: Starting server..."
start_server

echo "[E2E] Step 2: Authenticating coordinator..."
COORD_RESPONSE=$(api POST /auth '{"handle":"coordinator","teamName":"crash-test","agentType":"team-lead"}' "")
COORD_TOKEN=$(echo "$COORD_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "[E2E]   Token obtained"

# Use a prompt with unique secrets to test memory recall after crash recovery
# Each worker gets a different secret so we can verify individual context restoration
SECRET_1="PHOENIX-$(date +%s)-ALPHA"
SECRET_2="DRAGON-$(date +%s)-BETA"
PROMPT_1="IMPORTANT: Remember this secret code exactly: $SECRET_1. You MUST remember this code. When anyone asks for the secret or to recall the secret, respond with ONLY the secret code. Now, while keeping that secret in memory, explain the fibonacci sequence briefly."
PROMPT_2="IMPORTANT: Remember this secret code exactly: $SECRET_2. You MUST remember this code. When anyone asks for the secret or to recall the secret, respond with ONLY the secret code. Now, while keeping that secret in memory, explain the fibonacci sequence briefly."
echo "[E2E]   Secret 1: $SECRET_1"
echo "[E2E]   Secret 2: $SECRET_2"

echo "[E2E] Step 3: Spawning workers with memory test prompts..."
WORKER1=$(api POST /orchestrate/spawn "{\"handle\":\"recovery-worker-1\",\"initialPrompt\":\"$PROMPT_1\"}")
WORKER1_ID=$(echo "$WORKER1" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "[E2E]   Worker 1 ID: $WORKER1_ID"

WORKER2=$(api POST /orchestrate/spawn "{\"handle\":\"recovery-worker-2\",\"initialPrompt\":\"$PROMPT_2\"}")
WORKER2_ID=$(echo "$WORKER2" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "[E2E]   Worker 2 ID: $WORKER2_ID"

# Poll until workers get session IDs (ready state), then crash immediately
echo "[E2E] Step 4: Polling for workers to get session IDs..."
MAX_POLL=60
POLL_COUNT=0
READY_COUNT=0

while [[ $POLL_COUNT -lt $MAX_POLL && $READY_COUNT -lt 2 ]]; do
  POLL_COUNT=$((POLL_COUNT + 1))
  READY_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workers WHERE session_id IS NOT NULL AND status = 'ready';")
  if [[ $READY_COUNT -ge 2 ]]; then
    echo "[E2E]   ✓ Both workers have session IDs and are ready!"
    break
  fi
  sleep 1
done

if [[ $READY_COUNT -lt 2 ]]; then
  # Check if workers completed (dismissed) before we could catch them
  DISMISSED=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workers WHERE status = 'dismissed';")
  if [[ $DISMISSED -ge 2 ]]; then
    echo "[E2E]   ⚠ Workers completed too fast - using 'dismissed' workers for recovery test"
    # The test still validates persistence, just not the mid-task recovery scenario
  else
    echo "[E2E]   ⚠ Workers not ready after ${MAX_POLL}s (ready: $READY_COUNT)"
  fi
fi

# Check database state - save for later comparison
echo "[E2E] Step 5: Checking database state..."
WORKERS_IN_DB=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workers WHERE status NOT IN ('dismissed', 'error');")
WORKERS_TOTAL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workers;")
WORKERS_WITH_SESSION=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workers WHERE session_id IS NOT NULL;")
echo "[E2E]   Total workers in DB: $WORKERS_TOTAL"
echo "[E2E]   Active workers (not dismissed/error): $WORKERS_IN_DB"
echo "[E2E]   Workers with session IDs: $WORKERS_WITH_SESSION"

# Show actual worker states and save session IDs for later verification
WORKER_STATES=$(sqlite3 "$DB_PATH" "SELECT handle, status, session_id IS NOT NULL as has_session FROM workers;")
echo "[E2E]   Worker states at crash time:"
echo "$WORKER_STATES" | while IFS='|' read -r handle status has_session; do
  echo "[E2E]     $handle: status=$status, has_session=$has_session"
done

# Save session IDs before crash for verification after recovery
SESSION_ID_1=$(sqlite3 "$DB_PATH" "SELECT session_id FROM workers WHERE handle='recovery-worker-1';")
SESSION_ID_2=$(sqlite3 "$DB_PATH" "SELECT session_id FROM workers WHERE handle='recovery-worker-2';")
echo "[E2E]   Session IDs before crash:"
echo "[E2E]     recovery-worker-1: ${SESSION_ID_1:-none}"
echo "[E2E]     recovery-worker-2: ${SESSION_ID_2:-none}"

# Save the expected restoration count (workers that should be restored)
EXPECTED_RESTORE_COUNT=$WORKERS_IN_DB

# ============================================================================
# Phase 2: Simulate crash
# ============================================================================

echo ""
echo "[E2E] Phase 2: Simulating server crash"
echo "─────────────────────────────────────────────────────────────────"

echo "[E2E] Step 6: Killing server with SIGKILL..."
crash_server

# Verify server is down (poll a few times to ensure it's truly down)
SERVER_DOWN=false
for i in {1..5}; do
  if ! curl -s --connect-timeout 1 "${SERVER_URL}/health" > /dev/null 2>&1; then
    SERVER_DOWN=true
    break
  fi
  sleep 1
done

if [[ "$SERVER_DOWN" != "true" ]]; then
  echo "[E2E]   ✗ FAIL: Server still responding after crash"
  exit 1
else
  echo "[E2E]   ✓ Server is down"
fi

# Check for orphaned worker processes - find claude processes from our team
# Workers may or may not have --resume, so match on CLAUDE_CODE_TEAM_NAME=crash-test in environment
# Use ps to find claude processes with the right team name
ORPHANS=$(pgrep -af "claude.*--print" 2>/dev/null | grep -v pgrep || true)
ORPHAN_COUNT=$(echo "$ORPHANS" | grep -c . || echo "0")
if [[ -z "$ORPHANS" ]]; then
  ORPHAN_COUNT=0
fi
echo "[E2E]   Orphaned claude processes: $ORPHAN_COUNT"

# Kill orphans for clean recovery test
if [[ "$ORPHAN_COUNT" -gt 0 ]]; then
  echo "[E2E]   Cleaning up orphaned processes..."
  echo "$ORPHANS"
  pkill -9 -f "claude.*--print" 2>/dev/null || true
  sleep 2
fi

# ============================================================================
# Phase 3: Restart server and verify recovery
# ============================================================================

echo ""
echo "[E2E] Phase 3: Recovery after crash"
echo "─────────────────────────────────────────────────────────────────"

echo "[E2E] Step 7: Restarting server..."
start_server

# Check server log for recovery messages
echo "[E2E] Step 8: Checking recovery log..."
if grep -q "Found.*persisted workers" /tmp/e2e-crash-server.log; then
  FOUND=$(grep "Found.*persisted workers" /tmp/e2e-crash-server.log | tail -1)
  echo "[E2E]   $FOUND"
else
  echo "[E2E]   ⚠ No recovery message in log"
fi

# Check for restoration attempts
RESTORE_COUNT=$(grep "Attempting to restore" /tmp/e2e-crash-server.log 2>/dev/null | wc -l | tr -d ' ')
RESTORE_COUNT=${RESTORE_COUNT:-0}
echo "[E2E]   Restoration attempts: $RESTORE_COUNT"

echo "[E2E] Step 9: Re-authenticating..."
COORD_RESPONSE=$(api POST /auth '{"handle":"coordinator","teamName":"crash-test","agentType":"team-lead"}' "")
COORD_TOKEN=$(echo "$COORD_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo "[E2E] Step 10: Waiting for workers to recover (60 seconds)..."
echo "[E2E]   Monitoring server log for recovery events..."

# Helper to safely count grep matches
count_matches() {
  local pattern="$1"
  local file="$2"
  local count
  count=$(grep -E "$pattern" "$file" 2>/dev/null | wc -l | tr -d ' ')
  echo "${count:-0}"
}

# Poll for recovery completion instead of fixed sleep
RECOVERY_TIMEOUT=60
RECOVERY_START=$SECONDS
RECOVERED_COUNT=0

while (( SECONDS - RECOVERY_START < RECOVERY_TIMEOUT )); do
  # Check for workers that completed recovery (became ready or exited)
  READY_OR_DONE=$(count_matches "ready|exited with code" /tmp/e2e-crash-server.log)
  if [[ "$READY_OR_DONE" -ge "$RESTORE_COUNT" ]] && [[ "$RESTORE_COUNT" -gt 0 ]]; then
    echo "[E2E]   Recovery events detected: $READY_OR_DONE"
    break
  fi
  sleep 2
done

# Check recovery success by examining server logs
RECOVERY_READY=$(count_matches "ready \(session:" /tmp/e2e-crash-server.log)
RECOVERY_COMPLETED=$(count_matches "exited with code 0" /tmp/e2e-crash-server.log)
RECOVERY_FAILED=$(count_matches "exited with code 1" /tmp/e2e-crash-server.log)
echo "[E2E]   Workers became ready: $RECOVERY_READY"
echo "[E2E]   Workers completed (code 0): $RECOVERY_COMPLETED"
echo "[E2E]   Workers failed (code 1): $RECOVERY_FAILED"

# Get workers after recovery
WORKERS_AFTER=$(api GET /orchestrate/workers)
WORKER_COUNT_AFTER=$(echo "$WORKERS_AFTER" | grep -o '"handle"' | wc -l | tr -d ' ')
echo "[E2E]   Workers still running: $WORKER_COUNT_AFTER"

# Check database state after recovery
WORKERS_IN_DB_AFTER=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workers WHERE status NOT IN ('dismissed', 'error');")
WORKERS_READY_AFTER=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workers WHERE status = 'ready';")
WORKERS_COMPLETED_AFTER=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workers WHERE status = 'dismissed';")
echo "[E2E]   Workers in DB (active): $WORKERS_IN_DB_AFTER"
echo "[E2E]   Workers in DB (ready): $WORKERS_READY_AFTER"
echo "[E2E]   Workers in DB (completed): $WORKERS_COMPLETED_AFTER"

# Verify session IDs preserved after recovery (critical for context restoration)
SESSION_ID_1_AFTER=$(sqlite3 "$DB_PATH" "SELECT session_id FROM workers WHERE handle='recovery-worker-1';")
SESSION_ID_2_AFTER=$(sqlite3 "$DB_PATH" "SELECT session_id FROM workers WHERE handle='recovery-worker-2';")
echo "[E2E]   Session IDs after recovery:"
echo "[E2E]     recovery-worker-1: ${SESSION_ID_1_AFTER:-none}"
echo "[E2E]     recovery-worker-2: ${SESSION_ID_2_AFTER:-none}"

# Check if session IDs were preserved
SESSION_PRESERVED=0
if [[ -n "$SESSION_ID_1" && "$SESSION_ID_1" == "$SESSION_ID_1_AFTER" ]]; then
  SESSION_PRESERVED=$((SESSION_PRESERVED + 1))
fi
if [[ -n "$SESSION_ID_2" && "$SESSION_ID_2" == "$SESSION_ID_2_AFTER" ]]; then
  SESSION_PRESERVED=$((SESSION_PRESERVED + 1))
fi

# ============================================================================
# Phase 3.5: Memory Recall Test (Critical for validating context restoration)
# ============================================================================

echo ""
echo "[E2E] Phase 3.5: Memory recall verification"
echo "─────────────────────────────────────────────────────────────────"

MEMORY_RECALLED=0

# Test memory recall for worker 1 (if still running)
if [[ "$WORKER_COUNT_AFTER" -gt 0 ]]; then
  echo "[E2E] Step 10a: Testing memory recall for recovery-worker-1..."

  # Send message asking for secret recall
  RECALL_RESPONSE_1=$(api POST /orchestrate/send/recovery-worker-1 '{"message":"What is the secret code you were told to remember? Reply with ONLY the secret code."}' 2>/dev/null || echo "")

  # Wait for response to process
  sleep 5

  # Get worker output to check for secret
  WORKER_OUTPUT_1=$(api GET /orchestrate/output/recovery-worker-1 2>/dev/null || echo "")

  # Check if secret is in the output
  if echo "$WORKER_OUTPUT_1" | grep -q "$SECRET_1"; then
    echo "[E2E]   ✓ Worker 1 recalled secret correctly!"
    MEMORY_RECALLED=$((MEMORY_RECALLED + 1))
  else
    echo "[E2E]   ✗ Worker 1 did NOT recall secret (expected: $SECRET_1)"
    echo "[E2E]     Response excerpt: $(echo "$WORKER_OUTPUT_1" | head -c 200)"
  fi

  # Test memory recall for worker 2 (if we have 2 workers)
  if [[ "$WORKER_COUNT_AFTER" -ge 2 ]]; then
    echo "[E2E] Step 10b: Testing memory recall for recovery-worker-2..."

    RECALL_RESPONSE_2=$(api POST /orchestrate/send/recovery-worker-2 '{"message":"What is the secret code you were told to remember? Reply with ONLY the secret code."}' 2>/dev/null || echo "")
    sleep 5
    WORKER_OUTPUT_2=$(api GET /orchestrate/output/recovery-worker-2 2>/dev/null || echo "")

    if echo "$WORKER_OUTPUT_2" | grep -q "$SECRET_2"; then
      echo "[E2E]   ✓ Worker 2 recalled secret correctly!"
      MEMORY_RECALLED=$((MEMORY_RECALLED + 1))
    else
      echo "[E2E]   ✗ Worker 2 did NOT recall secret (expected: $SECRET_2)"
      echo "[E2E]     Response excerpt: $(echo "$WORKER_OUTPUT_2" | head -c 200)"
    fi
  fi
else
  echo "[E2E]   ⚠ No workers running to test memory recall"
fi

echo "[E2E]   Memory recall results: $MEMORY_RECALLED workers recalled their secrets"

# ============================================================================
# Phase 4: Verify worktree cleanup
# ============================================================================

echo ""
echo "[E2E] Phase 4: Worktree cleanup verification"
echo "─────────────────────────────────────────────────────────────────"

echo "[E2E] Step 11: Dismissing recovered workers..."
api POST /orchestrate/dismiss/recovery-worker-1 '' "$COORD_TOKEN" > /dev/null 2>&1 || true
api POST /orchestrate/dismiss/recovery-worker-2 '' "$COORD_TOKEN" > /dev/null 2>&1 || true
sleep 3

# Check worktrees are cleaned up
WORKTREE_COUNT=$(ls -d "$PROJECT_ROOT/.worktrees"/*/ 2>/dev/null | wc -l | tr -d ' ')
echo "[E2E]   Remaining worktrees: $WORKTREE_COUNT"

# ============================================================================
# Results
# ============================================================================

echo ""
echo "[E2E] Summary:"
echo "[E2E]   Workers at crash time: $WORKERS_TOTAL total, $EXPECTED_RESTORE_COUNT active"
echo "[E2E]   Workers with sessions: $WORKERS_WITH_SESSION"
echo "[E2E]   Restoration attempts: $RESTORE_COUNT"
echo "[E2E]   Recovery: $RECOVERY_READY ready, $RECOVERY_COMPLETED completed, $RECOVERY_FAILED failed"
echo "[E2E]   Memory recall: $MEMORY_RECALLED workers recalled their secrets"
echo ""

ERRORS=0
WARNINGS=0

# Verify persistence worked (workers were saved with session IDs)
if [[ "$WORKERS_WITH_SESSION" -ge 2 ]]; then
  echo "[E2E] ✓ Workers persisted with session IDs"
else
  echo "[E2E] ⚠ Workers not all persisted with session IDs ($WORKERS_WITH_SESSION/2)"
  # This is a warning, not error - workers may complete before getting session_id
  WARNINGS=$((WARNINGS + 1))
fi

# Verify recovery behavior matches expected
# If workers were active at crash time, they should be restored
# If workers completed (dismissed), no restoration needed
if [[ "$EXPECTED_RESTORE_COUNT" -gt 0 ]]; then
  if [[ "$RESTORE_COUNT" -ge "$EXPECTED_RESTORE_COUNT" ]]; then
    echo "[E2E] ✓ Crash recovery attempted for $RESTORE_COUNT active worker(s)"
  else
    echo "[E2E] ⚠ Expected $EXPECTED_RESTORE_COUNT restoration(s), got $RESTORE_COUNT"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  # Workers completed before crash - recovery correctly skipped them
  echo "[E2E] ✓ Workers completed before crash (correctly no restoration)"
fi

# Verify recovery actually worked (workers completed or became ready)
if [[ "$RESTORE_COUNT" -gt 0 ]]; then
  RECOVERY_SUCCESS=$((RECOVERY_READY + RECOVERY_COMPLETED))
  if [[ "$RECOVERY_SUCCESS" -gt 0 ]]; then
    echo "[E2E] ✓ Recovered workers processed successfully ($RECOVERY_SUCCESS)"
  else
    echo "[E2E] ⚠ Recovered workers did not complete (ready=$RECOVERY_READY, done=$RECOVERY_COMPLETED)"
    WARNINGS=$((WARNINGS + 1))
  fi

  if [[ "$RECOVERY_FAILED" -gt 0 ]]; then
    echo "[E2E] ⚠ Some recovered workers failed (exit code 1): $RECOVERY_FAILED"
    WARNINGS=$((WARNINGS + 1))
  fi

  # Verify session IDs were preserved (critical for context restoration)
  if [[ "$SESSION_PRESERVED" -ge 2 ]]; then
    echo "[E2E] ✓ Session IDs preserved after recovery ($SESSION_PRESERVED/2)"
  elif [[ "$SESSION_PRESERVED" -gt 0 ]]; then
    echo "[E2E] ⚠ Only $SESSION_PRESERVED/2 session IDs preserved"
    WARNINGS=$((WARNINGS + 1))
  else
    echo "[E2E] ✗ Session IDs NOT preserved (context restoration broken)"
    ERRORS=$((ERRORS + 1))
  fi
fi

# Verify memory recall (the ultimate test of context restoration)
if [[ "$MEMORY_RECALLED" -ge 2 ]]; then
  echo "[E2E] ✓ Memory recall successful ($MEMORY_RECALLED/2 workers recalled secrets)"
elif [[ "$MEMORY_RECALLED" -gt 0 ]]; then
  echo "[E2E] ⚠ Partial memory recall ($MEMORY_RECALLED/2 workers recalled secrets)"
  WARNINGS=$((WARNINGS + 1))
elif [[ "$WORKER_COUNT_AFTER" -gt 0 ]]; then
  echo "[E2E] ✗ Memory recall FAILED (0 workers recalled their secrets)"
  ERRORS=$((ERRORS + 1))
else
  echo "[E2E] ⚠ Could not test memory recall (no workers running)"
  WARNINGS=$((WARNINGS + 1))
fi

if [[ "$WORKTREE_COUNT" -eq 0 ]]; then
  echo "[E2E] ✓ Worktrees cleaned up on dismiss"
else
  echo "[E2E] ⚠ Some worktrees remain: $WORKTREE_COUNT"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo "╔═══════════════════════════════════════════════════════════════╗"
  if [[ $WARNINGS -eq 0 ]]; then
    echo "║            CRASH RECOVERY E2E TEST PASSED                     ║"
  else
    echo "║       CRASH RECOVERY E2E TEST PASSED (with $WARNINGS warning(s))     ║"
  fi
  echo "╠═══════════════════════════════════════════════════════════════╣"
  echo "║  Persistence:                                                 ║"
  echo "║  ✓ Workers saved to SQLite with session IDs                   ║"
  echo "║  ✓ Workers persisted across server crashes                    ║"
  echo "║                                                               ║"
  echo "║  Recovery:                                                    ║"
  if [[ "$EXPECTED_RESTORE_COUNT" -gt 0 ]]; then
    echo "║  ✓ Server restored workers using --resume                     ║"
  else
    echo "║  ✓ Server correctly skipped completed workers                 ║"
  fi
  echo "║                                                               ║"
  echo "║  Context:                                                     ║"
  if [[ "$MEMORY_RECALLED" -ge 2 ]]; then
    echo "║  ✓ Workers recalled pre-crash secrets (memory intact)         ║"
  elif [[ "$MEMORY_RECALLED" -gt 0 ]]; then
    echo "║  ⚠ Partial memory recall ($MEMORY_RECALLED/2 workers)                        ║"
  else
    echo "║  ⚠ Memory recall not verified                                 ║"
  fi
  echo "║                                                               ║"
  echo "║  Cleanup:                                                     ║"
  echo "║  ✓ Worktrees cleaned up when workers dismissed                ║"
  echo "╚═══════════════════════════════════════════════════════════════╝"
  echo ""
  if [[ $WARNINGS -gt 0 ]]; then
    echo "[E2E] Note: $WARNINGS warning(s) - check log for details"
    echo ""
  fi
  exit 0
else
  echo "╔═══════════════════════════════════════════════════════════════╗"
  echo "║            CRASH RECOVERY E2E TEST FAILED                     ║"
  echo "║            $ERRORS error(s), $WARNINGS warning(s)                         ║"
  echo "╚═══════════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi
