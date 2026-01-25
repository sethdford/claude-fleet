#!/bin/bash
#
# Demo: Tmux Fleet Management
#
# This script demonstrates spawning multiple Claude workers in tmux panes
# and orchestrating them.
#
# Prerequisites:
#   - Run inside a tmux session: tmux new-session -s demo
#   - Build the project first: pnpm build
#
# Usage:
#   ./scripts/demo-tmux-fleet.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}       Tmux Fleet Management Demo${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# Check if inside tmux
if [ -z "$TMUX" ]; then
    echo -e "${RED}ERROR: Not running inside tmux!${NC}"
    echo ""
    echo "Please start a tmux session first:"
    echo "  tmux new-session -s demo"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo -e "${GREEN}✓ Running inside tmux${NC}"
echo ""

cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

# Check if cct/cf is available
if command -v cct &> /dev/null; then
    CF="cct"
elif [ -x "$PROJECT_DIR/cf" ]; then
    CF="$PROJECT_DIR/cf"
else
    echo -e "${YELLOW}cct command not found, using local ./cf runner...${NC}"
    CF="node $PROJECT_DIR/apps/cli/dist/index.js"
fi
echo -e "${BLUE}Project directory: ${PROJECT_DIR}${NC}"
echo ""

# Show initial status
echo -e "${CYAN}━━━ Initial Status ━━━${NC}"
$CF tmux status
echo ""

# Spawn workers
echo -e "${CYAN}━━━ Spawning Workers ━━━${NC}"
echo ""

echo -e "${YELLOW}Spawning worker 'alice' (horizontal split)...${NC}"
$CF tmux spawn alice --direction horizontal --role scout
sleep 1

echo -e "${YELLOW}Spawning worker 'bob' (vertical split)...${NC}"
$CF tmux spawn bob --direction vertical --role worker
sleep 1

echo -e "${YELLOW}Spawning worker 'carol' with a command...${NC}"
$CF tmux spawn carol --command "echo 'Hello from Carol!' && sleep 2 && echo 'Carol is ready'"
sleep 1

echo ""
echo -e "${GREEN}✓ Workers spawned${NC}"
echo ""

# Show workers
echo -e "${CYAN}━━━ Worker List ━━━${NC}"
$CF tmux workers
echo ""

# Show all panes
echo -e "${CYAN}━━━ All Panes ━━━${NC}"
$CF tmux panes
echo ""

# Send commands to workers
echo -e "${CYAN}━━━ Sending Commands ━━━${NC}"
echo ""

echo -e "${YELLOW}Sending 'echo Hello Alice' to alice...${NC}"
$CF tmux send alice "echo 'Hello Alice! I am pane alice.'"
sleep 1

echo -e "${YELLOW}Sending 'echo Hello Bob' to bob...${NC}"
$CF tmux send bob "echo 'Hello Bob! I am pane bob.'"
sleep 1

echo ""
echo -e "${GREEN}✓ Commands sent${NC}"
echo ""

# Wait for idle
echo -e "${CYAN}━━━ Waiting for Workers to Idle ━━━${NC}"
echo ""

echo -e "${YELLOW}Waiting for alice to become idle...${NC}"
$CF tmux wait-idle alice --timeout 5000 --stable 500
echo ""

# Capture output
echo -e "${CYAN}━━━ Capturing Output ━━━${NC}"
echo ""

echo -e "${YELLOW}Output from alice:${NC}"
echo "---"
$CF tmux capture alice --lines 10
echo "---"
echo ""

echo -e "${YELLOW}Output from bob:${NC}"
echo "---"
$CF tmux capture bob --lines 10
echo "---"
echo ""

echo -e "${YELLOW}Output from carol:${NC}"
echo "---"
$CF tmux capture carol --lines 10
echo "---"
echo ""

# Execute command with result
echo -e "${CYAN}━━━ Executing Command with Exit Code ━━━${NC}"
echo ""

echo -e "${YELLOW}Running 'ls -la' in alice and waiting for result...${NC}"
$CF tmux exec alice "ls -la" --timeout 10000 --json
echo ""

# Broadcast
echo -e "${CYAN}━━━ Broadcasting to All Workers ━━━${NC}"
echo ""

echo -e "${YELLOW}Broadcasting 'echo Fleet broadcast received!'...${NC}"
$CF tmux broadcast "echo 'Fleet broadcast received at $(date)'"
sleep 2

# Final status
echo -e "${CYAN}━━━ Final Status ━━━${NC}"
$CF tmux status
echo ""

# Cleanup prompt
echo -e "${CYAN}━━━ Cleanup ━━━${NC}"
echo ""
read -p "Kill all workers? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Killing all workers...${NC}"
    $CF tmux kill-all --yes
    echo -e "${GREEN}✓ All workers killed${NC}"
else
    echo -e "${BLUE}Workers left running. Kill them manually with:${NC}"
    echo "  cf tmux kill-all --yes"
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}           Demo Complete!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
