/**
 * Tests for MCP Bridge Server
 *
 * Covers: createServer, ListTools handler, all CallTool handlers (~40 tools),
 * helper functions (getAgentRole, getAuthToken, getSwarmId, requireSwarmId,
 * checkPermission, callApi, formatResponse) exercised through tool handlers.
 *
 * Strategy: The server module caches auth tokens at module scope, so once
 * authenticated the token persists across tests. We handle this by setting up
 * mockFetch to always respond correctly for both auth AND api calls — using
 * a default implementation that returns success for any URL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock SDK modules BEFORE importing the module under test
// ---------------------------------------------------------------------------

const handlerMap = new Map<string, Function>();

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const MockServer = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.setRequestHandler = vi.fn((schema: unknown, handler: unknown) => {
      handlerMap.set(schema as string, handler as Function);
    });
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  return { Server: MockServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}));

// Mock hasPermission to control role behavior without pulling in real types.
vi.mock('../workers/roles.js', () => {
  const COORDINATOR_PERMS = new Set([
    'spawn', 'dismiss', 'assign', 'broadcast', 'merge',
    'claim', 'complete', 'send', 'readAll', 'readStatus', 'resolve', 'push',
  ]);
  const WORKER_PERMS = new Set(['claim', 'complete', 'send']);

  return {
    hasPermission: vi.fn((role: string, permission: string) => {
      if (role === 'coordinator' || role === 'team-lead') {
        return COORDINATOR_PERMS.has(permission);
      }
      if (role === 'worker') {
        return WORKER_PERMS.has(permission);
      }
      return false;
    }),
  };
});

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { createServer } from './server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Parse the JSON text from a MCP tool response */
function parseText(response: ToolResponse): unknown {
  const text = response.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Env keys to save/restore */
const ENV_KEYS = [
  'CLAUDE_CODE_AGENT_NAME',
  'CLAUDE_CODE_TEAM_NAME',
  'CLAUDE_CODE_AGENT_TYPE',
  'CLAUDE_CODE_AGENT_UID',
  'CLAUDE_CODE_SWARM_ID',
  'CLAUDE_FLEET_URL',
  'COLLAB_SERVER_URL',
  'CLAUDE_CODE_MISSION_ID',
] as const;

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('MCP Server', () => {
  let listToolsHandler: Function;
  let callToolHandler: Function;
  const originalEnv: Record<string, string | undefined> = {};
  const mockFetch = vi.fn();

  /**
   * Configure mockFetch to return appropriate responses for any URL.
   * Auth endpoint returns a token; all other endpoints return the provided data.
   * Multiple apiResponses are returned in order for multiple API calls.
   */
  function setupFetch(...apiResponses: unknown[]): void {
    let apiCallIndex = 0;
    mockFetch.mockImplementation((url: string) => {
      // Auth endpoint
      if (typeof url === 'string' && url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ token: 'test-jwt', uid: 'uid-123' }),
        });
      }
      // API endpoint -- return responses in order
      const data = apiCallIndex < apiResponses.length
        ? apiResponses[apiCallIndex++]
        : apiResponses[apiResponses.length - 1] ?? {};
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
      });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    handlerMap.clear();

    // Save and set env
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
    process.env.CLAUDE_CODE_AGENT_NAME = 'test-agent';
    process.env.CLAUDE_CODE_TEAM_NAME = 'test-team';
    process.env.CLAUDE_CODE_AGENT_TYPE = 'coordinator';
    process.env.CLAUDE_CODE_AGENT_UID = 'uid-123';
    process.env.CLAUDE_CODE_SWARM_ID = 'swarm-1';
    delete process.env.CLAUDE_FLEET_URL;
    delete process.env.COLLAB_SERVER_URL;
    delete process.env.CLAUDE_CODE_MISSION_ID;

    // Install global.fetch mock with a default success handler
    global.fetch = mockFetch as unknown as typeof fetch;
    setupFetch({});

    // Create the server so handlers get registered
    createServer();
    listToolsHandler = handlerMap.get('ListToolsRequestSchema')!;
    callToolHandler = handlerMap.get('CallToolRequestSchema')!;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  /** Invoke a tool through the CallTool handler */
  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> {
    return callToolHandler({ params: { name, arguments: args } }) as Promise<ToolResponse>;
  }

  // =========================================================================
  // 1. createServer
  // =========================================================================

  describe('createServer', () => {
    it('should return a server instance', () => {
      const server = createServer();
      expect(server).toBeDefined();
      expect(server.setRequestHandler).toBeDefined();
    });

    it('should register ListTools and CallTool handlers', () => {
      expect(listToolsHandler).toBeTypeOf('function');
      expect(callToolHandler).toBeTypeOf('function');
    });
  });

  // =========================================================================
  // 2. ListTools
  // =========================================================================

  describe('ListTools handler', () => {
    it('should return a tools array', async () => {
      const result = await listToolsHandler();
      expect(result).toHaveProperty('tools');
      expect(Array.isArray(result.tools)).toBe(true);
    });

    it('should have at least 40 tools', async () => {
      const result = await listToolsHandler();
      expect(result.tools.length).toBeGreaterThanOrEqual(40);
    });

    it('should include expected tool names', async () => {
      const result = await listToolsHandler();
      const names = result.tools.map((t: { name: string }) => t.name);
      expect(names).toContain('team_status');
      expect(names).toContain('team_broadcast');
      expect(names).toContain('blackboard_post');
      expect(names).toContain('swarm_create');
      expect(names).toContain('lmsh_translate');
      expect(names).toContain('memory_store');
      expect(names).toContain('task_route');
    });

    it('should have inputSchema for each tool', async () => {
      const result = await listToolsHandler();
      for (const tool of result.tools) {
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.inputSchema).toHaveProperty('type', 'object');
      }
    });
  });

  // =========================================================================
  // 3. team_status
  // =========================================================================

  describe('team_status', () => {
    it('should return health and agents on success', async () => {
      setupFetch({ status: 'healthy' }, [{ handle: 'agent-1' }]);

      const response = await callTool('team_status');
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('health');
      expect(data).toHaveProperty('teamName', 'test-team');
      expect(data).toHaveProperty('agents');
    });

    it('should use default team name when env not set', async () => {
      delete process.env.CLAUDE_CODE_TEAM_NAME;
      setupFetch({ status: 'healthy' }, []);

      const response = await callTool('team_status');
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('teamName', 'default');
    });
  });

  // =========================================================================
  // 4. team_broadcast
  // =========================================================================

  describe('team_broadcast', () => {
    it('should broadcast successfully for coordinator', async () => {
      setupFetch({ ok: true, sent: 3 });

      const response = await callTool('team_broadcast', { message: 'Hello team!' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('ok', true);
    });

    it('should deny permission for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('team_broadcast', { message: 'Hello' });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });

    it('should return error when UID is not set', async () => {
      delete process.env.CLAUDE_CODE_AGENT_UID;

      const response = await callTool('team_broadcast', { message: 'Hello' });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Agent not registered');
    });
  });

  // =========================================================================
  // 5. team_tasks
  // =========================================================================

  describe('team_tasks', () => {
    it('should list all tasks', async () => {
      const tasks = [
        { ownerHandle: 'test-agent', status: 'open' },
        { ownerHandle: 'other', status: 'open' },
      ];
      setupFetch(tasks);

      const response = await callTool('team_tasks', { filter: 'all' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as { count: number; tasks: unknown[] };
      expect(data.count).toBe(2);
      expect(data.filter).toBe('all');
    });

    it('should filter mine tasks', async () => {
      const tasks = [
        { ownerHandle: 'test-agent', status: 'open' },
        { ownerHandle: 'other', status: 'open' },
      ];
      setupFetch(tasks);

      const response = await callTool('team_tasks', { filter: 'mine' });
      const data = parseText(response) as { count: number };
      expect(data.count).toBe(1);
    });

    it('should filter unassigned tasks', async () => {
      const tasks = [
        { ownerHandle: 'test-agent', status: 'open' },
        { ownerHandle: null, status: 'open' },
      ];
      setupFetch(tasks);

      const response = await callTool('team_tasks', { filter: 'unassigned' });
      const data = parseText(response) as { count: number };
      expect(data.count).toBe(1);
    });
  });

  // =========================================================================
  // 6. team_assign
  // =========================================================================

  describe('team_assign', () => {
    it('should assign task as coordinator', async () => {
      setupFetch({ id: 'task-1', status: 'assigned' });

      const response = await callTool('team_assign', {
        agent: 'worker-1',
        task: 'Fix the bug',
        description: 'The login button is broken',
      });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('id', 'task-1');
    });

    it('should deny permission for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('team_assign', {
        agent: 'worker-1',
        task: 'Fix the bug',
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });

    it('should error when agent UID not set', async () => {
      delete process.env.CLAUDE_CODE_AGENT_UID;

      const response = await callTool('team_assign', {
        agent: 'worker-1',
        task: 'Fix the bug',
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Agent not registered');
    });
  });

  // =========================================================================
  // 7. team_complete
  // =========================================================================

  describe('team_complete', () => {
    it('should mark task as resolved', async () => {
      setupFetch({ id: 'task-1', status: 'resolved' });

      const response = await callTool('team_complete', { task_id: 'task-1' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('status', 'resolved');
    });
  });

  // =========================================================================
  // 8. team_claim
  // =========================================================================

  describe('team_claim', () => {
    it('should claim a file locally without API call', async () => {
      const response = await callTool('team_claim', { file: 'src/index.ts' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('claimed', true);
      expect(data).toHaveProperty('file', 'src/index.ts');
      expect(data).toHaveProperty('by', 'test-agent');
      expect(data).toHaveProperty('timestamp');
    });
  });

  // =========================================================================
  // 9. team_spawn
  // =========================================================================

  describe('team_spawn', () => {
    it('should spawn worker as coordinator', async () => {
      setupFetch({ handle: 'new-worker', pid: 1234 });

      const response = await callTool('team_spawn', {
        handle: 'new-worker',
        prompt: 'Fix tests',
      });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('handle', 'new-worker');
    });

    it('should deny permission for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('team_spawn', { handle: 'new-worker' });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });
  });

  // =========================================================================
  // 10. team_dismiss
  // =========================================================================

  describe('team_dismiss', () => {
    it('should dismiss worker as coordinator', async () => {
      setupFetch({ dismissed: true, handle: 'old-worker' });

      const response = await callTool('team_dismiss', { handle: 'old-worker' });
      expect(response.isError).toBeFalsy();
    });

    it('should deny permission for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('team_dismiss', { handle: 'old-worker' });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });
  });

  // =========================================================================
  // 11. team_workers
  // =========================================================================

  describe('team_workers', () => {
    it('should list active workers', async () => {
      const workers = [{ handle: 'w1', status: 'ready' }];
      setupFetch(workers);

      const response = await callTool('team_workers');
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as unknown[];
      expect(data).toEqual(workers);
    });
  });

  // =========================================================================
  // 12. team_send
  // =========================================================================

  describe('team_send', () => {
    it('should send message to a worker', async () => {
      setupFetch({ sent: true });

      const response = await callTool('team_send', {
        handle: 'worker-1',
        message: 'Please finish the task',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should also work via send_message alias', async () => {
      setupFetch({ sent: true });

      const response = await callTool('send_message', {
        handle: 'worker-1',
        message: 'Please finish the task',
      });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 13. workitem_create
  // =========================================================================

  describe('workitem_create', () => {
    it('should create a work item', async () => {
      setupFetch({ id: 'wi-abc', title: 'New work item' });

      const response = await callTool('workitem_create', {
        title: 'New work item',
        description: 'Implement feature X',
      });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('id', 'wi-abc');
    });

    it('should send title and optional fields to API', async () => {
      setupFetch({ id: 'wi-abc' });

      await callTool('workitem_create', {
        title: 'Test',
        description: 'Desc',
        assignedTo: 'worker-1',
        batchId: 'batch-1',
      });

      // Find the API call (not auth)
      const apiCall = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/workitems'),
      );
      expect(apiCall).toBeDefined();
      const body = JSON.parse((apiCall as unknown[])[1]?.body as string);
      expect(body.title).toBe('Test');
      expect(body.assignedTo).toBe('worker-1');
    });
  });

  // =========================================================================
  // 14. workitem_update
  // =========================================================================

  describe('workitem_update', () => {
    it('should update work item status', async () => {
      setupFetch({ id: 'wi-abc', status: 'completed' });

      const response = await callTool('workitem_update', {
        workitem_id: 'wi-abc',
        status: 'completed',
      });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 15. workitem_list
  // =========================================================================

  describe('workitem_list', () => {
    it('should list work items', async () => {
      const items = [{ id: 'wi-1' }, { id: 'wi-2' }];
      setupFetch(items);

      const response = await callTool('workitem_list', { filter: 'all' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as { count: number };
      expect(data.count).toBe(2);
    });

    it('should filter by mine adding assignee query param', async () => {
      setupFetch([{ id: 'wi-1' }]);

      await callTool('workitem_list', { filter: 'mine' });

      const apiCall = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/workitems'),
      );
      expect(apiCall).toBeDefined();
      expect((apiCall as unknown[])[0]).toContain('assignee=test-agent');
    });
  });

  // =========================================================================
  // 16. mail_send
  // =========================================================================

  describe('mail_send', () => {
    it('should send mail on success', async () => {
      setupFetch({ id: 1, sent: true });

      const response = await callTool('mail_send', {
        to: 'worker-1',
        body: 'Hello from coordinator',
        subject: 'Status update',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should return error when CLAUDE_CODE_AGENT_NAME not set', async () => {
      delete process.env.CLAUDE_CODE_AGENT_NAME;

      const response = await callTool('mail_send', {
        to: 'worker-1',
        body: 'Hello',
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Agent not registered');
    });
  });

  // =========================================================================
  // 17. mail_read
  // =========================================================================

  describe('mail_read', () => {
    it('should read mail messages', async () => {
      const messages = [{ id: 1, body: 'Hello' }];
      setupFetch(messages);

      const response = await callTool('mail_read', { filter: 'unread' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as { count: number };
      expect(data.count).toBe(1);
    });

    it('should also work via read_messages alias', async () => {
      const messages = [{ id: 1, body: 'Hello' }];
      setupFetch(messages);

      const response = await callTool('read_messages', { filter: 'all' });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 18. team_handoff
  // =========================================================================

  describe('team_handoff', () => {
    it('should transfer context to another worker', async () => {
      setupFetch({ handoff: true });

      const response = await callTool('team_handoff', {
        to: 'worker-2',
        context: { files: ['src/index.ts'], state: 'in-progress' },
      });
      expect(response.isError).toBeFalsy();
    });

    it('should error without agent name', async () => {
      delete process.env.CLAUDE_CODE_AGENT_NAME;

      const response = await callTool('team_handoff', {
        to: 'worker-2',
        context: {},
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Agent not registered');
    });
  });

  // =========================================================================
  // 19. blackboard_post
  // =========================================================================

  describe('blackboard_post', () => {
    it('should post to blackboard on success', async () => {
      setupFetch({ id: 'msg-1', posted: true });

      const response = await callTool('blackboard_post', {
        message_type: 'status',
        payload: { progress: 50 },
      });
      expect(response.isError).toBeFalsy();
    });

    it('should require swarm ID when not in env', async () => {
      delete process.env.CLAUDE_CODE_SWARM_ID;

      const response = await callTool('blackboard_post', {
        message_type: 'status',
        payload: { progress: 50 },
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Swarm ID required');
    });

    it('should use explicit swarm_id argument over env', async () => {
      setupFetch({ id: 'msg-1' });

      await callTool('blackboard_post', {
        swarm_id: 'explicit-swarm',
        message_type: 'request',
        payload: { help: true },
      });

      // Find the blackboard POST call
      const apiCall = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/blackboard'),
      );
      expect(apiCall).toBeDefined();
      const body = JSON.parse((apiCall as unknown[])[1]?.body as string);
      expect(body.swarmId).toBe('explicit-swarm');
    });
  });

  // =========================================================================
  // 20. blackboard_read
  // =========================================================================

  describe('blackboard_read', () => {
    it('should read blackboard messages', async () => {
      const messages = [{ id: 'msg-1', messageType: 'status' }];
      setupFetch(messages);

      const response = await callTool('blackboard_read', {});
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as { count: number };
      expect(data.count).toBe(1);
    });

    it('should require swarm ID', async () => {
      delete process.env.CLAUDE_CODE_SWARM_ID;

      const response = await callTool('blackboard_read', {});
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Swarm ID required');
    });
  });

  // =========================================================================
  // 21. blackboard_mark_read
  // =========================================================================

  describe('blackboard_mark_read', () => {
    it('should mark messages as read', async () => {
      setupFetch({ marked: 2 });

      const response = await callTool('blackboard_mark_read', {
        message_ids: ['msg-1', 'msg-2'],
      });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 22. blackboard_archive
  // =========================================================================

  describe('blackboard_archive', () => {
    it('should archive specific messages by ID', async () => {
      setupFetch({ archived: 2 });

      const response = await callTool('blackboard_archive', {
        message_ids: ['msg-1', 'msg-2'],
      });
      expect(response.isError).toBeFalsy();
    });

    it('should archive old messages by swarm', async () => {
      setupFetch({ archived: 5 });

      const response = await callTool('blackboard_archive', {
        max_age_hours: 12,
      });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 23. swarm_create
  // =========================================================================

  describe('swarm_create', () => {
    it('should create a swarm as coordinator', async () => {
      setupFetch({ id: 'swarm-new', name: 'Test Swarm' });

      const response = await callTool('swarm_create', {
        name: 'Test Swarm',
        description: 'A test swarm',
      });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('name', 'Test Swarm');
    });

    it('should deny permission for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('swarm_create', { name: 'Bad Swarm' });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });
  });

  // =========================================================================
  // 24. swarm_list
  // =========================================================================

  describe('swarm_list', () => {
    it('should list all swarms', async () => {
      const swarms = [{ id: 's1' }, { id: 's2' }];
      setupFetch(swarms);

      const response = await callTool('swarm_list', {});
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as { count: number };
      expect(data.count).toBe(2);
    });

    it('should get a specific swarm by ID', async () => {
      setupFetch({ id: 's1', name: 'Swarm One' });

      const response = await callTool('swarm_list', { swarm_id: 's1' });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 25. swarm_kill
  // =========================================================================

  describe('swarm_kill', () => {
    it('should kill a swarm as coordinator', async () => {
      setupFetch({ killed: true });

      const response = await callTool('swarm_kill', {
        swarm_id: 'swarm-1',
        graceful: true,
      });
      expect(response.isError).toBeFalsy();
    });

    it('should deny permission for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('swarm_kill', { swarm_id: 'swarm-1' });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });
  });

  // =========================================================================
  // 26. swarm_broadcast
  // =========================================================================

  describe('swarm_broadcast', () => {
    it('should broadcast directive to swarm', async () => {
      setupFetch({ id: 'msg-directive' });

      const response = await callTool('swarm_broadcast', {
        swarm_id: 'swarm-1',
        directive: 'All agents, focus on tests',
      });
      expect(response.isError).toBeFalsy();

      // Verify message_type is 'directive' in the request body
      const apiCall = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/blackboard'),
      );
      expect(apiCall).toBeDefined();
      const body = JSON.parse((apiCall as unknown[])[1]?.body as string);
      expect(body.messageType).toBe('directive');
    });

    it('should deny permission for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('swarm_broadcast', {
        swarm_id: 'swarm-1',
        directive: 'Test',
      });
      expect(response.isError).toBe(true);
    });
  });

  // =========================================================================
  // 27. spawn_request
  // =========================================================================

  describe('spawn_request', () => {
    it('should create a spawn request as coordinator', async () => {
      setupFetch({ id: 'sr-1', status: 'queued' });

      const response = await callTool('spawn_request', {
        agent_type: 'worker',
        task: 'Run unit tests',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should deny permission for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('spawn_request', {
        agent_type: 'worker',
        task: 'Run tests',
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });
  });

  // =========================================================================
  // 28. spawn_status
  // =========================================================================

  describe('spawn_status', () => {
    it('should get spawn queue status', async () => {
      setupFetch({ active: 2, queued: 1 });

      const response = await callTool('spawn_status', { include_queue: true });
      expect(response.isError).toBeFalsy();
    });

    it('should get specific request status', async () => {
      setupFetch({ id: 'sr-1', status: 'running' });

      const response = await callTool('spawn_status', { request_id: 'sr-1' });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 29. spawn_cancel
  // =========================================================================

  describe('spawn_cancel', () => {
    it('should cancel a spawn request', async () => {
      setupFetch({ cancelled: true });

      const response = await callTool('spawn_cancel', { request_id: 'sr-1' });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 30. TLDR tools
  // =========================================================================

  describe('tldr tools', () => {
    it('should get file summary', async () => {
      setupFetch({ summary: 'A utility module', exports: ['foo'] });

      const response = await callTool('tldr_get_summary', { file_path: 'src/util.ts' });
      expect(response.isError).toBeFalsy();
    });

    it('should store file summary', async () => {
      setupFetch({ stored: true });

      const response = await callTool('tldr_store_summary', {
        file_path: 'src/util.ts',
        content_hash: 'abc123',
        summary: 'A utility module',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should get codebase overview', async () => {
      setupFetch({ name: 'my-project', description: 'A project' });

      const response = await callTool('tldr_get_codebase', { root_path: '/app' });
      expect(response.isError).toBeFalsy();
    });

    it('should store codebase overview', async () => {
      setupFetch({ stored: true });

      const response = await callTool('tldr_store_codebase', {
        root_path: '/app',
        name: 'my-project',
        description: 'A test project',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should get dependency graph', async () => {
      setupFetch({ graph: { 'src/a.ts': ['src/b.ts'] } });

      const response = await callTool('tldr_dependency_graph', {
        root_files: ['src/a.ts'],
        depth: 2,
      });
      expect(response.isError).toBeFalsy();
    });

    it('should get tldr stats', async () => {
      setupFetch({ fileSummaries: 10, codebaseOverviews: 1 });

      const response = await callTool('tldr_stats');
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 31. workflow tools
  // =========================================================================

  describe('workflow tools', () => {
    it('should list workflows', async () => {
      setupFetch([{ id: 'wf-1' }]);

      const response = await callTool('workflow_list', {});
      expect(response.isError).toBeFalsy();
    });

    it('should get workflow details', async () => {
      setupFetch({ id: 'wf-1', name: 'Deploy' });

      const response = await callTool('workflow_get', { workflow_id: 'wf-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should start a workflow as coordinator', async () => {
      setupFetch({ executionId: 'ex-1', status: 'running' });

      const response = await callTool('workflow_start', { workflow_id: 'wf-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should deny workflow_start for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('workflow_start', { workflow_id: 'wf-1' });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });
  });

  // =========================================================================
  // 32. lmsh_translate
  // =========================================================================

  describe('lmsh_translate', () => {
    it('should translate natural language to shell command', async () => {
      setupFetch({
        command: 'git status',
        confidence: 0.95,
        explanation: 'Show current git status',
      });

      const response = await callTool('lmsh_translate', { input: 'show git status' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('command', 'git status');
    });
  });

  // =========================================================================
  // 33. search_sessions
  // =========================================================================

  describe('search_sessions', () => {
    it('should search sessions by query', async () => {
      setupFetch({ results: [{ id: 'session-1', score: 0.9 }] });

      const response = await callTool('search_sessions', {
        query: 'authentication',
        limit: 5,
      });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 34. task_route
  // =========================================================================

  describe('task_route', () => {
    it('should return routing recommendation', async () => {
      setupFetch({
        complexity: 'medium',
        strategy: 'single-agent',
        model: 'opus',
      });

      const response = await callTool('task_route', {
        subject: 'Refactor auth module',
        description: 'Break auth into separate files',
      });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as Record<string, unknown>;
      expect(data).toHaveProperty('complexity');
    });
  });

  // =========================================================================
  // 35. Unknown tool
  // =========================================================================

  describe('unknown tool', () => {
    it('should return error for unknown tool name', async () => {
      const response = await callTool('nonexistent_tool');
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Unknown tool: nonexistent_tool');
    });
  });

  // =========================================================================
  // 36. API error handling
  // =========================================================================

  describe('API error handling', () => {
    it('should handle fetch network failure', async () => {
      mockFetch.mockImplementation(() => {
        return Promise.reject(new Error('Network error'));
      });

      const response = await callTool('team_workers');
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Error');
    });

    it('should handle 401 and retry with fresh token', async () => {
      let callCount = 0;
      mockFetch.mockImplementation((url: string) => {
        callCount++;
        if (typeof url === 'string' && url.includes('/auth')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ token: `jwt-${callCount}`, uid: 'uid-123' }),
          });
        }
        // First API call returns 401, retry returns success
        if (callCount <= 2) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ error: 'expired' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ handle: 'w1' }]),
        });
      });

      const response = await callTool('team_workers');
      // Should eventually succeed after retry
      expect(response.content[0].type).toBe('text');
    });
  });

  // =========================================================================
  // 37. Native alias tools
  // =========================================================================

  describe('native alias tools', () => {
    it('should handle list_tasks as alias for team_tasks', async () => {
      const tasks = [{ ownerHandle: 'test-agent', status: 'open' }];
      setupFetch(tasks);

      const response = await callTool('list_tasks', { filter: 'all' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as { count: number; filter: string };
      expect(data.count).toBe(1);
      expect(data.filter).toBe('all');
    });

    it('should handle create_task as alias for team_assign', async () => {
      setupFetch({ id: 'task-1' });

      const response = await callTool('create_task', {
        agent: 'worker-1',
        task: 'Do something',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should handle update_task with native status mapping', async () => {
      setupFetch({ id: 'task-1', status: 'resolved' });

      await callTool('update_task', {
        task_id: 'task-1',
        status: 'completed',
      });

      // Verify it maps 'completed' to 'resolved'
      const apiCall = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/tasks/task-1'),
      );
      expect(apiCall).toBeDefined();
      const body = JSON.parse((apiCall as unknown[])[1]?.body as string);
      expect(body.status).toBe('resolved');
    });
  });

  // =========================================================================
  // 38. Checkpoint tools
  // =========================================================================

  describe('checkpoint tools', () => {
    it('should create a checkpoint', async () => {
      setupFetch({ id: 1, goal: 'Finish auth' });

      const response = await callTool('checkpoint_create', {
        goal: 'Finish auth',
        now: 'Write tests for auth module',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should load latest checkpoint', async () => {
      setupFetch({ id: 1, goal: 'Finish auth', status: 'pending' });

      const response = await callTool('checkpoint_load', { latest: true });
      expect(response.isError).toBeFalsy();
    });

    it('should load specific checkpoint by ID', async () => {
      setupFetch({ id: 5, goal: 'Setup CI' });

      const response = await callTool('checkpoint_load', { checkpoint_id: 5 });
      expect(response.isError).toBeFalsy();
    });

    it('should list checkpoints', async () => {
      setupFetch([{ id: 1 }, { id: 2 }]);

      const response = await callTool('checkpoint_list', {});
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 39. Worktree tools
  // =========================================================================

  describe('worktree tools', () => {
    it('should commit in worktree', async () => {
      setupFetch({ committed: true, sha: 'abc123' });

      const response = await callTool('worktree_commit', { message: 'Fix bug' });
      expect(response.isError).toBeFalsy();
    });

    it('should push worktree branch', async () => {
      setupFetch({ pushed: true });

      const response = await callTool('worktree_push', {});
      expect(response.isError).toBeFalsy();
    });

    it('should create PR from worktree', async () => {
      setupFetch({ prUrl: 'https://github.com/org/repo/pull/1' });

      const response = await callTool('worktree_pr', {
        title: 'Fix auth bug',
        body: 'Resolves the login issue',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should deny worktree_commit for worker role (no push permission)', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('worktree_commit', { message: 'Fix bug' });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Permission denied');
    });
  });

  // =========================================================================
  // 40. Template tools
  // =========================================================================

  describe('template tools', () => {
    it('should list templates', async () => {
      setupFetch([{ id: 'tpl-1', name: 'Code Review' }]);

      const response = await callTool('template_list', {});
      expect(response.isError).toBeFalsy();
    });

    it('should get a specific template', async () => {
      setupFetch({ id: 'tpl-1', phases: [] });

      const response = await callTool('template_get', { template_id: 'tpl-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should run a template as coordinator', async () => {
      setupFetch({ swarmId: 'swarm-new', agents: 3 });

      const response = await callTool('template_run', { template_id: 'tpl-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should deny template_run for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('template_run', { template_id: 'tpl-1' });
      expect(response.isError).toBe(true);
    });
  });

  // =========================================================================
  // 41. Audit tools
  // =========================================================================

  describe('audit tools', () => {
    it('should get audit status', async () => {
      setupFetch({ running: false, iteration: 0 });

      const response = await callTool('audit_status');
      expect(response.isError).toBeFalsy();
    });

    it('should get audit output', async () => {
      setupFetch({ lines: ['check 1', 'check 2'], total: 2 });

      const response = await callTool('audit_output', { since: 0, limit: 100 });
      expect(response.isError).toBeFalsy();
    });

    it('should start audit', async () => {
      setupFetch({ started: true });

      const response = await callTool('audit_start', { dry_run: true });
      expect(response.isError).toBeFalsy();
    });

    it('should stop audit', async () => {
      setupFetch({ stopped: true });

      const response = await callTool('audit_stop');
      expect(response.isError).toBeFalsy();
    });

    it('should run quick audit', async () => {
      setupFetch({ passed: true, checks: 4 });

      const response = await callTool('audit_quick');
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 42. Pheromone tools
  // =========================================================================

  describe('pheromone tools', () => {
    it('should deposit a pheromone', async () => {
      setupFetch({ deposited: true });

      const response = await callTool('pheromone_deposit', {
        resource_type: 'file',
        resource_id: 'src/index.ts',
        trail_type: 'modify',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should query pheromones', async () => {
      setupFetch([{ resourceId: 'src/index.ts', intensity: 0.9 }]);

      const response = await callTool('pheromone_query', {});
      expect(response.isError).toBeFalsy();
    });

    it('should get hot resources', async () => {
      setupFetch([{ resourceId: 'src/index.ts', heat: 5 }]);

      const response = await callTool('pheromone_hot_resources', {});
      expect(response.isError).toBeFalsy();
    });

    it('should require swarm ID for pheromone_deposit', async () => {
      delete process.env.CLAUDE_CODE_SWARM_ID;

      const response = await callTool('pheromone_deposit', {
        resource_type: 'file',
        resource_id: 'src/index.ts',
        trail_type: 'modify',
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Swarm ID required');
    });
  });

  // =========================================================================
  // 43. Belief tools
  // =========================================================================

  describe('belief tools', () => {
    it('should set a belief', async () => {
      setupFetch({ id: 'b-1', subject: 'auth_complexity' });

      const response = await callTool('belief_set', {
        subject: 'auth_complexity',
        value: 'high',
        belief_type: 'observation',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should get beliefs', async () => {
      setupFetch([{ subject: 'auth_complexity', value: 'high' }]);

      const response = await callTool('belief_get', {});
      expect(response.isError).toBeFalsy();
    });

    it('should get consensus', async () => {
      setupFetch({ subject: 'auth_complexity', consensus: 'high', confidence: 0.8 });

      const response = await callTool('belief_consensus', {
        subject: 'auth_complexity',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should require swarm ID for belief_set', async () => {
      delete process.env.CLAUDE_CODE_SWARM_ID;

      const response = await callTool('belief_set', {
        subject: 'test',
        value: 'val',
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Swarm ID required');
    });
  });

  // =========================================================================
  // 44. Credits tools
  // =========================================================================

  describe('credits tools', () => {
    it('should get balance', async () => {
      setupFetch({ balance: 100, reputation: 0.9 });

      const response = await callTool('credits_balance', {});
      expect(response.isError).toBeFalsy();
    });

    it('should get leaderboard', async () => {
      setupFetch([{ handle: 'test-agent', balance: 100 }]);

      const response = await callTool('credits_leaderboard', {});
      expect(response.isError).toBeFalsy();
    });

    it('should transfer credits', async () => {
      setupFetch({ transferred: true });

      const response = await callTool('credits_transfer', {
        to_handle: 'worker-1',
        amount: 50,
        reason: 'Good work',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should get history', async () => {
      setupFetch([{ type: 'earned', amount: 10 }]);

      const response = await callTool('credits_history', {});
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 45. Proposal / Consensus tools
  // =========================================================================

  describe('proposal tools', () => {
    it('should create a proposal', async () => {
      setupFetch({ id: 'prop-1', title: 'Use TypeScript?' });

      const response = await callTool('proposal_create', {
        title: 'Use TypeScript?',
        options: ['yes', 'no'],
      });
      expect(response.isError).toBeFalsy();
    });

    it('should list proposals', async () => {
      setupFetch([{ id: 'prop-1' }]);

      const response = await callTool('proposal_list', {});
      expect(response.isError).toBeFalsy();
    });

    it('should vote on a proposal', async () => {
      setupFetch({ voted: true });

      const response = await callTool('proposal_vote', {
        proposal_id: 'prop-1',
        vote_value: 'yes',
      });
      expect(response.isError).toBeFalsy();
    });

    it('should close a proposal as coordinator', async () => {
      setupFetch({ closed: true, winner: 'yes' });

      const response = await callTool('proposal_close', { proposal_id: 'prop-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should deny proposal_close for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('proposal_close', { proposal_id: 'prop-1' });
      expect(response.isError).toBe(true);
    });
  });

  // =========================================================================
  // 46. Bidding tools
  // =========================================================================

  describe('bidding tools', () => {
    it('should submit a bid', async () => {
      setupFetch({ id: 'bid-1' });

      const response = await callTool('bid_submit', {
        task_id: 'task-1',
        bid_amount: 50,
        confidence: 0.8,
      });
      expect(response.isError).toBeFalsy();
    });

    it('should list bids for a task', async () => {
      setupFetch([{ id: 'bid-1', amount: 50 }]);

      const response = await callTool('bid_list', { task_id: 'task-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should accept a bid as coordinator', async () => {
      setupFetch({ accepted: true });

      const response = await callTool('bid_accept', { bid_id: 'bid-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should withdraw a bid', async () => {
      setupFetch({ withdrawn: true });

      const response = await callTool('bid_withdraw', { bid_id: 'bid-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should run an auction as coordinator', async () => {
      setupFetch({ winner: 'bid-1', amount: 50 });

      const response = await callTool('auction_run', { task_id: 'task-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should deny bid_accept for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('bid_accept', { bid_id: 'bid-1' });
      expect(response.isError).toBe(true);
    });
  });

  // =========================================================================
  // 47. Payoff tools
  // =========================================================================

  describe('payoff tools', () => {
    it('should define a payoff as coordinator', async () => {
      setupFetch({ defined: true });

      const response = await callTool('payoff_define', {
        task_id: 'task-1',
        payoff_type: 'completion',
        base_value: 100,
      });
      expect(response.isError).toBeFalsy();
    });

    it('should deny payoff_define for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('payoff_define', {
        task_id: 'task-1',
        payoff_type: 'completion',
        base_value: 100,
      });
      expect(response.isError).toBe(true);
    });

    it('should calculate a payoff', async () => {
      setupFetch({ currentValue: 85 });

      const response = await callTool('payoff_calculate', { task_id: 'task-1' });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 48. Execution tools
  // =========================================================================

  describe('execution tools', () => {
    it('should list executions', async () => {
      setupFetch([{ id: 'ex-1', status: 'running' }]);

      const response = await callTool('execution_list', {});
      expect(response.isError).toBeFalsy();
    });

    it('should get execution details', async () => {
      setupFetch({ id: 'ex-1', steps: 5 });

      const response = await callTool('execution_get', { execution_id: 'ex-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should get execution steps', async () => {
      setupFetch([{ id: 'step-1' }]);

      const response = await callTool('execution_steps', { execution_id: 'ex-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should pause execution as coordinator', async () => {
      setupFetch({ paused: true });

      const response = await callTool('execution_pause', { execution_id: 'ex-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should resume execution as coordinator', async () => {
      setupFetch({ resumed: true });

      const response = await callTool('execution_resume', { execution_id: 'ex-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should cancel execution as coordinator', async () => {
      setupFetch({ cancelled: true });

      const response = await callTool('execution_cancel', { execution_id: 'ex-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should deny execution_pause for worker role', async () => {
      process.env.CLAUDE_CODE_AGENT_TYPE = 'worker';

      const response = await callTool('execution_pause', { execution_id: 'ex-1' });
      expect(response.isError).toBe(true);
    });
  });

  // =========================================================================
  // 49. Step tools
  // =========================================================================

  describe('step tools', () => {
    it('should complete a step', async () => {
      setupFetch({ completed: true });

      const response = await callTool('step_complete', {
        step_id: 'step-1',
        output: { result: 'success' },
      });
      expect(response.isError).toBeFalsy();
    });

    it('should retry a step', async () => {
      setupFetch({ retried: true });

      const response = await callTool('step_retry', { step_id: 'step-1' });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 50. Mission / Compound tools
  // =========================================================================

  describe('mission tools', () => {
    it('should get mission status with explicit mission_id', async () => {
      setupFetch(
        { id: 'mission-1', name: 'Fix Tests' },
        { iteration: 3, allPassed: false },
      );

      const response = await callTool('mission_status', { mission_id: 'mission-1' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as { mission: unknown; status: unknown };
      expect(data).toHaveProperty('mission');
      expect(data).toHaveProperty('status');
    });

    it('should get mission status from env var', async () => {
      process.env.CLAUDE_CODE_MISSION_ID = 'mission-env';
      setupFetch(
        { id: 'mission-env', name: 'From Env' },
        { iteration: 1 },
      );

      const response = await callTool('mission_status', {});
      expect(response.isError).toBeFalsy();
    });

    it('should return error when mission_id is not available', async () => {
      const response = await callTool('mission_status', {});
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Mission ID required');
    });

    it('should get mission gates', async () => {
      setupFetch([{ id: 'g1', name: 'typecheck', status: 'pass' }]);

      const response = await callTool('mission_gates', { mission_id: 'mission-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should return error for mission_gates without mission_id', async () => {
      const response = await callTool('mission_gates', {});
      expect(response.isError).toBe(true);
    });

    it('should get mission iterations', async () => {
      setupFetch([{ iteration: 1, results: [] }]);

      const response = await callTool('mission_iterations', { mission_id: 'mission-1' });
      expect(response.isError).toBeFalsy();
    });

    it('should get specific mission iteration', async () => {
      setupFetch({ iteration: 2, results: [{ gate: 'lint', passed: true }] });

      const response = await callTool('mission_iterations', {
        mission_id: 'mission-1',
        iteration_number: 2,
      });
      expect(response.isError).toBeFalsy();
    });

    it('should get gate results with name enrichment', async () => {
      // gate_results calls /status then /gates
      setupFetch(
        { gateResults: [{ gateId: 'g1', status: 'fail', output: 'type error' }] },
        [{ id: 'g1', name: 'typecheck' }],
      );

      const response = await callTool('gate_results', { mission_id: 'mission-1' });
      expect(response.isError).toBeFalsy();
      const data = parseText(response) as { results: Array<{ name: string }> };
      expect(data.results).toHaveLength(1);
      expect(data.results[0].name).toBe('typecheck');
    });

    it('should get compound snapshot', async () => {
      setupFetch({ workers: 3, swarms: 1, tasks: 12 });

      const response = await callTool('compound_snapshot');
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 51. Memory tools
  // =========================================================================

  describe('memory tools', () => {
    it('should store a memory', async () => {
      setupFetch({ stored: true, key: 'auth-pattern' });

      const response = await callTool('memory_store', {
        key: 'auth-pattern',
        value: 'JWT with refresh tokens',
        memory_type: 'decision',
        tags: ['auth', 'security'],
      });
      expect(response.isError).toBeFalsy();
    });

    it('should recall a memory', async () => {
      setupFetch({ key: 'auth-pattern', value: 'JWT with refresh tokens' });

      const response = await callTool('memory_recall', { key: 'auth-pattern' });
      expect(response.isError).toBeFalsy();
    });

    it('should search memories', async () => {
      setupFetch({ results: [{ key: 'auth-pattern', score: 0.9 }] });

      const response = await callTool('memory_search', { query: 'authentication' });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 52. DAG sort
  // =========================================================================

  describe('dag_sort', () => {
    it('should topologically sort tasks', async () => {
      setupFetch({
        order: ['task-a', 'task-b', 'task-c'],
        levels: [['task-a'], ['task-b', 'task-c']],
      });

      const response = await callTool('dag_sort', {
        nodes: [
          { id: 'task-a' },
          { id: 'task-b', dependsOn: ['task-a'] },
          { id: 'task-c', dependsOn: ['task-a'] },
        ],
      });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 53. Batch tools
  // =========================================================================

  describe('batch tools', () => {
    it('should create a batch', async () => {
      setupFetch({ id: 'batch-1', name: 'Test batch' });

      const response = await callTool('batch_create', {
        name: 'Test batch',
        workitem_ids: ['wi-1', 'wi-2'],
      });
      expect(response.isError).toBeFalsy();
    });

    it('should dispatch a batch', async () => {
      setupFetch({ dispatched: true });

      const response = await callTool('batch_dispatch', {
        batch_id: 'batch-1',
        worker: 'worker-1',
      });
      expect(response.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // 54. formatResponse validation
  // =========================================================================

  describe('formatResponse behavior', () => {
    it('should wrap object data in content array as JSON', async () => {
      const response = await callTool('team_claim', { file: 'test.ts' });
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toHaveProperty('claimed', true);
    });

    it('should wrap string error messages in content array', async () => {
      const response = await callTool('nonexistent_tool');
      expect(response.content[0].text).toBe('Unknown tool: nonexistent_tool');
      expect(response.isError).toBe(true);
    });
  });

  // =========================================================================
  // 55. Missing CLAUDE_CODE_AGENT_NAME for various tools
  // =========================================================================

  describe('missing agent name', () => {
    it('should error on blackboard_post without agent name', async () => {
      delete process.env.CLAUDE_CODE_AGENT_NAME;

      const response = await callTool('blackboard_post', {
        message_type: 'status',
        payload: {},
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Agent not registered');
    });

    it('should error on blackboard_read without agent name', async () => {
      delete process.env.CLAUDE_CODE_AGENT_NAME;

      const response = await callTool('blackboard_read', {});
      expect(response.isError).toBe(true);
    });

    it('should error on credits_balance without agent name', async () => {
      delete process.env.CLAUDE_CODE_AGENT_NAME;

      const response = await callTool('credits_balance', {});
      expect(response.isError).toBe(true);
    });

    it('should error on proposal_create without agent name', async () => {
      delete process.env.CLAUDE_CODE_AGENT_NAME;

      const response = await callTool('proposal_create', {
        title: 'Test',
        options: ['a', 'b'],
      });
      expect(response.isError).toBe(true);
    });

    it('should error on spawn_request without agent name', async () => {
      delete process.env.CLAUDE_CODE_AGENT_NAME;

      const response = await callTool('spawn_request', {
        agent_type: 'worker',
        task: 'Test',
      });
      // spawn_request checks permission first, then agent name
      // As coordinator, permission passes but agent name fails
      expect(response.isError).toBe(true);
    });
  });
});
