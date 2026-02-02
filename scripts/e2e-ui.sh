#!/bin/bash
#
# E2E UI Test Script (Puppeteer-based)
#
# Runs browser-based dashboard tests using Puppeteer + Vitest.
# Starts a test server, launches headless Chrome, runs all UI tests,
# then tears down.
#
# Usage: ./scripts/e2e-ui.sh
#        HEADLESS=false ./scripts/e2e-ui.sh  # visible browser
#        SLOW_MO=100 ./scripts/e2e-ui.sh     # slow motion for debugging
#        DEBUG=1 ./scripts/e2e-ui.sh          # server logs to stderr
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║       CLAUDE FLEET UI E2E TESTS (Puppeteer)        ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# ── Pre-flight checks ───────────────────────────────────────────────────────

# Ensure build is up-to-date
if [ ! -f dist/index.js ]; then
  echo -e "${YELLOW}Building project...${NC}"
  npm run build
fi

# Check that Puppeteer is installed
if ! node -e "require('puppeteer')" 2>/dev/null; then
  echo -e "${RED}Puppeteer not installed. Run: npm install${NC}"
  exit 1
fi

# Check for Chrome/Chromium
CHROME_PATH=$(node -e "
  try {
    const pup = require('puppeteer');
    console.log(pup.executablePath());
  } catch { console.log(''); }
" 2>/dev/null || true)

if [ -z "$CHROME_PATH" ]; then
  echo -e "${YELLOW}Warning: Could not detect bundled Chromium. Puppeteer will attempt to download it.${NC}"
fi

# ── Configuration ────────────────────────────────────────────────────────────

export E2E_PORT="${E2E_PORT:-4797}"
export HEADLESS="${HEADLESS:-true}"
export SLOW_MO="${SLOW_MO:-0}"

echo "  Port:     $E2E_PORT"
echo "  Headless: $HEADLESS"
echo "  SlowMo:   ${SLOW_MO}ms"
echo ""

# ── Run tests ────────────────────────────────────────────────────────────────

# The vitest config and test helpers handle server start/stop internally
echo "Running UI E2E tests..."
echo ""

npx vitest run --config vitest.e2e-ui.config.ts 2>&1

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}All UI E2E tests passed!${NC}"
else
  echo -e "${RED}Some UI E2E tests failed (exit code: $EXIT_CODE)${NC}"

  # Check for screenshots
  if [ -d test-screenshots ]; then
    echo ""
    echo -e "${YELLOW}Screenshots from failures:${NC}"
    ls -la test-screenshots/ 2>/dev/null || true
  fi
fi

exit $EXIT_CODE
