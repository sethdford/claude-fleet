#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Claude Fleet Tmux Theme Installer
# ═══════════════════════════════════════════════════════════════════════════

set -e

CYAN='\033[0;36m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Parse arguments
FLEET_MODE=false
for arg in "$@"; do
    case $arg in
        --fleet)
            FLEET_MODE=true
            shift
            ;;
        --help|-h)
            echo "Usage: install-tmux-theme.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --fleet    Install with real-time Fleet status integration"
            echo "  --help     Show this help message"
            echo ""
            exit 0
            ;;
    esac
done

if [ "$FLEET_MODE" = true ]; then
    echo -e "${PURPLE}"
    echo "╔═══════════════════════════════════════════════════════════════════════════╗"
    echo "║           Claude Fleet Tmux Theme Installer (Fleet Integration)           ║"
    echo "╚═══════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    CONFIG_NAME="tmux-fleet.conf"
else
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════════════════════╗"
    echo "║                     Claude Fleet Tmux Theme Installer                      ║"
    echo "╚═══════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    CONFIG_NAME="tmux.conf"
fi

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/${CONFIG_NAME}"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}Config file not found at ${CONFIG_FILE}${NC}"
    echo "Downloading from GitHub..."
    CONFIG_FILE="/tmp/claude-fleet-tmux.conf"
    curl -fsSL "https://raw.githubusercontent.com/sethdford/claude-fleet/main/config/${CONFIG_NAME}" -o "$CONFIG_FILE"
fi

# Backup existing config
if [ -f ~/.tmux.conf ]; then
    BACKUP=~/.tmux.conf.backup.$(date +%Y%m%d_%H%M%S)
    echo -e "${YELLOW}Backing up existing config to ${BACKUP}${NC}"
    cp ~/.tmux.conf "$BACKUP"
fi

# Install config
echo -e "${BLUE}Installing tmux configuration...${NC}"
cp "$CONFIG_FILE" ~/.tmux.conf

# Install TPM if not present
if [ ! -d ~/.tmux/plugins/tpm ]; then
    echo -e "${BLUE}Installing Tmux Plugin Manager (TPM)...${NC}"
    git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
fi

# Reload tmux if running
if tmux list-sessions &>/dev/null; then
    echo -e "${BLUE}Reloading tmux configuration...${NC}"
    tmux source-file ~/.tmux.conf
fi

echo ""
echo -e "${GREEN}✓ Installation complete!${NC}"
echo ""
echo -e "${CYAN}Quick Start:${NC}"
echo "  tmux new -s dev              # Start a new session"
echo "  Ctrl-a + I                   # Install plugins (capital I)"
echo "  Ctrl-a + r                   # Reload config"
echo ""
echo -e "${CYAN}Key Bindings (prefix = Ctrl-a):${NC}"
echo "  |     Split vertical         -     Split horizontal"
echo "  h/j/k/l  Navigate panes      H/J/K/L  Resize panes"
echo "  c     New window             x     Kill pane"
echo "  s     Session picker         S     Sync panes"
echo ""
echo -e "${CYAN}For best results, use a terminal with true color support:${NC}"
echo "  - iTerm2 (macOS)"
echo "  - Alacritty"
echo "  - Kitty"
echo "  - WezTerm"
echo ""

if [ "$FLEET_MODE" = true ]; then
    echo -e "${PURPLE}Fleet Integration Features:${NC}"
    echo "  - Real-time worker count in status bar"
    echo "  - Active task count display"
    echo "  - Swarm status indicator"
    echo "  - Fleet server health monitoring"
    echo ""
    echo -e "${CYAN}Make sure the Fleet server is running:${NC}"
    echo "  fleet server                 # Start the server"
    echo "  export FLEET_PORT=3000       # Custom port (optional)"
    echo ""
fi

# Install Terminal.app profile on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    TERMINAL_PROFILE="${SCRIPT_DIR}/ClaudeFleet.terminal"
    if [ ! -f "$TERMINAL_PROFILE" ]; then
        echo -e "${BLUE}Downloading Terminal.app profile...${NC}"
        TERMINAL_PROFILE="/tmp/ClaudeFleet.terminal"
        curl -fsSL "https://raw.githubusercontent.com/sethdford/claude-fleet/main/config/ClaudeFleet.terminal" -o "$TERMINAL_PROFILE"
    fi

    if [ -f "$TERMINAL_PROFILE" ]; then
        echo -e "${BLUE}Installing Terminal.app profile...${NC}"
        open "$TERMINAL_PROFILE"

        # Set as default after a short delay
        sleep 1
        defaults write com.apple.Terminal "Default Window Settings" -string "Claude Fleet"
        defaults write com.apple.Terminal "Startup Window Settings" -string "Claude Fleet"

        echo -e "${GREEN}✓ Terminal.app 'Claude Fleet' profile installed and set as default${NC}"
        echo ""
        echo -e "${CYAN}Terminal Color Palette:${NC}"
        echo "  Background:  #1a1a2e (ghostly dark blue-gray)"
        echo "  Foreground:  #e4e4e7 (soft white)"
        echo "  Cursor:      #00d4ff (cyan)"
        echo "  ANSI Black:  #2d2d44 (soft charcoal)"
        echo ""
    fi
fi
