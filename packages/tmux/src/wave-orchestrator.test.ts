/**
 * WaveOrchestrator Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaveOrchestrator, createPipeline, createParallelWave } from './wave-orchestrator.js';

// Mock fleet managers
vi.mock('./fleet-manager.js', () => {
  return {
    FleetTmuxManager: class MockFleetTmuxManager {
      spawnWorker = vi.fn().mockResolvedValue({ paneId: '%1', handle: 'test' });
      spawnClaudeWorker = vi.fn().mockResolvedValue({ paneId: '%1', handle: 'test' });
      captureWorkerOutput = vi.fn().mockReturnValue('completed');
      killWorker = vi.fn().mockReturnValue(true);
    },
  };
});

vi.mock('./remote-fleet-manager.js', () => {
  return {
    RemoteFleetManager: class MockRemoteFleetManager {
      spawnWorker = vi.fn().mockResolvedValue({ paneId: '%1', handle: 'test' });
      captureWorkerOutput = vi.fn().mockReturnValue('completed');
      killWorker = vi.fn().mockReturnValue(true);
    },
  };
});

vi.mock('./context-manager.js', () => {
  return {
    ContextManager: class MockContextManager {
      analyzeContext = vi.fn().mockReturnValue({
        usageRatio: 0.5,
        totalLines: 100,
        estimatedTokens: 1000,
        toolCallCount: 5,
        errorCount: 0,
        lastActivity: Date.now(),
      });
    },
  };
});

describe('WaveOrchestrator', () => {
  let orchestrator: WaveOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new WaveOrchestrator({ fleetName: 'test-fleet' });
  });

  describe('Wave Management', () => {
    it('adds a wave', () => {
      orchestrator.addWave({
        name: 'setup',
        workers: [{ handle: 'worker1' }],
      });

      const status = orchestrator.getStatus();
      expect(status.pendingWaves).toContain('setup');
    });

    it('adds multiple waves', () => {
      orchestrator.addWaves([
        { name: 'wave1', workers: [{ handle: 'w1' }] },
        { name: 'wave2', workers: [{ handle: 'w2' }] },
      ]);

      const status = orchestrator.getStatus();
      expect(status.pendingWaves).toHaveLength(2);
    });
  });

  describe('Execution', () => {
    it('executes single wave', async () => {
      orchestrator.addWave({
        name: 'test',
        workers: [{ handle: 'worker1', successPattern: 'completed' }],
      });

      const results = await orchestrator.execute();

      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(true);
    });

    it('executes waves in dependency order', async () => {
      const executionOrder: string[] = [];

      orchestrator.addWave({
        name: 'phase1',
        workers: [{
          handle: 'w1',
          successPattern: 'completed',
        }],
      });

      orchestrator.addWave({
        name: 'phase2',
        workers: [{
          handle: 'w2',
          successPattern: 'completed',
        }],
        afterWaves: ['phase1'],
      });

      orchestrator.on('wave:start', ({ wave }) => {
        executionOrder.push(wave);
      });

      await orchestrator.execute();

      expect(executionOrder).toEqual(['phase1', 'phase2']);
    });

    it('detects circular dependencies', async () => {
      orchestrator.addWave({
        name: 'A',
        workers: [{ handle: 'wa' }],
        afterWaves: ['B'],
      });

      orchestrator.addWave({
        name: 'B',
        workers: [{ handle: 'wb' }],
        afterWaves: ['A'],
      });

      await expect(orchestrator.execute()).rejects.toThrow('Circular dependency');
    });

    it('emits events during execution', async () => {
      const events: string[] = [];

      orchestrator.addWave({
        name: 'test',
        workers: [{ handle: 'w1', successPattern: 'completed' }],
      });

      orchestrator.on('start', () => events.push('start'));
      orchestrator.on('wave:start', () => events.push('wave:start'));
      orchestrator.on('worker:spawned', () => events.push('worker:spawned'));
      orchestrator.on('worker:success', () => events.push('worker:success'));
      orchestrator.on('wave:complete', () => events.push('wave:complete'));
      orchestrator.on('complete', () => events.push('complete'));

      await orchestrator.execute();

      expect(events).toContain('start');
      expect(events).toContain('complete');
    });
  });

  describe('Status', () => {
    it('reports initial status', () => {
      const status = orchestrator.getStatus();
      expect(status.status).toBe('idle');
      expect(status.activeWorkers).toHaveLength(0);
    });

    it('reports running status during execution', async () => {
      orchestrator.addWave({
        name: 'test',
        workers: [{ handle: 'w1', successPattern: 'completed' }],
      });

      let runningStatus: string | undefined;
      orchestrator.on('wave:start', () => {
        runningStatus = orchestrator.getStatus().status;
      });

      await orchestrator.execute();

      expect(runningStatus).toBe('running');
    });

    it('reports completed status after success', async () => {
      orchestrator.addWave({
        name: 'test',
        workers: [{ handle: 'w1', successPattern: 'completed' }],
      });

      await orchestrator.execute();

      const status = orchestrator.getStatus();
      expect(status.status).toBe('completed');
      expect(status.completedWaves).toContain('test');
    });
  });

  describe('Cancellation', () => {
    it('sets failed status on cancel', async () => {
      await orchestrator.cancel();

      const status = orchestrator.getStatus();
      expect(status.status).toBe('failed');
    });
  });
});

describe('Helper Functions', () => {
  describe('createPipeline', () => {
    it('creates linear pipeline', () => {
      const pipeline = createPipeline('my-pipeline', [
        { name: 'lint', workers: [{ handle: 'linter' }] },
        { name: 'test', workers: [{ handle: 'tester' }] },
        { name: 'build', workers: [{ handle: 'builder' }] },
      ]);

      expect(pipeline).toBeInstanceOf(WaveOrchestrator);
    });
  });

  describe('createParallelWave', () => {
    it('creates parallel wave', () => {
      const wave = createParallelWave('parallel-tasks', [
        { handle: 'task1' },
        { handle: 'task2' },
        { handle: 'task3' },
      ]);

      expect(wave.name).toBe('parallel-tasks');
      expect(wave.workers).toHaveLength(3);
    });
  });
});
