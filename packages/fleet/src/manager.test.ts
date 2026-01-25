/**
 * Fleet Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetManager } from './manager.js';
import { setDatabasePath, resetDatabase } from '@claude-fleet/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('FleetManager', () => {
  let manager: FleetManager;
  let tempDbPath: string;

  beforeEach(() => {
    // Create temp database for testing
    tempDbPath = path.join(os.tmpdir(), `cct-fleet-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
    manager = new FleetManager({ worktreesEnabled: false });
  });

  afterEach(() => {
    // Reset database connection
    resetDatabase();

    // Clean up temp database files
    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
      if (fs.existsSync(`${tempDbPath}-wal`)) {
        fs.unlinkSync(`${tempDbPath}-wal`);
      }
      if (fs.existsSync(`${tempDbPath}-shm`)) {
        fs.unlinkSync(`${tempDbPath}-shm`);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('spawn()', () => {
    it('spawns a new worker', async () => {
      const worker = await manager.spawn({
        handle: 'worker1',
        role: 'worker',
      });

      expect(worker.id).toBeDefined();
      expect(worker.handle).toBe('worker1');
      expect(worker.role).toBe('worker');
      expect(worker.status).toBe('pending');
    });

    it('spawns with different roles', async () => {
      const coordinator = await manager.spawn({
        handle: 'coord',
        role: 'coordinator',
      });
      expect(coordinator.role).toBe('coordinator');

      const scout = await manager.spawn({
        handle: 'scout1',
        role: 'scout',
      });
      expect(scout.role).toBe('scout');
    });

    it('stores initial prompt', async () => {
      const worker = await manager.spawn({
        handle: 'worker1',
        prompt: 'Do the task',
      });
      expect(worker.initialPrompt).toBe('Do the task');
    });

    it('rejects duplicate handles', async () => {
      await manager.spawn({ handle: 'worker1' });
      await expect(manager.spawn({ handle: 'worker1' })).rejects.toThrow();
    });
  });

  describe('dismiss()', () => {
    it('dismisses a worker', async () => {
      await manager.spawn({ handle: 'worker1' });
      const result = await manager.dismiss('worker1');
      expect(result).toBe(true);
    });

    it('returns false for non-existent worker', async () => {
      const result = await manager.dismiss('nonexistent');
      expect(result).toBe(false);
    });

    it('marks worker as dismissed', async () => {
      await manager.spawn({ handle: 'worker1' });
      await manager.dismiss('worker1');

      const workers = manager.listWorkers({ status: 'dismissed' });
      expect(workers.some(w => w.handle === 'worker1')).toBe(true);
    });
  });

  describe('listWorkers()', () => {
    it('lists all workers', async () => {
      await manager.spawn({ handle: 'worker1' });
      await manager.spawn({ handle: 'worker2' });
      await manager.spawn({ handle: 'worker3' });

      const workers = manager.listWorkers();
      expect(workers.length).toBe(3);
    });

    it('filters by status', async () => {
      await manager.spawn({ handle: 'worker1' });
      await manager.spawn({ handle: 'worker2' });
      await manager.dismiss('worker1');

      const active = manager.listWorkers({ status: 'pending' });
      expect(active.length).toBe(1);
      expect(active[0].handle).toBe('worker2');
    });

    it('filters by role', async () => {
      await manager.spawn({ handle: 'coord', role: 'coordinator' });
      await manager.spawn({ handle: 'worker1', role: 'worker' });
      await manager.spawn({ handle: 'worker2', role: 'worker' });

      const workers = manager.listWorkers({ role: 'worker' });
      expect(workers.length).toBe(2);
    });
  });

  describe('getWorker()', () => {
    it('retrieves a worker by handle', async () => {
      await manager.spawn({ handle: 'worker1', role: 'scout' });
      const worker = manager.getWorker('worker1');
      expect(worker).toBeDefined();
      expect(worker?.handle).toBe('worker1');
      expect(worker?.role).toBe('scout');
    });

    it('returns undefined for non-existent worker', () => {
      const worker = manager.getWorker('nonexistent');
      expect(worker).toBeUndefined();
    });
  });

  describe('updateStatus()', () => {
    it('updates worker status', async () => {
      await manager.spawn({ handle: 'worker1' });
      manager.updateStatus('worker1', 'ready');

      const worker = manager.getWorker('worker1');
      expect(worker?.status).toBe('ready');
    });

    it('updates heartbeat timestamp', async () => {
      const spawned = await manager.spawn({ handle: 'worker1' });
      const initialHeartbeat = spawned.lastHeartbeat;

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 10));
      manager.updateStatus('worker1', 'busy');

      const worker = manager.getWorker('worker1');
      expect(worker?.lastHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat);
    });
  });

  describe('getStatus()', () => {
    it('returns fleet status', async () => {
      await manager.spawn({ handle: 'worker1', role: 'worker' });
      await manager.spawn({ handle: 'worker2', role: 'worker' });
      await manager.spawn({ handle: 'coord', role: 'coordinator' });

      const status = manager.getStatus();
      expect(status.totalWorkers).toBe(3);
      expect(status.byRole.worker).toBe(2);
      expect(status.byRole.coordinator).toBe(1);
    });

    it('counts by status', async () => {
      await manager.spawn({ handle: 'worker1' });
      await manager.spawn({ handle: 'worker2' });
      manager.updateStatus('worker1', 'ready');
      await manager.dismiss('worker2');

      const status = manager.getStatus();
      expect(status.byStatus.ready).toBe(1);
      expect(status.byStatus.dismissed).toBe(1);
    });
  });

  describe('broadcast()', () => {
    it('broadcasts message to all workers', async () => {
      await manager.spawn({ handle: 'worker1' });
      await manager.spawn({ handle: 'worker2' });

      // Should not throw
      expect(() => {
        manager.broadcast('Hello everyone!', 'coordinator');
      }).not.toThrow();
    });
  });

  describe('sendMessage()', () => {
    it('sends message to specific worker', async () => {
      await manager.spawn({ handle: 'worker1' });

      expect(() => {
        manager.sendMessage('worker1', 'Hello!', 'coordinator', 'Greeting');
      }).not.toThrow();
    });
  });

  describe('checkpoint operations', () => {
    it('creates and retrieves checkpoint', async () => {
      await manager.spawn({ handle: 'worker1' });

      manager.createCheckpoint('worker1', {
        goal: 'Complete the task',
        worked: ['Step 1', 'Step 2'],
        remaining: ['Step 3'],
      });

      const checkpoint = manager.getCheckpoint('worker1');
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.goal).toBe('Complete the task');
      expect(checkpoint?.worked).toEqual(['Step 1', 'Step 2']);
      expect(checkpoint?.remaining).toEqual(['Step 3']);
    });

    it('returns undefined for worker without checkpoint', async () => {
      await manager.spawn({ handle: 'worker1' });
      const checkpoint = manager.getCheckpoint('worker1');
      expect(checkpoint).toBeUndefined();
    });
  });

  describe('handoff()', () => {
    it('transfers context between workers', async () => {
      await manager.spawn({ handle: 'worker1' });
      await manager.spawn({ handle: 'worker2' });

      expect(() => {
        manager.handoff('worker1', 'worker2', {
          currentTask: 'Finish feature X',
          progress: 50,
        });
      }).not.toThrow();
    });
  });
});
