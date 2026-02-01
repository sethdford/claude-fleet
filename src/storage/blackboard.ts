/**
 * Blackboard Storage
 *
 * Provides inter-agent messaging via a shared blackboard pattern.
 * Supports typed messages, priority routing, and read tracking.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from './sqlite.js';
import type {
  BlackboardMessage,
  BlackboardMessageType,
  MessagePriority,
} from '../types.js';
import { createMessageBus } from '../workers/message-bus.js';
import type { MessageBus } from '../workers/message-bus.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface PostMessageOptions {
  targetHandle?: string;  // null = broadcast to swarm
  priority?: MessagePriority;
}

export interface ReadMessagesOptions {
  messageType?: BlackboardMessageType;
  targetHandle?: string;
  priority?: MessagePriority;
  unreadOnly?: boolean;
  readerHandle?: string;  // Required if unreadOnly is true
  limit?: number;
  includeArchived?: boolean;
}

export interface BlackboardStats {
  total: number;
  byType: Record<BlackboardMessageType, number>;
  byPriority: Record<MessagePriority, number>;
  unread: number;
  archived: number;
}

// ============================================================================
// DATABASE ROW TYPE
// ============================================================================

interface BlackboardRow {
  id: string;
  swarm_id: string;
  sender_handle: string;
  message_type: string;
  target_handle: string | null;
  priority: string;
  payload: string;
  read_by: string;
  created_at: number;
  archived_at: number | null;
}

// ============================================================================
// BLACKBOARD STORAGE CLASS
// ============================================================================

export class BlackboardStorage {
  private storage: SQLiteStorage;
  private bus: MessageBus;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
    this.bus = createMessageBus();
  }

  /**
   * Post a message to the blackboard
   */
  postMessage(
    swarmId: string,
    senderHandle: string,
    messageType: BlackboardMessageType,
    payload: Record<string, unknown>,
    options: PostMessageOptions = {}
  ): BlackboardMessage {
    const id = uuidv4();
    const now = Date.now();
    const priority = options.priority ?? 'normal';

    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO blackboard (id, swarm_id, sender_handle, message_type, target_handle, priority, payload, read_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      swarmId,
      senderHandle,
      messageType,
      options.targetHandle ?? null,
      priority,
      JSON.stringify(payload),
      '[]',
      now
    );

    // Write-through to in-memory ring bus for fast reads
    const priorityNum = priority === 'critical' ? 3 : priority === 'high' ? 2 : priority === 'normal' ? 1 : 0;
    const busTopic = `bb:${swarmId}:${messageType}`;
    this.bus.publish(busTopic, senderHandle, priorityNum, JSON.stringify(payload));

    return {
      id,
      swarmId,
      senderHandle,
      messageType,
      targetHandle: options.targetHandle ?? null,
      priority,
      payload,
      readBy: [],
      createdAt: now,
      archivedAt: null,
    };
  }

  /**
   * Read messages from the blackboard
   */
  readMessages(swarmId: string, options: ReadMessagesOptions = {}): BlackboardMessage[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = ['swarm_id = ?'];
    const params: (string | number)[] = [swarmId];

    if (!options.includeArchived) {
      conditions.push('archived_at IS NULL');
    }

    if (options.messageType) {
      conditions.push('message_type = ?');
      params.push(options.messageType);
    }

    if (options.targetHandle !== undefined) {
      if (options.targetHandle === null) {
        conditions.push('target_handle IS NULL');
      } else {
        // Include messages targeted at this handle OR broadcasts (null target)
        conditions.push('(target_handle = ? OR target_handle IS NULL)');
        params.push(options.targetHandle);
      }
    }

    if (options.priority) {
      conditions.push('priority = ?');
      params.push(options.priority);
    }

    if (options.unreadOnly && options.readerHandle) {
      // Messages not yet read by this handle
      conditions.push('NOT (read_by LIKE \'%"\' || ? || \'"%\')');
      params.push(options.readerHandle);
    }

    const limit = options.limit ?? 100;
    const sql = `
      SELECT * FROM blackboard
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END,
        created_at DESC
      LIMIT ?
    `;

    params.push(limit);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as BlackboardRow[];

    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Get a single message by ID
   */
  getMessage(messageId: string): BlackboardMessage | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM blackboard WHERE id = ?');
    const row = stmt.get(messageId) as BlackboardRow | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  /**
   * Mark messages as read by a handle
   */
  markRead(messageIds: string[], readerHandle: string): number {
    const db = this.storage.getDatabase();
    let updated = 0;

    const updateStmt = db.prepare(`
      UPDATE blackboard
      SET read_by = json_insert(read_by, '$[#]', ?)
      WHERE id = ? AND NOT (read_by LIKE '%"' || ? || '"%')
    `);

    for (const messageId of messageIds) {
      const result = updateStmt.run(readerHandle, messageId, readerHandle);
      if (result.changes > 0) updated++;
    }

    return updated;
  }

  /**
   * Archive a single message (soft delete)
   */
  archiveMessage(messageId: string): void {
    this.archiveMessages([messageId]);
  }

  /**
   * Archive messages (soft delete)
   */
  archiveMessages(messageIds: string[]): number {
    if (messageIds.length === 0) return 0;

    const db = this.storage.getDatabase();
    const now = Date.now();
    const placeholders = messageIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE blackboard
      SET archived_at = ?
      WHERE id IN (${placeholders}) AND archived_at IS NULL
    `);

    const result = stmt.run(now, ...messageIds);
    return result.changes;
  }

  /**
   * Archive all messages older than a certain age
   */
  archiveOldMessages(swarmId: string, maxAgeMs: number): number {
    const db = this.storage.getDatabase();
    const cutoff = Date.now() - maxAgeMs;
    const now = Date.now();

    const stmt = db.prepare(`
      UPDATE blackboard
      SET archived_at = ?
      WHERE swarm_id = ? AND created_at < ? AND archived_at IS NULL
    `);

    const result = stmt.run(now, swarmId, cutoff);
    return result.changes;
  }

  /**
   * Permanently delete archived messages
   */
  deleteArchived(swarmId: string): number {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      DELETE FROM blackboard
      WHERE swarm_id = ? AND archived_at IS NOT NULL
    `);

    const result = stmt.run(swarmId);
    return result.changes;
  }

  /**
   * Get unread message count for a handle
   */
  getUnreadCount(swarmId: string, readerHandle: string): number {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM blackboard
      WHERE swarm_id = ?
        AND archived_at IS NULL
        AND (target_handle = ? OR target_handle IS NULL)
        AND NOT (read_by LIKE '%"' || ? || '"%')
    `);

    const result = stmt.get(swarmId, readerHandle, readerHandle) as { count: number };
    return result.count;
  }

  /**
   * Get statistics for a swarm's blackboard
   */
  getStats(swarmId: string): BlackboardStats {
    const db = this.storage.getDatabase();

    // Total count
    const totalStmt = db.prepare(`
      SELECT COUNT(*) as count FROM blackboard WHERE swarm_id = ?
    `);
    const total = (totalStmt.get(swarmId) as { count: number }).count;

    // By type
    const typeStmt = db.prepare(`
      SELECT message_type, COUNT(*) as count
      FROM blackboard
      WHERE swarm_id = ? AND archived_at IS NULL
      GROUP BY message_type
    `);
    const typeRows = typeStmt.all(swarmId) as Array<{ message_type: string; count: number }>;
    const byType: Record<BlackboardMessageType, number> = {
      request: 0,
      response: 0,
      status: 0,
      directive: 0,
      checkpoint: 0,
    };
    for (const row of typeRows) {
      byType[row.message_type as BlackboardMessageType] = row.count;
    }

    // By priority
    const priorityStmt = db.prepare(`
      SELECT priority, COUNT(*) as count
      FROM blackboard
      WHERE swarm_id = ? AND archived_at IS NULL
      GROUP BY priority
    `);
    const priorityRows = priorityStmt.all(swarmId) as Array<{ priority: string; count: number }>;
    const byPriority: Record<MessagePriority, number> = {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
    };
    for (const row of priorityRows) {
      byPriority[row.priority as MessagePriority] = row.count;
    }

    // Archived count
    const archivedStmt = db.prepare(`
      SELECT COUNT(*) as count FROM blackboard WHERE swarm_id = ? AND archived_at IS NOT NULL
    `);
    const archived = (archivedStmt.get(swarmId) as { count: number }).count;

    // Unread (messages with empty read_by)
    const unreadStmt = db.prepare(`
      SELECT COUNT(*) as count FROM blackboard
      WHERE swarm_id = ? AND archived_at IS NULL AND read_by = '[]'
    `);
    const unread = (unreadStmt.get(swarmId) as { count: number }).count;

    return { total, byType, byPriority, unread, archived };
  }

  /**
   * Get all messages for a swarm (for debugging)
   */
  getAllMessages(swarmId: string): BlackboardMessage[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM blackboard WHERE swarm_id = ? ORDER BY created_at DESC
    `);
    const rows = stmt.all(swarmId) as BlackboardRow[];
    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Convert database row to BlackboardMessage
   */
  private rowToMessage(row: BlackboardRow): BlackboardMessage {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      senderHandle: row.sender_handle,
      messageType: row.message_type as BlackboardMessageType,
      targetHandle: row.target_handle,
      priority: row.priority as MessagePriority,
      payload: JSON.parse(row.payload),
      readBy: JSON.parse(row.read_by),
      createdAt: row.created_at,
      archivedAt: row.archived_at,
    };
  }
}
