#!/bin/bash
#
# Claude Audit Loop
#
# Runs Claude Code in a continuous loop with a clear goal:
# Make the codebase production-ready by passing all checks.
#
# The loop continues until Claude reports "AUDIT COMPLETE"
# with all criteria verified.
#
# Usage: ./scripts/audit-loop.sh [options]
#
# Options:
#   --max-iterations N   Maximum iterations before stopping (default: 20)
#   --dry-run            Show what would be done without executing
#   --verbose            Show detailed output
#   --no-commit          Don't commit changes automatically
#   --help               Show this help
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
MAX_ITERATIONS=${MAX_ITERATIONS:-20}
DRY_RUN=false
VERBOSE=false
AUTO_COMMIT=true
LOG_FILE="audit-loop-$(date +%Y%m%d-%H%M%S).log"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --max-iterations)
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --no-commit)
      AUTO_COMMIT=false
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Runs Claude in a loop until the codebase is production-ready."
      echo ""
      echo "Options:"
      echo "  --max-iterations N   Maximum iterations (default: 20)"
      echo "  --dry-run            Show what would be done without executing"
      echo "  --verbose            Show detailed output"
      echo "  --no-commit          Don't auto-commit fixes"
      echo "  --help               Show this help"
      echo ""
      echo "Completion Criteria:"
      echo "  - fleet audit passes (typecheck, lint, tests, build)"
      echo "  - npm run e2e:all passes"
      echo "  - No critical TODOs in src/"
      echo "  - Documentation is accurate"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# The goal-oriented prompt
AUDIT_PROMPT='You are in an audit loop with ONE goal: Make this codebase production-ready.

COMPLETION CRITERIA (ALL must pass):
1. `fleet audit` shows "All checks passed"
2. `npm run e2e:all` shows all tests passing
3. No critical TODOs in src/
4. Documentation matches reality

START by running `fleet audit`. If it fails, fix the issues.
Then run `npm run e2e:all`. If it fails, fix the issues.
Then check for TODOs, dead code, and doc accuracy.

Fix every issue you find. Re-run checks after each fix.
Keep iterating until ALL criteria pass.

When COMPLETELY done, say exactly:
"AUDIT COMPLETE - All criteria met"

If work remains, report what you fixed and what still needs work.
DO NOT say "AUDIT COMPLETE" unless everything truly passes.'

# Header
clear
echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║                  CLAUDE AUDIT LOOP                           ║${NC}"
echo -e "${CYAN}${BOLD}║         Goal: Production-Ready Codebase                      ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Configuration:${NC}"
echo -e "  Max iterations: ${BOLD}$MAX_ITERATIONS${NC}"
echo -e "  Auto-commit:    ${BOLD}$AUTO_COMMIT${NC}"
echo -e "  Log file:       ${BOLD}$LOG_FILE${NC}"
echo ""

echo -e "${BLUE}Completion Criteria:${NC}"
echo -e "  ${YELLOW}○${NC} fleet audit passes"
echo -e "  ${YELLOW}○${NC} E2E tests pass"
echo -e "  ${YELLOW}○${NC} No critical TODOs"
echo -e "  ${YELLOW}○${NC} Docs accurate"
echo ""

# Check if claude is available
if ! command -v claude &> /dev/null; then
  echo -e "${RED}Error: 'claude' command not found${NC}"
  echo "Install Claude Code: https://claude.ai/code"
  exit 1
fi

# Pre-flight status
echo -e "${YELLOW}Pre-flight Check:${NC}"
if npx tsx src/cli.ts audit > /dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} fleet audit passes"
  AUDIT_STATUS="PASS"
else
  echo -e "  ${RED}✗${NC} fleet audit has failures"
  AUDIT_STATUS="FAIL"
fi

if npm run e2e > /dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} E2E tests pass"
  E2E_STATUS="PASS"
else
  echo -e "  ${YELLOW}○${NC} E2E tests need verification"
  E2E_STATUS="UNKNOWN"
fi
echo ""

# Check if already complete
if [ "$AUDIT_STATUS" = "PASS" ] && [ "$E2E_STATUS" = "PASS" ]; then
  echo -e "${GREEN}${BOLD}Pre-flight shows all green. Verifying...${NC}"
fi

# Initialize
ITERATION=0
COMPLETE=false

# Main loop
while [ $ITERATION -lt $MAX_ITERATIONS ] && [ "$COMPLETE" = false ]; do
  ITERATION=$((ITERATION + 1))

  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}${BOLD}  ITERATION $ITERATION of $MAX_ITERATIONS${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY RUN] Would run Claude with audit prompt${NC}"
    echo ""
    COMPLETE=true
  else
    # Run Claude
    echo -e "${BLUE}Running Claude...${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"
    echo "ITERATION $ITERATION - $(date)" >> "$LOG_FILE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"

    # Run Claude and capture output
    RESPONSE=$(claude --print "$AUDIT_PROMPT" 2>&1 | tee -a "$LOG_FILE")

    # Check for completion
    if echo "$RESPONSE" | grep -qi "AUDIT COMPLETE"; then
      # Verify it's actually complete
      echo ""
      echo -e "${YELLOW}Claude reports complete. Verifying...${NC}"

      VERIFIED=true

      if ! npx tsx src/cli.ts audit > /dev/null 2>&1; then
        echo -e "  ${RED}✗${NC} fleet audit still failing"
        VERIFIED=false
      else
        echo -e "  ${GREEN}✓${NC} fleet audit passes"
      fi

      if ! npm run e2e > /dev/null 2>&1; then
        echo -e "  ${RED}✗${NC} E2E tests still failing"
        VERIFIED=false
      else
        echo -e "  ${GREEN}✓${NC} E2E tests pass"
      fi

      if [ "$VERIFIED" = true ]; then
        COMPLETE=true
        echo ""
        echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}${BOLD}  AUDIT COMPLETE - All Criteria Met!${NC}"
        echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      else
        echo ""
        echo -e "${YELLOW}Verification failed. Continuing loop...${NC}"
      fi
    else
      echo ""
      echo -e "${YELLOW}Work remains. Continuing to next iteration...${NC}"
      sleep 2
    fi
  fi
done

# Summary
echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║                    AUDIT SUMMARY                             ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Iterations:${NC} $ITERATION"
echo -e "${BLUE}Log file:${NC}   $LOG_FILE"
echo ""

if [ "$COMPLETE" = true ]; then
  echo -e "${GREEN}${BOLD}Status: COMPLETE${NC}"
  echo ""
  echo -e "${GREEN}✓${NC} fleet audit passes"
  echo -e "${GREEN}✓${NC} E2E tests pass"
  echo -e "${GREEN}✓${NC} All criteria met"
else
  echo -e "${YELLOW}${BOLD}Status: MAX ITERATIONS REACHED${NC}"
  echo ""
  echo -e "${YELLOW}The audit did not complete within $MAX_ITERATIONS iterations.${NC}"
  echo -e "${YELLOW}Review $LOG_FILE for details and continue manually.${NC}"
fi

echo ""

# Final verification
if [ "$DRY_RUN" = false ] && [ "$COMPLETE" = true ]; then
  echo -e "${BLUE}Final Verification:${NC}"
  npx tsx src/cli.ts audit
fi

echo ""
echo -e "${CYAN}Done.${NC}"
