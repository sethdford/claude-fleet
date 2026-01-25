/**
 * Safety Tool Definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const safetyTools: Tool[] = [
  {
    name: 'safety_check',
    description: 'Check if an operation is safe to execute',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['bash_command', 'file_read', 'file_write', 'file_delete', 'git_commit', 'env_access'],
          description: 'Type of operation',
        },
        command: {
          type: 'string',
          description: 'Command to check (for bash_command)',
        },
        filePath: {
          type: 'string',
          description: 'File path (for file operations)',
        },
        content: {
          type: 'string',
          description: 'Content (for file_write)',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'safety_status',
    description: 'Get safety system status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'safety_enable',
    description: 'Enable a safety hook',
    inputSchema: {
      type: 'object',
      properties: {
        hookId: {
          type: 'string',
          description: 'Hook ID to enable',
        },
      },
      required: ['hookId'],
    },
  },
  {
    name: 'safety_disable',
    description: 'Disable a safety hook',
    inputSchema: {
      type: 'object',
      properties: {
        hookId: {
          type: 'string',
          description: 'Hook ID to disable',
        },
      },
      required: ['hookId'],
    },
  },
];
