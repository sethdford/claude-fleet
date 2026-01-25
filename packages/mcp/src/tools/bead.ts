/**
 * Bead Tool Definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const beadTools: Tool[] = [
  {
    name: 'bead_create',
    description: 'Create a new work bead',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Bead title',
        },
        description: {
          type: 'string',
          description: 'Detailed description',
        },
        convoyId: {
          type: 'string',
          description: 'Convoy to add the bead to',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'bead_list',
    description: 'List beads',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'Filter by status',
        },
        convoyId: {
          type: 'string',
          description: 'Filter by convoy',
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
    name: 'bead_update',
    description: 'Update bead status',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Bead ID',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'New status',
        },
        actor: {
          type: 'string',
          description: 'Who is making the update',
        },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'convoy_create',
    description: 'Create a convoy to group beads',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Convoy name',
        },
        description: {
          type: 'string',
          description: 'Convoy description',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'convoy_dispatch',
    description: 'Dispatch all beads in a convoy to a worker',
    inputSchema: {
      type: 'object',
      properties: {
        convoyId: {
          type: 'string',
          description: 'Convoy ID',
        },
        handle: {
          type: 'string',
          description: 'Worker handle to assign to',
        },
      },
      required: ['convoyId', 'handle'],
    },
  },
];
