/**
 * Orchestration Route Handlers
 *
 * Worker spawning, dismissal, communication, and worktree operations.
 */

import type { Request, Response } from 'express';
import {
  validateBody,
  spawnWorkerSchema,
  sendToWorkerSchema,
  worktreeCommitSchema,
  worktreePRSchema,
} from '../validation/schemas.js';
import { workerSpawns, workerDismissals } from '../metrics/prometheus.js';
import type { ErrorResponse } from '../types.js';
import type { RouteDependencies, BroadcastToAll } from './types.js';
import { asyncHandler } from './types.js';

// ============================================================================
// WORKER HANDLERS
// ============================================================================

export function createSpawnWorkerHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(spawnWorkerSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    try {
      const worker = await deps.workerManager.spawnWorker(validation.data);
      workerSpawns.inc();
      broadcastToAll({ type: 'worker_spawned', worker });
      res.json(worker);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message } as ErrorResponse);
    }
  });
}

export function createDismissWorkerHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { handle } = req.params;

    const worker = deps.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    await deps.workerManager.dismissWorkerByHandle(handle);
    workerDismissals.inc();
    broadcastToAll({ type: 'worker_dismissed', handle });
    res.json({ success: true, handle });
  });
}

export function createSendToWorkerHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { handle } = req.params;

    const validation = validateBody(sendToWorkerSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const success = deps.workerManager.sendToWorkerByHandle(handle, validation.data.message);
    if (!success) {
      res.status(404).json({ error: `Worker '${handle}' not found or stopped` } as ErrorResponse);
      return;
    }

    res.json({ success: true, handle });
  };
}

export function createGetWorkersHandler(deps: RouteDependencies) {
  return (_req: Request, res: Response): void => {
    const workers = deps.workerManager.getWorkers().map(w => ({
      id: w.id,
      handle: w.handle,
      teamName: w.teamName,
      state: w.state,
      workingDir: w.workingDir,
      sessionId: w.sessionId,
      spawnedAt: w.spawnedAt,
      currentTaskId: w.currentTaskId,
    }));
    res.json(workers);
  };
}

export function createGetWorkerOutputHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { handle } = req.params;

    const worker = deps.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    res.json({
      handle,
      state: worker.state,
      output: worker.recentOutput,
    });
  };
}

// ============================================================================
// WORKTREE HANDLERS
// ============================================================================

export function createWorktreeCommitHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { handle } = req.params;

    const validation = validateBody(worktreeCommitSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { message } = validation.data;
    const worker = deps.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    const worktreeManager = deps.workerManager.getWorktreeManager();
    if (!worktreeManager) {
      res.status(400).json({ error: 'Worktrees are not enabled' } as ErrorResponse);
      return;
    }

    try {
      const commitHash = await worktreeManager.commit(worker.id, message);
      res.json({ success: true, commitHash, handle });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message } as ErrorResponse);
    }
  });
}

export function createWorktreePushHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { handle } = req.params;

    const worker = deps.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    const worktreeManager = deps.workerManager.getWorktreeManager();
    if (!worktreeManager) {
      res.status(400).json({ error: 'Worktrees are not enabled' } as ErrorResponse);
      return;
    }

    try {
      await worktreeManager.push(worker.id);
      res.json({ success: true, handle });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message } as ErrorResponse);
    }
  });
}

export function createWorktreePRHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { handle } = req.params;

    const validation = validateBody(worktreePRSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { title, body, base } = validation.data;
    const worker = deps.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    const worktreeManager = deps.workerManager.getWorktreeManager();
    if (!worktreeManager) {
      res.status(400).json({ error: 'Worktrees are not enabled' } as ErrorResponse);
      return;
    }

    try {
      const prUrl = await worktreeManager.createPR(worker.id, title, body, base);
      res.json({ success: true, prUrl, handle });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message } as ErrorResponse);
    }
  });
}

export function createWorktreeStatusHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { handle } = req.params;

    const worker = deps.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    const worktreeManager = deps.workerManager.getWorktreeManager();
    if (!worktreeManager) {
      res.status(400).json({ error: 'Worktrees are not enabled' } as ErrorResponse);
      return;
    }

    try {
      const status = await worktreeManager.getStatus(worker.id);
      res.json({ ...status, handle });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message } as ErrorResponse);
    }
  });
}
