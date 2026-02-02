#!/usr/bin/env bash
# Flag Monitor — Diff Claude Code feature flags against a stored baseline
#
# Usage:
#   ./scripts/flag-monitor.sh           # Compare current vs baseline
#   ./scripts/flag-monitor.sh --update  # Update baseline to current
#
# Extracts tengu_* flags from the Claude Code binary via `strings`,
# diffs against scripts/flag-baseline.txt, and reports changes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE="${SCRIPT_DIR}/flag-baseline.txt"
TMPFILE="${SCRIPT_DIR}/.flag-current.tmp"

# Locate Claude Code binary
find_claude_binary() {
  local candidates=(
    "$HOME/.claude/local/claude"
    "$(command -v claude 2>/dev/null || true)"
    "/usr/local/bin/claude"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      # Resolve symlinks to actual binary
      local resolved
      resolved="$(readlink -f "$candidate" 2>/dev/null || realpath "$candidate" 2>/dev/null || echo "$candidate")"
      echo "$resolved"
      return 0
    fi
  done
  return 1
}

# Extract flags from binary
extract_flags() {
  local binary="$1"
  # Extract all tengu_* identifiers — these are Statsig gate/experiment names
  strings "$binary" 2>/dev/null \
    | grep -oE 'tengu_[a-z0-9_]+' \
    | sort -u
}

# Main
main() {
  local update_mode=false
  if [[ "${1:-}" == "--update" ]]; then
    update_mode=true
  fi

  local binary
  if ! binary="$(find_claude_binary)"; then
    echo "ERROR: Could not locate Claude Code binary"
    echo "Searched: ~/.claude/local/claude, \$(which claude), /usr/local/bin/claude"
    exit 1
  fi

  echo "Binary: $binary"
  echo "Version: $(claude --version 2>/dev/null || echo 'unknown')"
  echo ""

  # Extract current flags
  extract_flags "$binary" > "$TMPFILE"
  local current_count
  current_count="$(wc -l < "$TMPFILE" | tr -d ' ')"
  echo "Found $current_count tengu_* flags in binary"

  if $update_mode; then
    cp "$TMPFILE" "$BASELINE"
    rm -f "$TMPFILE"
    echo "Baseline updated ($current_count flags)"
    exit 0
  fi

  # Compare against baseline
  if [[ ! -f "$BASELINE" ]]; then
    echo "No baseline found at $BASELINE"
    echo "Run with --update to create one:"
    echo "  ./scripts/flag-monitor.sh --update"
    rm -f "$TMPFILE"
    exit 1
  fi

  local baseline_count
  baseline_count="$(wc -l < "$BASELINE" | tr -d ' ')"
  echo "Baseline has $baseline_count flags"
  echo ""

  # Diff
  local added removed
  added="$(comm -13 "$BASELINE" "$TMPFILE")"
  removed="$(comm -23 "$BASELINE" "$TMPFILE")"

  if [[ -z "$added" && -z "$removed" ]]; then
    echo "No changes — flags match baseline"
    rm -f "$TMPFILE"
    exit 0
  fi

  if [[ -n "$added" ]]; then
    local add_count
    add_count="$(echo "$added" | wc -l | tr -d ' ')"
    echo "NEW FLAGS ($add_count):"
    echo "$added" | sed 's/^/  + /'
    echo ""
  fi

  if [[ -n "$removed" ]]; then
    local rem_count
    rem_count="$(echo "$removed" | wc -l | tr -d ' ')"
    echo "REMOVED FLAGS ($rem_count):"
    echo "$removed" | sed 's/^/  - /'
    echo ""
  fi

  # Highlight key flags relevant to Fleet
  local key_flags=(
    "tengu_session_memory"
    "tengu_remote_backend"
    "tengu_thinkback"
    "tengu_plan_mode_interview_phase"
    "tengu_mcp_tool_search"
    "tengu_streaming_tool_execution2"
    "tengu_scratch"
    "tengu_swarm"
    "tengu_team"
    "tengu_agent"
    "tengu_brass_pebble"
    "tengu_marble_anvil"
    "tengu_marble_kite"
    "tengu_coral_fern"
    "tengu_quiet_fern"
    "tengu_plank_river_frost"
    "tengu_quartz_lantern"
    "tengu_scarf_coffee"
    "tengu_cache_plum_violet"
    "tengu_flicker"
    "tengu_tool_pear"
    "tengu_cork_m4q"
    "tengu_tst_kx7"
    "tengu_plum_vx3"
    "tengu_kv7_prompt_sort"
    "tengu_workout"
  )

  local relevant_changes=false
  for flag in "${key_flags[@]}"; do
    if echo "$added" | grep -q "$flag" 2>/dev/null; then
      if ! $relevant_changes; then
        echo "FLEET-RELEVANT CHANGES:"
        relevant_changes=true
      fi
      echo "  ★ NEW: $flag"
    fi
    if echo "$removed" | grep -q "$flag" 2>/dev/null; then
      if ! $relevant_changes; then
        echo "FLEET-RELEVANT CHANGES:"
        relevant_changes=true
      fi
      echo "  ✗ REMOVED: $flag"
    fi
  done

  rm -f "$TMPFILE"
  exit 1  # Non-zero = changes detected (useful in CI)
}

main "$@"
