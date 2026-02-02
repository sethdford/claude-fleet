/**
 * Tests for CLI module
 *
 * Tests command parsing, validation, HTTP requests, and output formatting.
 * Mocks: node:child_process, node:fs, node:util (parseArgs), global.fetch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==========================================================================
// Hoisted mocks for variables needed inside vi.mock factories
// ==========================================================================

const mockParseArgs = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockResolve = vi.hoisted(() => vi.fn((p: string) => p));
const mockJoin = vi.hoisted(() => vi.fn((...args: string[]) => args.join('/')));

// ==========================================================================
// Module mocks
// ==========================================================================

vi.mock('node:util', () => ({
  parseArgs: mockParseArgs,
}));

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
  spawn: mockSpawn,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('node:path', () => ({
  join: mockJoin,
  resolve: mockResolve,
}));

vi.mock('node:module', () => ({
  createRequire: () => () => ({ version: '3.0.0-test' }),
}));

// Mock the compound runner to prevent real import issues
vi.mock('./compound/runner.js', () => ({
  CompoundRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ status: 'succeeded' }),
  })),
}));

// ==========================================================================
// Test helpers
// ==========================================================================

/** Create a fake JWT token with given payload */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

/** Create a mock Response object for fetch */
function mockResponse(data: unknown, status = 200, contentType = 'application/json'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name: string) => {
        if (name === 'content-type') return contentType;
        return null;
      },
    },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

/** Default parseArgs return for testing a specific command */
function setupParseArgs(
  positionals: string[],
  overrides: Record<string, unknown> = {}
): void {
  mockParseArgs.mockReturnValue({
    values: {
      url: 'http://localhost:3847',
      token: undefined,
      help: false,
      version: false,
      verbose: false,
      table: false,
      template: false,
      live: false,
      ...overrides,
    },
    positionals,
  });
}

// Track console output and process.exit
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let processExitSpy: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

// Helper to dynamically import the CLI (re-runs main())
async function runCli(): Promise<void> {
  vi.resetModules();

  // Re-apply all mocks after resetModules
  vi.doMock('node:util', () => ({ parseArgs: mockParseArgs }));
  vi.doMock('node:child_process', () => ({ execSync: mockExecSync, spawn: mockSpawn }));
  vi.doMock('node:fs', () => ({
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    readFileSync: mockReadFileSync,
  }));
  vi.doMock('node:path', () => ({ join: mockJoin, resolve: mockResolve }));
  vi.doMock('node:module', () => ({
    createRequire: () => () => ({ version: '3.0.0-test' }),
  }));
  vi.doMock('./compound/runner.js', () => ({
    CompoundRunner: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({ status: 'succeeded' }),
    })),
  }));

  await import('./cli.js');

  // Wait a tick for async operations
  await new Promise(resolve => setTimeout(resolve, 10));
}

// ==========================================================================
// Tests
// ==========================================================================

describe('CLI Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      // No-op: prevent process from actually exiting
    }) as never);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ status: 'ok' }));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  // ========================================================================
  // Help & Version
  // ========================================================================

  describe('help and version', () => {
    it('should print version with --version flag', async () => {
      setupParseArgs([], { version: true });
      await runCli();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('fleet v'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should print help with --help flag', async () => {
      setupParseArgs([], { help: true });
      await runCli();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Claude Fleet CLI'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should print help when no positionals', async () => {
      setupParseArgs([]);
      await runCli();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Claude Fleet CLI'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  // ========================================================================
  // Core Commands
  // ========================================================================

  describe('core commands', () => {
    it('should execute health command', async () => {
      const healthData = { status: 'ok', version: '3.0.0' };
      fetchSpy.mockResolvedValue(mockResponse(healthData));
      setupParseArgs(['health']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/health',
        expect.objectContaining({ method: 'GET' })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(healthData, null, 2));
    });

    it('should execute metrics command', async () => {
      const metricsData = { requests: 100 };
      fetchSpy.mockResolvedValue(mockResponse(metricsData));
      setupParseArgs(['metrics']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/metrics/json',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should execute debug command', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ debug: true }));
      setupParseArgs(['debug']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/debug',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should execute auth command with valid args', async () => {
      const authResp = { token: 'eyJ...' };
      fetchSpy.mockResolvedValue(mockResponse(authResp));
      setupParseArgs(['auth', 'alice', 'my-team', 'team-lead']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/auth',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ handle: 'alice', teamName: 'my-team', agentType: 'team-lead' }),
        })
      );
    });

    it('should default agentType to worker for auth', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ token: 'eyJ...' }));
      setupParseArgs(['auth', 'bob', 'team-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/auth',
        expect.objectContaining({
          body: JSON.stringify({ handle: 'bob', teamName: 'team-1', agentType: 'worker' }),
        })
      );
    });

    it('should exit with error when auth has insufficient args', async () => {
      setupParseArgs(['auth', 'alice']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet auth'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // HTTP Helper
  // ========================================================================

  describe('HTTP request helper', () => {
    it('should include Authorization header when token is set', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ status: 'ok' }));
      setupParseArgs(['health'], { token: 'my-jwt-token' });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer my-jwt-token',
          }),
        })
      );
    });

    it('should log verbose info when verbose is true', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ status: 'ok' }));
      setupParseArgs(['health'], { verbose: true });
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[verbose] GET'));
    });

    it('should handle connection refused errors', async () => {
      fetchSpy.mockRejectedValue(new Error('fetch failed'));
      setupParseArgs(['health']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error:',
        expect.stringContaining('Cannot connect to server')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle non-JSON error responses', async () => {
      fetchSpy.mockResolvedValue(mockResponse(
        'Internal Server Error',
        500,
        'text/plain'
      ));
      setupParseArgs(['health']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error:',
        expect.stringContaining('Server returned non-JSON response')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle JSON error responses', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ error: 'Unauthorized' }, 401));
      setupParseArgs(['health']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', 'Unauthorized');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should use custom server URL from options', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ status: 'ok' }));
      setupParseArgs(['health'], { url: 'http://custom:9999' });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://custom:9999/health',
        expect.anything()
      );
    });
  });

  // ========================================================================
  // Team Commands
  // ========================================================================

  describe('team commands', () => {
    it('should list team agents', async () => {
      const agents = [{ handle: 'alice', uid: '123', agentType: 'worker' }];
      fetchSpy.mockResolvedValue(mockResponse(agents));
      setupParseArgs(['teams', 'my-team']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/teams/my-team/agents',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should require teamName for teams command', async () => {
      setupParseArgs(['teams']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet teams'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should list team tasks', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['tasks', 'my-team']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/teams/my-team/tasks',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should require teamName for tasks command', async () => {
      setupParseArgs(['tasks']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet tasks'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should output teams as table when --table is set', async () => {
      const agents = [
        { handle: 'alice', uid: 'abc123def456', agentType: 'worker' },
        { handle: 'bob', uid: 'xyz789ghi012', agentType: 'team-lead' },
      ];
      fetchSpy.mockResolvedValue(mockResponse(agents));
      setupParseArgs(['teams', 'my-team'], { table: true });
      await runCli();

      // When table=true, output should include table headers
      const logOutput = consoleLogSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(logOutput).toContain('HANDLE');
    });
  });

  // ========================================================================
  // Worker Commands
  // ========================================================================

  describe('worker commands', () => {
    it('should list workers', async () => {
      const workersResp = { workers: [{ handle: 'w1', state: 'running', pid: 123 }] };
      fetchSpy.mockResolvedValue(mockResponse(workersResp));
      setupParseArgs(['workers']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/workers',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should spawn a worker', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ handle: 'w1', pid: 456 }));
      setupParseArgs(['spawn', 'worker-1', 'Fix', 'the', 'bug']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/spawn',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            handle: 'worker-1',
            initialPrompt: 'Fix the bug',
            role: 'worker',
          }),
        })
      );
    });

    it('should spawn with --spawn-mode', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ handle: 'w1' }));
      setupParseArgs(['spawn', 'worker-1', 'Do', 'task'], { 'spawn-mode': 'tmux' });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/spawn',
        expect.objectContaining({
          body: expect.stringContaining('"spawnMode":"tmux"'),
        })
      );
    });

    it('should reject invalid spawn mode', async () => {
      setupParseArgs(['spawn', 'worker-1', 'Do', 'task'], { 'spawn-mode': 'invalid' });
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid spawn mode'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should require args for spawn', async () => {
      setupParseArgs(['spawn', 'worker-1']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet spawn'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should dismiss a worker', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ dismissed: true }));
      setupParseArgs(['dismiss', 'worker-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/dismiss/worker-1',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should require handle for dismiss', async () => {
      setupParseArgs(['dismiss']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet dismiss'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should send message to worker', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ sent: true }));
      setupParseArgs(['send', 'worker-1', 'hello', 'world']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/send/worker-1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'hello world' }),
        })
      );
    });

    it('should get worker output', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ output: 'done' }));
      setupParseArgs(['output', 'worker-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/output/worker-1',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  // ========================================================================
  // Worktree Commands
  // ========================================================================

  describe('worktree commands', () => {
    it('should get worktree status', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ branch: 'main' }));
      setupParseArgs(['worktree-status', 'worker-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/worktree/worker-1/status',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should commit in worktree', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ committed: true }));
      setupParseArgs(['worktree-commit', 'worker-1', 'Fix', 'auth']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/worktree/worker-1/commit',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Fix auth' }),
        })
      );
    });

    it('should push worktree', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ pushed: true }));
      setupParseArgs(['worktree-push', 'worker-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/worktree/worker-1/push',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should create PR from worktree', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ prUrl: 'https://github.com/...' }));
      setupParseArgs(['worktree-pr', 'worker-1', 'Fix-title', 'PR', 'body', 'text']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/orchestrate/worktree/worker-1/pr',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Fix-title', body: 'PR body text' }),
        })
      );
    });

    it('should require args for worktree-pr', async () => {
      setupParseArgs(['worktree-pr', 'worker-1', 'title']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet worktree-pr'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Task Commands
  // ========================================================================

  describe('task commands', () => {
    it('should get task by id', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'task-1', status: 'open' }));
      setupParseArgs(['task', 'task-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/tasks/task-1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should require taskId for task command', async () => {
      setupParseArgs(['task']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet task'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should create a task with token', async () => {
      const token = fakeJwt({ uid: 'abc123def456789012345678', handle: 'alice', teamName: 'team-1', agentType: 'team-lead' });
      fetchSpy.mockResolvedValue(mockResponse({ id: 'task-2' }));
      setupParseArgs(['task-create', 'bob', 'Fix login bug', 'JWT is broken'], { token });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/tasks',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"toHandle":"bob"'),
        })
      );
    });

    it('should require token for task-create', async () => {
      setupParseArgs(['task-create', 'bob', 'Fix bug']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Authentication required'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should require subject length >= 3 for task-create', async () => {
      const token = fakeJwt({ uid: 'abc123', handle: 'alice', teamName: 'team-1', agentType: 'team-lead' });
      setupParseArgs(['task-create', 'bob', 'ab'], { token });
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Subject must be at least 3'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should update task status', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ updated: true }));
      setupParseArgs(['task-update', 'task-1', 'resolved']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/tasks/task-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'resolved' }),
        })
      );
    });

    it('should reject invalid task status', async () => {
      setupParseArgs(['task-update', 'task-1', 'invalid_status']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid task status'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Work Item Commands
  // ========================================================================

  describe('work item commands', () => {
    it('should list all work items', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['workitems']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/workitems',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should list work items filtered by status', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['workitems', 'pending']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/workitems?status=pending',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should reject invalid work item status filter', async () => {
      setupParseArgs(['workitems', 'bad_status']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid status'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should create a work item', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'wi-1' }));
      setupParseArgs(['workitem-create', 'Fix login', 'JWT broken', 'alice']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/workitems',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Fix login', description: 'JWT broken', assignedTo: 'alice' }),
        })
      );
    });

    it('should update work item status', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ updated: true }));
      setupParseArgs(['workitem-update', 'wi-1', 'completed', 'done']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/workitems/wi-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed', reason: 'done' }),
        })
      );
    });

    it('should reject invalid work item status for update', async () => {
      setupParseArgs(['workitem-update', 'wi-1', 'bogus']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid status'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Batch Commands
  // ========================================================================

  describe('batch commands', () => {
    it('should list batches', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['batches']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/batches',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create a batch', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'batch-1' }));
      setupParseArgs(['batch-create', 'my-batch', 'wi-1', 'wi-2']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/batches',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'my-batch', workItemIds: ['wi-1', 'wi-2'] }),
        })
      );
    });

    it('should create a batch without work item ids', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'batch-2' }));
      setupParseArgs(['batch-create', 'empty-batch']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/batches',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'empty-batch' }),
        })
      );
    });

    it('should dispatch a batch', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ dispatched: true }));
      setupParseArgs(['batch-dispatch', 'batch-1', 'worker-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/batches/batch-1/dispatch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ workerHandle: 'worker-1' }),
        })
      );
    });
  });

  // ========================================================================
  // Mail Commands
  // ========================================================================

  describe('mail commands', () => {
    it('should get unread mail', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['mail', 'alice']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/mail/alice/unread',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should require handle for mail', async () => {
      setupParseArgs(['mail']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet mail'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should send mail', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ sent: true }));
      setupParseArgs(['mail-send', 'alice', 'bob', 'Hello!', 'Greeting']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/mail',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ from: 'alice', to: 'bob', body: 'Hello!', subject: 'Greeting' }),
        })
      );
    });

    it('should require args for mail-send', async () => {
      setupParseArgs(['mail-send', 'alice', 'bob']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet mail-send'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Handoff Commands
  // ========================================================================

  describe('handoff commands', () => {
    it('should list handoffs', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['handoffs', 'alice']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/handoffs/alice',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create handoff with valid JSON', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'ho-1' }));
      setupParseArgs(['handoff-create', 'alice', 'bob', '{"task":"done"}']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/handoffs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ from: 'alice', to: 'bob', context: { task: 'done' } }),
        })
      );
    });

    it('should reject handoff with invalid JSON', async () => {
      setupParseArgs(['handoff-create', 'alice', 'bob', 'not-json']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Context must be valid JSON'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should require args for handoff-create', async () => {
      setupParseArgs(['handoff-create', 'alice', 'bob']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet handoff-create'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Checkpoint Commands
  // ========================================================================

  describe('checkpoint commands', () => {
    it('should list checkpoints', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['checkpoints', 'alice']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/checkpoints/list/alice',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should get checkpoint by id', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'cp-1' }));
      setupParseArgs(['checkpoint', 'cp-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/checkpoints/cp-1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create checkpoint', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'cp-2' }));
      setupParseArgs(['checkpoint-create', 'alice', 'Fix auth', 'Deploy staging']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/checkpoints',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alice',
            toHandle: 'alice',
            goal: 'Fix auth',
            now: 'Deploy staging',
          }),
        })
      );
    });

    it('should create checkpoint with toHandle', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'cp-3' }));
      setupParseArgs(['checkpoint-create', 'alice', 'Fix auth', 'Now deploying', 'bob']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/checkpoints',
        expect.objectContaining({
          body: expect.stringContaining('"toHandle":"bob"'),
        })
      );
    });

    it('should get latest checkpoint', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'cp-latest' }));
      setupParseArgs(['checkpoint-latest', 'alice']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/checkpoints/latest/alice',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should accept checkpoint', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ accepted: true }));
      setupParseArgs(['checkpoint-accept', 'cp-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/checkpoints/cp-1/accept',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should reject checkpoint', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ rejected: true }));
      setupParseArgs(['checkpoint-reject', 'cp-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/checkpoints/cp-1/reject',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  // ========================================================================
  // Fleet Commands (swarms, blackboard, spawn-queue)
  // ========================================================================

  describe('fleet commands', () => {
    it('should list swarms', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['swarms']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/swarms?includeAgents=true',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create swarm', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'swarm-1' }));
      setupParseArgs(['swarm-create', 'my-swarm', '5']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/swarms',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'my-swarm', maxAgents: 5 }),
        })
      );
    });

    it('should kill swarm', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ killed: true }));
      setupParseArgs(['swarm-kill', 'swarm-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/swarms/swarm-1/kill',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ graceful: true }),
        })
      );
    });

    it('should get spawn queue status', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ queue: [] }));
      setupParseArgs(['spawn-queue']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/spawn-queue/status',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should read blackboard', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['blackboard', 'swarm-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/blackboard/swarm-1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should post to blackboard with JSON payload', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ posted: true }));
      setupParseArgs(['blackboard-post', 'swarm-1', 'alice', 'status', '{"progress":50}']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/blackboard',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"progress":50'),
        })
      );
    });

    it('should post to blackboard with plain text payload', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ posted: true }));
      setupParseArgs(['blackboard-post', 'swarm-1', 'alice', 'status', 'just text']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/blackboard',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"message":"just text"'),
        })
      );
    });
  });

  // ========================================================================
  // Swarm Intelligence Commands
  // ========================================================================

  describe('swarm intelligence commands', () => {
    it('should list pheromones', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ trails: [] }));
      setupParseArgs(['pheromones', 'swarm-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/pheromones/swarm-1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should deposit pheromone trail', async () => {
      const token = fakeJwt({ uid: 'abc123', handle: 'alice', teamName: 'team-1', agentType: 'worker' });
      fetchSpy.mockResolvedValue(mockResponse({ deposited: true }));
      setupParseArgs(['pheromone-deposit', 'swarm-1', 'file.ts', 'modify'], { token });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/pheromones',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"resourceId":"file.ts"'),
        })
      );
    });

    it('should require token for pheromone-deposit', async () => {
      setupParseArgs(['pheromone-deposit', 'swarm-1', 'file.ts', 'modify']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Authentication required'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should get hot pheromone resources', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ hot: [] }));
      setupParseArgs(['pheromone-hot', 'swarm-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/pheromones/swarm-1/activity',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should list beliefs', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ beliefs: [] }));
      setupParseArgs(['beliefs', 'swarm-1', 'alice']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/beliefs/swarm-1/alice',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should set a belief', async () => {
      const token = fakeJwt({ uid: 'abc123', handle: 'alice', teamName: 'team-1', agentType: 'worker' });
      fetchSpy.mockResolvedValue(mockResponse({ set: true }));
      setupParseArgs(['belief-set', 'swarm-1', 'auth-module', 'knowledge', 'needs-refactor', '0.8'], { token });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/beliefs',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"confidence":0.8'),
        })
      );
    });

    it('should get belief consensus', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ consensus: 'agree' }));
      setupParseArgs(['belief-consensus', 'swarm-1', 'auth-module']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/beliefs/swarm-1/consensus/'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  // ========================================================================
  // Credits Commands
  // ========================================================================

  describe('credits commands', () => {
    it('should get agent credits', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ balance: 100 }));
      setupParseArgs(['credits', 'swarm-1', 'alice']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/credits/swarm-1/alice',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should get credits leaderboard', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ leaderboard: [] }));
      setupParseArgs(['credits-leaderboard', 'swarm-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/credits/swarm-1/leaderboard',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should transfer credits', async () => {
      const token = fakeJwt({ uid: 'abc123', handle: 'alice', teamName: 'team-1', agentType: 'worker' });
      fetchSpy.mockResolvedValue(mockResponse({ transferred: true }));
      setupParseArgs(['credits-transfer', 'swarm-1', 'bob', '50', 'Thanks'], { token });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/credits/transfer',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"amount":50'),
        })
      );
    });

    it('should require token for credits-transfer', async () => {
      setupParseArgs(['credits-transfer', 'swarm-1', 'bob', '50']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Authentication required'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Proposal Commands
  // ========================================================================

  describe('proposal commands', () => {
    it('should list proposals', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ proposals: [] }));
      setupParseArgs(['proposals', 'swarm-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/consensus/swarm-1/proposals',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create proposal', async () => {
      const token = fakeJwt({ uid: 'abc123', handle: 'alice', teamName: 'team-1', agentType: 'team-lead' });
      fetchSpy.mockResolvedValue(mockResponse({ id: 'prop-1' }));
      setupParseArgs(['proposal-create', 'swarm-1', 'DB choice', 'Which DB?', 'postgres,mysql,sqlite'], { token });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/consensus/proposals',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"options":["postgres","mysql","sqlite"]'),
        })
      );
    });

    it('should reject proposal with fewer than 2 options', async () => {
      const token = fakeJwt({ uid: 'abc123', handle: 'alice', teamName: 'team-1', agentType: 'team-lead' });
      setupParseArgs(['proposal-create', 'swarm-1', 'subject', 'desc', 'only_one'], { token });
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('At least 2 options required'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should vote on proposal', async () => {
      const token = fakeJwt({ uid: 'abc123', handle: 'alice', teamName: 'team-1', agentType: 'worker' });
      fetchSpy.mockResolvedValue(mockResponse({ voted: true }));
      setupParseArgs(['proposal-vote', 'prop-1', 'postgres'], { token });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/consensus/proposals/prop-1/vote',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"voteValue":"postgres"'),
        })
      );
    });

    it('should close proposal', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ closed: true }));
      setupParseArgs(['proposal-close', 'prop-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/consensus/proposals/prop-1/close',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  // ========================================================================
  // Bidding Commands
  // ========================================================================

  describe('bidding commands', () => {
    it('should list bids for task', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ bids: [] }));
      setupParseArgs(['bids', 'task-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/bids/task/task-1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should submit bid', async () => {
      const token = fakeJwt({ uid: 'abc123', handle: 'alice', teamName: 'team-1', agentType: 'worker' });
      fetchSpy.mockResolvedValue(mockResponse({ id: 'bid-1' }));
      setupParseArgs(['bid-submit', 'swarm-1', 'task-1', '100', 'I can do it'], { token });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/bids',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"bidAmount":100'),
        })
      );
    });

    it('should accept bid', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ accepted: true }));
      setupParseArgs(['bid-accept', 'bid-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/bids/bid-1/accept',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should run auction', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ winner: 'bid-1' }));
      setupParseArgs(['auction', 'task-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/bids/task/task-1/auction',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  // ========================================================================
  // Payoff Commands
  // ========================================================================

  describe('payoff commands', () => {
    it('should get payoffs', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ payoffs: [] }));
      setupParseArgs(['payoffs', 'task-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/payoffs/task-1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should define payoff', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ defined: true }));
      setupParseArgs(['payoff-define', 'task-1', 'completion', '100']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/payoffs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ taskId: 'task-1', payoffType: 'completion', baseValue: 100 }),
        })
      );
    });

    it('should calculate payoff', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ value: 150 }));
      setupParseArgs(['payoff-calculate', 'task-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/payoffs/task-1/calculate',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  // ========================================================================
  // Workflow Commands
  // ========================================================================

  describe('workflow commands', () => {
    it('should list workflows', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['workflows']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/workflows',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should list template workflows with --template flag', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['workflows'], { template: true });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/workflows?isTemplate=true',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should get workflow by id', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'wf-1' }));
      setupParseArgs(['workflow', 'wf-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/workflows/wf-1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should start workflow', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ executionId: 'exec-1' }));
      setupParseArgs(['workflow-start', 'wf-1', '{"feature":"login"}', 'swarm-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/workflows/wf-1/start',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"inputs":{"feature":"login"}'),
        })
      );
    });

    it('should list executions', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['executions']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/executions',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should list executions with status filter', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['executions', 'running']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/executions?status=running',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should get execution details', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ id: 'exec-1' }));
      setupParseArgs(['execution', 'exec-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/executions/exec-1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should get execution steps', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['execution-steps', 'exec-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/executions/exec-1/steps',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should pause execution', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ paused: true }));
      setupParseArgs(['execution-pause', 'exec-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/executions/exec-1/pause',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should resume execution', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ resumed: true }));
      setupParseArgs(['execution-resume', 'exec-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/executions/exec-1/resume',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should cancel execution', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ cancelled: true }));
      setupParseArgs(['execution-cancel', 'exec-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/executions/exec-1/cancel',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should retry step', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ retried: true }));
      setupParseArgs(['step-retry', 'step-1']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/steps/step-1/retry',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should complete step', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ completed: true }));
      setupParseArgs(['step-complete', 'step-1', '{"result":"ok"}']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/steps/step-1/complete',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"output":{"result":"ok"}'),
        })
      );
    });
  });

  // ========================================================================
  // Memory Commands
  // ========================================================================

  describe('memory commands', () => {
    it('should store memory', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ stored: true }));
      setupParseArgs(['memory-store', 'agent-1', 'my-key', 'my', 'value'], { type: 'episodic', tags: 'tag1,tag2' });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/memory/store',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"memoryType":"episodic"'),
        })
      );
    });

    it('should recall memory', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ value: 'stored data' }));
      setupParseArgs(['memory-recall', 'agent-1', 'my-key']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/memory/recall/'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should search memories', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['memory-search', 'agent-1', 'auth', 'login'], { type: 'semantic', limit: '10' });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/memory/search',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"query":"auth login"'),
        })
      );
    });

    it('should list memories', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['memory-list', 'agent-1'], { limit: '20' });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/memory/agent-1?limit=20'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should require args for memory-store', async () => {
      setupParseArgs(['memory-store', 'agent-1', 'key']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: fleet memory-store'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Routing & DAG Commands
  // ========================================================================

  describe('routing and DAG commands', () => {
    it('should classify task with route command', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ complexity: 'medium' }));
      setupParseArgs(['route', 'Fix auth', 'JWT validation failing']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/routing/classify',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"subject":"Fix auth"'),
        })
      );
    });

    it('should topological sort tasks', async () => {
      const tasks = [{ id: 't1', subject: 'A' }, { id: 't2', subject: 'B', blockedBy: ['t1'] }];
      fetchSpy.mockResolvedValueOnce(mockResponse(tasks)); // GET tasks
      fetchSpy.mockResolvedValueOnce(mockResponse({ sorted: ['t1', 't2'] })); // POST sort
      setupParseArgs(['dag-sort', 'my-team']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/teams/my-team/tasks',
        expect.anything()
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/dag/sort',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should detect cycles', async () => {
      const tasks = [{ id: 't1', blockedBy: ['t2'] }, { id: 't2', blockedBy: ['t1'] }];
      fetchSpy.mockResolvedValueOnce(mockResponse(tasks));
      fetchSpy.mockResolvedValueOnce(mockResponse({ cycles: [['t1', 't2']] }));
      setupParseArgs(['dag-cycles', 'my-team']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/dag/cycles',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should find critical path', async () => {
      const tasks = [{ id: 't1' }, { id: 't2', blockedBy: ['t1'] }];
      fetchSpy.mockResolvedValueOnce(mockResponse(tasks));
      fetchSpy.mockResolvedValueOnce(mockResponse({ path: ['t1', 't2'] }));
      setupParseArgs(['dag-critical-path', 'my-team']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/dag/critical-path',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should find ready tasks', async () => {
      const tasks = [
        { id: 't1', status: 'resolved' },
        { id: 't2', status: 'open', blockedBy: ['t1'] },
      ];
      fetchSpy.mockResolvedValueOnce(mockResponse(tasks));
      fetchSpy.mockResolvedValueOnce(mockResponse({ ready: ['t2'] }));
      setupParseArgs(['dag-ready', 'my-team']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/dag/ready',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"completed":["t1"]'),
        })
      );
    });
  });

  // ========================================================================
  // LMSH & Search Commands
  // ========================================================================

  describe('LMSH and search commands', () => {
    it('should translate natural language to shell', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ command: 'ls -la' }));
      setupParseArgs(['lmsh', 'list', 'all', 'files']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/lmsh/translate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ input: 'list all files' }),
        })
      );
    });

    it('should search indexed sessions', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['search', 'auth', 'bug'], { limit: '5' });
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/search',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ query: 'auth bug', limit: 5 }),
        })
      );
    });
  });

  // ========================================================================
  // MCP Commands
  // ========================================================================

  describe('MCP commands', () => {
    it('should install MCP server', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));
      setupParseArgs(['mcp-install']);
      await runCli();

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('claude mcp add-json'),
        expect.objectContaining({ stdio: 'inherit' })
      );
    });

    it('should handle MCP install when claude CLI not found', async () => {
      mockExecSync.mockImplementation(() => {
        throw Object.assign(new Error('command not found'), { message: 'command not found' });
      });
      setupParseArgs(['mcp-install']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Claude CLI not found'));
    });

    it('should uninstall MCP server', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));
      setupParseArgs(['mcp-uninstall']);
      await runCli();

      expect(mockExecSync).toHaveBeenCalledWith(
        'claude mcp remove claude-fleet',
        expect.objectContaining({ stdio: 'inherit' })
      );
    });

    it('should start MCP server process', async () => {
      const mockChild = {
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild);
      setupParseArgs(['mcp-server']);
      await runCli();

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([expect.any(String)]),
        expect.objectContaining({ stdio: 'inherit' })
      );
    });
  });

  // ========================================================================
  // Init Command
  // ========================================================================

  describe('init command', () => {
    it('should create CLAUDE.md when it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue(Buffer.from(''));
      mockResolve.mockReturnValue('/test/project');
      setupParseArgs(['init']);
      await runCli();

      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.stringContaining('Claude Fleet Agent Configuration')
      );
    });

    it('should append to existing non-fleet CLAUDE.md', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('# My Project\nSome custom content');
      mockExecSync.mockReturnValue(Buffer.from(''));
      mockResolve.mockReturnValue('/test/project');
      setupParseArgs(['init']);
      await runCli();

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.stringContaining('My Project')
      );
    });

    it('should skip overwrite for existing fleet CLAUDE.md', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('# Claude Fleet Agent Configuration\n...');
      mockExecSync.mockReturnValue(Buffer.from(''));
      mockResolve.mockReturnValue('/test/project');
      setupParseArgs(['init']);
      await runCli();

      // Should not call writeFileSync for the CLAUDE.md (but may call execSync for MCP)
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Native Integration Commands
  // ========================================================================

  describe('native integration commands', () => {
    it('should check coordination status', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ coordination: { adapter: 'native' } }));
      setupParseArgs(['coordination-status']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/coordination/status',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should run migrate check with healthy system', async () => {
      fetchSpy.mockResolvedValue(mockResponse({
        healthy: true,
        adapter: 'native',
        checks: [
          { name: 'Binary', passed: true, detail: 'OK' },
        ],
      }));
      setupParseArgs(['migrate-check']);
      await runCli();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3847/coordination/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should run migrate check with unhealthy system', async () => {
      fetchSpy.mockResolvedValue(mockResponse({
        healthy: false,
        adapter: 'http',
        checks: [
          { name: 'Binary', passed: false, detail: 'Not found' },
        ],
      }));
      setupParseArgs(['migrate-check']);
      await runCli();

      const output = consoleLogSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('FIX THIS');
    });
  });

  // ========================================================================
  // Unknown Command
  // ========================================================================

  describe('unknown command', () => {
    it('should print error for unknown command', async () => {
      setupParseArgs(['nonexistent-command']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command: nonexistent-command'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Validation Helpers
  // ========================================================================

  describe('validation', () => {
    it('should reject invalid handle characters', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['mail', 'invalid handle!']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid handle'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should reject invalid team name', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['teams', 'bad team name!']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid team name'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should reject invalid message type for blackboard-post', async () => {
      setupParseArgs(['blackboard-post', 'swarm-1', 'alice', 'invalid_type', '{}']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid message type'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Output Formatting
  // ========================================================================

  describe('output formatting', () => {
    it('should format empty data as "(no data)" in table mode', async () => {
      fetchSpy.mockResolvedValue(mockResponse([]));
      setupParseArgs(['workitems'], { table: true });
      await runCli();

      expect(consoleLogSpy).toHaveBeenCalledWith('(no data)');
    });

    it('should output JSON by default (non-table)', async () => {
      const items = [{ id: 'wi-1', status: 'pending', assignedTo: 'alice', title: 'Fix bug' }];
      fetchSpy.mockResolvedValue(mockResponse(items));
      setupParseArgs(['workitems']);
      await runCli();

      expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(items, null, 2));
    });
  });

  // ========================================================================
  // Error Handling
  // ========================================================================

  describe('error handling', () => {
    it('should show stack trace in verbose mode on error', async () => {
      fetchSpy.mockRejectedValue(new Error('Network failure'));
      setupParseArgs(['health'], { verbose: true });
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', expect.any(String));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle invalid JSON response from server', async () => {
      const badResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => name === 'content-type' ? 'application/json' : null,
        },
        json: () => Promise.reject(new Error('invalid json')),
        text: () => Promise.resolve('not json'),
      } as unknown as Response;
      fetchSpy.mockResolvedValue(badResponse);
      setupParseArgs(['health']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error:',
        expect.stringContaining('invalid JSON')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle ECONNREFUSED errors', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      setupParseArgs(['health']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error:',
        expect.stringContaining('Cannot connect to server')
      );
    });

    it('should handle generic network errors', async () => {
      fetchSpy.mockRejectedValue(new Error('timeout'));
      setupParseArgs(['health']);
      await runCli();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error:',
        expect.stringContaining('Network error')
      );
    });
  });
});
