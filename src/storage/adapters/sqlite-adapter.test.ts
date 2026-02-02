/**
 * Integration Tests for SQLite Storage Adapter
 *
 * Uses an in-memory SQLite database to test the full round-trip
 * of the adapter layer delegation to the real SQLiteStorage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteStorageAdapter } from './sqlite-adapter.js';
import { SQLiteStorage } from '../sqlite.js';
import type { TeamAgent, Chat, Message, TeamTask, PersistentWorker, Checkpoint } from '../../types.js';
import type { SwarmTemplate } from '../../types.js';

// Suppress console.log from storage initialization
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper factories ──────────────────────────────────────────────
function makeUser(overrides: Partial<TeamAgent> & { uid: string; handle: string; teamName: string }): TeamAgent {
  return {
    agentType: 'worker',
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    ...overrides,
  };
}

function makeChat(overrides: Partial<Chat> & { id: string; participants: string[] }): Chat {
  return {
    isTeamChat: false,
    teamName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> & { id: string; chatId: string }): Message {
  return {
    fromHandle: 'sender',
    fromUid: 'uid-sender',
    text: 'hello',
    timestamp: new Date().toISOString(),
    status: 'pending',
    metadata: {},
    ...overrides,
  };
}

function makeTask(overrides: Partial<TeamTask> & { id: string; teamName: string }): TeamTask {
  return {
    subject: 'Default subject',
    description: null,
    ownerHandle: null,
    ownerUid: null,
    createdByHandle: 'admin',
    createdByUid: 'uid-admin',
    status: 'open',
    blockedBy: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWorker(overrides: Partial<Omit<PersistentWorker, 'id'>> & { handle: string }): Omit<PersistentWorker, 'id'> {
  return {
    status: 'pending',
    worktreePath: null,
    worktreeBranch: null,
    pid: null,
    sessionId: null,
    initialPrompt: null,
    lastHeartbeat: Date.now(),
    restartCount: 0,
    role: 'worker',
    swarmId: null,
    depthLevel: 0,
    createdAt: Date.now(),
    dismissedAt: null,
    spawnMode: 'process',
    paneId: null,
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<Checkpoint> & { goal: string }): Checkpoint {
  return {
    now: 'Working',
    test: 'npm test',
    doneThisSession: [],
    blockers: [],
    questions: [],
    worked: [],
    failed: [],
    next: [],
    files: { created: [], modified: [] },
    ...overrides,
  };
}

describe('SQLiteStorageAdapter', () => {
  let adapter: SQLiteStorageAdapter;

  beforeEach(async () => {
    adapter = new SQLiteStorageAdapter(':memory:');
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
  });

  // ======================================================================
  // LIFECYCLE
  // ======================================================================

  describe('lifecycle', () => {
    it('should construct and initialize', () => {
      expect(adapter).toBeDefined();
      expect(adapter.team).toBeDefined();
      expect(adapter.worker).toBeDefined();
      expect(adapter.workItem).toBeDefined();
      expect(adapter.mail).toBeDefined();
      expect(adapter.blackboard).toBeDefined();
      expect(adapter.checkpoint).toBeDefined();
      expect(adapter.spawnQueue).toBeDefined();
      expect(adapter.tldr).toBeDefined();
    });

    it('should report healthy', async () => {
      await expect(adapter.isHealthy()).resolves.toBe(true);
    });

    it('should provide raw spawn queue', () => {
      const raw = adapter.getRawSpawnQueue();
      expect(raw).toBeDefined();
    });
  });

  // ======================================================================
  // TEAM STORAGE
  // ======================================================================

  describe('team storage', () => {
    it('should initialize and close without error', async () => {
      await expect(adapter.team.initialize()).resolves.toBeUndefined();
      await expect(adapter.team.close()).resolves.toBeUndefined();
    });

    it('should insert and get user', async () => {
      await adapter.team.insertUser(makeUser({ uid: 'user-1', handle: 'worker-1', teamName: 'team-a' }));
      const result = await adapter.team.getUser('user-1');
      expect(result).not.toBeNull();
      expect(result!.handle).toBe('worker-1');
    });

    it('should get users by team', async () => {
      await adapter.team.insertUser(makeUser({ uid: 'user-2', handle: 'worker-2', teamName: 'team-a' }));
      const users = await adapter.team.getUsersByTeam('team-a');
      expect(users.length).toBeGreaterThanOrEqual(1);
    });

    it('should update user last seen', async () => {
      await adapter.team.insertUser(makeUser({ uid: 'user-3', handle: 'worker-3', teamName: 'team-b', lastSeen: '2024-01-01T00:00:00Z' }));
      const newTime = '2024-06-01T00:00:00Z';
      await adapter.team.updateUserLastSeen('user-3', newTime);
      const result = await adapter.team.getUser('user-3');
      expect(result!.lastSeen).toBe(newTime);
    });

    it('should handle updateUserLastSeen for nonexistent user', async () => {
      // Should not throw
      await adapter.team.updateUserLastSeen('nonexistent', new Date().toISOString());
    });

    it('should insert and get chat', async () => {
      await adapter.team.insertChat(makeChat({ id: 'chat-1', participants: ['user-a', 'user-b'] }));
      const result = await adapter.team.getChat('chat-1');
      expect(result).not.toBeNull();
    });

    it('should get chats by user', async () => {
      await adapter.team.insertChat(makeChat({ id: 'chat-2', participants: ['user-c', 'user-d'] }));
      const chats = await adapter.team.getChatsByUser('user-c');
      expect(chats.length).toBeGreaterThanOrEqual(1);
    });

    it('should update chat time', async () => {
      await adapter.team.insertChat(makeChat({ id: 'chat-3', participants: ['user-e'], updatedAt: '2024-01-01T00:00:00Z' }));
      await adapter.team.updateChatTime('chat-3', '2024-06-01T00:00:00Z');
    });

    it('should insert and get messages', async () => {
      await adapter.team.insertChat(makeChat({ id: 'chat-msg', participants: ['u1', 'u2'] }));
      await adapter.team.insertMessage(makeMessage({ id: 'msg-1', chatId: 'chat-msg', fromUid: 'u1', text: 'Hello' }));
      const messages = await adapter.team.getMessages('chat-msg', 50);
      expect(messages.length).toBe(1);
    });

    it('should get messages after timestamp', async () => {
      await adapter.team.insertChat(makeChat({ id: 'chat-after', participants: ['u1'] }));

      await adapter.team.insertMessage(makeMessage({
        id: 'msg-old', chatId: 'chat-after', fromUid: 'u1', text: 'Old', timestamp: '2024-01-01T00:00:00Z',
      }));
      await adapter.team.insertMessage(makeMessage({
        id: 'msg-new', chatId: 'chat-after', fromUid: 'u1', text: 'New', timestamp: '2024-06-01T00:00:00Z',
      }));

      const msgs = await adapter.team.getMessagesAfter('chat-after', '2024-03-01T00:00:00Z', 50);
      expect(msgs.length).toBe(1);
      expect(msgs[0].text).toBe('New');
    });

    it('should get message count', async () => {
      const count = await adapter.team.getMessageCount();
      expect(typeof count).toBe('number');
    });

    it('should manage unread counts', async () => {
      await adapter.team.insertChat(makeChat({ id: 'chat-unread', participants: ['u1', 'u2'] }));

      await adapter.team.setUnread('chat-unread', 'u1', 5);
      const count = await adapter.team.getUnread('chat-unread', 'u1');
      expect(count).toBe(5);

      await adapter.team.incrementUnread('chat-unread', 'u1');
      const count2 = await adapter.team.getUnread('chat-unread', 'u1');
      expect(count2).toBe(6);

      await adapter.team.clearUnread('chat-unread', 'u1');
      const count3 = await adapter.team.getUnread('chat-unread', 'u1');
      expect(count3).toBe(0);
    });

    it('should insert and get tasks', async () => {
      await adapter.team.insertTask(makeTask({
        id: 'task-1', teamName: 'team-a', subject: 'Fix bug', description: 'Fix the login bug', ownerHandle: 'worker-1',
      }));
      const result = await adapter.team.getTask('task-1');
      expect(result).not.toBeNull();
      expect(result!.subject).toBe('Fix bug');
    });

    it('should get tasks by team', async () => {
      await adapter.team.insertTask(makeTask({ id: 'task-2', teamName: 'team-b', subject: 'Add feature' }));
      const tasks = await adapter.team.getTasksByTeam('team-b');
      expect(tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should update task status', async () => {
      await adapter.team.insertTask(makeTask({ id: 'task-3', teamName: 'team-c', subject: 'Task to update' }));
      await adapter.team.updateTaskStatus('task-3', 'resolved', new Date().toISOString());
      const result = await adapter.team.getTask('task-3');
      expect(result!.status).toBe('resolved');
    });

    it('should get debug info', async () => {
      const debug = await adapter.team.getDebugInfo();
      expect(debug).toHaveProperty('users');
      expect(debug).toHaveProperty('chats');
      expect(debug).toHaveProperty('messageCount');
      expect(debug).toHaveProperty('tasks');
    });

    it('should report healthy via isHealthy', async () => {
      await expect(adapter.team.isHealthy()).resolves.toBe(true);
    });
  });

  // ======================================================================
  // WORKER STORAGE
  // ======================================================================

  describe('worker storage', () => {
    it('should initialize and close without error', async () => {
      await expect(adapter.worker.initialize()).resolves.toBeUndefined();
      await expect(adapter.worker.close()).resolves.toBeUndefined();
    });

    it('should insert and get worker', async () => {
      const id = await adapter.worker.insertWorker(makeWorker({ handle: 'worker-alpha', initialPrompt: 'Test task' }));
      expect(id).toBeDefined();

      const worker = await adapter.worker.getWorker(id);
      expect(worker).not.toBeNull();
      expect(worker!.handle).toBe('worker-alpha');
    });

    it('should get worker by handle', async () => {
      await adapter.worker.insertWorker(makeWorker({
        handle: 'worker-beta', status: 'ready', role: 'coordinator', initialPrompt: 'Fix stuff', pid: 1234, sessionId: 'sess-1',
      }));

      const worker = await adapter.worker.getWorkerByHandle('worker-beta');
      expect(worker).not.toBeNull();
      expect(worker!.role).toBe('coordinator');
    });

    it('should get all workers', async () => {
      const workers = await adapter.worker.getAllWorkers();
      expect(Array.isArray(workers)).toBe(true);
    });

    it('should get active workers', async () => {
      const workers = await adapter.worker.getActiveWorkers();
      expect(Array.isArray(workers)).toBe(true);
    });

    it('should get workers by swarm', async () => {
      const workers = await adapter.worker.getWorkersBySwarm('swarm-1');
      expect(Array.isArray(workers)).toBe(true);
    });

    it('should update worker status', async () => {
      const id = await adapter.worker.insertWorker(makeWorker({ handle: 'worker-status' }));
      await adapter.worker.updateWorkerStatus(id, 'ready');
      const worker = await adapter.worker.getWorker(id);
      expect(worker!.status).toBe('ready');
    });

    it('should update worker heartbeat', async () => {
      const id = await adapter.worker.insertWorker(makeWorker({ handle: 'worker-hb', lastHeartbeat: 1000 }));
      const newTime = Date.now();
      await adapter.worker.updateWorkerHeartbeat(id, newTime);
      const worker = await adapter.worker.getWorker(id);
      expect(worker!.lastHeartbeat).toBe(newTime);
    });

    it('should update worker pid', async () => {
      const id = await adapter.worker.insertWorker(makeWorker({ handle: 'worker-pid' }));
      await adapter.worker.updateWorkerPid(id, 5678, 'session-abc');
    });

    it('should update worker worktree', async () => {
      const id = await adapter.worker.insertWorker(makeWorker({ handle: 'worker-wt' }));
      await adapter.worker.updateWorkerWorktree(id, '/path/to/wt', 'feature-branch');
      const worker = await adapter.worker.getWorker(id);
      expect(worker!.worktreePath).toBe('/path/to/wt');
      expect(worker!.worktreeBranch).toBe('feature-branch');
    });

    it('should handle updateWorkerWorktree for nonexistent worker', async () => {
      await adapter.worker.updateWorkerWorktree('nonexistent', '/path', 'branch');
    });

    it('should dismiss worker', async () => {
      const id = await adapter.worker.insertWorker(makeWorker({ handle: 'worker-dismiss', status: 'ready' }));
      await adapter.worker.dismissWorker(id, Date.now());
      const worker = await adapter.worker.getWorker(id);
      expect(worker!.status).toBe('dismissed');
    });

    it('should delete worker by handle', async () => {
      await adapter.worker.insertWorker(makeWorker({ handle: 'worker-delete' }));
      await adapter.worker.deleteWorkerByHandle('worker-delete');
      const worker = await adapter.worker.getWorkerByHandle('worker-delete');
      expect(worker).toBeNull();
    });
  });

  // ======================================================================
  // WORK ITEM STORAGE
  // ======================================================================

  describe('work item storage', () => {
    it('should initialize and close without error', async () => {
      await expect(adapter.workItem.initialize()).resolves.toBeUndefined();
      await expect(adapter.workItem.close()).resolves.toBeUndefined();
    });

    it('should create and get work item', async () => {
      const item = await adapter.workItem.createWorkItem('Test item');
      expect(item.id).toBeDefined();
      expect(item.title).toBe('Test item');
      expect(item.status).toBe('pending');

      const found = await adapter.workItem.getWorkItem(item.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Test item');
    });

    it('should create work item with options', async () => {
      const item = await adapter.workItem.createWorkItem('With desc', {
        description: 'A description',
        assignedTo: 'worker-1',
      });
      expect(item.description).toBe('A description');
      expect(item.assignedTo).toBe('worker-1');
    });

    it('should list work items', async () => {
      await adapter.workItem.createWorkItem('Item A');
      await adapter.workItem.createWorkItem('Item B');
      const items = await adapter.workItem.listWorkItems();
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it('should list work items by status', async () => {
      const item = await adapter.workItem.createWorkItem('Filtered');
      await adapter.workItem.updateWorkItemStatus(item.id, 'completed');
      const completed = await adapter.workItem.listWorkItems({ status: 'completed' });
      expect(completed.some(i => i.id === item.id)).toBe(true);
    });

    it('should list work items by assignee', async () => {
      const item = await adapter.workItem.createWorkItem('Assigned', { assignedTo: 'test-worker' });
      const items = await adapter.workItem.listWorkItems({ assignedTo: 'test-worker' });
      expect(items.some(i => i.id === item.id)).toBe(true);
    });

    it('should list work items with limit', async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.workItem.createWorkItem(`Limited ${i}`);
      }
      const items = await adapter.workItem.listWorkItems({ limit: 2 });
      expect(items.length).toBe(2);
    });

    it('should update work item status', async () => {
      const item = await adapter.workItem.createWorkItem('To update');
      await adapter.workItem.updateWorkItemStatus(item.id, 'in_progress', 'worker-1');
      const found = await adapter.workItem.getWorkItem(item.id);
      expect(found!.status).toBe('in_progress');
    });

    it('should map status to correct event types', async () => {
      const item = await adapter.workItem.createWorkItem('Events test');
      await adapter.workItem.updateWorkItemStatus(item.id, 'completed');
      await adapter.workItem.updateWorkItemStatus(item.id, 'blocked');
      await adapter.workItem.updateWorkItemStatus(item.id, 'cancelled');
      const events = await adapter.workItem.getWorkItemEvents(item.id);
      const types = events.map(e => e.eventType);
      expect(types).toContain('created');
      expect(types).toContain('completed');
      expect(types).toContain('blocked');
      expect(types).toContain('cancelled');
    });

    it('should assign work item', async () => {
      const item = await adapter.workItem.createWorkItem('To assign');
      await adapter.workItem.assignWorkItem(item.id, 'worker-xyz');
      const found = await adapter.workItem.getWorkItem(item.id);
      expect(found!.assignedTo).toBe('worker-xyz');
    });

    it('should create and get batch', async () => {
      const batch = await adapter.workItem.createBatch('Test Batch');
      expect(batch.id).toBeDefined();
      expect(batch.name).toBe('Test Batch');
      expect(batch.status).toBe('open');

      const found = await adapter.workItem.getBatch(batch.id);
      expect(found).not.toBeNull();
    });

    it('should create batch with work item ids', async () => {
      const item = await adapter.workItem.createWorkItem('Batch item');
      const batch = await adapter.workItem.createBatch('With items', [item.id]);
      const items = await adapter.workItem.listWorkItems({ batchId: batch.id });
      expect(items.some(i => i.id === item.id)).toBe(true);
    });

    it('should list batches', async () => {
      await adapter.workItem.createBatch('Batch A');
      await adapter.workItem.createBatch('Batch B');
      const batches = await adapter.workItem.listBatches();
      expect(batches.length).toBeGreaterThanOrEqual(2);
    });

    it('should list batches by status', async () => {
      const batch = await adapter.workItem.createBatch('Status batch');
      await adapter.workItem.updateBatchStatus(batch.id, 'completed');
      const completed = await adapter.workItem.listBatches({ status: 'completed' });
      expect(completed.some(b => b.id === batch.id)).toBe(true);
    });

    it('should list batches with limit', async () => {
      const batches = await adapter.workItem.listBatches({ limit: 1 });
      expect(batches.length).toBeLessThanOrEqual(1);
    });

    it('should dispatch batch', async () => {
      const item = await adapter.workItem.createWorkItem('Dispatch item');
      const batch = await adapter.workItem.createBatch('Dispatch batch', [item.id]);
      const result = await adapter.workItem.dispatchBatch(batch.id);
      expect(result.dispatchedCount).toBe(1);
    });

    it('should add and get work item events', async () => {
      const item = await adapter.workItem.createWorkItem('Event item');
      await adapter.workItem.addWorkItemEvent(item.id, 'comment', 'actor-1', 'Some details');
      const events = await adapter.workItem.getWorkItemEvents(item.id);
      expect(events.some(e => e.eventType === 'comment')).toBe(true);
    });
  });

  // ======================================================================
  // MAIL STORAGE
  // ======================================================================

  describe('mail storage', () => {
    it('should initialize and close without error', async () => {
      await expect(adapter.mail.initialize()).resolves.toBeUndefined();
      await expect(adapter.mail.close()).resolves.toBeUndefined();
    });

    it('should send and get mail', async () => {
      const mail = await adapter.mail.sendMail('sender-1', 'receiver-1', 'Hello!');
      expect(mail.id).toBeDefined();
      expect(mail.fromHandle).toBe('sender-1');

      const mails = await adapter.mail.getMail('receiver-1');
      expect(mails.some(m => m.id === mail.id)).toBe(true);
    });

    it('should send mail with subject', async () => {
      const mail = await adapter.mail.sendMail('s1', 'r1', 'Body', 'Subject');
      expect(mail.subject).toBe('Subject');
    });

    it('should get unread mail', async () => {
      await adapter.mail.sendMail('s2', 'r2', 'Unread mail');
      const unread = await adapter.mail.getUnreadMail('r2');
      expect(unread.length).toBeGreaterThanOrEqual(1);
    });

    it('should get mail with unreadOnly option', async () => {
      await adapter.mail.sendMail('s3', 'r3', 'Another mail');
      const unread = await adapter.mail.getMail('r3', { unreadOnly: true });
      expect(unread.length).toBeGreaterThanOrEqual(1);
    });

    it('should get mail with limit', async () => {
      await adapter.mail.sendMail('s4', 'r4', 'Mail 1');
      await adapter.mail.sendMail('s4', 'r4', 'Mail 2');
      const mails = await adapter.mail.getMail('r4', { limit: 1 });
      expect(mails.length).toBeLessThanOrEqual(1);
    });

    it('should mark mail as read', async () => {
      const mail = await adapter.mail.sendMail('s5', 'r5', 'To read');
      await adapter.mail.markMailRead(mail.id);
      const unread = await adapter.mail.getUnreadMail('r5');
      expect(unread.some(m => m.id === mail.id)).toBe(false);
    });

    it('should create and get handoff', async () => {
      const handoff = await adapter.mail.createHandoff('from-1', 'to-1', { key: 'value' });
      expect(handoff.id).toBeDefined();
      expect(handoff.fromHandle).toBe('from-1');

      const handoffs = await adapter.mail.getHandoffs('to-1');
      expect(handoffs.length).toBeGreaterThanOrEqual(1);
    });

    it('should get pending handoffs', async () => {
      await adapter.mail.createHandoff('from-2', 'to-2', {});
      const pending = await adapter.mail.getHandoffs('to-2', { pendingOnly: true });
      expect(pending.length).toBeGreaterThanOrEqual(1);
    });

    it('should accept handoff', async () => {
      const handoff = await adapter.mail.createHandoff('from-3', 'to-3', {});
      await adapter.mail.acceptHandoff(handoff.id);
    });
  });

  // ======================================================================
  // BLACKBOARD STORAGE
  // ======================================================================

  describe('blackboard storage', () => {
    it('should initialize and close without error', async () => {
      await expect(adapter.blackboard.initialize()).resolves.toBeUndefined();
      await expect(adapter.blackboard.close()).resolves.toBeUndefined();
    });

    it('should post and read messages', () => {
      adapter.insertSwarm({ id: 'bb-swarm', name: 'BB Test' });
      const msg = adapter.blackboard.postMessage('bb-swarm', 'sender-1', 'status', { data: 'test' });
      expect(msg.id).toBeDefined();

      const messages = adapter.blackboard.readMessages('bb-swarm');
      expect(messages.some(m => m.id === msg.id)).toBe(true);
    });

    it('should get message by id', () => {
      adapter.insertSwarm({ id: 'bb-swarm-2', name: 'BB Test 2' });
      const msg = adapter.blackboard.postMessage('bb-swarm-2', 'sender-2', 'response', { value: 42 });
      const found = adapter.blackboard.getMessage(msg.id);
      expect(found).not.toBeNull();
    });

    it('should mark messages as read', () => {
      adapter.insertSwarm({ id: 'bb-swarm-3', name: 'BB Test 3' });
      const msg = adapter.blackboard.postMessage('bb-swarm-3', 'sender-3', 'status', {});
      adapter.blackboard.markRead([msg.id], 'reader-1');

      const unread = adapter.blackboard.getUnreadCount('bb-swarm-3', 'reader-1');
      expect(unread).toBe(0);
    });

    it('should archive messages', () => {
      adapter.insertSwarm({ id: 'bb-swarm-4', name: 'BB Test 4' });
      const msg = adapter.blackboard.postMessage('bb-swarm-4', 'sender-4', 'status', {});
      adapter.blackboard.archiveMessage(msg.id);
    });

    it('should archive multiple messages', () => {
      adapter.insertSwarm({ id: 'bb-swarm-5', name: 'BB Test 5' });
      const msg1 = adapter.blackboard.postMessage('bb-swarm-5', 's5', 'status', {});
      const msg2 = adapter.blackboard.postMessage('bb-swarm-5', 's5', 'status', {});
      adapter.blackboard.archiveMessages([msg1.id, msg2.id]);
    });

    it('should archive old messages', () => {
      adapter.insertSwarm({ id: 'bb-swarm-6', name: 'BB Test 6' });
      const count = adapter.blackboard.archiveOldMessages('bb-swarm-6', 1000);
      expect(typeof count).toBe('number');
    });

    it('should read messages with options', () => {
      adapter.insertSwarm({ id: 'bb-swarm-7', name: 'BB Test 7' });
      adapter.blackboard.postMessage('bb-swarm-7', 'sender-7', 'status', {});
      const messages = adapter.blackboard.readMessages('bb-swarm-7', {
        messageType: 'status',
        limit: 10,
      });
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ======================================================================
  // CHECKPOINT STORAGE
  // ======================================================================

  describe('checkpoint storage', () => {
    it('should initialize and close without error', async () => {
      await expect(adapter.checkpoint.initialize()).resolves.toBeUndefined();
      await expect(adapter.checkpoint.close()).resolves.toBeUndefined();
    });

    it('should create and load checkpoint', () => {
      const cp = adapter.checkpoint.createCheckpoint('from-1', 'to-1', makeCheckpoint({
        goal: 'Fix the bug', now: 'Investigating',
      }));
      expect(cp.id).toBeDefined();

      const loaded = adapter.checkpoint.loadCheckpoint(cp.id);
      expect(loaded).not.toBeNull();
    });

    it('should create checkpoint with all optional fields', () => {
      const cp = adapter.checkpoint.createCheckpoint('from-2', 'to-2', makeCheckpoint({
        goal: 'Full checkpoint',
        test: 'test cmd',
        doneThisSession: [{ task: 'step 1', files: ['a.ts'] }],
        blockers: ['blocker 1'],
        questions: ['q1'],
        worked: ['thing 1'],
        failed: ['thing 2'],
        next: ['next step'],
        files: { created: ['a.ts'], modified: ['b.ts'] },
      }));
      expect(cp.id).toBeDefined();
    });

    it('should load latest checkpoint for handle', () => {
      adapter.checkpoint.createCheckpoint('from-latest', 'to-latest', makeCheckpoint({ goal: 'Latest' }));
      const latest = adapter.checkpoint.loadLatestCheckpoint('to-latest');
      expect(latest).not.toBeNull();
    });

    it('should list checkpoints', () => {
      adapter.checkpoint.createCheckpoint('lister', 'target', makeCheckpoint({ goal: 'List test' }));
      const checkpoints = adapter.checkpoint.listCheckpoints('lister');
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    });

    it('should accept checkpoint', () => {
      const cp = adapter.checkpoint.createCheckpoint('from-a', 'to-a', makeCheckpoint({ goal: 'Accept', now: 'Done' }));
      const result = adapter.checkpoint.acceptCheckpoint(cp.id);
      expect(result).toBe(true);
    });

    it('should reject checkpoint', () => {
      const cp = adapter.checkpoint.createCheckpoint('from-r', 'to-r', makeCheckpoint({ goal: 'Reject', now: 'Failed' }));
      const result = adapter.checkpoint.rejectCheckpoint(cp.id);
      expect(result).toBe(true);
    });
  });

  // ======================================================================
  // SPAWN QUEUE STORAGE
  // ======================================================================

  describe('spawn queue storage', () => {
    it('should initialize and close without error', async () => {
      await expect(adapter.spawnQueue.initialize()).resolves.toBeUndefined();
      await expect(adapter.spawnQueue.close()).resolves.toBeUndefined();
    });

    it('should enqueue and get item', async () => {
      const item = await adapter.spawnQueue.enqueue({
        requesterHandle: 'requester-1',
        targetAgentType: 'fixer',
        depthLevel: 0,
        priority: 'normal',
        swarmId: null,
        dependsOn: [],
        payload: { task: 'Fix the bug', context: {}, checkpoint: {} },
      });
      expect(item.id).toBeDefined();

      const found = await adapter.spawnQueue.getItem(item.id);
      expect(found).not.toBeNull();
    });

    it('should get pending items', async () => {
      const pending = await adapter.spawnQueue.getPendingItems();
      expect(Array.isArray(pending)).toBe(true);
    });

    it('should get ready items', async () => {
      const ready = await adapter.spawnQueue.getReadyItems(10);
      expect(Array.isArray(ready)).toBe(true);
    });

    it('should update status to approved', async () => {
      const item = await adapter.spawnQueue.enqueue({
        requesterHandle: 'req-2',
        targetAgentType: 'worker',
        depthLevel: 0,
        priority: 'normal',
        swarmId: null,
        dependsOn: [],
        payload: { task: 'Test', context: {}, checkpoint: {} },
      });
      await adapter.spawnQueue.updateStatus(item.id, 'approved');
      const found = await adapter.spawnQueue.getItem(item.id);
      expect(found!.status).toBe('approved');
    });

    it('should update status to rejected', async () => {
      const item = await adapter.spawnQueue.enqueue({
        requesterHandle: 'req-3',
        targetAgentType: 'worker',
        depthLevel: 0,
        priority: 'normal',
        swarmId: null,
        dependsOn: [],
        payload: { task: 'Test', context: {}, checkpoint: {} },
      });
      await adapter.spawnQueue.updateStatus(item.id, 'rejected');
    });

    it('should update status to spawned', async () => {
      const item = await adapter.spawnQueue.enqueue({
        requesterHandle: 'req-4',
        targetAgentType: 'worker',
        depthLevel: 0,
        priority: 'normal',
        swarmId: null,
        dependsOn: [],
        payload: { task: 'Test', context: {}, checkpoint: {} },
      });
      await adapter.spawnQueue.updateStatus(item.id, 'approved');
      await adapter.spawnQueue.updateStatus(item.id, 'spawned', 'worker-spawned-1');
    });

    it('should cancel item', async () => {
      const item = await adapter.spawnQueue.enqueue({
        requesterHandle: 'req-5',
        targetAgentType: 'worker',
        depthLevel: 0,
        priority: 'normal',
        swarmId: null,
        dependsOn: [],
        payload: { task: 'Cancel me', context: {}, checkpoint: {} },
      });
      await adapter.spawnQueue.cancelItem(item.id);
    });

    it('should get queue stats', async () => {
      const stats = await adapter.spawnQueue.getQueueStats();
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('approved');
      expect(stats).toHaveProperty('spawned');
      expect(stats).toHaveProperty('rejected');
      expect(stats).toHaveProperty('blocked');
    });
  });

  // ======================================================================
  // TLDR STORAGE
  // ======================================================================

  describe('TLDR storage', () => {
    it('should initialize and close without error', async () => {
      await expect(adapter.tldr.initialize()).resolves.toBeUndefined();
      await expect(adapter.tldr.close()).resolves.toBeUndefined();
    });

    it('should store and get file summary', () => {
      adapter.tldr.storeFileSummary('src/main.ts', 'hash123', 'Entry point for the app');
      const summary = adapter.tldr.getFileSummary('src/main.ts');
      expect(summary).not.toBeNull();
      expect(summary!.summary).toBe('Entry point for the app');
    });

    it('should store file summary with options', () => {
      adapter.tldr.storeFileSummary('src/utils.ts', 'hash456', 'Utility functions', {
        exports: ['foo', 'bar'],
        imports: ['lodash'],
        dependencies: ['src/types.ts'],
        lineCount: 100,
        language: 'typescript',
      });
      const summary = adapter.tldr.getFileSummary('src/utils.ts');
      expect(summary).not.toBeNull();
    });

    it('should get multiple file summaries', () => {
      adapter.tldr.storeFileSummary('a.ts', 'h1', 'File A');
      adapter.tldr.storeFileSummary('b.ts', 'h2', 'File B');
      const summaries = adapter.tldr.getFileSummaries(['a.ts', 'b.ts']);
      expect(summaries.length).toBe(2);
    });

    it('should check if summary is current', () => {
      adapter.tldr.storeFileSummary('current.ts', 'hash789', 'Current file');
      expect(adapter.tldr.isSummaryCurrent('current.ts', 'hash789')).toBe(true);
      expect(adapter.tldr.isSummaryCurrent('current.ts', 'different-hash')).toBe(false);
    });

    it('should store and get codebase overview', () => {
      adapter.tldr.storeCodebaseOverview('/project', 'My Project', {
        description: 'Test project',
        techStack: ['TypeScript', 'Node.js'],
      });
      const overview = adapter.tldr.getCodebaseOverview('/project');
      expect(overview).not.toBeNull();
      expect(overview!.name).toBe('My Project');
    });

    it('should store and query dependencies', () => {
      adapter.tldr.storeDependency('src/a.ts', 'src/b.ts', 'static');
      adapter.tldr.storeDependency('src/a.ts', 'src/c.ts');
      const graph = adapter.tldr.getDependencyGraph(['src/a.ts']);
      expect(graph.nodes.length).toBeGreaterThan(0);
    });

    it('should get dependents and dependencies', () => {
      adapter.tldr.storeDependency('src/x.ts', 'src/y.ts');
      const deps = adapter.tldr.getDependencies('src/x.ts');
      expect(deps.length).toBeGreaterThanOrEqual(1);

      const dependents = adapter.tldr.getDependents('src/y.ts');
      expect(dependents.length).toBeGreaterThanOrEqual(1);
    });

    it('should invalidate file', () => {
      adapter.tldr.storeFileSummary('invalidate.ts', 'hash', 'To invalidate');
      adapter.tldr.invalidateFile('invalidate.ts');
      const summary = adapter.tldr.getFileSummary('invalidate.ts');
      expect(summary).toBeNull();
    });

    it('should get stats', () => {
      const stats = adapter.tldr.getStats();
      expect(stats).toHaveProperty('files');
      expect(stats).toHaveProperty('codebases');
      expect(stats).toHaveProperty('dependencies');
    });

    it('should clear all data', () => {
      adapter.tldr.storeFileSummary('clear.ts', 'h', 'To clear');
      adapter.tldr.clearAll();
      const summary = adapter.tldr.getFileSummary('clear.ts');
      expect(summary).toBeNull();
    });
  });

  // ======================================================================
  // SWARM STORAGE
  // ======================================================================

  describe('swarm storage', () => {
    it('should insert and get swarm', () => {
      adapter.insertSwarm({ id: 'swarm-test', name: 'Test Swarm' });
      const swarm = adapter.getSwarm('swarm-test');
      expect(swarm).not.toBeNull();
      expect(swarm!.name).toBe('Test Swarm');
    });

    it('should insert swarm with optional fields', () => {
      adapter.insertSwarm({ id: 'swarm-full', name: 'Full', description: 'Desc', maxAgents: 10 });
      const swarm = adapter.getSwarm('swarm-full');
      expect(swarm).not.toBeNull();
    });

    it('should get all swarms', () => {
      adapter.insertSwarm({ id: 'sa', name: 'A' });
      adapter.insertSwarm({ id: 'sb', name: 'B' });
      const swarms = adapter.getAllSwarms();
      expect(swarms.length).toBeGreaterThanOrEqual(2);
    });

    it('should delete swarm', () => {
      adapter.insertSwarm({ id: 'sd', name: 'Delete' });
      adapter.deleteSwarm('sd');
      expect(adapter.getSwarm('sd')).toBeNull();
    });

    it('should return null for nonexistent swarm', () => {
      expect(adapter.getSwarm('nonexistent')).toBeNull();
    });
  });
});

// ============================================================================
// SQLiteStorage Direct Tests (templates, routing history, agent memory)
// ============================================================================

describe('SQLiteStorage direct', () => {
  let storage: SQLiteStorage;

  beforeEach(() => {
    storage = new SQLiteStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  // ── Template CRUD ────────────────────────────────────────────────

  describe('template storage', () => {
    const makeTemplate = (overrides: Partial<SwarmTemplate> & { id: string; name: string }): SwarmTemplate => ({
      description: null,
      isBuiltin: false,
      phases: { discovery: ['analyst'], development: ['dev'], quality: ['qa'], delivery: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    });

    it('should insert and get template', () => {
      const tmpl = makeTemplate({ id: 'tmpl-1', name: 'My Template' });
      storage.insertTemplate(tmpl);
      const result = storage.getTemplate('tmpl-1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('My Template');
      expect(result!.isBuiltin).toBe(false);
    });

    it('should get template by name', () => {
      storage.insertTemplate(makeTemplate({ id: 'tmpl-2', name: 'by-name-test' }));
      const result = storage.getTemplateByName('by-name-test');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('tmpl-2');
    });

    it('should return null for nonexistent template', () => {
      expect(storage.getTemplate('nonexistent')).toBeNull();
      expect(storage.getTemplateByName('nonexistent')).toBeNull();
    });

    it('should get all templates', () => {
      storage.insertTemplate(makeTemplate({ id: 'a1', name: 'T1' }));
      storage.insertTemplate(makeTemplate({ id: 'a2', name: 'T2' }));
      const all = storage.getAllTemplates();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter builtin templates', () => {
      storage.insertTemplate(makeTemplate({ id: 'b1', name: 'Builtin', isBuiltin: true }));
      storage.insertTemplate(makeTemplate({ id: 'u1', name: 'User', isBuiltin: false }));
      const builtins = storage.getAllTemplates({ builtin: true });
      expect(builtins.some(t => t.id === 'b1')).toBe(true);
      expect(builtins.some(t => t.id === 'u1')).toBe(false);

      const users = storage.getAllTemplates({ builtin: false });
      expect(users.some(t => t.id === 'u1')).toBe(true);
    });

    it('should limit template results', () => {
      storage.insertTemplate(makeTemplate({ id: 'l1', name: 'L1' }));
      storage.insertTemplate(makeTemplate({ id: 'l2', name: 'L2' }));
      storage.insertTemplate(makeTemplate({ id: 'l3', name: 'L3' }));
      const limited = storage.getAllTemplates({ limit: 2 });
      expect(limited.length).toBe(2);
    });

    it('should update template', () => {
      storage.insertTemplate(makeTemplate({ id: 'upd-1', name: 'Original' }));
      const updated = storage.updateTemplate('upd-1', { name: 'Updated' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated');
    });

    it('should not update builtin template', () => {
      storage.insertTemplate(makeTemplate({ id: 'bi-1', name: 'Builtin', isBuiltin: true }));
      const result = storage.updateTemplate('bi-1', { name: 'Changed' });
      expect(result).toBeNull();
    });

    it('should return null when updating nonexistent template', () => {
      expect(storage.updateTemplate('nope', { name: 'X' })).toBeNull();
    });

    it('should delete user template', () => {
      storage.insertTemplate(makeTemplate({ id: 'del-1', name: 'Deletable' }));
      const result = storage.deleteTemplate('del-1');
      expect(result).toBe(true);
      expect(storage.getTemplate('del-1')).toBeNull();
    });

    it('should not delete builtin template', () => {
      storage.insertTemplate(makeTemplate({ id: 'bi-2', name: 'Protected', isBuiltin: true }));
      const result = storage.deleteTemplate('bi-2');
      expect(result).toBe(false);
    });

    it('should seed builtin templates', () => {
      storage.seedBuiltinTemplates();
      const builtins = storage.getAllTemplates({ builtin: true });
      expect(builtins.length).toBeGreaterThanOrEqual(3);
      expect(builtins.some(t => t.name === 'feature-development')).toBe(true);
      expect(builtins.some(t => t.name === 'backend-api')).toBe(true);
      expect(builtins.some(t => t.name === 'quick-fix')).toBe(true);
    });

    it('should not duplicate builtin templates on re-seed', () => {
      storage.seedBuiltinTemplates();
      storage.seedBuiltinTemplates();
      const builtins = storage.getAllTemplates({ builtin: true });
      const names = builtins.map(t => t.name);
      const unique = [...new Set(names)];
      expect(names.length).toBe(unique.length);
    });
  });

  // ── Routing History ──────────────────────────────────────────────

  describe('routing history', () => {
    it('should insert and get routing history by task', () => {
      storage.insertRoutingHistory({
        id: 'rh-1',
        taskId: 'task-1',
        complexity: 'high',
        strategy: 'parallel',
        model: 'opus',
        outcome: 'success',
        durationMs: 500,
        createdAt: new Date().toISOString(),
      });
      const history = storage.getRoutingHistoryByTask('task-1');
      expect(history.length).toBe(1);
      expect(history[0].complexity).toBe('high');
    });

    it('should get routing history by complexity', () => {
      storage.insertRoutingHistory({
        id: 'rh-2',
        taskId: null,
        complexity: 'low',
        strategy: 'sequential',
        model: 'haiku',
        outcome: null,
        durationMs: null,
        createdAt: new Date().toISOString(),
      });
      const history = storage.getRoutingHistoryByComplexity('low');
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Agent Memory ─────────────────────────────────────────────────

  describe('agent memory', () => {
    it('should insert and get agent memory', () => {
      const now = new Date().toISOString();
      storage.insertAgentMemory({
        id: 'mem-1',
        agentId: 'agent-1',
        key: 'favorite_color',
        value: 'blue',
        tags: 'preference,color',
        memoryType: 'fact',
        relevance: 0.9,
        accessCount: 0,
        createdAt: now,
        lastAccessed: now,
      });
      const mem = storage.getAgentMemory('mem-1');
      expect(mem).toBeDefined();
      expect(mem!.key).toBe('favorite_color');
    });

    it('should get agent memory by key', () => {
      const now = new Date().toISOString();
      storage.insertAgentMemory({
        id: 'mem-2',
        agentId: 'agent-2',
        key: 'task_context',
        value: 'working on tests',
        tags: null,
        memoryType: 'context',
        relevance: 0.5,
        accessCount: 0,
        createdAt: now,
        lastAccessed: now,
      });
      const mem = storage.getAgentMemoryByKey('agent-2', 'task_context');
      expect(mem).toBeDefined();
      expect(mem!.value).toBe('working on tests');
    });

    it('should return undefined for nonexistent memory', () => {
      expect(storage.getAgentMemory('nonexistent')).toBeUndefined();
      expect(storage.getAgentMemoryByKey('x', 'y')).toBeUndefined();
    });

    it('should search agent memory', () => {
      const now = new Date().toISOString();
      storage.insertAgentMemory({
        id: 'mem-3',
        agentId: 'agent-3',
        key: 'project_goal',
        value: 'Build a REST API for user management',
        tags: 'project,api',
        memoryType: 'goal',
        relevance: 1.0,
        accessCount: 0,
        createdAt: now,
        lastAccessed: now,
      });
      const results = storage.searchAgentMemory('agent-3', 'REST API');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});
