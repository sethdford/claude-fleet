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
  WaitIdleResult,
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
  /** The first worker pane ID - used as target for subsequent vertical splits */
  private workerColumnPaneId: string | null = null;
  /** The main pane ID - where we split from for the first worker */
  private mainPaneId: string | undefined;

  constructor() {
    this.controller = new TmuxController();
    // Capture the main pane ID - try getCurrentPane first, fall back to getActivePaneId
    // This ensures we can detect the main pane even when server runs outside tmux session
    this.mainPaneId = this.controller.getCurrentPane() ?? this.controller.getActivePaneId();
    console.log(`[TMUX] FleetTmuxManager init: mainPaneId=${this.mainPaneId}, insideTmux=${this.controller.isInsideTmux()}`);
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
   *
   * Layout strategy:
   * - First worker: horizontal split creates "worker column" on the right
   * - Subsequent workers: vertical split from worker column (stacks on right)
   *
   * Shell-first pattern (from claude-code-tools):
   * - Always launch a shell first (zsh/bash)
   * - Then send the command to the shell
   * - This prevents losing output if the command crashes
   */
  async spawnWorker(options: FleetWorkerOptions): Promise<FleetPaneMapping | undefined> {
    const {
      handle,
      workerId = `worker-${Date.now()}`,
      role = 'worker',
      command,
      cwd,
      title,
      direction: requestedDirection,
    } = options;

    if (!this.isAvailable()) {
      throw new Error('Tmux is not available or not running inside tmux');
    }

    // Check if worker with this handle already exists
    if (this.workers.has(handle)) {
      throw new Error(`Worker with handle "${handle}" already exists`);
    }

    // Smart layout: first worker creates horizontal split (right column),
    // subsequent workers stack vertically in that column
    let direction: 'horizontal' | 'vertical';
    let target: string | undefined;

    if (this.workerColumnPaneId === null) {
      // First worker - create horizontal split from main pane (pane on the right)
      direction = requestedDirection ?? 'horizontal';
      // Target the main pane so the split creates the worker column on the right
      target = this.mainPaneId ?? undefined;
    } else {
      // Subsequent workers - split the worker column vertically
      direction = requestedDirection ?? 'vertical';
      target = this.workerColumnPaneId;
    }

    console.log(`[TMUX] spawnWorker ${handle}: direction=${direction}, target=${target}, workerColumnPaneId=${this.workerColumnPaneId}`);

    // SHELL-FIRST PATTERN: Always launch a shell, never the command directly
    // This prevents losing output if the command errors immediately
    const paneOptions: CreatePaneOptions = {
      direction,
      ...(target && { target }),
      ...(cwd && { cwd }),
      // Launch shell instead of command directly
      command: 'zsh',
    };

    const pane = this.controller.createPane(paneOptions);
    if (!pane) {
      throw new Error('Failed to create tmux pane');
    }

    // Track the first worker pane as the "worker column" for stacking
    if (this.workerColumnPaneId === null) {
      this.workerColumnPaneId = pane.id;
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

    // If a command was provided, send it to the shell after a short delay
    // This ensures the shell is ready before we send the command
    if (command) {
      await this.delay(100);  // Brief delay for shell to initialize
      await this.controller.sendKeys(pane.id, command);
    }

    return mapping;
  }

  /**
   * Helper to create a delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Spawn a Claude Code worker
   */
  async spawnClaudeWorker(options: Omit<FleetWorkerOptions, 'command'> & {
    prompt?: string;
    printMode?: boolean;
    model?: string;
    skipPermissions?: boolean;
  }): Promise<FleetPaneMapping | undefined> {
    const { prompt, printMode = true, model, skipPermissions = true, ...rest } = options;

    // Build Claude command
    let command = 'claude';

    // Skip permissions for autonomous operation (no confirmation dialogs)
    if (skipPermissions) {
      command += ' --dangerously-skip-permissions';
    }

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
  ): Promise<WaitIdleResult> {
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
   *
   * Safety: Will refuse to kill the main pane to prevent accidentally
   * terminating the session (learned from claude-code-tools)
   */
  killWorker(handle: string): boolean {
    const worker = this.workers.get(handle);
    if (!worker) {
      return false;
    }

    // SAFETY: Never kill the main pane
    if (worker.paneId === this.mainPaneId) {
      console.warn(`[TMUX] Refusing to kill main pane ${worker.paneId}`);
      return false;
    }

    const success = this.controller.killPane(worker.paneId);
    if (success) {
      // Reset worker column if we killed it
      if (worker.paneId === this.workerColumnPaneId) {
        this.workerColumnPaneId = null;
      }
      this.workers.delete(handle);
    }

    return success;
  }

  /**
   * Kill all workers
   *
   * Safety: Uses killWorker which has self-kill protection
   */
  killAllWorkers(): number {
    let killed = 0;
    // Create a list of handles first to avoid mutation during iteration
    const handles = Array.from(this.workers.keys());
    for (const handle of handles) {
      if (this.killWorker(handle)) {
        killed++;
      }
    }
    // Reset worker column since all workers are gone
    this.workerColumnPaneId = null;
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
