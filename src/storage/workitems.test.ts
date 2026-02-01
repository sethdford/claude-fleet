/**
 * Tests for WorkItemStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { WorkItemStorage } from './workitems.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('WorkItemStorage', () => {
  let ctx: TestStorageContext;
  let items: WorkItemStorage;

  beforeEach(() => {
    ctx = createTestStorage();
    items = new WorkItemStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // create() / get()
  // ==========================================================================

  describe('create() and get()', () => {
    it('should create a work item with generated id', () => {
      const item = items.create('Fix login bug');

      expect(item.id).toMatch(/^wi-[a-z0-9]{5}$/);
      expect(item.title).toBe('Fix login bug');
      expect(item.status).toBe('pending');
      expect(item.assignedTo).toBeNull();
      expect(item.batchId).toBeNull();
    });

    it('should create with description and assignee', () => {
      const item = items.create('Deploy v2', {
        description: 'Deploy to staging first',
        assignedTo: 'worker-1',
      });

      expect(item.description).toBe('Deploy to staging first');
      expect(item.assignedTo).toBe('worker-1');
    });

    it('should retrieve by id', () => {
      const created = items.create('Test item');
      const retrieved = items.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('Test item');
    });

    it('should return null for non-existent id', () => {
      const result = items.get('wi-zzzzz');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getAll() / getByStatus() / getByAssignee()
  // ==========================================================================

  describe('listing and filtering', () => {
    beforeEach(() => {
      items.create('Task A', { assignedTo: 'worker-1' });
      items.create('Task B', { assignedTo: 'worker-2' });
      items.create('Task C');
    });

    it('should return all work items', () => {
      const all = items.getAll();
      expect(all).toHaveLength(3);
    });

    it('should filter by status', () => {
      const pending = items.getByStatus('pending');
      expect(pending).toHaveLength(3);

      const inProgress = items.getByStatus('in_progress');
      expect(inProgress).toHaveLength(0);
    });

    it('should filter by assignee', () => {
      const w1Items = items.getByAssignee('worker-1');
      expect(w1Items).toHaveLength(1);
      expect(w1Items[0].title).toBe('Task A');
    });
  });

  // ==========================================================================
  // assign()
  // ==========================================================================

  describe('assign()', () => {
    it('should assign a worker and update status', () => {
      const item = items.create('Unassigned task');
      const assigned = items.assign(item.id, 'worker-3');

      expect(assigned).not.toBeNull();
      expect(assigned!.assignedTo).toBe('worker-3');
      expect(assigned!.status).toBe('in_progress');
    });

    it('should return null for non-existent item', () => {
      const result = items.assign('wi-zzzzz', 'worker-1');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // updateStatus()
  // ==========================================================================

  describe('updateStatus()', () => {
    it('should change status', () => {
      const item = items.create('Status test');
      const updated = items.updateStatus(item.id, 'in_progress');

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('in_progress');
    });

    it('should return null for non-existent item', () => {
      const result = items.updateStatus('wi-zzzzz', 'completed');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // block() / unblock()
  // ==========================================================================

  describe('block() and unblock()', () => {
    it('should set blocked status with reason', () => {
      const item = items.create('Blockable task');
      const blocked = items.block(item.id, 'Waiting for dependency');

      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe('blocked');
    });

    it('should unblock and set to in_progress', () => {
      const item = items.create('Will unblock');
      items.block(item.id, 'Blocked');
      const unblocked = items.unblock(item.id);

      expect(unblocked).not.toBeNull();
      expect(unblocked!.status).toBe('in_progress');
    });
  });

  // ==========================================================================
  // complete() / cancel()
  // ==========================================================================

  describe('complete() and cancel()', () => {
    it('should complete a work item', () => {
      const item = items.create('Completeable');
      const completed = items.complete(item.id);

      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('completed');
    });

    it('should cancel a work item with reason', () => {
      const item = items.create('Cancellable');
      const cancelled = items.cancel(item.id, 'No longer needed');

      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('cancelled');
    });
  });

  // ==========================================================================
  // Batches
  // ==========================================================================

  describe('batches', () => {
    it('should create a batch', () => {
      const batch = items.createBatch('Sprint 1');

      expect(batch.id).toMatch(/^batch-[a-z0-9]{5}$/);
      expect(batch.name).toBe('Sprint 1');
      expect(batch.status).toBe('open');
    });

    it('should retrieve a batch by id', () => {
      const created = items.createBatch('Batch A');
      const retrieved = items.getBatch(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Batch A');
    });

    it('should return null for non-existent batch', () => {
      const result = items.getBatch('batch-zzzzz');
      expect(result).toBeNull();
    });

    it('should list all batches', () => {
      items.createBatch('B1');
      items.createBatch('B2');

      const all = items.getAllBatches();
      expect(all).toHaveLength(2);
    });

    it('should update batch status', () => {
      const batch = items.createBatch('B1');
      const updated = items.updateBatchStatus(batch.id, 'dispatched');

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('dispatched');
    });

    it('should return null when updating non-existent batch', () => {
      const result = items.updateBatchStatus('batch-zzzzz', 'completed');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // dispatch()
  // ==========================================================================

  describe('dispatch()', () => {
    it('should assign all batch items to a worker', () => {
      const batch = items.createBatch('Dispatch Batch');
      items.create('D1', { batchId: batch.id });
      items.create('D2', { batchId: batch.id });

      const result = items.dispatch(batch.id, 'worker-x');

      expect(result).not.toBeNull();
      expect(result!.batch.status).toBe('dispatched');
      expect(result!.workItems).toHaveLength(2);

      for (const wi of result!.workItems) {
        expect(wi.assignedTo).toBe('worker-x');
        expect(wi.status).toBe('in_progress');
      }
    });

    it('should return null for non-existent batch', () => {
      const result = items.dispatch('batch-zzzzz', 'worker-1');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return correct statistics', () => {
      items.create('A');
      items.create('B');
      const c = items.create('C');
      items.complete(c.id);
      items.createBatch('Batch');

      const stats = items.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byStatus.pending).toBe(2);
      expect(stats.byStatus.completed).toBe(1);
      expect(stats.batches.total).toBe(1);
      expect(stats.batches.byStatus.open).toBe(1);
    });
  });
});
