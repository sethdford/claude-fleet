/**
 * Validation Schema Tests
 */

import { describe, it, expect } from 'vitest';
import {
  sessionIdSchema,
  handleSchema,
  workerStatusSchema,
  workerRoleSchema,
  taskStatusSchema,
  taskPrioritySchema,
  spawnWorkerSchema,
  createTaskSchema,
  safetyCheckSchema,
  validateBody,
} from './validation.js';

describe('sessionIdSchema', () => {
  it('accepts valid session IDs', () => {
    expect(sessionIdSchema.parse('abc123')).toBe('abc123');
    expect(sessionIdSchema.parse('a')).toBe('a');
    expect(sessionIdSchema.parse('a'.repeat(100))).toBe('a'.repeat(100));
  });

  it('rejects empty strings', () => {
    expect(() => sessionIdSchema.parse('')).toThrow();
  });

  it('rejects strings over 100 chars', () => {
    expect(() => sessionIdSchema.parse('a'.repeat(101))).toThrow();
  });
});

describe('handleSchema', () => {
  it('accepts valid handles', () => {
    expect(handleSchema.parse('worker1')).toBe('worker1');
    expect(handleSchema.parse('my-worker')).toBe('my-worker');
    expect(handleSchema.parse('Worker_2')).toBe('Worker_2');
  });

  it('rejects handles starting with number', () => {
    expect(() => handleSchema.parse('1worker')).toThrow();
  });

  it('rejects handles with special characters', () => {
    expect(() => handleSchema.parse('worker@1')).toThrow();
    expect(() => handleSchema.parse('work.er')).toThrow();
  });

  it('rejects empty handles', () => {
    expect(() => handleSchema.parse('')).toThrow();
  });
});

describe('workerStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(workerStatusSchema.parse('pending')).toBe('pending');
    expect(workerStatusSchema.parse('ready')).toBe('ready');
    expect(workerStatusSchema.parse('busy')).toBe('busy');
    expect(workerStatusSchema.parse('error')).toBe('error');
    expect(workerStatusSchema.parse('dismissed')).toBe('dismissed');
  });

  it('rejects invalid statuses', () => {
    expect(() => workerStatusSchema.parse('invalid')).toThrow();
    expect(() => workerStatusSchema.parse('READY')).toThrow();
  });
});

describe('workerRoleSchema', () => {
  it('accepts all valid roles', () => {
    const roles = [
      'coordinator', 'worker', 'scout', 'kraken', 'oracle',
      'critic', 'architect', 'merger', 'monitor', 'notifier'
    ];
    for (const role of roles) {
      expect(workerRoleSchema.parse(role)).toBe(role);
    }
  });

  it('rejects invalid roles', () => {
    expect(() => workerRoleSchema.parse('manager')).toThrow();
  });
});

describe('taskStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(taskStatusSchema.parse('pending')).toBe('pending');
    expect(taskStatusSchema.parse('in_progress')).toBe('in_progress');
    expect(taskStatusSchema.parse('completed')).toBe('completed');
    expect(taskStatusSchema.parse('cancelled')).toBe('cancelled');
  });
});

describe('taskPrioritySchema', () => {
  it('accepts valid priorities 1-5', () => {
    for (let i = 1; i <= 5; i++) {
      expect(taskPrioritySchema.parse(i)).toBe(i);
    }
  });

  it('rejects priorities outside 1-5', () => {
    expect(() => taskPrioritySchema.parse(0)).toThrow();
    expect(() => taskPrioritySchema.parse(6)).toThrow();
    expect(() => taskPrioritySchema.parse(-1)).toThrow();
  });

  it('rejects non-integers', () => {
    expect(() => taskPrioritySchema.parse(1.5)).toThrow();
  });
});

describe('spawnWorkerSchema', () => {
  it('accepts valid spawn config', () => {
    const result = spawnWorkerSchema.parse({
      handle: 'myWorker',
      role: 'worker',
      prompt: 'Do something',
      worktree: true,
    });
    expect(result.handle).toBe('myWorker');
    expect(result.role).toBe('worker');
  });

  it('applies defaults', () => {
    const result = spawnWorkerSchema.parse({ handle: 'myWorker' });
    expect(result.role).toBe('worker');
    expect(result.worktree).toBe(true);
  });

  it('rejects missing handle', () => {
    expect(() => spawnWorkerSchema.parse({})).toThrow();
  });
});

describe('createTaskSchema', () => {
  it('accepts valid task', () => {
    const result = createTaskSchema.parse({
      title: 'My Task',
      description: 'Do something',
      priority: 2,
    });
    expect(result.title).toBe('My Task');
    expect(result.priority).toBe(2);
  });

  it('applies default priority', () => {
    const result = createTaskSchema.parse({ title: 'My Task' });
    expect(result.priority).toBe(3);
  });

  it('rejects empty title', () => {
    expect(() => createTaskSchema.parse({ title: '' })).toThrow();
  });

  it('rejects title over 500 chars', () => {
    expect(() => createTaskSchema.parse({ title: 'a'.repeat(501) })).toThrow();
  });
});

describe('safetyCheckSchema', () => {
  it('accepts valid safety check', () => {
    const result = safetyCheckSchema.parse({
      operation: 'bash_command',
      command: 'ls -la',
    });
    expect(result.operation).toBe('bash_command');
    expect(result.command).toBe('ls -la');
  });

  it('accepts file operations', () => {
    const result = safetyCheckSchema.parse({
      operation: 'file_write',
      filePath: '/tmp/test.txt',
      content: 'hello',
    });
    expect(result.operation).toBe('file_write');
  });

  it('rejects invalid operations', () => {
    expect(() => safetyCheckSchema.parse({
      operation: 'invalid_op',
    })).toThrow();
  });
});

describe('validateBody', () => {
  it('returns success for valid data', () => {
    const result = validateBody(handleSchema, 'validHandle');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('validHandle');
    }
  });

  it('returns error for invalid data', () => {
    const result = validateBody(handleSchema, '123invalid');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Handle must start with a letter');
    }
  });
});
