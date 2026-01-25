/**
 * Tmux Tool Definitions
 *
 * MCP tools for tmux terminal automation.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tmuxTools: Tool[] = [
  {
    name: 'tmux_status',
    description: 'Get tmux fleet status - shows if tmux is available and lists all workers',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tmux_spawn',
    description: 'Spawn a new worker in a tmux pane',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Unique handle for the worker',
        },
        command: {
          type: 'string',
          description: 'Initial command to run (e.g., "claude --print")',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the pane',
        },
        direction: {
          type: 'string',
          enum: ['horizontal', 'vertical'],
          description: 'Split direction',
          default: 'vertical',
        },
        role: {
          type: 'string',
          description: 'Worker role for display',
          default: 'worker',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'tmux_spawn_claude',
    description: 'Spawn a Claude Code worker in a tmux pane',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Unique handle for the worker',
        },
        prompt: {
          type: 'string',
          description: 'Initial prompt for Claude',
        },
        model: {
          type: 'string',
          description: 'Model to use (e.g., "sonnet", "opus")',
        },
        printMode: {
          type: 'boolean',
          description: 'Use --print mode for non-interactive output',
          default: true,
        },
        cwd: {
          type: 'string',
          description: 'Working directory',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'tmux_send',
    description: 'Send text/command to a worker pane',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle to send to',
        },
        text: {
          type: 'string',
          description: 'Text or command to send',
        },
        noEnter: {
          type: 'boolean',
          description: 'Do not automatically press Enter after sending',
          default: false,
        },
        instant: {
          type: 'boolean',
          description: 'Send immediately without delay before Enter (--delay-enter=False)',
          default: false,
        },
        delay: {
          type: 'number',
          description: 'Custom delay in ms before Enter (default: 100)',
        },
      },
      required: ['handle', 'text'],
    },
  },
  {
    name: 'tmux_capture',
    description: 'Capture output from a worker pane',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle to capture from',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to capture (from bottom)',
          default: 100,
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'tmux_execute',
    description: 'Execute a command in a worker pane and wait for completion',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle',
        },
        command: {
          type: 'string',
          description: 'Command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds',
          default: 30000,
        },
      },
      required: ['handle', 'command'],
    },
  },
  {
    name: 'tmux_wait_idle',
    description: 'Wait for a worker pane to become idle (output stops changing)',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds',
          default: 30000,
        },
        stableTime: {
          type: 'number',
          description: 'Time output must be stable to consider idle',
          default: 1000,
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'tmux_wait_pattern',
    description: 'Wait for a pattern to appear in worker output',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle',
        },
        pattern: {
          type: 'string',
          description: 'Regex pattern to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds',
          default: 30000,
        },
      },
      required: ['handle', 'pattern'],
    },
  },
  {
    name: 'tmux_interrupt',
    description: 'Send interrupt (Ctrl+C) to a worker',
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
    name: 'tmux_escape',
    description: 'Send escape key to a worker',
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
    name: 'tmux_kill',
    description: 'Kill a worker pane',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle to kill',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'tmux_kill_all',
    description: 'Kill all worker panes',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tmux_broadcast',
    description: 'Send a message to all worker panes',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Message to broadcast',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'tmux_focus',
    description: 'Focus on a specific worker pane',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Worker handle to focus',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'tmux_list_panes',
    description: 'List all tmux panes in the current window',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tmux_list_windows',
    description: 'List all tmux windows in the current session',
    inputSchema: {
      type: 'object',
      properties: {
        session: {
          type: 'string',
          description: 'Session name (optional, defaults to current)',
        },
      },
    },
  },
  {
    name: 'tmux_list_sessions',
    description: 'List all tmux sessions',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tmux_attach',
    description: 'Get the command to attach to a tmux session (for user to run)',
    inputSchema: {
      type: 'object',
      properties: {
        session: {
          type: 'string',
          description: 'Session name (optional)',
        },
      },
    },
  },
  {
    name: 'tmux_create_session',
    description: 'Create a new detached tmux session',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Session name',
        },
        cwd: {
          type: 'string',
          description: 'Working directory',
        },
        command: {
          type: 'string',
          description: 'Initial command to run',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'tmux_cleanup',
    description: 'Kill an entire tmux session (cleanup)',
    inputSchema: {
      type: 'object',
      properties: {
        session: {
          type: 'string',
          description: 'Session name to kill',
        },
      },
      required: ['session'],
    },
  },
];
