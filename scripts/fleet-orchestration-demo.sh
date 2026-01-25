#!/bin/bash
#
# Claude Fleet Orchestration Demo
#
# Spawns a team of Claude Code agents and orchestrates them to work on tasks.
#
# Prerequisites:
#   - Run inside a tmux session: tmux new-session -s fleet
#   - Build the project first: pnpm build
#
# Usage:
#   ./scripts/fleet-orchestration-demo.sh
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
NC='\033[0m'

# Project directory
cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

# CLI command
CLI="node $PROJECT_DIR/apps/cli/dist/index.js"

# Banner
clear
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║     ${BOLD}CLAUDE FLEET${NC}${CYAN} - Multi-Agent Orchestration System            ║"
echo "║                                                                  ║"
echo "║     Spawning intelligent agents to collaborate on tasks         ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Check if inside tmux
if [ -z "$TMUX" ]; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ERROR: Not running inside tmux!                                 ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${YELLOW}Start a tmux session first:${NC}"
    echo ""
    echo -e "    ${CYAN}tmux new-session -s fleet${NC}"
    echo ""
    echo -e "  ${YELLOW}Then run this script again.${NC}"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} Running inside tmux session"
echo -e "${GREEN}✓${NC} Project directory: ${CYAN}${PROJECT_DIR}${NC}"
echo ""

# Function to print section header
section() {
    echo ""
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${MAGENTA}  $1${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Function to wait with countdown
wait_with_message() {
    local seconds=$1
    local message=$2
    echo -ne "${YELLOW}  $message${NC}"
    for ((i=seconds; i>0; i--)); do
        echo -ne " ${CYAN}$i${NC}"
        sleep 1
    done
    echo -e " ${GREEN}Done${NC}"
}

# Kill any existing workers first
section "Cleanup - Killing any existing workers"
$CLI tmux kill-all --yes 2>/dev/null || echo -e "${YELLOW}  No existing workers to kill${NC}"

# Show initial status
section "Initial Status"
$CLI tmux status
echo ""

# Spawn the fleet
section "Spawning the Claude Fleet"

echo -e "${BLUE}  [1/3]${NC} Spawning ${CYAN}team-lead${NC} (coordinator)..."
$CLI tmux spawn team-lead --role coordinator --direction horizontal
sleep 1

echo -e "${BLUE}  [2/3]${NC} Spawning ${CYAN}scout${NC} (codebase explorer)..."
$CLI tmux spawn scout --role scout --direction vertical
sleep 1

echo -e "${BLUE}  [3/3]${NC} Spawning ${CYAN}worker-1${NC} (developer)..."
$CLI tmux spawn worker-1 --role worker --direction vertical
sleep 1

echo ""
echo -e "${GREEN}✓ Fleet spawned successfully!${NC}"

# Show the fleet
section "Fleet Status"
$CLI tmux workers
echo ""
$CLI tmux panes

# Send initial commands to set up shells
section "Initializing Workers"

echo -e "${YELLOW}  Setting up worker shells...${NC}"

# Give each worker a simple identifying command
$CLI tmux send team-lead "export PS1='[team-lead] \$ ' && clear && echo 'Team Lead ready for coordination'"
sleep 0.5

$CLI tmux send scout "export PS1='[scout] \$ ' && clear && echo 'Scout ready to explore'"
sleep 0.5

$CLI tmux send worker-1 "export PS1='[worker-1] \$ ' && clear && echo 'Worker-1 ready for tasks'"
sleep 0.5

wait_with_message 2 "Waiting for shells to initialize..."

# Demonstrate sending commands
section "Demonstrating Fleet Commands"

echo -e "${YELLOW}  Sending exploration task to scout...${NC}"
$CLI tmux send scout "ls -la && echo '---' && wc -l package.json"
sleep 1

echo -e "${YELLOW}  Sending status check to team-lead...${NC}"
$CLI tmux send team-lead "echo 'Coordinating fleet of 3 agents' && date"
sleep 1

echo -e "${YELLOW}  Sending build task to worker-1...${NC}"
$CLI tmux send worker-1 "echo 'Checking project structure...' && ls packages/"
sleep 1

wait_with_message 3 "Waiting for commands to complete..."

# Capture and show output
section "Capturing Worker Output"

echo -e "${CYAN}─── Output from team-lead ───${NC}"
$CLI tmux capture team-lead --lines 8
echo ""

echo -e "${CYAN}─── Output from scout ───${NC}"
$CLI tmux capture scout --lines 8
echo ""

echo -e "${CYAN}─── Output from worker-1 ───${NC}"
$CLI tmux capture worker-1 --lines 8
echo ""

# Broadcast demonstration
section "Broadcasting to All Workers"

echo -e "${YELLOW}  Broadcasting status request...${NC}"
$CLI tmux broadcast "echo '[BROADCAST] Status check at \$(date +%H:%M:%S)'"
sleep 2

# Final status
section "Final Fleet Status"
$CLI tmux status

# Interactive menu
section "Fleet Control Panel"

echo -e "  ${BOLD}Available Actions:${NC}"
echo ""
echo -e "  ${CYAN}[1]${NC} Spawn Claude Code worker (launches actual Claude)"
echo -e "  ${CYAN}[2]${NC} Send custom command to a worker"
echo -e "  ${CYAN}[3]${NC} Capture output from all workers"
echo -e "  ${CYAN}[4]${NC} Broadcast message to all workers"
echo -e "  ${CYAN}[5]${NC} Focus on a specific worker pane"
echo -e "  ${CYAN}[6]${NC} Kill all workers and exit"
echo -e "  ${CYAN}[q]${NC} Exit (keep workers running)"
echo ""

while true; do
    echo -ne "${YELLOW}Select action [1-6, q]: ${NC}"
    read -n 1 action
    echo ""

    case $action in
        1)
            echo -ne "${YELLOW}Enter worker handle: ${NC}"
            read handle
            echo -ne "${YELLOW}Enter initial prompt (or press Enter for none): ${NC}"
            read prompt
            if [ -n "$prompt" ]; then
                $CLI tmux spawn-claude "$handle" --prompt "$prompt"
            else
                $CLI tmux spawn-claude "$handle"
            fi
            echo -e "${GREEN}✓ Claude worker '$handle' spawned${NC}"
            ;;
        2)
            echo -ne "${YELLOW}Enter worker handle: ${NC}"
            read handle
            echo -ne "${YELLOW}Enter command: ${NC}"
            read cmd
            $CLI tmux send "$handle" "$cmd"
            echo -e "${GREEN}✓ Command sent to '$handle'${NC}"
            ;;
        3)
            echo ""
            for w in team-lead scout worker-1; do
                if $CLI tmux capture "$w" --lines 1 &>/dev/null; then
                    echo -e "${CYAN}─── $w ───${NC}"
                    $CLI tmux capture "$w" --lines 10
                    echo ""
                fi
            done
            ;;
        4)
            echo -ne "${YELLOW}Enter message: ${NC}"
            read msg
            $CLI tmux broadcast "$msg"
            echo -e "${GREEN}✓ Message broadcast to all workers${NC}"
            ;;
        5)
            echo -ne "${YELLOW}Enter worker handle to focus: ${NC}"
            read handle
            $CLI tmux focus "$handle"
            echo -e "${GREEN}✓ Focused on '$handle' - switch back with Ctrl+B, then 0${NC}"
            ;;
        6)
            echo -e "${YELLOW}Killing all workers...${NC}"
            $CLI tmux kill-all --yes
            echo -e "${GREEN}✓ All workers killed${NC}"
            exit 0
            ;;
        q|Q)
            echo ""
            echo -e "${BLUE}Workers left running. Commands to manage them:${NC}"
            echo ""
            echo -e "  ${CYAN}node apps/cli/dist/index.js tmux workers${NC}     # List workers"
            echo -e "  ${CYAN}node apps/cli/dist/index.js tmux send <h> <cmd>${NC}  # Send command"
            echo -e "  ${CYAN}node apps/cli/dist/index.js tmux kill-all --yes${NC}  # Kill all"
            echo ""
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            ;;
    esac
    echo ""
done
