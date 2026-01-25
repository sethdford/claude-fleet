/**
 * Wave & Multi-Repo Orchestration Route Handlers
 *
 * Endpoints for orchestrating waves of workers and multi-repo operations.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../validation/schemas.js';
import type { ErrorResponse } from '../types.js';
import type { RouteDependencies, BroadcastToAll } from './types.js';
import { asyncHandler } from './types.js';
import {
  WaveOrchestrator,
  MultiRepoOrchestrator,
  type Wave,
  type WaveWorker,
  type Repository,
  type MultiRepoTask,
} from '@claude-fleet/tmux';

// ============================================================================
// SCHEMAS
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

const repositorySchema = z.object({
  name: z.string(),
  path: z.string(),
  remoteUrl: z.string().optional(),
  defaultBranch: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const multiRepoTaskSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  repoTags: z.array(z.string()).optional(),
  repos: z.array(z.string()).optional(),
  createBranch: z.boolean().optional(),
  branchPattern: z.string().optional(),
  autoCommit: z.boolean().optional(),
  commitPattern: z.string().optional(),
  createPR: z.boolean().optional(),
  prTitlePattern: z.string().optional(),
  prBodyPattern: z.string().optional(),
  timeout: z.number().optional(),
  successPattern: z.string().optional(),
});

const executeMultiRepoSchema = z.object({
  fleetName: z.string(),
  repositories: z.array(repositorySchema),
  task: multiRepoTaskSchema,
  baseDir: z.string().optional(),
  maxParallel: z.number().default(4),
  remote: z.boolean().default(true),
});

const commonTaskSchema = z.object({
  fleetName: z.string(),
  repositories: z.array(repositorySchema),
  repos: z.array(z.string()).optional(),
  repoTags: z.array(z.string()).optional(),
  createPR: z.boolean().optional(),
});

// ============================================================================
// STATE TRACKING
// ============================================================================

interface WaveExecution {
  id: string;
  orchestrator: WaveOrchestrator;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  results?: unknown[];
  error?: string;
}

interface MultiRepoExecution {
  id: string;
  orchestrator: MultiRepoOrchestrator;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  results?: unknown[];
  error?: string;
}

// In-memory state (for now - could be persisted to SQLite)
const waveExecutions = new Map<string, WaveExecution>();
const multiRepoExecutions = new Map<string, MultiRepoExecution>();

// ============================================================================
// WAVE ORCHESTRATION HANDLERS
// ============================================================================

export function createExecuteWavesHandler(_deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(executeWavesSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fleetName, waves, remote, defaultTimeout, pollInterval } = validation.data;
    const executionId = `wave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create orchestrator
    const orchestrator = new WaveOrchestrator({
      fleetName,
      remote,
      defaultTimeout,
      pollInterval,
    });

    // Add waves
    for (const waveData of waves) {
      const wave: Wave = {
        name: waveData.name,
        workers: waveData.workers.map(w => {
          const worker: WaveWorker = { handle: w.handle };
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

    // Track execution
    const execution: WaveExecution = {
      id: executionId,
      orchestrator,
      status: 'running',
      startedAt: Date.now(),
    };
    waveExecutions.set(executionId, execution);

    // Set up event forwarding
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
      waves: waves.length,
      message: 'Wave execution started. Use GET /orchestrate/waves/:id for status.',
    });
  });
}

export function createGetWaveStatusHandler(_deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { id } = req.params;
    const execution = waveExecutions.get(id);

    if (!execution) {
      res.status(404).json({ error: `Wave execution '${id}' not found` } as ErrorResponse);
      return;
    }

    res.json({
      id: execution.id,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      orchestratorStatus: execution.orchestrator.getStatus(),
      results: execution.results,
      error: execution.error,
    });
  };
}

export function createCancelWaveHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const execution = waveExecutions.get(id);

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

export function createListWaveExecutionsHandler(_deps: RouteDependencies) {
  return (_req: Request, res: Response): void => {
    const executions = Array.from(waveExecutions.values()).map(e => ({
      id: e.id,
      status: e.status,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
    }));
    res.json(executions);
  };
}

// ============================================================================
// MULTI-REPO ORCHESTRATION HANDLERS
// ============================================================================

export function createExecuteMultiRepoHandler(_deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(executeMultiRepoSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fleetName, repositories, task, baseDir, maxParallel, remote } = validation.data;
    const executionId = `multirepo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create orchestrator
    const orchestrator = new MultiRepoOrchestrator({
      fleetName,
      repositories: repositories as Repository[],
      baseDir,
      maxParallel,
      remote,
    });

    // Track execution
    const execution: MultiRepoExecution = {
      id: executionId,
      orchestrator,
      status: 'running',
      startedAt: Date.now(),
    };
    multiRepoExecutions.set(executionId, execution);

    // Set up event forwarding
    orchestrator.on('task:start', (data: { task: string }) => {
      broadcastToAll({ type: 'multirepo:task:start', executionId, ...data });
    });
    orchestrator.on('repo:start', (data: { repo: string; task: string }) => {
      broadcastToAll({ type: 'multirepo:repo:start', executionId, ...data });
    });
    orchestrator.on('repo:success', (data: { repo: string; task: string }) => {
      broadcastToAll({ type: 'multirepo:repo:success', executionId, ...data });
    });
    orchestrator.on('repo:failed', (data: { repo: string; task: string; error: string }) => {
      broadcastToAll({ type: 'multirepo:repo:failed', executionId, ...data });
    });
    orchestrator.on('repo:committed', (data: { repo: string; sha: string }) => {
      broadcastToAll({ type: 'multirepo:repo:committed', executionId, ...data });
    });
    orchestrator.on('repo:pr-created', (data: { repo: string; prUrl: string }) => {
      broadcastToAll({ type: 'multirepo:repo:pr-created', executionId, ...data });
    });
    orchestrator.on('task:complete', (data: { task: string; results: unknown[] }) => {
      broadcastToAll({ type: 'multirepo:task:complete', executionId, ...data });
    });

    // Build task object with proper optional properties
    const multiRepoTask: MultiRepoTask = {
      name: task.name,
      prompt: task.prompt,
    };
    if (task.repoTags) multiRepoTask.repoTags = task.repoTags;
    if (task.repos) multiRepoTask.repos = task.repos;
    if (task.createBranch !== undefined) multiRepoTask.createBranch = task.createBranch;
    if (task.branchPattern) multiRepoTask.branchPattern = task.branchPattern;
    if (task.autoCommit !== undefined) multiRepoTask.autoCommit = task.autoCommit;
    if (task.commitPattern) multiRepoTask.commitPattern = task.commitPattern;
    if (task.createPR !== undefined) multiRepoTask.createPR = task.createPR;
    if (task.prTitlePattern) multiRepoTask.prTitlePattern = task.prTitlePattern;
    if (task.prBodyPattern) multiRepoTask.prBodyPattern = task.prBodyPattern;
    if (task.timeout) multiRepoTask.timeout = task.timeout;
    if (task.successPattern) multiRepoTask.successPattern = new RegExp(task.successPattern);

    // Execute in background
    orchestrator.executeTask(multiRepoTask)
      .then((results: unknown[]) => {
        execution.status = 'completed';
        execution.completedAt = Date.now();
        execution.results = results;
        broadcastToAll({ type: 'multirepo:execution:complete', executionId, results });
      })
      .catch((error: Error) => {
        execution.status = 'failed';
        execution.completedAt = Date.now();
        execution.error = error.message;
        broadcastToAll({ type: 'multirepo:execution:failed', executionId, error: error.message });
      });

    res.json({
      executionId,
      status: 'running',
      repositories: repositories.length,
      task: task.name,
      message: 'Multi-repo execution started. Use GET /orchestrate/multi-repo/:id for status.',
    });
  });
}

export function createGetMultiRepoStatusHandler(_deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { id } = req.params;
    const execution = multiRepoExecutions.get(id);

    if (!execution) {
      res.status(404).json({ error: `Multi-repo execution '${id}' not found` } as ErrorResponse);
      return;
    }

    res.json({
      id: execution.id,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      orchestratorStatus: execution.orchestrator.getStatus(),
      results: execution.results,
      error: execution.error,
    });
  };
}

export function createListMultiRepoExecutionsHandler(_deps: RouteDependencies) {
  return (_req: Request, res: Response): void => {
    const executions = Array.from(multiRepoExecutions.values()).map(e => ({
      id: e.id,
      status: e.status,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
    }));
    res.json(executions);
  };
}

// ============================================================================
// COMMON TASK SHORTCUTS
// ============================================================================

export function createUpdateDepsHandler(_deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(commonTaskSchema.extend({
      packageManager: z.enum(['npm', 'yarn', 'pnpm']).optional(),
    }), req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fleetName, repositories, repos, repoTags, createPR, packageManager } = validation.data;
    const executionId = `updatedeps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const orchestrator = new MultiRepoOrchestrator({
      fleetName,
      repositories: repositories as Repository[],
    });

    const execution: MultiRepoExecution = {
      id: executionId,
      orchestrator,
      status: 'running',
      startedAt: Date.now(),
    };
    multiRepoExecutions.set(executionId, execution);

    // Event forwarding
    orchestrator.on('task:complete', (data: { task: string; results: unknown[] }) => {
      broadcastToAll({ type: 'multirepo:task:complete', executionId, ...data });
    });

    orchestrator.updateDependencies({
      ...(repos && { repos }),
      ...(repoTags && { repoTags }),
      ...(createPR !== undefined && { createPR }),
      ...(packageManager && { packageManager }),
    })
      .then((results: unknown[]) => {
        execution.status = 'completed';
        execution.completedAt = Date.now();
        execution.results = results;
      })
      .catch((error: Error) => {
        execution.status = 'failed';
        execution.completedAt = Date.now();
        execution.error = error.message;
      });

    res.json({ executionId, status: 'running', task: 'update-deps' });
  });
}

export function createSecurityAuditHandler(_deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(commonTaskSchema.extend({
      fix: z.boolean().optional(),
    }), req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fleetName, repositories, repos, repoTags, createPR, fix } = validation.data;
    const executionId = `security-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const orchestrator = new MultiRepoOrchestrator({
      fleetName,
      repositories: repositories as Repository[],
    });

    const execution: MultiRepoExecution = {
      id: executionId,
      orchestrator,
      status: 'running',
      startedAt: Date.now(),
    };
    multiRepoExecutions.set(executionId, execution);

    orchestrator.on('task:complete', (data: { task: string; results: unknown[] }) => {
      broadcastToAll({ type: 'multirepo:task:complete', executionId, ...data });
    });

    orchestrator.runSecurityAudit({
      ...(repos && { repos }),
      ...(repoTags && { repoTags }),
      ...(fix !== undefined && { fix }),
      ...(createPR !== undefined && { createPR }),
    })
      .then((results: unknown[]) => {
        execution.status = 'completed';
        execution.completedAt = Date.now();
        execution.results = results;
      })
      .catch((error: Error) => {
        execution.status = 'failed';
        execution.completedAt = Date.now();
        execution.error = error.message;
      });

    res.json({ executionId, status: 'running', task: 'security-audit' });
  });
}

export function createFormatCodeHandler(_deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(commonTaskSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fleetName, repositories, repos, repoTags, createPR } = validation.data;
    const executionId = `format-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const orchestrator = new MultiRepoOrchestrator({
      fleetName,
      repositories: repositories as Repository[],
    });

    const execution: MultiRepoExecution = {
      id: executionId,
      orchestrator,
      status: 'running',
      startedAt: Date.now(),
    };
    multiRepoExecutions.set(executionId, execution);

    orchestrator.on('task:complete', (data: { task: string; results: unknown[] }) => {
      broadcastToAll({ type: 'multirepo:task:complete', executionId, ...data });
    });

    orchestrator.formatCode({
      ...(repos && { repos }),
      ...(repoTags && { repoTags }),
      ...(createPR !== undefined && { createPR }),
    })
      .then((results: unknown[]) => {
        execution.status = 'completed';
        execution.completedAt = Date.now();
        execution.results = results;
      })
      .catch((error: Error) => {
        execution.status = 'failed';
        execution.completedAt = Date.now();
        execution.error = error.message;
      });

    res.json({ executionId, status: 'running', task: 'format-code' });
  });
}

export function createRunTestsHandler(_deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(commonTaskSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fleetName, repositories, repos, repoTags } = validation.data;
    const executionId = `tests-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const orchestrator = new MultiRepoOrchestrator({
      fleetName,
      repositories: repositories as Repository[],
    });

    const execution: MultiRepoExecution = {
      id: executionId,
      orchestrator,
      status: 'running',
      startedAt: Date.now(),
    };
    multiRepoExecutions.set(executionId, execution);

    orchestrator.on('task:complete', (data: { task: string; results: unknown[] }) => {
      broadcastToAll({ type: 'multirepo:task:complete', executionId, ...data });
    });

    orchestrator.runTests({
      ...(repos && { repos }),
      ...(repoTags && { repoTags }),
    })
      .then((results: unknown[]) => {
        execution.status = 'completed';
        execution.completedAt = Date.now();
        execution.results = results;
      })
      .catch((error: Error) => {
        execution.status = 'failed';
        execution.completedAt = Date.now();
        execution.error = error.message;
      });

    res.json({ executionId, status: 'running', task: 'run-tests' });
  });
}
