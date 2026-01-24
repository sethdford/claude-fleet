/**
 * Mail Storage
 *
 * Persistent messaging system for agent communication.
 * Messages persist across crashes and can be retrieved by agents on spawn.
 */

import type { SQLiteStorage } from './sqlite.js';
import type { MailMessage, Handoff, SendMailOptions } from '../types.js';

export class MailStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  // ============================================================================
  // Mail Operations
  // ============================================================================

  /**
   * Send a mail message
   */
  send(
    fromHandle: string,
    toHandle: string,
    body: string,
    options: SendMailOptions = {}
  ): number {
    return this.storage.insertMail({
      fromHandle,
      toHandle,
      subject: options.subject ?? null,
      body,
      readAt: null,
      createdAt: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Get a mail message by ID
   */
  get(mailId: number): MailMessage | null {
    return this.storage.getMail(mailId);
  }

  /**
   * Get unread mail for a handle
   */
  getUnread(handle: string): MailMessage[] {
    return this.storage.getUnreadMail(handle);
  }

  /**
   * Get all mail for a handle (recent first)
   */
  getAll(handle: string, limit = 50): MailMessage[] {
    return this.storage.getAllMailTo(handle, limit);
  }

  /**
   * Mark a message as read
   */
  markRead(mailId: number): void {
    this.storage.markMailRead(mailId);
  }

  /**
   * Mark all messages to a handle as read
   */
  markAllRead(handle: string): number {
    const unread = this.getUnread(handle);
    for (const msg of unread) {
      this.markRead(msg.id);
    }
    return unread.length;
  }

  /**
   * Get unread count for a handle
   */
  getUnreadCount(handle: string): number {
    return this.getUnread(handle).length;
  }

  /**
   * Format pending mail for worker injection
   */
  formatForInjection(handle: string): string {
    const pendingMail = this.getUnread(handle);
    if (pendingMail.length === 0) {
      return '';
    }

    const formatted = pendingMail.map((m) => {
      const subject = m.subject ? `**Subject:** ${m.subject}\n` : '';
      return `### From ${m.fromHandle}\n${subject}${m.body}`;
    });

    return `## Pending Messages (${pendingMail.length})\n\n${formatted.join('\n\n---\n\n')}`;
  }

  // ============================================================================
  // Handoff Operations
  // ============================================================================

  /**
   * Create a handoff (context transfer between agents)
   */
  createHandoff(
    fromHandle: string,
    toHandle: string,
    context: Record<string, unknown>
  ): number {
    return this.storage.insertHandoff({
      fromHandle,
      toHandle,
      context,
      acceptedAt: null,
      createdAt: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Get a handoff by ID
   */
  getHandoff(handoffId: number): Handoff | null {
    return this.storage.getHandoff(handoffId);
  }

  /**
   * Get pending handoffs for a handle
   */
  getPendingHandoffs(handle: string): Handoff[] {
    return this.storage.getPendingHandoffs(handle);
  }

  /**
   * Accept a handoff
   */
  acceptHandoff(handoffId: number): Handoff | null {
    const handoff = this.getHandoff(handoffId);
    if (!handoff) return null;

    this.storage.acceptHandoff(handoffId);
    return { ...handoff, acceptedAt: Math.floor(Date.now() / 1000) };
  }

  /**
   * Format pending handoffs for worker injection
   */
  formatHandoffsForInjection(handle: string): string {
    const pendingHandoffs = this.getPendingHandoffs(handle);
    if (pendingHandoffs.length === 0) {
      return '';
    }

    const formatted = pendingHandoffs.map((h) => {
      const contextStr = JSON.stringify(h.context, null, 2);
      return `### Handoff from ${h.fromHandle}\n\`\`\`json\n${contextStr}\n\`\`\``;
    });

    return `## Pending Handoffs (${pendingHandoffs.length})\n\n${formatted.join('\n\n---\n\n')}`;
  }

  // ============================================================================
  // Combined Injection
  // ============================================================================

  /**
   * Format all pending items (mail + handoffs) for worker injection
   */
  formatAllPendingForInjection(handle: string): string {
    const parts: string[] = [];

    const mailSection = this.formatForInjection(handle);
    if (mailSection) {
      parts.push(mailSection);
    }

    const handoffSection = this.formatHandoffsForInjection(handle);
    if (handoffSection) {
      parts.push(handoffSection);
    }

    if (parts.length === 0) {
      return '';
    }

    return parts.join('\n\n');
  }

  // ============================================================================
  // Stats
  // ============================================================================

  /**
   * Get mail statistics for a handle
   */
  getStats(handle: string): {
    unreadMail: number;
    pendingHandoffs: number;
  } {
    return {
      unreadMail: this.getUnreadCount(handle),
      pendingHandoffs: this.getPendingHandoffs(handle).length,
    };
  }
}
