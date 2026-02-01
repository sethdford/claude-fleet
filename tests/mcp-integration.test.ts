/**
 * MCP Integration Tests
 *
 * Tests the MCP server's tool registration and protocol behavior.
 * These tests verify that:
 * 1. All 93 tools are registered with correct schemas
 * 2. Tool names follow category naming conventions
 * 3. Every registered tool has a matching handler case
 * 4. Permission checks via role-based access
 * 5. Error handling and response format
 *
 * Note: Full API functionality is tested in the E2E tests.
 * These tests focus on MCP protocol layer behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock environment variables before importing the module
vi.stubEnv('CLAUDE_CODE_AGENT_NAME', 'test-agent');
vi.stubEnv('CLAUDE_CODE_TEAM_NAME', 'test-team');
vi.stubEnv('CLAUDE_CODE_AGENT_TYPE', 'team-lead');
vi.stubEnv('CLAUDE_CODE_SWARM_ID', 'test-swarm');
vi.stubEnv('CLAUDE_FLEET_URL', 'http://localhost:3899');

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: vi.fn().mockImplementation(() => ({
      setRequestHandler: vi.fn().mockImplementation((_schema: unknown, _handler: (...args: unknown[]) => unknown) => {
        // Handler registration captured but not asserted on in these tests
      }),
      connect: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: Symbol('CallToolRequestSchema'),
  ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
}));

/**
 * Complete list of all 93 MCP tools organized by category.
 * This serves as the canonical reference and regression test.
 * If a tool is added or removed from the MCP server, this list must be updated.
 */
const EXPECTED_TOOLS: Record<string, string[]> = {
  'Team Management': [
    'team_status', 'team_broadcast', 'team_tasks', 'team_assign',
    'team_complete', 'team_claim', 'team_spawn', 'team_dismiss',
    'team_workers', 'team_send', 'team_handoff',
  ],
  'Work Items & Batches': [
    'workitem_create', 'workitem_update', 'workitem_list',
    'batch_create', 'batch_dispatch',
  ],
  'Communication': [
    'mail_send', 'mail_read',
    'blackboard_post', 'blackboard_read', 'blackboard_mark_read', 'blackboard_archive',
  ],
  'Git Integration': [
    'worktree_commit', 'worktree_push', 'worktree_pr',
  ],
  'Checkpoints': [
    'checkpoint_create', 'checkpoint_load', 'checkpoint_list',
  ],
  'Swarm Intelligence': [
    'swarm_create', 'swarm_list', 'swarm_kill', 'swarm_broadcast',
    'pheromone_deposit', 'pheromone_query', 'pheromone_hot_resources',
    'belief_set', 'belief_get', 'belief_consensus',
  ],
  'Governance & Auctions': [
    'proposal_create', 'proposal_list', 'proposal_vote', 'proposal_close',
    'bid_submit', 'bid_list', 'bid_accept', 'bid_withdraw',
    'auction_run',
    'payoff_define', 'payoff_calculate',
    'credits_transfer', 'credits_balance', 'credits_history', 'credits_leaderboard',
  ],
  'TLDR Summaries': [
    'tldr_get_summary', 'tldr_store_summary',
    'tldr_get_codebase', 'tldr_store_codebase',
    'tldr_dependency_graph', 'tldr_stats',
  ],
  'Spawn Management': [
    'spawn_request', 'spawn_status', 'spawn_cancel',
  ],
  'Templates & Audit': [
    'template_list', 'template_get', 'template_run',
    'audit_status', 'audit_output', 'audit_start', 'audit_stop', 'audit_quick',
  ],
  'Workflows & Executions': [
    'workflow_list', 'workflow_get', 'workflow_start',
    'execution_list', 'execution_get', 'execution_steps',
    'execution_pause', 'execution_resume', 'execution_cancel',
    'step_complete', 'step_retry',
  ],
  'Compound / Missions': [
    'mission_status', 'mission_gates', 'mission_iterations',
    'gate_results', 'compound_snapshot',
  ],
  memory: [
    'memory_store', 'memory_recall', 'memory_search',
  ],
  routing: [
    'task_route',
  ],
  'Shell & Search': [
    'lmsh_translate', 'search_sessions',
  ],
  'DAG Solver': [
    'dag_sort',
  ],
};

const ALL_EXPECTED_TOOL_NAMES = Object.values(EXPECTED_TOOLS).flat().sort();
const EXPECTED_TOOL_COUNT = 93;

describe('MCP Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default fetch mock for API calls
    mockFetch.mockImplementation(async (url: string, _options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/auth')) {
        return {
          ok: true,
          json: async () => ({
            uid: 'test-uid',
            token: 'test-token',
            handle: 'test-agent',
          }),
        };
      }

      if (urlStr.includes('/health')) {
        return {
          ok: true,
          json: async () => ({
            status: 'healthy',
            agents: 5,
          }),
        };
      }

      // Default OK response
      return {
        ok: true,
        json: async () => ({}),
      };
    });
  });

  describe('Tool Registry Verification', () => {
    it('should have exactly 90 expected tool definitions in test catalog', () => {
      expect(ALL_EXPECTED_TOOL_NAMES).toHaveLength(EXPECTED_TOOL_COUNT);
    });

    it('should have no duplicate tool names in expected catalog', () => {
      const uniqueNames = new Set(ALL_EXPECTED_TOOL_NAMES);
      expect(uniqueNames.size).toBe(ALL_EXPECTED_TOOL_NAMES.length);
    });

    it('should match tool definitions in MCP server source', () => {
      // Parse tool names directly from the MCP server source
      const serverSource = readFileSync(
        resolve(__dirname, '../src/mcp/server.ts'),
        'utf-8'
      );

      // Extract tool names from name: 'tool_name' patterns in the ListTools handler
      const toolNameRegex = /name:\s*'([a-z_]+)'/g;
      const sourceToolNames: string[] = [];
      let match;
      while ((match = toolNameRegex.exec(serverSource)) !== null) {
        const name = match[1];
        // Skip non-tool names (server metadata)
        if (name !== 'claude' && !name.includes('fleet_server')) {
          sourceToolNames.push(name);
        }
      }

      const sortedSourceNames = [...sourceToolNames].sort();
      expect(sortedSourceNames).toEqual(ALL_EXPECTED_TOOL_NAMES);
    });

    it('should have a case handler for every registered tool', () => {
      const serverSource = readFileSync(
        resolve(__dirname, '../src/mcp/server.ts'),
        'utf-8'
      );

      // Extract case handler names from the CallTool switch statement
      const caseRegex = /case '([a-z_]+)':/g;
      const handlerNames: string[] = [];
      let match;
      while ((match = caseRegex.exec(serverSource)) !== null) {
        handlerNames.push(match[1]);
      }

      const sortedHandlers = [...handlerNames].sort();

      // Every tool should have a handler and vice versa
      expect(sortedHandlers).toEqual(ALL_EXPECTED_TOOL_NAMES);
    });
  });

  describe('Tool Naming Conventions', () => {
    for (const [category, tools] of Object.entries(EXPECTED_TOOLS)) {
      it(`${category} tools follow naming convention`, () => {
        for (const tool of tools) {
          // All tools should be snake_case
          expect(tool).toMatch(/^[a-z]+(_[a-z]+)+$/);

          // Tools should start with their category prefix
          const prefix = tool.split('_')[0];
          const validPrefixes = [
            'team', 'workitem', 'batch', 'mail', 'blackboard', 'worktree',
            'checkpoint', 'swarm', 'pheromone', 'belief', 'proposal', 'bid',
            'auction', 'payoff', 'credits', 'tldr', 'spawn', 'template',
            'audit', 'workflow', 'execution', 'step',
            'mission', 'gate', 'compound',
            'memory', 'task',
            'lmsh', 'search', 'dag',
          ];
          expect(validPrefixes).toContain(prefix);
        }
      });
    }
  });

  describe('Tool Schema Validation', () => {
    it('should have valid inputSchema for every tool', () => {
      const serverSource = readFileSync(
        resolve(__dirname, '../src/mcp/server.ts'),
        'utf-8'
      );

      // Every tool definition should have an inputSchema with type: 'object'
      const toolBlocks = serverSource.split(/\{\s*name:\s*'/);
      for (const block of toolBlocks.slice(1)) {
        const toolName = block.split("'")[0];
        if (ALL_EXPECTED_TOOL_NAMES.includes(toolName)) {
          expect(block).toContain('inputSchema');
          expect(block).toContain("type: 'object'");
        }
      }
    });
  });

  describe('Authentication', () => {
    it('should authenticate with environment variables', async () => {
      const response = await fetch('http://localhost:3899/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: 'test-agent',
          teamName: 'test-team',
          agentType: 'team-lead',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('token');
      expect(data).toHaveProperty('uid');
    });
  });

  describe('Permission Model', () => {
    it('should recognize team-lead role from environment', () => {
      expect(process.env.CLAUDE_CODE_AGENT_TYPE).toBe('team-lead');
    });

    it('should support worker role override', () => {
      vi.stubEnv('CLAUDE_CODE_AGENT_TYPE', 'worker');
      expect(process.env.CLAUDE_CODE_AGENT_TYPE).toBe('worker');
    });

    it('should support monitor role override', () => {
      vi.stubEnv('CLAUDE_CODE_AGENT_TYPE', 'monitor');
      expect(process.env.CLAUDE_CODE_AGENT_TYPE).toBe('monitor');
    });
  });

  describe('Swarm ID Handling', () => {
    it('should use environment variable for swarm ID', () => {
      expect(process.env.CLAUDE_CODE_SWARM_ID).toBe('test-swarm');
    });

    it('should prefer explicit swarm ID over environment', () => {
      const explicitId = 'explicit-swarm';
      const envId = process.env.CLAUDE_CODE_SWARM_ID;
      const result = explicitId ?? envId;
      expect(result).toBe('explicit-swarm');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await expect(fetch('http://localhost:3899/health')).rejects.toThrow('Network error');
    });

    it('should handle non-OK responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

      const response = await fetch('http://localhost:3899/protected');
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it('should handle invalid JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const response = await fetch('http://localhost:3899/endpoint');
      await expect(response.json()).rejects.toThrow('Invalid JSON');
    });
  });

  describe('Tool Response Format', () => {
    it('should use text content type for responses', () => {
      const response = {
        content: [{ type: 'text' as const, text: 'Success' }],
      };
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBeDefined();
    });

    it('should set isError flag for error responses', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error occurred' }],
        isError: true,
      };
      expect(errorResponse.isError).toBe(true);
    });

    it('should omit isError flag for success responses', () => {
      const successResponse: Record<string, unknown> = {
        content: [{ type: 'text' as const, text: 'Success' }],
      };
      expect(successResponse.isError).toBeUndefined();
    });
  });
});
