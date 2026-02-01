/**
 * Tests for MailStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { MailStorage } from './mail.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('MailStorage', () => {
  let ctx: TestStorageContext;
  let mail: MailStorage;

  beforeEach(() => {
    ctx = createTestStorage();
    mail = new MailStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // send() / get()
  // ==========================================================================

  describe('send() and get()', () => {
    it('should send a message and return its id', () => {
      const id = mail.send('alice', 'bob', 'Hello Bob');
      expect(id).toBeGreaterThan(0);
    });

    it('should store the subject when provided', () => {
      const id = mail.send('alice', 'bob', 'Need review', { subject: 'Code Review' });
      const msg = mail.get(id);

      expect(msg).not.toBeNull();
      expect(msg!.subject).toBe('Code Review');
      expect(msg!.body).toBe('Need review');
      expect(msg!.fromHandle).toBe('alice');
      expect(msg!.toHandle).toBe('bob');
    });

    it('should return null for non-existent message', () => {
      const msg = mail.get(9999);
      expect(msg).toBeNull();
    });
  });

  // ==========================================================================
  // getUnread() / getAll()
  // ==========================================================================

  describe('getUnread() and getAll()', () => {
    beforeEach(() => {
      mail.send('alice', 'bob', 'Message 1');
      mail.send('charlie', 'bob', 'Message 2');
      mail.send('alice', 'eve', 'Message to Eve');
    });

    it('should return unread messages for a handle', () => {
      const unread = mail.getUnread('bob');
      expect(unread).toHaveLength(2);
    });

    it('should return empty for handle with no messages', () => {
      const unread = mail.getUnread('nobody');
      expect(unread).toEqual([]);
    });

    it('should return all messages with limit', () => {
      // Send more messages
      for (let i = 0; i < 5; i++) {
        mail.send('alice', 'bob', `Extra ${i}`);
      }

      const all = mail.getAll('bob', 3);
      expect(all).toHaveLength(3);
    });
  });

  // ==========================================================================
  // markRead() / markAllRead()
  // ==========================================================================

  describe('markRead() and markAllRead()', () => {
    it('should mark a single message as read', () => {
      const id = mail.send('alice', 'bob', 'Read me');
      mail.markRead(id);

      const unread = mail.getUnread('bob');
      expect(unread).toHaveLength(0);
    });

    it('should mark all messages as read and return count', () => {
      mail.send('alice', 'bob', 'msg1');
      mail.send('charlie', 'bob', 'msg2');
      mail.send('dave', 'bob', 'msg3');

      const count = mail.markAllRead('bob');
      expect(count).toBe(3);

      const unread = mail.getUnread('bob');
      expect(unread).toHaveLength(0);
    });

    it('should return 0 when no unread messages exist', () => {
      const count = mail.markAllRead('nobody');
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // getUnreadCount()
  // ==========================================================================

  describe('getUnreadCount()', () => {
    it('should count unread messages accurately', () => {
      mail.send('alice', 'bob', 'msg1');
      mail.send('charlie', 'bob', 'msg2');

      expect(mail.getUnreadCount('bob')).toBe(2);

      // Mark one as read
      const unread = mail.getUnread('bob');
      mail.markRead(unread[0].id);

      expect(mail.getUnreadCount('bob')).toBe(1);
    });
  });

  // ==========================================================================
  // formatForInjection()
  // ==========================================================================

  describe('formatForInjection()', () => {
    it('should format pending mail as markdown', () => {
      mail.send('alice', 'bob', 'Check the PR', { subject: 'PR Review' });

      const formatted = mail.formatForInjection('bob');
      expect(formatted).toContain('Pending Messages (1)');
      expect(formatted).toContain('From alice');
      expect(formatted).toContain('**Subject:** PR Review');
      expect(formatted).toContain('Check the PR');
    });

    it('should return empty string when no pending mail', () => {
      const formatted = mail.formatForInjection('nobody');
      expect(formatted).toBe('');
    });
  });

  // ==========================================================================
  // Handoff operations
  // ==========================================================================

  describe('handoffs', () => {
    it('should create and retrieve a handoff', () => {
      const id = mail.createHandoff('alice', 'bob', { task: 'deploy', env: 'prod' });
      expect(id).toBeGreaterThan(0);

      const handoff = mail.getHandoff(id);
      expect(handoff).not.toBeNull();
      expect(handoff!.fromHandle).toBe('alice');
      expect(handoff!.toHandle).toBe('bob');
      expect(handoff!.context).toEqual({ task: 'deploy', env: 'prod' });
      expect(handoff!.acceptedAt).toBeNull();
    });

    it('should return null for non-existent handoff', () => {
      const handoff = mail.getHandoff(9999);
      expect(handoff).toBeNull();
    });

    it('should return only pending (unaccepted) handoffs', () => {
      const id1 = mail.createHandoff('alice', 'bob', { task: 'a' });
      mail.createHandoff('charlie', 'bob', { task: 'b' });

      // Accept the first
      mail.acceptHandoff(id1);

      const pending = mail.getPendingHandoffs('bob');
      expect(pending).toHaveLength(1);
      expect(pending[0].fromHandle).toBe('charlie');
    });

    it('should set acceptedAt when accepting a handoff', () => {
      const id = mail.createHandoff('alice', 'bob', { task: 'x' });
      const accepted = mail.acceptHandoff(id);

      expect(accepted).not.toBeNull();
      expect(accepted!.acceptedAt).not.toBeNull();
    });

    it('should return null when accepting non-existent handoff', () => {
      const result = mail.acceptHandoff(9999);
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // formatHandoffsForInjection()
  // ==========================================================================

  describe('formatHandoffsForInjection()', () => {
    it('should format pending handoffs as markdown', () => {
      mail.createHandoff('alice', 'bob', { files: ['a.ts', 'b.ts'] });

      const formatted = mail.formatHandoffsForInjection('bob');
      expect(formatted).toContain('Pending Handoffs (1)');
      expect(formatted).toContain('Handoff from alice');
      expect(formatted).toContain('a.ts');
    });

    it('should return empty string when no pending handoffs', () => {
      const formatted = mail.formatHandoffsForInjection('nobody');
      expect(formatted).toBe('');
    });
  });

  // ==========================================================================
  // formatAllPendingForInjection()
  // ==========================================================================

  describe('formatAllPendingForInjection()', () => {
    it('should combine mail and handoffs', () => {
      mail.send('alice', 'bob', 'Hey');
      mail.createHandoff('charlie', 'bob', { data: 'context' });

      const formatted = mail.formatAllPendingForInjection('bob');
      expect(formatted).toContain('Pending Messages');
      expect(formatted).toContain('Pending Handoffs');
    });

    it('should return empty string when nothing pending', () => {
      const formatted = mail.formatAllPendingForInjection('nobody');
      expect(formatted).toBe('');
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return unreadMail and pendingHandoffs counts', () => {
      mail.send('alice', 'bob', 'msg');
      mail.send('charlie', 'bob', 'msg2');
      mail.createHandoff('dave', 'bob', { x: 1 });

      const stats = mail.getStats('bob');
      expect(stats.unreadMail).toBe(2);
      expect(stats.pendingHandoffs).toBe(1);
    });

    it('should return zeros for unknown handle', () => {
      const stats = mail.getStats('nobody');
      expect(stats.unreadMail).toBe(0);
      expect(stats.pendingHandoffs).toBe(0);
    });
  });
});
