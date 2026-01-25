#!/usr/bin/env node
/**
 * Claude Fleet - Postinstall Script
 *
 * Automatically installs the MCP server in Claude Code after npm install.
 */

import { execSync, spawnSync } from 'node:child_process';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function log(msg) {
  console.log(`${CYAN}[fleet]${RESET} ${msg}`);
}

function success(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function warn(msg) {
  console.log(`${YELLOW}⚠${RESET} ${msg}`);
}

function main() {
  console.log('');
  console.log(`${BOLD}╔════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║         CLAUDE FLEET - MCP SERVER SETUP            ║${RESET}`);
  console.log(`${BOLD}╚════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  // Check if Claude CLI is available
  const claudeCheck = spawnSync('which', ['claude'], { encoding: 'utf-8' });
  if (claudeCheck.status !== 0) {
    warn('Claude CLI not found - skipping automatic MCP installation.');
    console.log('');
    console.log(`${DIM}To manually install the MCP server later, run:${RESET}`);
    console.log(`  ${BOLD}fleet mcp-install${RESET}`);
    console.log('');
    return;
  }

  log('Claude CLI detected. Installing MCP server...');
  console.log('');

  // Build the MCP config
  const mcpConfig = {
    command: 'npx',
    args: ['-y', 'claude-fleet', 'mcp-server'],
    env: {
      CLAUDE_FLEET_URL: process.env.CLAUDE_FLEET_URL || 'http://localhost:3847',
    },
  };

  const configJson = JSON.stringify(mcpConfig);

  try {
    // Check if already installed
    const listResult = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf-8' });
    if (listResult.stdout && listResult.stdout.includes('claude-fleet')) {
      success('Claude Fleet MCP server already installed.');
    } else {
      // Install the MCP server
      execSync(`claude mcp add-json "claude-fleet" '${configJson}'`, {
        stdio: 'pipe',
      });
      success('Claude Fleet MCP server installed!');
    }

    console.log('');
    console.log(`${BOLD}82 MCP tools now available in Claude Code:${RESET}`);
    console.log(`  ${DIM}• Team coordination (spawn, broadcast, assign)${RESET}`);
    console.log(`  ${DIM}• Task & work item management${RESET}`);
    console.log(`  ${DIM}• Agent mail & handoffs${RESET}`);
    console.log(`  ${DIM}• Swarm intelligence (pheromones, beliefs, credits)${RESET}`);
    console.log(`  ${DIM}• Workflow orchestration${RESET}`);
    console.log('');
    console.log(`${YELLOW}Restart Claude Code to activate the MCP tools.${RESET}`);
    console.log('');

  } catch (error) {
    warn('Could not auto-install MCP server.');
    console.log(`${DIM}Error: ${error.message}${RESET}`);
    console.log('');
    console.log('To manually install, run:');
    console.log(`  ${BOLD}fleet mcp-install${RESET}`);
    console.log('');
  }
}

main();
