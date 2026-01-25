#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Claude Fleet Tmux Theme Installer
# ═══════════════════════════════════════════════════════════════════════════

set -e

CYAN='\033[0;36m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║                     Claude Fleet Tmux Theme Installer                      ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/tmux.conf"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}Config file not found at ${CONFIG_FILE}${NC}"
    echo "Downloading from GitHub..."
    CONFIG_FILE="/tmp/claude-fleet-tmux.conf"
    curl -fsSL https://raw.githubusercontent.com/sethdford/claude-fleet/main/config/tmux.conf -o "$CONFIG_FILE"
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
