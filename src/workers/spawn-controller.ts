/**
 * Spawn Controller
 *
 * Manages agent spawning with:
 * - Soft/hard agent limits
 * - Depth level tracking
 * - Spawn queue processing
 */

import { EventEmitter } from 'node:events';
import type { ISpawnQueueStorage } from '../storage/interfaces.js';
import type { WorkerManager } from './manager.js';
import type { FleetAgentRole } from './agent-roles.js';
import { getMaxDepthForRole, isSpawnAllowed } from './agent-roles.js';
import type { AgentRole } from '../types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Soft limit: Log warning when reached, but allow spawning */
export const SOFT_AGENT_LIMIT = 50;

/** Hard limit: Reject spawn attempts when reached */
export const HARD_AGENT_LIMIT = 100;

/** Maximum spawn depth to prevent runaway recursive spawns */
export const MAX_DEPTH_LEVEL = 3;

// ============================================================================
// TYPES
// ============================================================================

export interface SpawnCheckResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
}

export interface SpawnControllerEvents {
  'spawn:queued': { requestId: string; targetType: string };
  'spawn:approved': { requestId: string; targetType: string };
  'spawn:rejected': { requestId: string; reason: string };
  'spawn:completed': { requestId: string; workerId: string };
  'limit:soft': { current: number; limit: number };
  'limit:hard': { current: number; limit: number };
}

export interface SpawnControllerOptions {
  softLimit?: number;
  hardLimit?: number;
  maxDepth?: number;
  autoProcess?: boolean;
  processIntervalMs?: number;
}

// ============================================================================
// AGENT COUNTER
// ============================================================================

/**
 * Thread-safe counter for tracking concurrent agent count
 */
class AgentCounter {
  private count = 0;
  private pids: Set<number> = new Set();
  private handleToId: Map<string, string> = new Map();

  get current(): number {
    return this.count;
  }

  get activePids(): Set<number> {
    return new Set(this.pids);
  }

  increment(pid: number, handle: string, workerId: string): void {
    this.count++;
    if (pid) this.pids.add(pid);
    this.handleToId.set(handle, workerId);
  }

  decrement(pid: number, handle: string): void {
    this.count = Math.max(0, this.count - 1);
    if (pid) this.pids.delete(pid);
    this.handleToId.delete(handle);
  }

  getWorkerId(handle: string): string | undefined {
    return this.handleToId.get(handle);
  }

  reset(): void {
    this.count = 0;
    this.pids.clear();
    this.handleToId.clear();
  }
}

// ============================================================================
// SPAWN CONTROLLER
// ============================================================================

export class SpawnController extends EventEmitter {
  private counter: AgentCounter;
  private spawnQueue: ISpawnQueueStorage | null = null;
  private workerManager: WorkerManager | null = null;
  private softLimit: number;
  private hardLimit: number;
  private maxDepth: number;
  private processInterval: NodeJS.Timeout | null = null;
  private autoProcess: boolean;
  private processIntervalMs: number;

  constructor(options: SpawnControllerOptions = {}) {
    super();
    this.counter = new AgentCounter();
    this.softLimit = options.softLimit ?? SOFT_AGENT_LIMIT;
    this.hardLimit = options.hardLimit ?? HARD_AGENT_LIMIT;
    this.maxDepth = options.maxDepth ?? MAX_DEPTH_LEVEL;
    this.autoProcess = options.autoProcess ?? true;
    this.processIntervalMs = options.processIntervalMs ?? 5000;
  }

  /**
   * Initialize with dependencies
   */
  initialize(spawnQueue: ISpawnQueueStorage, workerManager: WorkerManager): void {
    this.spawnQueue = spawnQueue;
    this.workerManager = workerManager;

    // Sync counter with current workers
    const workers = workerManager.getWorkers();
    for (const worker of workers) {
      const pid = worker.process.pid ?? 0;
      this.counter.increment(pid, worker.handle, worker.id);
    }

    // Start auto-processing if enabled
    if (this.autoProcess) {
      this.startProcessing();
    }
  }

  /**
   * Check if a spawn is allowed
   */
  canSpawn(
    spawnerRole: FleetAgentRole,
    currentDepth: number,
    targetRole: FleetAgentRole
  ): SpawnCheckResult {
    const current = this.counter.current;

    // Check hard limit
    if (current >= this.hardLimit) {
      this.emit('limit:hard', { current, limit: this.hardLimit });
      return {
        allowed: false,
        reason: `Hard agent limit reached: ${current}/${this.hardLimit}`,
      };
    }

    // Check global depth limit
    if (currentDepth >= this.maxDepth) {
      return {
        allowed: false,
        reason: `Maximum spawn depth ${this.maxDepth} exceeded (current: ${currentDepth})`,
      };
    }

    // Check role-specific spawn permission
    const roleCheck = isSpawnAllowed(spawnerRole, currentDepth, targetRole);
    if (!roleCheck.allowed) {
      return {
        allowed: false,
        reason: roleCheck.reason,
      };
    }

    // Check soft limit (warning only)
    if (current >= this.softLimit) {
      this.emit('limit:soft', { current, limit: this.softLimit });
      return {
        allowed: true,
        warning: `Soft agent limit reached: ${current}/${this.softLimit}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Register a spawned worker
   */
  registerSpawn(pid: number, handle: string, workerId: string): void {
    this.counter.increment(pid, handle, workerId);
  }

  /**
   * Unregister a dismissed worker
   */
  unregisterSpawn(pid: number, handle: string): void {
    this.counter.decrement(pid, handle);
  }

  /**
   * Get current agent count
   */
  getCurrentCount(): number {
    return this.counter.current;
  }

  /**
   * Get limit information
   */
  getLimits(): { current: number; soft: number; hard: number; remaining: number } {
    const current = this.counter.current;
    return {
      current,
      soft: this.softLimit,
      hard: this.hardLimit,
      remaining: Math.max(0, this.hardLimit - current),
    };
  }

  /**
   * Start automatic queue processing
   */
  startProcessing(): void {
    if (this.processInterval) return;

    this.processInterval = setInterval(() => {
      this.processQueue().catch((err) => {
        console.error('[SPAWN] Queue processing error:', err);
      });
    }, this.processIntervalMs);
  }

  /**
   * Stop automatic queue processing
   */
  stopProcessing(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
  }

  /**
   * Process the spawn queue
   */
  async processQueue(): Promise<number> {
    if (!this.spawnQueue || !this.workerManager) {
      return 0;
    }

    const limits = this.getLimits();
    if (limits.remaining === 0) {
      return 0;
    }

    // Get ready items (limited by remaining capacity)
    const ready = await this.spawnQueue.getReadyItems(limits.remaining);
    let spawned = 0;

    for (const item of ready) {
      // Look up requester's role from worker manager (or use stored role from context)
      const context = item.payload.context as Record<string, unknown> | undefined;
      const storedRole = context?.requesterRole as FleetAgentRole | undefined;
      const requester = this.workerManager?.getWorkerByHandle(item.requesterHandle);
      // Use stored role, or look up from active worker, or default to 'worker'
      const spawnerRole: FleetAgentRole = storedRole ??
        (requester ? 'worker' as FleetAgentRole : 'lead' as FleetAgentRole);

      // Check spawn permission using requester's actual depth level
      const check = this.canSpawn(
        spawnerRole,
        item.depthLevel,  // This is the requester's current depth
        item.targetAgentType as FleetAgentRole
      );

      if (!check.allowed) {
        await this.spawnQueue.updateStatus(item.id, 'rejected');
        this.emit('spawn:rejected', { requestId: item.id, reason: check.reason ?? 'Unknown' });
        continue;
      }

      try {
        // Spawn the worker with swarmId and depthLevel + 1 (child is one level deeper)
        // Use first-class swarmId, falling back to context for backwards compatibility
        const swarmId = item.swarmId ?? (context?.swarmId as string | undefined);
        const worker = await this.workerManager.spawnWorker({
          handle: `${item.targetAgentType}-${item.id.slice(0, 8)}`,
          initialPrompt: item.payload.task,
          role: 'worker' as AgentRole,
          swarmId,
          depthLevel: item.depthLevel + 1,  // Child is one level deeper than parent
        });

        // Mark as spawned
        await this.spawnQueue.updateStatus(item.id, 'spawned', worker.id);
        this.emit('spawn:completed', { requestId: item.id, workerId: worker.id });
        spawned++;
      } catch (error) {
        console.error(`[SPAWN] Failed to spawn ${item.targetAgentType}:`, (error as Error).message);
        await this.spawnQueue.updateStatus(item.id, 'rejected');
        this.emit('spawn:rejected', {
          requestId: item.id,
          reason: (error as Error).message,
        });
      }
    }

    return spawned;
  }

  /**
   * Queue a spawn request
   */
  async queueSpawn(
    requesterHandle: string,
    targetAgentType: FleetAgentRole,
    depthLevel: number,
    task: string,
    options: {
      priority?: 'low' | 'normal' | 'high' | 'critical';
      dependsOn?: string[];
      swarmId?: string;
      context?: Record<string, unknown>;
    } = {}
  ): Promise<string | null> {
    if (!this.spawnQueue) {
      console.error('[SPAWN] Spawn queue not initialized');
      return null;
    }

    // Validate depth
    const maxRoleDepth = getMaxDepthForRole(targetAgentType);
    if (depthLevel > maxRoleDepth) {
      console.error(`[SPAWN] Depth ${depthLevel} exceeds max ${maxRoleDepth} for ${targetAgentType}`);
      return null;
    }

    const item = await this.spawnQueue.enqueue({
      requesterHandle,
      targetAgentType,
      depthLevel,
      priority: options.priority ?? 'normal',
      dependsOn: options.dependsOn ?? [],
      swarmId: options.swarmId ?? null,
      payload: { task, context: options.context },
    });

    this.emit('spawn:queued', { requestId: item.id, targetType: targetAgentType });
    return item.id;
  }

  /**
   * Get spawn queue statistics (sync version returns null for queue)
   */
  getQueueStats(): {
    queue: null;
    limits: ReturnType<SpawnController['getLimits']>;
  } {
    return {
      queue: null, // Use getQueueStatsAsync for queue stats
      limits: this.getLimits(),
    };
  }

  /**
   * Get spawn queue statistics (async version)
   */
  async getQueueStatsAsync(): Promise<{
    queue: Awaited<ReturnType<ISpawnQueueStorage['getQueueStats']>> | null;
    limits: ReturnType<SpawnController['getLimits']>;
  }> {
    return {
      queue: this.spawnQueue ? await this.spawnQueue.getQueueStats() : null,
      limits: this.getLimits(),
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopProcessing();
    this.counter.reset();
    this.removeAllListeners();
  }
}
