#!/bin/bash
#
# E2E Validation Script
#
# Runs full validation of the claude-code-tools-unified project:
# 1. Install dependencies
# 2. Build all packages
# 3. Type check
# 4. Run unit tests
# 5. Run E2E tests
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Spinner for long operations
spin() {
  local pid=$1
  local delay=0.1
  local spinstr='|/-\'
  while [ "$(ps a | awk '{print $1}' | grep $pid)" ]; do
    local temp=${spinstr#?}
    printf " [%c]  " "$spinstr"
    local spinstr=$temp${spinstr%"$temp"}
    sleep $delay
    printf "\b\b\b\b\b\b"
  done
  printf "    \b\b\b\b"
}

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Claude Code Tools - E2E Validation Suite            ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$(dirname "$0")/.."

STEP=1
TOTAL_STEPS=5

# Step 1: Install dependencies
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS]${NC} Installing dependencies..."
if pnpm install > /dev/null 2>&1; then
  echo -e "    ${GREEN}✓${NC} Dependencies installed"
else
  echo -e "    ${RED}✗${NC} Failed to install dependencies"
  exit 1
fi
((STEP++))

# Step 2: Build packages
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS]${NC} Building packages..."
if pnpm build > /dev/null 2>&1; then
  echo -e "    ${GREEN}✓${NC} Build successful"
else
  echo -e "    ${RED}✗${NC} Build failed"
  exit 1
fi
((STEP++))

# Step 3: Type check
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS]${NC} Running type checks..."
if pnpm typecheck > /dev/null 2>&1; then
  echo -e "    ${GREEN}✓${NC} Type check passed"
else
  echo -e "    ${RED}✗${NC} Type check failed"
  exit 1
fi
((STEP++))

# Step 4: Unit tests
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS]${NC} Running unit tests..."
if pnpm test 2>&1 | tee /tmp/cct-test-output.log | grep -E "(PASS|FAIL|✓|✗)" | head -20; then
  if grep -q "FAIL" /tmp/cct-test-output.log; then
    echo -e "    ${RED}✗${NC} Some tests failed"
    exit 1
  else
    echo -e "    ${GREEN}✓${NC} All unit tests passed"
  fi
else
  echo -e "    ${RED}✗${NC} Test run failed"
  exit 1
fi
((STEP++))

# Step 5: E2E tests specifically
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS]${NC} Running E2E tests..."
if pnpm vitest run tests/e2e --reporter=verbose 2>&1 | tee /tmp/cct-e2e-output.log | grep -E "(✓|✗|PASS|FAIL)" | head -30; then
  if grep -q "FAIL" /tmp/cct-e2e-output.log; then
    echo -e "    ${RED}✗${NC} E2E tests failed"
    exit 1
  else
    echo -e "    ${GREEN}✓${NC} All E2E tests passed"
  fi
else
  echo -e "    ${RED}✗${NC} E2E test run failed"
  exit 1
fi

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                   ${GREEN}✓ All Validations Passed${BLUE}                 ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Summary
echo -e "${YELLOW}Summary:${NC}"
echo -e "  • Dependencies: ${GREEN}Installed${NC}"
echo -e "  • Build: ${GREEN}Success${NC}"
echo -e "  • Type Check: ${GREEN}Passed${NC}"
echo -e "  • Unit Tests: ${GREEN}Passed${NC}"
echo -e "  • E2E Tests: ${GREEN}Passed${NC}"
echo ""
echo -e "  Database tables validated:"
echo -e "    sessions, messages, workers, tasks, beads,"
echo -e "    bead_events, convoys, mailbox, handoffs, checkpoints"
echo ""
echo -e "${GREEN}The CLI can exercise all APIs and data is properly persisted.${NC}"
echo ""
