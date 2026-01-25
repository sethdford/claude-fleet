/**
 * Wave Orchestrator
 *
 * Manages phased worker spawning with dependency management.
 * Enables complex multi-repository workflows with ordered execution.
 *
 * Key concepts:
 * - Wave: A group of workers that can run in parallel
 * - Phase: An ordered sequence of waves
 * - Dependencies: Workers that must complete before others start
 *
 * Example workflow:
 * Phase 1 (Setup): [lint-worker, type-check-worker]  <- parallel
 * Phase 2 (Test):  [test-worker]                     <- depends on phase 1
 * Phase 3 (Build): [build-worker, doc-worker]        <- parallel, depends on phase 2
 */

import { FleetTmuxManager, type FleetWorkerOptions } from './fleet-manager.js';
import { RemoteFleetManager, type RemoteWorkerOptions } from './remote-fleet-manager.js';
import { ContextManager } from './context-manager.js';
import { EventEmitter } from 'events';

export interface WaveWorker {
  /** Unique worker handle */
  handle: string;
  /** Worker role */
  role?: string;
  /** Command to execute */
  command?: string;
  /** Claude prompt (if spawning Claude worker) */
  prompt?: string;
  /** Working directory */
  cwd?: string;
  /** Worker handles this depends on */
  dependsOn?: string[];
  /** Timeout in ms (default: 300000 = 5min) */
  timeout?: number;
  /** Success pattern to detect completion */
  successPattern?: string | RegExp;
  /** Failure pattern to detect errors */
  failurePattern?: string | RegExp;
}

export interface Wave {
  /** Wave name for identification */
  name: string;
  /** Workers to spawn in this wave */
  workers: WaveWorker[];
  /** Only start after these waves complete */
  afterWaves?: string[];
  /** Continue even if some workers fail */
  continueOnFailure?: boolean;
}

export interface WaveResult {
  /** Wave name */
  wave: string;
  /** Worker handle */
  worker: string;
  /** Whether worker succeeded */
  success: boolean;
  /** Output from worker */
  output?: string;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  duration: number;
}

export interface OrchestratorConfig {
  /** Fleet name for session management */
  fleetName: string;
  /** Base working directory */
  baseCwd?: string;
  /** Use remote (headless) mode */
  remote?: boolean;
  /** Poll interval for checking worker status (ms) */
  pollInterval?: number;
  /** Default worker timeout (ms) */
  defaultTimeout?: number;
  /** Enable context monitoring for long-running workers */
  monitorContext?: boolean;
  /** Context usage threshold for auto-rollover */
  contextThreshold?: number;
}

export interface OrchestratorStatus {
  /** Current phase being executed */
  currentWave: string | null;
  /** Completed waves */
  completedWaves: string[];
  /** Failed waves */
  failedWaves: string[];
  /** Pending waves */
  pendingWaves: string[];
  /** Active workers */
  activeWorkers: string[];
  /** All results so far */
  results: WaveResult[];
  /** Overall status */
  status: 'idle' | 'running' | 'completed' | 'failed';
}

type FleetManager = FleetTmuxManager | RemoteFleetManager;

export class WaveOrchestrator extends EventEmitter {
  private config: Required<OrchestratorConfig>;
  private fleet: FleetManager;
  private contextManager: ContextManager;
  private waves: Map<string, Wave> = new Map();
  private results: Map<string, WaveResult> = new Map();
  private workerStartTimes: Map<string, number> = new Map();
  private status: OrchestratorStatus;

  constructor(config: OrchestratorConfig) {
    super();
    this.config = {
      pollInterval: 1000,
      defaultTimeout: 300000,
      monitorContext: true,
      contextThreshold: 0.7,
      remote: false,
      baseCwd: process.cwd(),
      ...config,
    };

    // Create appropriate fleet manager
    if (this.config.remote) {
      this.fleet = new RemoteFleetManager({
        fleetName: this.config.fleetName,
        baseCwd: this.config.baseCwd,
      });
    } else {
      this.fleet = new FleetTmuxManager();
    }

    this.contextManager = new ContextManager();

    this.status = {
      currentWave: null,
      completedWaves: [],
      failedWaves: [],
      pendingWaves: [],
      activeWorkers: [],
      results: [],
      status: 'idle',
    };
  }

  /**
   * Add a wave to the orchestration plan
   */
  addWave(wave: Wave): this {
    this.waves.set(wave.name, wave);
    this.status.pendingWaves.push(wave.name);
    return this;
  }

  /**
   * Add multiple waves
   */
  addWaves(waves: Wave[]): this {
    for (const wave of waves) {
      this.addWave(wave);
    }
    return this;
  }

  /**
   * Get current orchestrator status
   */
  getStatus(): OrchestratorStatus {
    return { ...this.status, results: Array.from(this.results.values()) };
  }

  /**
   * Execute all waves in dependency order
   */
  async execute(): Promise<WaveResult[]> {
    this.status.status = 'running';
    this.emit('start', { waves: Array.from(this.waves.keys()) });

    try {
      // Build execution order based on dependencies
      const executionOrder = this.buildExecutionOrder();

      for (const waveName of executionOrder) {
        const wave = this.waves.get(waveName);
        if (!wave) continue;

        // Check if dependencies are satisfied
        if (wave.afterWaves) {
          const unsatisfied = wave.afterWaves.filter(
            dep => !this.status.completedWaves.includes(dep)
          );
          if (unsatisfied.length > 0) {
            const error = `Wave ${waveName} has unsatisfied dependencies: ${unsatisfied.join(', ')}`;
            this.emit('wave:error', { wave: waveName, error });
            this.status.failedWaves.push(waveName);
            continue;
          }
        }

        // Execute wave
        const waveResults = await this.executeWave(wave);
        const waveSuccess = waveResults.every(r => r.success);

        if (waveSuccess) {
          this.status.completedWaves.push(waveName);
        } else if (!wave.continueOnFailure) {
          this.status.failedWaves.push(waveName);
          this.status.status = 'failed';
          this.emit('failed', { wave: waveName, results: waveResults });
          break;
        } else {
          // Continue despite failures
          this.status.completedWaves.push(waveName);
        }
      }

      if (this.status.status !== 'failed') {
        this.status.status = 'completed';
      }

      const allResults = Array.from(this.results.values());
      this.emit('complete', { results: allResults, status: this.status.status });
      return allResults;

    } catch (error) {
      this.status.status = 'failed';
      this.emit('error', { error });
      throw error;
    }
  }

  /**
   * Execute a single wave (spawn workers in parallel)
   */
  private async executeWave(wave: Wave): Promise<WaveResult[]> {
    this.status.currentWave = wave.name;
    this.status.pendingWaves = this.status.pendingWaves.filter(w => w !== wave.name);
    this.emit('wave:start', { wave: wave.name, workers: wave.workers.map(w => w.handle) });

    // Spawn all workers in this wave
    const workerPromises = wave.workers.map(worker =>
      this.executeWorker(wave.name, worker)
    );

    // Wait for all workers to complete
    const results = await Promise.all(workerPromises);

    this.emit('wave:complete', { wave: wave.name, results });
    return results;
  }

  /**
   * Execute a single worker and monitor until completion
   */
  private async executeWorker(waveName: string, worker: WaveWorker): Promise<WaveResult> {
    const startTime = Date.now();
    this.workerStartTimes.set(worker.handle, startTime);
    this.status.activeWorkers.push(worker.handle);

    try {
      // Check intra-wave dependencies
      if (worker.dependsOn) {
        for (const dep of worker.dependsOn) {
          const depResult = this.results.get(dep);
          if (!depResult || !depResult.success) {
            throw new Error(`Dependency ${dep} not satisfied`);
          }
        }
      }

      // Spawn worker
      const spawnOptions = this.isRemoteFleet(this.fleet)
        ? this.buildRemoteSpawnOptions(worker)
        : this.buildLocalSpawnOptions(worker);

      let mapping;
      if (worker.prompt) {
        mapping = await (this.fleet as FleetTmuxManager).spawnClaudeWorker({
          ...(spawnOptions as FleetWorkerOptions),
          prompt: worker.prompt,
        });
      } else {
        mapping = await this.fleet.spawnWorker(spawnOptions);
      }

      if (!mapping) {
        throw new Error('Failed to spawn worker');
      }

      this.emit('worker:spawned', { wave: waveName, worker: worker.handle, paneId: mapping.paneId });

      // Monitor worker until completion
      const result = await this.monitorWorker(waveName, worker, mapping.paneId);

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const result: WaveResult = {
        wave: waveName,
        worker: worker.handle,
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      };
      this.results.set(worker.handle, result);
      this.emit('worker:failed', { wave: waveName, worker: worker.handle, error: errorMsg });
      return result;

    } finally {
      this.status.activeWorkers = this.status.activeWorkers.filter(w => w !== worker.handle);
      this.workerStartTimes.delete(worker.handle);
    }
  }

  /**
   * Monitor a worker until it completes or times out
   */
  private async monitorWorker(
    waveName: string,
    worker: WaveWorker,
    paneId: string
  ): Promise<WaveResult> {
    const startTime = this.workerStartTimes.get(worker.handle) ?? Date.now();
    const timeout = worker.timeout ?? this.config.defaultTimeout;
    const deadline = startTime + timeout;

    const successPattern = worker.successPattern
      ? (typeof worker.successPattern === 'string' ? new RegExp(worker.successPattern) : worker.successPattern)
      : /(?:completed|done|success|finished)/i;

    const failurePattern = worker.failurePattern
      ? (typeof worker.failurePattern === 'string' ? new RegExp(worker.failurePattern) : worker.failurePattern)
      : /(?:error:|failed:|exception|fatal)/i;

    while (Date.now() < deadline) {
      await this.sleep(this.config.pollInterval);

      // Capture output
      const output = this.captureOutput(worker.handle);

      // Check for success
      if (successPattern.test(output)) {
        const result: WaveResult = {
          wave: waveName,
          worker: worker.handle,
          success: true,
          output,
          duration: Date.now() - startTime,
        };
        this.results.set(worker.handle, result);
        this.emit('worker:success', { wave: waveName, worker: worker.handle, output });
        return result;
      }

      // Check for failure
      if (failurePattern.test(output)) {
        const result: WaveResult = {
          wave: waveName,
          worker: worker.handle,
          success: false,
          output,
          error: 'Failure pattern detected',
          duration: Date.now() - startTime,
        };
        this.results.set(worker.handle, result);
        this.emit('worker:failed', { wave: waveName, worker: worker.handle, output });
        return result;
      }

      // Monitor context if enabled
      if (this.config.monitorContext) {
        const metrics = this.contextManager.analyzeContext(paneId);
        if (metrics.usageRatio >= this.config.contextThreshold) {
          this.emit('worker:context-warning', {
            wave: waveName,
            worker: worker.handle,
            contextUsage: metrics.usageRatio,
          });
        }
      }
    }

    // Timeout
    const output = this.captureOutput(worker.handle);
    const result: WaveResult = {
      wave: waveName,
      worker: worker.handle,
      success: false,
      output,
      error: `Timeout after ${timeout}ms`,
      duration: Date.now() - startTime,
    };
    this.results.set(worker.handle, result);
    this.emit('worker:timeout', { wave: waveName, worker: worker.handle });
    return result;
  }

  /**
   * Build execution order respecting dependencies
   */
  private buildExecutionOrder(): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (waveName: string): void => {
      if (visited.has(waveName)) return;
      if (visiting.has(waveName)) {
        throw new Error(`Circular dependency detected involving wave: ${waveName}`);
      }

      visiting.add(waveName);

      const wave = this.waves.get(waveName);
      if (wave?.afterWaves) {
        for (const dep of wave.afterWaves) {
          visit(dep);
        }
      }

      visiting.delete(waveName);
      visited.add(waveName);
      order.push(waveName);
    };

    for (const waveName of this.waves.keys()) {
      visit(waveName);
    }

    return order;
  }

  /**
   * Capture output from worker
   */
  private captureOutput(handle: string): string {
    try {
      if (this.isRemoteFleet(this.fleet)) {
        return (this.fleet as RemoteFleetManager).captureWorkerOutput(handle);
      } else {
        return (this.fleet as FleetTmuxManager).captureWorkerOutput(handle);
      }
    } catch {
      return '';
    }
  }

  /**
   * Type guard for remote fleet
   */
  private isRemoteFleet(_fleet: FleetManager): _fleet is RemoteFleetManager {
    return this.config.remote;
  }

  /**
   * Build spawn options for local fleet
   */
  private buildLocalSpawnOptions(worker: WaveWorker): FleetWorkerOptions {
    return {
      handle: worker.handle,
      ...(worker.role && { role: worker.role }),
      ...(worker.command && { command: worker.command }),
      cwd: worker.cwd ?? this.config.baseCwd,
    };
  }

  /**
   * Build spawn options for remote fleet
   */
  private buildRemoteSpawnOptions(worker: WaveWorker): RemoteWorkerOptions {
    return {
      handle: worker.handle,
      ...(worker.role && { role: worker.role }),
      ...(worker.command && { command: worker.command }),
      ...(worker.cwd && { cwd: worker.cwd }),
    };
  }

  /**
   * Cancel all active workers
   */
  async cancel(): Promise<void> {
    for (const handle of this.status.activeWorkers) {
      try {
        if (this.isRemoteFleet(this.fleet)) {
          (this.fleet as RemoteFleetManager).killWorker(handle);
        } else {
          (this.fleet as FleetTmuxManager).killWorker(handle);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    this.status.status = 'failed';
    this.emit('cancelled');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Helper to create a simple linear pipeline
 */
export function createPipeline(
  fleetName: string,
  stages: { name: string; workers: WaveWorker[] }[]
): WaveOrchestrator {
  const orchestrator = new WaveOrchestrator({ fleetName });

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (!stage) continue;

    const prevStageName = i > 0 ? stages[i - 1]?.name : undefined;
    const wave: Wave = {
      name: stage.name,
      workers: stage.workers,
    };
    if (prevStageName) {
      wave.afterWaves = [prevStageName];
    }
    orchestrator.addWave(wave);
  }

  return orchestrator;
}

/**
 * Helper to create a parallel wave (all workers run simultaneously)
 */
export function createParallelWave(name: string, workers: WaveWorker[]): Wave {
  return { name, workers };
}
