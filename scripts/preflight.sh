#!/bin/bash

# Claude Collab Local Preflight Check
# Validates environment before starting agents

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_URL="${CLAUDE_FLEET_URL:-http://localhost:3847}"

ERRORS=0
WARNINGS=0

echo ""
echo "Claude Collab Local Preflight Check"
echo "===================================="
echo ""

# Check Node.js
echo -n "Checking Node.js... "
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  echo "OK ($NODE_VERSION)"
else
  echo "MISSING"
  echo "  Install Node.js: https://nodejs.org/"
  ((ERRORS++))
fi

# Check npm
echo -n "Checking npm... "
if command -v npm &> /dev/null; then
  echo "OK ($(npm --version))"
else
  echo "MISSING"
  ((ERRORS++))
fi

# Check dependencies installed
echo -n "Checking dependencies... "
if [[ -d "$PROJECT_ROOT/node_modules" ]]; then
  if [[ -d "$PROJECT_ROOT/node_modules/better-sqlite3" ]] && \
     [[ -d "$PROJECT_ROOT/node_modules/express" ]] && \
     [[ -d "$PROJECT_ROOT/node_modules/ws" ]]; then
    echo "OK"
  else
    echo "INCOMPLETE"
    echo "  Run: cd $PROJECT_ROOT && npm install"
    ((ERRORS++))
  fi
else
  echo "NOT INSTALLED"
  echo "  Run: cd $PROJECT_ROOT && npm install"
  ((ERRORS++))
fi

# Check server running
echo -n "Checking server... "
if curl -s "${SERVER_URL}/health" > /dev/null 2>&1; then
  HEALTH=$(curl -s "${SERVER_URL}/health")
  AGENTS=$(echo "$HEALTH" | grep -o '"agents":[0-9]*' | cut -d: -f2 || echo "0")
  echo "RUNNING ($AGENTS agent(s) registered)"
else
  echo "NOT RUNNING"
  echo "  Start with: cd $PROJECT_ROOT && npm start"
  ((ERRORS++))
fi

# Check Claude Code CLI
echo -n "Checking Claude Code CLI... "
CLI_PATH=""

# Check common locations
LOCATIONS=(
  "/tmp/claude-code-analysis/package/cli.js"
  "$HOME/.npm/_npx"
)

for loc in "${LOCATIONS[@]}"; do
  if [[ -f "$loc" ]]; then
    CLI_PATH="$loc"
    break
  fi
done

# Check npm cache
if [[ -z "$CLI_PATH" ]] && [[ -d "$HOME/.npm/_npx" ]]; then
  for dir in "$HOME/.npm/_npx"/*/; do
    if [[ -f "${dir}node_modules/@anthropic-ai/claude-code/cli.js" ]]; then
      CLI_PATH="${dir}node_modules/@anthropic-ai/claude-code/cli.js"
      break
    fi
  done
fi

# Check if globally installed
if [[ -z "$CLI_PATH" ]] && command -v claude &> /dev/null; then
  CLI_PATH="$(which claude)"
fi

if [[ -n "$CLI_PATH" ]]; then
  echo "FOUND"
  echo "  Path: $CLI_PATH"
else
  echo "NOT FOUND"
  echo "  Run: npm run patch (will download and patch)"
  ((WARNINGS++))
fi

# Check if patched
echo -n "Checking CLI patched... "
if [[ -n "$CLI_PATH" ]] && [[ -f "$CLI_PATH" ]]; then
  if grep -q "CLAUDE COLLAB LOCAL IMPLEMENTATION" "$CLI_PATH" 2>/dev/null; then
    echo "YES"
  else
    echo "NO"
    echo "  Run: npm run patch"
    ((WARNINGS++))
  fi
else
  echo "SKIPPED (CLI not found)"
fi

# Check environment variables
echo -n "Checking CLAUDE_CODE_TEAM_NAME... "
if [[ -n "${CLAUDE_CODE_TEAM_NAME:-}" ]]; then
  echo "SET ($CLAUDE_CODE_TEAM_NAME)"
else
  echo "NOT SET"
  echo "  Set with: export CLAUDE_CODE_TEAM_NAME=\"your-team\""
  ((WARNINGS++))
fi

echo -n "Checking CLAUDE_CODE_AGENT_NAME... "
if [[ -n "${CLAUDE_CODE_AGENT_NAME:-}" ]]; then
  echo "SET ($CLAUDE_CODE_AGENT_NAME)"
else
  echo "NOT SET (will auto-generate)"
fi

echo -n "Checking CLAUDE_CODE_AGENT_TYPE... "
if [[ -n "${CLAUDE_CODE_AGENT_TYPE:-}" ]]; then
  echo "SET ($CLAUDE_CODE_AGENT_TYPE)"
else
  echo "NOT SET (defaults to 'worker')"
fi

# Check database
echo -n "Checking database... "
DB_PATH="${DB_PATH:-$PROJECT_ROOT/fleet.db}"
if [[ -f "$DB_PATH" ]]; then
  SIZE=$(du -h "$DB_PATH" | cut -f1)
  echo "EXISTS ($SIZE)"
else
  echo "NOT CREATED (will be created on first run)"
fi

echo ""
echo "===================================="

if [[ $ERRORS -gt 0 ]]; then
  echo "PREFLIGHT FAILED: $ERRORS error(s), $WARNINGS warning(s)"
  echo ""
  echo "Fix the errors above before starting agents."
  exit 1
else
  if [[ $WARNINGS -gt 0 ]]; then
    echo "PREFLIGHT PASSED with $WARNINGS warning(s)"
  else
    echo "PREFLIGHT PASSED"
  fi
  echo ""
  echo "Ready to run agents!"
  echo ""
  echo "  Terminal 1 (Lead):   ./run-lead.sh"
  echo "  Terminal 2 (Worker): ./run-worker.sh"
  echo ""
  exit 0
fi
