/**
 * Chat Route Handlers
 *
 * Users, teams, chats, messages, and broadcast endpoints.
 */

import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  validateBody,
  createChatSchema,
  sendMessageSchema,
  broadcastSchema,
  markReadSchema,
} from '../validation/schemas.js';
import { messagesSent, broadcastsSent } from '../metrics/prometheus.js';
import type { Chat, Message, ErrorResponse } from '../types.js';
import type { RouteDependencies, BroadcastToChat } from './types.js';
import { generateChatId, generateTeamChatId } from './core.js';

// ============================================================================
// USER HANDLERS
// ============================================================================

export function createGetUserHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const user = await deps.storage.team.getUser(req.params.uid);
    if (!user) {
      res.status(404).json({ error: 'User not found' } as ErrorResponse);
      return;
    }
    res.json(user);
  };
}

export function createGetUserChatsHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const { uid } = req.params;
    const chats = await deps.storage.team.getChatsByUser(uid);
    const result = await Promise.all(chats.map(async (chat: Chat) => {
      const unread = await deps.storage.team.getUnread(chat.id, uid);
      const messages = await deps.storage.team.getMessages(chat.id, 1);
      const lastMessage = messages[messages.length - 1];
      return {
        id: chat.id,
        participants: chat.participants,
        unread,
        lastMessage,
        updatedAt: chat.updatedAt,
      };
    }));
    res.json(result);
  };
}

// ============================================================================
// TEAM HANDLERS
// ============================================================================

export function createGetTeamAgentsHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json(await deps.storage.team.getUsersByTeam(req.params.teamName));
  };
}

export function createBroadcastHandler(deps: RouteDependencies, broadcastToChat: BroadcastToChat) {
  return async (req: Request, res: Response): Promise<void> => {
    const { teamName } = req.params;

    const validation = validateBody(broadcastSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { from, text, metadata } = validation.data;
    const fromUser = await deps.storage.team.getUser(from);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const teamChatId = generateTeamChatId(teamName);
    const agents = await deps.storage.team.getUsersByTeam(teamName);
    const participants = agents.map((a: { uid: string }) => a.uid);

    let chat = await deps.storage.team.getChat(teamChatId);
    if (!chat) {
      const now = new Date().toISOString();
      chat = {
        id: teamChatId,
        participants,
        isTeamChat: true,
        teamName,
        createdAt: now,
        updatedAt: now,
      };
      await deps.storage.team.insertChat(chat);
      await Promise.all(participants.map((uid: string) => deps.storage.team.setUnread(teamChatId, uid, 0)));
    }

    const messageId = uuidv4();
    const now = new Date().toISOString();
    const message: Message = {
      id: messageId,
      chatId: teamChatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid: from,
      text,
      timestamp: now,
      status: 'pending',
      metadata: { ...metadata, isBroadcast: true },
    };

    await deps.storage.team.insertMessage(message);
    await deps.storage.team.updateChatTime(teamChatId, now);
    await Promise.all(participants.map((uid: string) => {
      if (uid !== from) return deps.storage.team.incrementUnread(teamChatId, uid);
      return Promise.resolve();
    }));

    broadcastsSent.inc();
    console.log(`[BROADCAST] ${fromUser.handle} -> ${teamName}: ${text.slice(0, 50)}...`);
    broadcastToChat(teamChatId, { type: 'broadcast', message, handle: fromUser.handle });
    res.json(message);
  };
}

export function createGetTeamTasksHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const tasks = await deps.storage.team.getTasksByTeam(req.params.teamName);
    res.json(tasks);
  };
}

// ============================================================================
// CHAT HANDLERS
// ============================================================================

export function createCreateChatHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(createChatSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { uid1, uid2 } = validation.data;

    const user1 = await deps.storage.team.getUser(uid1);
    const user2 = await deps.storage.team.getUser(uid2);
    if (!user1) {
      res.status(404).json({ error: 'User uid1 not found' } as ErrorResponse);
      return;
    }
    if (!user2) {
      res.status(404).json({ error: 'User uid2 not found' } as ErrorResponse);
      return;
    }

    const chatId = generateChatId(uid1, uid2);
    const existing = await deps.storage.team.getChat(chatId);
    if (!existing) {
      const now = new Date().toISOString();
      const chat: Chat = {
        id: chatId,
        participants: [uid1, uid2],
        isTeamChat: false,
        teamName: null,
        createdAt: now,
        updatedAt: now,
      };
      await deps.storage.team.insertChat(chat);
      await deps.storage.team.setUnread(chatId, uid1, 0);
      await deps.storage.team.setUnread(chatId, uid2, 0);
      console.log(`[CHAT] Created ${chatId}`);
    }
    res.json({ chatId });
  };
}

export function createGetMessagesHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const { chatId } = req.params;
    const { limit = '50', after } = req.query;

    const chat = await deps.storage.team.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    let messages: Message[];
    if (after && typeof after === 'string') {
      const afterMessages = await deps.storage.team.getMessages(chatId, 1);
      const afterMsg = afterMessages.find((m: Message) => m.id === after);
      messages = afterMsg
        ? await deps.storage.team.getMessagesAfter(chatId, afterMsg.timestamp, parseInt(limit as string, 10))
        : await deps.storage.team.getMessages(chatId, parseInt(limit as string, 10));
    } else {
      messages = await deps.storage.team.getMessages(chatId, parseInt(limit as string, 10));
    }

    res.json(messages);
  };
}

export function createSendMessageHandler(deps: RouteDependencies, broadcastToChat: BroadcastToChat) {
  return async (req: Request, res: Response): Promise<void> => {
    const { chatId } = req.params;

    const validation = validateBody(sendMessageSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { from, text, metadata } = validation.data;

    const chat = await deps.storage.team.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    const fromUser = await deps.storage.team.getUser(from);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const messageId = uuidv4();
    const now = new Date().toISOString();
    const message: Message = {
      id: messageId,
      chatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid: from,
      text,
      timestamp: now,
      status: 'pending',
      metadata: metadata ?? {},
    };

    await deps.storage.team.insertMessage(message);
    await deps.storage.team.updateChatTime(chatId, now);
    await Promise.all(chat.participants.map((uid: string) => {
      if (uid !== from) return deps.storage.team.incrementUnread(chatId, uid);
      return Promise.resolve();
    }));

    messagesSent.inc();
    console.log(`[MSG] ${fromUser.handle}: ${text.slice(0, 50)}...`);
    broadcastToChat(chatId, { type: 'new_message', message, handle: fromUser.handle });
    res.json(message);
  };
}

export function createMarkReadHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const { chatId } = req.params;

    const validation = validateBody(markReadSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { uid } = validation.data;
    const chat = await deps.storage.team.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    await deps.storage.team.clearUnread(chatId, uid);
    res.json({ success: true });
  };
}
