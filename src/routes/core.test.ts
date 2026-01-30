/**
 * Tests for core route handlers
 *
 * Covers: health, debug, auth, metricsJson
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';

// Mock prometheus metrics to avoid side effects
vi.mock('../metrics/prometheus.js', () => ({
  agentAuthentications: { inc: vi.fn() },
  tasksCreated: { inc: vi.fn() },
  tasksCompleted: { inc: vi.fn() },
}));

import {
  createHealthHandler,
  createDebugHandler,
  createAuthHandler,
  createMetricsJsonHandler,
  generateUid,
} from './core.js';

describe('Core Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  // ==========================================================================
  // Health Handler
  // ==========================================================================

  describe('createHealthHandler', () => {
    it('should return health status with ok', async () => {
      const handler = createHealthHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      (deps.storage.team.getDebugInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        users: [],
        chats: [],
        messageCount: 0,
        tasks: [],
      });

      handler(req as unknown as Request, res as unknown as Response);
      // asyncHandler wraps a promise; give it a tick to resolve
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.status).toBe('ok');
      expect(response.version).toBe('2.0.0');
      expect(response.persistence).toBe('sqlite');
    });

    it('should include worker count from workerManager', async () => {
      const handler = createHealthHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      (deps.workerManager.getWorkerCount as ReturnType<typeof vi.fn>).mockReturnValue(3);
      (deps.storage.team.getDebugInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        users: [],
        chats: [],
        messageCount: 0,
        tasks: [],
      });

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.workers).toBe(3);
    });

    it('should include storage info from debug data', async () => {
      const handler = createHealthHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      (deps.storage.team.getDebugInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        users: [{ uid: 'a', handle: 'agent-1', teamName: 'team-1', agentType: 'worker', createdAt: '', lastSeen: null }],
        chats: [{ id: 'c1' }],
        messageCount: 42,
        tasks: [],
      });

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.agents).toBe(1);
      expect(response.chats).toBe(1);
      expect(response.messages).toBe(42);
      expect(response.dbPath).toBe(':memory:');
    });
  });

  // ==========================================================================
  // Debug Handler
  // ==========================================================================

  describe('createDebugHandler', () => {
    it('should return debug info with users chats and workers', async () => {
      const handler = createDebugHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      const mockUsers = [
        { uid: 'uid1', handle: 'agent-1', teamName: 'team-1', agentType: 'worker', createdAt: '2025-01-01', lastSeen: null },
      ];
      const mockChats = [
        { id: 'chat1', participants: ['uid1'], isTeamChat: false, teamName: null, createdAt: '2025-01-01', updatedAt: '2025-01-01' },
      ];

      (deps.storage.team.getDebugInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        users: mockUsers,
        chats: mockChats,
        messageCount: 5,
        tasks: [],
      });

      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'w1', handle: 'worker-1', state: 'ready' },
        { id: 'w2', handle: 'worker-2', state: 'working' },
      ]);

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.users).toEqual(mockUsers);
      expect(response.chats).toEqual(mockChats);
      expect(response.messageCount).toBe(5);
      expect(response.workers).toHaveLength(2);
      expect(response.workers[0]).toEqual({ id: 'w1', handle: 'worker-1', state: 'ready' });
      expect(response.workers[1]).toEqual({ id: 'w2', handle: 'worker-2', state: 'working' });
    });
  });

  // ==========================================================================
  // Auth Handler
  // ==========================================================================

  describe('createAuthHandler', () => {
    it('should create JWT token for valid request', async () => {
      const handler = createAuthHandler(deps);
      const req = createMockReq({
        body: { handle: 'agent-1', teamName: 'test-team' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.handle).toBe('agent-1');
      expect(response.teamName).toBe('test-team');
      expect(response.agentType).toBe('worker');
      expect(response.token).toBeDefined();
      expect(typeof response.token).toBe('string');

      // Verify the token is a valid JWT
      const decoded = jwt.verify(response.token, 'test-secret') as Record<string, unknown>;
      expect(decoded.handle).toBe('agent-1');
      expect(decoded.teamName).toBe('test-team');
      expect(decoded.uid).toBe(response.uid);

      // Verify the UID matches the expected hash
      const expectedUid = generateUid('test-team', 'agent-1');
      expect(response.uid).toBe(expectedUid);

      // Verify insertUser was called
      expect(deps.storage.team.insertUser).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: expectedUid,
          handle: 'agent-1',
          teamName: 'test-team',
          agentType: 'worker',
        })
      );
    });

    it('should reject request without handle', async () => {
      const handler = createAuthHandler(deps);
      const req = createMockReq({
        body: { teamName: 'test-team' },
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
        expect.objectContaining({ error: expect.stringContaining('handle') })
      );
    });

    it('should reject request without teamName', async () => {
      const handler = createAuthHandler(deps);
      const req = createMockReq({
        body: { handle: 'agent-1' },
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
        expect.objectContaining({ error: expect.stringContaining('teamName') })
      );
    });
  });

  // ==========================================================================
  // MetricsJson Handler
  // ==========================================================================

  describe('createMetricsJsonHandler', () => {
    it('should return server metrics', async () => {
      const startTime = Date.now() - 60000;
      (deps as unknown as { startTime: number }).startTime = startTime;

      const handler = createMetricsJsonHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      (deps.storage.team.getDebugInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        users: [
          { uid: 'u1', handle: 'a1', teamName: 't', agentType: 'worker', createdAt: '', lastSeen: null },
          { uid: 'u2', handle: 'a2', teamName: 't', agentType: 'team-lead', createdAt: '', lastSeen: null },
        ],
        chats: [{ id: 'c1' }],
        messageCount: 10,
        tasks: [
          { id: 't1', status: 'open' },
          { id: 't2', status: 'resolved' },
          { id: 't3', status: 'in_progress' },
        ],
      });

      (deps.workerManager.getHealthStats as ReturnType<typeof vi.fn>).mockReturnValue({
        total: 2,
        healthy: 1,
        degraded: 1,
        unhealthy: 0,
      });

      (deps.workerManager.getRestartStats as ReturnType<typeof vi.fn>).mockReturnValue({
        total: 5,
        lastHour: 1,
      });

      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([
        { state: 'ready' },
        { state: 'working' },
      ]);

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const metrics = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Uptime should be approximately 60000ms
      expect(metrics.uptime).toBeGreaterThanOrEqual(59000);

      // Workers
      expect(metrics.workers.total).toBe(2);
      expect(metrics.workers.healthy).toBe(1);
      expect(metrics.workers.degraded).toBe(1);
      expect(metrics.workers.unhealthy).toBe(0);
      expect(metrics.workers.byState.ready).toBe(1);
      expect(metrics.workers.byState.working).toBe(1);
      expect(metrics.workers.byState.starting).toBe(0);

      // Tasks
      expect(metrics.tasks.total).toBe(3);
      expect(metrics.tasks.byStatus.open).toBe(1);
      expect(metrics.tasks.byStatus.resolved).toBe(1);
      expect(metrics.tasks.byStatus.in_progress).toBe(1);
      expect(metrics.tasks.byStatus.blocked).toBe(0);

      // Agents, chats, messages
      expect(metrics.agents).toBe(2);
      expect(metrics.chats).toBe(1);
      expect(metrics.messages).toBe(10);

      // Restarts
      expect(metrics.restarts.total).toBe(5);
      expect(metrics.restarts.lastHour).toBe(1);
    });
  });
});
