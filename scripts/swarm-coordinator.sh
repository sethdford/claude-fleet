#!/bin/bash
#
# Claude Fleet Swarm Coordinator
#
# Spawns Claude Code agents that:
# - Register with the swarm
# - Pick up tasks from a shared queue
# - Coordinate via messaging
# - Work together on the codebase
#
# Prerequisites:
#   - tmux new-session -s swarm
#   - pnpm build
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)
CLI="node $PROJECT_DIR/apps/cli/dist/index.js"

# Banner
clear
echo -e "${CYAN}"
cat << 'EOF'
   _____ _                 _        ____
  / ____| |               | |      / ___|_      ____ _ _ __ _ __ ___
 | |    | | __ _ _   _  __| | ___ | (___ \ \ /\ / / _` | '__| '_ ` _ \
 | |    | |/ _` | | | |/ _` |/ _ \ \___ \\ V  V / (_| | |  | | | | | |
 | |____| | (_| | |_| | (_| |  __/ ____) |\_/\_/ \__,_|_|  |_| |_| |_|
  \_____|_|\__,_|\__,_|\__,_|\___||_____/

EOF
echo -e "${NC}"
echo -e "${DIM}  Multi-Agent Orchestration with Claude Code${NC}"
echo ""

# Check tmux
if [ -z "$TMUX" ]; then
    echo -e "${RED}ERROR: Run inside tmux first!${NC}"
    echo -e "  ${CYAN}tmux new-session -s swarm${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Tmux session active"
echo -e "${GREEN}✓${NC} Project: ${CYAN}${PROJECT_DIR}${NC}"
echo ""

# Cleanup existing workers
echo -e "${YELLOW}Cleaning up any existing workers...${NC}"
$CLI tmux kill-all --yes 2>/dev/null || true
sleep 1

# Create the task queue with real tasks
echo ""
echo -e "${MAGENTA}━━━ Seeding Task Queue ━━━${NC}"
echo ""

# We'll create tasks by writing to a tasks file that agents can read
TASKS_FILE="$PROJECT_DIR/.swarm-tasks.json"
cat > "$TASKS_FILE" << 'TASKS'
{
  "tasks": [
    {
      "id": "task-001",
      "title": "Add timestamp to health endpoint",
      "description": "Modify the /health endpoint in apps/cli/src/server/http.ts to include an 'uptime' field showing server uptime in seconds",
      "priority": 1,
      "status": "pending",
      "assignee": null
    },
    {
      "id": "task-002",
      "title": "Create a CLI version command",
      "description": "Add a 'version' command to the CLI that reads and displays the version from package.json",
      "priority": 2,
      "status": "pending",
      "assignee": null
    },
    {
      "id": "task-003",
      "title": "Document the tmux commands",
      "description": "Review packages/tmux/src/controller.ts and add JSDoc comments to any undocumented public methods",
      "priority": 3,
      "status": "pending",
      "assignee": null
    }
  ],
  "agents": [],
  "messages": []
}
TASKS

echo -e "${GREEN}✓${NC} Created task queue with 3 tasks"
cat "$TASKS_FILE" | grep '"title"' | sed 's/.*"title": "\(.*\)".*/  - \1/'
echo ""

# Agent system prompts
COORDINATOR_PROMPT="You are the COORDINATOR agent in a Claude Code swarm. Your role:

1. FIRST: Announce yourself by running: echo '[COORDINATOR] Online and ready to coordinate'

2. Read the task queue: cat .swarm-tasks.json

3. Your job is to:
   - Monitor the other agents (scout, worker-1)
   - Assign tasks by updating .swarm-tasks.json
   - Keep track of progress
   - Help resolve blockers

4. Communicate by echoing messages like: echo '[COORDINATOR] Message here'

5. When you see agents come online, assign them tasks from the queue.

Start by reading the task queue and waiting for agents to register."

SCOUT_PROMPT="You are the SCOUT agent in a Claude Code swarm. Your role:

1. FIRST: Register by running: echo '[SCOUT] Online - ready to explore codebase'

2. Read your assigned tasks: cat .swarm-tasks.json | grep -A5 scout

3. Your specialty is:
   - Exploring the codebase structure
   - Finding relevant files for tasks
   - Reporting back to the coordinator

4. Communicate via: echo '[SCOUT] Message here'

5. After registering, explore the project structure with 'ls' and 'find' commands.
   Report what you find to help other agents.

Start by registering and exploring the codebase."

WORKER_PROMPT="You are WORKER-1 agent in a Claude Code swarm. Your role:

1. FIRST: Register by running: echo '[WORKER-1] Online - ready for implementation tasks'

2. Check for assigned tasks: cat .swarm-tasks.json

3. Your specialty is:
   - Implementing code changes
   - Writing new features
   - Fixing bugs

4. Communicate via: echo '[WORKER-1] Message here'

5. After registering, wait for the coordinator to assign you a task.
   When assigned, implement the change and report completion.

Start by registering and checking the task queue."

# Spawn the swarm
echo -e "${MAGENTA}━━━ Spawning Claude Code Swarm ━━━${NC}"
echo ""

echo -e "${BLUE}[1/3]${NC} Spawning ${CYAN}coordinator${NC} (team lead)..."
$CLI tmux spawn-claude coordinator --prompt "$COORDINATOR_PROMPT" --cwd "$PROJECT_DIR"
echo -e "       ${GREEN}✓${NC} Coordinator spawned"
sleep 2

echo -e "${BLUE}[2/3]${NC} Spawning ${CYAN}scout${NC} (codebase explorer)..."
$CLI tmux spawn-claude scout --prompt "$SCOUT_PROMPT" --cwd "$PROJECT_DIR"
echo -e "       ${GREEN}✓${NC} Scout spawned"
sleep 2

echo -e "${BLUE}[3/3]${NC} Spawning ${CYAN}worker-1${NC} (implementer)..."
$CLI tmux spawn-claude worker-1 --prompt "$WORKER_PROMPT" --cwd "$PROJECT_DIR"
echo -e "       ${GREEN}✓${NC} Worker-1 spawned"
sleep 2

echo ""
echo -e "${GREEN}✓ Swarm launched with 3 Claude Code agents!${NC}"
echo ""

# Show status
echo -e "${MAGENTA}━━━ Swarm Status ━━━${NC}"
echo ""
$CLI tmux workers
echo ""

# Instructions
echo -e "${MAGENTA}━━━ Swarm Control ━━━${NC}"
echo ""
echo -e "${BOLD}The agents are now running Claude Code and coordinating!${NC}"
echo ""
echo -e "Watch them work by switching panes:"
echo -e "  ${CYAN}Ctrl+B${NC} then ${CYAN}arrow keys${NC} - Navigate between panes"
echo -e "  ${CYAN}Ctrl+B${NC} then ${CYAN}z${NC} - Zoom into current pane (toggle)"
echo ""
echo -e "CLI commands to interact:"
echo -e "  ${CYAN}$CLI tmux capture coordinator${NC} - See coordinator output"
echo -e "  ${CYAN}$CLI tmux capture scout${NC} - See scout output"
echo -e "  ${CYAN}$CLI tmux capture worker-1${NC} - See worker output"
echo -e "  ${CYAN}$CLI tmux send coordinator 'your message'${NC} - Send to coordinator"
echo ""
echo -e "Task queue file: ${CYAN}.swarm-tasks.json${NC}"
echo ""

# Monitor loop
echo -e "${MAGENTA}━━━ Live Monitor (Ctrl+C to exit) ━━━${NC}"
echo ""

monitor() {
    while true; do
        clear
        echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${CYAN}║${NC}  ${BOLD}CLAUDE SWARM MONITOR${NC}  $(date '+%H:%M:%S')                              ${CYAN}║${NC}"
        echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════╝${NC}"
        echo ""

        echo -e "${YELLOW}─── COORDINATOR (last 8 lines) ───${NC}"
        $CLI tmux capture coordinator --lines 8 2>/dev/null || echo "  [waiting for output]"
        echo ""

        echo -e "${YELLOW}─── SCOUT (last 8 lines) ───${NC}"
        $CLI tmux capture scout --lines 8 2>/dev/null || echo "  [waiting for output]"
        echo ""

        echo -e "${YELLOW}─── WORKER-1 (last 8 lines) ───${NC}"
        $CLI tmux capture worker-1 --lines 8 2>/dev/null || echo "  [waiting for output]"
        echo ""

        echo -e "${DIM}Refreshing in 5s... (Ctrl+C to stop monitor, agents keep running)${NC}"
        sleep 5
    done
}

echo -e "Start live monitor? ${CYAN}[y/N]${NC} "
read -n 1 start_monitor
echo ""

if [[ $start_monitor =~ ^[Yy]$ ]]; then
    monitor
else
    echo ""
    echo -e "${GREEN}Agents are running in the background.${NC}"
    echo -e "Use ${CYAN}Ctrl+B${NC} then arrow keys to switch between agent panes."
    echo ""
fi
