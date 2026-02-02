/**
 * Tests for wave orchestration route handlers (headless fallback mode)
 *
 * Since @claude-fleet/tmux is not available in test, all wave handlers
 * fall back to headless mode. Multi-repo handlers return 501.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';

vi.mock('../metrics/prometheus.js', () => ({
  agentAuthentications: { inc: vi.fn() },
  tasksCreated: { inc: vi.fn() },
  tasksCompleted: { inc: vi.fn() },
}));

// Mock @claude-fleet/tmux to be unavailable so handlers use headless fallback
vi.mock('@claude-fleet/tmux', () => {
  throw new Error('Module not found');
});

// Mock HeadlessWaveOrchestrator
vi.mock('./wave-orchestrate-headless.js', () => {
  const MockOrchestrator = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.addWave = vi.fn();
    this.execute = vi.fn().mockResolvedValue([]);
    this.cancel = vi.fn().mockResolvedValue(undefined);
    this.on = vi.fn();
    this.getStatus = vi.fn().mockReturnValue({ waves: [], currentWave: null });
  });
  return { HeadlessWaveOrchestrator: MockOrchestrator };
});

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
} from './wave-orchestrate.js';

describe('Wave Orchestration Route Handlers', () => {
  let deps: RouteDependencies;
  const broadcastToAll = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  // ======================================================================
  // HEADLESS WAVE HANDLERS
  // ======================================================================

  describe('Headless Wave Execution', () => {
    it('should execute waves in headless mode', async () => {
      const handler = createExecuteWavesHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: {
          fleetName: 'test-fleet',
          waves: [
            {
              name: 'wave-1',
              workers: [{ handle: 'worker-1', command: 'echo test' }],
            },
          ],
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.status).toBe('running');
      expect(response.mode).toBe('headless');
    });

    it('should reject wave execution with invalid body', async () => {
      const handler = createExecuteWavesHandler(deps, broadcastToAll);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for unknown wave execution', () => {
      const handler = createGetWaveStatusHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should list wave executions (empty initially)', () => {
      const handler = createListWaveExecutionsHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(Array.isArray(response)).toBe(true);
    });
  });

  // ======================================================================
  // MULTI-REPO HANDLERS (501 in headless mode)
  // ======================================================================

  describe('Multi-Repo Handlers (tmux not available)', () => {
    it('should return 501 for multi-repo execute', () => {
      const handler = createExecuteMultiRepoHandler(deps, broadcastToAll);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(501);
    });

    it('should return 501 for multi-repo status', () => {
      const handler = createGetMultiRepoStatusHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(501);
    });

    it('should return 501 for multi-repo list', () => {
      const handler = createListMultiRepoExecutionsHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(501);
    });

    it('should return 501 for update deps', () => {
      const handler = createUpdateDepsHandler(deps, broadcastToAll);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(501);
    });

    it('should return 501 for security audit', () => {
      const handler = createSecurityAuditHandler(deps, broadcastToAll);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(501);
    });

    it('should return 501 for format code', () => {
      const handler = createFormatCodeHandler(deps, broadcastToAll);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(501);
    });

    it('should return 501 for run tests', () => {
      const handler = createRunTestsHandler(deps, broadcastToAll);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(501);
    });
  });
});
