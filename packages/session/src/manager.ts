/**
 * Session Manager
 *
 * High-level API for session operations.
 */

import type { Session, SessionMessage } from '@claude-fleet/common';
import { generateId } from '@claude-fleet/common';
import { SessionStore } from '@claude-fleet/storage';

export interface CreateSessionOptions {
  projectPath: string;
  parentId?: string;
  tags?: string[];
}

export interface ListSessionsOptions {
  projectPath?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'last_accessed';
}

export interface SearchOptions {
  projectPath?: string;
  limit?: number;
}

export class SessionManager {
  private store: SessionStore;

  constructor() {
    this.store = new SessionStore();
  }

  /**
   * Create a new session
   */
  create(options: CreateSessionOptions): Session {
    const parentSession = options.parentId
      ? this.store.get(options.parentId)
      : undefined;

    return this.store.create({
      id: generateId(),
      projectPath: options.projectPath,
      ...(options.tags && { tags: options.tags }),
      messageCount: 0,
      totalTokens: 0,
      ...(parentSession && {
        lineage: {
          parentId: parentSession.id,
          depth: (parentSession.lineage?.depth || 0) + 1,
        },
      }),
    });
  }

  /**
   * Get a session by ID
   */
  get(id: string): Session | undefined {
    return this.store.get(id);
  }

  /**
   * List sessions
   */
  list(options: ListSessionsOptions = {}): Session[] {
    return this.store.list(options);
  }

  /**
   * Get recent sessions for a project
   */
  getRecent(projectPath: string, limit: number = 10): Session[] {
    return this.store.list({
      projectPath,
      limit,
      orderBy: 'last_accessed',
    });
  }

  /**
   * Search sessions by content
   */
  search(query: string, options: SearchOptions = {}): Array<{
    session: Session;
    matches: string[];
  }> {
    return this.store.search(query, options);
  }

  /**
   * Add a message to a session
   */
  addMessage(sessionId: string, message: {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }): SessionMessage {
    return this.store.addMessage(sessionId, message);
  }

  /**
   * Get messages for a session
   */
  getMessages(sessionId: string, options?: {
    limit?: number;
    offset?: number;
  }): SessionMessage[] {
    return this.store.getMessages(sessionId, options);
  }

  /**
   * Update session access time
   */
  touch(id: string): void {
    this.store.touch(id);
  }

  /**
   * Update session summary
   */
  updateSummary(id: string, summary: string): void {
    this.store.updateSummary(id, summary);
  }

  /**
   * Add tags to a session
   */
  addTags(id: string, tags: string[]): void {
    this.store.addTags(id, tags);
  }

  /**
   * Get session lineage (ancestry chain)
   */
  getLineage(id: string): Session[] {
    return this.store.getLineage(id);
  }

  /**
   * Fork a session (create a child session)
   */
  fork(parentId: string, options?: {
    tags?: string[];
  }): Session | undefined {
    const parent = this.store.get(parentId);
    if (!parent) return undefined;

    return this.create({
      projectPath: parent.projectPath,
      parentId: parent.id,
      ...(options?.tags && { tags: options.tags }),
    });
  }

  /**
   * Delete a session
   */
  delete(id: string): boolean {
    return this.store.delete(id);
  }

  /**
   * Get statistics for a project
   */
  getStats(projectPath?: string): {
    totalSessions: number;
    totalMessages: number;
    recentActivity: number;
  } {
    const sessions = this.store.list({
      ...(projectPath && { projectPath }),
      limit: 1000,
    });

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentSessions = sessions.filter(
      (s) => s.lastAccessed > oneWeekAgo
    );

    return {
      totalSessions: sessions.length,
      totalMessages: sessions.reduce((sum, s) => sum + s.messageCount, 0),
      recentActivity: recentSessions.length,
    };
  }
}
