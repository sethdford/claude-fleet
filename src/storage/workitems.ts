/**
 * Work Item Storage
 *
 * High-level interface for managing work items and batches.
 * Provides human-readable ID generation and event tracking.
 */

import type { SQLiteStorage } from './sqlite.js';
import type {
  WorkItem,
  WorkItemStatus,
  Batch,
  BatchStatus,
  WorkItemEvent,
  WorkItemEventType,
  CreateWorkItemOptions,
  CreateBatchOptions,
} from '../types.js';

// Character set for human-readable IDs (removed confusing chars like 0/O, 1/l)
const ID_CHARS = '23456789abcdefghjkmnpqrstuvwxyz';
const ID_LENGTH = 5;

export class WorkItemStorage {
  private storage: SQLiteStorage;
  private prefix: string;

  constructor(storage: SQLiteStorage, prefix = 'wi') {
    this.storage = storage;
    this.prefix = prefix;
  }

  /**
   * Generate a human-readable ID like 'wi-x7k2m'
   */
  generateId(customPrefix?: string): string {
    const p = customPrefix ?? this.prefix;
    let id = '';
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    }
    return `${p}-${id}`;
  }

  // ============================================================================
  // Work Items
  // ============================================================================

  /**
   * Create a new work item
   */
  create(title: string, options: CreateWorkItemOptions = {}): WorkItem {
    const workItem: WorkItem = {
      id: this.generateId(),
      title,
      description: options.description ?? null,
      status: 'pending',
      assignedTo: options.assignedTo ?? null,
      batchId: options.batchId ?? null,
      createdAt: Math.floor(Date.now() / 1000),
    };

    this.storage.insertWorkItem(workItem);

    // Record creation event
    this.addEvent(workItem.id, 'created', null, `Created: ${title}`);

    // If assigned, record assignment
    if (options.assignedTo) {
      this.addEvent(workItem.id, 'assigned', options.assignedTo, `Assigned to ${options.assignedTo}`);
    }

    return workItem;
  }

  /**
   * Get a work item by ID
   */
  get(workItemId: string): WorkItem | null {
    return this.storage.getWorkItem(workItemId);
  }

  /**
   * Get all work items
   */
  getAll(): WorkItem[] {
    return this.storage.getAllWorkItems();
  }

  /**
   * Get work items by status
   */
  getByStatus(status: WorkItemStatus): WorkItem[] {
    return this.storage.getAllWorkItems().filter(w => w.status === status);
  }

  /**
   * Get work items assigned to a worker
   */
  getByAssignee(handle: string): WorkItem[] {
    return this.storage.getWorkItemsByAssignee(handle);
  }

  /**
   * Get work items in a batch
   */
  getByBatch(batchId: string): WorkItem[] {
    return this.storage.getWorkItemsByBatch(batchId);
  }

  /**
   * Assign a work item to a worker
   */
  assign(workItemId: string, workerHandle: string): WorkItem | null {
    const workItem = this.get(workItemId);
    if (!workItem) return null;

    this.storage.assignWorkItem(workItemId, workerHandle);
    this.addEvent(workItemId, 'assigned', workerHandle, `Assigned to ${workerHandle}`);

    return { ...workItem, assignedTo: workerHandle, status: 'in_progress' };
  }

  /**
   * Update work item status
   */
  updateStatus(workItemId: string, status: WorkItemStatus, actor?: string): WorkItem | null {
    const workItem = this.get(workItemId);
    if (!workItem) return null;

    this.storage.updateWorkItemStatus(workItemId, status);

    // Map status to event type
    const eventMap: Record<WorkItemStatus, WorkItemEventType> = {
      pending: 'created',
      in_progress: 'started',
      completed: 'completed',
      blocked: 'blocked',
      cancelled: 'cancelled',
    };

    this.addEvent(workItemId, eventMap[status], actor ?? null, `Status changed to ${status}`);

    return { ...workItem, status };
  }

  /**
   * Mark work item as blocked
   */
  block(workItemId: string, reason: string, actor?: string): WorkItem | null {
    const workItem = this.get(workItemId);
    if (!workItem) return null;

    this.storage.updateWorkItemStatus(workItemId, 'blocked');
    this.addEvent(workItemId, 'blocked', actor ?? null, reason);

    return { ...workItem, status: 'blocked' };
  }

  /**
   * Mark work item as unblocked
   */
  unblock(workItemId: string, actor?: string): WorkItem | null {
    const workItem = this.get(workItemId);
    if (!workItem) return null;

    this.storage.updateWorkItemStatus(workItemId, 'in_progress');
    this.addEvent(workItemId, 'unblocked', actor ?? null, 'Unblocked');

    return { ...workItem, status: 'in_progress' };
  }

  /**
   * Complete a work item
   */
  complete(workItemId: string, actor?: string): WorkItem | null {
    return this.updateStatus(workItemId, 'completed', actor);
  }

  /**
   * Cancel a work item
   */
  cancel(workItemId: string, reason: string, actor?: string): WorkItem | null {
    const workItem = this.get(workItemId);
    if (!workItem) return null;

    this.storage.updateWorkItemStatus(workItemId, 'cancelled');
    this.addEvent(workItemId, 'cancelled', actor ?? null, reason);

    return { ...workItem, status: 'cancelled' };
  }

  // ============================================================================
  // Batches
  // ============================================================================

  /**
   * Create a batch (bundle of work items)
   */
  createBatch(name: string, options: CreateBatchOptions = {}): Batch {
    const batch: Batch = {
      id: this.generateId('batch'),
      name,
      status: 'open',
      createdAt: Math.floor(Date.now() / 1000),
    };

    this.storage.insertBatch(batch);

    // Add initial work items if provided
    if (options.workItemIds?.length) {
      for (const workItemId of options.workItemIds) {
        const workItem = this.get(workItemId);
        if (workItem) {
          console.log(`[WORKITEM] Added ${workItemId} to batch ${batch.id}`);
        }
      }
    }

    return batch;
  }

  /**
   * Get a batch by ID
   */
  getBatch(batchId: string): Batch | null {
    return this.storage.getBatch(batchId);
  }

  /**
   * Get all batches
   */
  getAllBatches(): Batch[] {
    return this.storage.getAllBatches();
  }

  /**
   * Update batch status
   */
  updateBatchStatus(batchId: string, status: BatchStatus): Batch | null {
    const batch = this.getBatch(batchId);
    if (!batch) return null;

    this.storage.updateBatchStatus(batchId, status);

    return { ...batch, status };
  }

  /**
   * Dispatch batch to a worker (assigns all work items)
   */
  dispatch(batchId: string, workerHandle: string): { batch: Batch; workItems: WorkItem[] } | null {
    const batch = this.getBatch(batchId);
    if (!batch) return null;

    const workItems = this.getByBatch(batchId);

    // Assign all work items
    const assignedItems: WorkItem[] = [];
    for (const item of workItems) {
      const assigned = this.assign(item.id, workerHandle);
      if (assigned) assignedItems.push(assigned);
    }

    // Update batch status
    this.storage.updateBatchStatus(batchId, 'dispatched');

    return {
      batch: { ...batch, status: 'dispatched' },
      workItems: assignedItems,
    };
  }

  /**
   * Complete batch (marks as completed if all work items are done)
   */
  completeBatch(batchId: string): { batch: Batch; allComplete: boolean } | null {
    const batch = this.getBatch(batchId);
    if (!batch) return null;

    const workItems = this.getByBatch(batchId);
    const allComplete = workItems.every(w => w.status === 'completed');

    if (allComplete) {
      this.storage.updateBatchStatus(batchId, 'completed');
      return {
        batch: { ...batch, status: 'completed' },
        allComplete: true,
      };
    }

    return {
      batch,
      allComplete: false,
    };
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Add an event to a work item's history
   */
  addEvent(workItemId: string, eventType: WorkItemEventType, actor: string | null, details: string): number {
    return this.storage.insertWorkItemEvent({
      workItemId,
      eventType,
      actor,
      details,
      createdAt: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Add a comment to a work item
   */
  addComment(workItemId: string, comment: string, actor: string): number {
    return this.addEvent(workItemId, 'comment', actor, comment);
  }

  /**
   * Get event history for a work item
   */
  getEvents(workItemId: string): WorkItemEvent[] {
    return this.storage.getWorkItemEvents(workItemId);
  }

  // ============================================================================
  // Stats
  // ============================================================================

  /**
   * Get work item statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<WorkItemStatus, number>;
    batches: {
      total: number;
      byStatus: Record<BatchStatus, number>;
    };
  } {
    const workItems = this.getAll();
    const batches = this.getAllBatches();

    const byStatus: Record<WorkItemStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      blocked: 0,
      cancelled: 0,
    };

    for (const item of workItems) {
      byStatus[item.status]++;
    }

    const batchesByStatus: Record<BatchStatus, number> = {
      open: 0,
      dispatched: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const batch of batches) {
      batchesByStatus[batch.status]++;
    }

    return {
      total: workItems.length,
      byStatus,
      batches: {
        total: batches.length,
        byStatus: batchesByStatus,
      },
    };
  }
}
