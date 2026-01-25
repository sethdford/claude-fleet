/**
 * Remote Fleet Manager
 *
 * Enables headless/API-driven fleet management from OUTSIDE tmux.
 * Critical for CI/CD pipelines, automated orchestration, and multi-repo management.
 *
 * Key differences from FleetTmuxManager:
 * - Creates detached sessions (no terminal required)
 * - Manages workers by session/window name (not current pane)
 * - Designed for autonomous operations
 *
 * Inspired by claude-code-tools/tmux_remote_controller.py
 */

import { TmuxController } from './controller.js';
import type {
  FleetPaneMapping,
  ExecuteResult,
} from './types.js';

export interface RemoteFleetConfig {
  /** Fleet name - used as session prefix */
  fleetName: string;
  /** Base working directory for all workers */
  baseCwd?: string;
  /** Maximum workers per session (default: 4) */
  maxWorkersPerSession?: number;
}

export interface RemoteWorkerOptions {
  /** Worker handle (unique name) */
  handle: string;
  /** Worker ID */
  workerId?: string;
  /** Role for the worker */
  role?: string;
  /** Initial command to run */
  command?: string;
  /** Working directory */
  cwd?: string;
}

export interface SessionLineage {
  /** Session ID */
  sessionId: string;
  /** Session name */
  sessionName: string;
  /** Parent session (if spawned from another) */
  parentSessionId?: string;
  /** Child sessions spawned from this one */
  childSessionIds: string[];
  /** Creation timestamp */
  createdAt: number;
  /** Workers in this session */
  workerHandles: string[];
  /** Total commands executed */
  commandCount: number;
  /** Estimated context usage (0-1) */
  contextUsage: number;
}

export interface FleetSnapshot {
  /** Fleet name */
  fleetName: string;
  /** All sessions in the fleet */
  sessions: SessionLineage[];
  /** All workers across sessions */
  workers: RemoteWorkerInfo[];
  /** Timestamp of snapshot */
  timestamp: number;
}

export interface RemoteWorkerInfo extends FleetPaneMapping {
  /** Session name containing this worker */
  sessionName: string;
  /** Is worker currently active */
  isActive: boolean;
  /** Last activity timestamp */
  lastActivity?: number;
  /** Output line count (context indicator) */
  outputLineCount?: number;
}

export class RemoteFleetManager {
  private controller: TmuxController;
  private config: RemoteFleetConfig;
  private workers: Map<string, RemoteWorkerInfo> = new Map();
  private sessions: Map<string, SessionLineage> = new Map();

  constructor(config: RemoteFleetConfig) {
    this.controller = new TmuxController();
    this.config = {
      maxWorkersPerSession: 4,
      ...config,
    };
  }

  /**
   * Check if tmux is available (doesn't require being inside tmux)
   */
  isAvailable(): boolean {
    return this.controller.isTmuxInstalled();
  }

  /**
   * Get the session name for a fleet
   */
  private getSessionName(index: number = 0): string {
    return `${this.config.fleetName}-${index}`;
  }

  /**
   * Create a new detached fleet session
   */
  createSession(index: number = 0): string | null {
    const sessionName = this.getSessionName(index);

    // Check if session already exists
    if (this.controller.sessionExists(sessionName)) {
      return sessionName;
    }

    const sessionId = this.controller.createSession({
      name: sessionName,
      detached: true,
      ...(this.config.baseCwd && { cwd: this.config.baseCwd }),
    });

    if (sessionId) {
      this.sessions.set(sessionName, {
        sessionId,
        sessionName,
        childSessionIds: [],
        createdAt: Date.now(),
        workerHandles: [],
        commandCount: 0,
        contextUsage: 0,
      });
    }

    return sessionId ? sessionName : null;
  }

  /**
   * Find or create a session with capacity for more workers
   */
  private findOrCreateSession(): string {
    const maxWorkers = this.config.maxWorkersPerSession ?? 4;

    // Find existing session with capacity
    for (const [sessionName, lineage] of this.sessions) {
      if (lineage.workerHandles.length < maxWorkers) {
        return sessionName;
      }
    }

    // Create new session
    const nextIndex = this.sessions.size;
    const sessionName = this.createSession(nextIndex);
    if (!sessionName) {
      throw new Error('Failed to create fleet session');
    }
    return sessionName;
  }

  /**
   * Spawn a worker in a detached session
   * Works from anywhere - no tmux attachment required
   */
  async spawnWorker(options: RemoteWorkerOptions): Promise<RemoteWorkerInfo | undefined> {
    const {
      handle,
      workerId = `worker-${Date.now()}`,
      role = 'worker',
      command,
      cwd,
    } = options;

    if (!this.isAvailable()) {
      throw new Error('Tmux is not installed');
    }

    if (this.workers.has(handle)) {
      throw new Error(`Worker with handle "${handle}" already exists`);
    }

    // Find or create a session
    const sessionName = this.findOrCreateSession();
    const sessionLineage = this.sessions.get(sessionName);
    if (!sessionLineage) {
      throw new Error('Session lineage not found');
    }

    // Create a new window in the session for this worker
    const windowName = `${role}-${handle}`;
    const windowCwd = cwd ?? this.config.baseCwd;
    const windowId = this.controller.createWindow({
      session: sessionName,
      name: windowName,
      ...(windowCwd && { cwd: windowCwd }),
    });

    if (!windowId) {
      throw new Error('Failed to create window for worker');
    }

    // Get the pane ID in the new window
    const target = `${sessionName}:${windowName}`;
    const panes = this.controller.listPanes(target);
    const pane = panes[0];

    if (!pane) {
      throw new Error('Failed to get pane in new window');
    }

    // Shell-first pattern: launch shell then send command
    if (command) {
      await this.delay(100);
      await this.controller.sendKeys(pane.id, command);
    }

    // Create worker info
    const workerInfo: RemoteWorkerInfo = {
      workerId,
      handle,
      paneId: pane.id,
      sessionId: sessionLineage.sessionId,
      windowId,
      sessionName,
      isActive: true,
      createdAt: Date.now(),
    };

    this.workers.set(handle, workerInfo);
    sessionLineage.workerHandles.push(handle);

    return workerInfo;
  }

  /**
   * Spawn a Claude Code worker in detached mode
   */
  async spawnClaudeWorker(options: Omit<RemoteWorkerOptions, 'command'> & {
    prompt?: string;
    printMode?: boolean;
    model?: string;
    skipPermissions?: boolean;
  }): Promise<RemoteWorkerInfo | undefined> {
    const { prompt, printMode = true, model, skipPermissions = true, ...rest } = options;

    let command = 'claude';
    if (skipPermissions) command += ' --dangerously-skip-permissions';
    if (printMode) command += ' --print';
    if (model) command += ` --model ${model}`;
    if (prompt) {
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      command += ` '${escapedPrompt}'`;
    }

    return this.spawnWorker({ ...rest, command });
  }

  /**
   * Send a message to a worker
   */
  async sendToWorker(handle: string, message: string): Promise<void> {
    const worker = this.workers.get(handle);
    if (!worker) throw new Error(`Worker "${handle}" not found`);

    await this.controller.sendKeys(worker.paneId, message);

    // Update session command count
    const session = this.sessions.get(worker.sessionName);
    if (session) {
      session.commandCount++;
      session.contextUsage = Math.min(1, session.commandCount / 100); // Rough estimate
    }
  }

  /**
   * Capture worker output
   */
  captureWorkerOutput(handle: string, lines?: number): string {
    const worker = this.workers.get(handle);
    if (!worker) throw new Error(`Worker "${handle}" not found`);

    const output = this.controller.capture(worker.paneId, lines !== undefined ? { lines } : {});

    // Update output line count for context tracking
    worker.outputLineCount = output.split('\n').length;
    worker.lastActivity = Date.now();

    return output;
  }

  /**
   * Execute command in worker
   */
  async executeInWorker(
    handle: string,
    command: string,
    options?: { timeout?: number }
  ): Promise<ExecuteResult> {
    const worker = this.workers.get(handle);
    if (!worker) throw new Error(`Worker "${handle}" not found`);

    return this.controller.execute(worker.paneId, command, options);
  }

  /**
   * Kill a worker
   */
  killWorker(handle: string): boolean {
    const worker = this.workers.get(handle);
    if (!worker) return false;

    // Kill the entire window (since each worker has its own window)
    const success = this.controller.killWindow(`${worker.sessionName}:${worker.windowId}`);

    if (success) {
      // Remove from session lineage
      const session = this.sessions.get(worker.sessionName);
      if (session) {
        session.workerHandles = session.workerHandles.filter(h => h !== handle);
      }
      this.workers.delete(handle);
    }

    return success;
  }

  /**
   * Kill entire fleet
   */
  killFleet(): number {
    let killed = 0;

    for (const [sessionName] of this.sessions) {
      if (this.controller.killSession(sessionName)) {
        killed++;
      }
    }

    this.workers.clear();
    this.sessions.clear();

    return killed;
  }

  /**
   * Get fleet snapshot for monitoring
   */
  getSnapshot(): FleetSnapshot {
    return {
      fleetName: this.config.fleetName,
      sessions: Array.from(this.sessions.values()),
      workers: Array.from(this.workers.values()),
      timestamp: Date.now(),
    };
  }

  /**
   * Get session lineage for a worker
   */
  getWorkerLineage(handle: string): SessionLineage | undefined {
    const worker = this.workers.get(handle);
    if (!worker) return undefined;
    return this.sessions.get(worker.sessionName);
  }

  /**
   * Check if worker needs context rollover
   * Returns true if context usage is high
   */
  needsContextRollover(handle: string, threshold: number = 0.8): boolean {
    const lineage = this.getWorkerLineage(handle);
    if (!lineage) return false;
    return lineage.contextUsage >= threshold;
  }

  /**
   * Create child session for context rollover
   * Spawns new session linked to parent for lineage tracking
   */
  async rolloverContext(handle: string): Promise<RemoteWorkerInfo | undefined> {
    const worker = this.workers.get(handle);
    if (!worker) throw new Error(`Worker "${handle}" not found`);

    const parentSession = this.sessions.get(worker.sessionName);
    if (!parentSession) throw new Error('Parent session not found');

    // Create new session for rollover
    const newSessionIndex = this.sessions.size;
    const newSessionName = this.createSession(newSessionIndex);
    if (!newSessionName) throw new Error('Failed to create rollover session');

    const newSession = this.sessions.get(newSessionName);
    if (!newSession) throw new Error('New session not found');

    // Link parent-child relationship
    newSession.parentSessionId = parentSession.sessionId;
    parentSession.childSessionIds.push(newSession.sessionId);

    // Spawn new worker in fresh session
    const newHandle = `${handle}-rollover-${Date.now()}`;
    return this.spawnWorker({
      handle: newHandle,
      workerId: worker.workerId,
      role: 'worker',
      ...(this.config.baseCwd && { cwd: this.config.baseCwd }),
    });
  }

  /**
   * Discover existing fleet sessions
   * Useful for reconnecting to a fleet after server restart
   */
  discoverFleet(): void {
    const sessions = this.controller.listSessions();
    const prefix = `${this.config.fleetName}-`;

    for (const session of sessions) {
      if (session.name.startsWith(prefix)) {
        // Found a fleet session - add to tracking
        if (!this.sessions.has(session.name)) {
          this.sessions.set(session.name, {
            sessionId: session.id,
            sessionName: session.name,
            childSessionIds: [],
            createdAt: session.created * 1000,
            workerHandles: [],
            commandCount: 0,
            contextUsage: 0,
          });
        }

        // Discover workers in this session
        const windows = this.controller.listWindows(session.name);
        for (const window of windows) {
          const panes = this.controller.listPanes(`${session.name}:${window.index}`);
          for (const pane of panes) {
            // Extract handle from window name pattern "role-handle"
            const match = window.name.match(/^(worker|scout|coordinator)-(.+)$/);
            if (match && match[2]) {
              const handle = match[2];
              if (!this.workers.has(handle)) {
                this.workers.set(handle, {
                  workerId: `discovered-${pane.id}`,
                  handle,
                  paneId: pane.id,
                  sessionId: session.id,
                  windowId: window.id,
                  sessionName: session.name,
                  isActive: true,
                  createdAt: Date.now(),
                });

                const sessionLineage = this.sessions.get(session.name);
                if (sessionLineage) {
                  sessionLineage.workerHandles.push(handle);
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * List all workers
   */
  listWorkers(): RemoteWorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get attach command for monitoring a session
   */
  getAttachCommand(sessionIndex: number = 0): string {
    const sessionName = this.getSessionName(sessionIndex);
    return `tmux attach-session -t ${sessionName}`;
  }

  /**
   * Helper delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
