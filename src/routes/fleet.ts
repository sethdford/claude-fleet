/**
 * Fleet Coordination Route Handlers
 *
 * Blackboard messaging, spawn queue, checkpoints, and swarm management.
 */

import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  validateBody,
  validateQuery,
  blackboardPostSchema,
  blackboardMarkReadSchema,
  blackboardArchiveSchema,
  blackboardArchiveOldSchema,
  spawnEnqueueSchema,
  checkpointCreateSchema,
  swarmCreateSchema,
  swarmKillSchema,
  swarmIdParamSchema,
  handleParamSchema,
  numericIdParamSchema,
  uuidIdParamSchema,
  blackboardReadQuerySchema,
  checkpointListQuerySchema,
  swarmListQuerySchema,
} from '../validation/schemas.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type {
  ErrorResponse,
  BlackboardMessageType,
  MessagePriority,
} from '../types.js';
import type { FleetAgentRole } from '../workers/agent-roles.js';
import type { RouteDependencies } from './types.js';

// ============================================================================
// ACCESS CONTROL HELPERS
// ============================================================================

/**
 * Verify the authenticated user has access to the specified swarm.
 */
export function verifySwarmAccess(
  req: Request,
  swarmId: string,
  deps: RouteDependencies
): { allowed: boolean; reason?: string } {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user;

  if (!user) {
    return { allowed: false, reason: 'Authentication required' };
  }

  // Team leads can access all swarms
  if (user.agentType === 'team-lead') {
    return { allowed: true };
  }

  // Workers can only access their assigned swarm
  const worker = deps.workerManager.getWorkerByHandle(user.handle);
  if (!worker) {
    // User is authenticated but not an active worker - allow read-only access
    return { allowed: true };
  }

  if (!worker.swarmId) {
    return { allowed: false, reason: 'Worker not assigned to any swarm' };
  }

  if (worker.swarmId !== swarmId) {
    return {
      allowed: false,
      reason: `Access denied: worker belongs to swarm '${worker.swarmId}', not '${swarmId}'`,
    };
  }

  return { allowed: true };
}

/**
 * Verify checkpoint access for a given handle.
 */
export function verifyCheckpointHandleAccess(
  req: Request,
  handle: string
): { allowed: boolean; reason?: string } {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user;

  if (!user) {
    return { allowed: false, reason: 'Authentication required' };
  }

  // Team leads can access all checkpoints
  if (user.agentType === 'team-lead') {
    return { allowed: true };
  }

  // Users can only access their own checkpoints
  if (user.handle === handle) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Access denied: cannot access checkpoints for handle '${handle}'`,
  };
}

// ============================================================================
// BLACKBOARD HANDLERS
// ============================================================================

export function createBlackboardPostHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(blackboardPostSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { swarmId, senderHandle, messageType, payload, targetHandle, priority } = validation.data;

    // Verify swarm exists
    if (!deps.swarms.has(swarmId)) {
      res.status(404).json({ error: `Swarm '${swarmId}' not found` } as ErrorResponse);
      return;
    }

    const access = verifySwarmAccess(req, swarmId, deps);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    // SECURITY: Verify senderHandle matches authenticated user
    const authReq = req as AuthenticatedRequest;
    if (authReq.user && authReq.user.handle !== senderHandle && authReq.user.agentType !== 'team-lead') {
      res.status(403).json({
        error: `Cannot post as '${senderHandle}' - you are '${authReq.user.handle}'`,
      } as ErrorResponse);
      return;
    }

    const message = deps.storage.blackboard.postMessage(
      swarmId,
      senderHandle,
      messageType,
      payload as Record<string, unknown>,
      { targetHandle, priority }
    );

    console.log(`[BLACKBOARD] ${senderHandle} -> ${targetHandle ?? 'all'} (${messageType})`);
    res.json(message);
  };
}

export function createBlackboardReadHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter
    const paramValidation = validateQuery(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error } as ErrorResponse);
      return;
    }
    const { swarmId } = paramValidation.data;

    const access = verifySwarmAccess(req, swarmId, deps);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    // Validate query parameters
    const queryValidation = validateQuery(blackboardReadQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error } as ErrorResponse);
      return;
    }

    const { messageType, unreadOnly, readerHandle, priority, limit } = queryValidation.data;

    const options: {
      messageType?: BlackboardMessageType;
      unreadOnly?: boolean;
      readerHandle?: string;
      priority?: MessagePriority;
      limit?: number;
    } = {};

    if (messageType) options.messageType = messageType;
    if (unreadOnly === 'true' && readerHandle) {
      options.unreadOnly = true;
      options.readerHandle = readerHandle;
    }
    if (priority) options.priority = priority;
    if (limit) options.limit = limit;

    const messages = deps.storage.blackboard.readMessages(swarmId, options);
    res.json(messages);
  };
}

export function createBlackboardMarkReadHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(blackboardMarkReadSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { messageIds, readerHandle } = validation.data;

    // Mark messages as read (access control handled by swarm membership)
    deps.storage.blackboard.markRead(messageIds, readerHandle);
    res.json({ success: true, marked: messageIds.length });
  };
}

export function createBlackboardArchiveHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(blackboardArchiveSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { messageIds } = validation.data;
    // Archive each message individually (interface has singular archiveMessage)
    for (const id of messageIds) {
      deps.storage.blackboard.archiveMessage(id);
    }
    res.json({ success: true, archived: messageIds.length });
  };
}

export function createBlackboardArchiveOldHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter
    const paramValidation = validateQuery(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error } as ErrorResponse);
      return;
    }
    const { swarmId } = paramValidation.data;

    const access = verifySwarmAccess(req, swarmId, deps);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    const validation = validateBody(blackboardArchiveOldSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { maxAgeMs } = validation.data;
    const ageThreshold = maxAgeMs ?? 24 * 60 * 60 * 1000;
    const count = deps.storage.blackboard.archiveOldMessages(swarmId, ageThreshold);
    res.json({ success: true, archived: count, swarmId });
  };
}

// ============================================================================
// SPAWN QUEUE HANDLERS
// ============================================================================

export function createSpawnEnqueueHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const validation = validateBody(spawnEnqueueSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { requesterHandle, targetAgentType, task, swarmId, priority, dependsOn } = validation.data;

    const requester = deps.workerManager.getWorkerByHandle(requesterHandle);
    const depthLevel = requester?.depthLevel ?? 1;

    const authReq = req as AuthenticatedRequest;
    const requesterRole = authReq.user?.agentType === 'team-lead' ? 'lead' : 'worker';

    const requestId = deps.spawnController.queueSpawn(
      requesterHandle,
      targetAgentType as FleetAgentRole,
      depthLevel,
      task,
      { priority, dependsOn, swarmId, context: { requesterRole } }
    );

    if (!requestId) {
      res.status(400).json({ error: 'Failed to queue spawn request' } as ErrorResponse);
      return;
    }

    console.log(`[SPAWN] Queued ${targetAgentType} by ${requesterHandle} (depth: ${depthLevel})`);
    res.json({ requestId, status: 'pending', targetAgentType, task });
  };
}

export function createSpawnStatusHandler(deps: RouteDependencies) {
  return (_req: Request, res: Response): void => {
    const stats = deps.spawnController.getQueueStats();
    res.json(stats);
  };
}

export function createSpawnGetHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter (UUID)
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid spawn request ID format' } as ErrorResponse);
      return;
    }
    const { id } = paramValidation.data;

    const item = await deps.storage.spawnQueue.getItem(id);

    if (!item) {
      res.status(404).json({ error: 'Spawn request not found' } as ErrorResponse);
      return;
    }

    res.json(item);
  };
}

export function createSpawnCancelHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter (UUID)
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid spawn request ID format' } as ErrorResponse);
      return;
    }
    const { id } = paramValidation.data;

    await deps.storage.spawnQueue.cancelItem(id);

    console.log(`[SPAWN] Cancelled ${id}`);
    res.json({ success: true, id });
  };
}

// ============================================================================
// CHECKPOINT HANDLERS
// ============================================================================

export function createCheckpointCreateHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(checkpointCreateSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fromHandle, toHandle, goal, now, test, doneThisSession, blockers, questions, next } = validation.data;

    // SECURITY: Verify fromHandle matches authenticated user (prevent impersonation)
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' } as ErrorResponse);
      return;
    }

    // Only team-leads can create checkpoints on behalf of others
    if (user.handle !== fromHandle && user.agentType !== 'team-lead') {
      res.status(403).json({
        error: `Cannot create checkpoint as '${fromHandle}' - you are '${user.handle}'`,
      } as ErrorResponse);
      return;
    }

    const checkpoint = deps.storage.checkpoint.createCheckpoint(fromHandle, toHandle, {
      goal,
      now,
      test,
      doneThisSession: doneThisSession ?? [],
      blockers: blockers ?? [],
      questions: questions ?? [],
      worked: [],
      failed: [],
      next: next ?? [],
      files: { created: [], modified: [] },
    });

    console.log(`[CHECKPOINT] ${fromHandle} -> ${toHandle}: ${goal.slice(0, 50)}...`);
    res.json(checkpoint);
  };
}

export function createCheckpointLoadHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter
    const paramValidation = validateQuery(numericIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid checkpoint ID' } as ErrorResponse);
      return;
    }
    const { id } = paramValidation.data;

    const checkpoint = deps.storage.checkpoint.loadCheckpoint(id);

    if (!checkpoint) {
      res.status(404).json({ error: 'Checkpoint not found' } as ErrorResponse);
      return;
    }

    // Verify access
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' } as ErrorResponse);
      return;
    }

    if (
      user.agentType !== 'team-lead' &&
      user.handle !== checkpoint.fromHandle &&
      user.handle !== checkpoint.toHandle
    ) {
      res.status(403).json({
        error: `Access denied: checkpoint belongs to ${checkpoint.fromHandle} -> ${checkpoint.toHandle}`,
      } as ErrorResponse);
      return;
    }

    res.json(checkpoint);
  };
}

export function createCheckpointLatestHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter
    const paramValidation = validateQuery(handleParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error } as ErrorResponse);
      return;
    }
    const { handle } = paramValidation.data;

    const access = verifyCheckpointHandleAccess(req, handle);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    const checkpoint = deps.storage.checkpoint.loadLatestCheckpoint(handle);

    if (!checkpoint) {
      res.status(404).json({ error: 'No checkpoint found for this handle' } as ErrorResponse);
      return;
    }

    res.json(checkpoint);
  };
}

export function createCheckpointListHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter
    const paramValidation = validateQuery(handleParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error } as ErrorResponse);
      return;
    }
    const { handle } = paramValidation.data;

    const access = verifyCheckpointHandleAccess(req, handle);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    // Validate query parameters
    const queryValidation = validateQuery(checkpointListQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error } as ErrorResponse);
      return;
    }

    const { limit } = queryValidation.data;
    const checkpoints = deps.storage.checkpoint.listCheckpoints(handle, { limit });
    res.json(checkpoints);
  };
}

export function createCheckpointAcceptHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter
    const paramValidation = validateQuery(numericIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid checkpoint ID' } as ErrorResponse);
      return;
    }
    const { id } = paramValidation.data;

    const checkpoint = deps.storage.checkpoint.loadCheckpoint(id);
    if (!checkpoint) {
      res.status(404).json({ error: 'Checkpoint not found' } as ErrorResponse);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' } as ErrorResponse);
      return;
    }

    if (user.agentType !== 'team-lead' && user.handle !== checkpoint.toHandle) {
      res.status(403).json({
        error: `Only the recipient '${checkpoint.toHandle}' can accept this checkpoint`,
      } as ErrorResponse);
      return;
    }

    const success = deps.storage.checkpoint.acceptCheckpoint(id);

    if (!success) {
      res.status(400).json({ error: 'Checkpoint already processed' } as ErrorResponse);
      return;
    }

    console.log(`[CHECKPOINT] Accepted ${id}`);
    res.json({ success: true, id });
  };
}

export function createCheckpointRejectHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter
    const paramValidation = validateQuery(numericIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid checkpoint ID' } as ErrorResponse);
      return;
    }
    const { id } = paramValidation.data;

    const checkpoint = deps.storage.checkpoint.loadCheckpoint(id);
    if (!checkpoint) {
      res.status(404).json({ error: 'Checkpoint not found' } as ErrorResponse);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' } as ErrorResponse);
      return;
    }

    if (user.agentType !== 'team-lead' && user.handle !== checkpoint.toHandle) {
      res.status(403).json({
        error: `Only the recipient '${checkpoint.toHandle}' can reject this checkpoint`,
      } as ErrorResponse);
      return;
    }

    const success = deps.storage.checkpoint.rejectCheckpoint(id);

    if (!success) {
      res.status(400).json({ error: 'Checkpoint already processed' } as ErrorResponse);
      return;
    }

    console.log(`[CHECKPOINT] Rejected ${id}`);
    res.json({ success: true, id });
  };
}

// ============================================================================
// SWARM HANDLERS
// ============================================================================

export function createSwarmCreateHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const validation = validateBody(swarmCreateSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { name, description, maxAgents } = validation.data;

    const id = `swarm-${crypto.randomBytes(4).toString('hex')}`;
    const swarm = {
      id,
      name,
      description,
      maxAgents,
      createdAt: Date.now(),
    };

    deps.swarms.set(id, swarm);
    console.log(`[SWARM] Created ${id}: ${name}`);
    res.json(swarm);
  };
}

export function createSwarmListHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    // Validate query parameters
    const queryValidation = validateQuery(swarmListQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error } as ErrorResponse);
      return;
    }

    const { includeAgents } = queryValidation.data;
    const swarms = Array.from(deps.swarms.values());

    if (includeAgents === 'true') {
      const workers = deps.workerManager.getWorkers();
      const result = swarms.map(swarm => ({
        ...swarm,
        agents: workers.filter(w => w.swarmId === swarm.id).map(w => ({
          id: w.id,
          handle: w.handle,
          state: w.state,
        })),
      }));
      res.json(result);
    } else {
      res.json(swarms);
    }
  };
}

export function createSwarmGetHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    // Validate path parameter (reuse swarmIdParam with 'id' instead of 'swarmId')
    const { id } = req.params;
    if (!id || id.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      res.status(400).json({ error: 'Invalid swarm ID format' } as ErrorResponse);
      return;
    }

    const swarm = deps.swarms.get(id);

    if (!swarm) {
      res.status(404).json({ error: 'Swarm not found' } as ErrorResponse);
      return;
    }

    const workers = deps.workerManager.getWorkers().filter(w => w.swarmId === id);
    res.json({
      ...swarm,
      agents: workers.map(w => ({
        id: w.id,
        handle: w.handle,
        state: w.state,
        depthLevel: w.depthLevel,
      })),
    });
  };
}

export function createSwarmKillHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    // Validate path parameter
    const { id } = req.params;
    if (!id || id.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      res.status(400).json({ error: 'Invalid swarm ID format' } as ErrorResponse);
      return;
    }

    const validation = validateBody(swarmKillSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { graceful } = validation.data;
    const swarm = deps.swarms.get(id);
    if (!swarm) {
      res.status(404).json({ error: 'Swarm not found' } as ErrorResponse);
      return;
    }

    const workers = deps.workerManager.getWorkers().filter(w => w.swarmId === id);
    const dismissed: string[] = [];

    for (const worker of workers) {
      try {
        await deps.workerManager.dismissWorker(worker.id, true);
        dismissed.push(worker.handle);
      } catch (error) {
        console.error(`[SWARM] Failed to dismiss ${worker.handle}:`, (error as Error).message);
      }
    }

    if (!graceful) {
      deps.swarms.delete(id);
    }

    console.log(`[SWARM] Killed ${id}: dismissed ${dismissed.length} agents`);
    res.json({ success: true, swarmId: id, dismissed });
  };
}
