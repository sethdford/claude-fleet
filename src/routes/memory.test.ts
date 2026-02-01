/**
 * Tests for memory route handlers
 *
 * Covers: store, recall, search, list
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';
import {
  createMemoryStoreHandler,
  createMemoryRecallHandler,
  createMemorySearchHandler,
  createMemoryListHandler,
} from './memory.js';

describe('Memory Route Handlers', () => {
  let deps: RouteDependencies;

  const mockEntry = {
    id: 'mem-1',
    agentId: 'lead',
    key: 'project-context',
    value: 'Working on auth module',
    tags: ['auth'],
    memoryType: 'fact' as const,
    relevance: 1.0,
    accessCount: 1,
    createdAt: '2025-01-01T00:00:00Z',
    lastAccessed: '2025-01-01T00:00:00Z',
  };

  const mockAgentMemory = {
    store: vi.fn().mockReturnValue(mockEntry),
    recall: vi.fn().mockReturnValue(mockEntry),
    search: vi.fn().mockReturnValue([mockEntry]),
    getAll: vi.fn().mockReturnValue([mockEntry]),
    delete: vi.fn(),
    applyDecay: vi.fn(),
    getStats: vi.fn().mockReturnValue({ totalMemories: 1, agentCount: 1 }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    (deps.workerManager.getAgentMemory as ReturnType<typeof vi.fn>).mockReturnValue(mockAgentMemory);
  });

  // ==========================================================================
  // Store Handler
  // ==========================================================================

  describe('createMemoryStoreHandler', () => {
    it('should store a memory entry', async () => {
      const handler = createMemoryStoreHandler(deps);
      const req = createMockReq({
        body: { agentId: 'lead', key: 'project-context', value: 'Working on auth module', memoryType: 'fact', tags: ['auth'] },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockAgentMemory.store).toHaveBeenCalledWith('lead', 'project-context', 'Working on auth module', {
        memoryType: 'fact',
        tags: ['auth'],
      });
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.key).toBe('project-context');
      expect(response.value).toBe('Working on auth module');
    });

    it('should reject without agentId', async () => {
      const handler = createMemoryStoreHandler(deps);
      const req = createMockReq({
        body: { key: 'ctx', value: 'data' },
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
        expect.objectContaining({ error: expect.stringContaining('agentId') })
      );
    });

    it('should reject without key', async () => {
      const handler = createMemoryStoreHandler(deps);
      const req = createMockReq({
        body: { agentId: 'lead', value: 'data' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject without value', async () => {
      const handler = createMemoryStoreHandler(deps);
      const req = createMockReq({
        body: { agentId: 'lead', key: 'ctx' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 503 when agent memory is unavailable', async () => {
      (deps.workerManager.getAgentMemory as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const handler = createMemoryStoreHandler(deps);
      const req = createMockReq({
        body: { agentId: 'lead', key: 'ctx', value: 'data' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  // ==========================================================================
  // Recall Handler
  // ==========================================================================

  describe('createMemoryRecallHandler', () => {
    it('should recall a memory by agentId and key', async () => {
      const handler = createMemoryRecallHandler(deps);
      const req = createMockReq({ params: { agentId: 'lead', key: 'project-context' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockAgentMemory.recall).toHaveBeenCalledWith('lead', 'project-context');
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.key).toBe('project-context');
    });

    it('should return 404 for missing memory', async () => {
      mockAgentMemory.recall.mockReturnValueOnce(null);
      const handler = createMemoryRecallHandler(deps);
      const req = createMockReq({ params: { agentId: 'lead', key: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 503 when agent memory is unavailable', async () => {
      (deps.workerManager.getAgentMemory as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const handler = createMemoryRecallHandler(deps);
      const req = createMockReq({ params: { agentId: 'lead', key: 'ctx' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  // ==========================================================================
  // Search Handler
  // ==========================================================================

  describe('createMemorySearchHandler', () => {
    it('should search memories by query', async () => {
      const handler = createMemorySearchHandler(deps);
      const req = createMockReq({
        body: { agentId: 'lead', query: 'auth' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockAgentMemory.search).toHaveBeenCalledWith('lead', 'auth', {
        memoryType: undefined,
        limit: undefined,
      });
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.results).toHaveLength(1);
    });

    it('should pass memoryType and limit when provided', async () => {
      const handler = createMemorySearchHandler(deps);
      const req = createMockReq({
        body: { agentId: 'lead', query: 'auth', memoryType: 'fact', limit: 10 },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockAgentMemory.search).toHaveBeenCalledWith('lead', 'auth', {
        memoryType: 'fact',
        limit: 10,
      });
    });

    it('should reject without agentId', async () => {
      const handler = createMemorySearchHandler(deps);
      const req = createMockReq({
        body: { query: 'auth' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject without query', async () => {
      const handler = createMemorySearchHandler(deps);
      const req = createMockReq({
        body: { agentId: 'lead' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 503 when agent memory is unavailable', async () => {
      (deps.workerManager.getAgentMemory as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const handler = createMemorySearchHandler(deps);
      const req = createMockReq({
        body: { agentId: 'lead', query: 'auth' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  // ==========================================================================
  // List Handler
  // ==========================================================================

  describe('createMemoryListHandler', () => {
    it('should list all memories for an agent', async () => {
      const handler = createMemoryListHandler(deps);
      const req = createMockReq({ params: { agentId: 'lead' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockAgentMemory.getAll).toHaveBeenCalledWith('lead', 50);
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.memories).toHaveLength(1);
    });

    it('should use custom limit from query param', async () => {
      const handler = createMemoryListHandler(deps);
      const req = createMockReq({
        params: { agentId: 'lead' },
        query: { limit: '10' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(mockAgentMemory.getAll).toHaveBeenCalledWith('lead', 10);
    });

    it('should return 503 when agent memory is unavailable', async () => {
      (deps.workerManager.getAgentMemory as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const handler = createMemoryListHandler(deps);
      const req = createMockReq({ params: { agentId: 'lead' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
