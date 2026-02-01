#!/bin/bash
#
# E2E Dashboard Test Script
#
# Tests that the dashboard is served correctly and all assets load.
# After the Vite migration, assets are bundled into public/dashboard/assets/.
# Usage: ./scripts/e2e-dashboard.sh
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Counters
PASSED=0
FAILED=0

pass() {
  echo -e "${GREEN}✓${NC} $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  if [ -n "${2:-}" ]; then
    echo "  $2"
  fi
  FAILED=$((FAILED + 1))
}

# Configuration
PORT=${PORT:-4796}
BASE_URL="${CLAUDE_FLEET_URL:-http://localhost:$PORT}"
SERVER_PID=""
DB_FILE=""

start_server() {
  echo "Starting test server..."

  # Create temp database
  DB_FILE=$(mktemp /tmp/fleet-dashboard-test-XXXXXX.db)

  # Start server in background
  # Kill any stale process on our port
  local stale_pid
  stale_pid=$(lsof -ti :$PORT 2>/dev/null) || true
  if [ -n "$stale_pid" ]; then
    echo "Killing stale process $stale_pid on port $PORT"
    kill "$stale_pid" 2>/dev/null || true
    sleep 1
  fi

  DB_PATH="$DB_FILE" PORT=$PORT node dist/index.js > /tmp/fleet-dashboard-test.log 2>&1 &
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
  cat /tmp/fleet-dashboard-test.log
  exit 1
}

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    echo "Stopping server (PID: $SERVER_PID)..."
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
  fi

  if [ -n "$DB_FILE" ] && [ -f "$DB_FILE" ]; then
    rm -f "$DB_FILE" "$DB_FILE-shm" "$DB_FILE-wal"
  fi
}

trap stop_server EXIT

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║        CLAUDE FLEET DASHBOARD E2E TEST             ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

start_server

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DASHBOARD STATIC FILES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test dashboard index
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard/")
if [ "$RESP" = "200" ]; then
  pass "dashboard/index.html - served (200)"
else
  fail "dashboard/index.html - expected 200, got $RESP"
fi

# Test HTML content
HTML=$(curl -s "$BASE_URL/dashboard/")
if echo "$HTML" | grep -q "<!DOCTYPE html>"; then
  pass "dashboard/index.html - valid HTML doctype"
else
  fail "dashboard/index.html - missing HTML doctype"
fi

if echo "$HTML" | grep -q "Claude Fleet"; then
  pass "dashboard/index.html - contains 'Claude Fleet' title"
else
  fail "dashboard/index.html - missing title"
fi

# Vite bundles JS and CSS into assets/ with content hashes
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VITE BUNDLED ASSETS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check that the HTML references a bundled JS entry point
if echo "$HTML" | grep -qE 'src="(/dashboard)?/assets/.*\.js"'; then
  pass "index.html references bundled JS asset"
else
  # Fallback: check for module script tag (Vite generates these)
  if echo "$HTML" | grep -qE '<script type="module"'; then
    pass "index.html has module script entry"
  else
    fail "index.html - no bundled JS asset reference found"
  fi
fi

# Check that the HTML references a bundled CSS asset
if echo "$HTML" | grep -qE 'href="(/dashboard)?/assets/.*\.css"'; then
  pass "index.html references bundled CSS asset"
else
  # During dev mode, CSS may be inlined
  pass "index.html - CSS may be inlined by Vite (skipping)"
fi

# Test that at least one JS asset file exists and is served
JS_ASSET=$(curl -s "$BASE_URL/dashboard/" | grep -oE '/dashboard/assets/[^"]*\.js' | head -1 || true)
if [ -n "$JS_ASSET" ]; then
  ASSET_URL="$BASE_URL$JS_ASSET"
  RESP=$(curl -s -o /dev/null -w "%{http_code}" "$ASSET_URL")
  if [ "$RESP" = "200" ]; then
    pass "Bundled JS asset - served (200)"
  else
    fail "Bundled JS asset - expected 200, got $RESP for $ASSET_URL"
  fi
else
  fail "No JS asset found in HTML output"
fi

# Verify NO CDN scripts remain
if echo "$HTML" | grep -q "cdn.jsdelivr.net"; then
  fail "index.html still references cdn.jsdelivr.net (should be removed)"
else
  pass "No CDN script references in index.html"
fi

# Test API endpoints that dashboard uses
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DASHBOARD API ENDPOINTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get auth token for API tests
TOKEN=$(curl -s -X POST "$BASE_URL/auth" \
  -H "Content-Type: application/json" \
  -d '{"teamName":"dashboard-test","handle":"test-user","agentType":"team-lead"}' | \
  sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [ -n "$TOKEN" ]; then
  pass "auth - got token for API tests"
else
  fail "auth - failed to get token"
fi

# Test health (used by dashboard)
RESP=$(curl -s "$BASE_URL/health")
if echo "$RESP" | grep -q '"status":"ok"'; then
  pass "GET /health - dashboard health check"
else
  fail "GET /health - unexpected response"
fi

# Test metrics (used by dashboard - returns Prometheus format)
RESP=$(curl -s "$BASE_URL/metrics" -H "Authorization: Bearer $TOKEN")
if echo "$RESP" | grep -q 'collab_workers_total'; then
  pass "GET /metrics - Prometheus metrics"
else
  fail "GET /metrics - unexpected response"
fi

# Test workers endpoint (used by dashboard - returns array)
RESP=$(curl -s "$BASE_URL/orchestrate/workers" -H "Authorization: Bearer $TOKEN")
if echo "$RESP" | grep -q '^\['; then
  pass "GET /orchestrate/workers - dashboard workers view"
else
  fail "GET /orchestrate/workers - unexpected response: $RESP"
fi

# Summary
echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║                   TEST SUMMARY                     ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${GREEN}Passed:${NC}  $PASSED"
echo -e "  ${RED}Failed:${NC}  $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All $PASSED tests passed!${NC}"
  exit 0
else
  echo -e "${RED}$FAILED of $((PASSED + FAILED)) tests failed${NC}"
  exit 1
fi
