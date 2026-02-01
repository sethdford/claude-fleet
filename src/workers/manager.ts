/**
 * Worker Manager
 *
 * Manages spawning, monitoring, and communication with Claude Code worker instances.
 * Uses child_process.spawn with NDJSON streaming for bidirectional communication.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type {
  WorkerProcess,
  ClaudeEvent,
  SpawnWorkerRequest,
  SpawnWorkerResponse,
  PersistentWorker,
  AgentRole,
  SpawnMode,
} from '../types.js';
import type { SQLiteStorage } from '../storage/sqlite.js';
import { WorktreeManager } from './worktree.js';
import { MailStorage } from '../storage/mail.js';
import type { SpawnController } from './spawn-controller.js';
import type { FleetAgentRole } from './agent-roles.js';
import { getSystemPromptForRole } from './agent-roles.js';
import { NativeBridge } from './native-bridge.js';
import { TaskRouter } from './task-router.js';
import { NativeAdapter } from './coordination-adapter.js';
import type { CoordinationAdapter } from './coordination-adapter.js';
import { InboxBridge } from './inbox-bridge.js';
import { createLogParser } from './log-parser.js';
import type { LogParser } from './log-parser.js';
import { TaskSyncBridge } from './task-sync.js';
import { AgentMemory } from '../storage/agent-memory.js';
// Optional tmux support - gracefully handle when not available
let TmuxWorkerAdapter: typeof import('@claude-fleet/tmux').TmuxWorkerAdapter | null = null;
let ContextManager: typeof import('@claude-fleet/tmux').ContextManager | null = null;
try {
  const tmux = await import('@claude-fleet/tmux');
  TmuxWorkerAdapter = tmux.TmuxWorkerAdapter;
  ContextManager = tmux.ContextManager;
} catch {
  // @claude-fleet/tmux not available - tmux features disabled
}

const MAX_OUTPUT_LINES = 100;

export interface WorkerManagerEvents {
  'worker:ready': { workerId: string; handle: string; sessionId: string | null };
  'worker:output': { workerId: string; handle: string; event: ClaudeEvent };
  'worker:result': { workerId: string; handle: string; result: string; durationMs?: number };
  'worker:error': { workerId: string; handle: string; error: string };
  'worker:exit': { workerId: string; handle: string; code: number | null };
  'worker:unhealthy': { workerId: string; handle: string; reason: string };
  'worker:restart': { workerId: string; handle: string; restartCount: number };
}

const HEALTH_CHECK_INTERVAL = 15000; // 15 seconds
const HEALTHY_THRESHOLD = 30000; // 30 seconds without activity = degraded
const UNHEALTHY_THRESHOLD = 60000; // 60 seconds = unhealthy
const MAX_RESTART_ATTEMPTS = 3;

export interface WorkerManagerOptions {
  maxWorkers?: number;
  defaultTeamName?: string;
  serverUrl?: string;
  autoRestart?: boolean;
  storage?: SQLiteStorage;
  useWorktrees?: boolean;
  worktreeBaseDir?: string;
  injectMail?: boolean;
  spawnController?: SpawnController;
  defaultSpawnMode?: SpawnMode;
  /**
   * When true, reject all non-native spawn modes and use NativeAdapter directly.
   * Enables clean switchover to native TeammateTool once officially released.
   * Set via FLEET_NATIVE_ONLY=true.
   */
  nativeOnly?: boolean;
}

export class WorkerManager extends EventEmitter {
  private workers = new Map<string, WorkerProcess>();
  private maxWorkers: number;
  private defaultTeamName: string;
  private serverUrl: string;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private autoRestart: boolean;
  private restartHistory: number[] = []; // timestamps of restarts
  private storage: SQLiteStorage | null = null;
  private worktreeManager: WorktreeManager | null = null;
  private mailStorage: MailStorage | null = null;
  private useWorktrees: boolean;
  private injectMail: boolean;
  private spawnController: SpawnController | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tmuxAdapter: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private contextManager: any = null;
  private defaultSpawnMode: SpawnMode;
  private contextRolloverThreshold: number;
  private nativeBridge: NativeBridge | null = null;
  private taskRouter: TaskRouter | null = null;
  private coordinationAdapter: NativeAdapter | null = null;
  private inboxBridge: InboxBridge | null = null;
  private agentMemory: AgentMemory | null = null;
  private readonly nativeOnly: boolean;

  constructor(options: WorkerManagerOptions = {}) {
    super();
    this.contextRolloverThreshold = 0.7;
    this.maxWorkers = options.maxWorkers ?? 5;
    this.defaultTeamName = options.defaultTeamName ?? 'default';
    this.serverUrl = options.serverUrl ?? 'http://localhost:3847';
    this.autoRestart = options.autoRestart ?? true;
    this.storage = options.storage ?? null;
    this.useWorktrees = options.useWorktrees ?? false;
    this.injectMail = options.injectMail ?? true;
    this.spawnController = options.spawnController ?? null;
    this.defaultSpawnMode = options.defaultSpawnMode ?? 'process';
    this.nativeOnly = options.nativeOnly ?? false;

    if (this.useWorktrees) {
      this.worktreeManager = new WorktreeManager({
        baseDir: options.worktreeBaseDir,
      });
    }

    // Initialize mail storage and agent memory if storage is available
    if (this.storage) {
      this.mailStorage = new MailStorage(this.storage);
      this.agentMemory = new AgentMemory(this.storage);
    }

    // Initialize tmux adapter if available (tmux is kept even in native-only mode
    // since it provides interactive terminals — only process mode is deprecated)
    if (TmuxWorkerAdapter !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.tmuxAdapter = new (TmuxWorkerAdapter as any)();
      if (this.tmuxAdapter.isAvailable()) {
        console.log('[WORKER] Tmux spawning available');
        this.setupTmuxEventForwarding();
        // Initialize context manager for tmux workers
        if (ContextManager !== null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.contextManager = new (ContextManager as any)();
        }
      } else {
        console.log('[WORKER] Tmux not available, using process spawning only');
        this.tmuxAdapter = null;
      }
    } else {
      console.log('[WORKER] @claude-fleet/tmux not installed, tmux features disabled');
    }

    // Initialize task router for intelligent spawn decisions
    this.taskRouter = new TaskRouter(this.storage);

    // Initialize native bridge for native spawn mode
    this.nativeBridge = new NativeBridge();
    const nativeAvailability = this.nativeBridge.checkAvailability();
    if (nativeAvailability.isAvailable) {
      console.log(`[WORKER] Native spawning available (binary: ${nativeAvailability.claudeBinary})`);

      // Auto-promote to native mode if no explicit mode was requested
      if (!options.defaultSpawnMode) {
        this.defaultSpawnMode = 'native';
        console.log('[WORKER] Default spawn mode auto-promoted to "native"');
      }
    } else if (this.nativeOnly) {
      console.error('[WORKER] FLEET_NATIVE_ONLY=true but no Claude binary found!');
      console.error('[WORKER] Install Claude Code or set FLEET_NATIVE_ONLY=false');
    } else {
      console.log('[WORKER] Native features not available, native spawn mode will fall back to process');
    }

    // In native-only mode, force native as the default and disable process mode
    if (this.nativeOnly) {
      this.defaultSpawnMode = 'native';
      console.log('[WORKER] FLEET_NATIVE_ONLY=true — process spawn mode disabled, native+tmux available');
    }

    // Initialize inbox bridge for file-based messaging
    this.inboxBridge = new InboxBridge();

    // Initialize coordination adapter (native file-based coordination)
    // Pass a connected TaskSyncBridge so task assignments from native agents propagate to Fleet
    const taskSyncForAdapter = new TaskSyncBridge(this.storage);
    this.coordinationAdapter = new NativeAdapter(
      this.defaultTeamName,
      this.nativeBridge ?? undefined,
      taskSyncForAdapter,
      this.inboxBridge
    );
    console.log(`[WORKER] Coordination: adapter=native defaultMode=${this.defaultSpawnMode} nativeOnly=${this.nativeOnly}`);


    // Context rollover threshold (default 70%)
    this.contextRolloverThreshold = 0.7;

    this.startHealthCheck();
  }

  /**
   * Set up event forwarding from TmuxWorkerAdapter
   * Maps tmux adapter events to WorkerManager events for compatibility
   */
  private setupTmuxEventForwarding(): void {
    if (!this.tmuxAdapter) return;

    this.tmuxAdapter.on('worker:ready', (data: { workerId: string; handle: string; sessionId: string | null; paneId: string }) => {
      this.emit('worker:ready', {
        workerId: data.workerId,
        handle: data.handle,
        sessionId: data.sessionId,
      });
    });

    this.tmuxAdapter.on('worker:output', (data: { workerId: string; handle: string; text: string }) => {
      // Convert text output to ClaudeEvent format
      const event: ClaudeEvent = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: data.text }],
        },
      };
      this.emit('worker:output', {
        workerId: data.workerId,
        handle: data.handle,
        event,
      });
    });

    this.tmuxAdapter.on('worker:result', (data: { workerId: string; handle: string; result: string }) => {
      this.emit('worker:result', {
        workerId: data.workerId,
        handle: data.handle,
        result: data.result,
      });
    });

    this.tmuxAdapter.on('worker:error', (data: { workerId: string; handle: string; error: string }) => {
      this.emit('worker:error', {
        workerId: data.workerId,
        handle: data.handle,
        error: data.error,
      });
    });

    this.tmuxAdapter.on('worker:exit', (data: { workerId: string; handle: string }) => {
      this.emit('worker:exit', {
        workerId: data.workerId,
        handle: data.handle,
        code: null,
      });
    });
  }

  /**
   * Set the spawn controller (for late initialization)
   */
  setSpawnController(controller: SpawnController): void {
    this.spawnController = controller;
  }

  /**
   * Get the spawn controller
   */
  getSpawnController(): SpawnController | null {
    return this.spawnController;
  }

  /**
   * Initialize manager and restore workers from storage (crash recovery)
   */
  async initialize(): Promise<void> {
    if (!this.storage) {
      console.log('[WORKER] No storage configured, skipping crash recovery');
      return;
    }

    const persistedWorkers = this.storage.getActiveWorkers();
    console.log(`[WORKER] Found ${persistedWorkers.length} persisted workers`);

    // Clean up orphaned worktrees (from previous crashes)
    if (this.worktreeManager) {
      const activeWorkerIds = persistedWorkers.map(pw => pw.id);
      await this.worktreeManager.cleanupOrphaned(activeWorkerIds);
    }

    for (const pw of persistedWorkers) {
      try {
        // Check if process is still running
        if (pw.pid) {
          const isRunning = this.isProcessRunning(pw.pid);
          if (isRunning) {
            console.log(`[WORKER] Worker ${pw.handle} (PID ${pw.pid}) is still running`);
            // TODO: Reconnect to running process
            continue;
          }
        }

        // Attempt to restart the worker if it has a session to resume
        if (pw.sessionId) {
          console.log(`[WORKER] Attempting to restore ${pw.handle} with session ${pw.sessionId.slice(0, 8)}...`);
          await this.restoreWorker(pw);
        } else {
          // Mark as error if we can't restore
          this.storage.updateWorkerStatus(pw.id, 'error');
          console.log(`[WORKER] Cannot restore ${pw.handle} - no session ID`);
        }
      } catch (error) {
        console.error(`[WORKER] Failed to restore ${pw.handle}:`, (error as Error).message);
        this.storage.updateWorkerStatus(pw.id, 'error');
      }
    }
  }

  /**
   * Check if a process is running by PID
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restore a worker from persisted state
   */
  private async restoreWorker(pw: PersistentWorker): Promise<void> {
    // Verify worktree exists if one was configured
    if (pw.worktreePath) {
      const fs = await import('fs');
      if (!fs.existsSync(pw.worktreePath)) {
        throw new Error(`Worktree no longer exists: ${pw.worktreePath}`);
      }
    }

    // For restoration, we use --continue which loads the full conversation history.
    // We send a simple "continue" prompt instead of the original initialPrompt
    // since the context is already in the session history.
    const request: SpawnWorkerRequest = {
      handle: pw.handle,
      workingDir: pw.worktreePath ?? undefined,
      sessionId: pw.sessionId ?? undefined,
      // Don't re-send the initial prompt - use a continuation message instead
      initialPrompt: 'Continue from where you left off. The server was restarted.',
    };

    // Spawn with the existing worker ID (isRestore=true to skip insert)
    await this.spawnWorkerWithId(pw.id, request, pw.role, pw.restartCount + 1, true);
  }

  /**
   * Start periodic health checking
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.checkWorkerHealth();
    }, HEALTH_CHECK_INTERVAL);
  }

  /**
   * Check health of all workers
   */
  private checkWorkerHealth(): void {
    const now = Date.now();
    for (const worker of this.workers.values()) {
      if (worker.state === 'stopped' || worker.state === 'stopping') continue;

      const timeSinceHeartbeat = now - worker.lastHeartbeat;
      const previousHealth = worker.health;

      if (timeSinceHeartbeat > UNHEALTHY_THRESHOLD) {
        worker.health = 'unhealthy';
        if (previousHealth !== 'unhealthy') {
          console.log(`[HEALTH] ${worker.handle} is unhealthy (${Math.round(timeSinceHeartbeat / 1000)}s since activity)`);
          this.emit('worker:unhealthy', {
            workerId: worker.id,
            handle: worker.handle,
            reason: `No activity for ${Math.round(timeSinceHeartbeat / 1000)}s`,
          });

          // Auto-restart if enabled (skip external workers — they're managed externally)
          if (this.autoRestart && worker.spawnMode !== 'external' && worker.restartCount < MAX_RESTART_ATTEMPTS) {
            this.restartWorker(worker.id);
          }
        }
      } else if (timeSinceHeartbeat > HEALTHY_THRESHOLD) {
        worker.health = 'degraded';
      } else {
        worker.health = 'healthy';
      }

      // Check context usage for tmux workers
      if (worker.spawnMode === 'tmux' && worker.paneId && this.contextManager) {
        this.checkWorkerContext(worker);
      }
    }
  }

  /**
   * Check and handle context rollover for a tmux worker
   */
  private checkWorkerContext(worker: WorkerProcess): void {
    if (!this.contextManager || !worker.paneId) return;

    try {
      if (this.contextManager.needsTrim(worker.paneId, this.contextRolloverThreshold)) {
        const metrics = this.contextManager.analyzeContext(worker.paneId);
        console.log(`[CONTEXT] ${worker.handle} context at ${Math.round(metrics.usageRatio * 100)}% - initiating rollover`);

        // Emit event for monitoring
        this.emit('worker:context-high', {
          workerId: worker.id,
          handle: worker.handle,
          usageRatio: metrics.usageRatio,
          estimatedTokens: metrics.estimatedTokens,
        });

        // Perform context rollover - generate summary and start fresh session
        const summary = this.contextManager.generateContinueSummary(worker.paneId);
        this.contextManager.rolloverToNewPane(worker.paneId, {
          initialPrompt: `Continue from previous session. Summary:\n${summary.summary}`,
        }).then(({ paneId: newPaneId, summary: rolloverSummary }: { paneId: string; summary: string }) => {
          console.log(`[CONTEXT] ${worker.handle} rolled over to pane ${newPaneId}`);
          worker.paneId = newPaneId;

          this.emit('worker:context-rollover', {
            workerId: worker.id,
            handle: worker.handle,
            newPaneId,
            summary: rolloverSummary,
          });
        }).catch((error: Error) => {
          console.error(`[CONTEXT] Failed to rollover ${worker.handle}:`, error.message);
        });
      }
    } catch (error) {
      // Context analysis failed, skip this check
      console.warn(`[CONTEXT] Failed to analyze context for ${worker.handle}:`, (error as Error).message);
    }
  }

  /**
   * Restart a worker
   */
  async restartWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    const restartCount = worker.restartCount + 1;
    console.log(`[RESTART] Restarting ${worker.handle} (attempt ${restartCount}/${MAX_RESTART_ATTEMPTS})`);

    // Save worker config for respawn
    const config: SpawnWorkerRequest = {
      handle: worker.handle,
      teamName: worker.teamName,
      workingDir: worker.workingDir,
      sessionId: worker.sessionId ?? undefined,
    };

    // Dismiss the old worker
    await this.dismissWorker(workerId);

    // Track restart
    this.restartHistory.push(Date.now());

    // Respawn with incremented restart count
    try {
      const newWorker = await this.spawnWorker(config);
      const newProcess = this.workers.get(newWorker.id);
      if (newProcess) {
        newProcess.restartCount = restartCount;
      }
      this.emit('worker:restart', {
        workerId: newWorker.id,
        handle: worker.handle,
        restartCount,
      });
    } catch (error) {
      console.error(`[RESTART] Failed to restart ${worker.handle}:`, (error as Error).message);
    }
  }

  /**
   * Get restart stats
   */
  getRestartStats(): { total: number; lastHour: number } {
    const oneHourAgo = Date.now() - 3600000;
    return {
      total: this.restartHistory.length,
      lastHour: this.restartHistory.filter(t => t > oneHourAgo).length,
    };
  }

  /**
   * Update worker heartbeat
   */
  private updateHeartbeat(worker: WorkerProcess): void {
    const now = Date.now();
    worker.lastHeartbeat = now;
    if (worker.health === 'unhealthy' || worker.health === 'degraded') {
      worker.health = 'healthy';
    }

    // Persist heartbeat to storage (throttled - every 10 seconds)
    if (this.storage && (!worker.lastHeartbeat || now - worker.lastHeartbeat > 10000)) {
      this.storage.updateWorkerHeartbeat(worker.id, now);
    }
  }

  /**
   * Register an externally-managed worker (e.g., compound runner tmux workers).
   * Creates a WorkerProcess entry without spawning a real process.
   */
  registerExternalWorker(
    handle: string,
    teamName: string,
    workingDir: string,
    swarmId?: string,
  ): SpawnWorkerResponse {
    const existingWorker = this.getWorkerByHandle(handle);
    if (existingWorker) {
      return {
        id: existingWorker.id,
        handle: existingWorker.handle,
        teamName: existingWorker.teamName,
        workingDir: existingWorker.workingDir,
        state: existingWorker.state,
        spawnedAt: existingWorker.spawnedAt,
        spawnMode: existingWorker.spawnMode,
      };
    }

    const workerId = uuidv4();
    const now = Date.now();

    const worker: WorkerProcess = {
      id: workerId,
      handle,
      teamName,
      process: null as unknown as WorkerProcess['process'],
      sessionId: null,
      workingDir,
      state: 'ready',
      health: 'healthy',
      spawnedAt: now,
      lastHeartbeat: now,
      recentOutput: [],
      currentTaskId: null,
      restartCount: 0,
      spawnMode: 'external',
      swarmId,
    };

    this.workers.set(workerId, worker);

    if (this.storage) {
      this.storage.insertWorker({
        id: workerId,
        handle,
        status: 'ready',
        worktreePath: null,
        worktreeBranch: null,
        pid: null,
        sessionId: null,
        initialPrompt: null,
        lastHeartbeat: now,
        restartCount: 0,
        role: 'worker',
        swarmId: swarmId ?? null,
        depthLevel: 1,
        spawnMode: 'external',
        paneId: null,
        createdAt: now,
        dismissedAt: null,
      });
    }

    this.emit('worker:ready', { workerId, handle, sessionId: null });

    return {
      id: workerId,
      handle,
      teamName,
      workingDir,
      state: 'ready',
      spawnedAt: now,
      spawnMode: 'external',
    };
  }

  /**
   * Inject output from an externally-managed worker.
   * Updates heartbeat and emits worker:output event for WebSocket broadcast.
   */
  injectWorkerOutput(handle: string, event: ClaudeEvent): void {
    const worker = this.getWorkerByHandle(handle);
    if (!worker) return;

    worker.lastHeartbeat = Date.now();
    worker.health = 'healthy';

    worker.recentOutput.push(JSON.stringify(event));
    if (worker.recentOutput.length > MAX_OUTPUT_LINES) {
      worker.recentOutput.shift();
    }

    this.emit('worker:output', { workerId: worker.id, handle, event });
  }

  /**
   * Spawn a new Claude Code worker instance
   */
  async spawnWorker(
    request: SpawnWorkerRequest & { role?: AgentRole; swarmId?: string; depthLevel?: number }
  ): Promise<SpawnWorkerResponse> {
    if (this.workers.size >= this.maxWorkers) {
      throw new Error(`Maximum workers (${this.maxWorkers}) reached`);
    }

    // Check with spawn controller if available
    if (this.spawnController) {
      const role = (request.role ?? 'worker') as FleetAgentRole;
      const depthLevel = request.depthLevel ?? 1;
      const check = this.spawnController.canSpawn('lead', depthLevel - 1, role);

      if (!check.allowed) {
        throw new Error(check.reason ?? 'Spawn not allowed');
      }

      if (check.warning) {
        console.warn(`[SPAWN] Warning: ${check.warning}`);
      }
    }

    // Check if worker with this handle already exists
    const existingWorker = this.getWorkerByHandle(request.handle);
    if (existingWorker) {
      throw new Error(`Worker with handle '${request.handle}' already exists`);
    }

    // Also check storage for existing worker
    if (this.storage) {
      const existingPersisted = this.storage.getWorkerByHandle(request.handle);
      // Allow respawning dismissed or errored workers
      const canRespawn = !existingPersisted ||
        existingPersisted.status === 'dismissed' ||
        existingPersisted.status === 'error';
      if (!canRespawn) {
        throw new Error(`Worker with handle '${request.handle}' exists in storage (status: ${existingPersisted?.status})`);
      }
      // Delete old record to avoid UNIQUE constraint violation
      if (existingPersisted) {
        this.storage.deleteWorkerByHandle(request.handle);
      }
    }

    const workerId = uuidv4();
    return this.spawnWorkerWithId(
      workerId,
      request,
      request.role ?? 'worker',
      0,
      false,
      request.swarmId,
      request.depthLevel ?? 1
    );
  }

  /**
   * Internal method to spawn worker with a specific ID (used for restore/restart)
   */
  private async spawnWorkerWithId(
    workerId: string,
    request: SpawnWorkerRequest,
    role: AgentRole,
    restartCount: number,
    isRestore = false,
    swarmId?: string,
    depthLevel = 1
  ): Promise<SpawnWorkerResponse> {
    const teamName = request.teamName ?? this.defaultTeamName;
    const spawnMode: SpawnMode = request.spawnMode ?? this.defaultSpawnMode;

    // FLEET_NATIVE_ONLY enforcement: reject deprecated process spawn mode
    if (this.nativeOnly && spawnMode === 'process') {
      throw new Error(
        'Spawn mode \'process\' is not allowed in native-only mode (FLEET_NATIVE_ONLY=true). ' +
        'Use \'native\', \'tmux\', or \'external\' instead.'
      );
    }

    // Delegate to tmux adapter if spawn mode is 'tmux' and adapter is available
    if (spawnMode === 'tmux' && this.tmuxAdapter) {
      return this.spawnTmuxWorker(workerId, request, role, teamName);
    }

    // Delegate to native bridge if spawn mode is 'native'
    if (spawnMode === 'native') {
      if (this.nativeBridge && !this.nativeBridge.shouldFallback()) {
        return this.spawnNativeWorker(workerId, request, role, teamName, restartCount, isRestore, swarmId, depthLevel);
      }
      // Fall back to process mode (only allowed when not in native-only mode)
      if (this.nativeOnly) {
        throw new Error('Native mode required (FLEET_NATIVE_ONLY=true) but Claude binary not found');
      }
      console.log('[WORKER] Native mode unavailable, falling back to process mode');
    }

    let workingDir = request.workingDir ?? process.cwd();
    let worktreePath: string | null = null;
    let worktreeBranch: string | null = null;

    // Only create worktrees when no explicit workingDir was provided.
    // External repos should be used directly — worktrees only make sense
    // for the Fleet project's own git repo.
    const hasExplicitWorkingDir = Boolean(request.workingDir);

    // Create worktree if enabled (skip on restore or explicit workingDir)
    if (this.useWorktrees && this.worktreeManager && !isRestore && !hasExplicitWorkingDir) {
      try {
        const worktree = await this.worktreeManager.create(workerId);
        workingDir = worktree.path;
        worktreePath = worktree.path;
        worktreeBranch = worktree.branch;
        console.log(`[WORKER] Created worktree: ${worktreePath} (branch: ${worktreeBranch})`);
      } catch (error) {
        console.error('[WORKER] Failed to create worktree:', (error as Error).message);
        // Continue without worktree
      }
    }

    // Build Claude Code arguments
    // Use --print for single-shot execution with JSON output.
    // NOTE: Claude's binary has special stdio handling that doesn't work well with
    // Node's spawn pipes. We must use shell mode with explicit echo piping.
    const claudeArgs = [
      '--print',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
    ];

    // For crash recovery, use --resume with the session ID to restore conversation context.
    // --resume <session_id> preserves both the session ID and full conversation history.
    // This was verified to work correctly with --print mode.
    if (isRestore && request.sessionId) {
      claudeArgs.push('--resume', request.sessionId);
      console.log(`[WORKER] Using --resume ${request.sessionId.slice(0, 8)}... to restore session context`);
    }

    // Build the full prompt
    let fullPrompt = '';

    // Inject pending mail if enabled
    if (this.injectMail && this.mailStorage) {
      const pendingContext = this.mailStorage.formatAllPendingForInjection(request.handle);
      if (pendingContext) {
        fullPrompt += `# Pending Communications\n\n${pendingContext}\n\n---\n\n`;
        console.log(`[WORKER] Injected pending mail/handoffs for ${request.handle}`);
      }
    }

    // Add role-specific system prompt if available
    const fleetRole = role as FleetAgentRole;
    const rolePrompt = getSystemPromptForRole(fleetRole);
    if (rolePrompt) {
      fullPrompt += `${rolePrompt}\n\n---\n\n`;
    } else {
      // Fallback to basic role context
      fullPrompt += `You are a ${role} agent. Your handle is "${request.handle}".\n\n`;
    }

    // Inject agent memories from previous sessions
    if (this.agentMemory) {
      const memories = this.agentMemory.getAll(request.handle, 10);
      if (memories.length > 0) {
        const formatted = memories.map((m) => `- [${m.memoryType}] ${m.key}: ${m.value}`).join('\n');
        fullPrompt += `# Agent Memory\n\n${formatted}\n\n---\n\n`;
      }
    }

    // Add initial prompt if provided
    if (request.initialPrompt) {
      fullPrompt += `# Your Task\n\n${request.initialPrompt}`;
    }

    // Build the shell command - escape single quotes in prompt
    const escapedPrompt = fullPrompt.replace(/'/g, "'\\''");
    const argsStr = claudeArgs.join(' ');
    const shellCmd = `echo '${escapedPrompt}' | claude ${argsStr}`;

    // Debug: log the shell command (truncated for readability)
    console.log(`[WORKER] Shell cmd for ${request.handle}: claude ${argsStr}`);

    // Spawn using shell - required because Claude's binary has special stdio handling
    const proc = spawn('sh', ['-c', shellCmd], {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],  // No stdin needed - prompt is in command
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        CLAUDE_CODE_TEAM_NAME: teamName,
        CLAUDE_CODE_AGENT_TYPE: role,
        CLAUDE_CODE_AGENT_NAME: request.handle,
        CLAUDE_FLEET_URL: this.serverUrl,
      },
    });

    const now = Date.now();
    // spawnMode already determined above, defaults to 'process' for this code path
    const worker: WorkerProcess = {
      id: workerId,
      handle: request.handle,
      teamName,
      process: proc,
      sessionId: request.sessionId ?? null,
      workingDir,
      state: 'starting',
      recentOutput: [],
      spawnedAt: now,
      currentTaskId: null,
      lastHeartbeat: now,
      restartCount,
      health: 'healthy',
      swarmId,
      depthLevel,
      spawnMode,
    };

    this.workers.set(workerId, worker);
    this.setupProcessHandlers(worker);

    // Persist to storage (skip insert on restore - record already exists)
    if (this.storage && !isRestore) {
      const persistentWorker: PersistentWorker = {
        id: workerId,
        handle: request.handle,
        status: 'pending',
        worktreePath,
        worktreeBranch,
        pid: proc.pid ?? null,
        sessionId: request.sessionId ?? null,
        initialPrompt: request.initialPrompt ?? null,
        lastHeartbeat: now,
        restartCount,
        role,
        swarmId: swarmId ?? null,
        depthLevel,
        spawnMode,
        paneId: null, // Only set for tmux spawn mode
        createdAt: Math.floor(now / 1000),
        dismissedAt: null,
      };
      this.storage.insertWorker(persistentWorker);
    } else if (this.storage && isRestore) {
      // Update existing record with new PID
      this.storage.updateWorkerPid(workerId, proc.pid ?? 0, request.sessionId ?? null);
      this.storage.updateWorkerStatus(workerId, 'pending');
    }

    // Register with spawn controller if available
    if (this.spawnController && proc.pid) {
      this.spawnController.registerSpawn(proc.pid, request.handle, workerId);
    }

    console.log(`[WORKER] Spawned ${request.handle} (${workerId.slice(0, 8)}...) role=${role}`);

    return {
      id: workerId,
      handle: worker.handle,
      teamName: worker.teamName,
      workingDir: worker.workingDir,
      state: worker.state,
      spawnedAt: worker.spawnedAt,
      spawnMode,
    };
  }

  /**
   * Spawn a worker using the tmux adapter.
   * Creates a visible tmux pane with Claude Code running interactively.
   * Preferred for long-running agents that need monitoring or human interaction.
   */
  private async spawnTmuxWorker(
    _workerId: string,
    request: SpawnWorkerRequest,
    role: AgentRole,
    teamName: string
  ): Promise<SpawnWorkerResponse> {
    if (!this.tmuxAdapter) {
      throw new Error('Tmux adapter not available');
    }

    const workingDir = request.workingDir ?? process.cwd();

    // Build native env vars so tmux workers also participate in file-based coordination
    const nativeEnv = this.nativeBridge
      ? this.nativeBridge.buildNativeEnv(request.handle, teamName, role)
      : {};

    // Spawn via tmux adapter
    const tmuxResult = await this.tmuxAdapter.spawnWorker({
      handle: request.handle,
      teamName,
      workingDir,
      initialPrompt: request.initialPrompt,
      role,
      model: request.model,
      env: nativeEnv,
    });

    const now = Date.now();

    // Create a minimal WorkerProcess for tracking (no actual process since it's in tmux)
    // We use a dummy process that's immediately "stopped" since the real process is in tmux
    const dummyProcess = spawn('echo', ['tmux-worker'], { stdio: 'ignore' });

    const worker: WorkerProcess = {
      id: tmuxResult.id,
      handle: request.handle,
      teamName,
      process: dummyProcess,
      sessionId: null, // Will be updated when tmux worker reports ready
      workingDir,
      state: 'starting',
      recentOutput: [],
      spawnedAt: now,
      currentTaskId: null,
      lastHeartbeat: now,
      restartCount: 0,
      health: 'healthy',
      spawnMode: 'tmux',
      paneId: tmuxResult.paneId,
    };

    this.workers.set(tmuxResult.id, worker);

    // Persist to storage
    if (this.storage) {
      const persistentWorker: PersistentWorker = {
        id: tmuxResult.id,
        handle: request.handle,
        status: 'pending',
        worktreePath: null,
        worktreeBranch: null,
        pid: null,
        sessionId: null,
        initialPrompt: request.initialPrompt ?? null,
        lastHeartbeat: now,
        restartCount: 0,
        role,
        swarmId: null,
        depthLevel: 1,
        spawnMode: 'tmux',
        paneId: tmuxResult.paneId,
        createdAt: Math.floor(now / 1000),
        dismissedAt: null,
      };
      this.storage.insertWorker(persistentWorker);
    }

    console.log(`[WORKER] Spawned tmux worker ${request.handle} (pane: ${tmuxResult.paneId})`);

    return {
      id: tmuxResult.id,
      handle: request.handle,
      teamName,
      workingDir,
      state: 'starting',
      spawnedAt: now,
      spawnMode: 'tmux',
      paneId: tmuxResult.paneId,
    };
  }

  /**
   * Spawn a worker using the native bridge.
   * Uses Claude Code's built-in TeammateTool env vars and monitors
   * ~/.claude/tasks/ for task status changes.
   */
  private async spawnNativeWorker(
    workerId: string,
    request: SpawnWorkerRequest,
    role: AgentRole,
    teamName: string,
    restartCount: number,
    isRestore: boolean,
    swarmId?: string,
    depthLevel = 1
  ): Promise<SpawnWorkerResponse> {
    if (!this.nativeBridge) {
      throw new Error('Native bridge not initialized');
    }

    this.nativeBridge.prepareForSpawn(teamName);

    const workingDir = request.workingDir ?? process.cwd();
    const nativeEnv = this.nativeBridge.buildNativeEnv(request.handle, teamName, role);

    // Build prompt with team context
    let fullPrompt = '';

    // Inject pending mail if enabled
    if (this.injectMail && this.mailStorage) {
      const pendingContext = this.mailStorage.formatAllPendingForInjection(request.handle);
      if (pendingContext) {
        fullPrompt += `# Pending Communications\n\n${pendingContext}\n\n---\n\n`;
      }
    }

    // Add role-specific system prompt
    const fleetRole = role as FleetAgentRole;
    const rolePrompt = getSystemPromptForRole(fleetRole);
    if (rolePrompt) {
      fullPrompt += `${rolePrompt}\n\n---\n\n`;
    } else {
      fullPrompt += `You are a ${role} agent. Your handle is "${request.handle}".\n\n`;
    }

    // Add team context for native mode
    fullPrompt += `# Team Context\n\nTeam: ${teamName} | Agent ID: ${nativeEnv.CLAUDE_CODE_AGENT_ID}\n\n`;

    // Inject agent memories from previous sessions
    if (this.agentMemory) {
      const memories = this.agentMemory.getAll(request.handle, 10);
      if (memories.length > 0) {
        const formatted = memories.map((m) => `- [${m.memoryType}] ${m.key}: ${m.value}`).join('\n');
        fullPrompt += `# Agent Memory\n\n${formatted}\n\n---\n\n`;
      }
    }

    if (request.initialPrompt) {
      fullPrompt += `# Your Task\n\n${request.initialPrompt}`;
    }

    // Build Claude args
    const claudeBinary = this.nativeBridge.getClaudeBinary();
    const claudeArgs = ['--print', '--output-format', 'stream-json', '--dangerously-skip-permissions'];

    if (isRestore && request.sessionId) {
      claudeArgs.push('--resume', request.sessionId);
    }

    const escapedPrompt = fullPrompt.replace(/'/g, "'\\''");
    const argsStr = claudeArgs.join(' ');
    const shellCmd = `echo '${escapedPrompt}' | ${claudeBinary} ${argsStr}`;

    const proc = spawn('sh', ['-c', shellCmd], {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        ...nativeEnv,
      },
    });

    const now = Date.now();
    const worker: WorkerProcess = {
      id: workerId,
      handle: request.handle,
      teamName,
      process: proc,
      sessionId: request.sessionId ?? null,
      workingDir,
      state: 'starting',
      recentOutput: [],
      spawnedAt: now,
      currentTaskId: null,
      lastHeartbeat: now,
      restartCount,
      health: 'healthy',
      swarmId,
      depthLevel,
      spawnMode: 'native',
    };

    this.workers.set(workerId, worker);
    this.setupProcessHandlers(worker);

    // Persist to storage
    if (this.storage && !isRestore) {
      const persistentWorker: PersistentWorker = {
        id: workerId,
        handle: request.handle,
        status: 'pending',
        worktreePath: null,
        worktreeBranch: null,
        pid: proc.pid ?? null,
        sessionId: request.sessionId ?? null,
        initialPrompt: request.initialPrompt ?? null,
        lastHeartbeat: now,
        restartCount,
        role,
        swarmId: swarmId ?? null,
        depthLevel,
        spawnMode: 'native',
        paneId: null,
        createdAt: Math.floor(now / 1000),
        dismissedAt: null,
      };
      this.storage.insertWorker(persistentWorker);
    } else if (this.storage && isRestore) {
      this.storage.updateWorkerPid(workerId, proc.pid ?? 0, request.sessionId ?? null);
      this.storage.updateWorkerStatus(workerId, 'pending');
    }

    if (this.spawnController && proc.pid) {
      this.spawnController.registerSpawn(proc.pid, request.handle, workerId);
    }

    console.log(`[WORKER] Spawned native worker ${request.handle} (${workerId.slice(0, 8)}...) role=${role}`);

    return {
      id: workerId,
      handle: request.handle,
      teamName,
      workingDir,
      state: 'starting',
      spawnedAt: now,
      spawnMode: 'native',
    };
  }

  /**
   * Set up event handlers for a worker process
   */
  private setupProcessHandlers(worker: WorkerProcess): void {
    // Native log parser with ring buffer (falls back to JS if Rust not compiled)
    const logParser: LogParser = createLogParser();

    // Handle stdout (NDJSON events) — delegate to native batch parser
    worker.process.stdout?.on('data', (data: Buffer) => {
      const events = logParser.parseBatch(data.toString());

      for (const event of events) {
        this.updateHeartbeat(worker);

        // Track session ID from init
        if (event.eventType === 'system' && event.subtype === 'init' && event.sessionId) {
          worker.sessionId = event.sessionId;
          worker.state = 'ready';
          console.log(`[WORKER] ${worker.handle} event: system:init`);

          if (this.storage) {
            this.storage.updateWorkerPid(worker.id, worker.process?.pid ?? 0, event.sessionId);
            this.storage.updateWorkerStatus(worker.id, 'ready');
          }

          console.log(`[WORKER] ${worker.handle} ready (session: ${event.sessionId.slice(0, 8)}...)`);
          this.emit('worker:ready', {
            workerId: worker.id,
            handle: worker.handle,
            sessionId: worker.sessionId,
          });
        }

        // Track working state + extract text
        if (event.eventType === 'assistant') {
          worker.state = 'working';
          if (event.text) {
            this.addOutput(worker, event.text);
          }
        }

        // Track completion
        if (event.eventType === 'result') {
          worker.state = 'ready';
          if (event.text) {
            this.addOutput(worker, `[result] ${event.text}`);
          }
          this.emit('worker:result', {
            workerId: worker.id,
            handle: worker.handle,
            result: event.text ?? '',
          });
        }

        // Emit general output event (reconstruct ClaudeEvent shape for compatibility)
        this.emit('worker:output', {
          workerId: worker.id,
          handle: worker.handle,
          event: {
            type: event.eventType,
            subtype: event.subtype,
            session_id: event.sessionId,
          },
        });
      }

      // Non-JSON lines are captured by logParser internally;
      // sync output from the native parser for this chunk
      const recentNonJson = logParser.getRecentOutput(10);
      for (const line of recentNonJson) {
        if (!worker.recentOutput.includes(line)) {
          this.addOutput(worker, line);
        }
      }
    });

    // Handle stderr
    worker.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text && !text.includes('deprecated')) {
        console.log(`[WORKER] ${worker.handle} stderr: ${text.slice(0, 200)}`);
        this.addOutput(worker, `[stderr] ${text}`);
        this.emit('worker:error', {
          workerId: worker.id,
          handle: worker.handle,
          error: text,
        });
      }
    });

    // Handle process exit
    worker.process.on('close', (code) => {
      const wasIntentionallyDismissed = worker.state === 'stopping';
      worker.state = 'stopped';
      console.log(`[WORKER] ${worker.handle} exited with code ${code}`);

      // Update storage - keep 'dismissed' if intentionally stopped, else 'error' for unexpected exit
      if (this.storage) {
        const status = wasIntentionallyDismissed || code === 0 ? 'dismissed' : 'error';
        this.storage.updateWorkerStatus(worker.id, status);
      }

      // Clean up worktree if the worker exited successfully (not during recovery scenario)
      if (this.worktreeManager && (wasIntentionallyDismissed || code === 0)) {
        this.worktreeManager.remove(worker.id).catch(err => {
          console.error(`[WORKER] Failed to cleanup worktree for ${worker.handle}:`, err.message);
        });
      }

      this.emit('worker:exit', {
        workerId: worker.id,
        handle: worker.handle,
        code,
      });
      this.workers.delete(worker.id);
    });

    // Handle process errors
    worker.process.on('error', (err) => {
      console.error(`[WORKER] ${worker.handle} error:`, err.message);

      // Update storage
      if (this.storage) {
        this.storage.updateWorkerStatus(worker.id, 'error');
      }

      this.emit('worker:error', {
        workerId: worker.id,
        handle: worker.handle,
        error: err.message,
      });
    });
  }

  /**
   * Add output line to worker's recent output buffer.
   * Uses a ring buffer approach: when full, overwrites oldest entry
   * instead of Array.shift() which is O(n).
   */
  private addOutput(worker: WorkerProcess, line: string): void {
    if (worker.recentOutput.length < MAX_OUTPUT_LINES) {
      worker.recentOutput.push(line);
    } else {
      // Ring buffer: track head index on the array object
      const head = (worker.recentOutput as unknown as { __head?: number }).__head ?? 0;
      worker.recentOutput[head] = line;
      (worker.recentOutput as unknown as { __head: number }).__head = (head + 1) % MAX_OUTPUT_LINES;
    }
  }

  /**
   * Send a message to a worker
   */
  async sendToWorker(workerId: string, message: string): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker || worker.state === 'stopped') {
      return false;
    }

    // Handle tmux workers via adapter
    if (worker.spawnMode === 'tmux' && this.tmuxAdapter) {
      const success = await this.tmuxAdapter.sendToWorker(worker.handle, message);
      if (success) {
        worker.state = 'working';
        this.addOutput(worker, `[user] ${message}`);
      }
      return success;
    }

    // External workers don't have a process stdin
    if (worker.spawnMode === 'external' || !worker.process) {
      this.addOutput(worker, `[user] ${message}`);
      return false;
    }

    // Send plain text - Claude accepts plain text input with --print mode
    worker.process.stdin?.write(message + '\n');
    worker.state = 'working';
    this.addOutput(worker, `[user] ${message}`);
    return true;
  }

  /**
   * Deliver a task to a tmux worker
   * Formats and sends the task as a prompt to the worker
   */
  async deliverTaskToWorker(workerId: string, task: { id: string; title: string; description?: string }): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker || worker.state === 'stopped') {
      return false;
    }

    // Format task as a prompt
    const taskPrompt = `# Task Assignment

**Task ID:** ${task.id}
**Title:** ${task.title}
${task.description ? `\n**Description:**\n${task.description}` : ''}

Please work on this task. When complete, include "TASK COMPLETE" in your response.`;

    // Handle tmux workers via adapter
    if (worker.spawnMode === 'tmux' && this.tmuxAdapter) {
      const success = await this.tmuxAdapter.deliverTask(worker.handle, {
        id: task.id,
        title: task.title,
        description: task.description,
      });
      if (success) {
        worker.currentTaskId = task.id;
        worker.state = 'working';
        this.addOutput(worker, `[task] Assigned: ${task.title}`);
      }
      return success;
    }

    // For process workers, send via stdin
    worker.currentTaskId = task.id;
    return this.sendToWorker(workerId, taskPrompt);
  }

  /**
   * Send a message to a worker by handle
   */
  async sendToWorkerByHandle(handle: string, message: string): Promise<boolean> {
    const worker = this.getWorkerByHandle(handle);
    if (!worker) return false;
    return this.sendToWorker(worker.id, message);
  }

  /**
   * Dismiss (terminate) a worker
   * @param workerId - The worker ID to dismiss
   * @param cleanupWorktree - Whether to clean up the worktree (default: true)
   */
  async dismissWorker(workerId: string, cleanupWorktree = true): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    console.log(`[WORKER] Dismissing ${worker.handle}`);
    worker.state = 'stopping';

    // Unregister from spawn controller
    if (this.spawnController && worker.process?.pid) {
      this.spawnController.unregisterSpawn(worker.process.pid, worker.handle);
    }

    // Update storage
    if (this.storage) {
      this.storage.dismissWorker(workerId);
    }

    // External workers have no process to kill — just mark stopped
    if (worker.spawnMode === 'external' || !worker.process) {
      worker.state = 'stopped';
      this.workers.delete(workerId);
      this.emit('worker:exit', { workerId, handle: worker.handle, code: 0 });
      return;
    }

    // Close stdin to signal end
    worker.process.stdin?.end();

    // Send SIGTERM
    worker.process.kill('SIGTERM');

    // Force kill after timeout
    const timeout = setTimeout(() => {
      if (worker.state !== 'stopped') {
        console.log(`[WORKER] Force killing ${worker.handle}`);
        worker.process.kill('SIGKILL');
      }
    }, 5000);

    // Wait for exit
    await new Promise<void>((resolve) => {
      const checkStopped = setInterval(() => {
        if (worker.state === 'stopped' || !this.workers.has(workerId)) {
          clearInterval(checkStopped);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });

    // Cleanup worktree if requested
    if (cleanupWorktree && this.worktreeManager) {
      try {
        await this.worktreeManager.remove(workerId);
      } catch (error) {
        console.error('[WORKER] Failed to cleanup worktree:', (error as Error).message);
      }
    }
  }

  /**
   * Dismiss a worker by handle
   */
  async dismissWorkerByHandle(handle: string, cleanupWorktree = true): Promise<void> {
    const worker = this.getWorkerByHandle(handle);
    if (!worker) return;
    await this.dismissWorker(worker.id, cleanupWorktree);
  }

  /**
   * Get a worker by ID
   */
  getWorker(workerId: string): WorkerProcess | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get a worker by handle
   */
  getWorkerByHandle(handle: string): WorkerProcess | undefined {
    for (const worker of this.workers.values()) {
      if (worker.handle === handle) {
        return worker;
      }
    }
    return undefined;
  }

  /**
   * Get all workers
   */
  getWorkers(): WorkerProcess[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get worker count
   */
  getWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * Get recent output from a worker
   */
  getWorkerOutput(workerId: string): string[] {
    const worker = this.workers.get(workerId);
    return worker?.recentOutput ?? [];
  }

  /**
   * Get a routing recommendation for a task.
   * Returns complexity, strategy, and model suggestion.
   */
  getRoutingRecommendation(task: {
    subject: string;
    description?: string | null;
    blockedBy?: string[];
  }): { complexity: string; strategy: string; model: string; confidence: number } | null {
    if (!this.taskRouter) return null;
    const decision = this.taskRouter.classify(task);
    return {
      complexity: decision.complexity,
      strategy: decision.strategy,
      model: decision.model,
      confidence: decision.confidence,
    };
  }

  /**
   * Get the task router instance (for direct access).
   */
  getTaskRouter(): TaskRouter | null {
    return this.taskRouter;
  }

  /**
   * Get worker health statistics
   */
  getHealthStats(): { total: number; healthy: number; degraded: number; unhealthy: number } {
    let healthy = 0, degraded = 0, unhealthy = 0;
    for (const worker of this.workers.values()) {
      if (worker.health === 'healthy') healthy++;
      else if (worker.health === 'degraded') degraded++;
      else unhealthy++;
    }
    return { total: this.workers.size, healthy, degraded, unhealthy };
  }

  /**
   * Dismiss all workers
   */
  async dismissAll(): Promise<void> {
    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    const workers = Array.from(this.workers.keys());
    await Promise.all(workers.map((id) => this.dismissWorker(id)));
  }

  /**
   * Get the worktree manager for external operations (commit, push, PR)
   */
  getWorktreeManager(): WorktreeManager | null {
    return this.worktreeManager;
  }

  /**
   * Get the tmux adapter for external operations (wave orchestration, etc.)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTmuxAdapter(): any {
    return this.tmuxAdapter;
  }

  /**
   * Check if tmux spawning is available
   */
  isTmuxAvailable(): boolean {
    return this.tmuxAdapter?.isAvailable() ?? false;
  }

  /**
   * Get persisted workers from storage (for UI/status)
   */
  getPersistedWorkers(): PersistentWorker[] {
    if (!this.storage) return [];
    return this.storage.getAllWorkers();
  }

  /**
   * Get the coordination adapter for external use (message routing, task assignment).
   */
  getCoordinationAdapter(): CoordinationAdapter | null {
    return this.coordinationAdapter;
  }

  /**
   * Get native integration status for introspection.
   */
  getNativeStatus(): {
    isAvailable: boolean;
    claudeBinary: string | null;
    activeAdapter: string;
    defaultSpawnMode: SpawnMode;
    nativeOnly: boolean;
  } {
    const availability = this.nativeBridge?.checkAvailability();
    return {
      isAvailable: availability?.isAvailable ?? false,
      claudeBinary: availability?.claudeBinary ?? null,
      activeAdapter: this.coordinationAdapter?.getActiveAdapterName() ?? 'http',
      defaultSpawnMode: this.defaultSpawnMode,
      nativeOnly: this.nativeOnly,
    };
  }

  /**
   * Get the native bridge for direct access (task file I/O).
   */
  getNativeBridge(): NativeBridge | null {
    return this.nativeBridge;
  }

  /**
   * Set the auth token on the coordination adapter (no-op for native).
   */
  setCoordinationAuthToken(token: string): void {
    this.coordinationAdapter?.setAuthToken(token);
  }

  /**
   * Get the inbox bridge for direct access (message watching).
   */
  getInboxBridge(): InboxBridge | null {
    return this.inboxBridge;
  }

  /**
   * Get the agent memory instance for introspection/stats.
   */
  getAgentMemory(): AgentMemory | null {
    return this.agentMemory;
  }
}
