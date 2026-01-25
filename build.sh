#!/bin/bash
# Quick build script for claude-code-tools-unified
# Run: chmod +x build.sh && ./build.sh

set -e

echo "Installing dependencies..."
pnpm install

echo ""
echo "Building all packages..."
pnpm build

echo ""
echo "Build complete! Test with:"
echo "  node apps/cli/dist/index.js --help"
echo "  node apps/cli/dist/index.js session list"
echo "  node apps/cli/dist/index.js fleet workers"
echo "  node apps/cli/dist/index.js safety status"
