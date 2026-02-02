/**
 * Tests for audit route handlers
 *
 * Covers all five factory functions exported by audit.ts:
 * - createAuditStatusHandler
 * - createAuditOutputHandler
 * - createAuditStartHandler
 * - createAuditStopHandler
 * - createQuickAuditHandler
 *
 * The audit module has module-global mutable state (auditState).
 * Since tests share this state, each test that starts an audit must
 * simulate child close to reset state before the next test runs.
 * We track spawned children externally so vi.clearAllMocks() does
 * not break cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../metrics/prometheus.js', () => ({
  agentAuthentications: { inc: vi.fn() },
  tasksCreated: { inc: vi.fn() },
  tasksCompleted: { inc: vi.fn() },
}));

// Track all spawned children outside the mock so vi.clearAllMocks
// does not lose the references we need for cleanup.
interface MockChild {
  pid: number;
  stdout: import('node:events').EventEmitter;
  stderr: import('node:events').EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => MockChild;
}

const spawnedChildren: MockChild[] = [];

vi.mock('node:child_process', () => {
  const { EventEmitter } = require('node:events');
  return {
    spawn: vi.fn().mockImplementation(() => {
      const child = new EventEmitter();
      child.pid = 12345;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      spawnedChildren.push(child);
      return child;
    }),
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// Import after mocks are declared
import {
  createAuditStatusHandler,
  createAuditOutputHandler,
  createAuditStartHandler,
  createAuditStopHandler,
  createQuickAuditHandler,
} from './audit.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLastChild(): MockChild {
  return spawnedChildren[spawnedChildren.length - 1];
}

/**
 * Reset audit state to idle by simulating child close.
 * Safe to call even when no child is running.
 */
function resetAuditState(): void {
  const child = spawnedChildren[spawnedChildren.length - 1];
  if (child) {
    // Emit close to reset module-level auditState
    child.emit('close', 0);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Audit Route Handlers', () => {
  let deps: RouteDependencies;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    // Reset audit module state from any leftover running audit
    resetAuditState();
    // Now clear mock call counts
    vi.clearAllMocks();
    deps = createMockDeps();
    // Suppress console output during tests
    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();
    // Reset existsSync default
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  // ==========================================================================
  // createAuditStatusHandler
  // ==========================================================================

  describe('createAuditStatusHandler', () => {
    it('should return idle status when no audit is running', async () => {
      const handler = createAuditStatusHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.isRunning).toBe(false);
      expect(response.outputLines).toBeTypeOf('number');
      expect(response.pid).toBeNull();
    });

    it('should return running status after audit is started', async () => {
      // Start an audit first
      const startHandler = createAuditStartHandler(deps);
      const startReq = createMockReq({ body: {} });
      const startRes = createMockRes();
      startHandler(startReq as unknown as Request, startRes as unknown as Response);
      await vi.waitFor(() => {
        expect(startRes.json).toHaveBeenCalled();
      });

      // Now check status
      const handler = createAuditStatusHandler(deps);
      const req = createMockReq();
      const res = createMockRes();
      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.isRunning).toBe(true);
      expect(response.pid).toBe(12345);
      expect(response.startedAt).toBeTypeOf('number');
    });

    it('should reflect exitCode after audit completes', async () => {
      // Start an audit
      const startHandler = createAuditStartHandler(deps);
      const startReq = createMockReq({ body: {} });
      const startRes = createMockRes();
      startHandler(startReq as unknown as Request, startRes as unknown as Response);
      await vi.waitFor(() => {
        expect(startRes.json).toHaveBeenCalled();
      });

      // Simulate close with non-zero exit
      getLastChild().emit('close', 1);

      // Check status
      const handler = createAuditStatusHandler(deps);
      const req = createMockReq();
      const res = createMockRes();
      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.isRunning).toBe(false);
      expect(response.exitCode).toBe(1);
    });
  });

  // ==========================================================================
  // createAuditOutputHandler
  // ==========================================================================

  describe('createAuditOutputHandler', () => {
    it('should return empty output when no audit has run', async () => {
      const handler = createAuditOutputHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.lines).toEqual([]);
      expect(response.totalLines).toBe(0);
      expect(response.since).toBe(0);
    });

    it('should return output lines with default since and limit', async () => {
      // Start an audit to populate output
      const startHandler = createAuditStartHandler(deps);
      const startReq = createMockReq({ body: {} });
      const startRes = createMockRes();
      startHandler(startReq as unknown as Request, startRes as unknown as Response);
      await vi.waitFor(() => {
        expect(startRes.json).toHaveBeenCalled();
      });

      // Push output via stdout
      getLastChild().stdout.emit('data', Buffer.from('line1\nline2\nline3\n'));

      const handler = createAuditOutputHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();
      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.lines).toEqual(['line1', 'line2', 'line3']);
      expect(response.totalLines).toBe(3);
    });

    it('should respect since and limit query params', async () => {
      // Start audit and push output
      const startHandler = createAuditStartHandler(deps);
      const startReq = createMockReq({ body: {} });
      const startRes = createMockRes();
      startHandler(startReq as unknown as Request, startRes as unknown as Response);
      await vi.waitFor(() => {
        expect(startRes.json).toHaveBeenCalled();
      });

      getLastChild().stdout.emit('data', Buffer.from('a\nb\nc\nd\ne\n'));

      const handler = createAuditOutputHandler(deps);
      const req = createMockReq({ query: { since: '1', limit: '2' } });
      const res = createMockRes();
      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.lines).toEqual(['b', 'c']);
      expect(response.since).toBe(1);
      expect(response.totalLines).toBe(5);
    });

    it('should return 400 for invalid query params', async () => {
      const handler = createAuditOutputHandler(deps);
      const req = createMockReq({ query: { since: '-5' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ==========================================================================
  // createAuditStartHandler
  // ==========================================================================

  describe('createAuditStartHandler', () => {
    it('should start audit with default params', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.pid).toBe(12345);
      expect(response.dryRun).toBe(false);
      expect(response.maxIterations).toBe(20);
      expect(response.startedAt).toBeTypeOf('number');

      expect(spawn).toHaveBeenCalled();
      const spawnCall = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(spawnCall[0]).toBe('bash');
      // The second arg is an array containing the script path
      const args = spawnCall[1] as string[];
      expect(args.some((arg: string) => arg.includes('audit-loop.sh'))).toBe(true);
    });

    it('should pass --dry-run flag when dryRun is true', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: { dryRun: true } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.dryRun).toBe(true);

      const spawnCall = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      const args = spawnCall[1] as string[];
      expect(args).toContain('--dry-run');
    });

    it('should pass --max-iterations when not default', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: { maxIterations: 50 } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const spawnCall = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      const args = spawnCall[1] as string[];
      expect(args).toContain('--max-iterations');
      expect(args).toContain('50');
    });

    it('should return 409 when audit is already running', async () => {
      const handler = createAuditStartHandler(deps);

      // Start the first audit
      const req1 = createMockReq({ body: {} });
      const res1 = createMockRes();
      handler(req1 as unknown as Request, res1 as unknown as Response);
      await vi.waitFor(() => {
        expect(res1.json).toHaveBeenCalled();
      });

      // Try to start a second audit
      const req2 = createMockReq({ body: {} });
      const res2 = createMockRes();
      handler(req2 as unknown as Request, res2 as unknown as Response);
      await vi.waitFor(() => {
        expect(res2.status).toHaveBeenCalled();
      });

      expect(res2.status).toHaveBeenCalledWith(409);
      const statusReturnValue = (res2.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturnValue.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Audit loop already running' })
      );
    });

    it('should return 400 for invalid body (maxIterations out of range)', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: { maxIterations: -1 } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for unknown fields in strict schema', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: { unknownField: 'not-allowed' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 when audit script is not found', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
      const statusReturnValue = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturnValue.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Audit script not found',
          hint: expect.any(String),
        })
      );
    });

    it('should broadcast stdout output via broadcastToAll', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      getLastChild().stdout.emit('data', Buffer.from('broadcast-line\n'));

      expect(deps.broadcastToAll).toHaveBeenCalledWith({
        type: 'audit:output',
        lines: ['broadcast-line'],
      });
    });

    it('should broadcast completion via broadcastToAll on close', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      getLastChild().emit('close', 0);

      expect(deps.broadcastToAll).toHaveBeenCalledWith({
        type: 'audit:complete',
        exitCode: 0,
        status: 'completed',
      });
    });

    it('should broadcast failed status when process exits non-zero', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      getLastChild().emit('close', 1);

      expect(deps.broadcastToAll).toHaveBeenCalledWith({
        type: 'audit:complete',
        exitCode: 1,
        status: 'failed',
      });
    });

    it('should handle child process error event', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      getLastChild().emit('error', new Error('spawn failed'));

      // After error, state should be reset
      const statusHandler = createAuditStatusHandler(deps);
      const statusReq = createMockReq();
      const statusRes = createMockRes();
      statusHandler(statusReq as unknown as Request, statusRes as unknown as Response);
      await vi.waitFor(() => {
        expect(statusRes.json).toHaveBeenCalled();
      });

      const status = (statusRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(status.isRunning).toBe(false);
      expect(status.exitCode).toBe(-1);
    });

    it('should prefix stderr lines with [stderr]', async () => {
      const handler = createAuditStartHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      getLastChild().stderr.emit('data', Buffer.from('warning message\n'));

      // Check output via output handler
      const outputHandler = createAuditOutputHandler(deps);
      const outputReq = createMockReq({ query: {} });
      const outputRes = createMockRes();
      outputHandler(outputReq as unknown as Request, outputRes as unknown as Response);
      await vi.waitFor(() => {
        expect(outputRes.json).toHaveBeenCalled();
      });

      const output = (outputRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(output.lines).toContain('[stderr] warning message');
    });
  });

  // ==========================================================================
  // createAuditStopHandler
  // ==========================================================================

  describe('createAuditStopHandler', () => {
    it('should return 400 when no audit is running', async () => {
      const handler = createAuditStopHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
      const statusReturnValue = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturnValue.json).toHaveBeenCalledWith({
        error: 'No audit loop is running',
      });
    });

    it('should stop a running audit and send SIGTERM', async () => {
      // Start an audit first
      const startHandler = createAuditStartHandler(deps);
      const startReq = createMockReq({ body: {} });
      const startRes = createMockRes();
      startHandler(startReq as unknown as Request, startRes as unknown as Response);
      await vi.waitFor(() => {
        expect(startRes.json).toHaveBeenCalled();
      });

      const child = getLastChild();

      // Now stop it
      const handler = createAuditStopHandler(deps);
      const req = createMockReq();
      const res = createMockRes();
      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.message).toBe('Audit loop stop requested');
      expect(response.pid).toBe(12345);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  // ==========================================================================
  // createQuickAuditHandler
  // ==========================================================================

  describe('createQuickAuditHandler', () => {
    it('should start a quick audit successfully', async () => {
      const handler = createQuickAuditHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.pid).toBe(12345);
      expect(response.startedAt).toBeTypeOf('number');

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        ['tsx', 'src/cli.ts', 'audit'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      );
    });

    it('should return 409 when audit is already running', async () => {
      // Start a regular audit first
      const startHandler = createAuditStartHandler(deps);
      const startReq = createMockReq({ body: {} });
      const startRes = createMockRes();
      startHandler(startReq as unknown as Request, startRes as unknown as Response);
      await vi.waitFor(() => {
        expect(startRes.json).toHaveBeenCalled();
      });

      // Try to start quick audit
      const handler = createQuickAuditHandler(deps);
      const req = createMockReq();
      const res = createMockRes();
      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(409);
      const statusReturnValue = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturnValue.json).toHaveBeenCalledWith({
        error: 'Audit already running',
      });
    });

    it('should broadcast completion on quick audit close', async () => {
      const handler = createQuickAuditHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      getLastChild().emit('close', 0);

      expect(deps.broadcastToAll).toHaveBeenCalledWith({
        type: 'audit:complete',
        exitCode: 0,
        status: 'passed',
      });
    });

    it('should broadcast failure status on quick audit non-zero exit', async () => {
      const handler = createQuickAuditHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      getLastChild().emit('close', 1);

      expect(deps.broadcastToAll).toHaveBeenCalledWith({
        type: 'audit:complete',
        exitCode: 1,
        status: 'failed',
      });
    });

    it('should handle quick audit process error', async () => {
      const handler = createQuickAuditHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      getLastChild().emit('error', new Error('npx not found'));

      // Verify state is reset
      const statusHandler = createAuditStatusHandler(deps);
      const statusReq = createMockReq();
      const statusRes = createMockRes();
      statusHandler(statusReq as unknown as Request, statusRes as unknown as Response);
      await vi.waitFor(() => {
        expect(statusRes.json).toHaveBeenCalled();
      });

      const status = (statusRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(status.isRunning).toBe(false);
      expect(status.exitCode).toBe(-1);
    });
  });
});
