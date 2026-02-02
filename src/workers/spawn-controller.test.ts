/**
 * Tests for Spawn Controller
 *
 * Covers: AgentCounter, canSpawn checks (hard/soft limit, depth, role),
 * register/unregister, queue processing, queueSpawn, stats, and destroy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SpawnController,
  SOFT_AGENT_LIMIT,
  HARD_AGENT_LIMIT,
  MAX_DEPTH_LEVEL,
} from './spawn-controller.js';

// Create mock storage and worker manager
function createMockSpawnQueue() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue({ id: 'sq-1', status: 'pending' }),
    getItem: vi.fn().mockResolvedValue(null),
    getPendingItems: vi.fn().mockResolvedValue([]),
    getReadyItems: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    cancelItem: vi.fn().mockResolvedValue(undefined),
    getQueueStats: vi.fn().mockResolvedValue({ pending: 0, approved: 0, spawned: 0, rejected: 0, blocked: 0 }),
  };
}

function createMockWorkerManager() {
  return {
    getWorkers: vi.fn().mockReturnValue([]),
    getWorkerCount: vi.fn().mockReturnValue(0),
    getWorkerByHandle: vi.fn().mockReturnValue(null),
    spawnWorker: vi.fn().mockResolvedValue({ id: 'w-1', handle: 'worker-1', state: 'starting' }),
    dismissWorker: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SpawnController', () => {
  let controller: SpawnController;
  let mockQueue: ReturnType<typeof createMockSpawnQueue>;
  let mockManager: ReturnType<typeof createMockWorkerManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new SpawnController({ autoProcess: false });
    mockQueue = createMockSpawnQueue();
    mockManager = createMockWorkerManager();
  });

  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
  });

  // ======================================================================
  // CONSTRUCTOR & CONSTANTS
  // ======================================================================

  describe('constructor', () => {
    it('should use default limits', () => {
      const limits = controller.getLimits();
      expect(limits.soft).toBe(SOFT_AGENT_LIMIT);
      expect(limits.hard).toBe(HARD_AGENT_LIMIT);
      expect(limits.current).toBe(0);
      expect(limits.remaining).toBe(HARD_AGENT_LIMIT);
    });

    it('should accept custom options', () => {
      const custom = new SpawnController({ softLimit: 5, hardLimit: 10, maxDepth: 2 });
      const limits = custom.getLimits();
      expect(limits.soft).toBe(5);
      expect(limits.hard).toBe(10);
      custom.destroy();
    });
  });

  describe('constants', () => {
    it('should export expected defaults', () => {
      expect(SOFT_AGENT_LIMIT).toBe(50);
      expect(HARD_AGENT_LIMIT).toBe(100);
      expect(MAX_DEPTH_LEVEL).toBe(3);
    });
  });

  // ======================================================================
  // initialize
  // ======================================================================

  describe('initialize', () => {
    it('should sync counter with existing workers', () => {
      mockManager.getWorkers.mockReturnValue([
        { id: 'w-1', handle: 'worker-1', process: { pid: 1001 } },
        { id: 'w-2', handle: 'worker-2', process: { pid: 1002 } },
      ]);

      controller.initialize(mockQueue as never, mockManager as never);

      expect(controller.getCurrentCount()).toBe(2);
    });

    it('should start auto-processing when enabled', () => {
      const autoController = new SpawnController({ autoProcess: true, processIntervalMs: 1000 });
      autoController.initialize(mockQueue as never, mockManager as never);
      // Auto-processing started (interval set). Destroy cleans up.
      autoController.destroy();
    });
  });

  // ======================================================================
  // canSpawn
  // ======================================================================

  describe('canSpawn', () => {
    it('should allow lead to spawn worker at depth 0', () => {
      const result = controller.canSpawn('lead', 0, 'worker');
      expect(result.allowed).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should deny when hard limit reached', () => {
      const small = new SpawnController({ hardLimit: 2, autoProcess: false });
      small.registerSpawn(1, 'w-1', 'id-1');
      small.registerSpawn(2, 'w-2', 'id-2');

      const result = small.canSpawn('lead', 0, 'worker');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hard agent limit');
      small.destroy();
    });

    it('should emit limit:hard event when hard limit reached', () => {
      const small = new SpawnController({ hardLimit: 1, autoProcess: false });
      const listener = vi.fn();
      small.on('limit:hard', listener);
      small.registerSpawn(1, 'w-1', 'id-1');

      small.canSpawn('lead', 0, 'worker');
      expect(listener).toHaveBeenCalled();
      small.destroy();
    });

    it('should deny when depth exceeds max', () => {
      const result = controller.canSpawn('lead', MAX_DEPTH_LEVEL, 'worker');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('depth');
    });

    it('should deny when role cannot spawn', () => {
      const result = controller.canSpawn('worker', 0, 'scout');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cannot spawn');
    });

    it('should warn at soft limit but still allow', () => {
      const small = new SpawnController({ softLimit: 1, hardLimit: 10, autoProcess: false });
      small.registerSpawn(1, 'w-1', 'id-1');

      const result = small.canSpawn('lead', 0, 'worker');
      expect(result.allowed).toBe(true);
      expect(result.warning).toContain('Soft agent limit');
      small.destroy();
    });

    it('should emit limit:soft event at soft limit', () => {
      const small = new SpawnController({ softLimit: 1, hardLimit: 10, autoProcess: false });
      const listener = vi.fn();
      small.on('limit:soft', listener);
      small.registerSpawn(1, 'w-1', 'id-1');

      small.canSpawn('lead', 0, 'worker');
      expect(listener).toHaveBeenCalled();
      small.destroy();
    });
  });

  // ======================================================================
  // registerSpawn / unregisterSpawn / getCurrentCount
  // ======================================================================

  describe('registerSpawn / unregisterSpawn', () => {
    it('should increment count on register', () => {
      controller.registerSpawn(1001, 'w-1', 'id-1');
      expect(controller.getCurrentCount()).toBe(1);
    });

    it('should decrement count on unregister', () => {
      controller.registerSpawn(1001, 'w-1', 'id-1');
      controller.unregisterSpawn(1001, 'w-1');
      expect(controller.getCurrentCount()).toBe(0);
    });

    it('should not go below zero', () => {
      controller.unregisterSpawn(999, 'nonexistent');
      expect(controller.getCurrentCount()).toBe(0);
    });

    it('should track multiple workers', () => {
      controller.registerSpawn(1, 'w-1', 'id-1');
      controller.registerSpawn(2, 'w-2', 'id-2');
      controller.registerSpawn(3, 'w-3', 'id-3');
      expect(controller.getCurrentCount()).toBe(3);

      controller.unregisterSpawn(2, 'w-2');
      expect(controller.getCurrentCount()).toBe(2);
    });
  });

  // ======================================================================
  // getLimits
  // ======================================================================

  describe('getLimits', () => {
    it('should return current, soft, hard, and remaining', () => {
      controller.registerSpawn(1, 'w-1', 'id-1');
      const limits = controller.getLimits();
      expect(limits.current).toBe(1);
      expect(limits.remaining).toBe(HARD_AGENT_LIMIT - 1);
    });
  });

  // ======================================================================
  // queueSpawn
  // ======================================================================

  describe('queueSpawn', () => {
    beforeEach(() => {
      controller.initialize(mockQueue as never, mockManager as never);
    });

    it('should enqueue a spawn request', async () => {
      const id = await controller.queueSpawn('lead-1', 'worker', 0, 'Do some work');
      expect(id).toBe('sq-1');
      expect(mockQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
        requesterHandle: 'lead-1',
        targetAgentType: 'worker',
        depthLevel: 0,
        priority: 'normal',
      }));
    });

    it('should emit spawn:queued event', async () => {
      const listener = vi.fn();
      controller.on('spawn:queued', listener);
      await controller.queueSpawn('lead-1', 'worker', 0, 'Work');
      expect(listener).toHaveBeenCalledWith({ requestId: 'sq-1', targetType: 'worker' });
    });

    it('should reject if depth exceeds role max', async () => {
      // Worker maxDepth=2, depth 3 should be rejected
      const id = await controller.queueSpawn('lead-1', 'worker', 3, 'Too deep');
      expect(id).toBeNull();
    });

    it('should return null if queue not initialized', async () => {
      const bare = new SpawnController({ autoProcess: false });
      const id = await bare.queueSpawn('lead-1', 'worker', 0, 'Work');
      expect(id).toBeNull();
      bare.destroy();
    });

    it('should pass options through', async () => {
      await controller.queueSpawn('lead-1', 'scout', 0, 'Explore', {
        priority: 'high',
        swarmId: 'swarm-1',
        context: { projectDir: '/tmp' },
      });
      expect(mockQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
        priority: 'high',
        swarmId: 'swarm-1',
      }));
    });
  });

  // ======================================================================
  // processQueue
  // ======================================================================

  describe('processQueue', () => {
    beforeEach(() => {
      controller.initialize(mockQueue as never, mockManager as never);
    });

    it('should return 0 when no ready items', async () => {
      const count = await controller.processQueue();
      expect(count).toBe(0);
    });

    it('should return 0 when not initialized', async () => {
      const bare = new SpawnController({ autoProcess: false });
      const count = await bare.processQueue();
      expect(count).toBe(0);
      bare.destroy();
    });

    it('should spawn ready items', async () => {
      mockQueue.getReadyItems.mockResolvedValue([{
        id: 'sq-1',
        requesterHandle: 'lead-1',
        targetAgentType: 'worker',
        depthLevel: 0,
        swarmId: 'swarm-1',
        payload: { task: 'Do work', context: {} },
      }]);

      const count = await controller.processQueue();
      expect(count).toBe(1);
      expect(mockManager.spawnWorker).toHaveBeenCalled();
      expect(mockQueue.updateStatus).toHaveBeenCalledWith('sq-1', 'spawned', 'w-1');
    });

    it('should emit spawn:completed event', async () => {
      const listener = vi.fn();
      controller.on('spawn:completed', listener);

      mockQueue.getReadyItems.mockResolvedValue([{
        id: 'sq-1',
        requesterHandle: 'lead-1',
        targetAgentType: 'worker',
        depthLevel: 0,
        swarmId: null,
        payload: { task: 'Work', context: {} },
      }]);

      await controller.processQueue();
      expect(listener).toHaveBeenCalledWith({ requestId: 'sq-1', workerId: 'w-1' });
    });

    it('should reject items that fail spawn check', async () => {
      const listener = vi.fn();
      controller.on('spawn:rejected', listener);

      // Depth 10 exceeds max
      mockQueue.getReadyItems.mockResolvedValue([{
        id: 'sq-1',
        requesterHandle: 'lead-1',
        targetAgentType: 'worker',
        depthLevel: 10,
        swarmId: null,
        payload: { task: 'Too deep', context: {} },
      }]);

      const count = await controller.processQueue();
      expect(count).toBe(0);
      expect(mockQueue.updateStatus).toHaveBeenCalledWith('sq-1', 'rejected');
      expect(listener).toHaveBeenCalled();
    });

    it('should handle spawn errors gracefully', async () => {
      mockManager.spawnWorker.mockRejectedValue(new Error('Process failed'));
      const listener = vi.fn();
      controller.on('spawn:rejected', listener);

      mockQueue.getReadyItems.mockResolvedValue([{
        id: 'sq-1',
        requesterHandle: 'lead-1',
        targetAgentType: 'worker',
        depthLevel: 0,
        swarmId: null,
        payload: { task: 'Work', context: {} },
      }]);

      const count = await controller.processQueue();
      expect(count).toBe(0);
      expect(listener).toHaveBeenCalledWith({
        requestId: 'sq-1',
        reason: 'Process failed',
      });
    });

    it('should return 0 when at hard limit', async () => {
      const small = new SpawnController({ hardLimit: 0, autoProcess: false });
      small.initialize(mockQueue as never, mockManager as never);
      const count = await small.processQueue();
      expect(count).toBe(0);
      small.destroy();
    });
  });

  // ======================================================================
  // getQueueStats / getQueueStatsAsync
  // ======================================================================

  describe('getQueueStats', () => {
    it('should return null queue and limits', () => {
      const stats = controller.getQueueStats();
      expect(stats.queue).toBeNull();
      expect(stats.limits.current).toBe(0);
    });
  });

  describe('getQueueStatsAsync', () => {
    it('should return queue stats when initialized', async () => {
      controller.initialize(mockQueue as never, mockManager as never);
      const stats = await controller.getQueueStatsAsync();
      expect(stats.queue).toEqual({ pending: 0, approved: 0, spawned: 0, rejected: 0, blocked: 0 });
      expect(stats.limits).toBeDefined();
    });

    it('should return null queue when not initialized', async () => {
      const stats = await controller.getQueueStatsAsync();
      expect(stats.queue).toBeNull();
    });
  });

  // ======================================================================
  // startProcessing / stopProcessing / destroy
  // ======================================================================

  describe('processing lifecycle', () => {
    it('should start and stop processing', () => {
      controller.startProcessing();
      // No error
      controller.stopProcessing();
    });

    it('should not start multiple intervals', () => {
      controller.startProcessing();
      controller.startProcessing(); // idempotent
      controller.stopProcessing();
    });

    it('should clean up on destroy', () => {
      controller.registerSpawn(1, 'w-1', 'id-1');
      controller.startProcessing();
      controller.destroy();
      expect(controller.getCurrentCount()).toBe(0);
    });
  });
});
