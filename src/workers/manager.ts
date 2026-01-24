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
} from '../types.js';
import type { SQLiteStorage } from '../storage/sqlite.js';
import { WorktreeManager } from './worktree.js';
import { MailStorage } from '../storage/mail.js';
import type { SpawnController } from './spawn-controller.js';
import type { FleetAgentRole } from './agent-roles.js';
import { getSystemPromptForRole } from './agent-roles.js';

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

const HEARTBEAT_INTERVAL = 10000; // 10 seconds
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

  constructor(options: WorkerManagerOptions = {}) {
    super();
    this.maxWorkers = options.maxWorkers ?? 5;
    this.defaultTeamName = options.defaultTeamName ?? 'default';
    this.serverUrl = options.serverUrl ?? 'http://localhost:3847';
    this.autoRestart = options.autoRestart ?? true;
    this.storage = options.storage ?? null;
    this.useWorktrees = options.useWorktrees ?? false;
    this.injectMail = options.injectMail ?? true;
    this.spawnController = options.spawnController ?? null;

    if (this.useWorktrees) {
      this.worktreeManager = new WorktreeManager({
        baseDir: options.worktreeBaseDir,
      });
    }

    // Initialize mail storage if storage is available
    if (this.storage) {
      this.mailStorage = new MailStorage(this.storage);
    }

    this.startHealthCheck();
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
    const request: SpawnWorkerRequest = {
      handle: pw.handle,
      workingDir: pw.worktreePath ?? undefined,
      sessionId: pw.sessionId ?? undefined,
      initialPrompt: pw.initialPrompt ?? undefined,
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

          // Auto-restart if enabled
          if (this.autoRestart && worker.restartCount < MAX_RESTART_ATTEMPTS) {
            this.restartWorker(worker.id);
          }
        }
      } else if (timeSinceHeartbeat > HEALTHY_THRESHOLD) {
        worker.health = 'degraded';
      } else {
        worker.health = 'healthy';
      }
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
    let workingDir = request.workingDir ?? process.cwd();
    let worktreePath: string | null = null;
    let worktreeBranch: string | null = null;

    // Create worktree if enabled (skip on restore - worktree already exists)
    if (this.useWorktrees && this.worktreeManager && !isRestore) {
      try {
        const worktree = await this.worktreeManager.create(workerId);
        workingDir = worktree.path;
        worktreePath = worktree.path;
        worktreeBranch = worktree.branch;
        console.log(`[WORKER] Created worktree: ${worktreePath} (branch: ${worktreeBranch})`);
      } catch (error) {
        console.error(`[WORKER] Failed to create worktree:`, (error as Error).message);
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

    // Resume session if provided
    if (request.sessionId) {
      claudeArgs.push('--resume', request.sessionId);
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

    // Add initial prompt if provided
    if (request.initialPrompt) {
      fullPrompt += `# Your Task\n\n${request.initialPrompt}`;
    }

    // Build the shell command - escape single quotes in prompt
    const escapedPrompt = fullPrompt.replace(/'/g, "'\\''");
    const argsStr = claudeArgs.join(' ');
    const shellCmd = `echo '${escapedPrompt}' | claude ${argsStr}`;


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
        CLAUDE_CODE_COLLAB_URL: this.serverUrl,
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
    };
  }

  /**
   * Set up event handlers for a worker process
   */
  private setupProcessHandlers(worker: WorkerProcess): void {
    let outputBuffer = '';

    // Handle stdout (NDJSON events)
    worker.process.stdout?.on('data', (data: Buffer) => {
      outputBuffer += data.toString();
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim()) {
          this.parseNdjsonLine(worker, line);
        }
      }
    });

    // Handle stderr
    worker.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text && !text.includes('deprecated')) {
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
   * Parse a single NDJSON line from Claude Code output
   */
  private parseNdjsonLine(worker: WorkerProcess, line: string): void {
    try {
      const event = JSON.parse(line) as ClaudeEvent;
      this.handleClaudeEvent(worker, event);
    } catch {
      // Not JSON, treat as plain text output
      this.addOutput(worker, line);
    }
  }

  /**
   * Handle a Claude Code event
   */
  private handleClaudeEvent(worker: WorkerProcess, event: ClaudeEvent): void {
    // Update heartbeat on any event
    this.updateHeartbeat(worker);

    // Track session ID from init
    if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
      worker.sessionId = event.session_id;
      worker.state = 'ready';

      // Persist session ID and update status to 'ready'
      if (this.storage) {
        this.storage.updateWorkerPid(worker.id, worker.process.pid ?? 0, event.session_id);
        this.storage.updateWorkerStatus(worker.id, 'ready');
      }

      console.log(`[WORKER] ${worker.handle} ready (session: ${event.session_id.slice(0, 8)}...)`);
      this.emit('worker:ready', {
        workerId: worker.id,
        handle: worker.handle,
        sessionId: worker.sessionId,
      });
    }

    // Track working state
    if (event.type === 'assistant') {
      worker.state = 'working';

      // Extract text content for output
      if (event.message?.content) {
        for (const content of event.message.content) {
          if (content.type === 'text' && content.text) {
            this.addOutput(worker, content.text);
          }
        }
      }
    }

    // Track completion
    if (event.type === 'result') {
      worker.state = 'ready';
      if (event.result) {
        this.addOutput(worker, `[result] ${event.result}`);
      }
      this.emit('worker:result', {
        workerId: worker.id,
        handle: worker.handle,
        result: event.result ?? '',
        durationMs: event.duration_ms,
      });
    }

    // Emit general output event
    this.emit('worker:output', {
      workerId: worker.id,
      handle: worker.handle,
      event,
    });
  }

  /**
   * Add output line to worker's recent output buffer
   */
  private addOutput(worker: WorkerProcess, line: string): void {
    worker.recentOutput.push(line);
    if (worker.recentOutput.length > MAX_OUTPUT_LINES) {
      worker.recentOutput.shift();
    }
  }

  /**
   * Send a message to a worker
   */
  sendToWorker(workerId: string, message: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker || worker.state === 'stopped') {
      return false;
    }

    // Send plain text - Claude accepts plain text input with --print mode
    worker.process.stdin?.write(message + '\n');
    worker.state = 'working';
    this.addOutput(worker, `[user] ${message}`);
    return true;
  }

  /**
   * Send a message to a worker by handle
   */
  sendToWorkerByHandle(handle: string, message: string): boolean {
    const worker = this.getWorkerByHandle(handle);
    if (!worker) return false;
    return this.sendToWorker(worker.id, message);
  }

  /**
   * Dismiss (terminate) a worker
   */
  async dismissWorker(workerId: string, cleanupWorktree = false): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    console.log(`[WORKER] Dismissing ${worker.handle}`);
    worker.state = 'stopping';

    // Unregister from spawn controller
    if (this.spawnController && worker.process.pid) {
      this.spawnController.unregisterSpawn(worker.process.pid, worker.handle);
    }

    // Update storage
    if (this.storage) {
      this.storage.dismissWorker(workerId);
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
        console.error(`[WORKER] Failed to cleanup worktree:`, (error as Error).message);
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
   * Get persisted workers from storage (for UI/status)
   */
  getPersistedWorkers(): PersistentWorker[] {
    if (!this.storage) return [];
    return this.storage.getAllWorkers();
  }
}
