/**
 * Session Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './manager.js';
import { setDatabasePath, resetDatabase } from '@claude-fleet/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('SessionManager', () => {
  let manager: SessionManager;
  let tempDbPath: string;

  beforeEach(() => {
    // Create temp database for testing
    tempDbPath = path.join(os.tmpdir(), `cct-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
    manager = new SessionManager();
  });

  afterEach(() => {
    // Reset database connection
    resetDatabase();

    // Clean up temp database files
    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
      if (fs.existsSync(`${tempDbPath}-wal`)) {
        fs.unlinkSync(`${tempDbPath}-wal`);
      }
      if (fs.existsSync(`${tempDbPath}-shm`)) {
        fs.unlinkSync(`${tempDbPath}-shm`);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('create()', () => {
    it('creates a new session', () => {
      const session = manager.create('/test/project');
      expect(session.id).toBeDefined();
      expect(session.projectPath).toBe('/test/project');
      expect(session.messageCount).toBe(0);
      expect(session.createdAt).toBeDefined();
    });

    it('creates sessions with unique IDs', () => {
      const session1 = manager.create('/project1');
      const session2 = manager.create('/project2');
      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe('get()', () => {
    it('retrieves a session by ID', () => {
      const created = manager.create('/test/project');
      const retrieved = manager.get(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.projectPath).toBe('/test/project');
    });

    it('returns undefined for non-existent session', () => {
      const result = manager.get('nonexistent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('lists all sessions', () => {
      manager.create('/project1');
      manager.create('/project2');
      manager.create('/project3');

      const sessions = manager.list();
      expect(sessions.length).toBe(3);
    });

    it('filters by project path', () => {
      manager.create('/project/a');
      manager.create('/project/b');
      manager.create('/other/c');

      const sessions = manager.list({ projectPath: '/project' });
      expect(sessions.length).toBe(2);
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        manager.create(`/project${i}`);
      }

      const sessions = manager.list({ limit: 5 });
      expect(sessions.length).toBe(5);
    });

    it('respects offset', () => {
      for (let i = 0; i < 5; i++) {
        manager.create(`/project${i}`);
      }

      const all = manager.list();
      const offset = manager.list({ offset: 2 });
      expect(offset.length).toBe(3);
    });
  });

  describe('addMessage()', () => {
    it('adds a message to a session', () => {
      const session = manager.create('/test');
      manager.addMessage(session.id, {
        role: 'user',
        content: 'Hello',
      });

      const updated = manager.get(session.id);
      expect(updated?.messageCount).toBe(1);
    });

    it('adds multiple messages', () => {
      const session = manager.create('/test');
      manager.addMessage(session.id, { role: 'user', content: 'Hello' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Hi there!' });
      manager.addMessage(session.id, { role: 'user', content: 'How are you?' });

      const updated = manager.get(session.id);
      expect(updated?.messageCount).toBe(3);
    });
  });

  describe('getMessages()', () => {
    it('retrieves messages for a session', () => {
      const session = manager.create('/test');
      manager.addMessage(session.id, { role: 'user', content: 'Hello' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Hi!' });

      const messages = manager.getMessages(session.id);
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].role).toBe('assistant');
    });

    it('returns empty array for non-existent session', () => {
      const messages = manager.getMessages('nonexistent');
      expect(messages).toEqual([]);
    });
  });

  describe('search()', () => {
    it('searches sessions by content', () => {
      const session1 = manager.create('/test1');
      manager.addMessage(session1.id, { role: 'user', content: 'Hello world' });

      const session2 = manager.create('/test2');
      manager.addMessage(session2.id, { role: 'user', content: 'Goodbye world' });

      const results = manager.search('Hello');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].session.id).toBe(session1.id);
    });

    it('returns matches array', () => {
      const session = manager.create('/test');
      manager.addMessage(session.id, { role: 'user', content: 'Testing search functionality' });

      const results = manager.search('search');
      expect(results.length).toBe(1);
      expect(results[0].matches).toBeDefined();
      expect(results[0].matches.length).toBeGreaterThan(0);
    });
  });

  describe('fork()', () => {
    it('creates a fork of a session', () => {
      const original = manager.create('/test');
      manager.addMessage(original.id, { role: 'user', content: 'Hello' });
      manager.addMessage(original.id, { role: 'assistant', content: 'Hi!' });

      const forked = manager.fork(original.id);
      expect(forked).toBeDefined();
      expect(forked?.id).not.toBe(original.id);
      expect(forked?.lineage?.parentId).toBe(original.id);
      expect(forked?.lineage?.depth).toBe(1);
    });

    it('copies messages to fork', () => {
      const original = manager.create('/test');
      manager.addMessage(original.id, { role: 'user', content: 'Hello' });
      manager.addMessage(original.id, { role: 'assistant', content: 'Hi!' });

      const forked = manager.fork(original.id);
      const messages = manager.getMessages(forked!.id);
      expect(messages.length).toBe(2);
    });

    it('returns undefined for non-existent session', () => {
      const result = manager.fork('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('delete()', () => {
    it('deletes a session', () => {
      const session = manager.create('/test');
      const result = manager.delete(session.id);
      expect(result).toBe(true);
      expect(manager.get(session.id)).toBeUndefined();
    });

    it('returns false for non-existent session', () => {
      const result = manager.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getStats()', () => {
    it('returns session statistics', () => {
      manager.create('/project1');
      manager.create('/project2');
      const session = manager.create('/project3');
      manager.addMessage(session.id, { role: 'user', content: 'Hello' });

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(3);
      expect(stats.totalMessages).toBe(1);
    });

    it('filters by project path', () => {
      manager.create('/projectA/sub');
      manager.create('/projectA/sub2');
      manager.create('/projectB/sub');

      const stats = manager.getStats('/projectA');
      expect(stats.totalSessions).toBe(2);
    });
  });
});
