/**
 * Checkpoint Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CheckpointStore } from './checkpoint.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { setDatabasePath, resetDatabase } from '../database.js';

describe('CheckpointStore', () => {
  let store: CheckpointStore;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `cct-checkpoint-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
    store = new CheckpointStore();
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

  describe('create()', () => {
    it('creates a new checkpoint', () => {
      const checkpoint = store.create({
        workerHandle: 'worker-1',
        goal: 'Implement feature X',
      });

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.workerHandle).toBe('worker-1');
      expect(checkpoint.goal).toBe('Implement feature X');
      expect(checkpoint.createdAt).toBeDefined();
    });

    it('creates checkpoint with optional fields', () => {
      const checkpoint = store.create({
        workerHandle: 'worker-1',
        goal: 'Complete task',
        worked: ['Step 1', 'Step 2'],
        remaining: ['Step 3', 'Step 4'],
        context: { file: 'main.ts', line: 42 },
      });

      expect(checkpoint.worked).toEqual(['Step 1', 'Step 2']);
      expect(checkpoint.remaining).toEqual(['Step 3', 'Step 4']);
      expect(checkpoint.context).toEqual({ file: 'main.ts', line: 42 });
    });
  });

  describe('get()', () => {
    it('retrieves checkpoint by ID', () => {
      const created = store.create({
        workerHandle: 'worker-1',
        goal: 'Test goal',
      });

      const retrieved = store.get(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.goal).toBe('Test goal');
    });

    it('returns undefined for non-existent checkpoint', () => {
      const checkpoint = store.get('nonexistent');
      expect(checkpoint).toBeUndefined();
    });
  });

  describe('getLatest()', () => {
    it('gets the most recent checkpoint for a worker', () => {
      store.create({ workerHandle: 'worker-1', goal: 'Goal 1' });
      store.create({ workerHandle: 'worker-1', goal: 'Goal 2' });
      store.create({ workerHandle: 'worker-1', goal: 'Goal 3' });

      const latest = store.getLatest('worker-1');
      expect(latest).toBeDefined();
      expect(latest?.goal).toBe('Goal 3');
    });

    it('returns undefined for worker with no checkpoints', () => {
      const latest = store.getLatest('no-checkpoints');
      expect(latest).toBeUndefined();
    });
  });

  describe('listByWorker()', () => {
    beforeEach(() => {
      store.create({ workerHandle: 'worker-1', goal: 'Goal 1' });
      store.create({ workerHandle: 'worker-1', goal: 'Goal 2' });
      store.create({ workerHandle: 'worker-1', goal: 'Goal 3' });
      store.create({ workerHandle: 'worker-2', goal: 'Other goal' });
    });

    it('lists checkpoints for a specific worker', () => {
      const checkpoints = store.listByWorker('worker-1');
      expect(checkpoints.length).toBe(3);
    });

    it('returns checkpoints in reverse chronological order', () => {
      const checkpoints = store.listByWorker('worker-1');
      expect(checkpoints[0].goal).toBe('Goal 3');
      expect(checkpoints[2].goal).toBe('Goal 1');
    });

    it('respects limit', () => {
      const checkpoints = store.listByWorker('worker-1', 2);
      expect(checkpoints.length).toBe(2);
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      for (let i = 0; i < 10; i++) {
        store.create({ workerHandle: `worker-${i % 3}`, goal: `Goal ${i}` });
      }
    });

    it('lists all checkpoints', () => {
      const checkpoints = store.list();
      expect(checkpoints.length).toBe(10);
    });

    it('respects limit', () => {
      const checkpoints = store.list({ limit: 5 });
      expect(checkpoints.length).toBe(5);
    });

    it('respects offset', () => {
      const all = store.list();
      const offset = store.list({ offset: 5 });
      expect(offset.length).toBe(5);
      expect(offset[0].id).toBe(all[5].id);
    });
  });

  describe('cleanup()', () => {
    beforeEach(() => {
      // Create 10 checkpoints for each of 2 workers
      for (let i = 0; i < 10; i++) {
        store.create({ workerHandle: 'worker-1', goal: `Goal 1-${i}` });
        store.create({ workerHandle: 'worker-2', goal: `Goal 2-${i}` });
      }
    });

    it('keeps only the latest N checkpoints per worker', () => {
      const deleted = store.cleanup(3);

      expect(deleted).toBe(14); // 7 deleted per worker

      const worker1 = store.listByWorker('worker-1');
      const worker2 = store.listByWorker('worker-2');

      expect(worker1.length).toBe(3);
      expect(worker2.length).toBe(3);
    });

    it('uses default keep count', () => {
      const deleted = store.cleanup(); // defaults to 5

      expect(deleted).toBe(10); // 5 deleted per worker

      const worker1 = store.listByWorker('worker-1');
      expect(worker1.length).toBe(5);
    });
  });

  describe('delete()', () => {
    it('deletes a checkpoint', () => {
      const checkpoint = store.create({
        workerHandle: 'worker-1',
        goal: 'Delete me',
      });

      const result = store.delete(checkpoint.id);
      expect(result).toBe(true);
      expect(store.get(checkpoint.id)).toBeUndefined();
    });

    it('returns false for non-existent checkpoint', () => {
      const result = store.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('formatForResume()', () => {
    it('formats checkpoint as markdown', () => {
      const checkpoint = store.create({
        workerHandle: 'worker-1',
        goal: 'Complete feature',
        worked: ['Added tests', 'Fixed bug'],
        remaining: ['Write docs', 'Deploy'],
        context: { branch: 'feature-x' },
      });

      const formatted = store.formatForResume(checkpoint);

      expect(formatted).toContain('## Checkpoint Resume');
      expect(formatted).toContain('**Goal:** Complete feature');
      expect(formatted).toContain('### Completed:');
      expect(formatted).toContain('- Added tests');
      expect(formatted).toContain('- Fixed bug');
      expect(formatted).toContain('### Remaining:');
      expect(formatted).toContain('- Write docs');
      expect(formatted).toContain('- Deploy');
      expect(formatted).toContain('### Context:');
      expect(formatted).toContain('"branch": "feature-x"');
    });

    it('handles checkpoint with only goal', () => {
      const checkpoint = store.create({
        workerHandle: 'worker-1',
        goal: 'Simple goal',
      });

      const formatted = store.formatForResume(checkpoint);

      expect(formatted).toContain('**Goal:** Simple goal');
      expect(formatted).not.toContain('### Completed:');
      expect(formatted).not.toContain('### Remaining:');
      expect(formatted).not.toContain('### Context:');
    });
  });
});
