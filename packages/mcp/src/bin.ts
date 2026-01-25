#!/usr/bin/env node
/**
 * MCP Server CLI Entry Point
 */

import { createServer } from './server.js';

const server = createServer();

// Handle stdio transport
server.start().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
