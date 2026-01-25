/**
 * Mail Tool Definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const mailTools: Tool[] = [
  {
    name: 'mail_send',
    description: 'Send a message to a worker',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Sender handle',
        },
        to: {
          type: 'string',
          description: 'Recipient handle',
        },
        subject: {
          type: 'string',
          description: 'Message subject',
        },
        body: {
          type: 'string',
          description: 'Message body',
        },
      },
      required: ['from', 'to', 'body'],
    },
  },
  {
    name: 'mail_read',
    description: 'Read messages for a worker',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle',
        },
        unreadOnly: {
          type: 'boolean',
          description: 'Only show unread messages',
          default: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum messages',
          default: 50,
        },
      },
      required: ['handle'],
    },
  },
];
