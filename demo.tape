# VHS Demo for Claude Fleet v2.0
Output demo.gif
Set FontSize 16
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set Shell bash
Set TypingSpeed 40ms

# Title
Type "# Claude Fleet - Multi-Agent Orchestration for Claude Code"
Enter
Sleep 1s

# Start server
Type "echo '>>> Starting Fleet Server...'"
Enter
Type "./start.sh --background"
Enter
Sleep 3s

# Health check
Type "echo '>>> Health Check'"
Enter
Type "curl -s localhost:3847/health | jq ."
Enter
Sleep 2s

# CLI help
Type "echo '>>> Fleet CLI Commands'"
Enter
Type "npx tsx src/cli.ts --help | head -25"
Enter
Sleep 3s

# Run E2E test (shows the full flow)
Type "echo '>>> Running E2E Integration Test'"
Enter
Type "npm run e2e 2>&1 | tail -25"
Enter
Sleep 10s

# Done
Type "echo ''"
Enter
Type "echo '>>> Claude Fleet Ready!'"
Enter
Sleep 2s
