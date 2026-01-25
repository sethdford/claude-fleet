/**
 * Task Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskStore } from './task.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { setDatabasePath, resetDatabase } from '../database.js';

describe('TaskStore', () => {
  let store: TaskStore;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `cct-task-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
    store = new TaskStore();
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

  describe('create()', () => {
    it('creates a new task', () => {
      const task = store.create({
        id: 'task-1',
        title: 'Test Task',
      });

      expect(task.id).toBe('task-1');
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe(3);
      expect(task.createdAt).toBeDefined();
    });

    it('creates task with all optional fields', () => {
      const task = store.create({
        id: 'task-2',
        title: 'Full Task',
        description: 'Detailed description',
        status: 'in_progress',
        priority: 1,
        assignedTo: 'worker-1',
        createdBy: 'coordinator',
        dueAt: Date.now() + 86400000,
      });

      expect(task.description).toBe('Detailed description');
      expect(task.status).toBe('in_progress');
      expect(task.priority).toBe(1);
      expect(task.assignedTo).toBe('worker-1');
      expect(task.createdBy).toBe('coordinator');
      expect(task.dueAt).toBeDefined();
    });
  });

  describe('get()', () => {
    it('retrieves task by ID', () => {
      store.create({ id: 'get-test', title: 'Test' });

      const task = store.get('get-test');
      expect(task).toBeDefined();
      expect(task?.id).toBe('get-test');
    });

    it('returns undefined for non-existent task', () => {
      const task = store.get('nonexistent');
      expect(task).toBeUndefined();
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      store.create({ id: 't1', title: 'Task 1', status: 'pending', priority: 2 });
      store.create({ id: 't2', title: 'Task 2', status: 'in_progress', priority: 1, assignedTo: 'worker-1' });
      store.create({ id: 't3', title: 'Task 3', status: 'completed', priority: 3 });
      store.create({ id: 't4', title: 'Task 4', status: 'pending', priority: 1, assignedTo: 'worker-2' });
    });

    it('lists all tasks', () => {
      const tasks = store.list();
      expect(tasks.length).toBe(4);
    });

    it('filters by status', () => {
      const pending = store.list({ status: 'pending' });
      expect(pending.length).toBe(2);
    });

    it('filters by multiple statuses', () => {
      const tasks = store.list({ status: ['pending', 'in_progress'] });
      expect(tasks.length).toBe(3);
    });

    it('filters by assignedTo', () => {
      const tasks = store.list({ assignedTo: 'worker-1' });
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe('Task 2');
    });

    it('filters by priority', () => {
      const highPriority = store.list({ priority: 1 });
      expect(highPriority.length).toBe(2);
    });

    it('respects limit', () => {
      const tasks = store.list({ limit: 2 });
      expect(tasks.length).toBe(2);
    });

    it('respects offset', () => {
      store.list(); // Verify full list works
      const offset = store.list({ offset: 2 });
      expect(offset.length).toBe(2);
    });

    it('orders by priority then created_at', () => {
      const tasks = store.list();
      expect(tasks[0].priority).toBeLessThanOrEqual(tasks[1].priority);
    });
  });

  describe('getUnassigned()', () => {
    beforeEach(() => {
      store.create({ id: 't1', title: 'Unassigned 1', priority: 2 });
      store.create({ id: 't2', title: 'Unassigned 2', priority: 1 });
      store.create({ id: 't3', title: 'Assigned', assignedTo: 'worker-1' });
      store.create({ id: 't4', title: 'Completed', status: 'completed' });
    });

    it('gets unassigned pending tasks', () => {
      const tasks = store.getUnassigned();
      expect(tasks.length).toBe(2);
    });

    it('filters by priority threshold', () => {
      const tasks = store.getUnassigned({ priority: 1 });
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe('Unassigned 2');
    });

    it('respects limit', () => {
      const tasks = store.getUnassigned({ limit: 1 });
      expect(tasks.length).toBe(1);
    });
  });

  describe('assign()', () => {
    it('assigns task to worker', () => {
      store.create({ id: 'assign-test', title: 'Test' });

      const success = store.assign('assign-test', 'worker-1');
      expect(success).toBe(true);

      const task = store.get('assign-test');
      expect(task?.assignedTo).toBe('worker-1');
      expect(task?.status).toBe('in_progress');
    });

    it('returns false if already assigned to different worker', () => {
      store.create({ id: 'double-assign', title: 'Test', assignedTo: 'worker-1' });

      const success = store.assign('double-assign', 'worker-2');
      expect(success).toBe(false);
    });

    it('allows same worker to re-assign', () => {
      store.create({ id: 'same-assign', title: 'Test', assignedTo: 'worker-1' });

      const success = store.assign('same-assign', 'worker-1');
      expect(success).toBe(true);
    });
  });

  describe('updateStatus()', () => {
    it('updates task status', () => {
      store.create({ id: 'status-test', title: 'Test' });

      store.updateStatus('status-test', 'in_progress');

      const task = store.get('status-test');
      expect(task?.status).toBe('in_progress');
    });

    it('sets completedAt when completed', () => {
      store.create({ id: 'complete-test', title: 'Test' });

      store.updateStatus('complete-test', 'completed');

      const task = store.get('complete-test');
      expect(task?.completedAt).toBeDefined();
    });

    it('sets completedAt when cancelled', () => {
      store.create({ id: 'cancel-test', title: 'Test' });

      store.updateStatus('cancel-test', 'cancelled');

      const task = store.get('cancel-test');
      expect(task?.completedAt).toBeDefined();
    });
  });

  describe('update()', () => {
    it('updates task fields', () => {
      store.create({ id: 'update-test', title: 'Original' });

      store.update('update-test', {
        title: 'Updated',
        description: 'New description',
        priority: 1,
      });

      const task = store.get('update-test');
      expect(task?.title).toBe('Updated');
      expect(task?.description).toBe('New description');
      expect(task?.priority).toBe(1);
    });

    it('handles partial updates', () => {
      store.create({ id: 'partial-test', title: 'Test', description: 'Original' });

      store.update('partial-test', { title: 'New Title' });

      const task = store.get('partial-test');
      expect(task?.title).toBe('New Title');
      expect(task?.description).toBe('Original');
    });
  });

  describe('delete()', () => {
    it('deletes a task', () => {
      store.create({ id: 'delete-test', title: 'Test' });

      const result = store.delete('delete-test');
      expect(result).toBe(true);
      expect(store.get('delete-test')).toBeUndefined();
    });

    it('returns false for non-existent task', () => {
      const result = store.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getOverdue()', () => {
    it('gets overdue tasks', () => {
      const now = Date.now();
      store.create({ id: 'overdue', title: 'Overdue', dueAt: now - 86400000 });
      store.create({ id: 'future', title: 'Future', dueAt: now + 86400000 });
      store.create({ id: 'no-due', title: 'No Due Date' });
      store.create({ id: 'completed', title: 'Completed Overdue', dueAt: now - 86400000, status: 'completed' });

      const overdue = store.getOverdue();
      expect(overdue.length).toBe(1);
      expect(overdue[0].id).toBe('overdue');
    });

    it('orders by due date', () => {
      const now = Date.now();
      store.create({ id: 'later', title: 'Later', dueAt: now - 3600000 });
      store.create({ id: 'earlier', title: 'Earlier', dueAt: now - 86400000 });

      const overdue = store.getOverdue();
      expect(overdue[0].id).toBe('earlier');
      expect(overdue[1].id).toBe('later');
    });
  });
});
