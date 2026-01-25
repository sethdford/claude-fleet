#!/usr/bin/env node
/**
 * MCP Bridge Server for Claude Fleet
 *
 * Exposes fleet coordination and orchestration as MCP tools.
 * This allows Claude Code instances with MCP support to participate in teams
 * and swarms without requiring custom CLI patches.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AgentRole } from '../types.js';
import { hasPermission } from '../workers/roles.js';

const COLLAB_URL = process.env.CLAUDE_FLEET_URL ?? process.env.COLLAB_SERVER_URL ?? 'http://localhost:3847';

// Cached auth token
let authToken: string | null = null;
let authTokenExpiry: number = 0;

/**
 * Get current agent's role from environment
 */
function getAgentRole(): AgentRole {
  const role = process.env.CLAUDE_CODE_AGENT_TYPE ?? 'worker';
  return role as AgentRole;
}

/**
 * Get or refresh authentication token
 */
async function getAuthToken(): Promise<string | null> {
  // Return cached token if still valid (with 5 min buffer)
  if (authToken && Date.now() < authTokenExpiry - 5 * 60 * 1000) {
    return authToken;
  }

  const handle = process.env.CLAUDE_CODE_AGENT_NAME;
  const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
  const agentType = process.env.CLAUDE_CODE_AGENT_TYPE ?? 'worker';

  if (!handle) {
    console.error('[MCP] Cannot authenticate: CLAUDE_CODE_AGENT_NAME not set');
    return null;
  }

  try {
    const response = await fetch(`${COLLAB_URL}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, teamName, agentType }),
    });

    if (!response.ok) {
      console.error('[MCP] Authentication failed:', response.status);
      return null;
    }

    const data = await response.json() as { token: string; uid: string };
    authToken = data.token;
    // Assume 24h expiry, cache for 23h
    authTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;

    // Store UID for other tools
    process.env.CLAUDE_CODE_AGENT_UID = data.uid;

    return authToken;
  } catch (error) {
    console.error('[MCP] Authentication error:', (error as Error).message);
    return null;
  }
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
 * HTTP client for collab server with authentication
 */
async function callApi(
  method: string,
  path: string,
  body?: unknown,
  skipAuth = false
): Promise<unknown> {
  const url = `${COLLAB_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add auth token for authenticated requests
  if (!skipAuth) {
    const token = await getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  // Handle auth errors
  if (response.status === 401 || response.status === 403) {
    // Clear cached token and retry once
    authToken = null;
    authTokenExpiry = 0;

    if (!skipAuth) {
      const retryToken = await getAuthToken();
      if (retryToken) {
        headers['Authorization'] = `Bearer ${retryToken}`;
        const retryResponse = await fetch(url, { ...options, headers });
        return retryResponse.json();
      }
    }
  }

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
      name: 'claude-fleet',
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
      // Templates (Swarm Configuration)
      // ============================================================================
      {
        name: 'template_list',
        description: 'List all available swarm templates',
        inputSchema: {
          type: 'object',
          properties: {
            builtin_only: {
              type: 'boolean',
              description: 'Only show builtin templates (default: false)',
            },
          },
          required: [],
        },
      },
      {
        name: 'template_get',
        description: 'Get details of a specific template including phases and roles',
        inputSchema: {
          type: 'object',
          properties: {
            template_id: {
              type: 'string',
              description: 'The template ID to retrieve',
            },
          },
          required: ['template_id'],
        },
      },
      {
        name: 'template_run',
        description: 'Run a template to spawn a new swarm with pre-configured agents',
        inputSchema: {
          type: 'object',
          properties: {
            template_id: {
              type: 'string',
              description: 'The template ID to run',
            },
            swarm_name: {
              type: 'string',
              description: 'Custom name for the swarm (auto-generated if not provided)',
            },
          },
          required: ['template_id'],
        },
      },

      // ============================================================================
      // Audit System (Codebase Health)
      // ============================================================================
      {
        name: 'audit_status',
        description: 'Get the current status of the codebase audit loop (running, idle, iteration count)',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'audit_output',
        description: 'Get audit output logs with pagination',
        inputSchema: {
          type: 'object',
          properties: {
            since: {
              type: 'number',
              description: 'Line number to start from (default: 0)',
            },
            limit: {
              type: 'number',
              description: 'Maximum lines to return (default: 100, max: 1000)',
            },
          },
          required: [],
        },
      },
      {
        name: 'audit_start',
        description: 'Start the codebase audit loop (typecheck, lint, tests, build)',
        inputSchema: {
          type: 'object',
          properties: {
            dry_run: {
              type: 'boolean',
              description: 'Run in dry-run mode without making changes (default: false)',
            },
            max_iterations: {
              type: 'number',
              description: 'Maximum iterations before stopping (default: unlimited)',
            },
          },
          required: [],
        },
      },
      {
        name: 'audit_stop',
        description: 'Stop the currently running audit loop',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'audit_quick',
        description: 'Run a quick one-time audit check (typecheck, lint, tests, build) without looping',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
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

      // ============================================================================
      // TLDR (Token-Efficient Code Analysis)
      // ============================================================================
      {
        name: 'tldr_get_summary',
        description: 'Get a cached summary of a file (token-efficient)',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to get summary for',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'tldr_store_summary',
        description: 'Store a file summary for future token-efficient retrieval',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file',
            },
            content_hash: {
              type: 'string',
              description: 'Hash of file content for cache invalidation',
            },
            summary: {
              type: 'string',
              description: 'Summary of the file',
            },
            exports: {
              type: 'array',
              items: { type: 'string' },
              description: 'Exported functions/classes/constants',
            },
            imports: {
              type: 'array',
              items: { type: 'string' },
              description: 'Import paths',
            },
            line_count: {
              type: 'number',
              description: 'Number of lines in the file',
            },
            language: {
              type: 'string',
              description: 'Programming language',
            },
          },
          required: ['file_path', 'content_hash', 'summary'],
        },
      },
      {
        name: 'tldr_get_codebase',
        description: 'Get a cached codebase overview (token-efficient)',
        inputSchema: {
          type: 'object',
          properties: {
            root_path: {
              type: 'string',
              description: 'Root path of the codebase',
            },
          },
          required: ['root_path'],
        },
      },
      {
        name: 'tldr_store_codebase',
        description: 'Store a codebase overview for future token-efficient retrieval',
        inputSchema: {
          type: 'object',
          properties: {
            root_path: {
              type: 'string',
              description: 'Root path of the codebase',
            },
            name: {
              type: 'string',
              description: 'Name of the codebase/project',
            },
            description: {
              type: 'string',
              description: 'Brief description of the codebase',
            },
            key_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Important files (entry points, configs)',
            },
            patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Detected patterns (MVC, microservices, etc.)',
            },
            tech_stack: {
              type: 'array',
              items: { type: 'string' },
              description: 'Languages, frameworks, tools',
            },
          },
          required: ['root_path', 'name'],
        },
      },
      {
        name: 'tldr_dependency_graph',
        description: 'Get dependency graph for files',
        inputSchema: {
          type: 'object',
          properties: {
            root_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Starting files to trace dependencies from',
            },
            depth: {
              type: 'number',
              description: 'How deep to trace dependencies (default: 3)',
            },
          },
          required: ['root_files'],
        },
      },
      {
        name: 'tldr_stats',
        description: 'Get TLDR cache statistics',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },

      // ============================================================================
      // Swarm Intelligence - Pheromones (Stigmergic Coordination)
      // ============================================================================
      {
        name: 'pheromone_deposit',
        description: 'Deposit a pheromone trail on a resource to signal activity',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            resource_type: { type: 'string', enum: ['file', 'task', 'endpoint', 'module', 'custom'], description: 'Type of resource' },
            resource_id: { type: 'string', description: 'Resource identifier (file path, task ID, etc.)' },
            trail_type: { type: 'string', enum: ['touch', 'modify', 'complete', 'error', 'warning', 'success'], description: 'Type of activity' },
            intensity: { type: 'number', description: 'Signal intensity 0-1 (default: 1.0)' },
          },
          required: ['resource_type', 'resource_id', 'trail_type'],
        },
      },
      {
        name: 'pheromone_query',
        description: 'Query pheromone trails to see where other agents have been active',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            resource_type: { type: 'string', description: 'Filter by resource type' },
            min_intensity: { type: 'number', description: 'Minimum intensity threshold' },
          },
          required: [],
        },
      },
      {
        name: 'pheromone_hot_resources',
        description: 'Get resources with high pheromone activity (hot spots)',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            resource_type: { type: 'string', description: 'Filter by resource type' },
            limit: { type: 'number', description: 'Max resources to return (default: 20)' },
          },
          required: [],
        },
      },

      // ============================================================================
      // Swarm Intelligence - Beliefs (Theory of Mind)
      // ============================================================================
      {
        name: 'belief_set',
        description: 'Record a belief about a subject (what you know or think)',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            subject: { type: 'string', description: 'What the belief is about (e.g., "auth_system_complexity")' },
            value: { type: 'string', description: 'The belief value/content' },
            belief_type: { type: 'string', enum: ['knowledge', 'assumption', 'inference', 'observation'], description: 'Type of belief' },
            confidence: { type: 'number', description: 'Confidence level 0-1 (default: 0.5)' },
          },
          required: ['subject', 'value'],
        },
      },
      {
        name: 'belief_get',
        description: 'Get your beliefs or another agent\'s beliefs',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            agent_handle: { type: 'string', description: 'Agent handle (default: yourself)' },
            belief_type: { type: 'string', description: 'Filter by belief type' },
          },
          required: [],
        },
      },
      {
        name: 'belief_consensus',
        description: 'Get the swarm consensus on a subject (aggregated beliefs)',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            subject: { type: 'string', description: 'Subject to get consensus on' },
            min_confidence: { type: 'number', description: 'Minimum confidence threshold' },
          },
          required: ['subject'],
        },
      },

      // ============================================================================
      // Swarm Intelligence - Credits & Reputation
      // ============================================================================
      {
        name: 'credits_balance',
        description: 'Get your credit balance and reputation score',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
          },
          required: [],
        },
      },
      {
        name: 'credits_leaderboard',
        description: 'Get the credit/reputation leaderboard for the swarm',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            order_by: { type: 'string', enum: ['balance', 'reputation', 'earned', 'tasks'], description: 'Sort order (default: balance)' },
            limit: { type: 'number', description: 'Max entries to return (default: 10)' },
          },
          required: [],
        },
      },
      {
        name: 'credits_transfer',
        description: 'Transfer credits to another agent',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            to_handle: { type: 'string', description: 'Agent to transfer credits to' },
            amount: { type: 'number', description: 'Amount to transfer' },
            reason: { type: 'string', description: 'Reason for transfer' },
          },
          required: ['to_handle', 'amount'],
        },
      },
      {
        name: 'credits_history',
        description: 'Get your credit transaction history',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            limit: { type: 'number', description: 'Max transactions to return' },
          },
          required: [],
        },
      },

      // ============================================================================
      // Swarm Intelligence - Consensus Voting
      // ============================================================================
      {
        name: 'proposal_create',
        description: 'Create a proposal for the swarm to vote on',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            title: { type: 'string', description: 'Proposal title' },
            options: { type: 'array', items: { type: 'string' }, description: 'Voting options (min 2)' },
            voting_method: { type: 'string', enum: ['majority', 'supermajority', 'plurality', 'ranked', 'unanimous'], description: 'Voting method (default: majority)' },
            deadline: { type: 'number', description: 'Deadline timestamp (optional)' },
          },
          required: ['title', 'options'],
        },
      },
      {
        name: 'proposal_list',
        description: 'List proposals in the swarm',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            status: { type: 'string', enum: ['active', 'closed', 'all'], description: 'Filter by status' },
          },
          required: [],
        },
      },
      {
        name: 'proposal_vote',
        description: 'Cast your vote on a proposal',
        inputSchema: {
          type: 'object',
          properties: {
            proposal_id: { type: 'string', description: 'Proposal ID' },
            vote_value: { type: 'string', description: 'Your vote (must match one of the options)' },
            rationale: { type: 'string', description: 'Optional rationale for your vote' },
          },
          required: ['proposal_id', 'vote_value'],
        },
      },
      {
        name: 'proposal_close',
        description: 'Close a proposal and tally the votes (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            proposal_id: { type: 'string', description: 'Proposal ID to close' },
          },
          required: ['proposal_id'],
        },
      },

      // ============================================================================
      // Swarm Intelligence - Task Bidding
      // ============================================================================
      {
        name: 'bid_submit',
        description: 'Submit a bid on a task',
        inputSchema: {
          type: 'object',
          properties: {
            swarm_id: { type: 'string', description: 'Swarm ID (uses current swarm if not provided)' },
            task_id: { type: 'string', description: 'Task to bid on' },
            bid_amount: { type: 'number', description: 'Your bid amount (credits)' },
            confidence: { type: 'number', description: 'Confidence you can complete (0-1)' },
            rationale: { type: 'string', description: 'Why you should win this bid' },
          },
          required: ['task_id', 'bid_amount'],
        },
      },
      {
        name: 'bid_list',
        description: 'List bids for a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            status: { type: 'string', enum: ['pending', 'accepted', 'rejected', 'withdrawn'], description: 'Filter by status' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'bid_accept',
        description: 'Accept a winning bid (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            bid_id: { type: 'string', description: 'Bid ID to accept' },
            settle_credits: { type: 'boolean', description: 'Deduct credits from winner (default: true)' },
          },
          required: ['bid_id'],
        },
      },
      {
        name: 'bid_withdraw',
        description: 'Withdraw your bid',
        inputSchema: {
          type: 'object',
          properties: {
            bid_id: { type: 'string', description: 'Bid ID to withdraw' },
          },
          required: ['bid_id'],
        },
      },
      {
        name: 'auction_run',
        description: 'Run an auction to automatically select a winner (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID to auction' },
            auction_type: { type: 'string', enum: ['first-price', 'second-price'], description: 'Auction type (default: first-price)' },
          },
          required: ['task_id'],
        },
      },

      // ============================================================================
      // Swarm Intelligence - Payoffs
      // ============================================================================
      {
        name: 'payoff_define',
        description: 'Define a payoff structure for a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            swarm_id: { type: 'string', description: 'Swarm ID (optional)' },
            payoff_type: { type: 'string', enum: ['completion', 'quality', 'speed', 'cooperation', 'penalty'], description: 'Type of payoff' },
            base_value: { type: 'number', description: 'Base payoff value' },
            deadline: { type: 'number', description: 'Deadline timestamp for time-based decay' },
          },
          required: ['task_id', 'payoff_type', 'base_value'],
        },
      },
      {
        name: 'payoff_calculate',
        description: 'Calculate the current payoff value for a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
          },
          required: ['task_id'],
        },
      },

      // ============================================================================
      // Workflows (DAG-based Task Automation)
      // ============================================================================
      {
        name: 'workflow_list',
        description: 'List all workflows',
        inputSchema: {
          type: 'object',
          properties: {
            is_template: { type: 'boolean', description: 'Filter by template status' },
          },
          required: [],
        },
      },
      {
        name: 'workflow_get',
        description: 'Get workflow details including steps',
        inputSchema: {
          type: 'object',
          properties: {
            workflow_id: { type: 'string', description: 'Workflow ID' },
          },
          required: ['workflow_id'],
        },
      },
      {
        name: 'workflow_start',
        description: 'Start a workflow execution (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            workflow_id: { type: 'string', description: 'Workflow ID to start' },
            inputs: { type: 'object', description: 'Input parameters for the workflow' },
            swarm_id: { type: 'string', description: 'Swarm to run in (optional)' },
          },
          required: ['workflow_id'],
        },
      },
      {
        name: 'execution_list',
        description: 'List workflow executions',
        inputSchema: {
          type: 'object',
          properties: {
            workflow_id: { type: 'string', description: 'Filter by workflow ID' },
            status: { type: 'string', enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'], description: 'Filter by status' },
          },
          required: [],
        },
      },
      {
        name: 'execution_get',
        description: 'Get execution details including step statuses',
        inputSchema: {
          type: 'object',
          properties: {
            execution_id: { type: 'string', description: 'Execution ID' },
          },
          required: ['execution_id'],
        },
      },
      {
        name: 'execution_steps',
        description: 'Get all steps for an execution',
        inputSchema: {
          type: 'object',
          properties: {
            execution_id: { type: 'string', description: 'Execution ID' },
          },
          required: ['execution_id'],
        },
      },
      {
        name: 'execution_pause',
        description: 'Pause a running execution (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            execution_id: { type: 'string', description: 'Execution ID to pause' },
          },
          required: ['execution_id'],
        },
      },
      {
        name: 'execution_resume',
        description: 'Resume a paused execution (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            execution_id: { type: 'string', description: 'Execution ID to resume' },
          },
          required: ['execution_id'],
        },
      },
      {
        name: 'execution_cancel',
        description: 'Cancel an execution (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            execution_id: { type: 'string', description: 'Execution ID to cancel' },
          },
          required: ['execution_id'],
        },
      },
      {
        name: 'step_complete',
        description: 'Mark a step as completed with output',
        inputSchema: {
          type: 'object',
          properties: {
            step_id: { type: 'string', description: 'Step ID' },
            output: { type: 'object', description: 'Step output data' },
          },
          required: ['step_id'],
        },
      },
      {
        name: 'step_retry',
        description: 'Retry a failed step',
        inputSchema: {
          type: 'object',
          properties: {
            step_id: { type: 'string', description: 'Step ID to retry' },
          },
          required: ['step_id'],
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

          const { checkpoint_id } = args as {
            checkpoint_id?: number;
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
        // Templates (Swarm Configuration)
        // ============================================================================
        case 'template_list': {
          const { builtin_only } = args as { builtin_only?: boolean };

          const params: string[] = [];
          if (builtin_only) params.push('builtin=true');

          const query = params.length > 0 ? `?${params.join('&')}` : '';
          const templates = await callApi('GET', `/templates${query}`);
          return formatResponse(templates);
        }

        case 'template_get': {
          const { template_id } = args as { template_id: string };

          const template = await callApi('GET', `/templates/${encodeURIComponent(template_id)}`);
          return formatResponse(template);
        }

        case 'template_run': {
          const permError = checkPermission('spawn');
          if (permError) return permError;

          const { template_id, swarm_name } = args as {
            template_id: string;
            swarm_name?: string;
          };

          const body: Record<string, unknown> = {};
          if (swarm_name) body.swarmName = swarm_name;

          const result = await callApi('POST', `/templates/${encodeURIComponent(template_id)}/run`, body);
          return formatResponse(result);
        }

        // ============================================================================
        // Audit System (Codebase Health)
        // ============================================================================
        case 'audit_status': {
          const result = await callApi('GET', '/audit/status');
          return formatResponse(result);
        }

        case 'audit_output': {
          const { since = 0, limit = 100 } = args as { since?: number; limit?: number };
          const cappedLimit = Math.min(limit, 1000);
          const result = await callApi('GET', `/audit/output?since=${since}&limit=${cappedLimit}`);
          return formatResponse(result);
        }

        case 'audit_start': {
          const { dry_run, max_iterations } = args as { dry_run?: boolean; max_iterations?: number };
          const body: Record<string, unknown> = {};
          if (dry_run !== undefined) body.dryRun = dry_run;
          if (max_iterations !== undefined) body.maxIterations = max_iterations;
          const result = await callApi('POST', '/audit/start', body);
          return formatResponse(result);
        }

        case 'audit_stop': {
          const result = await callApi('POST', '/audit/stop');
          return formatResponse(result);
        }

        case 'audit_quick': {
          const result = await callApi('POST', '/audit/quick');
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

        // ============================================================================
        // TLDR (Token-Efficient Code Analysis)
        // ============================================================================
        case 'tldr_get_summary': {
          const { file_path } = args as { file_path: string };
          const result = await callApi('POST', '/tldr/summary/get', { filePath: file_path });
          return formatResponse(result);
        }

        case 'tldr_store_summary': {
          const { file_path, content_hash, summary, exports, imports, line_count, language } = args as {
            file_path: string;
            content_hash: string;
            summary: string;
            exports?: string[];
            imports?: string[];
            line_count?: number;
            language?: string;
          };

          const result = await callApi('POST', '/tldr/summary/store', {
            filePath: file_path,
            contentHash: content_hash,
            summary,
            exports,
            imports,
            lineCount: line_count,
            language,
          });
          return formatResponse(result);
        }

        case 'tldr_get_codebase': {
          const { root_path } = args as { root_path: string };
          const result = await callApi('POST', '/tldr/codebase/get', { rootPath: root_path });
          return formatResponse(result);
        }

        case 'tldr_store_codebase': {
          const { root_path, name, description, key_files, patterns, tech_stack } = args as {
            root_path: string;
            name: string;
            description?: string;
            key_files?: string[];
            patterns?: string[];
            tech_stack?: string[];
          };

          const result = await callApi('POST', '/tldr/codebase/store', {
            rootPath: root_path,
            name,
            description,
            keyFiles: key_files,
            patterns,
            techStack: tech_stack,
          });
          return formatResponse(result);
        }

        case 'tldr_dependency_graph': {
          const { root_files, depth } = args as {
            root_files: string[];
            depth?: number;
          };

          const result = await callApi('POST', '/tldr/dependency/graph', {
            rootFiles: root_files,
            depth: depth ?? 3,
          });
          return formatResponse(result);
        }

        case 'tldr_stats': {
          const result = await callApi('GET', '/tldr/stats');
          return formatResponse(result);
        }

        // ============================================================================
        // Swarm Intelligence - Pheromones (Stigmergic Coordination)
        // ============================================================================
        case 'pheromone_deposit': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, resource_type, resource_id, trail_type, intensity } = args as {
            swarm_id?: string;
            resource_type: string;
            resource_id: string;
            trail_type: string;
            intensity?: number;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const result = await callApi('POST', '/pheromones', {
            swarmId: swarmResult.swarmId,
            depositorHandle: myHandle,
            resourceType: resource_type,
            resourceId: resource_id,
            trailType: trail_type,
            intensity: intensity ?? 1.0,
          });
          return formatResponse(result);
        }

        case 'pheromone_query': {
          const { swarm_id, resource_type, min_intensity } = args as {
            swarm_id?: string;
            resource_type?: string;
            min_intensity?: number;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const params: string[] = ['activeOnly=true'];
          if (resource_type) params.push(`resourceType=${encodeURIComponent(resource_type)}`);
          if (min_intensity) params.push(`minIntensity=${min_intensity}`);

          const path = `/pheromones/${encodeURIComponent(swarmResult.swarmId)}?${params.join('&')}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        case 'pheromone_hot_resources': {
          const { swarm_id, resource_type, limit } = args as {
            swarm_id?: string;
            resource_type?: string;
            limit?: number;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const params: string[] = [];
          if (resource_type) params.push(`resourceType=${encodeURIComponent(resource_type)}`);
          if (limit) params.push(`limit=${limit}`);

          const query = params.length > 0 ? `?${params.join('&')}` : '';
          const path = `/pheromones/${encodeURIComponent(swarmResult.swarmId)}/activity${query}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        // ============================================================================
        // Swarm Intelligence - Beliefs (Theory of Mind)
        // ============================================================================
        case 'belief_set': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, subject, value, belief_type, confidence } = args as {
            swarm_id?: string;
            subject: string;
            value: string;
            belief_type?: string;
            confidence?: number;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const result = await callApi('POST', '/beliefs', {
            swarmId: swarmResult.swarmId,
            agentHandle: myHandle,
            subject,
            beliefValue: value,
            beliefType: belief_type ?? 'knowledge',
            confidence: confidence ?? 0.5,
            sourceType: 'direct',
          });
          return formatResponse(result);
        }

        case 'belief_get': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, agent_handle, belief_type } = args as {
            swarm_id?: string;
            agent_handle?: string;
            belief_type?: string;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const handle = agent_handle ?? myHandle;
          const params: string[] = [];
          if (belief_type) params.push(`beliefType=${encodeURIComponent(belief_type)}`);
          const query = params.length > 0 ? `?${params.join('&')}` : '';

          const path = `/beliefs/${encodeURIComponent(swarmResult.swarmId)}/${encodeURIComponent(handle)}${query}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        case 'belief_consensus': {
          const { swarm_id, subject, min_confidence } = args as {
            swarm_id?: string;
            subject: string;
            min_confidence?: number;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const params: string[] = [];
          if (min_confidence) params.push(`minConfidence=${min_confidence}`);
          const query = params.length > 0 ? `?${params.join('&')}` : '';

          const path = `/beliefs/${encodeURIComponent(swarmResult.swarmId)}/consensus/${encodeURIComponent(subject)}${query}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        // ============================================================================
        // Swarm Intelligence - Credits & Reputation
        // ============================================================================
        case 'credits_balance': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id } = args as { swarm_id?: string };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const path = `/credits/${encodeURIComponent(swarmResult.swarmId)}/${encodeURIComponent(myHandle)}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        case 'credits_leaderboard': {
          const { swarm_id, order_by, limit } = args as {
            swarm_id?: string;
            order_by?: string;
            limit?: number;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const params: string[] = [];
          if (order_by) params.push(`orderBy=${encodeURIComponent(order_by)}`);
          if (limit) params.push(`limit=${limit}`);
          const query = params.length > 0 ? `?${params.join('&')}` : '';

          const path = `/credits/${encodeURIComponent(swarmResult.swarmId)}/leaderboard${query}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        case 'credits_transfer': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, to_handle, amount, reason } = args as {
            swarm_id?: string;
            to_handle: string;
            amount: number;
            reason?: string;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const body: Record<string, unknown> = {
            swarmId: swarmResult.swarmId,
            fromHandle: myHandle,
            toHandle: to_handle,
            amount,
          };
          if (reason) body.reason = reason;

          const result = await callApi('POST', '/credits/transfer', body);
          return formatResponse(result);
        }

        case 'credits_history': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, limit } = args as {
            swarm_id?: string;
            limit?: number;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const params: string[] = [];
          if (limit) params.push(`limit=${limit}`);
          const query = params.length > 0 ? `?${params.join('&')}` : '';

          const path = `/credits/${encodeURIComponent(swarmResult.swarmId)}/${encodeURIComponent(myHandle)}/history${query}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        // ============================================================================
        // Swarm Intelligence - Consensus Voting
        // ============================================================================
        case 'proposal_create': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, title, options, voting_method, deadline } = args as {
            swarm_id?: string;
            title: string;
            options: string[];
            voting_method?: string;
            deadline?: number;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const body: Record<string, unknown> = {
            swarmId: swarmResult.swarmId,
            proposerHandle: myHandle,
            title,
            options,
            proposalType: 'decision',
            votingMethod: voting_method ?? 'majority',
          };
          if (deadline) body.deadline = deadline;

          const result = await callApi('POST', '/consensus/proposals', body);
          return formatResponse(result);
        }

        case 'proposal_list': {
          const { swarm_id, status } = args as {
            swarm_id?: string;
            status?: string;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const params: string[] = [];
          if (status) params.push(`status=${encodeURIComponent(status)}`);
          const query = params.length > 0 ? `?${params.join('&')}` : '';

          const path = `/consensus/${encodeURIComponent(swarmResult.swarmId)}/proposals${query}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        case 'proposal_vote': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { proposal_id, vote_value, rationale } = args as {
            proposal_id: string;
            vote_value: string;
            rationale?: string;
          };

          const body: Record<string, unknown> = {
            voterHandle: myHandle,
            voteValue: vote_value,
          };
          if (rationale) body.rationale = rationale;

          const result = await callApi('POST', `/consensus/proposals/${encodeURIComponent(proposal_id)}/vote`, body);
          return formatResponse(result);
        }

        case 'proposal_close': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const { proposal_id } = args as { proposal_id: string };
          const result = await callApi('POST', `/consensus/proposals/${encodeURIComponent(proposal_id)}/close`);
          return formatResponse(result);
        }

        // ============================================================================
        // Swarm Intelligence - Task Bidding
        // ============================================================================
        case 'bid_submit': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { swarm_id, task_id, bid_amount, confidence, rationale } = args as {
            swarm_id?: string;
            task_id: string;
            bid_amount: number;
            confidence?: number;
            rationale?: string;
          };

          const swarmResult = requireSwarmId(swarm_id);
          if (swarmResult.error) return swarmResult.error;

          const body: Record<string, unknown> = {
            swarmId: swarmResult.swarmId,
            taskId: task_id,
            bidderHandle: myHandle,
            bidAmount: bid_amount,
            confidence: confidence ?? 0.5,
          };
          if (rationale) body.rationale = rationale;

          const result = await callApi('POST', '/bids', body);
          return formatResponse(result);
        }

        case 'bid_list': {
          const { task_id, status } = args as {
            task_id: string;
            status?: string;
          };

          const params: string[] = [];
          if (status) params.push(`status=${encodeURIComponent(status)}`);
          const query = params.length > 0 ? `?${params.join('&')}` : '';

          const path = `/bids/task/${encodeURIComponent(task_id)}${query}`;
          const result = await callApi('GET', path);
          return formatResponse(result);
        }

        case 'bid_accept': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const { bid_id, settle_credits } = args as {
            bid_id: string;
            settle_credits?: boolean;
          };

          const result = await callApi('POST', `/bids/${encodeURIComponent(bid_id)}/accept`, {
            settleCredits: settle_credits ?? true,
          });
          return formatResponse(result);
        }

        case 'bid_withdraw': {
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;
          if (!myHandle) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_NAME', true);
          }

          const { bid_id } = args as { bid_id: string };
          const result = await callApi('DELETE', `/bids/${encodeURIComponent(bid_id)}?handle=${encodeURIComponent(myHandle)}`);
          return formatResponse(result);
        }

        case 'auction_run': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const { task_id, auction_type } = args as {
            task_id: string;
            auction_type?: string;
          };

          const result = await callApi('POST', `/bids/task/${encodeURIComponent(task_id)}/auction`, {
            auctionType: auction_type ?? 'first-price',
          });
          return formatResponse(result);
        }

        // ============================================================================
        // Swarm Intelligence - Payoffs
        // ============================================================================
        case 'payoff_define': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const { task_id, swarm_id, payoff_type, base_value, deadline } = args as {
            task_id: string;
            swarm_id?: string;
            payoff_type: string;
            base_value: number;
            deadline?: number;
          };

          const body: Record<string, unknown> = {
            taskId: task_id,
            payoffType: payoff_type,
            baseValue: base_value,
            multiplier: 1.0,
            decayRate: 0.0,
          };
          if (swarm_id) body.swarmId = swarm_id;
          if (deadline) body.deadline = deadline;

          const result = await callApi('POST', '/payoffs', body);
          return formatResponse(result);
        }

        case 'payoff_calculate': {
          const { task_id } = args as { task_id: string };
          const result = await callApi('GET', `/payoffs/${encodeURIComponent(task_id)}/calculate`);
          return formatResponse(result);
        }

        // ============================================================================
        // Workflows (DAG-based Task Automation)
        // ============================================================================
        case 'workflow_list': {
          const { is_template } = args as { is_template?: boolean };
          const params: string[] = [];
          if (is_template !== undefined) params.push(`isTemplate=${is_template}`);
          const query = params.length > 0 ? `?${params.join('&')}` : '';
          const result = await callApi('GET', `/workflows${query}`);
          return formatResponse(result);
        }

        case 'workflow_get': {
          const { workflow_id } = args as { workflow_id: string };
          const result = await callApi('GET', `/workflows/${encodeURIComponent(workflow_id)}`);
          return formatResponse(result);
        }

        case 'workflow_start': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const { workflow_id, inputs, swarm_id } = args as {
            workflow_id: string;
            inputs?: Record<string, unknown>;
            swarm_id?: string;
          };

          const body: Record<string, unknown> = {};
          if (inputs) body.inputs = inputs;
          if (swarm_id) body.swarmId = swarm_id;

          const result = await callApi('POST', `/workflows/${encodeURIComponent(workflow_id)}/start`, body);
          return formatResponse(result);
        }

        case 'execution_list': {
          const { workflow_id, status } = args as {
            workflow_id?: string;
            status?: string;
          };

          const params: string[] = [];
          if (workflow_id) params.push(`workflowId=${encodeURIComponent(workflow_id)}`);
          if (status) params.push(`status=${encodeURIComponent(status)}`);
          const query = params.length > 0 ? `?${params.join('&')}` : '';

          const result = await callApi('GET', `/executions${query}`);
          return formatResponse(result);
        }

        case 'execution_get': {
          const { execution_id } = args as { execution_id: string };
          const result = await callApi('GET', `/executions/${encodeURIComponent(execution_id)}`);
          return formatResponse(result);
        }

        case 'execution_steps': {
          const { execution_id } = args as { execution_id: string };
          const result = await callApi('GET', `/executions/${encodeURIComponent(execution_id)}/steps`);
          return formatResponse(result);
        }

        case 'execution_pause': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const { execution_id } = args as { execution_id: string };
          const result = await callApi('POST', `/executions/${encodeURIComponent(execution_id)}/pause`);
          return formatResponse(result);
        }

        case 'execution_resume': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const { execution_id } = args as { execution_id: string };
          const result = await callApi('POST', `/executions/${encodeURIComponent(execution_id)}/resume`);
          return formatResponse(result);
        }

        case 'execution_cancel': {
          const permError = checkPermission('assign');
          if (permError) return permError;

          const { execution_id } = args as { execution_id: string };
          const result = await callApi('POST', `/executions/${encodeURIComponent(execution_id)}/cancel`);
          return formatResponse(result);
        }

        case 'step_complete': {
          const { step_id, output } = args as {
            step_id: string;
            output?: Record<string, unknown>;
          };

          const body: Record<string, unknown> = {};
          if (output) body.output = output;

          const result = await callApi('POST', `/steps/${encodeURIComponent(step_id)}/complete`, body);
          return formatResponse(result);
        }

        case 'step_retry': {
          const { step_id } = args as { step_id: string };
          const result = await callApi('POST', `/steps/${encodeURIComponent(step_id)}/retry`);
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
