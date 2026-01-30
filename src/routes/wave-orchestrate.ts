/**
 * Wave & Multi-Repo Orchestration Route Handlers
 *
 * Endpoints for orchestrating waves of workers and multi-repo operations.
 * Uses @claude-fleet/tmux when available, falls back to headless
 * child_process orchestration for wave execution.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../validation/schemas.js';
import type { ErrorResponse } from '../types.js';
import type { RouteDependencies, BroadcastToAll } from './types.js';
import { asyncHandler } from './types.js';
import {
  HeadlessWaveOrchestrator,
  type HeadlessWave,
  type HeadlessWaveWorker,
} from './wave-orchestrate-headless.js';

// Check if tmux package is available
let tmuxAvailable = false;
let waveModule: typeof import('./wave-orchestrate-impl.js') | null = null;

try {
  // Check if @claude-fleet/tmux is available
  await import('@claude-fleet/tmux');
  // If available, load the implementation
  waveModule = await import('./wave-orchestrate-impl.js');
  tmuxAvailable = true;
} catch {
  // @claude-fleet/tmux not available - using headless fallback for waves
}

// ============================================================================
// MULTI-REPO STUB (requires tmux — no headless fallback)
// ============================================================================

function multiRepoNotAvailable(_req: Request, res: Response): void {
  res.status(501).json({
    error: 'Multi-repo orchestration requires @claude-fleet/tmux package.',
    hint: 'For full functionality, install from source with workspace packages. Wave orchestration is available in headless mode.',
  } as ErrorResponse);
}

// ============================================================================
// HEADLESS WAVE SCHEMAS & STATE
// ============================================================================

const waveWorkerSchema = z.object({
  handle: z.string(),
  command: z.string().optional(),
  prompt: z.string().optional(),
  cwd: z.string().optional(),
  timeout: z.number().optional(),
  successPattern: z.string().optional(),
  failurePattern: z.string().optional(),
});

const waveSchema = z.object({
  name: z.string(),
  workers: z.array(waveWorkerSchema),
  afterWaves: z.array(z.string()).optional(),
});

const executeWavesSchema = z.object({
  fleetName: z.string().default('api-fleet'),
  waves: z.array(waveSchema),
  remote: z.boolean().default(true),
  defaultTimeout: z.number().default(300000),
  pollInterval: z.number().default(1000),
});

interface HeadlessWaveExecution {
  id: string;
  orchestrator: HeadlessWaveOrchestrator;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  results?: unknown[];
  error?: string;
}

const headlessWaveExecutions = new Map<string, HeadlessWaveExecution>();

// ============================================================================
// HEADLESS WAVE HANDLERS
// ============================================================================

function createHeadlessExecuteWavesHandler(_deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(executeWavesSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fleetName, waves, defaultTimeout } = validation.data;
    const executionId = `wave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const orchestrator = new HeadlessWaveOrchestrator({
      fleetName,
      defaultTimeout,
    });

    for (const waveData of waves) {
      const wave: HeadlessWave = {
        name: waveData.name,
        workers: waveData.workers.map(w => {
          const worker: HeadlessWaveWorker = { handle: w.handle };
          if (w.command) worker.command = w.command;
          if (w.prompt) worker.prompt = w.prompt;
          if (w.cwd) worker.cwd = w.cwd;
          if (w.timeout) worker.timeout = w.timeout;
          if (w.successPattern) worker.successPattern = new RegExp(w.successPattern);
          if (w.failurePattern) worker.failurePattern = new RegExp(w.failurePattern);
          return worker;
        }),
      };
      if (waveData.afterWaves) {
        wave.afterWaves = waveData.afterWaves;
      }
      orchestrator.addWave(wave);
    }

    const execution: HeadlessWaveExecution = {
      id: executionId,
      orchestrator,
      status: 'running',
      startedAt: Date.now(),
    };
    headlessWaveExecutions.set(executionId, execution);

    // Forward events
    orchestrator.on('wave:start', (data: { wave: string; workers: string[] }) => {
      broadcastToAll({ type: 'wave:start', executionId, ...data });
    });
    orchestrator.on('worker:spawned', (data: { worker: string; paneId: string }) => {
      broadcastToAll({ type: 'wave:worker:spawned', executionId, ...data });
    });
    orchestrator.on('worker:success', (data: { worker: string }) => {
      broadcastToAll({ type: 'wave:worker:success', executionId, ...data });
    });
    orchestrator.on('worker:failed', (data: { worker: string; error: string }) => {
      broadcastToAll({ type: 'wave:worker:failed', executionId, ...data });
    });
    orchestrator.on('wave:complete', (data: { wave: string; results: unknown[] }) => {
      broadcastToAll({ type: 'wave:complete', executionId, ...data });
    });

    // Execute in background
    orchestrator.execute()
      .then((results: unknown[]) => {
        execution.status = 'completed';
        execution.completedAt = Date.now();
        execution.results = results;
        broadcastToAll({ type: 'wave:execution:complete', executionId, results });
      })
      .catch((error: Error) => {
        execution.status = 'failed';
        execution.completedAt = Date.now();
        execution.error = error.message;
        broadcastToAll({ type: 'wave:execution:failed', executionId, error: error.message });
      });

    res.json({
      executionId,
      status: 'running',
      mode: 'headless',
      waves: waves.length,
      message: 'Wave execution started (headless mode). Use GET /orchestrate/waves/:id for status.',
    });
  });
}

function createHeadlessGetWaveStatusHandler(_deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { id } = req.params;
    const execution = headlessWaveExecutions.get(id);

    if (!execution) {
      res.status(404).json({ error: `Wave execution '${id}' not found` } as ErrorResponse);
      return;
    }

    res.json({
      id: execution.id,
      status: execution.status,
      mode: 'headless',
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      orchestratorStatus: execution.orchestrator.getStatus(),
      results: execution.results,
      error: execution.error,
    });
  };
}

function createHeadlessCancelWaveHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const execution = headlessWaveExecutions.get(id);

    if (!execution) {
      res.status(404).json({ error: `Wave execution '${id}' not found` } as ErrorResponse);
      return;
    }

    if (execution.status !== 'running') {
      res.status(400).json({ error: `Cannot cancel execution in '${execution.status}' state` } as ErrorResponse);
      return;
    }

    await execution.orchestrator.cancel();
    execution.status = 'cancelled';
    execution.completedAt = Date.now();

    res.json({ id: execution.id, status: 'cancelled' });
  });
}

function createHeadlessListWaveExecutionsHandler(_deps: RouteDependencies) {
  return (_req: Request, res: Response): void => {
    const executions = Array.from(headlessWaveExecutions.values()).map(e => ({
      id: e.id,
      status: e.status,
      mode: 'headless',
      startedAt: e.startedAt,
      completedAt: e.completedAt,
    }));
    res.json(executions);
  };
}

// ============================================================================
// EXPORTED HANDLERS — tmux or headless fallback
// ============================================================================

export function createExecuteWavesHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createExecuteWavesHandler(deps, broadcastToAll)
    : createHeadlessExecuteWavesHandler(deps, broadcastToAll);
}

export function createGetWaveStatusHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createGetWaveStatusHandler(deps)
    : createHeadlessGetWaveStatusHandler(deps);
}

export function createCancelWaveHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createCancelWaveHandler(deps)
    : createHeadlessCancelWaveHandler(deps);
}

export function createListWaveExecutionsHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createListWaveExecutionsHandler(deps)
    : createHeadlessListWaveExecutionsHandler(deps);
}

// Multi-repo handlers — require tmux, no headless fallback
export function createExecuteMultiRepoHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createExecuteMultiRepoHandler(deps, broadcastToAll)
    : multiRepoNotAvailable;
}

export function createGetMultiRepoStatusHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createGetMultiRepoStatusHandler(deps)
    : multiRepoNotAvailable;
}

export function createListMultiRepoExecutionsHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createListMultiRepoExecutionsHandler(deps)
    : multiRepoNotAvailable;
}

export function createUpdateDepsHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createUpdateDepsHandler(deps, broadcastToAll)
    : multiRepoNotAvailable;
}

export function createSecurityAuditHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createSecurityAuditHandler(deps, broadcastToAll)
    : multiRepoNotAvailable;
}

export function createFormatCodeHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createFormatCodeHandler(deps, broadcastToAll)
    : multiRepoNotAvailable;
}

export function createRunTestsHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createRunTestsHandler(deps, broadcastToAll)
    : multiRepoNotAvailable;
}
