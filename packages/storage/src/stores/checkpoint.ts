/**
 * Checkpoint Store
 *
 * Manages checkpoint persistence for state recovery.
 */

import type { Checkpoint } from '@claude-fleet/common';
import { generateId } from '@claude-fleet/common';
import { getDatabase } from '../database.js';

export class CheckpointStore {
  private db = getDatabase();

  /**
   * Create a checkpoint
   */
  create(checkpoint: {
    workerHandle: string;
    goal: string;
    worked?: string[];
    remaining?: string[];
    context?: Record<string, unknown>;
  }): Checkpoint {
    const id = generateId();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO checkpoints (id, worker_handle, goal, worked, remaining, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      checkpoint.workerHandle,
      checkpoint.goal,
      checkpoint.worked ? JSON.stringify(checkpoint.worked) : null,
      checkpoint.remaining ? JSON.stringify(checkpoint.remaining) : null,
      checkpoint.context ? JSON.stringify(checkpoint.context) : null,
      now
    );

    return {
      id,
      workerHandle: checkpoint.workerHandle,
      goal: checkpoint.goal,
      worked: checkpoint.worked,
      remaining: checkpoint.remaining,
      context: checkpoint.context,
      createdAt: now,
    };
  }

  /**
   * Get a checkpoint by ID
   */
  get(id: string): Checkpoint | undefined {
    const row = this.db
      .prepare('SELECT * FROM checkpoints WHERE id = ?')
      .get(id) as CheckpointRow | undefined;

    return row ? this.rowToCheckpoint(row) : undefined;
  }

  /**
   * Get the latest checkpoint for a worker
   */
  getLatest(workerHandle: string): Checkpoint | undefined {
    const row = this.db
      .prepare(`
        SELECT * FROM checkpoints
        WHERE worker_handle = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(workerHandle) as CheckpointRow | undefined;

    return row ? this.rowToCheckpoint(row) : undefined;
  }

  /**
   * List checkpoints for a worker
   */
  listByWorker(workerHandle: string, limit: number = 10): Checkpoint[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM checkpoints
        WHERE worker_handle = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(workerHandle, limit) as CheckpointRow[];

    return rows.map((row) => this.rowToCheckpoint(row));
  }

  /**
   * List all checkpoints
   */
  list(options: {
    limit?: number;
    offset?: number;
  } = {}): Checkpoint[] {
    const { limit = 50, offset = 0 } = options;

    const rows = this.db
      .prepare(`
        SELECT * FROM checkpoints
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(limit, offset) as CheckpointRow[];

    return rows.map((row) => this.rowToCheckpoint(row));
  }

  /**
   * Delete old checkpoints, keeping only the latest N per worker
   */
  cleanup(keepPerWorker: number = 5): number {
    // Get all worker handles
    const workers = this.db
      .prepare('SELECT DISTINCT worker_handle FROM checkpoints')
      .all() as { worker_handle: string }[];

    let deleted = 0;

    for (const { worker_handle } of workers) {
      // Get IDs to keep
      const toKeep = this.db
        .prepare(`
          SELECT id FROM checkpoints
          WHERE worker_handle = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(worker_handle, keepPerWorker) as { id: string }[];

      const keepIds = toKeep.map((r) => r.id);

      if (keepIds.length === 0) continue;

      // Delete older checkpoints
      const placeholders = keepIds.map(() => '?').join(',');
      const result = this.db
        .prepare(`
          DELETE FROM checkpoints
          WHERE worker_handle = ?
          AND id NOT IN (${placeholders})
        `)
        .run(worker_handle, ...keepIds);

      deleted += result.changes;
    }

    return deleted;
  }

  /**
   * Delete a checkpoint
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM checkpoints WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Format checkpoint for resuming a worker
   */
  formatForResume(checkpoint: Checkpoint): string {
    const lines = [
      '## Checkpoint Resume',
      '',
      `**Goal:** ${checkpoint.goal}`,
      '',
    ];

    if (checkpoint.worked && checkpoint.worked.length > 0) {
      lines.push('### Completed:');
      for (const item of checkpoint.worked) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }

    if (checkpoint.remaining && checkpoint.remaining.length > 0) {
      lines.push('### Remaining:');
      for (const item of checkpoint.remaining) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }

    if (checkpoint.context) {
      lines.push('### Context:');
      lines.push('```json');
      lines.push(JSON.stringify(checkpoint.context, null, 2));
      lines.push('```');
    }

    return lines.join('\n');
  }

  private rowToCheckpoint(row: CheckpointRow): Checkpoint {
    return {
      id: row.id,
      workerHandle: row.worker_handle,
      goal: row.goal,
      worked: row.worked ? JSON.parse(row.worked) : undefined,
      remaining: row.remaining ? JSON.parse(row.remaining) : undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      createdAt: row.created_at,
    };
  }
}

interface CheckpointRow {
  id: string;
  worker_handle: string;
  goal: string;
  worked: string | null;
  remaining: string | null;
  context: string | null;
  created_at: number;
}
