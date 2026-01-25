/**
 * Fleet Tmux Manager
 *
 * Integrates tmux terminal automation with the fleet manager.
 * Spawns workers in separate tmux panes and manages their lifecycle.
 */

import { TmuxController } from './controller.js';
import type {
  FleetPaneMapping,
  CreatePaneOptions,
  ExecuteResult,
} from './types.js';

export interface FleetWorkerOptions {
  /** Worker handle (unique name) */
  handle: string;
  /** Worker ID (from fleet manager) */
  workerId?: string;
  /** Role for the worker */
  role?: string;
  /** Initial command to run (e.g., 'claude --print') */
  command?: string;
  /** Working directory */
  cwd?: string;
  /** Custom pane title */
  title?: string;
  /** Split direction */
  direction?: 'horizontal' | 'vertical';
}

export interface FleetStatus {
  insideTmux: boolean;
  session?: string;
  window?: string;
  pane?: string;
  workers: FleetPaneMapping[];
  totalPanes: number;
}

export class FleetTmuxManager {
  private controller: TmuxController;
  private workers: Map<string, FleetPaneMapping> = new Map();

  constructor() {
    this.controller = new TmuxController();
    // Auto-discover existing workers from pane titles
    this.discoverWorkers();
  }

  /**
   * Discover workers from existing pane titles matching pattern "role:handle" or "worker:handle"
   */
  discoverWorkers(): void {
    if (!this.controller.isInsideTmux()) return;

    const panes = this.controller.listPanes();
    const workerPattern = /^(worker|scout|coordinator|team-lead):(.+)$/;

    for (const pane of panes) {
      const match = pane.title.match(workerPattern);
      if (match && match[2]) {
        const handle = match[2];
        if (!this.workers.has(handle)) {
          this.workers.set(handle, {
            workerId: `discovered-${pane.id}`,
            handle,
            paneId: pane.id,
            createdAt: Date.now(),
          });
        }
      }
    }
  }

  /**
   * Check if fleet can be managed via tmux
   */
  isAvailable(): boolean {
    return this.controller.isTmuxInstalled() && this.controller.isInsideTmux();
  }

  /**
   * Get current fleet status
   */
  getStatus(): FleetStatus {
    const insideTmux = this.controller.isInsideTmux();

    if (!insideTmux) {
      return {
        insideTmux: false,
        workers: [],
        totalPanes: 0,
      };
    }

    const panes = this.controller.listPanes();
    const currentSession = this.controller.getCurrentSession();
    const currentWindow = this.controller.getCurrentWindow();
    const currentPane = this.controller.getCurrentPane();

    return {
      insideTmux: true,
      ...(currentSession && { session: currentSession }),
      ...(currentWindow && { window: currentWindow }),
      ...(currentPane && { pane: currentPane }),
      workers: Array.from(this.workers.values()),
      totalPanes: panes.length,
    };
  }

  /**
   * Spawn a new worker in a tmux pane
   */
  async spawnWorker(options: FleetWorkerOptions): Promise<FleetPaneMapping | undefined> {
    const {
      handle,
      workerId = `worker-${Date.now()}`,
      role = 'worker',
      command,
      cwd,
      title,
      direction = 'vertical',
    } = options;

    if (!this.isAvailable()) {
      throw new Error('Tmux is not available or not running inside tmux');
    }

    // Check if worker with this handle already exists
    if (this.workers.has(handle)) {
      throw new Error(`Worker with handle "${handle}" already exists`);
    }

    // Create the pane
    const paneOptions: CreatePaneOptions = {
      direction,
      ...(cwd && { cwd }),
      ...(command && { command }),
    };

    const pane = this.controller.createPane(paneOptions);
    if (!pane) {
      throw new Error('Failed to create tmux pane');
    }

    // Set pane title
    const paneTitle = title || `${role}:${handle}`;
    this.controller.setPaneTitle(pane.id, paneTitle);

    // Create mapping
    const currentSessionId = this.controller.getCurrentSession();
    const currentWindowId = this.controller.getCurrentWindow();
    const mapping: FleetPaneMapping = {
      workerId,
      handle,
      paneId: pane.id,
      ...(currentSessionId && { sessionId: currentSessionId }),
      ...(currentWindowId && { windowId: currentWindowId }),
      createdAt: Date.now(),
    };

    this.workers.set(handle, mapping);

    return mapping;
  }

  /**
   * Spawn a Claude Code worker
   */
  async spawnClaudeWorker(options: Omit<FleetWorkerOptions, 'command'> & {
    prompt?: string;
    printMode?: boolean;
    model?: string;
  }): Promise<FleetPaneMapping | undefined> {
    const { prompt, printMode = true, model, ...rest } = options;

    // Build Claude command
    let command = 'claude';

    if (printMode) {
      command += ' --print';
    }

    if (model) {
      command += ` --model ${model}`;
    }

    if (prompt) {
      // Escape the prompt for shell
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      command += ` '${escapedPrompt}'`;
    }

    return this.spawnWorker({
      ...rest,
      command,
    });
  }

  /**
   * Send a message to a worker
   */
  async sendToWorker(handle: string, message: string): Promise<void> {
    const worker = this.workers.get(handle);
    if (!worker) {
      throw new Error(`Worker "${handle}" not found`);
    }

    await this.controller.sendKeys(worker.paneId, message);
  }

  /**
   * Execute a command in a worker pane
   */
  async executeInWorker(
    handle: string,
    command: string,
    options?: { timeout?: number }
  ): Promise<ExecuteResult> {
    const worker = this.workers.get(handle);
    if (!worker) {
      throw new Error(`Worker "${handle}" not found`);
    }

    return this.controller.execute(worker.paneId, command, options);
  }

  /**
   * Capture output from a worker pane
   */
  captureWorkerOutput(handle: string, lines?: number): string {
    const worker = this.workers.get(handle);
    if (!worker) {
      throw new Error(`Worker "${handle}" not found`);
    }

    return this.controller.capture(worker.paneId, lines !== undefined ? { lines } : {});
  }

  /**
   * Wait for worker to become idle
   */
  async waitForWorkerIdle(
    handle: string,
    options?: { timeout?: number; stableTime?: number }
  ): Promise<boolean> {
    const worker = this.workers.get(handle);
    if (!worker) {
      throw new Error(`Worker "${handle}" not found`);
    }

    return this.controller.waitForIdle(worker.paneId, options);
  }

  /**
   * Wait for pattern in worker output
   */
  async waitForWorkerPattern(
    handle: string,
    pattern: string | RegExp,
    options?: { timeout?: number }
  ): Promise<boolean> {
    const worker = this.workers.get(handle);
    if (!worker) {
      throw new Error(`Worker "${handle}" not found`);
    }

    return this.controller.waitForPattern(worker.paneId, pattern, options);
  }

  /**
   * Send interrupt to worker
   */
  interruptWorker(handle: string): void {
    const worker = this.workers.get(handle);
    if (!worker) {
      throw new Error(`Worker "${handle}" not found`);
    }

    this.controller.sendInterrupt(worker.paneId);
  }

  /**
   * Send escape key to worker
   */
  escapeWorker(handle: string): void {
    const worker = this.workers.get(handle);
    if (!worker) {
      throw new Error(`Worker "${handle}" not found`);
    }

    this.controller.sendEscape(worker.paneId);
  }

  /**
   * Kill a worker pane
   */
  killWorker(handle: string): boolean {
    const worker = this.workers.get(handle);
    if (!worker) {
      return false;
    }

    const success = this.controller.killPane(worker.paneId);
    if (success) {
      this.workers.delete(handle);
    }

    return success;
  }

  /**
   * Kill all workers
   */
  killAllWorkers(): number {
    let killed = 0;
    for (const handle of this.workers.keys()) {
      if (this.killWorker(handle)) {
        killed++;
      }
    }
    return killed;
  }

  /**
   * Get worker by handle
   */
  getWorker(handle: string): FleetPaneMapping | undefined {
    return this.workers.get(handle);
  }

  /**
   * List all workers
   */
  listWorkers(): FleetPaneMapping[] {
    return Array.from(this.workers.values());
  }

  /**
   * Focus on a worker pane
   */
  focusWorker(handle: string): void {
    const worker = this.workers.get(handle);
    if (!worker) {
      throw new Error(`Worker "${handle}" not found`);
    }

    this.controller.focusPane(worker.paneId);
  }

  /**
   * Broadcast a message to all workers
   */
  async broadcast(message: string): Promise<void> {
    for (const worker of this.workers.values()) {
      await this.controller.sendKeys(worker.paneId, message);
    }
  }

  /**
   * Get the underlying controller for advanced operations
   */
  getController(): TmuxController {
    return this.controller;
  }
}
