/**
 * Tests for chat and work item route handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';

vi.mock('../metrics/prometheus.js', () => ({
  agentAuthentications: { inc: vi.fn() },
  tasksCreated: { inc: vi.fn() },
  tasksCompleted: { inc: vi.fn() },
  messagesSent: { inc: vi.fn() },
  broadcastsSent: { inc: vi.fn() },
  workerSpawns: { inc: vi.fn() },
  workerDismissals: { inc: vi.fn() },
}));

import {
  createGetUserHandler,
  createGetUserChatsHandler,
  createGetTeamAgentsHandler,
  createBroadcastHandler,
  createGetTeamTasksHandler,
  createCreateChatHandler,
  createGetMessagesHandler,
  createSendMessageHandler,
  createMarkReadHandler,
} from './chats.js';

import {
  createCreateWorkItemHandler,
  createListWorkItemsHandler,
  createGetWorkItemHandler,
  createUpdateWorkItemHandler,
  createCreateBatchHandler,
  createListBatchesHandler,
  createGetBatchHandler,
  createDispatchBatchHandler,
} from './workitems.js';

describe('Chat Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('User Handlers', () => {
    it('should get a user by uid', async () => {
      (deps.storage.team.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        uid: 'aabbccdd11223344aabb0001',
        handle: 'agent-1',
        teamName: 'team-1',
      });

      const handler = createGetUserHandler(deps);
      const req = createMockReq({ params: { uid: 'aabbccdd11223344aabb0001' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.handle).toBe('agent-1');
    });

    it('should return 404 for missing user', async () => {
      const handler = createGetUserHandler(deps);
      const req = createMockReq({ params: { uid: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should get user chats with unread counts', async () => {
      (deps.storage.team.getChatsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'chat-1', participants: ['aabbccdd11223344aabb0001', 'aabbccdd11223344aabb0002'], updatedAt: '2025-01-01' },
      ]);
      (deps.storage.team.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      (deps.storage.team.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'msg-1', text: 'hello' },
      ]);

      const handler = createGetUserChatsHandler(deps);
      const req = createMockReq({ params: { uid: 'aabbccdd11223344aabb0001' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveLength(1);
      expect(response[0].unread).toBe(3);
    });
  });

  describe('Team Handlers', () => {
    it('should get team agents', async () => {
      (deps.storage.team.getUsersByTeam as ReturnType<typeof vi.fn>).mockResolvedValue([
        { uid: 'aabbccdd11223344aabb0001', handle: 'agent-1' },
      ]);

      const handler = createGetTeamAgentsHandler(deps);
      const req = createMockReq({ params: { teamName: 'team-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should get team tasks', async () => {
      (deps.storage.team.getTasksByTeam as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 't-1', subject: 'Test task' },
      ]);

      const handler = createGetTeamTasksHandler(deps);
      const req = createMockReq({ params: { teamName: 'team-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });
  });

  describe('Chat Handlers', () => {
    it('should create a chat between two users', async () => {
      (deps.storage.team.getUser as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ uid: 'aabbccdd11223344aabb0001', handle: 'agent-1' })
        .mockResolvedValueOnce({ uid: 'aabbccdd11223344aabb0002', handle: 'agent-2' });

      const handler = createCreateChatHandler(deps);
      const req = createMockReq({
        body: { uid1: 'aabbccdd11223344aabb0001', uid2: 'aabbccdd11223344aabb0002' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('chatId');
    });

    it('should return 404 when user not found in chat creation', async () => {
      (deps.storage.team.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const handler = createCreateChatHandler(deps);
      const req = createMockReq({
        body: { uid1: 'aabbccdd11223344aabb0001', uid2: 'aabbccdd11223344aabb0002' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should get messages from a chat', async () => {
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'chat-1',
        participants: ['aabbccdd11223344aabb0001', 'aabbccdd11223344aabb0002'],
      });
      (deps.storage.team.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'msg-1', text: 'hello' },
      ]);

      const handler = createGetMessagesHandler(deps);
      const req = createMockReq({
        params: { chatId: 'chat-1' },
        query: { limit: '10' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should return 404 for messages from missing chat', async () => {
      const handler = createGetMessagesHandler(deps);
      const req = createMockReq({
        params: { chatId: 'nonexistent' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should send a message to a chat', async () => {
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'chat-1',
        participants: ['aabbccdd11223344aabb0001', 'aabbccdd11223344aabb0002'],
      });
      (deps.storage.team.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        uid: 'aabbccdd11223344aabb0001',
        handle: 'agent-1',
      });

      const broadcastToChat = vi.fn();
      const handler = createSendMessageHandler(deps, broadcastToChat);
      const req = createMockReq({
        params: { chatId: 'chat-1' },
        body: { from: 'aabbccdd11223344aabb0001', text: 'Hello world' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.storage.team.insertMessage).toHaveBeenCalled();
    });

    it('should mark messages as read', async () => {
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'chat-1',
        participants: ['aabbccdd11223344aabb0001'],
      });

      const handler = createMarkReadHandler(deps);
      const req = createMockReq({
        params: { chatId: 'chat-1' },
        body: { uid: 'aabbccdd11223344aabb0001' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should return 400 for mark read with invalid body', async () => {
      const handler = createMarkReadHandler(deps);
      const req = createMockReq({
        params: { chatId: 'chat-1' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for mark read on missing chat', async () => {
      const handler = createMarkReadHandler(deps);
      const req = createMockReq({
        params: { chatId: 'nonexistent' },
        body: { uid: 'aabbccdd11223344aabb0001' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 for create chat with invalid body', async () => {
      const handler = createCreateChatHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when uid2 not found in chat creation', async () => {
      (deps.storage.team.getUser as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ uid: 'aabbccdd11223344aabb0001', handle: 'agent-1' })
        .mockResolvedValueOnce(null);

      const handler = createCreateChatHandler(deps);
      const req = createMockReq({
        body: { uid1: 'aabbccdd11223344aabb0001', uid2: 'aabbccdd11223344aabb0002' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
      const errorResponse = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(errorResponse.json).toHaveBeenCalledWith({ error: 'User uid2 not found' });
    });

    it('should return 400 for send message with invalid body', async () => {
      const broadcastToChat = vi.fn();
      const handler = createSendMessageHandler(deps, broadcastToChat);
      const req = createMockReq({
        params: { chatId: 'chat-1' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for send message to missing chat', async () => {
      const broadcastToChat = vi.fn();
      const handler = createSendMessageHandler(deps, broadcastToChat);
      const req = createMockReq({
        params: { chatId: 'nonexistent' },
        body: { from: 'aabbccdd11223344aabb0001', text: 'Hello' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
      const errorResponse = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(errorResponse.json).toHaveBeenCalledWith({ error: 'Chat not found' });
    });

    it('should return 404 for send message with unknown sender', async () => {
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'chat-1',
        participants: ['aabbccdd11223344aabb0001', 'aabbccdd11223344aabb0002'],
      });

      const broadcastToChat = vi.fn();
      const handler = createSendMessageHandler(deps, broadcastToChat);
      const req = createMockReq({
        params: { chatId: 'chat-1' },
        body: { from: 'aabbccdd11223344aabb0001', text: 'Hello' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
      const errorResponse = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(errorResponse.json).toHaveBeenCalledWith({ error: 'Sender not found' });
    });

    it('should get messages with after parameter', async () => {
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'chat-1',
        participants: ['aabbccdd11223344aabb0001', 'aabbccdd11223344aabb0002'],
      });
      (deps.storage.team.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'msg-1', text: 'hello', timestamp: '2025-01-01T00:00:00Z' },
      ]);
      (deps.storage.team.getMessagesAfter as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'msg-2', text: 'world', timestamp: '2025-01-01T01:00:00Z' },
      ]);

      const handler = createGetMessagesHandler(deps);
      const req = createMockReq({
        params: { chatId: 'chat-1' },
        query: { limit: '10', after: 'msg-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.storage.team.getMessagesAfter).toHaveBeenCalled();
    });

    it('should fallback to getMessages when after message not found', async () => {
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'chat-1',
        participants: ['aabbccdd11223344aabb0001', 'aabbccdd11223344aabb0002'],
      });
      (deps.storage.team.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'msg-1', text: 'hello', timestamp: '2025-01-01T00:00:00Z' },
      ]);

      const handler = createGetMessagesHandler(deps);
      const req = createMockReq({
        params: { chatId: 'chat-1' },
        query: { limit: '10', after: 'nonexistent-msg' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      // Should have called getMessages twice (once to find afterMsg, once as fallback)
      expect(deps.storage.team.getMessages).toHaveBeenCalledTimes(2);
      expect(deps.storage.team.getMessagesAfter).not.toHaveBeenCalled();
    });
  });

  describe('Broadcast Handler', () => {
    it('should return 400 for broadcast with invalid body', async () => {
      const broadcastToChat = vi.fn();
      const handler = createBroadcastHandler(deps, broadcastToChat);
      const req = createMockReq({
        params: { teamName: 'team-1' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for broadcast with unknown sender', async () => {
      const broadcastToChat = vi.fn();
      const handler = createBroadcastHandler(deps, broadcastToChat);
      const req = createMockReq({
        params: { teamName: 'team-1' },
        body: { from: 'aabbccdd11223344aabb0001', text: 'Hello team' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
      const errorResponse = (res.status as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(errorResponse.json).toHaveBeenCalledWith({ error: 'Sender not found' });
    });

    it('should broadcast when team chat does not exist yet', async () => {
      const broadcastToChat = vi.fn();
      (deps.storage.team.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        uid: 'aabbccdd11223344aabb0001',
        handle: 'agent-1',
      });
      (deps.storage.team.getUsersByTeam as ReturnType<typeof vi.fn>).mockResolvedValue([
        { uid: 'aabbccdd11223344aabb0001' },
        { uid: 'aabbccdd11223344aabb0002' },
      ]);
      // getChat returns null — chat does not exist
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const handler = createBroadcastHandler(deps, broadcastToChat);
      const req = createMockReq({
        params: { teamName: 'team-1' },
        body: { from: 'aabbccdd11223344aabb0001', text: 'Hello team' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      // Should have created the chat
      expect(deps.storage.team.insertChat).toHaveBeenCalled();
      expect(deps.storage.team.setUnread).toHaveBeenCalledTimes(2);
      // Should have inserted message
      expect(deps.storage.team.insertMessage).toHaveBeenCalled();
      // Should have incremented unread for non-sender
      expect(deps.storage.team.incrementUnread).toHaveBeenCalledTimes(1);
      // Should have broadcasted
      expect(broadcastToChat).toHaveBeenCalled();

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.text).toBe('Hello team');
      expect(response.metadata.isBroadcast).toBe(true);
    });

    it('should broadcast when team chat already exists', async () => {
      const broadcastToChat = vi.fn();
      (deps.storage.team.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        uid: 'aabbccdd11223344aabb0001',
        handle: 'agent-1',
      });
      (deps.storage.team.getUsersByTeam as ReturnType<typeof vi.fn>).mockResolvedValue([
        { uid: 'aabbccdd11223344aabb0001' },
        { uid: 'aabbccdd11223344aabb0002' },
      ]);
      (deps.storage.team.getChat as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'team-chat-1',
        participants: ['aabbccdd11223344aabb0001', 'aabbccdd11223344aabb0002'],
        isTeamChat: true,
      });

      const handler = createBroadcastHandler(deps, broadcastToChat);
      const req = createMockReq({
        params: { teamName: 'team-1' },
        body: { from: 'aabbccdd11223344aabb0001', text: 'Hello team', metadata: { priority: 'high' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      // Should NOT have created a new chat
      expect(deps.storage.team.insertChat).not.toHaveBeenCalled();
      // Should have inserted message and updated chat time
      expect(deps.storage.team.insertMessage).toHaveBeenCalled();
      expect(deps.storage.team.updateChatTime).toHaveBeenCalled();
      expect(broadcastToChat).toHaveBeenCalled();
    });
  });
});

describe('Work Item Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('Work Item Handlers', () => {
    it('should create a work item', async () => {
      const handler = createCreateWorkItemHandler(deps);
      const req = createMockReq({
        body: { title: 'Fix bug', description: 'Fix the auth bug' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('wi-1');
    });

    it('should reject work item with invalid body', async () => {
      const handler = createCreateWorkItemHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should list work items', async () => {
      (deps.storage.workItem.listWorkItems as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'wi-1', title: 'Test', status: 'pending' },
      ]);

      const handler = createListWorkItemsHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should get a work item by id', async () => {
      (deps.storage.workItem.getWorkItem as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'wi-1',
        title: 'Test',
      });

      const handler = createGetWorkItemHandler(deps);
      const req = createMockReq({ params: { id: 'wi-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should return 404 for missing work item', async () => {
      const handler = createGetWorkItemHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should update a work item status', async () => {
      (deps.storage.workItem.getWorkItem as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: 'wi-1', status: 'pending' })
        .mockResolvedValueOnce({ id: 'wi-1', status: 'in_progress' });

      const handler = createUpdateWorkItemHandler(deps);
      const req = createMockReq({
        params: { id: 'wi-1' },
        body: { status: 'in_progress', actor: 'agent-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should return 404 when updating non-existent work item', async () => {
      const handler = createUpdateWorkItemHandler(deps);
      const req = createMockReq({
        params: { id: 'nonexistent' },
        body: { status: 'in_progress', actor: 'agent-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('Batch Handlers', () => {
    it('should create a batch', async () => {
      const handler = createCreateBatchHandler(deps);
      const req = createMockReq({
        body: { name: 'sprint-1', workItemIds: ['wi-1', 'wi-2'] },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('batch-1');
    });

    it('should list batches', async () => {
      (deps.storage.workItem.listBatches as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const handler = createListBatchesHandler(deps);
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should get a batch with work items', async () => {
      (deps.storage.workItem.getBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'batch-1',
        name: 'sprint-1',
      });
      (deps.storage.workItem.listWorkItems as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'wi-1', title: 'Test' },
      ]);

      const handler = createGetBatchHandler(deps);
      const req = createMockReq({ params: { id: 'batch-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.workItems).toHaveLength(1);
    });

    it('should return 404 for missing batch', async () => {
      const handler = createGetBatchHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should dispatch a batch', async () => {
      (deps.storage.workItem.getBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'batch-1',
        name: 'sprint-1',
      });
      (deps.storage.workItem.dispatchBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        workItems: [],
        dispatchedCount: 3,
      });

      const handler = createDispatchBatchHandler(deps);
      const req = createMockReq({
        params: { id: 'batch-1' },
        body: { workerHandle: 'agent-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.dispatchedCount).toBe(3);
    });
  });
});
