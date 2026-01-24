/**
 * Tests for Zod validation schemas
 */

import { describe, it, expect } from 'vitest';
import {
  agentRegistrationSchema,
  createTaskSchema,
  createChatSchema,
  sendMessageSchema,
  spawnWorkerSchema,
  createWorkItemSchema,
  sendMailSchema,
  validateBody,
} from './schemas.js';

describe('Validation Schemas', () => {
  describe('agentRegistrationSchema', () => {
    it('accepts valid registration', () => {
      const result = agentRegistrationSchema.safeParse({
        handle: 'my-agent',
        teamName: 'dev-team',
        agentType: 'worker',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.handle).toBe('my-agent');
        expect(result.data.teamName).toBe('dev-team');
        expect(result.data.agentType).toBe('worker');
      }
    });

    it('defaults agentType to worker', () => {
      const result = agentRegistrationSchema.safeParse({
        handle: 'my-agent',
        teamName: 'dev-team',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentType).toBe('worker');
      }
    });

    it('rejects empty handle', () => {
      const result = agentRegistrationSchema.safeParse({
        handle: '',
        teamName: 'dev-team',
      });
      expect(result.success).toBe(false);
    });

    it('rejects handle with invalid characters', () => {
      const result = agentRegistrationSchema.safeParse({
        handle: 'my agent!',
        teamName: 'dev-team',
      });
      expect(result.success).toBe(false);
    });

    it('rejects handle over 50 chars', () => {
      const result = agentRegistrationSchema.safeParse({
        handle: 'a'.repeat(51),
        teamName: 'dev-team',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid agentType', () => {
      const result = agentRegistrationSchema.safeParse({
        handle: 'my-agent',
        teamName: 'dev-team',
        agentType: 'admin',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createTaskSchema', () => {
    const validTask = {
      fromUid: 'a'.repeat(24),
      toHandle: 'worker-1',
      teamName: 'dev-team',
      subject: 'Implement feature X',
    };

    it('accepts valid task', () => {
      const result = createTaskSchema.safeParse(validTask);
      expect(result.success).toBe(true);
    });

    it('accepts task with description', () => {
      const result = createTaskSchema.safeParse({
        ...validTask,
        description: 'Detailed description here',
      });
      expect(result.success).toBe(true);
    });

    it('accepts task with blockedBy', () => {
      const result = createTaskSchema.safeParse({
        ...validTask,
        blockedBy: ['550e8400-e29b-41d4-a716-446655440000'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects subject under 3 chars', () => {
      const result = createTaskSchema.safeParse({
        ...validTask,
        subject: 'ab',
      });
      expect(result.success).toBe(false);
    });

    it('rejects subject over 200 chars', () => {
      const result = createTaskSchema.safeParse({
        ...validTask,
        subject: 'a'.repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid UID format', () => {
      const result = createTaskSchema.safeParse({
        ...validTask,
        fromUid: 'invalid-uid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createChatSchema', () => {
    it('accepts valid chat creation', () => {
      const result = createChatSchema.safeParse({
        uid1: 'a'.repeat(24),
        uid2: 'b'.repeat(24),
      });
      expect(result.success).toBe(true);
    });

    it('rejects same uid for both participants', () => {
      const uid = 'a'.repeat(24);
      const result = createChatSchema.safeParse({
        uid1: uid,
        uid2: uid,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid UID format', () => {
      const result = createChatSchema.safeParse({
        uid1: 'short',
        uid2: 'b'.repeat(24),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('sendMessageSchema', () => {
    it('accepts valid message', () => {
      const result = sendMessageSchema.safeParse({
        from: 'a'.repeat(24),
        text: 'Hello, world!',
      });
      expect(result.success).toBe(true);
    });

    it('accepts message with metadata', () => {
      const result = sendMessageSchema.safeParse({
        from: 'a'.repeat(24),
        text: 'Hello',
        metadata: { taskId: '123', urgent: true },
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty text', () => {
      const result = sendMessageSchema.safeParse({
        from: 'a'.repeat(24),
        text: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects text over 50000 chars', () => {
      const result = sendMessageSchema.safeParse({
        from: 'a'.repeat(24),
        text: 'a'.repeat(50001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('spawnWorkerSchema', () => {
    it('accepts valid worker spawn', () => {
      const result = spawnWorkerSchema.safeParse({
        handle: 'worker-1',
      });
      expect(result.success).toBe(true);
    });

    it('accepts worker with all options', () => {
      const result = spawnWorkerSchema.safeParse({
        handle: 'worker-1',
        teamName: 'dev-team',
        workingDir: '/path/to/project',
        initialPrompt: 'Start working on the API',
        sessionId: 'session-123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid handle', () => {
      const result = spawnWorkerSchema.safeParse({
        handle: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createWorkItemSchema', () => {
    it('accepts valid work item', () => {
      const result = createWorkItemSchema.safeParse({
        title: 'Implement user auth',
      });
      expect(result.success).toBe(true);
    });

    it('accepts work item with all fields', () => {
      const result = createWorkItemSchema.safeParse({
        title: 'Implement user auth',
        description: 'Add JWT-based authentication',
        assignedTo: 'worker-1',
        batchId: 'batch-123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty title', () => {
      const result = createWorkItemSchema.safeParse({
        title: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects title over 200 chars', () => {
      const result = createWorkItemSchema.safeParse({
        title: 'a'.repeat(201),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('sendMailSchema', () => {
    it('accepts valid mail', () => {
      const result = sendMailSchema.safeParse({
        from: 'alice',
        to: 'bob',
        body: 'Hello Bob!',
      });
      expect(result.success).toBe(true);
    });

    it('accepts mail with subject', () => {
      const result = sendMailSchema.safeParse({
        from: 'alice',
        to: 'bob',
        body: 'Hello Bob!',
        subject: 'Greetings',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty body', () => {
      const result = sendMailSchema.safeParse({
        from: 'alice',
        to: 'bob',
        body: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('validateBody helper', () => {
    it('returns success with typed data', () => {
      const result = validateBody(agentRegistrationSchema, {
        handle: 'agent-1',
        teamName: 'team-1',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.handle).toBe('agent-1');
      }
    });

    it('returns formatted error message', () => {
      const result = validateBody(agentRegistrationSchema, {
        handle: '',
        teamName: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('handle');
      }
    });
  });
});
