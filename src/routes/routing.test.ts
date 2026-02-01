/**
 * Tests for routing route handler
 *
 * Covers: classify (task routing recommendation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';
import { createRoutingClassifyHandler } from './routing.js';

describe('Routing Route Handlers', () => {
  let deps: RouteDependencies;

  const mockRecommendation = {
    complexity: 'medium',
    strategy: 'supervised',
    model: 'sonnet',
    confidence: 0.85,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    (deps.workerManager.getRoutingRecommendation as ReturnType<typeof vi.fn>).mockReturnValue(mockRecommendation);
  });

  describe('createRoutingClassifyHandler', () => {
    it('should classify a task and return recommendation', async () => {
      const handler = createRoutingClassifyHandler(deps);
      const req = createMockReq({
        body: { subject: 'Refactor authentication', description: 'Extract JWT logic' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.workerManager.getRoutingRecommendation).toHaveBeenCalledWith({
        subject: 'Refactor authentication',
        description: 'Extract JWT logic',
        blockedBy: undefined,
      });
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.complexity).toBe('medium');
      expect(response.strategy).toBe('supervised');
      expect(response.model).toBe('sonnet');
      expect(response.confidence).toBe(0.85);
    });

    it('should pass blockedBy when provided', async () => {
      const handler = createRoutingClassifyHandler(deps);
      const req = createMockReq({
        body: { subject: 'Fix login bug', blockedBy: ['task-1', 'task-2'] },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.workerManager.getRoutingRecommendation).toHaveBeenCalledWith({
        subject: 'Fix login bug',
        description: undefined,
        blockedBy: ['task-1', 'task-2'],
      });
    });

    it('should reject without subject', async () => {
      const handler = createRoutingClassifyHandler(deps);
      const req = createMockReq({
        body: { description: 'some description' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
      const statusReturn = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturn.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('subject') })
      );
    });

    it('should return 503 when routing subsystem is unavailable', async () => {
      (deps.workerManager.getRoutingRecommendation as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const handler = createRoutingClassifyHandler(deps);
      const req = createMockReq({
        body: { subject: 'Test task' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(503);
      const statusReturn = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturn.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('not available') })
      );
    });
  });
});
