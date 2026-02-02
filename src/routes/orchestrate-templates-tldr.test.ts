/**
 * Tests for orchestrate, templates, and TLDR route handlers
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
  workerSpawns: { inc: vi.fn() },
  workerDismissals: { inc: vi.fn() },
}));

import {
  createSpawnWorkerHandler,
  createDismissWorkerHandler,
  createSendToWorkerHandler,
  createGetWorkersHandler,
  createGetWorkerOutputHandler,
  createRegisterExternalWorkerHandler,
  createInjectWorkerOutputHandler,
  createWorktreeCommitHandler,
  createWorktreePushHandler,
  createWorktreePRHandler,
  createWorktreeStatusHandler,
} from './orchestrate.js';

import {
  createCreateTemplateHandler,
  createListTemplatesHandler,
  createGetTemplateHandler,
  createUpdateTemplateHandler,
  createDeleteTemplateHandler,
  createRunTemplateHandler,
} from './templates.js';

import {
  createGetFileSummaryHandler,
  createCheckSummaryHandler,
  createStoreFileSummaryHandler,
  createGetMultipleSummariesHandler,
  createGetCodebaseOverviewHandler,
  createStoreCodebaseOverviewHandler,
  createStoreDependencyHandler,
  createGetDependencyGraphHandler,
  createGetDependentsHandler,
  createGetDependenciesHandler,
  createInvalidateFileHandler,
  createGetTLDRStatsHandler,
  createClearTLDRCacheHandler,
} from './tldr.js';

describe('Orchestrate Route Handlers', () => {
  let deps: RouteDependencies;
  const broadcastToAll = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('Worker Handlers', () => {
    it('should spawn a worker', async () => {
      const handler = createSpawnWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { handle: 'worker-1', teamName: 'team-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.workerManager.spawnWorker).toHaveBeenCalled();
      expect(broadcastToAll).toHaveBeenCalled();
    });

    it('should reject spawn with invalid body', async () => {
      const handler = createSpawnWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should dismiss a worker', async () => {
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
        state: 'ready',
      });

      const handler = createDismissWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({ params: { handle: 'worker-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.workerManager.dismissWorkerByHandle).toHaveBeenCalledWith('worker-1');
    });

    it('should return 404 when dismissing unknown worker', async () => {
      const handler = createDismissWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({ params: { handle: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should send message to worker', async () => {
      const handler = createSendToWorkerHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: { message: 'hello' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should get workers list', () => {
      const handler = createGetWorkersHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
    });

    it('should get worker output', () => {
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        handle: 'worker-1',
        state: 'ready',
        recentOutput: ['line-1'],
      });

      const handler = createGetWorkerOutputHandler(deps);
      const req = createMockReq({ params: { handle: 'worker-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.handle).toBe('worker-1');
    });

    it('should return 404 for output of unknown worker', () => {
      const handler = createGetWorkerOutputHandler(deps);
      const req = createMockReq({ params: { handle: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should apply routing model when no explicit model specified', async () => {
      (deps.workerManager.getRoutingRecommendation as ReturnType<typeof vi.fn>).mockReturnValue({
        complexity: 'high',
        strategy: 'specialized',
        model: 'claude-sonnet',
        confidence: 0.9,
      });

      const handler = createSpawnWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { handle: 'worker-1', teamName: 'team-1', initialPrompt: 'Build a complex feature' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const spawnCall = (deps.workerManager.spawnWorker as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnCall.model).toBe('claude-sonnet');
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.routing).toBeTruthy();
      expect(response.routing.model).toBe('claude-sonnet');
    });

    it('should not override explicit model with routing recommendation', async () => {
      (deps.workerManager.getRoutingRecommendation as ReturnType<typeof vi.fn>).mockReturnValue({
        complexity: 'high',
        strategy: 'specialized',
        model: 'claude-sonnet',
        confidence: 0.9,
      });

      const handler = createSpawnWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { handle: 'worker-1', teamName: 'team-1', initialPrompt: 'Build a complex feature', model: 'claude-opus' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const spawnCall = (deps.workerManager.spawnWorker as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnCall.model).toBe('claude-opus');
    });

    it('should handle routing recommendation errors gracefully', async () => {
      (deps.workerManager.getRoutingRecommendation as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Routing service unavailable');
      });

      const handler = createSpawnWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { handle: 'worker-1', teamName: 'team-1', initialPrompt: 'Build something' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.workerManager.spawnWorker).toHaveBeenCalled();
    });

    it('should return 400 when spawnWorker throws', async () => {
      (deps.workerManager.spawnWorker as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Max workers reached')
      );

      const handler = createSpawnWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { handle: 'worker-1', teamName: 'team-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
      const errorResponse = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(errorResponse.json).toHaveBeenCalledWith({ error: 'Max workers reached' });
    });

    it('should return 400 for send to worker with invalid body', async () => {
      const handler = createSendToWorkerHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when send to worker fails', async () => {
      (deps.workerManager.sendToWorkerByHandle as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const handler = createSendToWorkerHandler(deps);
      const req = createMockReq({
        params: { handle: 'nonexistent' },
        body: { message: 'hello' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should map worker fields in get workers list', () => {
      (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([{
        id: 'w-1',
        handle: 'worker-1',
        teamName: 'team-1',
        state: 'ready',
        health: 'healthy',
        workingDir: '/tmp/work',
        sessionId: 'sess-1',
        spawnedAt: 1000,
        currentTaskId: 'task-1',
        restartCount: 2,
        spawnMode: 'process',
        swarmId: 'swarm-1',
        depthLevel: 3,
      }]);

      const handler = createGetWorkersHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveLength(1);
      expect(response[0].handle).toBe('worker-1');
      expect(response[0].swarmId).toBe('swarm-1');
      expect(response[0].depthLevel).toBe(3);
    });
  });

  describe('External Worker Handlers', () => {
    it('should register an external worker', async () => {
      const handler = createRegisterExternalWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { handle: 'ext-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.workerManager.registerExternalWorker).toHaveBeenCalled();
    });

    it('should inject worker output events', () => {
      const handler = createInjectWorkerOutputHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: { events: [{ type: 'output', data: 'test' }] },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.count).toBe(1);
    });

    it('should reject inject with no events', () => {
      const handler = createInjectWorkerOutputHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for register external worker with invalid body', async () => {
      const handler = createRegisterExternalWorkerHandler(deps, broadcastToAll);
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

    it('should return 400 when register external worker throws', async () => {
      (deps.workerManager.registerExternalWorker as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Handle already in use');
      });

      const handler = createRegisterExternalWorkerHandler(deps, broadcastToAll);
      const req = createMockReq({
        body: { handle: 'ext-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
      const errorResponse = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(errorResponse.json).toHaveBeenCalledWith({ error: 'Handle already in use' });
    });
  });

  describe('Worktree Handlers', () => {
    it('should return 404 for worktree commit with unknown worker', async () => {
      const handler = createWorktreeCommitHandler(deps);
      const req = createMockReq({
        params: { handle: 'nonexistent' },
        body: { message: 'test commit' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when worktrees not enabled on commit', async () => {
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });

      const handler = createWorktreeCommitHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: { message: 'test commit' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when worktrees not enabled on push', async () => {
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });

      const handler = createWorktreePushHandler(deps);
      const req = createMockReq({ params: { handle: 'worker-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when worktrees not enabled on PR', async () => {
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });

      const handler = createWorktreePRHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: { title: 'Test PR' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when worktrees not enabled on status', async () => {
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });

      const handler = createWorktreeStatusHandler(deps);
      const req = createMockReq({ params: { handle: 'worker-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for worktree commit with invalid body', async () => {
      const handler = createWorktreeCommitHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should successfully commit in worktree', async () => {
      const mockWorktreeManager = {
        commit: vi.fn().mockResolvedValue('abc123def'),
        push: vi.fn().mockResolvedValue(undefined),
        createPR: vi.fn().mockResolvedValue('https://github.com/test/pr/1'),
        getStatus: vi.fn().mockResolvedValue({ branch: 'feat/test', changes: 3 }),
      };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });
      (deps.workerManager.getWorktreeManager as ReturnType<typeof vi.fn>).mockReturnValue(mockWorktreeManager);

      const handler = createWorktreeCommitHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: { message: 'fix: resolve test failures' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.commitHash).toBe('abc123def');
      expect(response.handle).toBe('worker-1');
    });

    it('should return 500 when worktree commit fails', async () => {
      const mockWorktreeManager = {
        commit: vi.fn().mockRejectedValue(new Error('Nothing to commit')),
        push: vi.fn(),
        createPR: vi.fn(),
        getStatus: vi.fn(),
      };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });
      (deps.workerManager.getWorktreeManager as ReturnType<typeof vi.fn>).mockReturnValue(mockWorktreeManager);

      const handler = createWorktreeCommitHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: { message: 'fix: resolve test failures' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 404 for worktree push with unknown worker', async () => {
      const handler = createWorktreePushHandler(deps);
      const req = createMockReq({ params: { handle: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should successfully push worktree', async () => {
      const mockWorktreeManager = {
        commit: vi.fn(),
        push: vi.fn().mockResolvedValue(undefined),
        createPR: vi.fn(),
        getStatus: vi.fn(),
      };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });
      (deps.workerManager.getWorktreeManager as ReturnType<typeof vi.fn>).mockReturnValue(mockWorktreeManager);

      const handler = createWorktreePushHandler(deps);
      const req = createMockReq({ params: { handle: 'worker-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.handle).toBe('worker-1');
    });

    it('should return 500 when worktree push fails', async () => {
      const mockWorktreeManager = {
        commit: vi.fn(),
        push: vi.fn().mockRejectedValue(new Error('Push rejected')),
        createPR: vi.fn(),
        getStatus: vi.fn(),
      };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });
      (deps.workerManager.getWorktreeManager as ReturnType<typeof vi.fn>).mockReturnValue(mockWorktreeManager);

      const handler = createWorktreePushHandler(deps);
      const req = createMockReq({ params: { handle: 'worker-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 400 for worktree PR with invalid body', async () => {
      const handler = createWorktreePRHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for worktree PR with unknown worker', async () => {
      const handler = createWorktreePRHandler(deps);
      const req = createMockReq({
        params: { handle: 'nonexistent' },
        body: { title: 'Test PR', body: 'Description' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should successfully create worktree PR', async () => {
      const mockWorktreeManager = {
        commit: vi.fn(),
        push: vi.fn(),
        createPR: vi.fn().mockResolvedValue('https://github.com/test/pull/42'),
        getStatus: vi.fn(),
      };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });
      (deps.workerManager.getWorktreeManager as ReturnType<typeof vi.fn>).mockReturnValue(mockWorktreeManager);

      const handler = createWorktreePRHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: { title: 'Add feature', body: 'This PR adds the feature' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.prUrl).toBe('https://github.com/test/pull/42');
      expect(response.handle).toBe('worker-1');
    });

    it('should return 500 when worktree PR creation fails', async () => {
      const mockWorktreeManager = {
        commit: vi.fn(),
        push: vi.fn(),
        createPR: vi.fn().mockRejectedValue(new Error('gh cli not found')),
        getStatus: vi.fn(),
      };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });
      (deps.workerManager.getWorktreeManager as ReturnType<typeof vi.fn>).mockReturnValue(mockWorktreeManager);

      const handler = createWorktreePRHandler(deps);
      const req = createMockReq({
        params: { handle: 'worker-1' },
        body: { title: 'Add feature', body: 'This PR adds the feature' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 404 for worktree status with unknown worker', async () => {
      const handler = createWorktreeStatusHandler(deps);
      const req = createMockReq({ params: { handle: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should successfully get worktree status', async () => {
      const mockWorktreeManager = {
        commit: vi.fn(),
        push: vi.fn(),
        createPR: vi.fn(),
        getStatus: vi.fn().mockResolvedValue({ branch: 'feat/test', changes: 5, ahead: 2, behind: 0 }),
      };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });
      (deps.workerManager.getWorktreeManager as ReturnType<typeof vi.fn>).mockReturnValue(mockWorktreeManager);

      const handler = createWorktreeStatusHandler(deps);
      const req = createMockReq({ params: { handle: 'worker-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.branch).toBe('feat/test');
      expect(response.handle).toBe('worker-1');
    });

    it('should return 500 when worktree status check fails', async () => {
      const mockWorktreeManager = {
        commit: vi.fn(),
        push: vi.fn(),
        createPR: vi.fn(),
        getStatus: vi.fn().mockRejectedValue(new Error('Worktree not found')),
      };
      (deps.workerManager.getWorkerByHandle as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'w-1',
        handle: 'worker-1',
      });
      (deps.workerManager.getWorktreeManager as ReturnType<typeof vi.fn>).mockReturnValue(mockWorktreeManager);

      const handler = createWorktreeStatusHandler(deps);
      const req = createMockReq({ params: { handle: 'worker-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

describe('Template Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('Create Template', () => {
    it('should create a template', async () => {
      const handler = createCreateTemplateHandler(deps);
      const req = createMockReq({
        body: {
          name: 'test-template',
          description: 'A test template',
          phases: { discovery: ['researcher'], development: ['coder'] },
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(201);
      expect(deps.legacyStorage.insertTemplate).toHaveBeenCalled();
    });

    it('should return 409 for duplicate template name', async () => {
      (deps.legacyStorage.getTemplateByName as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'existing',
        name: 'test-template',
      });

      const handler = createCreateTemplateHandler(deps);
      const req = createMockReq({
        body: {
          name: 'test-template',
          phases: { discovery: ['researcher'] },
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe('List Templates', () => {
    it('should list all templates', async () => {
      (deps.legacyStorage.getAllTemplates as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 't-1', name: 'template-1' },
      ]);

      const handler = createListTemplatesHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });
  });

  describe('Get Template', () => {
    it('should get a template by id', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'template-1',
      });

      const handler = createGetTemplateHandler(deps);
      const req = createMockReq({ params: { id: 't-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should return 404 for missing template', async () => {
      const handler = createGetTemplateHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('Update Template', () => {
    it('should update a template', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'template-1',
        isBuiltin: false,
      });
      (deps.legacyStorage.updateTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'updated-name',
      });

      const handler = createUpdateTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-1' },
        body: { name: 'updated-name' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should return 403 for built-in template', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'builtin',
        isBuiltin: true,
      });

      const handler = createUpdateTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-1' },
        body: { name: 'new-name' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('Delete Template', () => {
    it('should delete a template', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'template-1',
        isBuiltin: false,
      });

      const handler = createDeleteTemplateHandler(deps);
      const req = createMockReq({ params: { id: 't-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('should return 403 when deleting built-in template', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'builtin',
        isBuiltin: true,
      });

      const handler = createDeleteTemplateHandler(deps);
      const req = createMockReq({ params: { id: 't-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('Run Template', () => {
    it('should run a template and create swarm', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'template-1',
        isBuiltin: false,
        phases: {
          discovery: ['researcher'],
          development: ['coder'],
          quality: [],
          delivery: [],
        },
      });

      const handler = createRunTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-1' },
        body: { swarmName: 'my-swarm' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(201);
      expect(deps.storage.insertSwarm).toHaveBeenCalled();
      expect(deps.storage.spawnQueue.enqueue).toHaveBeenCalledTimes(2);
    });

    it('should return 404 for unknown template', async () => {
      const handler = createRunTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 'nonexistent' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 for invalid run body', async () => {
      const handler = createRunTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-1' },
        body: { swarmName: '' }, // empty string fails min(1) validation
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should auto-delete temp templates after running', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-temp',
        name: '_temp-dashboard-run',
        isBuiltin: false,
        phases: {
          discovery: ['scout'],
          development: [],
          quality: [],
          delivery: [],
        },
      });

      const handler = createRunTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-temp' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(201);
      expect(deps.legacyStorage.deleteTemplate).toHaveBeenCalledWith('t-temp');
    });

    it('should not auto-delete builtin temp-prefixed templates', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-builtin-temp',
        name: '_temp-builtin',
        isBuiltin: true,
        phases: {
          discovery: ['scout'],
          development: [],
          quality: [],
          delivery: [],
        },
      });

      const handler = createRunTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-builtin-temp' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(201);
      expect(deps.legacyStorage.deleteTemplate).not.toHaveBeenCalled();
    });
  });

  describe('Create Template - validation failures', () => {
    it('should return 400 for invalid body (missing required fields)', async () => {
      const handler = createCreateTemplateHandler(deps);
      const req = createMockReq({
        body: {}, // missing name and phases
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when phases have no roles', async () => {
      const handler = createCreateTemplateHandler(deps);
      const req = createMockReq({
        body: {
          name: 'empty-phases',
          phases: { discovery: [], development: [], quality: [], delivery: [] },
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('List Templates - query options', () => {
    it('should return 400 for invalid query params', async () => {
      const handler = createListTemplatesHandler(deps);
      const req = createMockReq({
        query: { builtin: 'invalid-value' as unknown as string },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should pass builtin=true filter option', async () => {
      (deps.legacyStorage.getAllTemplates as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createListTemplatesHandler(deps);
      const req = createMockReq({
        query: { builtin: 'true' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.legacyStorage.getAllTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ builtin: true })
      );
    });

    it('should pass builtin=false filter option', async () => {
      (deps.legacyStorage.getAllTemplates as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createListTemplatesHandler(deps);
      const req = createMockReq({
        query: { builtin: 'false' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.legacyStorage.getAllTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ builtin: false })
      );
    });

    it('should pass limit option when provided', async () => {
      (deps.legacyStorage.getAllTemplates as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createListTemplatesHandler(deps);
      const req = createMockReq({
        query: { limit: '10' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.legacyStorage.getAllTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });
  });

  describe('Update Template - additional edge cases', () => {
    it('should return 400 for invalid update body', async () => {
      const handler = createUpdateTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-1' },
        body: {}, // no fields provided for update
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when updating nonexistent template', async () => {
      const handler = createUpdateTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 'nonexistent' },
        body: { name: 'new-name' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 409 when renaming to duplicate name', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'original-name',
        isBuiltin: false,
      });
      (deps.legacyStorage.getTemplateByName as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-2',
        name: 'taken-name',
      });

      const handler = createUpdateTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-1' },
        body: { name: 'taken-name' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('should return 500 when storage update fails', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'template-1',
        isBuiltin: false,
      });
      (deps.legacyStorage.updateTemplate as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const handler = createUpdateTemplateHandler(deps);
      const req = createMockReq({
        params: { id: 't-1' },
        body: { description: 'updated description' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('Delete Template - additional edge cases', () => {
    it('should return 404 when deleting nonexistent template', async () => {
      const handler = createDeleteTemplateHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 500 when storage delete fails', async () => {
      (deps.legacyStorage.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 't-1',
        name: 'template-1',
        isBuiltin: false,
      });
      (deps.legacyStorage.deleteTemplate as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const handler = createDeleteTemplateHandler(deps);
      const req = createMockReq({ params: { id: 't-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

describe('TLDR Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('File Summary Handlers', () => {
    it('should get a file summary', () => {
      (deps.storage.tldr.getFileSummary as ReturnType<typeof vi.fn>).mockReturnValue({
        filePath: 'src/index.ts',
        summary: 'Entry point',
      });

      const handler = createGetFileSummaryHandler(deps);
      const req = createMockReq({ body: { filePath: 'src/index.ts' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.filePath).toBe('src/index.ts');
    });

    it('should return 400 when filePath missing for get summary', () => {
      const handler = createGetFileSummaryHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for missing file summary', () => {
      const handler = createGetFileSummaryHandler(deps);
      const req = createMockReq({ body: { filePath: 'nonexistent.ts' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should check if summary is current', () => {
      (deps.storage.tldr.isSummaryCurrent as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const handler = createCheckSummaryHandler(deps);
      const req = createMockReq({
        body: { filePath: 'src/index.ts', contentHash: 'abc123' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.isCurrent).toBe(true);
    });

    it('should return 400 when check summary params missing', () => {
      const handler = createCheckSummaryHandler(deps);
      const req = createMockReq({ body: { filePath: 'test.ts' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should store a file summary', () => {
      const handler = createStoreFileSummaryHandler(deps);
      const req = createMockReq({
        body: {
          filePath: 'src/index.ts',
          contentHash: 'abc123',
          summary: 'Entry point for the app',
          lineCount: 50,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(deps.storage.tldr.storeFileSummary).toHaveBeenCalled();
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should get multiple summaries', () => {
      (deps.storage.tldr.getFileSummaries as ReturnType<typeof vi.fn>).mockReturnValue([
        { filePath: 'src/a.ts', summary: 'File A' },
      ]);

      const handler = createGetMultipleSummariesHandler(deps);
      const req = createMockReq({
        body: { filePaths: ['src/a.ts', 'src/b.ts'] },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.found).toBe(1);
      expect(response.missing).toBe(1);
    });

    it('should return 400 when filePaths missing for multiple summaries', () => {
      const handler = createGetMultipleSummariesHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Codebase Overview Handlers', () => {
    it('should get a codebase overview', () => {
      (deps.storage.tldr.getCodebaseOverview as ReturnType<typeof vi.fn>).mockReturnValue({
        rootPath: '/project',
        name: 'my-project',
      });

      const handler = createGetCodebaseOverviewHandler(deps);
      const req = createMockReq({ body: { rootPath: '/project' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.name).toBe('my-project');
    });

    it('should return 404 for missing codebase overview', () => {
      const handler = createGetCodebaseOverviewHandler(deps);
      const req = createMockReq({ body: { rootPath: '/nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should store a codebase overview', () => {
      const handler = createStoreCodebaseOverviewHandler(deps);
      const req = createMockReq({
        body: {
          rootPath: '/project',
          name: 'my-project',
          description: 'Test project',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(deps.storage.tldr.storeCodebaseOverview).toHaveBeenCalled();
    });
  });

  describe('Dependency Handlers', () => {
    it('should store a dependency edge', () => {
      const handler = createStoreDependencyHandler(deps);
      const req = createMockReq({
        body: { fromFile: 'a.ts', toFile: 'b.ts', importType: 'static' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(deps.storage.tldr.storeDependency).toHaveBeenCalledWith('a.ts', 'b.ts', 'static');
    });

    it('should get dependency graph', () => {
      const handler = createGetDependencyGraphHandler(deps);
      const req = createMockReq({
        body: { rootFiles: ['src/index.ts'], depth: 3 },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.nodeCount).toBe(0);
    });

    it('should get dependents', () => {
      (deps.storage.tldr.getDependents as ReturnType<typeof vi.fn>).mockReturnValue(['b.ts']);

      const handler = createGetDependentsHandler(deps);
      const req = createMockReq({ body: { filePath: 'a.ts' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.dependentCount).toBe(1);
    });

    it('should get dependencies', () => {
      (deps.storage.tldr.getDependencies as ReturnType<typeof vi.fn>).mockReturnValue(['c.ts']);

      const handler = createGetDependenciesHandler(deps);
      const req = createMockReq({ body: { filePath: 'a.ts' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.dependencyCount).toBe(1);
    });
  });

  describe('Cache Management', () => {
    it('should invalidate a file', () => {
      const handler = createInvalidateFileHandler(deps);
      const req = createMockReq({ body: { filePath: 'src/old.ts' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(deps.storage.tldr.invalidateFile).toHaveBeenCalledWith('src/old.ts');
    });

    it('should get TLDR stats', () => {
      const handler = createGetTLDRStatsHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
    });

    it('should clear TLDR cache', () => {
      const handler = createClearTLDRCacheHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(deps.storage.tldr.clearAll).toHaveBeenCalled();
    });
  });
});
