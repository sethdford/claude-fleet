/**
 * RemoteFleetManager Tests
 *
 * Tests headless/API-driven fleet management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteFleetManager } from './remote-fleet-manager.js';

// Mock TmuxController as a class
vi.mock('./controller.js', () => {
  return {
    TmuxController: class MockTmuxController {
      isTmuxInstalled = vi.fn().mockReturnValue(true);
      isInsideTmux = vi.fn().mockReturnValue(false);
      sessionExists = vi.fn().mockReturnValue(false);
      createSession = vi.fn().mockReturnValue('$0');
      createWindow = vi.fn().mockReturnValue('@1');
      listSessions = vi.fn().mockReturnValue([]);
      listWindows = vi.fn().mockReturnValue([]);
      listPanes = vi.fn().mockReturnValue([{ id: '%0', index: 0, active: true }]);
      sendKeys = vi.fn().mockResolvedValue(undefined);
      capture = vi.fn().mockReturnValue('output');
      execute = vi.fn().mockResolvedValue({ output: 'test', exitCode: 0, completed: true, duration: 100 });
      killWindow = vi.fn().mockReturnValue(true);
      killSession = vi.fn().mockReturnValue(true);
    },
  };
});

describe('RemoteFleetManager', () => {
  let manager: RemoteFleetManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new RemoteFleetManager({
      fleetName: 'test-fleet',
      baseCwd: '/tmp/test',
    });
  });

  describe('Initialization', () => {
    it('creates manager with config', () => {
      expect(manager).toBeDefined();
      expect(manager.isAvailable()).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('creates detached session', () => {
      const sessionName = manager.createSession();
      expect(sessionName).toBe('test-fleet-0');
    });
  });

  describe('Worker Spawning', () => {
    it('spawns worker in detached session', async () => {
      const worker = await manager.spawnWorker({
        handle: 'alice',
        role: 'worker',
        command: 'echo hello',
      });

      expect(worker).toBeDefined();
      expect(worker?.handle).toBe('alice');
      expect(worker?.paneId).toBe('%0');
      expect(worker?.sessionName).toBe('test-fleet-0');
      expect(worker?.isActive).toBe(true);
    });

    it('throws on duplicate worker handle', async () => {
      await manager.spawnWorker({ handle: 'bob' });
      await expect(manager.spawnWorker({ handle: 'bob' })).rejects.toThrow(
        'Worker with handle "bob" already exists'
      );
    });

    it('spawns Claude worker with options', async () => {
      const worker = await manager.spawnClaudeWorker({
        handle: 'claude-worker',
        prompt: 'Hello world',
        model: 'opus',
        skipPermissions: true,
      });

      expect(worker).toBeDefined();
      expect(worker?.handle).toBe('claude-worker');
    });
  });

  describe('Worker Operations', () => {
    beforeEach(async () => {
      await manager.spawnWorker({ handle: 'test-worker' });
    });

    it('sends message to worker', async () => {
      await expect(manager.sendToWorker('test-worker', 'hello')).resolves.not.toThrow();
    });

    it('captures worker output', () => {
      const output = manager.captureWorkerOutput('test-worker');
      expect(output).toBe('output');
    });

    it('executes command in worker', async () => {
      const result = await manager.executeInWorker('test-worker', 'ls -la');
      expect(result.output).toBe('test');
      expect(result.exitCode).toBe(0);
    });

    it('kills worker', () => {
      const result = manager.killWorker('test-worker');
      expect(result).toBe(true);
    });

    it('throws on unknown worker', async () => {
      await expect(manager.sendToWorker('unknown', 'hello')).rejects.toThrow(
        'Worker "unknown" not found'
      );
    });
  });

  describe('Session Lineage', () => {
    it('tracks session lineage for workers', async () => {
      await manager.spawnWorker({ handle: 'tracked-worker' });

      const lineage = manager.getWorkerLineage('tracked-worker');
      expect(lineage).toBeDefined();
      expect(lineage?.sessionName).toBe('test-fleet-0');
      expect(lineage?.workerHandles).toContain('tracked-worker');
    });

    it('tracks command count in session', async () => {
      await manager.spawnWorker({ handle: 'counting-worker' });

      const initialLineage = manager.getWorkerLineage('counting-worker');
      expect(initialLineage?.commandCount).toBe(0);

      await manager.sendToWorker('counting-worker', 'command1');
      await manager.sendToWorker('counting-worker', 'command2');

      const updatedLineage = manager.getWorkerLineage('counting-worker');
      expect(updatedLineage?.commandCount).toBe(2);
    });

    it('checks context rollover need', async () => {
      await manager.spawnWorker({ handle: 'context-worker' });

      // Initially, no rollover needed
      expect(manager.needsContextRollover('context-worker')).toBe(false);

      // After many commands, rollover should be needed
      for (let i = 0; i < 100; i++) {
        await manager.sendToWorker('context-worker', `command${i}`);
      }

      expect(manager.needsContextRollover('context-worker', 0.8)).toBe(true);
    });
  });

  describe('Fleet Snapshot', () => {
    it('returns fleet snapshot', async () => {
      await manager.spawnWorker({ handle: 'snap-worker' });

      const snapshot = manager.getSnapshot();
      expect(snapshot.fleetName).toBe('test-fleet');
      expect(snapshot.workers.length).toBe(1);
      expect(snapshot.sessions.length).toBe(1);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });
  });

  describe('Fleet Lifecycle', () => {
    it('kills entire fleet', async () => {
      await manager.spawnWorker({ handle: 'w1' });
      await manager.spawnWorker({ handle: 'w2' });

      const killed = manager.killFleet();
      expect(killed).toBeGreaterThan(0);
      expect(manager.listWorkers()).toHaveLength(0);
    });

    it('returns attach command', () => {
      const cmd = manager.getAttachCommand();
      expect(cmd).toBe('tmux attach-session -t test-fleet-0');
    });
  });
});
