/**
 * Worker Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkerStore } from './worker.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { setDatabasePath, resetDatabase } from '../database.js';

describe('WorkerStore', () => {
  let store: WorkerStore;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `cct-worker-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
    store = new WorkerStore();
  });

  afterEach(() => {
    resetDatabase();
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
      if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('upsert()', () => {
    it('creates a new worker', () => {
      const worker = store.upsert({
        id: 'worker-1',
        handle: 'alice',
        status: 'pending',
        role: 'worker',
        createdAt: Date.now(),
      });

      expect(worker.id).toBe('worker-1');
      expect(worker.handle).toBe('alice');
      expect(worker.status).toBe('pending');
    });

    it('creates worker with all optional fields', () => {
      const worker = store.upsert({
        id: 'worker-2',
        handle: 'bob',
        status: 'ready',
        role: 'coordinator',
        worktreePath: '/path/to/worktree',
        worktreeBranch: 'feature-branch',
        pid: 12345,
        sessionId: 'session-123',
        initialPrompt: 'You are a coordinator',
        createdAt: Date.now(),
      });

      expect(worker.role).toBe('coordinator');
      expect(worker.worktreePath).toBe('/path/to/worktree');
      expect(worker.worktreeBranch).toBe('feature-branch');
      expect(worker.pid).toBe(12345);
      expect(worker.sessionId).toBe('session-123');
      expect(worker.initialPrompt).toBe('You are a coordinator');
    });

    it('updates existing worker', () => {
      store.upsert({
        id: 'worker-3',
        handle: 'charlie',
        status: 'pending',
        role: 'worker',
        createdAt: Date.now(),
      });

      store.upsert({
        id: 'worker-3',
        handle: 'charlie',
        status: 'ready',
        role: 'worker',
        pid: 9999,
        createdAt: Date.now(),
      });

      const updated = store.get('worker-3');
      expect(updated?.status).toBe('ready');
      expect(updated?.pid).toBe(9999);
    });
  });

  describe('get()', () => {
    it('retrieves worker by ID', () => {
      store.upsert({
        id: 'get-test',
        handle: 'test',
        status: 'pending',
        role: 'worker',
        createdAt: Date.now(),
      });

      const worker = store.get('get-test');
      expect(worker).toBeDefined();
      expect(worker?.id).toBe('get-test');
    });

    it('returns undefined for non-existent worker', () => {
      const worker = store.get('nonexistent');
      expect(worker).toBeUndefined();
    });
  });

  describe('getByHandle()', () => {
    it('retrieves worker by handle', () => {
      store.upsert({
        id: 'handle-test',
        handle: 'unique-handle',
        status: 'pending',
        role: 'worker',
        createdAt: Date.now(),
      });

      const worker = store.getByHandle('unique-handle');
      expect(worker).toBeDefined();
      expect(worker?.handle).toBe('unique-handle');
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      store.upsert({ id: 'w1', handle: 'a', status: 'pending', role: 'worker', createdAt: Date.now() });
      store.upsert({ id: 'w2', handle: 'b', status: 'ready', role: 'worker', createdAt: Date.now() });
      store.upsert({ id: 'w3', handle: 'c', status: 'busy', role: 'coordinator', createdAt: Date.now() });
      const dismissed = store.upsert({ id: 'w4', handle: 'd', status: 'dismissed', role: 'worker', createdAt: Date.now() });
      store.updateStatus(dismissed.id, 'dismissed');
    });

    it('lists all active workers by default', () => {
      const workers = store.list();
      expect(workers.length).toBe(3); // Excludes dismissed
    });

    it('includes dismissed when specified', () => {
      const workers = store.list({ includesDismissed: true });
      expect(workers.length).toBe(4);
    });

    it('filters by status', () => {
      const ready = store.list({ status: 'ready' });
      expect(ready.length).toBe(1);
      expect(ready[0].handle).toBe('b');
    });

    it('filters by multiple statuses', () => {
      const workers = store.list({ status: ['pending', 'ready'] });
      expect(workers.length).toBe(2);
    });

    it('filters by role', () => {
      const coordinators = store.list({ role: 'coordinator' });
      expect(coordinators.length).toBe(1);
      expect(coordinators[0].handle).toBe('c');
    });
  });

  describe('updateStatus()', () => {
    it('updates worker status', () => {
      store.upsert({ id: 'status-test', handle: 'test', status: 'pending', role: 'worker', createdAt: Date.now() });

      store.updateStatus('status-test', 'ready');

      const updated = store.get('status-test');
      expect(updated?.status).toBe('ready');
    });

    it('sets dismissedAt when dismissed', () => {
      store.upsert({ id: 'dismiss-test', handle: 'test', status: 'ready', role: 'worker', createdAt: Date.now() });

      store.updateStatus('dismiss-test', 'dismissed');

      const updated = store.get('dismiss-test');
      expect(updated?.status).toBe('dismissed');
      expect(updated?.dismissedAt).toBeDefined();
    });
  });

  describe('heartbeat()', () => {
    it('updates last heartbeat', () => {
      store.upsert({ id: 'hb-test', handle: 'test', status: 'ready', role: 'worker', createdAt: Date.now(), lastHeartbeat: 1000 });

      store.heartbeat('hb-test');

      const updated = store.get('hb-test');
      expect(updated?.lastHeartbeat).toBeGreaterThan(1000);
    });
  });

  describe('incrementRestarts()', () => {
    it('increments restart count', () => {
      store.upsert({ id: 'restart-test', handle: 'test', status: 'ready', role: 'worker', createdAt: Date.now(), restartCount: 0 });

      const count1 = store.incrementRestarts('restart-test');
      expect(count1).toBe(1);

      const count2 = store.incrementRestarts('restart-test');
      expect(count2).toBe(2);
    });
  });

  describe('updatePid()', () => {
    it('updates worker PID', () => {
      store.upsert({ id: 'pid-test', handle: 'test', status: 'ready', role: 'worker', createdAt: Date.now() });

      store.updatePid('pid-test', 54321);

      const updated = store.get('pid-test');
      expect(updated?.pid).toBe(54321);
    });
  });

  describe('updateSessionId()', () => {
    it('updates worker session ID', () => {
      store.upsert({ id: 'session-test', handle: 'test', status: 'ready', role: 'worker', createdAt: Date.now() });

      store.updateSessionId('session-test', 'new-session');

      const updated = store.get('session-test');
      expect(updated?.sessionId).toBe('new-session');
    });
  });

  describe('delete()', () => {
    it('deletes a worker', () => {
      store.upsert({ id: 'delete-test', handle: 'test', status: 'pending', role: 'worker', createdAt: Date.now() });

      const result = store.delete('delete-test');
      expect(result).toBe(true);
      expect(store.get('delete-test')).toBeUndefined();
    });

    it('returns false for non-existent worker', () => {
      const result = store.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getStale()', () => {
    it('gets workers with old heartbeats', () => {
      const now = Date.now();
      store.upsert({ id: 'fresh', handle: 'a', status: 'ready', role: 'worker', createdAt: now, lastHeartbeat: now });
      store.upsert({ id: 'stale', handle: 'b', status: 'ready', role: 'worker', createdAt: now, lastHeartbeat: now - 120000 });

      const stale = store.getStale(60000);
      expect(stale.length).toBe(1);
      expect(stale[0].handle).toBe('b');
    });

    it('excludes dismissed workers', () => {
      const now = Date.now();
      store.upsert({ id: 'stale-dismissed', handle: 'c', status: 'dismissed', role: 'worker', createdAt: now, lastHeartbeat: now - 120000 });

      const stale = store.getStale(60000);
      expect(stale.length).toBe(0);
    });
  });

  describe('getRecoverable()', () => {
    it('gets workers that need recovery', () => {
      store.upsert({ id: 'r1', handle: 'a', status: 'pending', role: 'worker', createdAt: Date.now() });
      store.upsert({ id: 'r2', handle: 'b', status: 'ready', role: 'worker', createdAt: Date.now() });
      store.upsert({ id: 'r3', handle: 'c', status: 'busy', role: 'worker', createdAt: Date.now() });
      store.upsert({ id: 'r4', handle: 'd', status: 'error', role: 'worker', createdAt: Date.now() });
      const dismissed = store.upsert({ id: 'r5', handle: 'e', status: 'dismissed', role: 'worker', createdAt: Date.now() });
      store.updateStatus(dismissed.id, 'dismissed');

      const recoverable = store.getRecoverable();
      expect(recoverable.length).toBe(3); // pending, ready, busy
    });
  });
});
