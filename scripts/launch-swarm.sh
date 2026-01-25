#!/bin/bash
#
# Launch Claude Code Swarm
#
# Spawns interactive Claude Code sessions that coordinate on tasks.
#
# Usage:
#   tmux new-session -s swarm
#   ./scripts/launch-swarm.sh
#

set -e

cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           CLAUDE CODE SWARM LAUNCHER                      ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

if [ -z "$TMUX" ]; then
    echo -e "${YELLOW}Starting tmux session 'swarm'...${NC}"
    exec tmux new-session -s swarm "$0"
fi

echo -e "${GREEN}✓${NC} Inside tmux"
echo -e "${GREEN}✓${NC} Project: $PROJECT_DIR"
echo ""

# Create shared task file for coordination
cat > "$PROJECT_DIR/.swarm-state.md" << 'STATE'
# Swarm State

## Active Agents
- [ ] coordinator - pending
- [ ] scout - pending
- [ ] worker-1 - pending

## Task Queue

### Task 1: Add uptime to health endpoint (Priority: HIGH)
- **File**: apps/cli/src/server/http.ts
- **Change**: Add 'uptime' field to /health response showing seconds since server start
- **Status**: PENDING
- **Assignee**: None

### Task 2: Create version command (Priority: MEDIUM)
- **File**: apps/cli/src/commands/ (new file)
- **Change**: Add 'version' command that shows package version
- **Status**: PENDING
- **Assignee**: None

### Task 3: Add JSDoc to tmux controller (Priority: LOW)
- **File**: packages/tmux/src/controller.ts
- **Change**: Add JSDoc comments to undocumented public methods
- **Status**: PENDING
- **Assignee**: None

## Messages
(Agents write messages here to coordinate)

STATE

echo -e "${MAGENTA}━━━ Creating Swarm Layout ━━━${NC}"
echo ""

# Create the layout: 3 panes
# Main pane (0) - coordinator
# Right pane (1) - scout
# Bottom pane (2) - worker-1

# Split horizontally for scout
tmux split-window -h -c "$PROJECT_DIR"
# Split the right pane vertically for worker-1
tmux split-window -v -c "$PROJECT_DIR"
# Go back to first pane
tmux select-pane -t 0

# Name the panes
tmux select-pane -t 0 -T "coordinator"
tmux select-pane -t 1 -T "scout"
tmux select-pane -t 2 -T "worker-1"

echo -e "${GREEN}✓${NC} Created 3-pane layout"
echo ""

echo -e "${MAGENTA}━━━ Launching Claude Code Agents ━━━${NC}"
echo ""

# Launch coordinator in pane 0
echo -e "${YELLOW}[1/3]${NC} Launching coordinator..."
tmux send-keys -t 0 "cd $PROJECT_DIR && claude" Enter
sleep 1

# Launch scout in pane 1
echo -e "${YELLOW}[2/3]${NC} Launching scout..."
tmux send-keys -t 1 "cd $PROJECT_DIR && claude" Enter
sleep 1

# Launch worker in pane 2
echo -e "${YELLOW}[3/3]${NC} Launching worker-1..."
tmux send-keys -t 2 "cd $PROJECT_DIR && claude" Enter
sleep 1

echo ""
echo -e "${GREEN}✓ All Claude agents launched!${NC}"
echo ""

# Wait for Claude instances to initialize
echo -e "${YELLOW}Waiting for Claude instances to initialize...${NC}"
sleep 5

# Send role assignments to each agent
echo ""
echo -e "${MAGENTA}━━━ Assigning Roles ━━━${NC}"
echo ""

# Coordinator prompt
COORD_MSG="You are the COORDINATOR agent in a swarm of 3 Claude Code instances working together.

SETUP:
1. Read the shared state file: cat .swarm-state.md
2. You coordinate with 'scout' (pane 1) and 'worker-1' (pane 2)
3. Update .swarm-state.md to track progress and communicate

YOUR RESPONSIBILITIES:
- Assign tasks to scout and worker-1
- Track task completion
- Help resolve blockers
- Ensure quality of work

START BY:
1. Reading .swarm-state.md to see the task queue
2. Updating your status to 'online' in the file
3. Waiting for scout and worker-1 to come online
4. Then assign Task 1 to worker-1 and Task 3 to scout

Communicate by editing the Messages section of .swarm-state.md"

echo -e "${CYAN}Sending coordinator instructions...${NC}"
tmux send-keys -t 0 "$COORD_MSG" Enter
sleep 1

# Scout prompt
SCOUT_MSG="You are the SCOUT agent in a swarm of 3 Claude Code instances.

SETUP:
1. Read the shared state: cat .swarm-state.md
2. You report to 'coordinator' (pane 0) and help 'worker-1' (pane 2)

YOUR RESPONSIBILITIES:
- Explore the codebase to find relevant files
- Document code patterns for other agents
- Complete documentation tasks assigned to you

START BY:
1. Reading .swarm-state.md
2. Marking yourself as 'online' in the Active Agents section
3. Exploring the project: ls -la, then ls packages/
4. Waiting for coordinator to assign you a task

Write updates to the Messages section of .swarm-state.md"

echo -e "${CYAN}Sending scout instructions...${NC}"
tmux send-keys -t 1 "$SCOUT_MSG" Enter
sleep 1

# Worker prompt
WORKER_MSG="You are WORKER-1 agent in a swarm of 3 Claude Code instances.

SETUP:
1. Read the shared state: cat .swarm-state.md
2. You report to 'coordinator' (pane 0), scout helps find files

YOUR RESPONSIBILITIES:
- Implement code changes assigned by coordinator
- Write clean, tested code
- Report completion status

START BY:
1. Reading .swarm-state.md
2. Marking yourself as 'online' in the Active Agents section
3. Checking if any tasks are assigned to you
4. If assigned a task, implement it

Write progress updates to the Messages section of .swarm-state.md"

echo -e "${CYAN}Sending worker-1 instructions...${NC}"
tmux send-keys -t 2 "$WORKER_MSG" Enter

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  SWARM LAUNCHED! All 3 Claude agents are now running.${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Navigate between agents:"
echo -e "  ${CYAN}Ctrl+B${NC} then ${CYAN}←/→/↑/↓${NC} - Switch panes"
echo -e "  ${CYAN}Ctrl+B${NC} then ${CYAN}z${NC} - Zoom current pane (toggle)"
echo -e "  ${CYAN}Ctrl+B${NC} then ${CYAN}q${NC} - Show pane numbers"
echo ""
echo -e "Shared state file: ${CYAN}.swarm-state.md${NC}"
echo -e "Watch it update: ${CYAN}watch cat .swarm-state.md${NC}"
echo ""
echo -e "${YELLOW}The agents will now coordinate through the shared state file!${NC}"
echo ""

# Switch to pane view
tmux select-layout tiled
