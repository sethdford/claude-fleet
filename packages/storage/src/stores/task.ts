/**
 * Task Store
 *
 * Manages task persistence for fleet coordination.
 */

import type { Task, TaskStatus, TaskPriority } from '@claude-fleet/common';
import { getDatabase } from '../database.js';

export class TaskStore {
  private db = getDatabase();

  /**
   * Create a new task
   */
  create(task: Omit<Task, 'createdAt'>): Task {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, assigned_to, created_by, due_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.title,
      task.description || null,
      task.status || 'pending',
      task.priority || 3,
      task.assignedTo || null,
      task.createdBy || null,
      task.dueAt || null,
      now
    );

    return {
      ...task,
      status: task.status || 'pending',
      priority: task.priority || 3,
      createdAt: now,
    };
  }

  /**
   * Get a task by ID
   */
  get(id: string): Task | undefined {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    return row ? this.rowToTask(row) : undefined;
  }

  /**
   * List tasks with optional filters
   */
  list(options: {
    status?: TaskStatus | TaskStatus[];
    assignedTo?: string;
    priority?: TaskPriority;
    limit?: number;
    offset?: number;
  } = {}): Task[] {
    const { status, assignedTo, priority, limit = 100, offset = 0 } = options;

    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
      if (Array.isArray(status)) {
        sql += ` AND status IN (${status.map(() => '?').join(',')})`;
        params.push(...status);
      } else {
        sql += ' AND status = ?';
        params.push(status);
      }
    }

    if (assignedTo) {
      sql += ' AND assigned_to = ?';
      params.push(assignedTo);
    }

    if (priority !== undefined) {
      sql += ' AND priority = ?';
      params.push(priority);
    }

    sql += ' ORDER BY priority ASC, created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as TaskRow[];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Get unassigned tasks
   */
  getUnassigned(options: {
    priority?: TaskPriority;
    limit?: number;
  } = {}): Task[] {
    const { priority, limit = 10 } = options;

    let sql = `
      SELECT * FROM tasks
      WHERE assigned_to IS NULL
      AND status = 'pending'
    `;
    const params: unknown[] = [];

    if (priority !== undefined) {
      sql += ' AND priority <= ?';
      params.push(priority);
    }

    sql += ' ORDER BY priority ASC, created_at ASC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as TaskRow[];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Assign a task to a worker
   */
  assign(id: string, workerHandle: string): boolean {
    const result = this.db
      .prepare(`
        UPDATE tasks
        SET assigned_to = ?, status = 'in_progress'
        WHERE id = ? AND (assigned_to IS NULL OR assigned_to = ?)
      `)
      .run(workerHandle, id, workerHandle);

    return result.changes > 0;
  }

  /**
   * Update task status
   */
  updateStatus(id: string, status: TaskStatus): void {
    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (status === 'completed' || status === 'cancelled') {
      updates.push('completed_at = ?');
      params.push(Date.now());
    }

    params.push(id);

    this.db
      .prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  /**
   * Update task
   */
  update(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): void {
    const setters: string[] = [];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      setters.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      setters.push('description = ?');
      params.push(updates.description);
    }
    if (updates.status !== undefined) {
      setters.push('status = ?');
      params.push(updates.status);
    }
    if (updates.priority !== undefined) {
      setters.push('priority = ?');
      params.push(updates.priority);
    }
    if (updates.assignedTo !== undefined) {
      setters.push('assigned_to = ?');
      params.push(updates.assignedTo);
    }
    if (updates.dueAt !== undefined) {
      setters.push('due_at = ?');
      params.push(updates.dueAt);
    }

    if (setters.length === 0) return;

    params.push(id);
    this.db
      .prepare(`UPDATE tasks SET ${setters.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  /**
   * Delete a task
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM tasks WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Get overdue tasks
   */
  getOverdue(): Task[] {
    const now = Date.now();
    const rows = this.db
      .prepare(`
        SELECT * FROM tasks
        WHERE due_at IS NOT NULL
        AND due_at < ?
        AND status NOT IN ('completed', 'cancelled')
        ORDER BY due_at ASC
      `)
      .all(now) as TaskRow[];

    return rows.map((row) => this.rowToTask(row));
  }

  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      title: row.title,
      ...(row.description && { description: row.description }),
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      ...(row.assigned_to && { assignedTo: row.assigned_to }),
      ...(row.created_by && { createdBy: row.created_by }),
      ...(row.due_at && { dueAt: row.due_at }),
      ...(row.completed_at && { completedAt: row.completed_at }),
      createdAt: row.created_at,
    };
  }
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  assigned_to: string | null;
  created_by: string | null;
  due_at: number | null;
  completed_at: number | null;
  created_at: number;
}
