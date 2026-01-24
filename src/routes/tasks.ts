/**
 * Task Route Handlers
 *
 * Task creation, retrieval, and status updates.
 */

import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  validateBody,
  createTaskSchema,
  updateTaskSchema,
} from '../validation/schemas.js';
import { tasksCreated, tasksCompleted } from '../metrics/prometheus.js';
import type { TeamTask, Message, Chat, ErrorResponse, TaskStatus } from '../types.js';
import type { RouteDependencies, BroadcastToChat } from './types.js';
import { asyncHandler } from './types.js';
import { generateChatId } from './core.js';

// ============================================================================
// TASK HANDLERS
// ============================================================================

export function createCreateTaskHandler(deps: RouteDependencies, broadcastToChat: BroadcastToChat) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(createTaskSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fromUid, toHandle, teamName, subject, description, blockedBy } = validation.data;

    const fromUser = await deps.storage.team.getUser(fromUid);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const agents = await deps.storage.team.getUsersByTeam(teamName);
    const toUser = agents.find((a: { handle: string }) => a.handle === toHandle);
    if (!toUser) {
      res.status(404).json({ error: `Agent ${toHandle} not found` } as ErrorResponse);
      return;
    }

    const taskId = uuidv4();
    const now = new Date().toISOString();
    const task: TeamTask = {
      id: taskId,
      teamName,
      subject,
      description: description ?? null,
      ownerHandle: toHandle,
      ownerUid: toUser.uid,
      createdByHandle: fromUser.handle,
      createdByUid: fromUid,
      status: 'open',
      blockedBy: blockedBy ?? [],
      createdAt: now,
      updatedAt: now,
    };

    await deps.storage.team.insertTask(task);

    // Create chat and send task assignment message
    const chatId = generateChatId(fromUid, toUser.uid);
    let chat = await deps.storage.team.getChat(chatId);
    if (!chat) {
      chat = {
        id: chatId,
        participants: [fromUid, toUser.uid],
        isTeamChat: false,
        teamName: null,
        createdAt: now,
        updatedAt: now,
      } as Chat;
      await deps.storage.team.insertChat(chat);
      await deps.storage.team.setUnread(chatId, fromUid, 0);
      await deps.storage.team.setUnread(chatId, toUser.uid, 0);
    }

    const messageId = uuidv4();
    const message: Message = {
      id: messageId,
      chatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid,
      text: `[TASK] ${subject}\n\n${description ?? ''}`,
      timestamp: now,
      status: 'pending',
      metadata: { taskId, type: 'task_assignment' },
    };
    await deps.storage.team.insertMessage(message);
    await deps.storage.team.incrementUnread(chatId, toUser.uid);

    tasksCreated.inc();
    console.log(`[TASK] ${fromUser.handle} -> ${toHandle}: ${subject}`);
    broadcastToChat(chatId, { type: 'task_assigned', task, handle: fromUser.handle });
    res.json(task);
  });
}

export function createGetTaskHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const task = await deps.storage.team.getTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' } as ErrorResponse);
      return;
    }
    res.json(task);
  });
}

export function createUpdateTaskHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { taskId } = req.params;

    const validation = validateBody(updateTaskSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { status } = validation.data;
    const task = await deps.storage.team.getTask(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' } as ErrorResponse);
      return;
    }

    // Enforce task dependencies
    if (status === 'resolved' && task.blockedBy.length > 0) {
      const unresolvedBlockers: string[] = [];
      for (const blockerId of task.blockedBy) {
        const blocker = await deps.storage.team.getTask(blockerId);
        if (blocker && blocker.status !== 'resolved') {
          unresolvedBlockers.push(blockerId);
        }
      }
      if (unresolvedBlockers.length > 0) {
        res.status(400).json({
          error: 'Cannot resolve task: blocked by unresolved tasks',
          blockedBy: unresolvedBlockers,
        } as ErrorResponse);
        return;
      }
    }

    const now = new Date().toISOString();
    await deps.storage.team.updateTaskStatus(taskId, status as TaskStatus, now);
    if (status === 'resolved') {
      tasksCompleted.inc();
    }

    // Broadcast WebSocket event for real-time dashboard updates
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'task_updated',
        taskId,
        status,
        teamName: task.teamName,
        ownerHandle: task.ownerHandle,
      });
    }

    console.log(`[TASK] ${taskId.slice(0, 8)}... status -> ${status}`);
    res.json({ ...task, status, updatedAt: now });
  });
}
