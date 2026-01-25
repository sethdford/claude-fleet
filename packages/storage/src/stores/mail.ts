/**
 * Mail Store
 *
 * Manages worker-to-worker messaging.
 */

import { getDatabase } from '../database.js';

export interface Mail {
  id: number;
  from: string;
  to: string;
  subject?: string;
  body: string;
  readAt?: number;
  createdAt: number;
}

export interface Handoff {
  id: number;
  from: string;
  to: string;
  context: Record<string, unknown>;
  acceptedAt?: number;
  createdAt: number;
}

export class MailStore {
  private db = getDatabase();

  /**
   * Send a message
   */
  send(mail: {
    from: string;
    to: string;
    subject?: string;
    body: string;
  }): Mail {
    const result = this.db.prepare(`
      INSERT INTO mailbox (from_handle, to_handle, subject, body)
      VALUES (?, ?, ?, ?)
    `).run(
      mail.from,
      mail.to,
      mail.subject || null,
      mail.body
    );

    return {
      id: Number(result.lastInsertRowid),
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      body: mail.body,
      createdAt: Date.now(),
    };
  }

  /**
   * Get unread messages for a worker
   */
  getUnread(handle: string): Mail[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM mailbox
        WHERE to_handle = ? AND read_at IS NULL
        ORDER BY created_at ASC
      `)
      .all(handle) as MailRow[];

    return rows.map((row) => this.rowToMail(row));
  }

  /**
   * Get all messages for a worker
   */
  getInbox(handle: string, options: {
    unreadOnly?: boolean;
    limit?: number;
  } = {}): Mail[] {
    const { unreadOnly = false, limit = 50 } = options;

    let sql = 'SELECT * FROM mailbox WHERE to_handle = ?';
    const params: unknown[] = [handle];

    if (unreadOnly) {
      sql += ' AND read_at IS NULL';
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as MailRow[];
    return rows.map((row) => this.rowToMail(row));
  }

  /**
   * Get sent messages from a worker
   */
  getSent(handle: string, limit: number = 50): Mail[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM mailbox
        WHERE from_handle = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(handle, limit) as MailRow[];

    return rows.map((row) => this.rowToMail(row));
  }

  /**
   * Mark messages as read
   */
  markRead(ids: number[]): void {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    this.db
      .prepare(`
        UPDATE mailbox
        SET read_at = ?
        WHERE id IN (${placeholders})
      `)
      .run(Date.now(), ...ids);
  }

  /**
   * Mark all messages for a worker as read
   */
  markAllRead(handle: string): number {
    const result = this.db
      .prepare(`
        UPDATE mailbox
        SET read_at = ?
        WHERE to_handle = ? AND read_at IS NULL
      `)
      .run(Date.now(), handle);

    return result.changes;
  }

  /**
   * Delete a message
   */
  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM mailbox WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Create a handoff (context transfer between workers)
   */
  createHandoff(handoff: {
    from: string;
    to: string;
    context: Record<string, unknown>;
  }): Handoff {
    const result = this.db.prepare(`
      INSERT INTO handoffs (from_handle, to_handle, context)
      VALUES (?, ?, ?)
    `).run(
      handoff.from,
      handoff.to,
      JSON.stringify(handoff.context)
    );

    return {
      id: Number(result.lastInsertRowid),
      from: handoff.from,
      to: handoff.to,
      context: handoff.context,
      createdAt: Date.now(),
    };
  }

  /**
   * Get pending handoffs for a worker
   */
  getPendingHandoffs(handle: string): Handoff[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM handoffs
        WHERE to_handle = ? AND accepted_at IS NULL
        ORDER BY created_at ASC
      `)
      .all(handle) as HandoffRow[];

    return rows.map((row) => this.rowToHandoff(row));
  }

  /**
   * Accept a handoff
   */
  acceptHandoff(id: number): Handoff | undefined {
    const now = Date.now();
    this.db
      .prepare('UPDATE handoffs SET accepted_at = ? WHERE id = ?')
      .run(now, id);

    const row = this.db
      .prepare('SELECT * FROM handoffs WHERE id = ?')
      .get(id) as HandoffRow | undefined;

    return row ? this.rowToHandoff(row) : undefined;
  }

  /**
   * Get formatted mail for injection into worker prompt
   */
  formatMailForPrompt(handle: string): string {
    const unread = this.getUnread(handle);
    if (unread.length === 0) return '';

    const lines = ['## Pending Messages\n'];
    for (const mail of unread) {
      lines.push(`### From: ${mail.from}`);
      if (mail.subject) {
        lines.push(`**Subject:** ${mail.subject}`);
      }
      lines.push(`\n${mail.body}\n`);
      lines.push('---');
    }

    return lines.join('\n');
  }

  private rowToMail(row: MailRow): Mail {
    return {
      id: row.id,
      from: row.from_handle,
      to: row.to_handle,
      subject: row.subject || undefined,
      body: row.body,
      readAt: row.read_at || undefined,
      createdAt: row.created_at,
    };
  }

  private rowToHandoff(row: HandoffRow): Handoff {
    return {
      id: row.id,
      from: row.from_handle,
      to: row.to_handle,
      context: JSON.parse(row.context),
      acceptedAt: row.accepted_at || undefined,
      createdAt: row.created_at,
    };
  }
}

interface MailRow {
  id: number;
  from_handle: string;
  to_handle: string;
  subject: string | null;
  body: string;
  read_at: number | null;
  created_at: number;
}

interface HandoffRow {
  id: number;
  from_handle: string;
  to_handle: string;
  context: string;
  accepted_at: number | null;
  created_at: number;
}
