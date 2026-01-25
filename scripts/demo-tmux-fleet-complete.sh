#!/bin/bash
#
# Complete Tmux Fleet Demo
#
# This script demonstrates the full Claude Fleet workflow:
#   1. Start the server
#   2. Spawn workers in tmux panes
#   3. Execute wave orchestration
#   4. Show multi-repo operations
#
# Usage:
#   ./scripts/demo-tmux-fleet-complete.sh
#
# For recording a GIF:
#   asciinema rec -c "./scripts/demo-tmux-fleet-complete.sh" demo.cast
#   agg demo.cast docs/images/fleet-demo.gif
#

set -e

# ============================================================================
# CONFIGURATION
# ============================================================================

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

SERVER_PORT=${FLEET_PORT:-3847}
BASE_URL="http://localhost:$SERVER_PORT"

# ============================================================================
# HELPERS
# ============================================================================

print_banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}                                                                      ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}   ${BOLD}${PURPLE}$1${NC}                                                     ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}   ${DIM}$2${NC}                                          ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                                      ${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "\n${BLUE}━━━ Step $1: ${BOLD}$2${NC}${BLUE} ━━━${NC}\n"
}

print_cmd() {
    echo -e "${DIM}\$ $1${NC}"
}

print_success() {
    echo -e "${GREEN}  ✓${NC} $1"
}

print_info() {
    echo -e "${YELLOW}  ◆${NC} $1"
}

print_error() {
    echo -e "${RED}  ✗${NC} $1"
}

wait_for_server() {
    local max_attempts=30
    local attempt=1

    echo -n "  Waiting for server"
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$BASE_URL/health" > /dev/null 2>&1; then
            echo ""
            print_success "Server is ready"
            return 0
        fi
        echo -n "."
        sleep 1
        ((attempt++))
    done
    echo ""
    print_error "Server failed to start"
    return 1
}

# ============================================================================
# MAIN DEMO
# ============================================================================

clear

print_banner "Claude Fleet - Complete Demo" "Multi-Agent Orchestration with Tmux"

# Check if we're in tmux
if [ -z "$TMUX" ]; then
    echo -e "${YELLOW}Note:${NC} This demo works best inside tmux for full visual effect."
    echo "Starting a new tmux session..."
    exec tmux new-session -s fleet-demo "$0"
fi

# Step 1: Show Architecture
print_step "1" "Architecture Overview"

cat << 'EOF'
  ┌────────────────────────────────────────────────────────────────────┐
  │                     Claude Fleet Architecture                       │
  ├────────────────────────────────────────────────────────────────────┤
  │                                                                    │
  │    ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     │
  │    │   HTTP API   │────▶│WorkerManager │────▶│TmuxWorkerAdp │     │
  │    │  /orchestrate│     │              │     │              │     │
  │    └──────────────┘     └──────────────┘     └──────┬───────┘     │
  │                                                      │             │
  │    ┌────────────────────────────────────────────────┼─────────┐   │
  │    │                   Tmux Session                  ▼         │   │
  │    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │   │
  │    │  │   Worker 1  │  │   Worker 2  │  │   Worker 3  │       │   │
  │    │  │ Claude Code │  │ Claude Code │  │ Claude Code │       │   │
  │    │  └─────────────┘  └─────────────┘  └─────────────┘       │   │
  │    └──────────────────────────────────────────────────────────┘   │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘
EOF

echo ""
read -p "Press Enter to continue..."

# Step 2: Start Server
print_step "2" "Starting Fleet Server"

print_cmd "npm run start &"
npm run start > /tmp/fleet-demo.log 2>&1 &
SERVER_PID=$!
echo ""

wait_for_server

# Get auth token
print_info "Getting authentication token..."
TOKEN=$(curl -s -X POST "$BASE_URL/auth" \
    -H "Content-Type: application/json" \
    -d '{"handle":"demo-lead","teamName":"demo-team","agentType":"team-lead"}' | jq -r '.token')
print_success "Authenticated as demo-lead"

sleep 1

# Step 3: Spawn Workers
print_step "3" "Spawning Workers in Tmux Panes"

echo "Spawning 3 workers with tmux mode..."
echo ""

# Spawn worker 1
print_cmd "curl -X POST /orchestrate/spawn -d '{\"handle\":\"alice\",\"spawnMode\":\"tmux\"}'"
RESULT=$(curl -s -X POST "$BASE_URL/orchestrate/spawn" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"handle":"alice","role":"worker","spawnMode":"tmux","initialPrompt":"You are Alice, a code reviewer."}')
print_success "Spawned alice $(echo $RESULT | jq -r '.paneId // "in pane"')"
sleep 1

# Spawn worker 2
print_cmd "curl -X POST /orchestrate/spawn -d '{\"handle\":\"bob\",\"spawnMode\":\"tmux\"}'"
RESULT=$(curl -s -X POST "$BASE_URL/orchestrate/spawn" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"handle":"bob","role":"worker","spawnMode":"tmux","initialPrompt":"You are Bob, a test writer."}')
print_success "Spawned bob $(echo $RESULT | jq -r '.paneId // "in pane"')"
sleep 1

# Spawn worker 3
print_cmd "curl -X POST /orchestrate/spawn -d '{\"handle\":\"charlie\",\"spawnMode\":\"tmux\"}'"
RESULT=$(curl -s -X POST "$BASE_URL/orchestrate/spawn" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"handle":"charlie","role":"worker","spawnMode":"tmux","initialPrompt":"You are Charlie, a documentation writer."}')
print_success "Spawned charlie $(echo $RESULT | jq -r '.paneId // "in pane"')"

sleep 2

# Step 4: Show Workers
print_step "4" "Viewing Active Workers"

print_cmd "curl /orchestrate/workers"
WORKERS=$(curl -s "$BASE_URL/orchestrate/workers" \
    -H "Authorization: Bearer $TOKEN")
echo "$WORKERS" | jq -r '.[] | "  \(.handle): \(.state) (spawned: \(.spawnedAt | . / 1000 | strftime("%H:%M:%S")))"'

sleep 2

# Step 5: Wave Orchestration
print_step "5" "Wave Orchestration Demo"

echo "Executing a 3-phase CI/CD pipeline..."
echo ""

cat << 'EOF'
  Wave 1 (Quality)    Wave 2 (Tests)     Wave 3 (Deploy)
  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
  │   linter      │   │               │   │   builder     │
  │   typechecker │──▶│    tester     │──▶│   docs        │
  │               │   │               │   │               │
  └───────────────┘   └───────────────┘   └───────────────┘
        parallel          sequential           parallel
EOF

echo ""

print_cmd "curl -X POST /orchestrate/waves -d '{...}'"
WAVE_RESULT=$(curl -s -X POST "$BASE_URL/orchestrate/waves" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "fleetName": "demo-pipeline",
        "waves": [
            {
                "name": "quality",
                "workers": [
                    {"handle": "linter", "command": "echo Running linter... && sleep 1 && echo Done", "successPattern": "Done"},
                    {"handle": "typechecker", "command": "echo Checking types... && sleep 1 && echo Done", "successPattern": "Done"}
                ]
            },
            {
                "name": "tests",
                "workers": [
                    {"handle": "tester", "command": "echo Running tests... && sleep 2 && echo All tests passed", "successPattern": "passed"}
                ],
                "afterWaves": ["quality"]
            },
            {
                "name": "deploy",
                "workers": [
                    {"handle": "builder", "command": "echo Building... && sleep 1 && echo Build complete", "successPattern": "complete"},
                    {"handle": "docs", "command": "echo Generating docs... && sleep 1 && echo Docs ready", "successPattern": "ready"}
                ],
                "afterWaves": ["tests"]
            }
        ],
        "remote": true
    }')

EXECUTION_ID=$(echo $WAVE_RESULT | jq -r '.executionId')
print_success "Wave execution started: $EXECUTION_ID"

sleep 1

# Poll for completion
echo ""
echo "Monitoring wave execution..."
for i in {1..10}; do
    STATUS=$(curl -s "$BASE_URL/orchestrate/waves/$EXECUTION_ID" \
        -H "Authorization: Bearer $TOKEN" | jq -r '.status')

    if [ "$STATUS" = "completed" ]; then
        print_success "Wave execution completed!"
        break
    elif [ "$STATUS" = "failed" ]; then
        print_error "Wave execution failed"
        break
    else
        echo -n "."
        sleep 1
    fi
done
echo ""

sleep 2

# Step 6: Multi-Repo Operations
print_step "6" "Multi-Repo Orchestration"

echo "Available multi-repo tasks:"
echo ""
echo "  POST /orchestrate/multi-repo/update-deps     - Update dependencies"
echo "  POST /orchestrate/multi-repo/security-audit  - Run security audit"
echo "  POST /orchestrate/multi-repo/format-code     - Format code"
echo "  POST /orchestrate/multi-repo/run-tests       - Run tests"
echo ""

print_info "These endpoints can orchestrate Claude workers across multiple repositories"
print_info "Each worker operates in a separate tmux pane for visibility"

sleep 2

# Step 7: Cleanup
print_step "7" "Cleanup"

echo "Dismissing workers..."

for handle in alice bob charlie; do
    print_cmd "curl -X POST /orchestrate/dismiss/$handle"
    curl -s -X POST "$BASE_URL/orchestrate/dismiss/$handle" \
        -H "Authorization: Bearer $TOKEN" > /dev/null
    print_success "Dismissed $handle"
    sleep 0.5
done

# Stop server
echo ""
print_info "Stopping server..."
kill $SERVER_PID 2>/dev/null || true
print_success "Server stopped"

# Final summary
echo ""
print_banner "Demo Complete!" "Claude Fleet Multi-Agent Orchestration"

cat << 'EOF'

  What we demonstrated:

  ✓ Starting the Fleet server
  ✓ Spawning workers in visible tmux panes
  ✓ Wave orchestration with dependencies
  ✓ Multi-repo operation endpoints
  ✓ Graceful worker dismissal

  Key Features:

  • Visible Workers    - See Claude working in real-time
  • Wave Phases        - Execute workers in dependency order
  • Multi-Repo         - Coordinate work across repositories
  • Auto Context       - Automatic session rollover when needed

  Learn More:

  📚 docs/TMUX-AUTOMATION.md     - Full documentation
  🎬 scripts/demo-wave-*.sh      - Wave orchestration demos
  📖 README.md                   - Getting started guide

EOF

echo -e "${CYAN}Thanks for watching!${NC}"
echo ""
