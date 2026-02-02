/**
 * Tests for wave-orchestrate-impl.ts (tmux-backed wave & multi-repo handlers)
 *
 * Mocks @claude-fleet/tmux so the implementation module can be imported
 * directly. Module-level Maps persist across tests within each describe,
 * which we leverage for status/list checks after execution.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import type { RouteDependencies } from './types.js';

// ---------------------------------------------------------------------------
// Hoist mocks so they are available before module evaluation
// ---------------------------------------------------------------------------

const { mockWaveOrchestrator, mockMultiRepoOrchestrator, resetMocks } = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockCancel = vi.fn();
  const mockGetStatus = vi.fn();
  const mockAddWave = vi.fn();
  const mockOn = vi.fn();

  const mockExecuteTask = vi.fn();
  const mockUpdateDeps = vi.fn();
  const mockSecurityAudit = vi.fn();
  const mockFormatCode = vi.fn();
  const mockRunTests = vi.fn();
  const mockMultiGetStatus = vi.fn();
  const mockMultiOn = vi.fn();

  const wave = {
    execute: mockExecute,
    cancel: mockCancel,
    getStatus: mockGetStatus,
    addWave: mockAddWave,
    on: mockOn,
  };

  const multi = {
    executeTask: mockExecuteTask,
    updateDependencies: mockUpdateDeps,
    runSecurityAudit: mockSecurityAudit,
    formatCode: mockFormatCode,
    runTests: mockRunTests,
    getStatus: mockMultiGetStatus,
    on: mockMultiOn,
  };

  function resetMocks() {
    mockExecute.mockReset().mockResolvedValue([]);
    mockCancel.mockReset().mockResolvedValue(undefined);
    mockGetStatus.mockReset().mockReturnValue({
      status: 'idle',
      totalWaves: 0,
      completedWaves: 0,
      waves: [],
    });
    mockAddWave.mockReset();
    mockOn.mockReset();

    mockExecuteTask.mockReset().mockResolvedValue([]);
    mockUpdateDeps.mockReset().mockResolvedValue([]);
    mockSecurityAudit.mockReset().mockResolvedValue([]);
    mockFormatCode.mockReset().mockResolvedValue([]);
    mockRunTests.mockReset().mockResolvedValue([]);
    mockMultiGetStatus.mockReset().mockReturnValue({ status: 'idle' });
    mockMultiOn.mockReset();
  }

  return {
    mockWaveOrchestrator: wave,
    mockMultiRepoOrchestrator: multi,
    resetMocks,
  };
});

vi.mock('@claude-fleet/tmux', () => ({
  WaveOrchestrator: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockWaveOrchestrator);
  }),
  MultiRepoOrchestrator: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockMultiRepoOrchestrator);
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import {
  createExecuteWavesHandler,
  createGetWaveStatusHandler,
  createCancelWaveHandler,
  createListWaveExecutionsHandler,
  createExecuteMultiRepoHandler,
  createGetMultiRepoStatusHandler,
  createListMultiRepoExecutionsHandler,
  createUpdateDepsHandler,
  createSecurityAuditHandler,
  createFormatCodeHandler,
  createRunTestsHandler,
} from './wave-orchestrate-impl.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockReq(overrides: Record<string, unknown> = {}): unknown {
  return {
    body: {},
    query: {},
    params: {},
    headers: {},
    path: '/test',
    method: 'POST',
    ...overrides,
  };
}

function createMockRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { json, status, headersSent: false };
}

/** Minimal valid body for the executeWaves schema */
function validWaveBody() {
  return {
    fleetName: 'test-fleet',
    waves: [
      {
        name: 'wave-1',
        workers: [{ handle: 'worker-1', command: 'echo hello' }],
      },
    ],
  };
}

/** Minimal valid body for the executeMultiRepo schema */
function validMultiRepoBody() {
  return {
    fleetName: 'test-fleet',
    repositories: [{ name: 'repo-a', path: '/tmp/repo-a' }],
    task: { name: 'migrate', prompt: 'Run migration' },
  };
}

/** Minimal valid body for common task shortcuts (updateDeps, security, format, tests) */
function validCommonTaskBody() {
  return {
    fleetName: 'test-fleet',
    repositories: [{ name: 'repo-a', path: '/tmp/repo-a' }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wave-orchestrate-impl handlers', () => {
  let deps: RouteDependencies;
  const broadcastToAll = vi.fn();
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeEach(() => {
    resetMocks();
    broadcastToAll.mockReset();
    deps = createMockDeps();
    console.log = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  // ========================================================================
  // 1. createExecuteWavesHandler
  // ========================================================================

  describe('createExecuteWavesHandler', () => {
    it('should start wave execution and return running status', async () => {
      const handler = createExecuteWavesHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validWaveBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('running');
      expect(response.executionId).toBeDefined();
      expect(response.waves).toBe(1);
      expect(typeof response.message).toBe('string');
    });

    it('should call addWave for each wave in the request', async () => {
      const handler = createExecuteWavesHandler(deps, broadcastToAll);
      const body = validWaveBody();
      body.waves.push({
        name: 'wave-2',
        workers: [{ handle: 'worker-2', command: 'echo world' }],
      });
      const req = createMockReq({ body });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockWaveOrchestrator.addWave).toHaveBeenCalledTimes(2);
    });

    it('should register event listeners on the orchestrator', async () => {
      const handler = createExecuteWavesHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validWaveBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const registeredEvents = mockWaveOrchestrator.on.mock.calls.map(
        (call: unknown[]) => call[0]
      );
      expect(registeredEvents).toContain('wave:start');
      expect(registeredEvents).toContain('worker:spawned');
      expect(registeredEvents).toContain('worker:success');
      expect(registeredEvents).toContain('worker:failed');
      expect(registeredEvents).toContain('wave:complete');
    });

    it('should return 400 for invalid body (missing waves)', async () => {
      const handler = createExecuteWavesHandler(deps, broadcastToAll);
      const req = createMockReq({ body: { fleetName: 'f' } });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for completely empty body', async () => {
      const handler = createExecuteWavesHandler(deps, broadcastToAll);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ========================================================================
  // 2. createGetWaveStatusHandler
  // ========================================================================

  describe('createGetWaveStatusHandler', () => {
    it('should return 404 for unknown execution id', () => {
      const handler = createGetWaveStatusHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent-id' } });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return execution status after wave is started', async () => {
      // First, execute a wave to populate the module-level Map
      const execHandler = createExecuteWavesHandler(deps, broadcastToAll);
      const execReq = createMockReq({ body: validWaveBody() });
      const execRes = createMockRes();

      execHandler(execReq as Request, execRes as unknown as Response);

      await vi.waitFor(() => {
        expect(execRes.json).toHaveBeenCalled();
      });

      const executionId = execRes.json.mock.calls[0][0].executionId as string;

      // Now get the status
      const statusHandler = createGetWaveStatusHandler(deps);
      const statusReq = createMockReq({ params: { id: executionId } });
      const statusRes = createMockRes();

      statusHandler(statusReq as Request, statusRes as unknown as Response);

      const statusResponse = statusRes.json.mock.calls[0][0];
      expect(statusResponse.id).toBe(executionId);
      expect(statusResponse.orchestratorStatus).toBeDefined();
    });
  });

  // ========================================================================
  // 3. createCancelWaveHandler
  // ========================================================================

  describe('createCancelWaveHandler', () => {
    it('should return 404 for unknown execution id', async () => {
      const handler = createCancelWaveHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent-id' } });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should cancel a running execution and return cancelled status', async () => {
      // Make execute return a promise that never resolves so execution stays 'running'
      mockWaveOrchestrator.execute.mockReturnValue(new Promise(() => {}));

      // Start an execution first
      const execHandler = createExecuteWavesHandler(deps, broadcastToAll);
      const execReq = createMockReq({ body: validWaveBody() });
      const execRes = createMockRes();

      execHandler(execReq as Request, execRes as unknown as Response);

      await vi.waitFor(() => {
        expect(execRes.json).toHaveBeenCalled();
      });

      const executionId = execRes.json.mock.calls[0][0].executionId as string;

      // Cancel it
      const cancelHandler = createCancelWaveHandler(deps);
      const cancelReq = createMockReq({ params: { id: executionId } });
      const cancelRes = createMockRes();

      cancelHandler(cancelReq as Request, cancelRes as unknown as Response);

      await vi.waitFor(() => {
        expect(cancelRes.json).toHaveBeenCalled();
      });

      const cancelResponse = cancelRes.json.mock.calls[0][0];
      expect(cancelResponse.id).toBe(executionId);
      expect(cancelResponse.status).toBe('cancelled');
      expect(mockWaveOrchestrator.cancel).toHaveBeenCalled();
    });

    it('should return 400 when cancelling a non-running execution', async () => {
      // Make execute return a promise that never resolves so execution stays 'running'
      mockWaveOrchestrator.execute.mockReturnValue(new Promise(() => {}));

      // Start an execution
      const execHandler = createExecuteWavesHandler(deps, broadcastToAll);
      const execReq = createMockReq({ body: validWaveBody() });
      const execRes = createMockRes();

      execHandler(execReq as Request, execRes as unknown as Response);

      await vi.waitFor(() => {
        expect(execRes.json).toHaveBeenCalled();
      });

      const executionId = execRes.json.mock.calls[0][0].executionId as string;

      // Cancel it first time
      const cancelHandler = createCancelWaveHandler(deps);
      const cancelReq1 = createMockReq({ params: { id: executionId } });
      const cancelRes1 = createMockRes();

      cancelHandler(cancelReq1 as Request, cancelRes1 as unknown as Response);

      await vi.waitFor(() => {
        expect(cancelRes1.json).toHaveBeenCalled();
      });

      // Try cancelling again (status is now 'cancelled', not 'running')
      const cancelReq2 = createMockReq({ params: { id: executionId } });
      const cancelRes2 = createMockRes();

      cancelHandler(cancelReq2 as Request, cancelRes2 as unknown as Response);

      await vi.waitFor(() => {
        expect(cancelRes2.status).toHaveBeenCalled();
      });

      expect(cancelRes2.status).toHaveBeenCalledWith(400);
    });
  });

  // ========================================================================
  // 4. createListWaveExecutionsHandler
  // ========================================================================

  describe('createListWaveExecutionsHandler', () => {
    it('should return an array of executions', () => {
      const handler = createListWaveExecutionsHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      const response = res.json.mock.calls[0][0];
      expect(Array.isArray(response)).toBe(true);
    });

    it('should include executions that were previously started', async () => {
      // Start an execution so the list is non-empty
      const execHandler = createExecuteWavesHandler(deps, broadcastToAll);
      const execReq = createMockReq({ body: validWaveBody() });
      const execRes = createMockRes();

      execHandler(execReq as Request, execRes as unknown as Response);

      await vi.waitFor(() => {
        expect(execRes.json).toHaveBeenCalled();
      });

      // List all
      const listHandler = createListWaveExecutionsHandler(deps);
      const listReq = createMockReq();
      const listRes = createMockRes();

      listHandler(listReq as Request, listRes as unknown as Response);

      const list = listRes.json.mock.calls[0][0] as Array<{ id: string; status: string }>;
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('status');
      expect(list[0]).toHaveProperty('startedAt');
    });
  });

  // ========================================================================
  // 5. createExecuteMultiRepoHandler
  // ========================================================================

  describe('createExecuteMultiRepoHandler', () => {
    it('should start multi-repo execution and return running status', async () => {
      const handler = createExecuteMultiRepoHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validMultiRepoBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('running');
      expect(response.executionId).toBeDefined();
      expect(response.repositories).toBe(1);
      expect(response.task).toBe('migrate');
    });

    it('should register event listeners on the multi-repo orchestrator', async () => {
      const handler = createExecuteMultiRepoHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validMultiRepoBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const registeredEvents = mockMultiRepoOrchestrator.on.mock.calls.map(
        (call: unknown[]) => call[0]
      );
      expect(registeredEvents).toContain('task:start');
      expect(registeredEvents).toContain('repo:start');
      expect(registeredEvents).toContain('repo:success');
      expect(registeredEvents).toContain('repo:failed');
      expect(registeredEvents).toContain('task:complete');
    });

    it('should return 400 for invalid body (missing required fields)', async () => {
      const handler = createExecuteMultiRepoHandler(deps, broadcastToAll);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for missing task field', async () => {
      const handler = createExecuteMultiRepoHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: {
          fleetName: 'f',
          repositories: [{ name: 'r', path: '/p' }],
        },
      });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ========================================================================
  // 6. createGetMultiRepoStatusHandler
  // ========================================================================

  describe('createGetMultiRepoStatusHandler', () => {
    it('should return 404 for unknown execution id', () => {
      const handler = createGetMultiRepoStatusHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent-multi' } });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return execution status after multi-repo is started', async () => {
      // Start a multi-repo execution
      const execHandler = createExecuteMultiRepoHandler(deps, broadcastToAll);
      const execReq = createMockReq({ body: validMultiRepoBody() });
      const execRes = createMockRes();

      execHandler(execReq as Request, execRes as unknown as Response);

      await vi.waitFor(() => {
        expect(execRes.json).toHaveBeenCalled();
      });

      const executionId = execRes.json.mock.calls[0][0].executionId as string;

      // Get status
      const statusHandler = createGetMultiRepoStatusHandler(deps);
      const statusReq = createMockReq({ params: { id: executionId } });
      const statusRes = createMockRes();

      statusHandler(statusReq as Request, statusRes as unknown as Response);

      const statusResponse = statusRes.json.mock.calls[0][0];
      expect(statusResponse.id).toBe(executionId);
      expect(statusResponse.orchestratorStatus).toBeDefined();
    });
  });

  // ========================================================================
  // 7. createListMultiRepoExecutionsHandler
  // ========================================================================

  describe('createListMultiRepoExecutionsHandler', () => {
    it('should return an array', () => {
      const handler = createListMultiRepoExecutionsHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      const response = res.json.mock.calls[0][0];
      expect(Array.isArray(response)).toBe(true);
    });

    it('should list executions after one is started', async () => {
      const execHandler = createExecuteMultiRepoHandler(deps, broadcastToAll);
      const execReq = createMockReq({ body: validMultiRepoBody() });
      const execRes = createMockRes();

      execHandler(execReq as Request, execRes as unknown as Response);

      await vi.waitFor(() => {
        expect(execRes.json).toHaveBeenCalled();
      });

      const listHandler = createListMultiRepoExecutionsHandler(deps);
      const listReq = createMockReq();
      const listRes = createMockRes();

      listHandler(listReq as Request, listRes as unknown as Response);

      const list = listRes.json.mock.calls[0][0] as Array<{ id: string }>;
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('status');
    });
  });

  // ========================================================================
  // 8. createUpdateDepsHandler
  // ========================================================================

  describe('createUpdateDepsHandler', () => {
    it('should start dependency update and return running status', async () => {
      const handler = createUpdateDepsHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validCommonTaskBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('running');
      expect(response.task).toBe('update-deps');
      expect(response.executionId).toBeDefined();
    });

    it('should call updateDependencies on the orchestrator', async () => {
      const handler = createUpdateDepsHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { ...validCommonTaskBody(), packageManager: 'pnpm' },
      });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockMultiRepoOrchestrator.updateDependencies).toHaveBeenCalled();
    });

    it('should return 400 for invalid body (missing fleetName)', async () => {
      const handler = createUpdateDepsHandler(deps, broadcastToAll);
      const req = createMockReq({ body: { repositories: [] } });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ========================================================================
  // 9. createSecurityAuditHandler
  // ========================================================================

  describe('createSecurityAuditHandler', () => {
    it('should start security audit and return running status', async () => {
      const handler = createSecurityAuditHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validCommonTaskBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('running');
      expect(response.task).toBe('security-audit');
      expect(response.executionId).toBeDefined();
    });

    it('should call runSecurityAudit on the orchestrator', async () => {
      const handler = createSecurityAuditHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { ...validCommonTaskBody(), fix: true },
      });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockMultiRepoOrchestrator.runSecurityAudit).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // 10. createFormatCodeHandler
  // ========================================================================

  describe('createFormatCodeHandler', () => {
    it('should start code formatting and return running status', async () => {
      const handler = createFormatCodeHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validCommonTaskBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('running');
      expect(response.task).toBe('format-code');
      expect(response.executionId).toBeDefined();
    });

    it('should call formatCode on the orchestrator', async () => {
      const handler = createFormatCodeHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validCommonTaskBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockMultiRepoOrchestrator.formatCode).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // 11. createRunTestsHandler
  // ========================================================================

  describe('createRunTestsHandler', () => {
    it('should start test runner and return running status', async () => {
      const handler = createRunTestsHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validCommonTaskBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('running');
      expect(response.task).toBe('run-tests');
      expect(response.executionId).toBeDefined();
    });

    it('should call runTests on the orchestrator', async () => {
      const handler = createRunTestsHandler(deps, broadcastToAll);
      const req = createMockReq({ body: validCommonTaskBody() });
      const res = createMockRes();

      handler(req as Request, res as unknown as Response);

      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockMultiRepoOrchestrator.runTests).toHaveBeenCalled();
    });
  });
});
