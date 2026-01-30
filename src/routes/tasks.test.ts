/**
 * Tests for task route handlers
 *
 * Covers: createTask, getTask, updateTask
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';

// Mock prometheus metrics to avoid side effects
vi.mock('../metrics/prometheus.js', () => ({
  agentAuthentications: { inc: vi.fn() },
  tasksCreated: { inc: vi.fn() },
  tasksCompleted: { inc: vi.fn() },
}));

// Mock uuid to return predictable values
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('00000000-0000-0000-0000-000000000001'),
}));

import {
  createCreateTaskHandler,
  createGetTaskHandler,
  createUpdateTaskHandler,
} from './tasks.js';

describe('Task Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  // ==========================================================================
  // CreateTask Handler
  // ==========================================================================

  describe('createCreateTaskHandler', () => {
    const validBody = {
      fromUid: 'aabbccddeeff00112233aabb',
      toHandle: 'agent-2',
      teamName: 'test-team',
      subject: 'Implement feature X',
      description: 'Build out the new feature',
    };

    const mockFromUser = {
      uid: 'aabbccddeeff00112233aabb',
      handle: 'agent-1',
      teamName: 'test-team',
      agentType: 'worker' as const,
      createdAt: '2025-01-01T00:00:00Z',
      lastSeen: null,
    };

    const mockToUser = {
      uid: 'bbccddeeff00112233aabbcc',
      handle: 'agent-2',
      teamName: 'test-team',
      agentType: 'worker' as const,
      createdAt: '2025-01-01T00:00:00Z',
      lastSeen: null,
    };

    it('should create task successfully', async () => {
      const broadcastToChat = vi.fn();
      const handler = createCreateTaskHandler(deps, broadcastToChat);
      const req = createMockReq({ body: validBody, method: 'POST' });
      const res = createMockRes();

      (deps.storage.team.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockFromUser);
      (deps.storage.team.getUsersByTeam as ReturnType<typeof vi.fn>).mockResolvedValue([mockFromUser, mockToUser]);
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.subject).toBe('Implement feature X');
      expect(response.ownerHandle).toBe('agent-2');
      expect(response.ownerUid).toBe(mockToUser.uid);
      expect(response.createdByHandle).toBe('agent-1');
      expect(response.createdByUid).toBe(mockFromUser.uid);
      expect(response.status).toBe('open');
      expect(response.teamName).toBe('test-team');

      // Verify task was persisted
      expect(deps.storage.team.insertTask).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Implement feature X',
          ownerHandle: 'agent-2',
          status: 'open',
        })
      );

      // Verify a chat message was sent
      expect(deps.storage.team.insertMessage).toHaveBeenCalled();

      // Verify broadcast was called
      expect(broadcastToChat).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'task_assigned' })
      );
    });

    it('should reject without fromUid', async () => {
      const broadcastToChat = vi.fn();
      const handler = createCreateTaskHandler(deps, broadcastToChat);
      const req = createMockReq({
        body: { toHandle: 'agent-2', teamName: 'test-team', subject: 'Test task' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
      const statusReturn = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturn.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('fromUid') })
      );
    });

    it('should reject without subject', async () => {
      const broadcastToChat = vi.fn();
      const handler = createCreateTaskHandler(deps, broadcastToChat);
      const req = createMockReq({
        body: { fromUid: 'aabbccddeeff00112233aabb', toHandle: 'agent-2', teamName: 'test-team' },
        method: 'POST',
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
      const statusReturn = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturn.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('subject') })
      );
    });
  });

  // ==========================================================================
  // GetTask Handler
  // ==========================================================================

  describe('createGetTaskHandler', () => {
    it('should return task by ID', async () => {
      const handler = createGetTaskHandler(deps);
      const req = createMockReq({ params: { taskId: 'task-123' } });
      const res = createMockRes();

      const mockTask = {
        id: 'task-123',
        teamName: 'test-team',
        subject: 'Test task',
        description: null,
        ownerHandle: 'agent-1',
        ownerUid: 'uid1',
        createdByHandle: 'agent-2',
        createdByUid: 'uid2',
        status: 'open',
        blockedBy: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      (deps.storage.team.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(mockTask);

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('task-123');
      expect(response.subject).toBe('Test task');
      expect(response.status).toBe('open');
    });

    it('should return 404 for missing task', async () => {
      const handler = createGetTaskHandler(deps);
      const req = createMockReq({ params: { taskId: 'nonexistent' } });
      const res = createMockRes();

      (deps.storage.team.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
      const statusReturn = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturn.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Task not found' })
      );
    });
  });

  // ==========================================================================
  // UpdateTask Handler
  // ==========================================================================

  describe('createUpdateTaskHandler', () => {
    it('should update task status', async () => {
      const handler = createUpdateTaskHandler(deps);
      const req = createMockReq({
        params: { taskId: 'task-123' },
        body: { status: 'in_progress' },
        method: 'PUT',
      });
      const res = createMockRes();

      const mockTask = {
        id: 'task-123',
        teamName: 'test-team',
        subject: 'Test task',
        description: null,
        ownerHandle: 'agent-1',
        ownerUid: 'uid1',
        createdByHandle: 'agent-2',
        createdByUid: 'uid2',
        status: 'open',
        blockedBy: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      (deps.storage.team.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(mockTask);

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      // Verify updateTaskStatus was called
      expect(deps.storage.team.updateTaskStatus).toHaveBeenCalledWith(
        'task-123',
        'in_progress',
        expect.any(String)
      );

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.status).toBe('in_progress');
      expect(response.id).toBe('task-123');
    });

    it('should reject invalid status transition blocked by unresolved task', async () => {
      const handler = createUpdateTaskHandler(deps);
      const req = createMockReq({
        params: { taskId: 'task-123' },
        body: { status: 'resolved' },
        method: 'PUT',
      });
      const res = createMockRes();

      const blockerTask = {
        id: 'blocker-task',
        teamName: 'test-team',
        subject: 'Blocker',
        description: null,
        ownerHandle: 'agent-1',
        ownerUid: 'uid1',
        createdByHandle: 'agent-2',
        createdByUid: 'uid2',
        status: 'open', // Not resolved
        blockedBy: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      const mainTask = {
        id: 'task-123',
        teamName: 'test-team',
        subject: 'Main task',
        description: null,
        ownerHandle: 'agent-1',
        ownerUid: 'uid1',
        createdByHandle: 'agent-2',
        createdByUid: 'uid2',
        status: 'in_progress',
        blockedBy: ['blocker-task'],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      // First call returns the main task, second call returns the blocker
      (deps.storage.team.getTask as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mainTask)
        .mockResolvedValueOnce(blockerTask);

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
      const statusReturn = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statusReturn.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Cannot resolve task: blocked by unresolved tasks',
          blockedBy: ['blocker-task'],
        })
      );

      // Verify updateTaskStatus was NOT called
      expect(deps.storage.team.updateTaskStatus).not.toHaveBeenCalled();
    });
  });
});
