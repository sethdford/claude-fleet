#!/bin/bash
#
# Demo Script: Tmux Wave Orchestration
#
# This script demonstrates the wave orchestration feature
# by spawning workers in phases with visual feedback.
#
# Usage:
#   ./scripts/demo-tmux-waves.sh
#
# For recording a GIF, use asciinema or ttyrec:
#   asciinema rec -c "./scripts/demo-tmux-waves.sh" demo.cast
#   agg demo.cast docs/images/tmux-waves-demo.gif
#

set -e

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Helpers
print_header() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_phase() {
    echo -e "${PURPLE}▸ Phase: ${BOLD}$1${NC}"
}

print_worker() {
    echo -e "  ${BLUE}◆${NC} Spawning: ${YELLOW}$1${NC}"
}

print_success() {
    echo -e "  ${GREEN}✓${NC} $1"
}

print_wave() {
    echo -e "${CYAN}┌──────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│${NC}  ${BOLD}Wave: $1${NC}"
    echo -e "${CYAN}│${NC}  Workers: $2"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────┘${NC}"
}

# Check if we're in tmux
if [ -z "$TMUX" ]; then
    echo "This demo should be run inside tmux for full effect."
    echo "Starting a new tmux session..."
    exec tmux new-session -s fleet-demo "$0"
fi

# Clear screen
clear

# Title
print_header "Claude Fleet - Wave Orchestration Demo"

echo -e "This demo shows how Claude Fleet orchestrates workers in waves."
echo -e "Each wave can run workers in ${BOLD}parallel${NC}, with ${BOLD}dependencies${NC} between waves."
echo ""
sleep 2

# Show the architecture
echo -e "${CYAN}Architecture:${NC}"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────┐"
echo "  │                    WaveOrchestrator                         │"
echo "  │         (Phases, Dependencies, Parallel Execution)          │"
echo "  └─────────────────────────┬───────────────────────────────────┘"
echo "                            │"
echo "            ┌───────────────┴───────────────┐"
echo "            │                               │"
echo "            ▼                               ▼"
echo "  ┌─────────────────────┐       ┌─────────────────────┐"
echo "  │  FleetTmuxManager   │       │ RemoteFleetManager  │"
echo "  │   (Inside Tmux)     │       │   (Headless/API)    │"
echo "  └─────────────────────┘       └─────────────────────┘"
echo ""
sleep 3

# Clear for demo
clear
print_header "Wave Orchestration - CI/CD Pipeline Example"

echo -e "Creating a 3-phase CI/CD pipeline with dependencies:"
echo ""
echo "  Wave 1 (Quality)  →  Wave 2 (Tests)  →  Wave 3 (Deploy)"
echo "  [linter, types]       [tester]          [builder, docs]"
echo ""
sleep 2

# Phase 1
print_phase "1: Quality Checks"
print_wave "quality" "linter, typechecker (parallel)"

# Create horizontal split for worker column
tmux split-window -h -p 40
WORKER_PANE=$(tmux list-panes -F '#{pane_id}' | tail -1)

# Simulate linter
tmux send-keys -t "$WORKER_PANE" "echo '🔍 Linter: Checking code style...'" Enter
sleep 0.5
print_worker "linter"
sleep 1

# Create vertical split for second worker
tmux split-window -v -t "$WORKER_PANE"
WORKER_PANE2=$(tmux list-panes -F '#{pane_id}' | tail -1)

# Simulate type checker
tmux send-keys -t "$WORKER_PANE2" "echo '📝 TypeChecker: Verifying types...'" Enter
sleep 0.5
print_worker "typechecker"
sleep 2

# Show completion
tmux send-keys -t "$WORKER_PANE" "echo '✅ Linting complete - 0 issues'" Enter
tmux send-keys -t "$WORKER_PANE2" "echo '✅ Type check complete - 0 errors'" Enter
print_success "Wave 1 complete - all workers succeeded"
sleep 2

# Phase 2
echo ""
print_phase "2: Testing"
print_wave "tests" "tester (depends on quality)"

# Create new pane for tester
tmux split-window -v -t "$WORKER_PANE2"
WORKER_PANE3=$(tmux list-panes -F '#{pane_id}' | tail -1)

tmux send-keys -t "$WORKER_PANE3" "echo '🧪 Tester: Running test suite...'" Enter
print_worker "tester"
sleep 2

tmux send-keys -t "$WORKER_PANE3" "echo '   ✓ auth.test.ts (12 tests)'" Enter
sleep 0.5
tmux send-keys -t "$WORKER_PANE3" "echo '   ✓ api.test.ts (24 tests)'" Enter
sleep 0.5
tmux send-keys -t "$WORKER_PANE3" "echo '   ✓ worker.test.ts (18 tests)'" Enter
sleep 0.5
tmux send-keys -t "$WORKER_PANE3" "echo '✅ All 54 tests passed'" Enter
print_success "Wave 2 complete - tests passed"
sleep 2

# Phase 3
echo ""
print_phase "3: Deployment"
print_wave "deploy" "builder, docs (parallel, depends on tests)"

# Update existing panes for deploy phase
tmux send-keys -t "$WORKER_PANE" "clear && echo '🏗️  Builder: Creating production build...'" Enter
tmux send-keys -t "$WORKER_PANE2" "clear && echo '📚 Docs: Generating documentation...'" Enter
print_worker "builder"
print_worker "docs"
sleep 2

tmux send-keys -t "$WORKER_PANE" "echo '✅ Build complete - 2.4MB bundle'" Enter
tmux send-keys -t "$WORKER_PANE2" "echo '✅ Docs generated - 47 pages'" Enter
print_success "Wave 3 complete - deployment ready"
sleep 2

# Final summary
echo ""
print_header "Pipeline Complete!"

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Results:${NC}"
echo -e "    • Waves executed: ${GREEN}3${NC}"
echo -e "    • Workers spawned: ${GREEN}5${NC}"
echo -e "    • Total duration: ${GREEN}~8s${NC}"
echo -e "    • Status: ${GREEN}SUCCESS${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "Learn more: ${CYAN}docs/TMUX-AUTOMATION.md${NC}"
echo ""

sleep 5

# Cleanup
echo "Cleaning up demo panes..."
tmux kill-pane -t "$WORKER_PANE3" 2>/dev/null || true
tmux kill-pane -t "$WORKER_PANE2" 2>/dev/null || true
tmux kill-pane -t "$WORKER_PANE" 2>/dev/null || true

echo "Demo complete!"
