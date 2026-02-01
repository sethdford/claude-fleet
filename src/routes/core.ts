/**
 * Core Route Handlers
 *
 * Health, metrics, authentication, and debug endpoints.
 */

import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import {
  validateBody,
  agentRegistrationSchema,
} from '../validation/schemas.js';
import { agentAuthentications } from '../metrics/prometheus.js';
import type {
  TeamAgent,
  HealthResponse,
  ErrorResponse,
  AuthResponse,
  ServerMetrics,
  TaskStatus,
  WorkerState,
} from '../types.js';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';

// ============================================================================
// HASH HELPERS
// ============================================================================

export function generateUid(teamName: string, handle: string): string {
  return crypto.createHash('sha256').update(teamName + ':' + handle).digest('hex').slice(0, 24);
}

export function generateChatId(uid1: string, uid2: string): string {
  const sorted = [uid1, uid2].sort();
  return crypto.createHash('sha256').update(sorted.join(':')).digest('hex').slice(0, 16);
}

export function generateTeamChatId(teamName: string): string {
  return crypto.createHash('sha256').update('team:' + teamName).digest('hex').slice(0, 16);
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

export function createHealthHandler(deps: RouteDependencies) {
  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const debug = await deps.storage.team.getDebugInfo();
    const response: HealthResponse = {
      status: 'ok',
      version: '2.0.0',
      persistence: 'sqlite',
      dbPath: deps.config.dbPath,
      agents: debug.users.length,
      chats: debug.chats.length,
      messages: debug.messageCount,
      workers: deps.workerManager.getWorkerCount(),
    };
    res.json(response);
  });
}

export function createMetricsJsonHandler(deps: RouteDependencies) {
  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const debug = await deps.storage.team.getDebugInfo();
    const healthStats = deps.workerManager.getHealthStats();
    const restartStats = deps.workerManager.getRestartStats();
    const workers = deps.workerManager.getWorkers();

    const byState: Record<WorkerState, number> = {
      starting: 0,
      ready: 0,
      working: 0,
      stopping: 0,
      stopped: 0,
    };
    for (const worker of workers) {
      byState[worker.state]++;
    }

    const byStatus: Record<TaskStatus, number> = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      blocked: 0,
    };
    for (const task of debug.tasks) {
      byStatus[task.status as TaskStatus]++;
    }

    const metrics: ServerMetrics = {
      uptime: Date.now() - deps.startTime,
      workers: {
        total: healthStats.total,
        healthy: healthStats.healthy,
        degraded: healthStats.degraded,
        unhealthy: healthStats.unhealthy,
        byState,
      },
      tasks: {
        total: debug.tasks.length,
        byStatus,
      },
      agents: debug.users.length,
      chats: debug.chats.length,
      messages: debug.messageCount,
      restarts: restartStats,
    };

    res.json(metrics);
  });
}

export function createAuthHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(agentRegistrationSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { handle, teamName, agentType } = validation.data;
    const uid = generateUid(teamName, handle);
    const now = new Date().toISOString();
    const agent: TeamAgent = {
      uid,
      handle,
      teamName,
      agentType: agentType ?? 'worker',
      createdAt: now,
      lastSeen: now,
    };

    await deps.storage.team.insertUser(agent);

    // Notify server to start watching this team's native resources
    deps.onTeamRegistered?.(teamName);

    const token = jwt.sign(
      { uid, handle, teamName, agentType: agent.agentType },
      deps.config.jwtSecret,
      { expiresIn: deps.config.jwtExpiresIn } as jwt.SignOptions
    );

    console.log(`[AUTH] ${handle} (${agent.agentType}) joined team "${teamName}"`);
    agentAuthentications.inc();

    const response: AuthResponse = {
      uid,
      handle,
      teamName,
      agentType: agent.agentType,
      token,
    };
    res.json(response);
  });
}

export function createDebugHandler(deps: RouteDependencies) {
  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const debug = await deps.storage.team.getDebugInfo();
    const workers = deps.workerManager.getWorkers().map(w => ({
      id: w.id,
      handle: w.handle,
      state: w.state,
    }));
    res.json({ ...debug, workers });
  });
}
