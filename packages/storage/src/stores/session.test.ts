/**
 * Session Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from './session.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { setDatabasePath, resetDatabase } from '../database.js';

describe('SessionStore', () => {
  let store: SessionStore;
  let tempDbPath: string;

  beforeEach(() => {
    // Create temp database for testing
    tempDbPath = path.join(os.tmpdir(), `cct-session-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
    store = new SessionStore();
  });

  afterEach(() => {
    // Reset database connection
    resetDatabase();

    // Clean up temp database files
    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
      // Also clean up WAL files
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
      const session = store.create({
        id: 'test-session-1',
        projectPath: '/test/project',
        messageCount: 0,
        totalTokens: 0,
      });

      expect(session.id).toBe('test-session-1');
      expect(session.projectPath).toBe('/test/project');
      expect(session.createdAt).toBeDefined();
      expect(session.lastAccessed).toBeDefined();
    });

    it('creates session with optional fields', () => {
      const session = store.create({
        id: 'test-session-2',
        projectPath: '/test/project',
        messageCount: 0,
        totalTokens: 0,
        summary: 'Test summary',
        tags: ['test', 'example'],
      });

      expect(session.summary).toBe('Test summary');
      expect(session.tags).toEqual(['test', 'example']);
    });

    it('creates session with lineage', () => {
      const parent = store.create({
        id: 'parent-session',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });

      const child = store.create({
        id: 'child-session',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
        lineage: {
          parentId: parent.id,
          depth: 1,
        },
      });

      expect(child.lineage?.parentId).toBe('parent-session');
      expect(child.lineage?.depth).toBe(1);
    });
  });

  describe('get()', () => {
    it('retrieves a session by ID', () => {
      store.create({
        id: 'get-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });

      const session = store.get('get-test');
      expect(session).toBeDefined();
      expect(session?.id).toBe('get-test');
    });

    it('returns undefined for non-existent session', () => {
      const session = store.get('nonexistent');
      expect(session).toBeUndefined();
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      // Create some test sessions
      for (let i = 0; i < 5; i++) {
        store.create({
          id: `list-test-${i}`,
          projectPath: i < 3 ? '/project/a' : '/project/b',
          messageCount: 0,
          totalTokens: 0,
        });
      }
    });

    it('lists all sessions', () => {
      const sessions = store.list();
      expect(sessions.length).toBe(5);
    });

    it('filters by project path', () => {
      const sessions = store.list({ projectPath: '/project/a' });
      expect(sessions.length).toBe(3);
    });

    it('respects limit', () => {
      const sessions = store.list({ limit: 2 });
      expect(sessions.length).toBe(2);
    });

    it('respects offset', () => {
      const all = store.list();
      const offset = store.list({ offset: 2 });
      expect(offset.length).toBe(3);
    });
  });

  describe('addMessage()', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = store.create({
        id: 'msg-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });
      sessionId = session.id;
    });

    it('adds a message to a session', () => {
      const message = store.addMessage(sessionId, {
        role: 'user',
        content: 'Hello, world!',
      });

      expect(message.id).toBeDefined();
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
      expect(message.timestamp).toBeDefined();
    });

    it('increments message count', () => {
      store.addMessage(sessionId, { role: 'user', content: 'Message 1' });
      store.addMessage(sessionId, { role: 'assistant', content: 'Message 2' });

      const session = store.get(sessionId);
      expect(session?.messageCount).toBe(2);
    });
  });

  describe('getMessages()', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = store.create({
        id: 'get-msg-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });
      sessionId = session.id;

      store.addMessage(sessionId, { role: 'user', content: 'Hello' });
      store.addMessage(sessionId, { role: 'assistant', content: 'Hi there!' });
      store.addMessage(sessionId, { role: 'user', content: 'How are you?' });
    });

    it('retrieves all messages', () => {
      const messages = store.getMessages(sessionId);
      expect(messages.length).toBe(3);
    });

    it('returns messages in order', () => {
      const messages = store.getMessages(sessionId);
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].content).toBe('Hi there!');
      expect(messages[2].content).toBe('How are you?');
    });

    it('respects limit', () => {
      const messages = store.getMessages(sessionId, { limit: 2 });
      expect(messages.length).toBe(2);
    });
  });

  describe('touch()', () => {
    it('updates last accessed time', () => {
      const session = store.create({
        id: 'touch-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });

      const initial = session.lastAccessed;

      // Small delay to ensure different timestamp
      const delay = 10;
      setTimeout(() => {
        store.touch(session.id);
        const updated = store.get(session.id);
        expect(updated?.lastAccessed).toBeGreaterThanOrEqual(initial);
      }, delay);
    });
  });

  describe('updateSummary()', () => {
    it('updates session summary', () => {
      const session = store.create({
        id: 'summary-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });

      store.updateSummary(session.id, 'Updated summary');

      const updated = store.get(session.id);
      expect(updated?.summary).toBe('Updated summary');
    });
  });

  describe('addTags()', () => {
    it('adds tags to a session', () => {
      const session = store.create({
        id: 'tags-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });

      store.addTags(session.id, ['tag1', 'tag2']);

      const updated = store.get(session.id);
      expect(updated?.tags).toContain('tag1');
      expect(updated?.tags).toContain('tag2');
    });

    it('merges with existing tags', () => {
      const session = store.create({
        id: 'tags-merge-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
        tags: ['existing'],
      });

      store.addTags(session.id, ['new']);

      const updated = store.get(session.id);
      expect(updated?.tags).toContain('existing');
      expect(updated?.tags).toContain('new');
    });

    it('deduplicates tags', () => {
      const session = store.create({
        id: 'tags-dedup-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
        tags: ['tag1'],
      });

      store.addTags(session.id, ['tag1', 'tag2']);

      const updated = store.get(session.id);
      expect(updated?.tags?.filter(t => t === 'tag1').length).toBe(1);
    });
  });

  describe('delete()', () => {
    it('deletes a session', () => {
      store.create({
        id: 'delete-test',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });

      const result = store.delete('delete-test');
      expect(result).toBe(true);
      expect(store.get('delete-test')).toBeUndefined();
    });

    it('returns false for non-existent session', () => {
      const result = store.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getLineage()', () => {
    it('returns lineage chain', () => {
      const grandparent = store.create({
        id: 'gp',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
      });

      const parent = store.create({
        id: 'p',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
        lineage: { parentId: grandparent.id, depth: 1 },
      });

      store.create({
        id: 'c',
        projectPath: '/test',
        messageCount: 0,
        totalTokens: 0,
        lineage: { parentId: parent.id, depth: 2 },
      });

      const lineage = store.getLineage('c');
      expect(lineage.length).toBe(3);
      expect(lineage[0].id).toBe('gp');
      expect(lineage[1].id).toBe('p');
      expect(lineage[2].id).toBe('c');
    });
  });
});
