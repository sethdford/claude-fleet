#!/usr/bin/env node
/**
 * Claude Code Tools CLI
 *
 * Main entry point for the cct command.
 */

import { Command } from 'commander';
import { sessionCommands } from './commands/session.js';
import { fleetCommands } from './commands/fleet.js';
import { safetyCommands } from './commands/safety.js';
import { searchCommand } from './commands/search.js';
import { serveCommand } from './commands/serve.js';
import { lmshCommand } from './commands/lmsh.js';
import { tmuxCommands } from './commands/tmux.js';

const program = new Command();

program
  .name('cct')
  .description('Claude Code Tools - Multi-agent orchestration and session management')
  .version('1.0.0');

// Register command groups
program.addCommand(sessionCommands());
program.addCommand(fleetCommands());
program.addCommand(safetyCommands());
program.addCommand(searchCommand());
program.addCommand(serveCommand());
program.addCommand(lmshCommand());
program.addCommand(tmuxCommands());

program.parse();
