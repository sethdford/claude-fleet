/**
 * Tests for SQLite storage layer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../src/storage/sqlite.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('SQLiteStorage', () => {
  let storage: SQLiteStorage;
  let dbPath: string;

  beforeEach(() => {
    // Create a unique temp database for each test
    dbPath = path.join(os.tmpdir(), `test-collab-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    storage = new SQLiteStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    // Cleanup temp database files
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-shm');
      fs.unlinkSync(dbPath + '-wal');
    } catch {
      // Files may not exist
    }
  });

  describe('User operations', () => {
    const testUser = {
      uid: 'a'.repeat(24),
      handle: 'test-agent',
      teamName: 'test-team',
      agentType: 'worker' as const,
      createdAt: new Date().toISOString(),
      lastSeen: null,
    };

    it('inserts and retrieves a user', () => {
      storage.insertUser(testUser);
      const retrieved = storage.getUser(testUser.uid);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.uid).toBe(testUser.uid);
      expect(retrieved!.handle).toBe(testUser.handle);
      expect(retrieved!.teamName).toBe(testUser.teamName);
      expect(retrieved!.agentType).toBe(testUser.agentType);
    });

    it('returns null for non-existent user', () => {
      const retrieved = storage.getUser('nonexistent');
      expect(retrieved).toBeNull();
    });

    it('updates existing user on re-insert', () => {
      storage.insertUser(testUser);
      const updatedUser = { ...testUser, lastSeen: new Date().toISOString() };
      storage.insertUser(updatedUser);

      const retrieved = storage.getUser(testUser.uid);
      expect(retrieved!.lastSeen).toBe(updatedUser.lastSeen);
    });

    it('retrieves users by team', () => {
      const user1 = { ...testUser, uid: 'a'.repeat(24), handle: 'agent-1' };
      const user2 = { ...testUser, uid: 'b'.repeat(24), handle: 'agent-2' };
      const user3 = { ...testUser, uid: 'c'.repeat(24), handle: 'other', teamName: 'other-team' };

      storage.insertUser(user1);
      storage.insertUser(user2);
      storage.insertUser(user3);

      const teamUsers = storage.getUsersByTeam('test-team');
      expect(teamUsers).toHaveLength(2);
      expect(teamUsers.map(u => u.handle)).toContain('agent-1');
      expect(teamUsers.map(u => u.handle)).toContain('agent-2');
    });
  });

  describe('Chat operations', () => {
    const testChat = {
      id: 'chat123',
      participants: ['uid1', 'uid2'],
      isTeamChat: false,
      teamName: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('inserts and retrieves a chat', () => {
      storage.insertChat(testChat);
      const retrieved = storage.getChat(testChat.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(testChat.id);
      expect(retrieved!.participants).toEqual(testChat.participants);
    });

    it('returns null for non-existent chat', () => {
      const retrieved = storage.getChat('nonexistent');
      expect(retrieved).toBeNull();
    });

    it('retrieves chats by user', () => {
      const chat1 = { ...testChat, id: 'chat1', participants: ['user1', 'user2'] };
      const chat2 = { ...testChat, id: 'chat2', participants: ['user1', 'user3'] };
      const chat3 = { ...testChat, id: 'chat3', participants: ['user2', 'user3'] };

      storage.insertChat(chat1);
      storage.insertChat(chat2);
      storage.insertChat(chat3);

      const user1Chats = storage.getChatsByUser('user1');
      expect(user1Chats).toHaveLength(2);
      expect(user1Chats.map(c => c.id)).toContain('chat1');
      expect(user1Chats.map(c => c.id)).toContain('chat2');
    });

    it('updates chat timestamp', () => {
      storage.insertChat(testChat);
      const newTimestamp = new Date().toISOString();
      storage.updateChatTime(testChat.id, newTimestamp);

      const retrieved = storage.getChat(testChat.id);
      expect(retrieved!.updatedAt).toBe(newTimestamp);
    });
  });

  describe('Message operations', () => {
    const testChat = {
      id: 'chat123',
      participants: ['uid1', 'uid2'],
      isTeamChat: false,
      teamName: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const testMessage = {
      id: 'msg1',
      chatId: 'chat123',
      fromHandle: 'collab:test',
      fromUid: 'uid1',
      text: 'Hello, world!',
      timestamp: new Date().toISOString(),
      status: 'pending' as const,
      metadata: {},
    };

    beforeEach(() => {
      storage.insertChat(testChat);
    });

    it('inserts and retrieves messages', () => {
      storage.insertMessage(testMessage);
      const messages = storage.getMessages(testChat.id, 10);

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(testMessage.id);
      expect(messages[0].text).toBe(testMessage.text);
    });

    it('retrieves messages with limit', () => {
      for (let i = 0; i < 10; i++) {
        storage.insertMessage({
          ...testMessage,
          id: `msg${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        });
      }

      const messages = storage.getMessages(testChat.id, 5);
      expect(messages).toHaveLength(5);
    });

    it('retrieves messages after timestamp', () => {
      const baseTime = Date.now();
      for (let i = 0; i < 5; i++) {
        storage.insertMessage({
          ...testMessage,
          id: `msg${i}`,
          timestamp: new Date(baseTime + i * 1000).toISOString(),
        });
      }

      const afterTime = new Date(baseTime + 2000).toISOString();
      const messages = storage.getMessagesAfter(testChat.id, afterTime, 10);

      // Should get messages after msg2 (msg3, msg4)
      expect(messages).toHaveLength(2);
    });
  });

  describe('Unread count operations', () => {
    const chatId = 'chat123';
    const uid = 'user1';

    it('initializes unread to 0', () => {
      storage.setUnread(chatId, uid, 0);
      const unread = storage.getUnread(chatId, uid);
      expect(unread).toBe(0);
    });

    it('increments unread count', () => {
      storage.setUnread(chatId, uid, 0);
      storage.incrementUnread(chatId, uid);
      storage.incrementUnread(chatId, uid);

      const unread = storage.getUnread(chatId, uid);
      expect(unread).toBe(2);
    });

    it('clears unread count', () => {
      storage.setUnread(chatId, uid, 5);
      storage.clearUnread(chatId, uid);

      const unread = storage.getUnread(chatId, uid);
      expect(unread).toBe(0);
    });
  });

  describe('Task operations', () => {
    const testTask = {
      id: 'task1',
      teamName: 'test-team',
      subject: 'Test task',
      description: 'Test description',
      ownerHandle: 'worker-1',
      ownerUid: 'uid1',
      createdByHandle: 'lead',
      createdByUid: 'uid0',
      status: 'open' as const,
      blockedBy: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('inserts and retrieves a task', () => {
      storage.insertTask(testTask);
      const retrieved = storage.getTask(testTask.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(testTask.id);
      expect(retrieved!.subject).toBe(testTask.subject);
      expect(retrieved!.status).toBe('open');
    });

    it('returns null for non-existent task', () => {
      const retrieved = storage.getTask('nonexistent');
      expect(retrieved).toBeNull();
    });

    it('retrieves tasks by team', () => {
      const task1 = { ...testTask, id: 'task1' };
      const task2 = { ...testTask, id: 'task2' };
      const task3 = { ...testTask, id: 'task3', teamName: 'other-team' };

      storage.insertTask(task1);
      storage.insertTask(task2);
      storage.insertTask(task3);

      const teamTasks = storage.getTasksByTeam('test-team');
      expect(teamTasks).toHaveLength(2);
    });

    it('updates task status', () => {
      storage.insertTask(testTask);
      const newTime = new Date().toISOString();
      storage.updateTaskStatus(testTask.id, 'in_progress', newTime);

      const retrieved = storage.getTask(testTask.id);
      expect(retrieved!.status).toBe('in_progress');
      expect(retrieved!.updatedAt).toBe(newTime);
    });

    it('handles blockedBy array', () => {
      const taskWithBlocked = {
        ...testTask,
        id: 'blocked-task',
        blockedBy: ['task1', 'task2'],
      };
      storage.insertTask(taskWithBlocked);

      const retrieved = storage.getTask('blocked-task');
      expect(retrieved!.blockedBy).toEqual(['task1', 'task2']);
    });
  });

  describe('Mail operations', () => {
    it('inserts and retrieves mail', () => {
      const id = storage.insertMail({
        fromHandle: 'alice',
        toHandle: 'bob',
        subject: 'Hello',
        body: 'Hi Bob',
        readAt: null,
        createdAt: Math.floor(Date.now() / 1000),
      });

      expect(id).toBeGreaterThan(0);

      const msg = storage.getMail(id);
      expect(msg).not.toBeNull();
      expect(msg!.fromHandle).toBe('alice');
      expect(msg!.body).toBe('Hi Bob');
    });

    it('returns null for non-existent mail', () => {
      expect(storage.getMail(9999)).toBeNull();
    });

    it('retrieves unread mail', () => {
      storage.insertMail({ fromHandle: 'a', toHandle: 'bob', subject: null, body: 'msg1', readAt: null, createdAt: Math.floor(Date.now() / 1000) });
      storage.insertMail({ fromHandle: 'b', toHandle: 'bob', subject: null, body: 'msg2', readAt: null, createdAt: Math.floor(Date.now() / 1000) });

      const unread = storage.getUnreadMail('bob');
      expect(unread).toHaveLength(2);
    });

    it('marks mail as read', () => {
      const id = storage.insertMail({ fromHandle: 'a', toHandle: 'bob', subject: null, body: 'test', readAt: null, createdAt: Math.floor(Date.now() / 1000) });
      storage.markMailRead(id);

      const unread = storage.getUnreadMail('bob');
      expect(unread).toHaveLength(0);
    });

    it('retrieves all mail with limit', () => {
      for (let i = 0; i < 5; i++) {
        storage.insertMail({ fromHandle: `sender-${i}`, toHandle: 'bob', subject: null, body: `msg-${i}`, readAt: null, createdAt: Math.floor(Date.now() / 1000) + i });
      }

      const all = storage.getAllMailTo('bob', 3);
      expect(all).toHaveLength(3);
    });
  });

  describe('Handoff operations', () => {
    it('inserts and retrieves a handoff', () => {
      const id = storage.insertHandoff({
        fromHandle: 'alice',
        toHandle: 'bob',
        context: { task: 'deploy' },
        acceptedAt: null,
        createdAt: Math.floor(Date.now() / 1000),
      });

      expect(id).toBeGreaterThan(0);

      const handoff = storage.getHandoff(id);
      expect(handoff).not.toBeNull();
      expect(handoff!.fromHandle).toBe('alice');
      expect(handoff!.context).toEqual({ task: 'deploy' });
    });

    it('returns pending handoffs', () => {
      storage.insertHandoff({ fromHandle: 'a', toHandle: 'bob', context: {}, acceptedAt: null, createdAt: Math.floor(Date.now() / 1000) });

      const pending = storage.getPendingHandoffs('bob');
      expect(pending).toHaveLength(1);
    });

    it('accepts a handoff', () => {
      const id = storage.insertHandoff({ fromHandle: 'a', toHandle: 'bob', context: {}, acceptedAt: null, createdAt: Math.floor(Date.now() / 1000) });
      storage.acceptHandoff(id);

      const pending = storage.getPendingHandoffs('bob');
      expect(pending).toHaveLength(0);
    });
  });

  describe('Agent memory operations', () => {
    it('inserts and retrieves agent memory', () => {
      storage.insertAgentMemory({
        id: 'mem-1',
        agentId: 'agent-1',
        key: 'fact-1',
        value: 'TypeScript is typed',
        tags: 'lang,ts',
        memoryType: 'fact',
        relevance: 1.0,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
      });

      const result = storage.getAgentMemoryByKey('agent-1', 'fact-1');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('TypeScript is typed');
    });

    it('returns null for missing memory', () => {
      const result = storage.getAgentMemoryByKey('agent-1', 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('retrieves memories by agent with limit', () => {
      for (let i = 0; i < 5; i++) {
        storage.insertAgentMemory({
          id: `mem-${i}`,
          agentId: 'agent-1',
          key: `key-${i}`,
          value: `value-${i}`,
          tags: null,
          memoryType: 'fact',
          relevance: 1.0 - i * 0.1,
          accessCount: 0,
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
        });
      }

      const memories = storage.getAgentMemoriesByAgent('agent-1', 3);
      expect(memories).toHaveLength(3);
    });

    it('updates access count', () => {
      storage.insertAgentMemory({
        id: 'mem-acc',
        agentId: 'agent-1',
        key: 'accessed',
        value: 'v',
        tags: null,
        memoryType: 'fact',
        relevance: 1.0,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
      });

      storage.updateAgentMemoryAccess('mem-acc');

      const result = storage.getAgentMemoryByKey('agent-1', 'accessed');
      expect(result!.access_count).toBe(1);
    });

    it('deletes agent memory', () => {
      storage.insertAgentMemory({
        id: 'mem-del',
        agentId: 'agent-1',
        key: 'deleteme',
        value: 'v',
        tags: null,
        memoryType: 'fact',
        relevance: 1.0,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
      });

      storage.deleteAgentMemory('mem-del');

      const result = storage.getAgentMemoryByKey('agent-1', 'deleteme');
      expect(result).toBeUndefined();
    });

    it('searches agent memory', () => {
      storage.insertAgentMemory({
        id: 'mem-search',
        agentId: 'agent-1',
        key: 'search-key',
        value: 'authentication with JWT tokens',
        tags: 'auth,jwt',
        memoryType: 'pattern',
        relevance: 0.9,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
      });

      const results = storage.searchAgentMemory('agent-1', 'JWT', 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Work item operations', () => {
    it('inserts and retrieves a work item', () => {
      const item = {
        id: 'wi-test1',
        title: 'Test work item',
        description: 'Description here',
        status: 'pending' as const,
        assignedTo: null,
        batchId: null,
        createdAt: Math.floor(Date.now() / 1000),
      };

      storage.insertWorkItem(item);
      const retrieved = storage.getWorkItem('wi-test1');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('Test work item');
    });

    it('returns null for non-existent work item', () => {
      expect(storage.getWorkItem('wi-zzzzz')).toBeNull();
    });

    it('returns all work items', () => {
      storage.insertWorkItem({ id: 'wi-a', title: 'A', description: null, status: 'pending', assignedTo: null, batchId: null, createdAt: Math.floor(Date.now() / 1000) });
      storage.insertWorkItem({ id: 'wi-b', title: 'B', description: null, status: 'pending', assignedTo: 'w1', batchId: null, createdAt: Math.floor(Date.now() / 1000) });

      const all = storage.getAllWorkItems();
      expect(all).toHaveLength(2);
    });

    it('retrieves work items by assignee', () => {
      storage.insertWorkItem({ id: 'wi-x', title: 'X', description: null, status: 'pending', assignedTo: 'w1', batchId: null, createdAt: Math.floor(Date.now() / 1000) });
      storage.insertWorkItem({ id: 'wi-y', title: 'Y', description: null, status: 'pending', assignedTo: 'w2', batchId: null, createdAt: Math.floor(Date.now() / 1000) });

      const w1Items = storage.getWorkItemsByAssignee('w1');
      expect(w1Items).toHaveLength(1);
      expect(w1Items[0].title).toBe('X');
    });

    it('updates work item status', () => {
      storage.insertWorkItem({ id: 'wi-s', title: 'S', description: null, status: 'pending', assignedTo: null, batchId: null, createdAt: Math.floor(Date.now() / 1000) });
      storage.updateWorkItemStatus('wi-s', 'completed');

      const retrieved = storage.getWorkItem('wi-s');
      expect(retrieved!.status).toBe('completed');
    });

    it('assigns a work item', () => {
      storage.insertWorkItem({ id: 'wi-assign', title: 'Assign', description: null, status: 'pending', assignedTo: null, batchId: null, createdAt: Math.floor(Date.now() / 1000) });
      storage.assignWorkItem('wi-assign', 'worker-1');

      const retrieved = storage.getWorkItem('wi-assign');
      expect(retrieved!.assignedTo).toBe('worker-1');
      expect(retrieved!.status).toBe('in_progress');
    });
  });

  describe('Batch operations', () => {
    it('inserts and retrieves a batch', () => {
      storage.insertBatch({ id: 'batch-1', name: 'Sprint 1', status: 'open', createdAt: Math.floor(Date.now() / 1000) });

      const batch = storage.getBatch('batch-1');
      expect(batch).not.toBeNull();
      expect(batch!.name).toBe('Sprint 1');
    });

    it('returns all batches', () => {
      storage.insertBatch({ id: 'b1', name: 'B1', status: 'open', createdAt: Math.floor(Date.now() / 1000) });
      storage.insertBatch({ id: 'b2', name: 'B2', status: 'open', createdAt: Math.floor(Date.now() / 1000) });

      const all = storage.getAllBatches();
      expect(all).toHaveLength(2);
    });

    it('updates batch status', () => {
      storage.insertBatch({ id: 'b-upd', name: 'Update Me', status: 'open', createdAt: Math.floor(Date.now() / 1000) });
      storage.updateBatchStatus('b-upd', 'completed');

      const batch = storage.getBatch('b-upd');
      expect(batch!.status).toBe('completed');
    });
  });

  describe('Debug info', () => {
    it('returns aggregated debug info', () => {
      // Insert some data
      storage.insertUser({
        uid: 'a'.repeat(24),
        handle: 'agent',
        teamName: 'team',
        agentType: 'worker',
        createdAt: new Date().toISOString(),
        lastSeen: null,
      });
      storage.insertChat({
        id: 'chat1',
        participants: ['a'.repeat(24)],
        isTeamChat: false,
        teamName: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      storage.insertTask({
        id: 'task1',
        teamName: 'team',
        subject: 'Test',
        description: null,
        ownerHandle: 'agent',
        ownerUid: 'a'.repeat(24),
        createdByHandle: 'lead',
        createdByUid: 'b'.repeat(24),
        status: 'open',
        blockedBy: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const debug = storage.getDebugInfo();

      expect(debug.users).toHaveLength(1);
      expect(debug.chats).toHaveLength(1);
      expect(debug.tasks).toHaveLength(1);
      expect(debug.messageCount).toBe(0);
    });
  });
});
