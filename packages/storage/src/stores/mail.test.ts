/**
 * Mail Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MailStore } from './mail.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { setDatabasePath, resetDatabase } from '../database.js';

describe('MailStore', () => {
  let store: MailStore;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `cct-mail-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
    store = new MailStore();
  });

  afterEach(() => {
    resetDatabase();
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
      if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('send()', () => {
    it('sends a message', () => {
      const mail = store.send({
        from: 'worker-1',
        to: 'worker-2',
        body: 'Hello!',
      });

      expect(mail.id).toBeDefined();
      expect(mail.from).toBe('worker-1');
      expect(mail.to).toBe('worker-2');
      expect(mail.body).toBe('Hello!');
      expect(mail.createdAt).toBeDefined();
    });

    it('sends message with subject', () => {
      const mail = store.send({
        from: 'worker-1',
        to: 'worker-2',
        subject: 'Important',
        body: 'Read this!',
      });

      expect(mail.subject).toBe('Important');
    });
  });

  describe('getUnread()', () => {
    beforeEach(() => {
      store.send({ from: 'a', to: 'b', body: 'Message 1' });
      store.send({ from: 'c', to: 'b', body: 'Message 2' });
      store.send({ from: 'a', to: 'd', body: 'Message 3' });
    });

    it('gets unread messages for a worker', () => {
      const unread = store.getUnread('b');
      expect(unread.length).toBe(2);
    });

    it('returns empty array for worker with no messages', () => {
      const unread = store.getUnread('nobody');
      expect(unread.length).toBe(0);
    });

    it('returns messages in order', () => {
      const unread = store.getUnread('b');
      expect(unread[0].body).toBe('Message 1');
      expect(unread[1].body).toBe('Message 2');
    });
  });

  describe('getInbox()', () => {
    beforeEach(() => {
      const mail = store.send({ from: 'a', to: 'b', body: 'Message 1' });
      store.send({ from: 'c', to: 'b', body: 'Message 2' });
      store.markRead([mail.id]);
    });

    it('gets all inbox messages', () => {
      const inbox = store.getInbox('b');
      expect(inbox.length).toBe(2);
    });

    it('filters for unread only', () => {
      const unread = store.getInbox('b', { unreadOnly: true });
      expect(unread.length).toBe(1);
      expect(unread[0].body).toBe('Message 2');
    });

    it('respects limit', () => {
      store.send({ from: 'd', to: 'b', body: 'Message 3' });
      const inbox = store.getInbox('b', { limit: 2 });
      expect(inbox.length).toBe(2);
    });
  });

  describe('getSent()', () => {
    beforeEach(() => {
      store.send({ from: 'a', to: 'b', body: 'Message 1' });
      store.send({ from: 'a', to: 'c', body: 'Message 2' });
      store.send({ from: 'b', to: 'a', body: 'Message 3' });
    });

    it('gets sent messages for a worker', () => {
      const sent = store.getSent('a');
      expect(sent.length).toBe(2);
    });

    it('respects limit', () => {
      const sent = store.getSent('a', 1);
      expect(sent.length).toBe(1);
    });
  });

  describe('markRead()', () => {
    it('marks messages as read', () => {
      const mail1 = store.send({ from: 'a', to: 'b', body: 'Msg 1' });
      const mail2 = store.send({ from: 'a', to: 'b', body: 'Msg 2' });

      store.markRead([mail1.id, mail2.id]);

      const unread = store.getUnread('b');
      expect(unread.length).toBe(0);
    });

    it('handles empty array', () => {
      expect(() => store.markRead([])).not.toThrow();
    });
  });

  describe('markAllRead()', () => {
    it('marks all messages for worker as read', () => {
      store.send({ from: 'a', to: 'b', body: 'Msg 1' });
      store.send({ from: 'a', to: 'b', body: 'Msg 2' });
      store.send({ from: 'a', to: 'b', body: 'Msg 3' });

      const count = store.markAllRead('b');

      expect(count).toBe(3);
      expect(store.getUnread('b').length).toBe(0);
    });

    it('returns 0 for worker with no unread', () => {
      const count = store.markAllRead('nobody');
      expect(count).toBe(0);
    });
  });

  describe('delete()', () => {
    it('deletes a message', () => {
      const mail = store.send({ from: 'a', to: 'b', body: 'Delete me' });
      const success = store.delete(mail.id);

      expect(success).toBe(true);
      expect(store.getUnread('b').length).toBe(0);
    });

    it('returns false for non-existent message', () => {
      const success = store.delete(99999);
      expect(success).toBe(false);
    });
  });

  describe('Handoff operations', () => {
    describe('createHandoff()', () => {
      it('creates a handoff', () => {
        const handoff = store.createHandoff({
          from: 'worker-1',
          to: 'worker-2',
          context: { task: 'continue this', data: [1, 2, 3] },
        });

        expect(handoff.id).toBeDefined();
        expect(handoff.from).toBe('worker-1');
        expect(handoff.to).toBe('worker-2');
        expect(handoff.context).toEqual({ task: 'continue this', data: [1, 2, 3] });
        expect(handoff.createdAt).toBeDefined();
        expect(handoff.acceptedAt).toBeUndefined();
      });
    });

    describe('getPendingHandoffs()', () => {
      beforeEach(() => {
        store.createHandoff({ from: 'a', to: 'b', context: { n: 1 } });
        store.createHandoff({ from: 'c', to: 'b', context: { n: 2 } });
        store.createHandoff({ from: 'a', to: 'd', context: { n: 3 } });
      });

      it('gets pending handoffs for a worker', () => {
        const handoffs = store.getPendingHandoffs('b');
        expect(handoffs.length).toBe(2);
      });

      it('returns handoffs in order', () => {
        const handoffs = store.getPendingHandoffs('b');
        expect(handoffs[0].context.n).toBe(1);
        expect(handoffs[1].context.n).toBe(2);
      });
    });

    describe('acceptHandoff()', () => {
      it('accepts a handoff', () => {
        const created = store.createHandoff({
          from: 'a',
          to: 'b',
          context: { data: 'test' },
        });

        const accepted = store.acceptHandoff(created.id);

        expect(accepted).toBeDefined();
        expect(accepted?.acceptedAt).toBeDefined();
      });

      it('returns undefined for non-existent handoff', () => {
        const accepted = store.acceptHandoff(99999);
        expect(accepted).toBeUndefined();
      });

      it('removes from pending after acceptance', () => {
        const created = store.createHandoff({
          from: 'a',
          to: 'b',
          context: {},
        });

        store.acceptHandoff(created.id);

        const pending = store.getPendingHandoffs('b');
        expect(pending.length).toBe(0);
      });
    });
  });

  describe('formatMailForPrompt()', () => {
    it('formats unread messages for injection', () => {
      store.send({ from: 'coordinator', to: 'worker-1', subject: 'Task', body: 'Do this' });
      store.send({ from: 'scout', to: 'worker-1', body: 'Found something' });

      const formatted = store.formatMailForPrompt('worker-1');

      expect(formatted).toContain('## Pending Messages');
      expect(formatted).toContain('### From: coordinator');
      expect(formatted).toContain('**Subject:** Task');
      expect(formatted).toContain('Do this');
      expect(formatted).toContain('### From: scout');
      expect(formatted).toContain('Found something');
    });

    it('returns empty string for no messages', () => {
      const formatted = store.formatMailForPrompt('worker-1');
      expect(formatted).toBe('');
    });
  });
});
