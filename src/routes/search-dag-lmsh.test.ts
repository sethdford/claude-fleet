/**
 * Tests for search, DAG, and LMSH route handlers
 *
 * All three modules use a native-with-JS-fallback pattern.
 * In tests, native Rust modules aren't available, so the JS fallbacks activate.
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

import {
  createSearchHandler,
  createSearchIndexHandler,
  createSearchDeleteHandler,
  createSearchStatsHandler,
} from './search.js';

import {
  createDagSortHandler,
  createDagCyclesHandler,
  createDagCriticalPathHandler,
  createDagReadyHandler,
} from './dag.js';

import {
  createLmshTranslateHandler,
  createLmshGetAliasesHandler,
  createLmshAddAliasHandler,
} from './lmsh.js';

describe('Search Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    // JSSearchEngine calls db.prepare().get() for stats,
    // and db.exec() in constructor for FTS5 table creation.
    // Override get to return a valid row for COUNT queries.
    const getDb = deps.legacyStorage.getDatabase as ReturnType<typeof vi.fn>;
    const mockDb = getDb();
    (mockDb.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ count: 0 }),
      run: vi.fn(),
    });
  });

  describe('Search Handler', () => {
    it('should perform a search query', async () => {
      const handler = createSearchHandler(deps);
      const req = createMockReq({
        body: { query: 'test query', limit: 10 },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('results');
      expect(response).toHaveProperty('count');
    });

    it('should return 400 when query is missing', async () => {
      const handler = createSearchHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Search Index Handler', () => {
    it('should index a session', async () => {
      const handler = createSearchIndexHandler(deps);
      const req = createMockReq({
        body: {
          sessionId: 'sess-1',
          content: 'Some session content',
          timestamp: Date.now(),
          model: 'claude',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.indexed).toBe(true);
    });

    it('should return 400 when index fields missing', async () => {
      const handler = createSearchIndexHandler(deps);
      const req = createMockReq({ body: { sessionId: 'sess-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Search Delete Handler', () => {
    it('should delete a session from index', async () => {
      const handler = createSearchDeleteHandler(deps);
      const req = createMockReq({ params: { sessionId: 'sess-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.deleted).toBe(true);
    });
  });

  describe('Search Stats Handler', () => {
    it('should return search stats', async () => {
      const handler = createSearchStatsHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('documentCount');
      expect(response).toHaveProperty('backend');
    });
  });
});

describe('DAG Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  const sampleNodes = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['a'] },
    { id: 'd', dependsOn: ['b', 'c'] },
  ];

  describe('Topological Sort', () => {
    it('should sort nodes topologically', async () => {
      const handler = createDagSortHandler(deps);
      const req = createMockReq({ body: { nodes: sampleNodes } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.isValid).toBe(true);
      expect(response.nodeCount).toBe(4);
      expect(response.order[0]).toBe('a');
    });

    it('should return 400 when nodes missing', async () => {
      const handler = createDagSortHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Cycle Detection', () => {
    it('should detect no cycles in valid DAG', async () => {
      const handler = createDagCyclesHandler(deps);
      const req = createMockReq({ body: { nodes: sampleNodes } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.hasCycles).toBe(false);
    });

    it('should detect cycles', async () => {
      const cyclicNodes = [
        { id: 'a', dependsOn: ['c'] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['b'] },
      ];

      const handler = createDagCyclesHandler(deps);
      const req = createMockReq({ body: { nodes: cyclicNodes } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.hasCycles).toBe(true);
    });
  });

  describe('Critical Path', () => {
    it('should compute critical path', async () => {
      const nodesWithDuration = [
        { id: 'a', estimatedDuration: 3, dependsOn: [] },
        { id: 'b', estimatedDuration: 2, dependsOn: ['a'] },
        { id: 'c', estimatedDuration: 5, dependsOn: ['a'] },
        { id: 'd', estimatedDuration: 1, dependsOn: ['b', 'c'] },
      ];

      const handler = createDagCriticalPathHandler(deps);
      const req = createMockReq({ body: { nodes: nodesWithDuration } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.totalDuration).toBeGreaterThan(0);
      expect(response.path.length).toBeGreaterThan(0);
    });
  });

  describe('Ready Nodes', () => {
    it('should find ready nodes', async () => {
      const handler = createDagReadyHandler(deps);
      const req = createMockReq({
        body: { nodes: sampleNodes, completed: ['a'] },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.ready).toContain('b');
      expect(response.ready).toContain('c');
      expect(response.ready).not.toContain('d');
    });

    it('should return all roots when nothing completed', async () => {
      const handler = createDagReadyHandler(deps);
      const req = createMockReq({
        body: { nodes: sampleNodes },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.ready).toEqual(['a']);
    });
  });
});

describe('LMSH Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('Translate Handler', () => {
    it('should translate natural language to shell command', async () => {
      const handler = createLmshTranslateHandler(deps);
      const req = createMockReq({
        body: { input: 'list files' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('command');
      expect(response).toHaveProperty('confidence');
      expect(response.command).toContain('ls');
    });

    it('should return 400 when input missing', async () => {
      const handler = createLmshTranslateHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return empty for unknown commands', async () => {
      const handler = createLmshTranslateHandler(deps);
      const req = createMockReq({
        body: { input: 'do something completely unknown xyzzy' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.confidence).toBe(0);
    });
  });

  describe('Aliases Handler', () => {
    it('should get aliases', async () => {
      const handler = createLmshGetAliasesHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('aliases');
    });

    it('should add an alias', async () => {
      const handler = createLmshAddAliasHandler(deps);
      const req = createMockReq({
        body: { alias: 'deploy', command: 'npm run deploy' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.added).toBe(true);
    });

    it('should return 400 when alias fields missing', async () => {
      const handler = createLmshAddAliasHandler(deps);
      const req = createMockReq({ body: { alias: 'deploy' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
