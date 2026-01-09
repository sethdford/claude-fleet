#!/bin/bash

# Run Claude Code as Team Lead
# Auto-detects CLI path and verifies server is running

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

#######################################
# Configuration
#######################################
export CLAUDE_CODE_TEAM_NAME="${CLAUDE_CODE_TEAM_NAME:-dev-team}"
export CLAUDE_CODE_AGENT_TYPE="team-lead"
export CLAUDE_CODE_AGENT_NAME="${CLAUDE_CODE_AGENT_NAME:-lead}"
export CLAUDE_CODE_COLLAB_URL="${CLAUDE_CODE_COLLAB_URL:-http://localhost:3847}"

#######################################
# Find Claude Code CLI
#######################################
find_cli() {
  # Check explicit environment variable
  if [[ -n "${CLAUDE_CODE_CLI_PATH:-}" ]] && [[ -f "$CLAUDE_CODE_CLI_PATH" ]]; then
    echo "$CLAUDE_CODE_CLI_PATH"
    return 0
  fi

  # Check common locations
  local locations=(
    "/tmp/claude-code-analysis/package/cli.js"
    "$HOME/.npm/_npx"
  )

  for loc in "${locations[@]}"; do
    if [[ -f "$loc" ]]; then
      echo "$loc"
      return 0
    fi
  done

  # Check npm cache
  if [[ -d "$HOME/.npm/_npx" ]]; then
    for dir in "$HOME/.npm/_npx"/*/; do
      local cli="${dir}node_modules/@anthropic-ai/claude-code/cli.js"
      if [[ -f "$cli" ]]; then
        echo "$cli"
        return 0
      fi
    done
  fi

  # Check if globally installed via which
  if command -v claude &> /dev/null; then
    echo "claude"
    return 0
  fi

  return 1
}

#######################################
# Check server health
#######################################
check_server() {
  if ! curl -s "${CLAUDE_CODE_COLLAB_URL}/health" > /dev/null 2>&1; then
    echo "ERROR: Collaboration server not running at $CLAUDE_CODE_COLLAB_URL"
    echo ""
    echo "Start it with:"
    echo "  cd $SCRIPT_DIR && npm start"
    echo ""
    exit 1
  fi
}

#######################################
# Main
#######################################
echo ""
echo "Claude Code Team Lead"
echo "====================="
echo ""
echo "  Team:   $CLAUDE_CODE_TEAM_NAME"
echo "  Agent:  $CLAUDE_CODE_AGENT_NAME ($CLAUDE_CODE_AGENT_TYPE)"
echo "  Server: $CLAUDE_CODE_COLLAB_URL"
echo ""

# Check server
echo -n "Checking server... "
check_server
echo "OK"

# Find CLI
echo -n "Finding CLI... "
CLI_PATH=$(find_cli) || {
  echo "NOT FOUND"
  echo ""
  echo "Run: npm run patch"
  exit 1
}
echo "OK"
echo "  Using: $CLI_PATH"
echo ""

# Run Claude Code
if [[ "$CLI_PATH" == "claude" ]]; then
  exec claude "$@"
else
  exec node "$CLI_PATH" "$@"
fi
