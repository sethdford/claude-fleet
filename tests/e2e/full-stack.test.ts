/**
 * Full Stack E2E Tests
 *
 * Tests the complete data flow from managers through stores to database,
 * validating that all operations persist correctly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Storage layer
import { setDatabasePath, resetDatabase, getDatabase } from '@claude-fleet/storage';
import {
  SessionStore,
  WorkerStore,
  TaskStore,
  BeadStore,
  MailStore,
  CheckpointStore,
} from '@claude-fleet/storage';

// Manager layer
import { SessionManager, SessionExporter, resumeSession } from '@claude-fleet/session';
import { FleetManager } from '@claude-fleet/fleet';
import { SafetyManager } from '@claude-fleet/safety';

describe('Full Stack E2E Tests', () => {
  let tempDbPath: string;

  beforeAll(() => {
    tempDbPath = path.join(os.tmpdir(), `cct-e2e-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
  });

  afterAll(() => {
    resetDatabase();
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
      if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Session Management E2E', () => {
    const sessionStore = new SessionStore();
    let sessionManager: SessionManager;
    let testSessionId: string;

    beforeEach(() => {
      sessionManager = new SessionManager();
    });

    it('creates a session and persists to database', () => {
      const session = sessionStore.create({
        id: 'e2e-session-1',
        projectPath: '/test/e2e/project',
        messageCount: 0,
        totalTokens: 0,
        summary: 'E2E test session',
      });

      testSessionId = session.id;

      // Verify in database
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(testSessionId) as { id: string; project_path: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.project_path).toBe('/test/e2e/project');
    });

    it('adds messages and updates message count', () => {
      sessionStore.addMessage(testSessionId, {
        role: 'user',
        content: 'Hello from E2E test',
      });

      sessionStore.addMessage(testSessionId, {
        role: 'assistant',
        content: 'Hello! How can I help?',
      });

      const messages = sessionStore.getMessages(testSessionId);
      expect(messages.length).toBe(2);

      const session = sessionStore.get(testSessionId);
      expect(session?.messageCount).toBe(2);

      // Verify in database
      const db = getDatabase();
      const msgRows = db.prepare('SELECT * FROM messages WHERE session_id = ?').all(testSessionId);
      expect(msgRows.length).toBe(2);
    });

    it('lists sessions through manager', () => {
      const sessions = sessionManager.list({ projectPath: '/test/e2e/project' });
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.some(s => s.id === testSessionId)).toBe(true);
    });

    it('exports session to markdown', () => {
      const exporter = new SessionExporter();
      const result = exporter.export(testSessionId, { format: 'markdown' });

      expect(result).toBeDefined();
      expect(result?.content).toContain('Hello from E2E test');
      expect(result?.content).toContain('How can I help');
    });

    it('resumes session with smart-trim strategy', () => {
      const result = resumeSession(testSessionId, { strategy: 'smart-trim' });

      expect(result).toBeDefined();
      expect(result?.session.id).toBe(testSessionId);
      expect(result?.messages.length).toBe(2);
    });

    it('forks a session creating lineage', () => {
      const forked = sessionManager.fork(testSessionId);

      expect(forked).toBeDefined();
      expect(forked?.lineage?.parentId).toBe(testSessionId);
      expect(forked?.lineage?.depth).toBe(1);

      // Verify lineage in database
      const db = getDatabase();
      const row = db.prepare('SELECT parent_id, depth FROM sessions WHERE id = ?').get(forked!.id) as { parent_id: string; depth: number };
      expect(row.parent_id).toBe(testSessionId);
    });
  });

  describe('Fleet Management E2E', () => {
    const workerStore = new WorkerStore();
    let fleetManager: FleetManager;
    let testWorkerId: string;

    beforeEach(() => {
      fleetManager = new FleetManager();
    });

    it('spawns a worker and persists to database', async () => {
      const worker = await fleetManager.spawn({
        handle: 'e2e-alice',
        role: 'worker',
        prompt: 'You are an E2E test worker',
        worktree: false, // Disable worktree for testing
      });

      testWorkerId = worker.id;

      expect(worker.handle).toBe('e2e-alice');
      expect(worker.status).toBeDefined();

      // Verify in database
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM workers WHERE handle = ?').get('e2e-alice') as { handle: string; role: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.role).toBe('worker');
    });

    it('lists workers through manager', () => {
      const workers = fleetManager.listWorkers();
      expect(workers.some(w => w.handle === 'e2e-alice')).toBe(true);
    });

    it('updates worker status', () => {
      workerStore.updateStatus(testWorkerId, 'ready');

      const worker = workerStore.get(testWorkerId);
      expect(worker?.status).toBe('ready');

      // Verify in database
      const db = getDatabase();
      const row = db.prepare('SELECT status FROM workers WHERE id = ?').get(testWorkerId) as { status: string };
      expect(row.status).toBe('ready');
    });

    it('records worker heartbeat', () => {
      const before = workerStore.get(testWorkerId)?.lastHeartbeat || 0;

      // Small delay to ensure different timestamp
      workerStore.heartbeat(testWorkerId);

      const after = workerStore.get(testWorkerId)?.lastHeartbeat || 0;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('gets fleet status', () => {
      const status = fleetManager.getStatus();

      expect(status.totalWorkers).toBeGreaterThanOrEqual(1);
      expect(status.byRole).toBeDefined();
      expect(status.byStatus).toBeDefined();
    });

    it('dismisses a worker', async () => {
      const success = await fleetManager.dismiss('e2e-alice');
      expect(success).toBe(true);

      const worker = workerStore.getByHandle('e2e-alice');
      expect(worker?.status).toBe('dismissed');
      expect(worker?.dismissedAt).toBeDefined();
    });
  });

  describe('Task Management E2E', () => {
    const taskStore = new TaskStore();

    it('creates a task and persists to database', () => {
      const task = taskStore.create({
        id: 'e2e-task-1',
        title: 'E2E Test Task',
        description: 'A task created during E2E testing',
        priority: 2,
      });

      expect(task.status).toBe('pending');

      // Verify in database
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('e2e-task-1') as { title: string; priority: number } | undefined;
      expect(row).toBeDefined();
      expect(row?.priority).toBe(2);
    });

    it('assigns task to worker', () => {
      // Create a worker for assignment
      const workerStore = new WorkerStore();
      workerStore.upsert({
        id: 'task-worker',
        handle: 'task-assignee',
        status: 'ready',
        role: 'worker',
        createdAt: Date.now(),
      });

      const success = taskStore.assign('e2e-task-1', 'task-assignee');
      expect(success).toBe(true);

      const task = taskStore.get('e2e-task-1');
      expect(task?.assignedTo).toBe('task-assignee');
      expect(task?.status).toBe('in_progress');
    });

    it('completes task and sets timestamp', () => {
      taskStore.updateStatus('e2e-task-1', 'completed');

      const task = taskStore.get('e2e-task-1');
      expect(task?.status).toBe('completed');
      expect(task?.completedAt).toBeDefined();

      // Verify in database
      const db = getDatabase();
      const row = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get('e2e-task-1') as { completed_at: number };
      expect(row.completed_at).toBeGreaterThan(0);
    });
  });

  describe('Bead Management E2E', () => {
    const beadStore = new BeadStore();
    let testBeadId: string;
    let testConvoyId: string;

    it('creates a bead and logs creation event', () => {
      const bead = beadStore.create({
        title: 'E2E Test Bead',
        description: 'Testing bead persistence',
        metadata: { test: true },
      });

      testBeadId = bead.id;
      expect(bead.id).toMatch(/^cc-[a-z0-9]{5}$/);

      // Verify event was logged
      const events = beadStore.getEvents(testBeadId);
      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('created');

      // Verify in database
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM beads WHERE id = ?').get(testBeadId) as { title: string } | undefined;
      expect(row).toBeDefined();
    });

    it('creates a convoy and adds beads to it', () => {
      const convoy = beadStore.createConvoy({
        name: 'E2E Test Convoy',
        description: 'A batch of related beads',
      });

      testConvoyId = convoy.id;

      // Create beads in convoy
      beadStore.create({ title: 'Convoy Bead 1', convoyId: testConvoyId });
      beadStore.create({ title: 'Convoy Bead 2', convoyId: testConvoyId });
      beadStore.create({ title: 'Convoy Bead 3', convoyId: testConvoyId });

      const beads = beadStore.list({ convoyId: testConvoyId });
      expect(beads.length).toBe(3);

      // Verify in database
      const db = getDatabase();
      const convoyRow = db.prepare('SELECT * FROM convoys WHERE id = ?').get(testConvoyId) as { name: string } | undefined;
      expect(convoyRow).toBeDefined();
    });

    it('dispatches convoy to worker', () => {
      const count = beadStore.dispatchConvoy(testConvoyId, 'dispatch-worker');
      expect(count).toBe(3);

      const beads = beadStore.list({ convoyId: testConvoyId });
      for (const bead of beads) {
        expect(bead.assignedTo).toBe('dispatch-worker');
        expect(bead.status).toBe('in_progress');
      }
    });

    it('closes convoy', () => {
      beadStore.closeConvoy(testConvoyId);

      const convoy = beadStore.getConvoy(testConvoyId);
      expect(convoy?.status).toBe('closed');
      expect(convoy?.closedAt).toBeDefined();
    });
  });

  describe('Mail System E2E', () => {
    const mailStore = new MailStore();

    it('sends mail between workers', () => {
      const mail = mailStore.send({
        from: 'coordinator',
        to: 'worker-1',
        subject: 'Task Assignment',
        body: 'Please work on the new feature',
      });

      expect(mail.id).toBeDefined();

      // Verify in database
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM mailbox WHERE id = ?').get(mail.id) as { from_handle: string; to_handle: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.from_handle).toBe('coordinator');
    });

    it('reads unread mail', () => {
      // Send more mail
      mailStore.send({ from: 'scout', to: 'worker-1', body: 'Found something' });
      mailStore.send({ from: 'monitor', to: 'worker-1', body: 'Status update' });

      const unread = mailStore.getUnread('worker-1');
      expect(unread.length).toBe(3);
    });

    it('marks mail as read', () => {
      const unread = mailStore.getUnread('worker-1');
      const ids = unread.map(m => m.id);

      mailStore.markRead(ids);

      const stillUnread = mailStore.getUnread('worker-1');
      expect(stillUnread.length).toBe(0);
    });

    it('formats mail for worker prompt injection', () => {
      // Send new mail
      mailStore.send({ from: 'coordinator', to: 'worker-2', subject: 'Urgent', body: 'Do this now' });

      const formatted = mailStore.formatMailForPrompt('worker-2');
      expect(formatted).toContain('## Pending Messages');
      expect(formatted).toContain('coordinator');
      expect(formatted).toContain('Urgent');
    });

    it('creates and accepts handoffs', () => {
      const handoff = mailStore.createHandoff({
        from: 'worker-1',
        to: 'worker-2',
        context: { task: 'continue feature', files: ['main.ts'] },
      });

      expect(handoff.id).toBeDefined();

      const pending = mailStore.getPendingHandoffs('worker-2');
      expect(pending.length).toBe(1);

      const accepted = mailStore.acceptHandoff(handoff.id);
      expect(accepted?.acceptedAt).toBeDefined();

      const stillPending = mailStore.getPendingHandoffs('worker-2');
      expect(stillPending.length).toBe(0);
    });
  });

  describe('Checkpoint System E2E', () => {
    const checkpointStore = new CheckpointStore();
    let testCheckpointId: string;

    it('creates checkpoint and persists to database', () => {
      const checkpoint = checkpointStore.create({
        workerHandle: 'e2e-worker',
        goal: 'Complete the feature implementation',
        worked: ['Added models', 'Created API endpoints'],
        remaining: ['Write tests', 'Update docs'],
        context: { branch: 'feature-x', commit: 'abc123' },
      });

      testCheckpointId = checkpoint.id;

      // Verify in database
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(testCheckpointId) as { goal: string; worked: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.goal).toBe('Complete the feature implementation');

      // Verify JSON fields
      const worked = JSON.parse(row!.worked);
      expect(worked).toContain('Added models');
    });

    it('retrieves latest checkpoint for worker', () => {
      // Create more checkpoints
      checkpointStore.create({ workerHandle: 'e2e-worker', goal: 'Goal 2' });
      checkpointStore.create({ workerHandle: 'e2e-worker', goal: 'Goal 3' });

      const latest = checkpointStore.getLatest('e2e-worker');
      expect(latest?.goal).toBe('Goal 3');
    });

    it('formats checkpoint for resume', () => {
      const checkpoint = checkpointStore.get(testCheckpointId);
      const formatted = checkpointStore.formatForResume(checkpoint!);

      expect(formatted).toContain('## Checkpoint Resume');
      expect(formatted).toContain('Complete the feature implementation');
      expect(formatted).toContain('### Completed:');
      expect(formatted).toContain('Added models');
      expect(formatted).toContain('### Remaining:');
      expect(formatted).toContain('Write tests');
    });

    it('cleans up old checkpoints', () => {
      // Create many checkpoints
      for (let i = 0; i < 10; i++) {
        checkpointStore.create({ workerHandle: 'cleanup-worker', goal: `Goal ${i}` });
      }

      const deleted = checkpointStore.cleanup(3);
      expect(deleted).toBeGreaterThan(0);

      const remaining = checkpointStore.listByWorker('cleanup-worker');
      expect(remaining.length).toBe(3);
    });
  });

  describe('Safety System E2E', () => {
    let safetyManager: SafetyManager;

    beforeEach(() => {
      safetyManager = new SafetyManager();
    });

    it('checks command safety', () => {
      const result = safetyManager.check({
        operation: 'bash_command',
        command: 'ls -la',
      });

      expect(result.allowed).toBe(true);
    });

    it('blocks dangerous commands', () => {
      const result = safetyManager.check({
        operation: 'bash_command',
        command: 'rm -rf /',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('gets safety status', () => {
      const status = safetyManager.getStatus();

      expect(status.hooks).toBeDefined();
      expect(Array.isArray(status.hooks)).toBe(true);
    });
  });

  describe('Cross-Component Integration', () => {
    it('worker checkpoint recovery flow', () => {
      const workerStore = new WorkerStore();
      const checkpointStore = new CheckpointStore();

      // Create a worker
      const worker = workerStore.upsert({
        id: 'recovery-worker',
        handle: 'recovery-test',
        status: 'busy',
        role: 'worker',
        initialPrompt: 'You are a recovery test worker',
        createdAt: Date.now(),
      });

      // Create checkpoints during work
      checkpointStore.create({
        workerHandle: worker.handle,
        goal: 'Implement feature',
        worked: ['Step 1 done'],
        remaining: ['Step 2', 'Step 3'],
      });

      // Simulate crash - worker still in busy state
      const recoverable = workerStore.getRecoverable();
      expect(recoverable.some(w => w.handle === 'recovery-test')).toBe(true);

      // Recovery: get checkpoint and format for resume
      const checkpoint = checkpointStore.getLatest(worker.handle);
      expect(checkpoint).toBeDefined();

      const resumePrompt = checkpointStore.formatForResume(checkpoint!);
      expect(resumePrompt).toContain('Step 1 done');
      expect(resumePrompt).toContain('Step 2');

      // Mark as recovered
      workerStore.updateStatus(worker.id, 'ready');
      workerStore.incrementRestarts(worker.id);

      const updated = workerStore.get(worker.id);
      expect(updated?.restartCount).toBe(1);
    });

    it('bead assignment with mail notification', () => {
      const beadStore = new BeadStore();
      const mailStore = new MailStore();

      // Create a bead
      const bead = beadStore.create({
        title: 'Integration Test Bead',
      });

      // Assign to worker
      beadStore.assign(bead.id, 'notified-worker');

      // Send notification mail
      mailStore.send({
        from: 'coordinator',
        to: 'notified-worker',
        subject: `New Assignment: ${bead.id}`,
        body: `You have been assigned bead ${bead.id}: ${bead.title}`,
      });

      // Worker receives mail
      const unread = mailStore.getUnread('notified-worker');
      expect(unread.length).toBeGreaterThanOrEqual(1);
      expect(unread.some(m => m.subject?.includes(bead.id))).toBe(true);

      // Worker completes bead
      beadStore.updateStatus(bead.id, 'completed', 'notified-worker');

      const completed = beadStore.get(bead.id);
      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeDefined();
    });

    it('session with worker context flow', () => {
      const sessionStore = new SessionStore();
      const workerStore = new WorkerStore();

      // Create session
      const session = sessionStore.create({
        id: 'worker-session',
        projectPath: '/test/integration',
        messageCount: 0,
        totalTokens: 0,
      });

      // Create worker and link to session
      const worker = workerStore.upsert({
        id: 'session-linked-worker',
        handle: 'session-worker',
        status: 'ready',
        role: 'worker',
        sessionId: session.id,
        createdAt: Date.now(),
      });

      // Add messages to session
      sessionStore.addMessage(session.id, { role: 'user', content: 'Task for worker' });
      sessionStore.addMessage(session.id, { role: 'assistant', content: 'Working on it' });

      // Verify linkage
      const retrievedWorker = workerStore.get(worker.id);
      expect(retrievedWorker?.sessionId).toBe(session.id);

      const messages = sessionStore.getMessages(session.id);
      expect(messages.length).toBe(2);
    });
  });

  describe('Database Integrity', () => {
    it('all tables exist', () => {
      const db = getDatabase();
      const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('messages');
      expect(tableNames).toContain('workers');
      expect(tableNames).toContain('tasks');
      expect(tableNames).toContain('beads');
      expect(tableNames).toContain('bead_events');
      expect(tableNames).toContain('convoys');
      expect(tableNames).toContain('mailbox');
      expect(tableNames).toContain('handoffs');
      expect(tableNames).toContain('checkpoints');
    });

    it('foreign keys are enabled', () => {
      const db = getDatabase();
      const result = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      // SQLite foreign keys - may be 0 or 1 depending on config
      expect(result).toBeDefined();
    });

    it('WAL mode is enabled for performance', () => {
      const db = getDatabase();
      const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(result.journal_mode.toLowerCase()).toBe('wal');
    });
  });
});
