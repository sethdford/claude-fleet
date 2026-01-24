/**
 * Storage Factory Tests
 *
 * Tests the storage abstraction layer and factory pattern.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStorage, getStorageConfigFromEnv } from '../src/storage/factory.js';
import { SQLiteStorageAdapter } from '../src/storage/adapters/sqlite-adapter.js';
import type { IStorage } from '../src/storage/interfaces.js';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DB_PATH = path.join(process.cwd(), 'test-storage-factory.db');

describe('Storage Factory', () => {
  afterEach(() => {
    // Clean up test database
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.unlinkSync(TEST_DB_PATH + '-shm');
      fs.unlinkSync(TEST_DB_PATH + '-wal');
    } catch {
      // Files may not exist
    }
  });

  describe('createStorage', () => {
    it('creates SQLite storage with default config', async () => {
      const storage = await createStorage({
        backend: 'sqlite',
        path: TEST_DB_PATH,
      });

      expect(storage).toBeInstanceOf(SQLiteStorageAdapter);
      expect(storage.team).toBeDefined();
      expect(storage.worker).toBeDefined();
      expect(storage.workItem).toBeDefined();
      expect(storage.mail).toBeDefined();
      expect(storage.blackboard).toBeDefined();
      expect(storage.checkpoint).toBeDefined();
      expect(storage.spawnQueue).toBeDefined();
      expect(storage.tldr).toBeDefined();

      await storage.close();
    });

    it('throws for unknown backend', async () => {
      await expect(
        createStorage({ backend: 'unknown' as 'sqlite', path: '' })
      ).rejects.toThrow('Unknown storage backend');
    });
  });

  describe('getStorageConfigFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('defaults to sqlite', () => {
      delete process.env.STORAGE_BACKEND;
      const config = getStorageConfigFromEnv();
      expect(config.backend).toBe('sqlite');
    });

    it('returns sqlite config', () => {
      process.env.STORAGE_BACKEND = 'sqlite';
      process.env.DB_PATH = '/custom/path.db';

      const config = getStorageConfigFromEnv();
      expect(config.backend).toBe('sqlite');
      expect((config as { path: string }).path).toBe('/custom/path.db');
    });

    it('returns dynamodb config', () => {
      process.env.STORAGE_BACKEND = 'dynamodb';
      process.env.AWS_REGION = 'eu-west-1';
      process.env.DYNAMODB_TABLE_PREFIX = 'myapp_';

      const config = getStorageConfigFromEnv();
      expect(config.backend).toBe('dynamodb');
      expect((config as { region: string }).region).toBe('eu-west-1');
      expect((config as { tablePrefix: string }).tablePrefix).toBe('myapp_');
    });

    it('returns s3 config', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_BUCKET = 'my-bucket';
      process.env.AWS_REGION = 'us-west-2';
      process.env.S3_PREFIX = 'fleet/';

      const config = getStorageConfigFromEnv();
      expect(config.backend).toBe('s3');
      expect((config as { bucket: string }).bucket).toBe('my-bucket');
      expect((config as { prefix: string }).prefix).toBe('fleet/');
    });

    it('returns firestore config', () => {
      process.env.STORAGE_BACKEND = 'firestore';
      process.env.GOOGLE_CLOUD_PROJECT = 'my-project';

      const config = getStorageConfigFromEnv();
      expect(config.backend).toBe('firestore');
      expect((config as { projectId: string }).projectId).toBe('my-project');
    });

    it('returns postgresql config', () => {
      process.env.STORAGE_BACKEND = 'postgresql';
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
      process.env.POSTGRESQL_POOL_SIZE = '20';

      const config = getStorageConfigFromEnv();
      expect(config.backend).toBe('postgresql');
      expect((config as { connectionString: string }).connectionString).toBe(
        'postgres://user:pass@localhost:5432/db'
      );
      expect((config as { poolSize: number }).poolSize).toBe(20);
    });

    it('falls back to sqlite for unknown backend', () => {
      process.env.STORAGE_BACKEND = 'invalid';
      const config = getStorageConfigFromEnv();
      expect(config.backend).toBe('sqlite');
    });
  });
});

describe('SQLiteStorageAdapter', () => {
  let storage: IStorage;

  beforeEach(async () => {
    storage = await createStorage({
      backend: 'sqlite',
      path: TEST_DB_PATH,
    });
  });

  afterEach(async () => {
    await storage.close();
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.unlinkSync(TEST_DB_PATH + '-shm');
      fs.unlinkSync(TEST_DB_PATH + '-wal');
    } catch {
      // Files may not exist
    }
  });

  describe('Team Storage', () => {
    it('creates and retrieves users', async () => {
      const user = {
        uid: 'test-uid-1',
        handle: 'alice',
        teamName: 'alpha',
        agentType: 'worker' as const,
        createdAt: new Date().toISOString(),
        lastSeen: null,
      };

      await storage.team.insertUser(user);
      const retrieved = await storage.team.getUser('test-uid-1');

      expect(retrieved).toMatchObject({
        uid: 'test-uid-1',
        handle: 'alice',
        teamName: 'alpha',
      });
    });

    it('lists users by team', async () => {
      await storage.team.insertUser({
        uid: 'u1',
        handle: 'alice',
        teamName: 'alpha',
        agentType: 'worker',
        createdAt: new Date().toISOString(),
        lastSeen: null,
      });
      await storage.team.insertUser({
        uid: 'u2',
        handle: 'bob',
        teamName: 'alpha',
        agentType: 'worker',
        createdAt: new Date().toISOString(),
        lastSeen: null,
      });
      await storage.team.insertUser({
        uid: 'u3',
        handle: 'charlie',
        teamName: 'beta',
        agentType: 'team-lead',
        createdAt: new Date().toISOString(),
        lastSeen: null,
      });

      const alphaUsers = await storage.team.getUsersByTeam('alpha');
      expect(alphaUsers).toHaveLength(2);
      expect(alphaUsers.map(u => u.handle)).toContain('alice');
      expect(alphaUsers.map(u => u.handle)).toContain('bob');
    });

    it('creates and retrieves chats', async () => {
      const chat = {
        id: 'chat-1',
        participants: ['alice', 'bob'],
        isTeamChat: false,
        teamName: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.team.insertChat(chat);
      const retrieved = await storage.team.getChat('chat-1');

      expect(retrieved).toMatchObject({
        id: 'chat-1',
        participants: ['alice', 'bob'],
      });
    });

    it('creates and retrieves messages', async () => {
      // Create chat first
      await storage.team.insertChat({
        id: 'chat-msg-test',
        participants: ['alice', 'bob'],
        isTeamChat: false,
        teamName: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await storage.team.insertMessage({
        id: 'msg-1',
        chatId: 'chat-msg-test',
        fromHandle: 'alice',
        fromUid: 'uid-alice',
        text: 'Hello world!',
        timestamp: new Date().toISOString(),
        status: 'pending',
        metadata: {},
      });

      const messages = await storage.team.getMessages('chat-msg-test', 10);
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello world!');
    });
  });

  describe('Worker Storage', () => {
    it('inserts and retrieves workers', async () => {
      const id = await storage.worker.insertWorker({
        handle: 'worker-1',
        status: 'pending',
        worktreePath: null,
        worktreeBranch: null,
        pid: null,
        sessionId: null,
        initialPrompt: 'Test prompt',
        lastHeartbeat: null,
        restartCount: 0,
        role: 'worker',
        swarmId: null,
        depthLevel: 1,
        createdAt: Date.now(),
        dismissedAt: null,
      });

      expect(id).toBeDefined();

      const worker = await storage.worker.getWorker(id);
      expect(worker).toBeDefined();
      expect(worker?.handle).toBe('worker-1');
      expect(worker?.status).toBe('pending');
    });

    it('gets worker by handle', async () => {
      await storage.worker.insertWorker({
        handle: 'unique-handle',
        status: 'active',
        worktreePath: null,
        worktreeBranch: null,
        pid: 1234,
        sessionId: 'sess-1',
        initialPrompt: 'Prompt',
        lastHeartbeat: Date.now(),
        restartCount: 0,
        role: 'worker',
        swarmId: null,
        depthLevel: 1,
        createdAt: Date.now(),
        dismissedAt: null,
      });

      const worker = await storage.worker.getWorkerByHandle('unique-handle');
      expect(worker).toBeDefined();
      expect(worker?.pid).toBe(1234);
    });

    it('updates worker status', async () => {
      const id = await storage.worker.insertWorker({
        handle: 'status-test',
        status: 'pending',
        worktreePath: null,
        worktreeBranch: null,
        pid: null,
        sessionId: null,
        initialPrompt: 'Prompt',
        lastHeartbeat: null,
        restartCount: 0,
        role: 'worker',
        swarmId: null,
        depthLevel: 1,
        createdAt: Date.now(),
        dismissedAt: null,
      });

      await storage.worker.updateWorkerStatus(id, 'active');
      const worker = await storage.worker.getWorker(id);
      expect(worker?.status).toBe('active');
    });
  });

  describe('Work Item Storage', () => {
    it('creates and retrieves work items', async () => {
      const item = await storage.workItem.createWorkItem('Test Task', {
        description: 'A test task description',
      });

      expect(item.id).toBeDefined();
      expect(item.title).toBe('Test Task');
      expect(item.status).toBe('pending');

      const retrieved = await storage.workItem.getWorkItem(item.id);
      expect(retrieved).toMatchObject({
        title: 'Test Task',
        description: 'A test task description',
      });
    });

    it('assigns work items', async () => {
      const item = await storage.workItem.createWorkItem('Assignable Task');

      await storage.workItem.assignWorkItem(item.id, 'worker-handle');

      const updated = await storage.workItem.getWorkItem(item.id);
      expect(updated?.assignedTo).toBe('worker-handle');
      expect(updated?.status).toBe('in_progress');
    });

    it('creates batches', async () => {
      const batch = await storage.workItem.createBatch('Test Batch');

      expect(batch.id).toBeDefined();
      expect(batch.name).toBe('Test Batch');
      expect(batch.status).toBe('open');
    });

    it('tracks work item events', async () => {
      const item = await storage.workItem.createWorkItem('Eventful Task');

      await storage.workItem.addWorkItemEvent(item.id, 'comment', 'alice', 'Great progress!');

      const events = await storage.workItem.getWorkItemEvents(item.id);
      expect(events.length).toBeGreaterThanOrEqual(2); // created + comment
      expect(events.some(e => e.eventType === 'comment')).toBe(true);
    });
  });

  describe('Mail Storage', () => {
    it('sends and retrieves mail', async () => {
      const mail = await storage.mail.sendMail('alice', 'bob', 'Hello Bob!', 'Greeting');

      expect(mail.id).toBeDefined();
      expect(mail.fromHandle).toBe('alice');
      expect(mail.toHandle).toBe('bob');

      const inbox = await storage.mail.getMail('bob');
      expect(inbox.length).toBeGreaterThan(0);
      expect(inbox[0].body).toBe('Hello Bob!');
    });

    it('tracks unread mail', async () => {
      await storage.mail.sendMail('alice', 'charlie', 'Message 1');
      await storage.mail.sendMail('bob', 'charlie', 'Message 2');

      const unread = await storage.mail.getUnreadMail('charlie');
      expect(unread).toHaveLength(2);
    });

    it('marks mail as read', async () => {
      const mail = await storage.mail.sendMail('alice', 'dave', 'Read me');

      await storage.mail.markMailRead(mail.id);

      const unread = await storage.mail.getUnreadMail('dave');
      expect(unread).toHaveLength(0);
    });
  });

  describe('Blackboard Storage', () => {
    it('posts and retrieves messages', async () => {
      const msg = await storage.blackboard.postMessage(
        'swarm-1',
        'lead-agent',
        'directive',
        { action: 'start', target: 'worker-1' }
      );

      expect(msg.id).toBeDefined();
      expect(msg.swarmId).toBe('swarm-1');

      const messages = storage.blackboard.readMessages('swarm-1');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].messageType).toBe('directive');
    });

    it('marks messages as read', async () => {
      const msg = await storage.blackboard.postMessage(
        'swarm-2',
        'sender',
        'status',
        { progress: 50 }
      );

      await storage.blackboard.markRead([msg.id], 'reader-agent');

      const unreadCount = await storage.blackboard.getUnreadCount('swarm-2', 'reader-agent');
      expect(unreadCount).toBe(0);
    });
  });

  describe('Spawn Queue Storage', () => {
    it('enqueues spawn requests', async () => {
      const item = await storage.spawnQueue.enqueue({
        requesterHandle: 'lead',
        targetAgentType: 'researcher',
        depthLevel: 1,
        swarmId: 'swarm-1',
        priority: 'normal',
        payload: { task: 'Research topic X' },
        dependsOn: [],
      });

      expect(item.id).toBeDefined();
      expect(item.status).toBe('pending');
      expect(item.targetAgentType).toBe('researcher');
    });

    it('gets ready items', async () => {
      await storage.spawnQueue.enqueue({
        requesterHandle: 'lead',
        targetAgentType: 'worker',
        depthLevel: 1,
        swarmId: null,
        priority: 'high',
        payload: { task: 'Important task' },
        dependsOn: [],
      });

      const ready = await storage.spawnQueue.getReadyItems(10);
      expect(ready.length).toBeGreaterThan(0);
    });

    it('provides queue stats', async () => {
      const stats = await storage.spawnQueue.getQueueStats();

      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('approved');
      expect(stats).toHaveProperty('spawned');
      expect(stats).toHaveProperty('rejected');
    });
  });

  describe('TLDR Storage', () => {
    it('stores and retrieves file summaries', async () => {
      await storage.tldr.storeFileSummary(
        '/src/index.ts',
        'abc123',
        'Main entry point for the application',
        {
          exports: ['main', 'Config'],
          language: 'typescript',
          lineCount: 150,
        }
      );

      const summary = await storage.tldr.getFileSummary('/src/index.ts');
      expect(summary).toBeDefined();
      expect(summary?.summary).toContain('entry point');
      expect(summary?.exports).toContain('main');
    });

    it('checks if summary is current', async () => {
      await storage.tldr.storeFileSummary('/src/utils.ts', 'hash1', 'Utils');

      const isCurrent = await storage.tldr.isSummaryCurrent('/src/utils.ts', 'hash1');
      expect(isCurrent).toBe(true);

      const isOutdated = await storage.tldr.isSummaryCurrent('/src/utils.ts', 'hash2');
      expect(isOutdated).toBe(false);
    });

    it('stores codebase overviews', async () => {
      await storage.tldr.storeCodebaseOverview('/project', 'MyProject', {
        description: 'A test project',
        techStack: ['TypeScript', 'Node.js'],
        keyFiles: ['src/index.ts', 'package.json'],
      });

      const overview = await storage.tldr.getCodebaseOverview('/project');
      expect(overview).toBeDefined();
      expect(overview?.name).toBe('MyProject');
      expect(overview?.techStack).toContain('TypeScript');
    });
  });

  describe('Health Check', () => {
    it('reports healthy status', async () => {
      const healthy = await storage.isHealthy();
      expect(healthy).toBe(true);
    });
  });
});
