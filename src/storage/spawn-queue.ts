/**
 * Spawn Queue Storage
 *
 * Manages a queue of spawn requests with DAG dependency tracking.
 * Supports prioritized processing and blocked_by_count for Kahn's algorithm.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from './sqlite.js';
import type {
  SpawnQueueItem,
  SpawnQueueStatus,
  MessagePriority,
} from '../types.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface EnqueueOptions {
  priority?: MessagePriority;
  dependsOn?: string[];  // IDs of spawn requests that must complete first
  context?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
}

export interface SpawnQueueStats {
  total: number;
  byStatus: Record<SpawnQueueStatus, number>;
  byPriority: Record<MessagePriority, number>;
  ready: number;  // pending with blockedByCount = 0
  blocked: number;  // pending with blockedByCount > 0
}

// ============================================================================
// DATABASE ROW TYPE
// ============================================================================

interface SpawnQueueRow {
  id: string;
  requester_handle: string;
  target_agent_type: string;
  depth_level: number;
  priority: string;
  status: string;
  payload: string;
  depends_on: string;
  blocked_by_count: number;
  created_at: number;
  processed_at: number | null;
  spawned_worker_id: string | null;
}

// ============================================================================
// SPAWN QUEUE STORAGE CLASS
// ============================================================================

export class SpawnQueueStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  /**
   * Enqueue a new spawn request
   */
  enqueue(
    requesterHandle: string,
    targetAgentType: string,
    depthLevel: number,
    task: string,
    options: EnqueueOptions = {}
  ): SpawnQueueItem {
    const id = uuidv4();
    const now = Date.now();
    const priority = options.priority ?? 'normal';
    const dependsOn = options.dependsOn ?? [];

    // Calculate initial blocked_by_count
    const blockedByCount = this.countPendingDependencies(dependsOn);

    const payload = {
      task,
      context: options.context,
      checkpoint: options.checkpoint,
    };

    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO spawn_queue (id, requester_handle, target_agent_type, depth_level, priority, status, payload, depends_on, blocked_by_count, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      requesterHandle,
      targetAgentType,
      depthLevel,
      priority,
      JSON.stringify(payload),
      JSON.stringify(dependsOn),
      blockedByCount,
      now
    );

    return {
      id,
      requesterHandle,
      targetAgentType,
      depthLevel,
      priority,
      status: 'pending',
      payload,
      dependsOn,
      blockedByCount,
      createdAt: now,
      processedAt: null,
      spawnedWorkerId: null,
    };
  }

  /**
   * Count how many of the given dependencies are still pending/approved (not spawned)
   */
  private countPendingDependencies(dependsOn: string[]): number {
    if (dependsOn.length === 0) return 0;

    const db = this.storage.getDatabase();
    const placeholders = dependsOn.map(() => '?').join(',');
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM spawn_queue
      WHERE id IN (${placeholders}) AND status != 'spawned'
    `);

    const result = stmt.get(...dependsOn) as { count: number };
    return result.count;
  }

  /**
   * Get all spawn requests that are ready to spawn (pending, blockedByCount = 0)
   */
  getReady(limit: number = 10): SpawnQueueItem[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM spawn_queue
      WHERE status = 'pending' AND blocked_by_count = 0
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END,
        created_at ASC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as SpawnQueueRow[];
    return rows.map((row) => this.rowToItem(row));
  }

  /**
   * Get a specific spawn request by ID
   */
  get(id: string): SpawnQueueItem | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM spawn_queue WHERE id = ?');
    const row = stmt.get(id) as SpawnQueueRow | undefined;
    return row ? this.rowToItem(row) : null;
  }

  /**
   * Approve a spawn request (ready for processing)
   */
  approve(id: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE spawn_queue SET status = 'approved', processed_at = ?
      WHERE id = ? AND status = 'pending'
    `);

    const result = stmt.run(Date.now(), id);
    return result.changes > 0;
  }

  /**
   * Reject a spawn request
   */
  reject(id: string): boolean {
    const db = this.storage.getDatabase();

    // First, update this item
    const stmt = db.prepare(`
      UPDATE spawn_queue SET status = 'rejected', processed_at = ?
      WHERE id = ? AND status IN ('pending', 'approved')
    `);

    const result = stmt.run(Date.now(), id);
    if (result.changes === 0) return false;

    // Update blocked_by_count for items depending on this one
    this.decrementDependents(id);

    return true;
  }

  /**
   * Mark a spawn request as spawned with the worker ID
   */
  markSpawned(id: string, workerId: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE spawn_queue SET status = 'spawned', spawned_worker_id = ?, processed_at = ?
      WHERE id = ? AND status IN ('pending', 'approved')
    `);

    const result = stmt.run(workerId, Date.now(), id);
    if (result.changes === 0) return false;

    // Update blocked_by_count for items depending on this one
    this.decrementDependents(id);

    return true;
  }

  /**
   * Decrement blocked_by_count for all items that depend on the given ID
   */
  private decrementDependents(completedId: string): void {
    const db = this.storage.getDatabase();

    // Find all pending items that depend on this one
    const findStmt = db.prepare(`
      SELECT id, depends_on FROM spawn_queue
      WHERE status = 'pending' AND depends_on LIKE '%' || ? || '%'
    `);

    const dependents = findStmt.all(completedId) as Array<{ id: string; depends_on: string }>;

    const updateStmt = db.prepare(`
      UPDATE spawn_queue SET blocked_by_count = MAX(0, blocked_by_count - 1)
      WHERE id = ?
    `);

    for (const dep of dependents) {
      const dependsOn = JSON.parse(dep.depends_on) as string[];
      if (dependsOn.includes(completedId)) {
        updateStmt.run(dep.id);
      }
    }
  }

  /**
   * Get all spawn requests by requester
   */
  getByRequester(requesterHandle: string, limit: number = 50): SpawnQueueItem[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM spawn_queue
      WHERE requester_handle = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(requesterHandle, limit) as SpawnQueueRow[];
    return rows.map((row) => this.rowToItem(row));
  }

  /**
   * Get all pending spawn requests
   */
  getPending(): SpawnQueueItem[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM spawn_queue WHERE status = 'pending'
      ORDER BY created_at ASC
    `);

    const rows = stmt.all() as SpawnQueueRow[];
    return rows.map((row) => this.rowToItem(row));
  }

  /**
   * Get statistics about the spawn queue
   */
  getStats(): SpawnQueueStats {
    const db = this.storage.getDatabase();

    // Total count
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM spawn_queue');
    const total = (totalStmt.get() as { count: number }).count;

    // By status
    const statusStmt = db.prepare(`
      SELECT status, COUNT(*) as count FROM spawn_queue GROUP BY status
    `);
    const statusRows = statusStmt.all() as Array<{ status: string; count: number }>;
    const byStatus: Record<SpawnQueueStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      spawned: 0,
    };
    for (const row of statusRows) {
      byStatus[row.status as SpawnQueueStatus] = row.count;
    }

    // By priority
    const priorityStmt = db.prepare(`
      SELECT priority, COUNT(*) as count FROM spawn_queue GROUP BY priority
    `);
    const priorityRows = priorityStmt.all() as Array<{ priority: string; count: number }>;
    const byPriority: Record<MessagePriority, number> = {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
    };
    for (const row of priorityRows) {
      byPriority[row.priority as MessagePriority] = row.count;
    }

    // Ready count (pending with blockedByCount = 0)
    const readyStmt = db.prepare(`
      SELECT COUNT(*) as count FROM spawn_queue
      WHERE status = 'pending' AND blocked_by_count = 0
    `);
    const ready = (readyStmt.get() as { count: number }).count;

    // Blocked count (pending with blockedByCount > 0)
    const blockedStmt = db.prepare(`
      SELECT COUNT(*) as count FROM spawn_queue
      WHERE status = 'pending' AND blocked_by_count > 0
    `);
    const blocked = (blockedStmt.get() as { count: number }).count;

    return { total, byStatus, byPriority, ready, blocked };
  }

  /**
   * Cancel all pending spawn requests from a requester
   */
  cancelByRequester(requesterHandle: string): number {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE spawn_queue SET status = 'rejected', processed_at = ?
      WHERE requester_handle = ? AND status = 'pending'
    `);

    const result = stmt.run(Date.now(), requesterHandle);
    return result.changes;
  }

  /**
   * Clean up old completed/rejected requests
   */
  cleanup(maxAgeMs: number): number {
    const db = this.storage.getDatabase();
    const cutoff = Date.now() - maxAgeMs;
    const stmt = db.prepare(`
      DELETE FROM spawn_queue
      WHERE status IN ('spawned', 'rejected') AND processed_at < ?
    `);

    const result = stmt.run(cutoff);
    return result.changes;
  }

  /**
   * Convert database row to SpawnQueueItem
   */
  private rowToItem(row: SpawnQueueRow): SpawnQueueItem {
    return {
      id: row.id,
      requesterHandle: row.requester_handle,
      targetAgentType: row.target_agent_type,
      depthLevel: row.depth_level,
      priority: row.priority as MessagePriority,
      status: row.status as SpawnQueueStatus,
      payload: JSON.parse(row.payload),
      dependsOn: JSON.parse(row.depends_on),
      blockedByCount: row.blocked_by_count,
      createdAt: row.created_at,
      processedAt: row.processed_at,
      spawnedWorkerId: row.spawned_worker_id,
    };
  }
}
