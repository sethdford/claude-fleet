/**
 * Fleet Manager
 *
 * High-level API for multi-agent orchestration.
 */

import type { Worker, WorkerRole, WorkerStatus } from '@claude-fleet/common';
import { generateId } from '@claude-fleet/common';
import { WorkerStore, TaskStore, MailStore, CheckpointStore } from '@claude-fleet/storage';
import { WorktreeManager } from './worktree.js';
import { Blackboard } from './blackboard.js';
import { buildWorkerPrompt, hasPermission } from './roles.js';
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface SpawnOptions {
  handle: string;
  role?: WorkerRole;
  prompt?: string;
  worktree?: boolean;
  repoPath?: string;
}

export interface FleetConfig {
  maxWorkers?: number;
  heartbeatInterval?: number;
  staleThreshold?: number;
  worktreesEnabled?: boolean;
  repoPath?: string;
}

export interface FleetEvents {
  'worker:spawned': (worker: Worker) => void;
  'worker:ready': (worker: Worker) => void;
  'worker:dismissed': (worker: Worker) => void;
  'worker:error': (worker: Worker, error: Error) => void;
  'worker:stale': (worker: Worker) => void;
}

const DEFAULT_CONFIG: FleetConfig = {
  maxWorkers: 100,
  heartbeatInterval: 30000,
  staleThreshold: 60000,
  worktreesEnabled: true,
};

export class FleetManager extends EventEmitter {
  private config: FleetConfig;
  private workerStore: WorkerStore;
  private taskStore: TaskStore;
  private mailStore: MailStore;
  private checkpointStore: CheckpointStore;
  private blackboard: Blackboard;
  private worktreeManager?: WorktreeManager;
  private processes = new Map<string, ChildProcess>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(config: FleetConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.workerStore = new WorkerStore();
    this.taskStore = new TaskStore();
    this.mailStore = new MailStore();
    this.checkpointStore = new CheckpointStore();
    this.blackboard = new Blackboard();

    if (this.config.worktreesEnabled && this.config.repoPath) {
      this.worktreeManager = new WorktreeManager(this.config.repoPath);
    }
  }

  /**
   * Start the fleet manager
   */
  async start(): Promise<void> {
    // Recover workers from previous session
    await this.recover();

    // Start heartbeat monitoring
    this.heartbeatTimer = setInterval(
      () => this.checkHeartbeats(),
      this.config.heartbeatInterval!
    );
  }

  /**
   * Stop the fleet manager
   */
  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    // Dismiss all active workers
    const workers = this.workerStore.list({ status: ['pending', 'ready', 'busy'] });
    for (const worker of workers) {
      await this.dismiss(worker.handle);
    }
  }

  /**
   * Spawn a new worker
   */
  async spawn(options: SpawnOptions): Promise<Worker> {
    const { handle, role = 'worker', prompt, worktree = true, repoPath } = options;

    // Check if handle already exists
    const existing = this.workerStore.getByHandle(handle);
    if (existing && existing.status !== 'dismissed') {
      throw new Error(`Worker with handle "${handle}" already exists`);
    }

    // Check max workers
    const activeWorkers = this.workerStore.list({ status: ['pending', 'ready', 'busy'] });
    if (activeWorkers.length >= this.config.maxWorkers!) {
      throw new Error(`Maximum workers (${this.config.maxWorkers}) reached`);
    }

    // Create worker record
    const worker: Worker = {
      id: generateId(),
      handle,
      status: 'pending',
      role,
      initialPrompt: prompt,
      lastHeartbeat: Date.now(),
      restartCount: 0,
      createdAt: Date.now(),
    };

    // Create worktree if enabled
    if (worktree && this.worktreeManager) {
      const worktreeInfo = await this.worktreeManager.create(worker.id);
      worker.worktreePath = worktreeInfo.path;
      worker.worktreeBranch = worktreeInfo.branch;
    } else if (repoPath) {
      worker.worktreePath = repoPath;
    }

    // Save worker
    this.workerStore.upsert(worker);

    // Build initial prompt with role and pending mail
    const fullPrompt = this.buildWorkerContext(worker);

    // Spawn Claude Code process
    const proc = this.spawnProcess(worker, fullPrompt);
    this.processes.set(worker.id, proc);

    this.emit('worker:spawned', worker);

    return worker;
  }

  /**
   * Dismiss a worker
   */
  async dismiss(handle: string): Promise<boolean> {
    const worker = this.workerStore.getByHandle(handle);
    if (!worker) return false;

    // Kill process
    const proc = this.processes.get(worker.id);
    if (proc) {
      proc.kill();
      this.processes.delete(worker.id);
    }

    // Remove worktree
    if (worker.worktreePath && this.worktreeManager) {
      try {
        await this.worktreeManager.remove(worker.id);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Update status
    this.workerStore.updateStatus(worker.id, 'dismissed');

    this.emit('worker:dismissed', worker);

    return true;
  }

  /**
   * Get a worker by handle
   */
  getWorker(handle: string): Worker | undefined {
    return this.workerStore.getByHandle(handle);
  }

  /**
   * List all workers
   */
  listWorkers(options?: {
    status?: WorkerStatus | WorkerStatus[];
    role?: WorkerRole;
  }): Worker[] {
    return this.workerStore.list(options);
  }

  /**
   * Broadcast a message to all workers
   */
  broadcast(message: string, from?: string): void {
    this.blackboard.broadcast(message, from);
  }

  /**
   * Send a message to a specific worker
   */
  sendMessage(to: string, message: string, from: string, subject?: string): void {
    this.mailStore.send({
      from,
      to,
      subject,
      body: message,
    });
  }

  /**
   * Get pending messages for a worker
   */
  getMessages(handle: string): Array<{
    from: string;
    subject?: string;
    body: string;
    createdAt: number;
  }> {
    return this.mailStore.getUnread(handle).map((m) => ({
      from: m.from,
      subject: m.subject,
      body: m.body,
      createdAt: m.createdAt,
    }));
  }

  /**
   * Create a checkpoint for a worker
   */
  createCheckpoint(
    handle: string,
    checkpoint: {
      goal: string;
      worked?: string[];
      remaining?: string[];
      context?: Record<string, unknown>;
    }
  ): void {
    this.checkpointStore.create({
      workerHandle: handle,
      ...checkpoint,
    });
  }

  /**
   * Get the latest checkpoint for a worker
   */
  getCheckpoint(handle: string) {
    return this.checkpointStore.getLatest(handle);
  }

  /**
   * Handoff context from one worker to another
   */
  handoff(
    from: string,
    to: string,
    context: Record<string, unknown>
  ): void {
    this.mailStore.createHandoff({ from, to, context });
  }

  /**
   * Get fleet status
   */
  getStatus(): {
    totalWorkers: number;
    byStatus: Record<string, number>;
    byRole: Record<string, number>;
  } {
    const workers = this.workerStore.list({ includesDismissed: false });

    const byStatus: Record<string, number> = {};
    const byRole: Record<string, number> = {};

    for (const worker of workers) {
      byStatus[worker.status] = (byStatus[worker.status] || 0) + 1;
      byRole[worker.role || 'worker'] = (byRole[worker.role || 'worker'] || 0) + 1;
    }

    return {
      totalWorkers: workers.length,
      byStatus,
      byRole,
    };
  }

  /**
   * Access the blackboard
   */
  getBlackboard(): Blackboard {
    return this.blackboard;
  }

  /**
   * Access the task store
   */
  getTasks(): TaskStore {
    return this.taskStore;
  }

  /**
   * Recover workers from a previous session
   */
  private async recover(): Promise<void> {
    const recoverable = this.workerStore.getRecoverable();

    for (const worker of recoverable) {
      try {
        // Increment restart count
        const restarts = this.workerStore.incrementRestarts(worker.id);

        // Check if we've exceeded restart limit
        if (restarts > 3) {
          this.workerStore.updateStatus(worker.id, 'error');
          continue;
        }

        // Get checkpoint if available
        const checkpoint = this.checkpointStore.getLatest(worker.handle);

        // Build recovery prompt
        const fullPrompt = this.buildWorkerContext(worker, checkpoint);

        // Respawn process
        const proc = this.spawnProcess(worker, fullPrompt);
        this.processes.set(worker.id, proc);

        // Update status
        this.workerStore.updateStatus(worker.id, 'pending');
        this.workerStore.heartbeat(worker.id);

        console.log(`Recovered worker: ${worker.handle} (restart #${restarts})`);
      } catch (error) {
        console.error(`Failed to recover worker ${worker.handle}:`, error);
        this.workerStore.updateStatus(worker.id, 'error');
      }
    }
  }

  /**
   * Check for stale workers
   */
  private checkHeartbeats(): void {
    const stale = this.workerStore.getStale(this.config.staleThreshold!);

    for (const worker of stale) {
      this.emit('worker:stale', worker);

      // Mark as error and attempt recovery
      this.workerStore.updateStatus(worker.id, 'error');

      // Kill any orphaned process
      const proc = this.processes.get(worker.id);
      if (proc) {
        proc.kill();
        this.processes.delete(worker.id);
      }
    }
  }

  /**
   * Build worker context including role, mail, and checkpoint
   */
  private buildWorkerContext(
    worker: Worker,
    checkpoint?: ReturnType<CheckpointStore['getLatest']>
  ): string {
    const parts: string[] = [];

    // Role-based system prompt
    parts.push(buildWorkerPrompt(
      worker.handle,
      worker.role || 'worker',
      worker.initialPrompt
    ));

    // Pending mail
    const mailContext = this.mailStore.formatMailForPrompt(worker.handle);
    if (mailContext) {
      parts.push('\n' + mailContext);
    }

    // Checkpoint resume
    if (checkpoint) {
      parts.push('\n' + this.checkpointStore.formatForResume(checkpoint));
    }

    return parts.join('\n');
  }

  /**
   * Spawn a Claude Code process
   */
  private spawnProcess(worker: Worker, prompt: string): ChildProcess {
    const args = ['--print', prompt];

    if (worker.worktreePath) {
      args.unshift('--cwd', worker.worktreePath);
    }

    const proc = spawn('claude', args, {
      env: {
        ...process.env,
        CCT_WORKER_ID: worker.id,
        CCT_WORKER_HANDLE: worker.handle,
        CCT_WORKER_ROLE: worker.role || 'worker',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data) => {
      const output = data.toString();
      // Update worker status based on output
      if (output.includes('Ready') || output.includes('ready')) {
        this.workerStore.updateStatus(worker.id, 'ready');
        this.workerStore.heartbeat(worker.id);
        this.emit('worker:ready', worker);
      }
    });

    proc.stderr?.on('data', (data) => {
      console.error(`[${worker.handle}] ${data.toString()}`);
    });

    proc.on('exit', (code) => {
      if (code !== 0) {
        this.workerStore.updateStatus(worker.id, 'error');
        this.emit('worker:error', worker, new Error(`Process exited with code ${code}`));
      }
      this.processes.delete(worker.id);
    });

    proc.on('error', (error) => {
      this.workerStore.updateStatus(worker.id, 'error');
      this.emit('worker:error', worker, error);
    });

    return proc;
  }

  /**
   * Update worker heartbeat
   */
  heartbeat(handle: string): void {
    const worker = this.workerStore.getByHandle(handle);
    if (worker) {
      this.workerStore.heartbeat(worker.id);
    }
  }

  /**
   * Check if a worker has a permission
   */
  hasPermission(handle: string, permission: string): boolean {
    const worker = this.workerStore.getByHandle(handle);
    if (!worker) return false;

    return hasPermission(worker.role || 'worker', permission as keyof typeof import('./roles.js').ROLE_PERMISSIONS.worker);
  }
}
