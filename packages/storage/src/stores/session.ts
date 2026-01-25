/**
 * Session Store
 *
 * Manages session persistence for resume functionality.
 */

import type { Session, SessionMessage } from '@claude-fleet/common';
import { getDatabase } from '../database.js';

export class SessionStore {
  private db = getDatabase();

  /**
   * Create a new session
   */
  create(session: Omit<Session, 'createdAt' | 'lastAccessed'>): Session {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, project_path, summary, tags, lineage_parent_id, lineage_depth, created_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.projectPath,
      session.summary || null,
      session.tags ? JSON.stringify(session.tags) : null,
      session.lineage?.parentId || null,
      session.lineage?.depth || 0,
      now,
      now
    );

    return {
      ...session,
      createdAt: now,
      lastAccessed: now,
    };
  }

  /**
   * Get a session by ID
   */
  get(id: string): Session | undefined {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;

    return row ? this.rowToSession(row) : undefined;
  }

  /**
   * List sessions with optional filters
   */
  list(options: {
    projectPath?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'created_at' | 'last_accessed';
  } = {}): Session[] {
    const { projectPath, limit = 100, offset = 0, orderBy = 'last_accessed' } = options;

    let sql = 'SELECT * FROM sessions';
    const params: unknown[] = [];

    if (projectPath) {
      sql += ' WHERE project_path = ?';
      params.push(projectPath);
    }

    sql += ` ORDER BY ${orderBy} DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as SessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  /**
   * Update session access time
   */
  touch(id: string): void {
    this.db
      .prepare('UPDATE sessions SET last_accessed = ? WHERE id = ?')
      .run(Date.now(), id);
  }

  /**
   * Update session summary
   */
  updateSummary(id: string, summary: string): void {
    this.db
      .prepare('UPDATE sessions SET summary = ? WHERE id = ?')
      .run(summary, id);
  }

  /**
   * Add tags to a session
   */
  addTags(id: string, tags: string[]): void {
    const session = this.get(id);
    if (!session) return;

    const existingTags = session.tags || [];
    const newTags = [...new Set([...existingTags, ...tags])];

    this.db
      .prepare('UPDATE sessions SET tags = ? WHERE id = ?')
      .run(JSON.stringify(newTags), id);
  }

  /**
   * Delete a session
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM sessions WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Add a message to a session
   */
  addMessage(sessionId: string, message: Omit<SessionMessage, 'id' | 'timestamp'>): SessionMessage {
    const stmt = this.db.prepare(`
      INSERT INTO session_messages (session_id, role, content)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(sessionId, message.role, message.content);

    // Update message count
    this.db
      .prepare('UPDATE sessions SET message_count = message_count + 1 WHERE id = ?')
      .run(sessionId);

    return {
      id: result.lastInsertRowid.toString(),
      ...message,
      timestamp: Date.now(),
    };
  }

  /**
   * Get messages for a session
   */
  getMessages(sessionId: string, options: {
    limit?: number;
    offset?: number;
  } = {}): SessionMessage[] {
    const { limit = 100, offset = 0 } = options;

    const rows = this.db
      .prepare(`
        SELECT id, role, content, timestamp
        FROM session_messages
        WHERE session_id = ?
        ORDER BY timestamp ASC
        LIMIT ? OFFSET ?
      `)
      .all(sessionId, limit, offset) as MessageRow[];

    return rows.map((row) => ({
      id: row.id.toString(),
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      timestamp: row.timestamp,
    }));
  }

  /**
   * Search sessions by content
   */
  search(query: string, options: {
    projectPath?: string;
    limit?: number;
  } = {}): Array<{ session: Session; matches: string[] }> {
    const { projectPath, limit = 20 } = options;

    let sql = `
      SELECT DISTINCT s.*, snippet(session_messages_fts, 0, '***', '***', '...', 32) as snippet
      FROM session_messages_fts fts
      JOIN session_messages sm ON fts.rowid = sm.id
      JOIN sessions s ON sm.session_id = s.id
      WHERE session_messages_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (projectPath) {
      sql += ' AND s.project_path = ?';
      params.push(projectPath);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as (SessionRow & { snippet: string })[];

    return rows.map((row) => ({
      session: this.rowToSession(row),
      matches: [row.snippet],
    }));
  }

  /**
   * Get session lineage
   */
  getLineage(id: string): Session[] {
    const lineage: Session[] = [];
    let current = this.get(id);

    while (current) {
      lineage.unshift(current);
      if (current.lineage?.parentId) {
        current = this.get(current.lineage.parentId);
      } else {
        break;
      }
    }

    return lineage;
  }

  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      projectPath: row.project_path,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      messageCount: row.message_count,
      totalTokens: row.total_tokens,
      ...(row.summary && { summary: row.summary }),
      ...(row.tags && { tags: JSON.parse(row.tags) }),
      ...(row.lineage_parent_id && {
        lineage: {
          parentId: row.lineage_parent_id,
          depth: row.lineage_depth,
        },
      }),
    };
  }
}

interface SessionRow {
  id: string;
  project_path: string;
  created_at: number;
  last_accessed: number;
  message_count: number;
  total_tokens: number;
  summary: string | null;
  tags: string | null;
  lineage_parent_id: string | null;
  lineage_depth: number;
}

interface MessageRow {
  id: number;
  role: string;
  content: string;
  timestamp: number;
}
