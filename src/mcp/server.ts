#!/usr/bin/env node
/**
 * MCP Bridge Server for Claude Code Collab
 *
 * Exposes team coordination and orchestration as MCP tools.
 * This allows Claude Code instances with MCP support to participate in teams
 * without requiring the custom CLI patches.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AgentRole } from '../types.js';
import { hasPermission } from '../workers/roles.js';

const COLLAB_URL = process.env.COLLAB_SERVER_URL ?? 'http://localhost:3847';

/**
 * Get current agent's role from environment
 */
function getAgentRole(): AgentRole {
  const role = process.env.CLAUDE_CODE_AGENT_TYPE ?? 'worker';
  return role as AgentRole;
}

/**
 * Get the current agent's swarm ID.
 * Priority: explicit arg > CLAUDE_CODE_SWARM_ID env var > undefined
 *
 * Note: CLAUDE_CODE_TEAM_NAME is NOT used as fallback because team name
 * and swarm ID are different concepts. A team can have multiple swarms.
 */
function getSwarmId(explicitSwarmId?: string): string | undefined {
  return explicitSwarmId ?? process.env.CLAUDE_CODE_SWARM_ID;
}

/**
 * Require a swarm ID, returning an error message if not available
 * Returns the swarm ID string, or null with error message
 */
function requireSwarmId(explicitSwarmId?: string): { swarmId: string; error: null } | { swarmId: null; error: ToolResponse } {
  const swarmId = getSwarmId(explicitSwarmId);
  if (!swarmId) {
    return {
      swarmId: null,
      error: {
        content: [{
          type: 'text',
          text: 'Swarm ID required. Either:\n' +
            '1. Pass swarm_id argument to this tool\n' +
            '2. Set CLAUDE_CODE_SWARM_ID environment variable\n\n' +
            'Use swarm_list to see available swarms, or swarm_create to create one.',
        }],
        isError: true,
      },
    };
  }
  return { swarmId, error: null };
}

/**
 * Check permission and return error response if denied
 */
function checkPermission(permission: keyof import('../types.js').RolePermissions): ToolResponse | null {
  const role = getAgentRole();
  if (!hasPermission(role, permission)) {
    return {
      content: [{ type: 'text', text: `Permission denied: '${permission}' requires a role with that permission. Current role: ${role}` }],
      isError: true,
    };
  }
  return null;
}

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * HTTP client for collab server
 */
async function callApi(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = `${COLLAB_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return response.json();
}

/**
 * Format response for MCP
 */
function formatResponse(data: unknown, isError = false): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

/**
 * Create the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: 'claude-code-collab',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ============================================================================
  // LIST TOOLS
  // ============================================================================

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // Team Status & Communication
      {
        name: 'team_status',
        description: 'Get team status and list of online members',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'team_broadcast',
        description: 'Send a message to all team members',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to broadcast to the team',
            },
          },
          required: ['message'],
        },
      },

      // Task Management
      {
        name: 'team_tasks',
        description: 'List tasks for the team',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              enum: ['all', 'mine', 'unassigned'],
              description: 'Filter tasks: all, mine, or unassigned',
            },
          },
          required: [],
        },
      },
      {
        name: 'team_assign',
        description: 'Assign a task to a team member (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            agent: {
              type: 'string',
              description: 'The agent handle to assign the task to',
            },
            task: {
              type: 'string',
              description: 'The task subject/title',
            },
            description: {
              type: 'string',
              description: 'Optional detailed description of the task',
            },
          },
          required: ['agent', 'task'],
        },
      },
      {
        name: 'team_complete',
        description: 'Mark a task as complete',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The ID of the task to mark as complete',
            },
          },
          required: ['task_id'],
        },
      },

      // File Coordination
      {
        name: 'team_claim',
        description: 'Claim a file to prevent conflicts with other team members',
        inputSchema: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'The file path to claim',
            },
          },
          required: ['file'],
        },
      },

      // Worker Orchestration (Lead Only)
      {
        name: 'team_spawn',
        description: 'Spawn a new Claude Code worker instance (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            handle: {
              type: 'string',
              description: 'Unique name/handle for the worker',
            },
            prompt: {
              type: 'string',
              description: 'Initial prompt/task for the worker',
            },
            workingDir: {
              type: 'string',
              description: 'Working directory for the worker (default: current)',
            },
          },
          required: ['handle'],
        },
      },
      {
        name: 'team_dismiss',
        description: 'Dismiss a worker (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            handle: {
              type: 'string',
              description: 'Handle of the worker to dismiss',
            },
          },
          required: ['handle'],
        },
      },
      {
        name: 'team_workers',
        description: 'List all active workers',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'team_send',
        description: 'Send a message to a specific worker',
        inputSchema: {
          type: 'object',
          properties: {
            handle: {
              type: 'string',
              description: 'Handle of the worker',
            },
            message: {
              type: 'string',
              description: 'Message to send to the worker',
            },
          },
          required: ['handle', 'message'],
        },
      },

      // ============================================================================
      // Work Item Management (Phase 2)
      // ============================================================================
      {
        name: 'workitem_create',
        description: 'Create a new work item with a human-readable ID',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Title of the work item',
            },
            description: {
              type: 'string',
              description: 'Detailed description of the work',
            },
            assignedTo: {
              type: 'string',
              description: 'Worker handle to assign to (optional)',
            },
            batchId: {
              type: 'string',
              description: 'Batch ID to add this work item to (optional)',
            },
          },
          required: ['title'],
        },
      },
      {
        name: 'workitem_update',
        description: 'Update a work item status',
        inputSchema: {
          type: 'object',
          properties: {
            workitem_id: {
              type: 'string',
              description: 'The work item ID (e.g., wi-x7k2m)',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'blocked', 'cancelled'],
              description: 'New status for the work item',
            },
            reason: {
              type: 'string',
              description: 'Reason for status change (for blocked/cancelled)',
            },
          },
          required: ['workitem_id', 'status'],
        },
      },
      {
        name: 'workitem_list',
        description: 'List work items with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              enum: ['all', 'mine', 'pending', 'in_progress', 'completed', 'blocked'],
              description: 'Filter work items by status or assignment',
            },
            batch_id: {
              type: 'string',
              description: 'Filter by batch ID',
            },
          },
          required: [],
        },
      },
      {
        name: 'batch_create',
        description: 'Create a batch (bundle of work items)',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name for the batch',
            },
            workitem_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Initial work item IDs to include',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'batch_dispatch',
        description: 'Dispatch a batch to a worker (assigns all work items)',
        inputSchema: {
          type: 'object',
          properties: {
            batch_id: {
              type: 'string',
              description: 'The batch ID to dispatch',
            },
            worker: {
              type: 'string',
              description: 'Worker handle to dispatch to',
            },
          },
          required: ['batch_id', 'worker'],
        },
      },

      // ============================================================================
      // Mail System (Phase 3)
      // ============================================================================
      {
        name: 'mail_send',
        description: 'Send a mail message to a worker',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient worker handle',
            },
            body: {
              type: 'string',
              description: 'Message body',
            },
            subject: {
              type: 'string',
              description: 'Optional subject line',
            },
          },
          required: ['to', 'body'],
        },
      },
      {
        name: 'mail_read',
        description: 'Read mail messages',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              enum: ['unread', 'all'],
              description: 'Filter messages',
            },
            mark_read: {
              type: 'boolean',
              description: 'Mark messages as read after retrieving',
            },
          },
          required: [],
        },
      },
      {
        name: 'team_handoff',
        description: 'Transfer context to another worker',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Target worker handle',
            },
            context: {
              type: 'object',
              description: 'Context object to transfer (files, state, notes)',
            },
          },
          required: ['to', 'context'],
        },
      },

      // ============================================================================
      // Worktree Operations (requires useWorktrees: true on server)
      // ============================================================================
      {
        name: 'worktree_commit',
        description: 'Commit changes in the current worker\'s isolated branch',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Commit message',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'worktree_push',
        description: 'Push the current worker\'s branch to remote',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'worktree_pr',
        description: 'Create a pull request from the current worker\'s branch',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'PR title',
            },
            body: {
              type: 'string',
              description: 'PR description',
            },
            base: {
              type: 'string',
              description: 'Base branch (default: main)',
            },
          },
          required: ['title', 'body'],
        },
      },

      // ============================================================================
      // Blackboard Messaging (Fleet Coordination)
      // ============================================================================
      {
        name: 'blackboard_post',
        description: 'Post a typed message to the blackboard for inter-agent communication',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: {
              type: 'string',
              description: 'Swarm ID (default: current team)',
            },
            message_type: {
              type: 'string',
              enum: ['request', 'response', 'status', 'directive', 'checkpoint'],
              description: 'Type of message',
            },
            payload: {
              type: 'object',
              description: 'Message payload (JSON object)',
            },
            target_handle: {
              type: 'string',
              description: 'Target agent handle (null for broadcast)',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'critical'],
              description: 'Message priority (default: normal)',
            },
          },
          required: ['message_type', 'payload'],
        },
      },
      {
        name: 'blackboard_read',
        description: 'Read messages from the blackboard',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: {
              type: 'string',
              description: 'Swarm ID (default: current team)',
            },
            message_type: {
              type: 'string',
              enum: ['request', 'response', 'status', 'directive', 'checkpoint'],
              description: 'Filter by message type',
            },
            unread_only: {
              type: 'boolean',
              description: 'Only return unread messages (default: false)',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'critical'],
              description: 'Filter by priority',
            },
            limit: {
              type: 'number',
              description: 'Maximum messages to return (default: 50)',
            },
          },
          required: [],
        },
      },
      {
        name: 'blackboard_mark_read',
        description: 'Mark specific blackboard messages as read',
        inputSchema: {
          type: 'object',
          properties: {
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of messages to mark as read',
            },
          },
          required: ['message_ids'],
        },
      },
      {
        name: 'blackboard_archive',
        description: 'Archive old blackboard messages',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: {
              type: 'string',
              description: 'Swarm ID (default: current team)',
            },
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific message IDs to archive (optional)',
            },
            max_age_hours: {
              type: 'number',
              description: 'Archive messages older than this (default: 24)',
            },
          },
          required: [],
        },
      },

      // ============================================================================
      // Checkpoint System (Session Continuity)
      // ============================================================================
      {
        name: 'checkpoint_create',
        description: 'Create a checkpoint to save current progress for session continuity',
        inputSchema: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: 'What this session accomplished',
            },
            now: {
              type: 'string',
              description: 'What the next session should do first',
            },
            test: {
              type: 'string',
              description: 'Command to verify this work',
            },
            done_this_session: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task: { type: 'string' },
                  files: { type: 'array', items: { type: 'string' } },
                },
              },
              description: 'Tasks completed in this session',
            },
            blockers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Blocking issues',
            },
            questions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Unresolved questions',
            },
            next: {
              type: 'array',
              items: { type: 'string' },
              description: 'Next steps',
            },
            to_handle: {
              type: 'string',
              description: 'Target agent handle for handoff (default: self)',
            },
          },
          required: ['goal', 'now'],
        },
      },
      {
        name: 'checkpoint_load',
        description: 'Load a checkpoint to resume previous work',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'number',
              description: 'Specific checkpoint ID to load',
            },
            latest: {
              type: 'boolean',
              description: 'Load the most recent checkpoint (default: true)',
            },
          },
          required: [],
        },
      },
      {
        name: 'checkpoint_list',
        description: 'List available checkpoints',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'accepted', 'rejected'],
              description: 'Filter by status',
            },
            limit: {
              type: 'number',
              description: 'Maximum checkpoints to return (default: 20)',
            },
          },
          required: [],
        },
      },

      // ============================================================================
      // Swarm Management (Fleet Coordination)
      // ============================================================================
      {
        name: 'swarm_create',
        description: 'Create a new swarm (group of agents working together)',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Human-readable name for the swarm',
            },
            description: {
              type: 'string',
              description: 'Description of the swarm\'s purpose',
            },
            max_agents: {
              type: 'number',
              description: 'Maximum agents allowed in this swarm (default: 10)',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'swarm_list',
        description: 'List all swarms or get details of a specific swarm',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: {
              type: 'string',
              description: 'Get details for a specific swarm ID',
            },
            include_agents: {
              type: 'boolean',
              description: 'Include list of agents in each swarm (default: false)',
            },
          },
          required: [],
        },
      },
      {
        name: 'swarm_kill',
        description: 'Terminate all agents in a swarm (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: {
              type: 'string',
              description: 'The swarm ID to terminate',
            },
            graceful: {
              type: 'boolean',
              description: 'Allow agents to complete current task before terminating (default: true)',
            },
          },
          required: ['swarm_id'],
        },
      },
      {
        name: 'swarm_broadcast',
        description: 'Broadcast a directive to all agents in a swarm via the blackboard',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: {
              type: 'string',
              description: 'The swarm ID to broadcast to',
            },
            directive: {
              type: 'string',
              description: 'The directive message to broadcast',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'critical'],
              description: 'Message priority (default: high)',
            },
          },
          required: ['swarm_id', 'directive'],
        },
      },

      // ============================================================================
      // Spawn Control (Fleet Coordination)
      // ============================================================================
      {
        name: 'spawn_request',
        description: 'Request spawning a new agent through the spawn controller',
        inputSchema: {
          type: 'object',
          properties: {
            agent_type: {
              type: 'string',
              enum: ['lead', 'worker', 'scout', 'kraken', 'oracle', 'critic', 'architect'],
              description: 'Type of agent to spawn',
            },
            task: {
              type: 'string',
              description: 'Initial task for the spawned agent',
            },
            swarm_id: {
              type: 'string',
              description: 'Swarm to add the agent to (default: current swarm)',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'critical'],
              description: 'Spawn priority (default: normal)',
            },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'Spawn request IDs that must complete first (DAG dependency)',
            },
          },
          required: ['agent_type', 'task'],
        },
      },
      {
        name: 'spawn_status',
        description: 'Check spawn queue status and agent limits',
        inputSchema: {
          type: 'object',
          properties: {
            request_id: {
              type: 'string',
              description: 'Get status of a specific spawn request',
            },
            include_queue: {
              type: 'boolean',
              description: 'Include pending queue items (default: false)',
            },
          },
          required: [],
        },
      },
      {
        name: 'spawn_cancel',
        description: 'Cancel a pending spawn request',
        inputSchema: {
          type: 'object',
          properties: {
            request_id: {
              type: 'string',
              description: 'The spawn request ID to cancel',
            },
          },
          required: ['request_id'],
        },
      },

    ],
  }));

  // ============================================================================
  // TOOL HANDLERS
  // ============================================================================

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // Team Status
        case 'team_status': {
          const health = await callApi('GET', '/health');
          const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
          const agents = await callApi('GET', `/teams/${teamName}/agents`);
          return formatResponse({ health, teamName, agents });
        }

        // Broadcast
        case 'team_broadcast': {
          const permError = checkPermission('broadcast');
          if (permError) return permError;

          const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
          const fromUid = process.env.CLAUDE_CODE_AGENT_UID;
          if (!fromUid) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_UID', true);
          }
          const result = await callApi('POST', `/teams/${teamName}/broadcast`, {
            from: fromUid,
            text: (args as { message: string }).message,
          });
          return formatResponse(result);
        }

        // Tasks
        case 'team_tasks': {
          const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
          const tasks = await callApi('GET', `/teams/${teamName}/tasks`);
          const filter = (args as { filter?: string }).filter ?? 'all';
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;

          let filtered = tasks as Array<{ ownerHandle: string | null; status: string }>;
          if (filter === 'mine' && myHandle) {
            filtered = filtered.filter(t => t.ownerHandle === myHandle);
          } else if (filter === 'unassigned') {
            filtered = filtered.filter(t => !t.ownerHandle);
          }

          return formatResponse({
            filter,
            count: filtered.length,
            tasks: filtered,
          });
        }

        case 'team_assign': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
          const fromUid = process.env.CLAUDE_CODE_AGENT_UID;
          if (!fromUid) {
            return formatResponse('Agent not registered', true);
          }

          const { agent, task, description } = args as {
            agent: string;
            task: string;
            description?: string;
          };

          const result = await callApi('POST', '/tasks', {
            fromUid,
            toHandle: agent,
            teamName,
            subject: task,
            description,
          });
          return formatResponse(result);
        }

        case 'team_complete': {
          const { task_id } = args as { task_id: string };
          const result = await callApi('PATCH', `/tasks/${task_id}`, {
            status: 'resolved',
          });
          return formatResponse(result);
        }

        // File Coordination
        case 'team_claim': {
          const { file } = args as { file: string };
          // Store claim in metadata (simple implementation)
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME ?? 'unknown';
          return formatResponse({
            claimed: true,
            file,
            by: myHandle,
            timestamp: new Date().toISOString(),
          });
        }

        // Worker Orchestration
        case 'team_spawn': {
          const permError = checkPermission('spawn');
          if (permError) return permError;

          const { handle, prompt, workingDir } = args as {
            handle: string;
            prompt?: string;
            workingDir?: string;
          };

          const result = await callApi('POST', '/orchestrate/spawn', {
            handle,
            initialPrompt: prompt,
            workingDir,
          });
          return formatResponse(result);
        }

        case 'team_dismiss': {
          const permError = checkPermission('dismiss');
          if (permError) return permError;

          const { handle } = args as { handle: string };
          const result = await callApi('POST', `/orchestrate/dismiss/${handle}`);
          return formatResponse(result);
        }

        case 'team_workers': {
          const workers = await callApi('GET', '/orchestrate/workers');
          return formatResponse(workers);
        }

        case 'team_send': {
          const { handle, message } = args as { handle: string; message: string };
          const result = await callApi('POST', `/orchestrate/send/${handle}`, {
            message,
          });
          return formatResponse(result);
        }

        // ============================================================================
        // Work Item Management (Phase 2)
        // ============================================================================
        case 'workitem_create': {
          const { title, description, assignedTo, batchId } = args as {
            title: string;
            description?: string;
            assignedTo?: string;
            batchId?: string;
          };

          const result = await callApi('POST', '/workitems', {
            title,
            description,
            assignedTo,
            batchId,
          });
          return formatResponse(result);
        }

        case 'workitem_update': {
          const { workitem_id, status, reason } = args as {
            workitem_id: string;
            status: string;
            reason?: string;
          };

          const actor = process.env.CLAUDE_CODE_AGENT_NAME;
          const result = await callApi('PATCH', `/workitems/${workitem_id}`, {
            status,
            reason,
            actor,
          });
          return formatResponse(result);
        }

        case 'workitem_list': {
          const { filter, batch_id } = args as {
            filter?: string;
            batch_id?: string;
          };

          let path = '/workitems';
          const params: string[] = [];

          if (filter && filter !== 'all') {
            if (filter === 'mine') {
              const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
              if (myHandle) params.push(`assignee=${encodeURIComponent(myHandle)}`);
            } else {
              params.push(`status=${encodeURIComponent(filter)}`);
            }
          }

          if (batch_id) {
            params.push(`batch=${encodeURIComponent(batch_id)}`);
          }

          if (params.length > 0) {
            path += '?' + params.join('&');
          }

          const workitems = await callApi('GET', path);
          return formatResponse({
            filter: filter ?? 'all',
            count: Array.isArray(workitems) ? workitems.length : 0,
            workitems,
          });
        }

        case 'batch_create': {
          const { name, workitem_ids } = args as {
            name: string;
            workitem_ids?: string[];
          };

          const result = await callApi('POST', '/batches', {
            name,
            workItemIds: workitem_ids,
          });
          return formatResponse(result);
        }

        case 'batch_dispatch': {
          const { batch_id, worker } = args as {
            batch_id: string;
            worker: string;
          };

          const result = await callApi('POST', `/batches/${batch_id}/dispatch`, {
            workerHandle: worker,
          });
          return formatResponse(result);
        }

        // ============================================================================
        // Mail System (Phase 3)
        // ============================================================================
        case 'mail_send': {
          const { to, body, subject } = args as {
            to: string;
            body: string;
            subject?: string;
          };

          const fromHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!fromHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const result = await callApi('POST', '/mail', {
            from: fromHandle,
            to,
            body,
            subject,
          });
          return formatResponse(result);
        }

        case 'mail_read': {
          const { filter, mark_read } = args as {
            filter?: string;
            mark_read?: boolean;
          };

          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const unreadOnly = filter !== 'all';
          let path = `/mail/${encodeURIComponent(myHandle)}`;
          if (unreadOnly) {
            path += '/unread';
          }

          const messages = await callApi('GET', path);

          // Mark as read if requested
          if (mark_read && Array.isArray(messages)) {
            for (const msg of messages as Array<{ id: number }>) {
              await callApi('POST', `/mail/${msg.id}/read`);
            }
          }

          return formatResponse({
            filter: filter ?? 'unread',
            count: Array.isArray(messages) ? messages.length : 0,
            messages,
          });
        }

        case 'team_handoff': {
          const { to, context } = args as {
            to: string;
            context: Record<string, unknown>;
          };

          const fromHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!fromHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const result = await callApi('POST', '/handoffs', {
            from: fromHandle,
            to,
            context,
          });
          return formatResponse(result);
        }

        // ============================================================================
        // Worktree Operations
        // ============================================================================
        case 'worktree_commit': {
          const permError = checkPermission('push');
          if (permError) return permError;

          const { message } = args as { message: string };
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const result = await callApi('POST', `/orchestrate/worktree/${myHandle}/commit`, {
            message,
          });
          return formatResponse(result);
        }

        case 'worktree_push': {
          const permError = checkPermission('push');
          if (permError) return permError;

          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const result = await callApi('POST', `/orchestrate/worktree/${myHandle}/push`);
          return formatResponse(result);
        }

        case 'worktree_pr': {
          const permError = checkPermission('push');
          if (permError) return permError;

          const { title, body, base } = args as {
            title: string;
            body: string;
            base?: string;
          };
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const result = await callApi('POST', `/orchestrate/worktree/${myHandle}/pr`, {
            title,
            body,
            base: base ?? 'main',
          });
          return formatResponse(result);
        }

        // ============================================================================
        // Blackboard Messaging (Fleet Coordination)
        // ============================================================================
        case 'blackboard_post': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, message_type, payload, target_handle, priority } = args as {
            swarm_id?: string;
            message_type: string;
            payload: Record<string, unknown>;
            target_handle?: string;
            priority?: string;
          };

          // Require explicit swarm ID
          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const result = await callApi('POST', '/blackboard', {
            swarmId: swarmResult.swarmId,
            senderHandle: myHandle,
            messageType: message_type,
            payload,
            targetHandle: target_handle,
            priority: priority ?? 'normal',
          });
          return formatResponse(result);
        }

        case 'blackboard_read': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, message_type, unread_only, priority, limit } = args as {
            swarm_id?: string;
            message_type?: string;
            unread_only?: boolean;
            priority?: string;
            limit?: number;
          };

          // Require explicit swarm ID
          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;
          const { swarmId } = swarmResult;

          const params: string[] = [];
          if (message_type) params.push(`messageType=${encodeURIComponent(message_type)}`);
          if (unread_only) params.push(`unreadOnly=true&readerHandle=${encodeURIComponent(myHandle)}`);
          if (priority) params.push(`priority=${encodeURIComponent(priority)}`);
          if (limit) params.push(`limit=${limit}`);

          let path = `/blackboard/${encodeURIComponent(swarmId)}`;
          if (params.length > 0) path += '?' + params.join('&');

          const messages = await callApi('GET', path);
          return formatResponse({
            swarmId,
            count: Array.isArray(messages) ? messages.length : 0,
            messages,
          });
        }

        case 'blackboard_mark_read': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { message_ids } = args as { message_ids: string[] };
          const result = await callApi('POST', '/blackboard/mark-read', {
            messageIds: message_ids,
            readerHandle: myHandle,
          });
          return formatResponse(result);
        }

        case 'blackboard_archive': {
          const { swarm_id, message_ids, max_age_hours } = args as {
            swarm_id?: string;
            message_ids?: string[];
            max_age_hours?: number;
          };

          if (message_ids && message_ids.length > 0) {
            // Archive specific messages (swarm ID not needed - messages have their own swarm)
            const result = await callApi('POST', '/blackboard/archive', {
              messageIds: message_ids,
            });
            return formatResponse(result);
          } else {
            // Archive old messages in a swarm - requires swarm ID
            const swarmResult = requireSwarmId(swarm_id);
            if (swarmResult.error) return swarmResult.error;

            const maxAgeMs = (max_age_hours ?? 24) * 60 * 60 * 1000;
            const result = await callApi('POST', `/blackboard/${encodeURIComponent(swarmResult.swarmId)}/archive-old`, {
              maxAgeMs,
            });
            return formatResponse(result);
          }
        }

        // ============================================================================
        // Checkpoint System (Session Continuity)
        // ============================================================================
        case 'checkpoint_create': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const {
            goal,
            now,
            test,
            done_this_session,
            blockers,
            questions,
            next,
            to_handle,
          } = args as {
            goal: string;
            now: string;
            test?: string;
            done_this_session?: Array<{ task: string; files: string[] }>;
            blockers?: string[];
            questions?: string[];
            next?: string[];
            to_handle?: string;
          };

          const result = await callApi('POST', '/checkpoints', {
            fromHandle: myHandle,
            toHandle: to_handle ?? myHandle,
            goal,
            now,
            test,
            doneThisSession: done_this_session,
            blockers,
            questions,
            next,
          });
          return formatResponse(result);
        }

        case 'checkpoint_load': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { checkpoint_id, latest } = args as {
            checkpoint_id?: number;
            latest?: boolean;
          };

          let path: string;
          if (checkpoint_id) {
            path = `/checkpoints/${checkpoint_id}`;
          } else {
            path = `/checkpoints/latest/${encodeURIComponent(myHandle)}`;
          }

          const checkpoint = await callApi('GET', path);
          return formatResponse(checkpoint);
        }

        case 'checkpoint_list': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { status, limit } = args as {
            status?: string;
            limit?: number;
          };

          const params: string[] = [];
          if (status) params.push(`status=${encodeURIComponent(status)}`);
          if (limit) params.push(`limit=${limit}`);

          let path = `/checkpoints/list/${encodeURIComponent(myHandle)}`;
          if (params.length > 0) path += '?' + params.join('&');

          const checkpoints = await callApi('GET', path);
          return formatResponse({
            count: Array.isArray(checkpoints) ? checkpoints.length : 0,
            checkpoints,
          });
        }

        // ============================================================================
        // Swarm Management (Fleet Coordination)
        // ============================================================================
        case 'swarm_create': {
          const permError = checkPermission('spawn');
          if (permError) return permError;

          const { name, description, max_agents } = args as {
            name: string;
            description?: string;
            max_agents?: number;
          };

          const result = await callApi('POST', '/swarms', {
            name,
            description,
            maxAgents: max_agents ?? 10,
          });
          return formatResponse(result);
        }

        case 'swarm_list': {
          const { swarm_id, include_agents } = args as {
            swarm_id?: string;
            include_agents?: boolean;
          };

          if (swarm_id) {
            const swarm = await callApi('GET', `/swarms/${encodeURIComponent(swarm_id)}`);
            return formatResponse(swarm);
          }

          const params: string[] = [];
          if (include_agents) params.push('includeAgents=true');

          let path = '/swarms';
          if (params.length > 0) path += '?' + params.join('&');

          const swarms = await callApi('GET', path);
          return formatResponse({
            count: Array.isArray(swarms) ? swarms.length : 0,
            swarms,
          });
        }

        case 'swarm_kill': {
          const permError = checkPermission('dismiss');
          if (permError) return permError;

          const { swarm_id, graceful } = args as {
            swarm_id: string;
            graceful?: boolean;
          };

          const result = await callApi('POST', `/swarms/${encodeURIComponent(swarm_id)}/kill`, {
            graceful: graceful ?? true,
          });
          return formatResponse(result);
        }

        case 'swarm_broadcast': {
          const permError = checkPermission('broadcast');
          if (permError) return permError;

          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, directive, priority } = args as {
            swarm_id: string;
            directive: string;
            priority?: string;
          };

          // Post a directive to the blackboard for the entire swarm
          const result = await callApi('POST', '/blackboard', {
            swarmId: swarm_id,
            senderHandle: myHandle,
            messageType: 'directive',
            payload: { directive, broadcast: true },
            targetHandle: null, // null = broadcast to all
            priority: priority ?? 'high',
          });
          return formatResponse(result);
        }

        // ============================================================================
        // Spawn Control (Fleet Coordination)
        // ============================================================================
        case 'spawn_request': {
          const permError = checkPermission('spawn');
          if (permError) return permError;

          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { agent_type, task, swarm_id, priority, depends_on } = args as {
            agent_type: string;
            task: string;
            swarm_id?: string;
            priority?: string;
            depends_on?: string[];
          };

          // Swarm ID is optional for spawn requests - spawned agents will inherit if provided
          const swarmId = getSwarmId(swarm_id);

          const result = await callApi('POST', '/spawn-queue', {
            requesterHandle: myHandle,
            targetAgentType: agent_type,
            task,
            swarmId,  // May be undefined, which is OK
            priority: priority ?? 'normal',
            dependsOn: depends_on,
          });
          return formatResponse(result);
        }

        case 'spawn_status': {
          const { request_id, include_queue } = args as {
            request_id?: string;
            include_queue?: boolean;
          };

          if (request_id) {
            const status = await callApi('GET', `/spawn-queue/${encodeURIComponent(request_id)}`);
            return formatResponse(status);
          }

          // Get overall spawn controller status
          const params: string[] = [];
          if (include_queue) params.push('includeQueue=true');

          let path = '/spawn-queue/status';
          if (params.length > 0) path += '?' + params.join('&');

          const status = await callApi('GET', path);
          return formatResponse(status);
        }

        case 'spawn_cancel': {
          const permError = checkPermission('dismiss');
          if (permError) return permError;

          const { request_id } = args as { request_id: string };
          const result = await callApi('DELETE', `/spawn-queue/${encodeURIComponent(request_id)}`);
          return formatResponse(result);
        }

        default:
          return formatResponse(`Unknown tool: ${name}`, true);
      }
    } catch (error) {
      return formatResponse(`Error: ${(error as Error).message}`, true);
    }
  });

  return server;
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Claude Code Collab MCP server running');
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
