/**
 * Blackboard
 *
 * Shared message board for inter-worker communication.
 */

import { getDatabase } from '@claude-fleet/storage';

export interface BlackboardMessage {
  id: number;
  topic: string;
  message: string;
  from?: string;
  priority: number;
  expiresAt?: number;
  createdAt: number;
}

export class Blackboard {
  private db = getDatabase();

  /**
   * Post a message to the blackboard
   */
  post(message: {
    topic: string;
    message: string;
    from?: string;
    priority?: number;
    expiresIn?: number;
  }): BlackboardMessage {
    const now = Date.now();
    const expiresAt = message.expiresIn ? now + message.expiresIn : undefined;

    const result = this.db.prepare(`
      INSERT INTO blackboard (topic, message, from_handle, priority, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      message.topic,
      message.message,
      message.from || null,
      message.priority || 0,
      expiresAt || null,
      now
    );

    return {
      id: Number(result.lastInsertRowid),
      topic: message.topic,
      message: message.message,
      from: message.from,
      priority: message.priority || 0,
      expiresAt,
      createdAt: now,
    };
  }

  /**
   * Read messages from the blackboard
   */
  read(options: {
    topic?: string;
    since?: number;
    limit?: number;
    minPriority?: number;
  } = {}): BlackboardMessage[] {
    const { topic, since, limit = 50, minPriority } = options;

    let sql = `
      SELECT * FROM blackboard
      WHERE (expires_at IS NULL OR expires_at > ?)
    `;
    const params: unknown[] = [Date.now()];

    if (topic) {
      sql += ' AND topic = ?';
      params.push(topic);
    }

    if (since) {
      sql += ' AND created_at > ?';
      params.push(since);
    }

    if (minPriority !== undefined) {
      sql += ' AND priority >= ?';
      params.push(minPriority);
    }

    sql += ' ORDER BY priority DESC, created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as BlackboardRow[];

    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      message: row.message,
      from: row.from_handle || undefined,
      priority: row.priority,
      expiresAt: row.expires_at || undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Read messages for a specific topic
   */
  readTopic(topic: string, options: {
    since?: number;
    limit?: number;
  } = {}): BlackboardMessage[] {
    return this.read({ topic, ...options });
  }

  /**
   * Subscribe to a topic (get all messages and mark read position)
   */
  subscribe(topic: string, lastReadId: number = 0): {
    messages: BlackboardMessage[];
    lastId: number;
  } {
    const sql = `
      SELECT * FROM blackboard
      WHERE topic = ?
      AND id > ?
      AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY id ASC
    `;

    const rows = this.db.prepare(sql).all(topic, lastReadId, Date.now()) as BlackboardRow[];

    const messages = rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      message: row.message,
      from: row.from_handle || undefined,
      priority: row.priority,
      expiresAt: row.expires_at || undefined,
      createdAt: row.created_at,
    }));

    const lastId = messages.length > 0
      ? messages[messages.length - 1].id
      : lastReadId;

    return { messages, lastId };
  }

  /**
   * List all active topics
   */
  listTopics(): Array<{ topic: string; count: number; lastActivity: number }> {
    const rows = this.db.prepare(`
      SELECT
        topic,
        COUNT(*) as count,
        MAX(created_at) as last_activity
      FROM blackboard
      WHERE expires_at IS NULL OR expires_at > ?
      GROUP BY topic
      ORDER BY last_activity DESC
    `).all(Date.now()) as {
      topic: string;
      count: number;
      last_activity: number;
    }[];

    return rows.map((row) => ({
      topic: row.topic,
      count: row.count,
      lastActivity: row.last_activity,
    }));
  }

  /**
   * Clear expired messages
   */
  clearExpired(): number {
    const result = this.db
      .prepare('DELETE FROM blackboard WHERE expires_at IS NOT NULL AND expires_at < ?')
      .run(Date.now());

    return result.changes;
  }

  /**
   * Clear all messages for a topic
   */
  clearTopic(topic: string): number {
    const result = this.db
      .prepare('DELETE FROM blackboard WHERE topic = ?')
      .run(topic);

    return result.changes;
  }

  /**
   * Broadcast a message to all workers
   */
  broadcast(message: string, from?: string): BlackboardMessage {
    return this.post({
      topic: 'broadcast',
      message,
      from,
      priority: 10,
    });
  }

  /**
   * Post an alert (high priority)
   */
  alert(message: string, from?: string): BlackboardMessage {
    return this.post({
      topic: 'alerts',
      message,
      from,
      priority: 100,
      expiresIn: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  /**
   * Post a status update
   */
  status(workerHandle: string, status: string): BlackboardMessage {
    return this.post({
      topic: `status/${workerHandle}`,
      message: status,
      from: workerHandle,
      priority: 0,
      expiresIn: 60 * 60 * 1000, // 1 hour
    });
  }

  /**
   * Get latest status for all workers
   */
  getAllStatuses(): Map<string, string> {
    const topics = this.listTopics().filter((t) => t.topic.startsWith('status/'));
    const statuses = new Map<string, string>();

    for (const { topic } of topics) {
      const handle = topic.replace('status/', '');
      const messages = this.readTopic(topic, { limit: 1 });
      if (messages.length > 0) {
        statuses.set(handle, messages[0].message);
      }
    }

    return statuses;
  }
}

interface BlackboardRow {
  id: number;
  topic: string;
  message: string;
  from_handle: string | null;
  priority: number;
  expires_at: number | null;
  created_at: number;
}
