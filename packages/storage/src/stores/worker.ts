/**
 * Worker Store
 *
 * Manages worker persistence for crash recovery.
 */

import type { Worker, WorkerStatus, WorkerRole } from '@claude-fleet/common';
import { getDatabase } from '../database.js';

export class WorkerStore {
  private db = getDatabase();

  /**
   * Create or update a worker
   */
  upsert(worker: Worker): Worker {
    const stmt = this.db.prepare(`
      INSERT INTO workers (id, handle, status, role, worktree_path, worktree_branch, pid, session_id, initial_prompt, last_heartbeat, restart_count, created_at, dismissed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        pid = excluded.pid,
        session_id = excluded.session_id,
        last_heartbeat = excluded.last_heartbeat,
        restart_count = excluded.restart_count,
        dismissed_at = excluded.dismissed_at
    `);

    stmt.run(
      worker.id,
      worker.handle,
      worker.status,
      worker.role || 'worker',
      worker.worktreePath || null,
      worker.worktreeBranch || null,
      worker.pid || null,
      worker.sessionId || null,
      worker.initialPrompt || null,
      worker.lastHeartbeat || Date.now(),
      worker.restartCount || 0,
      worker.createdAt || Date.now(),
      worker.dismissedAt || null
    );

    return worker;
  }

  /**
   * Get a worker by ID
   */
  get(id: string): Worker | undefined {
    const row = this.db
      .prepare('SELECT * FROM workers WHERE id = ?')
      .get(id) as WorkerRow | undefined;

    return row ? this.rowToWorker(row) : undefined;
  }

  /**
   * Get a worker by handle
   */
  getByHandle(handle: string): Worker | undefined {
    const row = this.db
      .prepare('SELECT * FROM workers WHERE handle = ?')
      .get(handle) as WorkerRow | undefined;

    return row ? this.rowToWorker(row) : undefined;
  }

  /**
   * List workers with optional filters
   */
  list(options: {
    status?: WorkerStatus | WorkerStatus[];
    role?: WorkerRole;
    includesDismissed?: boolean;
  } = {}): Worker[] {
    const { status, role, includesDismissed = false } = options;

    let sql = 'SELECT * FROM workers WHERE 1=1';
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

    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }

    if (!includesDismissed) {
      sql += ' AND dismissed_at IS NULL';
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as WorkerRow[];
    return rows.map((row) => this.rowToWorker(row));
  }

  /**
   * Update worker status
   */
  updateStatus(id: string, status: WorkerStatus): void {
    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (status === 'dismissed') {
      updates.push('dismissed_at = ?');
      params.push(Date.now());
    }

    params.push(id);

    this.db
      .prepare(`UPDATE workers SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  /**
   * Update worker heartbeat
   */
  heartbeat(id: string): void {
    this.db
      .prepare('UPDATE workers SET last_heartbeat = ? WHERE id = ?')
      .run(Date.now(), id);
  }

  /**
   * Increment restart count
   */
  incrementRestarts(id: string): number {
    this.db
      .prepare('UPDATE workers SET restart_count = restart_count + 1 WHERE id = ?')
      .run(id);

    const row = this.db
      .prepare('SELECT restart_count FROM workers WHERE id = ?')
      .get(id) as { restart_count: number } | undefined;

    return row?.restart_count || 0;
  }

  /**
   * Update worker PID
   */
  updatePid(id: string, pid: number): void {
    this.db
      .prepare('UPDATE workers SET pid = ? WHERE id = ?')
      .run(pid, id);
  }

  /**
   * Update worker session ID
   */
  updateSessionId(id: string, sessionId: string): void {
    this.db
      .prepare('UPDATE workers SET session_id = ? WHERE id = ?')
      .run(sessionId, id);
  }

  /**
   * Delete a worker
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM workers WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Get stale workers (no heartbeat for specified duration)
   */
  getStale(thresholdMs: number = 60000): Worker[] {
    const cutoff = Date.now() - thresholdMs;
    const rows = this.db
      .prepare(`
        SELECT * FROM workers
        WHERE status NOT IN ('dismissed', 'error')
        AND last_heartbeat < ?
      `)
      .all(cutoff) as WorkerRow[];

    return rows.map((row) => this.rowToWorker(row));
  }

  /**
   * Get workers that need recovery after a crash
   */
  getRecoverable(): Worker[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM workers
        WHERE status IN ('pending', 'ready', 'busy')
        AND dismissed_at IS NULL
      `)
      .all() as WorkerRow[];

    return rows.map((row) => this.rowToWorker(row));
  }

  private rowToWorker(row: WorkerRow): Worker {
    return {
      id: row.id,
      handle: row.handle,
      status: row.status as WorkerStatus,
      role: row.role as WorkerRole,
      ...(row.worktree_path && { worktreePath: row.worktree_path }),
      ...(row.worktree_branch && { worktreeBranch: row.worktree_branch }),
      ...(row.pid && { pid: row.pid }),
      ...(row.session_id && { sessionId: row.session_id }),
      ...(row.initial_prompt && { initialPrompt: row.initial_prompt }),
      lastHeartbeat: row.last_heartbeat,
      restartCount: row.restart_count,
      createdAt: row.created_at,
      ...(row.dismissed_at && { dismissedAt: row.dismissed_at }),
    };
  }
}

interface WorkerRow {
  id: string;
  handle: string;
  status: string;
  role: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  pid: number | null;
  session_id: string | null;
  initial_prompt: string | null;
  last_heartbeat: number;
  restart_count: number;
  created_at: number;
  dismissed_at: number | null;
}
