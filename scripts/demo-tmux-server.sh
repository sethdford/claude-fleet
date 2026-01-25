#!/bin/bash
#
# Demo: Tmux Fleet with Server Integration
#
# This script demonstrates the full workflow:
#   1. Start the fleet server
#   2. Spawn workers in tmux panes via the API
#   3. Create work items
#   4. Assign tasks to workers
#
# Prerequisites:
#   - Run inside a tmux session: tmux new-session -s demo
#   - Build the project first: npm run build
#
# Usage:
#   ./scripts/demo-tmux-server.sh
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
echo -e "${CYAN}   Tmux Fleet + Server Integration Demo${NC}"
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

SERVER_URL="http://localhost:3847"

# Check if server is running
echo -e "${CYAN}━━━ Checking Server Status ━━━${NC}"
if curl -s "$SERVER_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server is running at $SERVER_URL${NC}"
else
    echo -e "${YELLOW}Server not running. Starting it...${NC}"
    echo ""
    echo -e "${BLUE}Run in another terminal:${NC}"
    echo "  cd $PROJECT_DIR && npm run start"
    echo ""
    echo "Or start with tmux mode default:"
    echo "  FLEET_SPAWN_MODE=tmux npm run start"
    echo ""
    echo "Then run this script again."
    exit 1
fi
echo ""

# Authenticate and get token
echo -e "${CYAN}━━━ Authenticating ━━━${NC}"
TOKEN=$(curl -s -X POST "$SERVER_URL/auth" \
    -H "Content-Type: application/json" \
    -d '{"handle":"demo-lead","teamName":"demo","agentType":"team-lead"}' \
    | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
    echo -e "${RED}Failed to authenticate!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Authenticated as demo-lead${NC}"
echo ""

# Check current workers
echo -e "${CYAN}━━━ Current Workers ━━━${NC}"
WORKERS=$(curl -s -X GET "$SERVER_URL/orchestrate/workers" \
    -H "Authorization: Bearer $TOKEN")
echo "$WORKERS" | jq '.'
echo ""

# Spawn a worker in tmux mode
echo -e "${CYAN}━━━ Spawning Worker in Tmux ━━━${NC}"
echo ""
echo -e "${YELLOW}Spawning 'alice' with tmux mode...${NC}"

SPAWN_RESULT=$(curl -s -X POST "$SERVER_URL/orchestrate/spawn" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "handle": "alice",
        "teamName": "demo",
        "spawnMode": "tmux",
        "initialPrompt": "You are Alice, a helpful coding assistant. Introduce yourself briefly."
    }')

echo "$SPAWN_RESULT" | jq '.'
echo ""

WORKER_ID=$(echo "$SPAWN_RESULT" | jq -r '.id // empty')
SPAWN_MODE=$(echo "$SPAWN_RESULT" | jq -r '.spawnMode // empty')
PANE_ID=$(echo "$SPAWN_RESULT" | jq -r '.paneId // empty')

if [ -n "$WORKER_ID" ]; then
    echo -e "${GREEN}✓ Worker spawned!${NC}"
    echo -e "  ID: $WORKER_ID"
    echo -e "  Mode: $SPAWN_MODE"
    [ -n "$PANE_ID" ] && echo -e "  Pane: $PANE_ID"
else
    echo -e "${RED}Failed to spawn worker${NC}"
    echo "Response: $SPAWN_RESULT"
fi
echo ""

# Wait for worker to initialize
echo -e "${YELLOW}Waiting for worker to initialize...${NC}"
sleep 3

# Create a work item
echo -e "${CYAN}━━━ Creating Work Item ━━━${NC}"
WORK_ITEM=$(curl -s -X POST "$SERVER_URL/workitems" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "title": "Write a hello world function",
        "description": "Create a simple hello world function in TypeScript that takes a name parameter and returns a greeting."
    }')

echo "$WORK_ITEM" | jq '.'
WI_ID=$(echo "$WORK_ITEM" | jq -r '.id // empty')
echo ""

if [ -n "$WI_ID" ]; then
    echo -e "${GREEN}✓ Work item created: $WI_ID${NC}"
else
    echo -e "${YELLOW}Could not create work item (might already exist)${NC}"
fi
echo ""

# Assign work item to worker
if [ -n "$WI_ID" ]; then
    echo -e "${CYAN}━━━ Assigning Task to Worker ━━━${NC}"
    echo ""
    echo -e "${YELLOW}Assigning $WI_ID to alice...${NC}"

    ASSIGN_RESULT=$(curl -s -X PATCH "$SERVER_URL/workitems/$WI_ID" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"assignedTo": "alice"}')

    echo "$ASSIGN_RESULT" | jq '.'
    echo ""
    echo -e "${GREEN}✓ Task assigned to alice${NC}"
    echo ""
    echo -e "${BLUE}Check the tmux pane - alice should receive the task!${NC}"
fi
echo ""

# Show workers again
echo -e "${CYAN}━━━ Updated Workers ━━━${NC}"
curl -s -X GET "$SERVER_URL/orchestrate/workers" \
    -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Instructions
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   Demo Running!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}What's happening:${NC}"
echo "  1. Server is running at $SERVER_URL"
echo "  2. Worker 'alice' spawned in a tmux pane"
echo "  3. Work item created and assigned to alice"
echo ""
echo -e "${BLUE}Try these commands:${NC}"
echo "  # Check worker status"
echo "  curl -H 'Authorization: Bearer $TOKEN' $SERVER_URL/orchestrate/workers | jq"
echo ""
echo "  # List work items"
echo "  curl -H 'Authorization: Bearer $TOKEN' $SERVER_URL/workitems | jq"
echo ""
echo "  # Dismiss worker"
echo "  curl -X POST -H 'Authorization: Bearer $TOKEN' $SERVER_URL/orchestrate/dismiss/alice"
echo ""
echo -e "${YELLOW}Press any key to dismiss alice and cleanup...${NC}"
read -n 1 -s
echo ""

# Cleanup
echo -e "${CYAN}━━━ Cleanup ━━━${NC}"
echo -e "${YELLOW}Dismissing alice...${NC}"
curl -s -X POST "$SERVER_URL/orchestrate/dismiss/alice" \
    -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""
echo -e "${GREEN}✓ Demo complete!${NC}"
