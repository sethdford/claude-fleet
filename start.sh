#!/bin/bash
# Claude Fleet Server - Startup Script
#
# Usage:
#   ./start.sh              # Start server in foreground
#   ./start.sh --background # Start server in background
#   ./start.sh --stop       # Stop background server
#   ./start.sh --status     # Check server status

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3847}"
PID_FILE="$HOME/.claude-toolkit/fleet-server.pid"
LOG_FILE="$HOME/.claude-toolkit/fleet-server.log"

mkdir -p "$HOME/.claude-toolkit"

check_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            return 0
        fi
        rm -f "$PID_FILE"
    fi
    return 1
}

start_foreground() {
    echo "Starting Claude Fleet Server..."
    cd "$SCRIPT_DIR"
    exec npx tsx src/index.ts
}

start_background() {
    if check_running; then
        echo "Server already running (PID: $(cat "$PID_FILE"))"
        exit 0
    fi

    echo "Starting Claude Fleet Server in background..."
    cd "$SCRIPT_DIR"
    nohup npx tsx src/index.ts >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"

    # Wait for startup
    for i in {1..15}; do
        sleep 0.5
        if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
            echo "✅ Server started on http://localhost:$PORT"
            echo "   PID: $(cat "$PID_FILE")"
            echo "   Log: $LOG_FILE"
            exit 0
        fi
    done

    echo "❌ Server failed to start. Check $LOG_FILE"
    exit 1
}

stop_server() {
    if ! check_running; then
        echo "Server not running"
        exit 0
    fi

    PID=$(cat "$PID_FILE")
    echo "Stopping server (PID: $PID)..."
    kill "$PID" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "✅ Server stopped"
}

show_status() {
    if check_running; then
        PID=$(cat "$PID_FILE")
        echo "✅ Server running"
        echo "   PID: $PID"
        echo "   Port: $PORT"
        curl -s "http://localhost:$PORT/health" | python3 -m json.tool 2>/dev/null || true
    else
        # Check if something else is on the port
        if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
            echo "⚠️  Server running (external process)"
            curl -s "http://localhost:$PORT/health" | python3 -m json.tool 2>/dev/null || true
        else
            echo "❌ Server not running"
        fi
    fi
}

case "${1:-}" in
    --background|-b)
        start_background
        ;;
    --stop|-s)
        stop_server
        ;;
    --status|-t)
        show_status
        ;;
    --help|-h)
        echo "Claude Code Collab Server"
        echo ""
        echo "Usage: $0 [option]"
        echo ""
        echo "Options:"
        echo "  (none)        Start server in foreground"
        echo "  --background  Start server in background"
        echo "  --stop        Stop background server"
        echo "  --status      Check server status"
        echo "  --help        Show this help"
        ;;
    *)
        start_foreground
        ;;
esac
