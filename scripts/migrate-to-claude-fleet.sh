#!/bin/bash
#
# Migration Script: claude-code-tools-unified → claude-fleet
#
# This script:
# 1. Backs up existing claude-collab-local
# 2. Copies all code from claude-code-tools-unified
# 3. Updates package names and references
# 4. Initializes git with the new remote
#
# Usage:
#   chmod +x scripts/migrate-to-claude-fleet.sh
#   ./scripts/migrate-to-claude-fleet.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SOURCE_DIR="/Users/sethford/Downloads/claude-code-tools-unified"
TARGET_DIR="/Users/sethford/Downloads/claude-collab-local"
BACKUP_DIR="/Users/sethford/Downloads/claude-collab-local-backup-$(date +%Y%m%d-%H%M%S)"
NEW_REMOTE="https://github.com/sethdford/claude-fleet.git"

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    Migration: claude-code-tools → claude-fleet${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# Verify source exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${RED}ERROR: Source directory not found: $SOURCE_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Source directory found${NC}"

# Step 1: Backup existing target if it exists
if [ -d "$TARGET_DIR" ]; then
    echo -e "${YELLOW}Backing up existing claude-collab-local...${NC}"
    mv "$TARGET_DIR" "$BACKUP_DIR"
    echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}"
fi

# Step 2: Copy source to target
echo -e "${YELLOW}Copying code to claude-collab-local...${NC}"
mkdir -p "$TARGET_DIR"

# Copy everything except node_modules, dist, .git
rsync -av --progress "$SOURCE_DIR/" "$TARGET_DIR/" \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude '*.log' \
    --exclude '.DS_Store'

echo -e "${GREEN}✓ Code copied${NC}"

# Step 3: Update package names from @cct/* to @claude-fleet/*
echo -e "${YELLOW}Updating package names...${NC}"

cd "$TARGET_DIR"

# Update all package.json files
find . -name "package.json" -not -path "./node_modules/*" | while read file; do
    if [ -f "$file" ]; then
        # Replace @cct/ with @claude-fleet/
        sed -i '' 's/"@cct\//"@claude-fleet\//g' "$file"
        # Update main package name if it's the CLI
        sed -i '' 's/"name": "claude-code-tools"/"name": "claude-fleet"/g' "$file"
        echo "  Updated: $file"
    fi
done

# Update all TypeScript imports
find . -name "*.ts" -not -path "./node_modules/*" | while read file; do
    if [ -f "$file" ]; then
        sed -i '' "s/from '@cct\//from '@claude-fleet\//g" "$file"
        sed -i '' "s/import '@cct\//import '@claude-fleet\//g" "$file"
    fi
done

echo -e "${GREEN}✓ Package names updated${NC}"

# Step 3b: Update CLI binary name from cct to cf
echo -e "${YELLOW}Updating CLI binary name...${NC}"

CLI_PKG="$TARGET_DIR/apps/cli/package.json"
if [ -f "$CLI_PKG" ]; then
    # Change bin from cct to cf
    sed -i '' 's/"cct":/"cf":/g' "$CLI_PKG"
    echo "  Updated CLI binary: cct → cf"
fi

# Update references to cct in scripts
find . -name "*.sh" -not -path "./node_modules/*" | while read file; do
    if [ -f "$file" ]; then
        sed -i '' 's/\$CF/\$CF/g' "$file"
        sed -i '' 's/CF=/CF=/g' "$file"
        sed -i '' 's/cf tmux/cf tmux/g' "$file"
        sed -i '' 's/cf session/cf session/g' "$file"
        sed -i '' 's/cf fleet/cf fleet/g' "$file"
    fi
done

echo -e "${GREEN}✓ CLI binary renamed to 'cf'${NC}"

# Step 3c: Create .gitignore
echo -e "${YELLOW}Creating .gitignore...${NC}"

cat > "$TARGET_DIR/.gitignore" << 'GITIGNORE'
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
*.tsbuildinfo

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Test
coverage/
.nyc_output/

# Environment
.env
.env.local
.env.*.local

# Database
*.db
*.sqlite

# Temporary
tmp/
temp/
.tmp/

# Worktrees
.worktrees/

# Claude
.claude/

# Rust/Cargo
crates/target/
Cargo.lock
GITIGNORE

echo -e "${GREEN}✓ .gitignore created${NC}"

# Step 4: Update root package.json
echo -e "${YELLOW}Updating root package.json...${NC}"

cat > "$TARGET_DIR/package.json" << 'EOF'
{
  "name": "claude-fleet",
  "version": "1.0.0",
  "description": "Multi-agent orchestration and terminal automation for Claude Code",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "clean": "pnpm -r clean",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --exclude '**/e2e/**'",
    "test:e2e": "vitest run tests/e2e/",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write .",
    "dev": "pnpm -r --parallel dev"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "eslint": "^8.56.0",
    "prettier": "^3.2.0",
    "typescript": "^5.4.0",
    "vitest": "^2.1.8"
  },
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/sethdford/claude-fleet.git"
  },
  "author": "Seth Ford",
  "license": "MIT",
  "keywords": [
    "claude",
    "ai",
    "multi-agent",
    "orchestration",
    "tmux",
    "terminal",
    "automation",
    "mcp"
  ]
}
EOF

echo -e "${GREEN}✓ Root package.json updated${NC}"

# Step 5: Create/update README
echo -e "${YELLOW}Creating README...${NC}"

cat > "$TARGET_DIR/README.md" << 'EOF'
# Claude Fleet

Multi-agent orchestration and terminal automation for Claude Code.

## Features

- **Fleet Management** - Spawn and orchestrate multiple Claude workers
- **Tmux Automation** - Control terminal panes programmatically ("Playwright for terminals")
- **Session Management** - Search, resume, and export Claude Code sessions
- **MCP Integration** - 50+ MCP tools for Claude Desktop integration
- **Safety Hooks** - Configurable safety checks and guardrails
- **Structured Work Tracking** - Beads and convoys for task management

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start tmux session
tmux new-session -s fleet

# Run demo
npx tsx scripts/demo-tmux-fleet.ts
```

## Packages

| Package | Description |
|---------|-------------|
| `@claude-fleet/common` | Shared types and utilities |
| `@claude-fleet/storage` | SQLite persistence layer |
| `@claude-fleet/session` | Session management |
| `@claude-fleet/fleet` | Worker orchestration |
| `@claude-fleet/tmux` | Terminal automation |
| `@claude-fleet/safety` | Safety hooks |
| `@claude-fleet/mcp` | MCP server |
| `claude-fleet` (CLI) | Command-line interface |

## CLI Usage

```bash
# Tmux Fleet
cf tmux status
cf tmux spawn worker1
cf tmux send worker1 "echo hello"
cf tmux capture worker1

# Session Management
cf session list
cf session search "bug fix"
cf session resume <id>

# Fleet Orchestration
cf fleet spawn alice --role worker
cf fleet broadcast "status update"
cf fleet workers
```

## MCP Integration

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "claude-fleet": {
      "command": "node",
      "args": ["/path/to/claude-fleet/packages/mcp/dist/bin.js"]
    }
  }
}
```

## Development

```bash
# Type check
pnpm typecheck

# Run tests
pnpm test

# Watch mode
pnpm dev
```

## License

MIT
EOF

echo -e "${GREEN}✓ README created${NC}"

# Step 6: Initialize git
echo -e "${YELLOW}Initializing git repository...${NC}"

cd "$TARGET_DIR"
git init
git add .
git commit -m "Initial commit: Claude Fleet

Multi-agent orchestration and terminal automation for Claude Code.

Features:
- Fleet management with worker spawning and orchestration
- Tmux terminal automation (Playwright for terminals)
- Session management (search, resume, export)
- MCP server with 50+ tools
- Safety hooks and guardrails
- Structured work tracking (beads/convoys)

Packages:
- @claude-fleet/common
- @claude-fleet/storage
- @claude-fleet/session
- @claude-fleet/fleet
- @claude-fleet/tmux
- @claude-fleet/safety
- @claude-fleet/mcp
- claude-fleet (CLI)"

# Step 7: Add remote
echo -e "${YELLOW}Adding remote...${NC}"
git remote add origin "$NEW_REMOTE"

echo -e "${GREEN}✓ Git initialized with remote: $NEW_REMOTE${NC}"

# Step 8: Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}           Migration Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "Source:  ${YELLOW}$SOURCE_DIR${NC}"
echo -e "Target:  ${YELLOW}$TARGET_DIR${NC}"
echo -e "Backup:  ${YELLOW}$BACKUP_DIR${NC}"
echo -e "Remote:  ${YELLOW}$NEW_REMOTE${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo "  1. Install dependencies:"
echo "     cd $TARGET_DIR && pnpm install"
echo ""
echo "  2. Build:"
echo "     pnpm build"
echo ""
echo "  3. Push to GitHub:"
echo "     git push -u origin main"
echo ""
echo "  4. Test tmux integration:"
echo "     tmux new-session -s fleet"
echo "     npx tsx scripts/demo-tmux-fleet.ts"
echo ""
echo "  5. Link CLI globally (optional):"
echo "     pnpm link --global"
echo "     cf tmux status"
echo ""
