/**
 * Bead Store
 *
 * Manages bead (structured work unit) persistence.
 */

import type { Bead, BeadStatus, Convoy } from '@claude-fleet/common';
import { generateId } from '@claude-fleet/common';
import { getDatabase } from '../database.js';

export class BeadStore {
  private db = getDatabase();

  /**
   * Generate a human-readable bead ID
   */
  generateBeadId(prefix: string = 'cc'): string {
    // Generate a short memorable ID like 'cc-x7k2m'
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 5; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${prefix}-${suffix}`;
  }

  /**
   * Create a new bead
   */
  create(bead: {
    title: string;
    description?: string;
    convoyId?: string;
    metadata?: Record<string, unknown>;
  }): Bead {
    const id = this.generateBeadId();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO beads (id, title, description, status, convoy_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      bead.title,
      bead.description || null,
      'pending',
      bead.convoyId || null,
      bead.metadata ? JSON.stringify(bead.metadata) : null,
      now
    );

    // Log creation event
    this.logEvent(id, 'created', undefined, { title: bead.title });

    return {
      id,
      title: bead.title,
      description: bead.description,
      status: 'pending',
      convoyId: bead.convoyId,
      metadata: bead.metadata,
      createdAt: now,
    };
  }

  /**
   * Get a bead by ID
   */
  get(id: string): Bead | undefined {
    const row = this.db
      .prepare('SELECT * FROM beads WHERE id = ?')
      .get(id) as BeadRow | undefined;

    return row ? this.rowToBead(row) : undefined;
  }

  /**
   * List beads with optional filters
   */
  list(options: {
    status?: BeadStatus | BeadStatus[];
    convoyId?: string;
    assignedTo?: string;
    limit?: number;
  } = {}): Bead[] {
    const { status, convoyId, assignedTo, limit = 100 } = options;

    let sql = 'SELECT * FROM beads WHERE 1=1';
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

    if (convoyId) {
      sql += ' AND convoy_id = ?';
      params.push(convoyId);
    }

    if (assignedTo) {
      sql += ' AND assigned_to = ?';
      params.push(assignedTo);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as BeadRow[];
    return rows.map((row) => this.rowToBead(row));
  }

  /**
   * Assign a bead to a worker
   */
  assign(id: string, workerHandle: string): boolean {
    const result = this.db
      .prepare(`
        UPDATE beads
        SET assigned_to = ?, status = 'in_progress'
        WHERE id = ? AND status = 'pending'
      `)
      .run(workerHandle, id);

    if (result.changes > 0) {
      this.logEvent(id, 'assigned', workerHandle);
      return true;
    }
    return false;
  }

  /**
   * Update bead status
   */
  updateStatus(id: string, status: BeadStatus, actor?: string): void {
    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (status === 'completed') {
      updates.push('completed_at = ?');
      params.push(Date.now());
    }

    params.push(id);

    this.db
      .prepare(`UPDATE beads SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params);

    this.logEvent(id, 'status_changed', actor, { status });
  }

  /**
   * Log a bead event
   */
  logEvent(beadId: string, eventType: string, actor?: string, details?: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO bead_events (bead_id, event_type, actor, details)
      VALUES (?, ?, ?, ?)
    `).run(
      beadId,
      eventType,
      actor || null,
      details ? JSON.stringify(details) : null
    );
  }

  /**
   * Get events for a bead
   */
  getEvents(beadId: string): Array<{
    eventType: string;
    actor?: string;
    details?: Record<string, unknown>;
    createdAt: number;
  }> {
    const rows = this.db
      .prepare(`
        SELECT event_type, actor, details, created_at
        FROM bead_events
        WHERE bead_id = ?
        ORDER BY created_at ASC
      `)
      .all(beadId) as EventRow[];

    return rows.map((row) => ({
      eventType: row.event_type,
      actor: row.actor || undefined,
      details: row.details ? JSON.parse(row.details) : undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Create a convoy
   */
  createConvoy(convoy: { name: string; description?: string }): Convoy {
    const id = generateId();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO convoys (id, name, description, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      convoy.name,
      convoy.description || null,
      'open',
      now
    );

    return {
      id,
      name: convoy.name,
      description: convoy.description,
      status: 'open',
      createdAt: now,
    };
  }

  /**
   * Get a convoy by ID
   */
  getConvoy(id: string): Convoy | undefined {
    const row = this.db
      .prepare('SELECT * FROM convoys WHERE id = ?')
      .get(id) as ConvoyRow | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      status: row.status as 'open' | 'closed',
      createdAt: row.created_at,
      closedAt: row.closed_at || undefined,
    };
  }

  /**
   * List convoys
   */
  listConvoys(options: { status?: 'open' | 'closed' } = {}): Convoy[] {
    let sql = 'SELECT * FROM convoys';
    const params: unknown[] = [];

    if (options.status) {
      sql += ' WHERE status = ?';
      params.push(options.status);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as ConvoyRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      status: row.status as 'open' | 'closed',
      createdAt: row.created_at,
      closedAt: row.closed_at || undefined,
    }));
  }

  /**
   * Close a convoy
   */
  closeConvoy(id: string): void {
    this.db
      .prepare("UPDATE convoys SET status = 'closed', closed_at = ? WHERE id = ?")
      .run(Date.now(), id);
  }

  /**
   * Dispatch beads in a convoy to a worker
   */
  dispatchConvoy(convoyId: string, workerHandle: string): number {
    const result = this.db
      .prepare(`
        UPDATE beads
        SET assigned_to = ?, status = 'in_progress'
        WHERE convoy_id = ? AND status = 'pending'
      `)
      .run(workerHandle, convoyId);

    return result.changes;
  }

  private rowToBead(row: BeadRow): Bead {
    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      status: row.status as BeadStatus,
      assignedTo: row.assigned_to || undefined,
      convoyId: row.convoy_id || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at || undefined,
    };
  }
}

interface BeadRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  convoy_id: string | null;
  metadata: string | null;
  created_at: number;
  completed_at: number | null;
}

interface ConvoyRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: number;
  closed_at: number | null;
}

interface EventRow {
  event_type: string;
  actor: string | null;
  details: string | null;
  created_at: number;
}
