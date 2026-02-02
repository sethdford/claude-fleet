/**
 * Tests for fleet coordination route handlers
 *
 * Covers: blackboard, spawn queue, checkpoints, swarm management
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
  verifySwarmAccess,
  verifyCheckpointHandleAccess,
  createBlackboardPostHandler,
  createBlackboardReadHandler,
  createBlackboardMarkReadHandler,
  createBlackboardArchiveHandler,
  createBlackboardArchiveOldHandler,
  createSpawnEnqueueHandler,
  createSpawnStatusHandler,
  createSpawnGetHandler,
  createSpawnCancelHandler,
  createCheckpointCreateHandler,
  createCheckpointLoadHandler,
  createCheckpointLatestHandler,
  createCheckpointListHandler,
  createCheckpointAcceptHandler,
  createCheckpointRejectHandler,
  createSwarmCreateHandler,
  createSwarmListHandler,
  createSwarmGetHandler,
  createSwarmKillHandler,
} from './fleet.js';

describe('Fleet Coordination Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  // ======================================================================
  // ACCESS CONTROL HELPERS
  // ======================================================================

  describe('verifySwarmAccess', () => {
    it('should deny access when no user is authenticated', () => {
      const req = createMockReq() as unknown as Request;
      const result = verifySwarmAccess(req, 'swarm-1', deps);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Authentication');
    });

    it('should allow team-leads access to any swarm', () => {
      const req = createMockReq() as unknown as Request;
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const result = verifySwarmAccess(req, 'swarm-1', deps);
      expect(result.allowed).toBe(true);
    });

    it('should allow worker access to their assigned swarm', () => {
      const req = createMockReq() as unknown as Request;
      ((req as unknown) as Record<string, unknown>).user = { handle: 'worker-1', agentType: 'worker' };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        swarmId: 'swarm-1',
      });
      const result = verifySwarmAccess(req, 'swarm-1', deps);
      expect(result.allowed).toBe(true);
    });

    it('should deny worker access to different swarm', () => {
      const req = createMockReq() as unknown as Request;
      ((req as unknown) as Record<string, unknown>).user = { handle: 'worker-1', agentType: 'worker' };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        swarmId: 'swarm-2',
      });
      const result = verifySwarmAccess(req, 'swarm-1', deps);
      expect(result.allowed).toBe(false);
    });

    it('should deny worker not assigned to any swarm', () => {
      const req = createMockReq() as unknown as Request;
      ((req as unknown) as Record<string, unknown>).user = { handle: 'worker-1', agentType: 'worker' };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        swarmId: null,
      });
      const result = verifySwarmAccess(req, 'swarm-1', deps);
      expect(result.allowed).toBe(false);
    });
  });

  describe('verifyCheckpointHandleAccess', () => {
    it('should deny access when no user', () => {
      const req = createMockReq() as unknown as Request;
      const result = verifyCheckpointHandleAccess(req, 'agent-1');
      expect(result.allowed).toBe(false);
    });

    it('should allow team-leads access to any handle', () => {
      const req = createMockReq() as unknown as Request;
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const result = verifyCheckpointHandleAccess(req, 'agent-1');
      expect(result.allowed).toBe(true);
    });

    it('should allow user access to their own handle', () => {
      const req = createMockReq() as unknown as Request;
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const result = verifyCheckpointHandleAccess(req, 'agent-1');
      expect(result.allowed).toBe(true);
    });

    it('should deny user access to other handles', () => {
      const req = createMockReq() as unknown as Request;
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-2', agentType: 'worker' };
      const result = verifyCheckpointHandleAccess(req, 'agent-1');
      expect(result.allowed).toBe(false);
    });
  });

  // ======================================================================
  // BLACKBOARD HANDLERS
  // ======================================================================

  describe('Blackboard Handlers', () => {
    it('should post a blackboard message', async () => {
      deps.swarms.set('swarm-1', { id: 'swarm-1', name: 'test', maxAgents: 50, createdAt: Date.now() });
      const handler = createBlackboardPostHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          senderHandle: 'agent-1',
          messageType: 'status',
          payload: { text: 'hello' },
        },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.storage.blackboard.postMessage).toHaveBeenCalled();
    });

    it('should reject post with invalid body', async () => {
      const handler = createBlackboardPostHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for unknown swarm', async () => {
      const handler = createBlackboardPostHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'nonexistent',
          senderHandle: 'agent-1',
          messageType: 'status',
          payload: { text: 'hello' },
        },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should reject impersonation for non-team-leads', async () => {
      deps.swarms.set('swarm-1', { id: 'swarm-1', name: 'test', maxAgents: 50, createdAt: Date.now() });
      const handler = createBlackboardPostHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          senderHandle: 'other-agent',
          messageType: 'status',
          payload: { text: 'hello' },
        },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      // verifySwarmAccess needs a worker in the right swarm
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({ swarmId: 'swarm-1' });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should read blackboard messages', async () => {
      const handler = createBlackboardReadHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        query: {},
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.storage.blackboard.readMessages).toHaveBeenCalled();
    });

    it('should mark messages as read', async () => {
      const handler = createBlackboardMarkReadHandler(deps);
      const req = createMockReq({
        body: { messageIds: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'], readerHandle: 'agent-1' },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.marked).toBe(2);
    });

    it('should archive messages', async () => {
      const handler = createBlackboardArchiveHandler(deps);
      const req = createMockReq({
        body: { messageIds: ['550e8400-e29b-41d4-a716-446655440000'] },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.archived).toBe(1);
    });

    it('should archive old messages', async () => {
      const handler = createBlackboardArchiveOldHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        body: { maxAgeMs: 86400000 },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      (deps.storage.blackboard.archiveOldMessages as ReturnType<typeof vi.fn>).mockReturnValue(5);

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.archived).toBe(5);
    });
  });

  // ======================================================================
  // SPAWN QUEUE HANDLERS
  // ======================================================================

  describe('Spawn Queue Handlers', () => {
    it('should enqueue a spawn request', async () => {
      const handler = createSpawnEnqueueHandler(deps);
      const req = createMockReq({
        body: {
          requesterHandle: 'agent-1',
          targetAgentType: 'worker',
          task: 'Do something',
        },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.requestId).toBe('spawn-req-1');
      expect(response.status).toBe('pending');
    });

    it('should return 400 when queue fails', async () => {
      (deps.spawnController.queueSpawn as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const handler = createSpawnEnqueueHandler(deps);
      const req = createMockReq({
        body: {
          requesterHandle: 'agent-1',
          targetAgentType: 'worker',
          task: 'do something',
        },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should get spawn queue status', () => {
      const handler = createSpawnStatusHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      expect(res.json).toHaveBeenCalled();
    });

    it('should get a spawn request by id', async () => {
      (deps.storage.spawnQueue.getItem as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'pending',
      });

      const handler = createSpawnGetHandler(deps);
      const req = createMockReq({
        params: { id: '550e8400-e29b-41d4-a716-446655440000' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should return 404 for missing spawn request', async () => {
      const handler = createSpawnGetHandler(deps);
      const req = createMockReq({
        params: { id: '550e8400-e29b-41d4-a716-446655440000' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should cancel a spawn request', async () => {
      const handler = createSpawnCancelHandler(deps);
      const req = createMockReq({
        params: { id: '550e8400-e29b-41d4-a716-446655440000' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });
  });

  // ======================================================================
  // CHECKPOINT HANDLERS
  // ======================================================================

  describe('Checkpoint Handlers', () => {
    it('should create a checkpoint', async () => {
      const handler = createCheckpointCreateHandler(deps);
      const req = createMockReq({
        body: {
          fromHandle: 'agent-1',
          toHandle: 'lead-1',
          goal: 'Implement auth module',
          now: 'Working on JWT validation',
          test: 'Unit tests passing',
        },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.storage.checkpoint.createCheckpoint).toHaveBeenCalled();
    });

    it('should reject checkpoint from unauthenticated user', async () => {
      const handler = createCheckpointCreateHandler(deps);
      const req = createMockReq({
        body: {
          fromHandle: 'agent-1',
          toHandle: 'lead-1',
          goal: 'test',
          now: 'test',
          test: 'test',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should reject checkpoint impersonation', async () => {
      const handler = createCheckpointCreateHandler(deps);
      const req = createMockReq({
        body: {
          fromHandle: 'other-agent',
          toHandle: 'lead-1',
          goal: 'test',
          now: 'test',
          test: 'test',
        },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should load a checkpoint by id', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'pending',
      });

      const handler = createCheckpointLoadHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should return 404 for missing checkpoint', async () => {
      const handler = createCheckpointLoadHandler(deps);
      const req = createMockReq({ params: { id: '999' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should deny access to checkpoint from other users', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'agent-2',
        status: 'pending',
      });

      const handler = createCheckpointLoadHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-3', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should get latest checkpoint for a handle', async () => {
      (deps.storage.checkpoint.loadLatestCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 5,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
      });

      const handler = createCheckpointLatestHandler(deps);
      const req = createMockReq({ params: { handle: 'agent-1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should list checkpoints for a handle', async () => {
      (deps.storage.checkpoint.listCheckpoints as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createCheckpointListHandler(deps);
      const req = createMockReq({ params: { handle: 'agent-1' }, query: {} });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should accept a checkpoint', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'pending',
      });

      const handler = createCheckpointAcceptHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should reject a checkpoint', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'pending',
      });

      const handler = createCheckpointRejectHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });
  });

  // ======================================================================
  // SWARM HANDLERS
  // ======================================================================

  describe('Swarm Handlers', () => {
    it('should create a swarm', () => {
      const handler = createSwarmCreateHandler(deps);
      const req = createMockReq({
        body: { name: 'test-swarm', description: 'A test swarm', maxAgents: 10 },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
      expect(deps.storage.insertSwarm).toHaveBeenCalled();
      expect(deps.broadcastToAll).toHaveBeenCalled();
    });

    it('should reject swarm creation with invalid body', () => {
      const handler = createSwarmCreateHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should list swarms', () => {
      (deps.storage.getAllSwarms as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'swarm-1', name: 'test', maxAgents: 50, createdAt: Date.now() },
      ]);

      const handler = createSwarmListHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveLength(1);
    });

    it('should list swarms with agents', () => {
      (deps.storage.getAllSwarms as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'swarm-1', name: 'test', maxAgents: 50, createdAt: Date.now() },
      ]);
      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'w1', handle: 'worker-1', state: 'ready', swarmId: 'swarm-1' },
      ]);

      const handler = createSwarmListHandler(deps);
      const req = createMockReq({ query: { includeAgents: 'true' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response[0].agents).toHaveLength(1);
    });

    it('should get a specific swarm', () => {
      (deps.storage.getSwarm as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'swarm-1',
        name: 'test',
        maxAgents: 50,
        createdAt: Date.now(),
      });
      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createSwarmGetHandler(deps);
      const req = createMockReq({ params: { id: 'swarm-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
    });

    it('should return 404 for missing swarm', () => {
      const handler = createSwarmGetHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should reject invalid swarm ID format', () => {
      const handler = createSwarmGetHandler(deps);
      const req = createMockReq({ params: { id: '' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should kill a swarm', async () => {
      (deps.storage.getSwarm as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'swarm-1',
        name: 'test',
      });
      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'w1', handle: 'worker-1', swarmId: 'swarm-1' },
      ]);

      const handler = createSwarmKillHandler(deps);
      const req = createMockReq({
        params: { id: 'swarm-1' },
        body: { graceful: false },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(deps.storage.deleteSwarm).toHaveBeenCalledWith('swarm-1');
    });

    it('should gracefully kill swarm without deleting', async () => {
      (deps.storage.getSwarm as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'swarm-1',
        name: 'test',
      });
      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createSwarmKillHandler(deps);
      const req = createMockReq({
        params: { id: 'swarm-1' },
        body: { graceful: true },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.storage.deleteSwarm).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid swarm ID format on kill', async () => {
      const handler = createSwarmKillHandler(deps);
      const req = createMockReq({
        params: { id: '' },
        body: { graceful: false },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid kill body', async () => {
      const handler = createSwarmKillHandler(deps);
      const req = createMockReq({
        params: { id: 'swarm-1' },
        body: { graceful: 'not-a-boolean' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when killing a nonexistent swarm', async () => {
      (deps.storage.getSwarm as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const handler = createSwarmKillHandler(deps);
      const req = createMockReq({
        params: { id: 'swarm-nonexistent' },
        body: { graceful: false },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should handle dismiss worker errors during kill gracefully', async () => {
      (deps.storage.getSwarm as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'swarm-1',
        name: 'test',
      });
      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'w1', handle: 'worker-1', swarmId: 'swarm-1' },
        { id: 'w2', handle: 'worker-2', swarmId: 'swarm-1' },
      ]);
      (deps.workerManager.dismissWorker as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('dismiss failed'))
        .mockResolvedValueOnce(undefined);

      const handler = createSwarmKillHandler(deps);
      const req = createMockReq({
        params: { id: 'swarm-1' },
        body: { graceful: false },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      // Only worker-2 should be in the dismissed list since worker-1 failed
      expect(response.dismissed).toEqual(['worker-2']);
    });

    it('should return 400 for invalid swarm list query', () => {
      const handler = createSwarmListHandler(deps);
      const req = createMockReq({ query: { includeAgents: 'invalid' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should include depthLevel in swarm get agents', () => {
      (deps.storage.getSwarm as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'swarm-1',
        name: 'test',
        maxAgents: 50,
        createdAt: Date.now(),
      });
      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'w1', handle: 'worker-1', state: 'ready', swarmId: 'swarm-1', depthLevel: 2 },
      ]);

      const handler = createSwarmGetHandler(deps);
      const req = createMockReq({ params: { id: 'swarm-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.agents).toHaveLength(1);
      expect(response.agents[0].depthLevel).toBe(2);
      expect(response.agents[0].handle).toBe('worker-1');
    });
  });

  // ======================================================================
  // ADDITIONAL COVERAGE: VALIDATION FAILURES & EDGE CASES
  // ======================================================================

  describe('Blackboard Handlers - Validation & Access Errors', () => {
    it('should return 403 when swarm access is denied for blackboard post', async () => {
      deps.swarms.set('swarm-1', { id: 'swarm-1', name: 'test', maxAgents: 50, createdAt: Date.now() });
      const handler = createBlackboardPostHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          senderHandle: 'worker-1',
          messageType: 'status',
          payload: { text: 'hello' },
        },
      });
      // Worker in a different swarm
      ((req as unknown) as Record<string, unknown>).user = { handle: 'worker-1', agentType: 'worker' };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({ swarmId: 'swarm-other' });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 400 for invalid swarmId param on blackboard read', async () => {
      const handler = createBlackboardReadHandler(deps);
      const req = createMockReq({
        params: { swarmId: '' },
        query: {},
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 403 when swarm access is denied for blackboard read', async () => {
      const handler = createBlackboardReadHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        query: {},
      });
      // Worker assigned to a different swarm
      ((req as unknown) as Record<string, unknown>).user = { handle: 'worker-1', agentType: 'worker' };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({ swarmId: 'swarm-other' });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 400 for invalid blackboard read query params', async () => {
      const handler = createBlackboardReadHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        query: { messageType: 'invalid-type' },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should pass through query options for blackboard read (messageType, priority, limit, unreadOnly)', async () => {
      const handler = createBlackboardReadHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        query: {
          messageType: 'status',
          unreadOnly: 'true',
          readerHandle: 'agent-1',
          priority: 'high',
          limit: '10',
        },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.storage.blackboard.readMessages).toHaveBeenCalledWith('swarm-1', {
        messageType: 'status',
        unreadOnly: true,
        readerHandle: 'agent-1',
        priority: 'high',
        limit: 10,
      });
    });

    it('should return 400 for invalid blackboard mark-read body', async () => {
      const handler = createBlackboardMarkReadHandler(deps);
      const req = createMockReq({
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid blackboard archive body', async () => {
      const handler = createBlackboardArchiveHandler(deps);
      const req = createMockReq({
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid swarmId param on archive old', async () => {
      const handler = createBlackboardArchiveOldHandler(deps);
      const req = createMockReq({
        params: { swarmId: '' },
        body: { maxAgeMs: 86400000 },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 403 when swarm access is denied for archive old', async () => {
      const handler = createBlackboardArchiveOldHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        body: { maxAgeMs: 86400000 },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'worker-1', agentType: 'worker' };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({ swarmId: 'swarm-other' });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 400 for invalid archive old body', async () => {
      const handler = createBlackboardArchiveOldHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        body: { maxAgeMs: -100 },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Spawn Queue Handlers - Validation Errors', () => {
    it('should return 400 for invalid spawn enqueue body', async () => {
      const handler = createSpawnEnqueueHandler(deps);
      const req = createMockReq({
        body: {},
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid spawn get UUID param', async () => {
      const handler = createSpawnGetHandler(deps);
      const req = createMockReq({
        params: { id: 'not-a-uuid' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid spawn cancel UUID param', async () => {
      const handler = createSpawnCancelHandler(deps);
      const req = createMockReq({
        params: { id: 'not-a-uuid' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Checkpoint Handlers - Validation & Access Errors', () => {
    it('should return 400 for invalid checkpoint create body', async () => {
      const handler = createCheckpointCreateHandler(deps);
      const req = createMockReq({
        body: {},
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid checkpoint load ID param', async () => {
      const handler = createCheckpointLoadHandler(deps);
      const req = createMockReq({ params: { id: 'not-a-number' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 401 for unauthenticated checkpoint load', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'pending',
      });

      const handler = createCheckpointLoadHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      // No user set
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 400 for invalid checkpoint latest handle param', async () => {
      const handler = createCheckpointLatestHandler(deps);
      const req = createMockReq({ params: { handle: '' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 403 when access denied for checkpoint latest', async () => {
      const handler = createCheckpointLatestHandler(deps);
      const req = createMockReq({ params: { handle: 'other-agent' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when no latest checkpoint exists for handle', async () => {
      (deps.storage.checkpoint.loadLatestCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const handler = createCheckpointLatestHandler(deps);
      const req = createMockReq({ params: { handle: 'agent-1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 for invalid checkpoint list handle param', async () => {
      const handler = createCheckpointListHandler(deps);
      const req = createMockReq({ params: { handle: '' }, query: {} });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 403 when access denied for checkpoint list', async () => {
      const handler = createCheckpointListHandler(deps);
      const req = createMockReq({ params: { handle: 'other-agent' }, query: {} });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 400 for invalid checkpoint list query params', async () => {
      const handler = createCheckpointListHandler(deps);
      const req = createMockReq({
        params: { handle: 'agent-1' },
        query: { limit: 'not-a-number' },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid checkpoint accept ID param', async () => {
      const handler = createCheckpointAcceptHandler(deps);
      const req = createMockReq({ params: { id: 'not-a-number' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when accepting a nonexistent checkpoint', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const handler = createCheckpointAcceptHandler(deps);
      const req = createMockReq({ params: { id: '999' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 401 when accepting checkpoint without authentication', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'pending',
      });

      const handler = createCheckpointAcceptHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      // No user set
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 when wrong recipient tries to accept checkpoint', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'pending',
      });

      const handler = createCheckpointAcceptHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-2', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 400 when accepting an already processed checkpoint', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'accepted',
      });
      (deps.storage.checkpoint.acceptCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const handler = createCheckpointAcceptHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid checkpoint reject ID param', async () => {
      const handler = createCheckpointRejectHandler(deps);
      const req = createMockReq({ params: { id: 'not-a-number' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when rejecting a nonexistent checkpoint', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const handler = createCheckpointRejectHandler(deps);
      const req = createMockReq({ params: { id: '999' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 401 when rejecting checkpoint without authentication', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'pending',
      });

      const handler = createCheckpointRejectHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      // No user set
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 when wrong recipient tries to reject checkpoint', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'pending',
      });

      const handler = createCheckpointRejectHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-2', agentType: 'worker' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 400 when rejecting an already processed checkpoint', async () => {
      (deps.storage.checkpoint.loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        fromHandle: 'agent-1',
        toHandle: 'lead-1',
        status: 'rejected',
      });
      (deps.storage.checkpoint.rejectCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const handler = createCheckpointRejectHandler(deps);
      const req = createMockReq({ params: { id: '1' } });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'lead-1', agentType: 'team-lead' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('verifySwarmAccess - authenticated non-worker', () => {
    it('should allow read-only access when user is not an active worker', () => {
      const req = createMockReq() as unknown as Request;
      ((req as unknown) as Record<string, unknown>).user = { handle: 'user-1', agentType: 'worker' };
      // getWorkerByHandle returns null - user is authenticated but not an active worker
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const result = verifySwarmAccess(req, 'swarm-1', deps);
      expect(result.allowed).toBe(true);
    });
  });
});
