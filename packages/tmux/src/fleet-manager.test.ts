/**
 * FleetTmuxManager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetTmuxManager } from './fleet-manager.js';

// Mock the controller using a class
vi.mock('./controller.js', () => {
  return {
    TmuxController: class MockTmuxController {
      isInsideTmux = vi.fn().mockReturnValue(true);
      isTmuxInstalled = vi.fn().mockReturnValue(true);
      getCurrentSession = vi.fn().mockReturnValue('main');
      getCurrentWindow = vi.fn().mockReturnValue('0');
      getCurrentPane = vi.fn().mockReturnValue('%0');
      getActivePaneId = vi.fn().mockReturnValue('%0');
      listPanes = vi.fn().mockReturnValue([
        { id: '%0', index: 0, title: 'main', active: true, width: 80, height: 24, command: 'zsh', pid: 1234 },
      ]);
      listWindows = vi.fn().mockReturnValue([
        { id: '@0', index: 0, name: 'main', active: true, paneCount: 1 },
      ]);
      listSessions = vi.fn().mockReturnValue([
        { id: '$0', name: 'main', created: Date.now(), attached: true, windowCount: 1 },
      ]);
      createPane = vi.fn().mockReturnValue({
        id: '%1', index: 1, title: 'new', active: false, width: 80, height: 24, command: 'zsh', pid: 5678,
      });
      createSession = vi.fn().mockReturnValue('$1');
      setPaneTitle = vi.fn();
      sendKeys = vi.fn().mockResolvedValue(undefined);
      sendInterrupt = vi.fn();
      sendEscape = vi.fn();
      capture = vi.fn().mockReturnValue('output text');
      execute = vi.fn().mockResolvedValue({
        output: 'command output',
        exitCode: 0,
        completed: true,
        duration: 100,
      });
      waitForIdle = vi.fn().mockResolvedValue(true);
      waitForPattern = vi.fn().mockResolvedValue(true);
      killPane = vi.fn().mockReturnValue(true);
      killSession = vi.fn().mockReturnValue(true);
      focusPane = vi.fn();
      getAttachCommand = vi.fn().mockReturnValue('tmux attach-session -t main');
      sessionExists = vi.fn().mockReturnValue(true);
    },
  };
});

describe('FleetTmuxManager', () => {
  let manager: FleetTmuxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new FleetTmuxManager();
  });

  describe('Availability', () => {
    it('reports available when inside tmux', () => {
      expect(manager.isAvailable()).toBe(true);
    });

    it('reports unavailable when not inside tmux', () => {
      const controller = manager.getController();
      vi.mocked(controller.isInsideTmux).mockReturnValue(false);

      expect(manager.isAvailable()).toBe(false);
    });
  });

  describe('Status', () => {
    it('returns fleet status', () => {
      const status = manager.getStatus();

      expect(status.insideTmux).toBe(true);
      expect(status.session).toBe('main');
      expect(status.window).toBe('0');
      expect(status.pane).toBe('%0');
      expect(status.totalPanes).toBe(1);
    });

    it('returns minimal status when not in tmux', () => {
      const controller = manager.getController();
      vi.mocked(controller.isInsideTmux).mockReturnValue(false);

      const status = manager.getStatus();

      expect(status.insideTmux).toBe(false);
      expect(status.workers).toEqual([]);
    });
  });

  describe('Worker Management', () => {
    it('spawns a worker', async () => {
      const worker = await manager.spawnWorker({
        handle: 'alice',
        role: 'worker',
      });

      expect(worker).toBeDefined();
      expect(worker?.handle).toBe('alice');
      expect(worker?.paneId).toBe('%1');
    });

    it('throws when spawning duplicate handle', async () => {
      await manager.spawnWorker({ handle: 'alice' });

      await expect(manager.spawnWorker({ handle: 'alice' }))
        .rejects.toThrow('already exists');
    });

    it('spawns Claude worker with prompt', async () => {
      const controller = manager.getController();

      await manager.spawnClaudeWorker({
        handle: 'claude-1',
        prompt: 'You are a helpful assistant',
      });

      // Shell-first pattern: pane is created with 'zsh', then command is sent via sendKeys
      expect(controller.createPane).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'zsh',
        })
      );

      // Claude command is sent via sendKeys after pane creation
      expect(controller.sendKeys).toHaveBeenCalledWith(
        '%1',
        expect.stringContaining('--print')
      );
      expect(controller.sendKeys).toHaveBeenCalledWith(
        '%1',
        expect.stringContaining('You are a helpful assistant')
      );
    });

    it('lists workers', async () => {
      await manager.spawnWorker({ handle: 'alice' });
      await manager.spawnWorker({ handle: 'bob' });

      const workers = manager.listWorkers();

      expect(workers.length).toBe(2);
      expect(workers.map(w => w.handle)).toContain('alice');
      expect(workers.map(w => w.handle)).toContain('bob');
    });

    it('gets worker by handle', async () => {
      await manager.spawnWorker({ handle: 'alice' });

      const worker = manager.getWorker('alice');

      expect(worker).toBeDefined();
      expect(worker?.handle).toBe('alice');
    });

    it('returns undefined for unknown worker', () => {
      expect(manager.getWorker('unknown')).toBeUndefined();
    });
  });

  describe('Worker Communication', () => {
    beforeEach(async () => {
      await manager.spawnWorker({ handle: 'alice' });
    });

    it('sends message to worker', async () => {
      const controller = manager.getController();

      await manager.sendToWorker('alice', 'Hello!');

      expect(controller.sendKeys).toHaveBeenCalledWith('%1', 'Hello!');
    });

    it('throws when sending to unknown worker', async () => {
      await expect(manager.sendToWorker('unknown', 'Hi'))
        .rejects.toThrow('not found');
    });

    it('executes command in worker', async () => {
      const result = await manager.executeInWorker('alice', 'ls -la');

      expect(result.completed).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('captures worker output', () => {
      const output = manager.captureWorkerOutput('alice');

      expect(output).toBe('output text');
    });

    it('waits for worker idle', async () => {
      const idle = await manager.waitForWorkerIdle('alice');

      expect(idle).toBe(true);
    });

    it('waits for worker pattern', async () => {
      const found = await manager.waitForWorkerPattern('alice', /prompt/);

      expect(found).toBe(true);
    });

    it('interrupts worker', () => {
      const controller = manager.getController();

      manager.interruptWorker('alice');

      expect(controller.sendInterrupt).toHaveBeenCalledWith('%1');
    });

    it('sends escape to worker', () => {
      const controller = manager.getController();
      vi.mocked(controller).sendEscape = vi.fn();

      manager.escapeWorker('alice');

      expect(controller.sendEscape).toHaveBeenCalledWith('%1');
    });

    it('broadcasts to all workers', async () => {
      await manager.spawnWorker({ handle: 'bob' });
      const controller = manager.getController();

      await manager.broadcast('Hello everyone!');

      expect(controller.sendKeys).toHaveBeenCalledTimes(2);
    });
  });

  describe('Worker Termination', () => {
    beforeEach(async () => {
      await manager.spawnWorker({ handle: 'alice' });
      await manager.spawnWorker({ handle: 'bob' });
    });

    it('kills a worker', () => {
      const result = manager.killWorker('alice');

      expect(result).toBe(true);
      expect(manager.getWorker('alice')).toBeUndefined();
    });

    it('returns false for unknown worker', () => {
      const result = manager.killWorker('unknown');

      expect(result).toBe(false);
    });

    it('kills all workers', () => {
      const killed = manager.killAllWorkers();

      expect(killed).toBe(2);
      expect(manager.listWorkers()).toHaveLength(0);
    });
  });

  describe('Pane Control', () => {
    beforeEach(async () => {
      await manager.spawnWorker({ handle: 'alice' });
    });

    it('focuses on worker', () => {
      const controller = manager.getController();

      manager.focusWorker('alice');

      expect(controller.focusPane).toHaveBeenCalledWith('%1');
    });

    it('throws when focusing unknown worker', () => {
      expect(() => manager.focusWorker('unknown')).toThrow('not found');
    });
  });
});
