/**
 * Fleet Tool Definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const fleetTools: Tool[] = [
  {
    name: 'team_spawn',
    description: 'Spawn a new worker agent',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Unique handle for the worker',
        },
        role: {
          type: 'string',
          enum: ['coordinator', 'worker', 'scout', 'kraken', 'oracle', 'critic', 'architect', 'merger', 'monitor', 'notifier'],
          description: 'Worker role',
          default: 'worker',
        },
        prompt: {
          type: 'string',
          description: 'Initial prompt/task for the worker',
        },
        worktree: {
          type: 'boolean',
          description: 'Create a git worktree for isolation',
          default: true,
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'team_dismiss',
    description: 'Dismiss a worker',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle to dismiss',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'team_workers',
    description: 'List all workers',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'ready', 'busy', 'error', 'dismissed'],
          description: 'Filter by status',
        },
        role: {
          type: 'string',
          description: 'Filter by role',
        },
      },
    },
  },
  {
    name: 'team_status',
    description: 'Get fleet status overview',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'team_broadcast',
    description: 'Broadcast a message to all workers',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Message to broadcast',
        },
        from: {
          type: 'string',
          description: 'Sender handle',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'team_send',
    description: 'Send a message to a specific worker',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient worker handle',
        },
        message: {
          type: 'string',
          description: 'Message body',
        },
        from: {
          type: 'string',
          description: 'Sender handle',
        },
        subject: {
          type: 'string',
          description: 'Message subject',
        },
      },
      required: ['to', 'message', 'from'],
    },
  },
  {
    name: 'team_handoff',
    description: 'Hand off context to another worker',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Source worker handle',
        },
        to: {
          type: 'string',
          description: 'Target worker handle',
        },
        context: {
          type: 'object',
          description: 'Context to transfer',
        },
      },
      required: ['from', 'to', 'context'],
    },
  },
  {
    name: 'team_tasks',
    description: 'List tasks',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'Filter by status',
        },
        assignedTo: {
          type: 'string',
          description: 'Filter by assigned worker',
        },
        limit: {
          type: 'number',
          description: 'Maximum results',
          default: 50,
        },
      },
    },
  },
  {
    name: 'team_assign',
    description: 'Assign a task to a worker',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID',
        },
        handle: {
          type: 'string',
          description: 'Worker handle',
        },
      },
      required: ['id', 'handle'],
    },
  },
  {
    name: 'team_claim',
    description: 'Claim the next available task',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle claiming the task',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'team_complete',
    description: 'Mark a task as completed',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'blackboard_post',
    description: 'Post a message to the blackboard',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Message topic',
        },
        message: {
          type: 'string',
          description: 'Message content',
        },
        from: {
          type: 'string',
          description: 'Sender handle',
        },
        priority: {
          type: 'number',
          description: 'Message priority (higher = more important)',
          default: 0,
        },
        expiresIn: {
          type: 'number',
          description: 'Expiration time in milliseconds',
        },
      },
      required: ['topic', 'message'],
    },
  },
  {
    name: 'blackboard_read',
    description: 'Read messages from the blackboard',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Filter by topic',
        },
        since: {
          type: 'number',
          description: 'Only messages after this timestamp',
        },
        limit: {
          type: 'number',
          description: 'Maximum messages',
          default: 50,
        },
        minPriority: {
          type: 'number',
          description: 'Minimum priority level',
        },
      },
    },
  },
  {
    name: 'checkpoint_create',
    description: 'Create a checkpoint for a worker',
    inputSchema: {
      type: 'object',
      properties: {
        workerHandle: {
          type: 'string',
          description: 'Worker handle',
        },
        goal: {
          type: 'string',
          description: 'Current goal',
        },
        worked: {
          type: 'array',
          items: { type: 'string' },
          description: 'Completed items',
        },
        remaining: {
          type: 'array',
          items: { type: 'string' },
          description: 'Remaining items',
        },
        context: {
          type: 'object',
          description: 'Additional context',
        },
      },
      required: ['workerHandle', 'goal'],
    },
  },
  {
    name: 'checkpoint_get',
    description: 'Get the latest checkpoint for a worker',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'checkpoint_list',
    description: 'List checkpoints',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum results',
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Skip count',
          default: 0,
        },
      },
    },
  },
];
