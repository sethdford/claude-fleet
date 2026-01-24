#!/usr/bin/env node
/**
 * Claude Fleet Server - Entry Point
 *
 * Multi-agent fleet coordination and worker orchestration for Claude Code instances.
 */

import { CollabServer } from './server.js';

const server = new CollabServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SERVER] Shutting down...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[SERVER] Received SIGTERM, shutting down...');
  await server.stop();
  process.exit(0);
});

// Start the server
server.start().catch((err) => {
  console.error('[SERVER] Failed to start:', err);
  process.exit(1);
});
