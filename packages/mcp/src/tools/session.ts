/**
 * Session Tool Definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const sessionTools: Tool[] = [
  {
    name: 'session_list',
    description: 'List all sessions with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Filter by project path',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of sessions to return',
          default: 20,
        },
        offset: {
          type: 'number',
          description: 'Number of sessions to skip',
          default: 0,
        },
        orderBy: {
          type: 'string',
          enum: ['created_at', 'last_accessed'],
          description: 'Sort order',
          default: 'last_accessed',
        },
      },
    },
  },
  {
    name: 'session_get',
    description: 'Get a session by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Session ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'session_search',
    description: 'Search sessions by content',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        projectPath: {
          type: 'string',
          description: 'Filter by project path',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results',
          default: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'session_resume',
    description: 'Resume a session with optional trimming strategy',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Session ID to resume',
        },
        strategy: {
          type: 'string',
          enum: ['full', 'smart-trim', 'summary-only', 'recent'],
          description: 'Resume strategy',
          default: 'smart-trim',
        },
        maxMessages: {
          type: 'number',
          description: 'Maximum messages to include',
          default: 50,
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens to include',
          default: 100000,
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'session_export',
    description: 'Export a session to a file format',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Session ID to export',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'json', 'html', 'txt'],
          description: 'Export format',
          default: 'markdown',
        },
        includeMetadata: {
          type: 'boolean',
          description: 'Include session metadata',
          default: true,
        },
        includeTimestamps: {
          type: 'boolean',
          description: 'Include message timestamps',
          default: false,
        },
      },
      required: ['id'],
    },
  },
];
