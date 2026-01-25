/**
 * Tmux Worker Adapter
 *
 * Bridges FleetTmuxManager with the WorkerManager interface.
 * Enables spawning workers in visible tmux panes while maintaining
 * compatibility with the server's event system.
 */

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { FleetTmuxManager } from './fleet-manager.js';

// Re-use types from main package - these should match src/types.ts
export type WorkerState = 'starting' | 'ready' | 'working' | 'stopping' | 'stopped';
export type SpawnMode = 'process' | 'tmux';

export interface TmuxWorkerProcess {
  id: string;
  handle: string;
  teamName: string;
  paneId: string;
  sessionId: string | null;
  workingDir: string;
  state: WorkerState;
  recentOutput: string[];
  spawnedAt: number;
  currentTaskId: string | null;
  lastHeartbeat: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
  spawnMode: 'tmux';
}

export interface TmuxSpawnRequest {
  handle: string;
  teamName?: string;
  workingDir?: string;
  initialPrompt?: string;
  role?: string;
  model?: string;
}

export interface TmuxSpawnResponse {
  id: string;
  handle: string;
  teamName: string;
  workingDir: string;
  state: WorkerState;
  spawnedAt: number;
  spawnMode: 'tmux';
  paneId: string;
}

export interface TmuxWorkerAdapterEvents {
  'worker:ready': { workerId: string; handle: string; sessionId: string | null; paneId: string };
  'worker:output': { workerId: string; handle: string; text: string };
  'worker:result': { workerId: string; handle: string; result: string };
  'worker:error': { workerId: string; handle: string; error: string };
  'worker:exit': { workerId: string; handle: string };
}

const POLL_INTERVAL_MS = 500;
const MAX_OUTPUT_LINES = 100;
const HEALTHY_THRESHOLD_MS = 30000;
const DEGRADED_THRESHOLD_MS = 60000;

/**
 * Hash helper for comparing output
 */
function hashOutput(output: string): string {
  return createHash('md5').update(output).digest('hex');
}

/**
 * TmuxWorkerAdapter bridges FleetTmuxManager with WorkerManager's interface.
 * It spawns workers in tmux panes and emits events compatible with WorkerManager.
 */
export class TmuxWorkerAdapter extends EventEmitter {
  private tmuxManager: FleetTmuxManager;
  private workers: Map<string, TmuxWorkerProcess> = new Map();
  private outputPollers: Map<string, NodeJS.Timeout> = new Map();
  private lastOutputHash: Map<string, string> = new Map();
  private lastOutputLength: Map<string, number> = new Map();

  constructor() {
    super();
    this.tmuxManager = new FleetTmuxManager();
  }

  /**
   * Check if tmux spawning is available
   */
  isAvailable(): boolean {
    return this.tmuxManager.isAvailable();
  }

  /**
   * Get fleet status from tmux manager
   */
  getStatus() {
    return this.tmuxManager.getStatus();
  }

  /**
   * Spawn a worker in a tmux pane
   */
  async spawnWorker(request: TmuxSpawnRequest): Promise<TmuxSpawnResponse> {
    const {
      handle,
      teamName = 'default',
      workingDir = process.cwd(),
      initialPrompt,
      role = 'worker',
      model,
    } = request;

    // Build system prompt for worker role
    const systemPrompt = this.buildSystemPrompt(role, handle, teamName);
    const fullPrompt = initialPrompt
      ? `${systemPrompt}\n\n---\n\nYour first task:\n${initialPrompt}`
      : systemPrompt;

    // Spawn Claude in tmux pane
    // Use interactive mode (printMode: false) so Claude stays running
    // and can receive follow-up tasks via sendToWorker
    const mapping = await this.tmuxManager.spawnClaudeWorker({
      handle,
      role,
      cwd: workingDir,
      prompt: fullPrompt,
      ...(model && { model }),
      printMode: false,  // Interactive mode - worker stays alive
    });

    if (!mapping) {
      throw new Error(`Failed to spawn tmux worker "${handle}"`);
    }

    const workerId = mapping.workerId;
    const now = Date.now();

    // Create worker process object
    const worker: TmuxWorkerProcess = {
      id: workerId,
      handle,
      teamName,
      paneId: mapping.paneId,
      sessionId: null, // Will be extracted from output
      workingDir,
      state: 'starting',
      recentOutput: [],
      spawnedAt: now,
      currentTaskId: null,
      lastHeartbeat: now,
      health: 'healthy',
      spawnMode: 'tmux',
    };

    this.workers.set(handle, worker);

    // Start polling for output
    this.startOutputPolling(handle, mapping.paneId);

    return {
      id: workerId,
      handle,
      teamName,
      workingDir,
      state: 'starting',
      spawnedAt: now,
      spawnMode: 'tmux',
      paneId: mapping.paneId,
    };
  }

  /**
   * Build system prompt for worker role
   */
  private buildSystemPrompt(role: string, handle: string, teamName: string): string {
    return `You are ${handle}, a ${role} agent in the ${teamName} team.

You are part of a fleet of Claude Code agents working together. You will receive tasks and should work on them diligently.

When you complete a task, clearly state "TASK COMPLETE" so the system knows you're done.

If you encounter issues, describe them clearly so they can be resolved.`;
  }

  /**
   * Start polling output from a worker pane
   */
  private startOutputPolling(handle: string, _paneId: string): void {
    const poll = () => {
      try {
        const worker = this.workers.get(handle);
        if (!worker) {
          this.stopOutputPolling(handle);
          return;
        }

        // Capture current output
        const output = this.tmuxManager.captureWorkerOutput(handle, 200);
        const currentHash = hashOutput(output);
        const previousHash = this.lastOutputHash.get(handle);

        // Check if output changed
        if (currentHash !== previousHash) {
          this.lastOutputHash.set(handle, currentHash);
          worker.lastHeartbeat = Date.now();

          // Extract new lines
          const previousLength = this.lastOutputLength.get(handle) || 0;
          const lines = output.split('\n');
          const newLines = lines.slice(previousLength);
          this.lastOutputLength.set(handle, lines.length);

          // Process new output
          for (const line of newLines) {
            this.processOutputLine(worker, line);
          }

          // Update recent output buffer
          worker.recentOutput.push(...newLines);
          if (worker.recentOutput.length > MAX_OUTPUT_LINES) {
            worker.recentOutput = worker.recentOutput.slice(-MAX_OUTPUT_LINES);
          }
        }

        // Update health based on heartbeat
        this.updateWorkerHealth(worker);

      } catch (_error) {
        // Pane might have been killed
        const worker = this.workers.get(handle);
        if (worker) {
          worker.state = 'stopped';
          worker.health = 'unhealthy';
          this.emit('worker:exit', { workerId: worker.id, handle });
          this.stopOutputPolling(handle);
        }
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    this.outputPollers.set(handle, interval);

    // Run initial poll
    poll();
  }

  /**
   * Stop polling output for a worker
   */
  private stopOutputPolling(handle: string): void {
    const interval = this.outputPollers.get(handle);
    if (interval) {
      clearInterval(interval);
      this.outputPollers.delete(handle);
    }
    this.lastOutputHash.delete(handle);
    this.lastOutputLength.delete(handle);
  }

  /**
   * Process a line of output from worker
   */
  private processOutputLine(worker: TmuxWorkerProcess, line: string): void {
    // Try to parse as NDJSON (Claude Code output format)
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const event = JSON.parse(line);
        this.handleClaudeEvent(worker, event);
        return;
      } catch {
        // Not valid JSON, treat as plain text
      }
    }

    // Emit as plain text output
    this.emit('worker:output', {
      workerId: worker.id,
      handle: worker.handle,
      text: line,
    });

    // Check for task completion markers
    if (line.includes('TASK COMPLETE') || line.includes('Task completed')) {
      if (worker.state === 'working') {
        worker.state = 'ready';
        this.emit('worker:result', {
          workerId: worker.id,
          handle: worker.handle,
          result: 'Task completed',
        });
      }
    }
  }

  /**
   * Handle Claude Code NDJSON event
   */
  private handleClaudeEvent(worker: TmuxWorkerProcess, event: Record<string, unknown>): void {
    const type = event.type as string;

    switch (type) {
      case 'system':
        if (event.subtype === 'init') {
          // Extract session ID
          worker.sessionId = (event.session_id as string) || null;
          worker.state = 'ready';
          this.emit('worker:ready', {
            workerId: worker.id,
            handle: worker.handle,
            sessionId: worker.sessionId,
            paneId: worker.paneId,
          });
        }
        break;

      case 'assistant': {
        worker.state = 'working';
        // Extract text content if present
        const message = event.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        if (message?.content) {
          for (const content of message.content) {
            if (content.type === 'text' && content.text) {
              this.emit('worker:output', {
                workerId: worker.id,
                handle: worker.handle,
                text: content.text,
              });
            }
          }
        }
        break;
      }

      case 'result':
        worker.state = 'ready';
        this.emit('worker:result', {
          workerId: worker.id,
          handle: worker.handle,
          result: (event.result as string) || 'Completed',
        });
        break;

      case 'error':
        this.emit('worker:error', {
          workerId: worker.id,
          handle: worker.handle,
          error: (event.error as string) || 'Unknown error',
        });
        break;
    }
  }

  /**
   * Update worker health based on heartbeat
   */
  private updateWorkerHealth(worker: TmuxWorkerProcess): void {
    const now = Date.now();
    const elapsed = now - worker.lastHeartbeat;

    if (elapsed > DEGRADED_THRESHOLD_MS) {
      worker.health = 'unhealthy';
    } else if (elapsed > HEALTHY_THRESHOLD_MS) {
      worker.health = 'degraded';
    } else {
      worker.health = 'healthy';
    }
  }

  /**
   * Send a message to a worker
   */
  async sendToWorker(handle: string, message: string): Promise<boolean> {
    const worker = this.workers.get(handle);
    if (!worker) {
      return false;
    }

    try {
      await this.tmuxManager.sendToWorker(handle, message);
      worker.state = 'working';
      worker.lastHeartbeat = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deliver a task to a worker
   */
  async deliverTask(handle: string, task: { id: string; title: string; description?: string | null }): Promise<boolean> {
    const worker = this.workers.get(handle);
    if (!worker) {
      return false;
    }

    const prompt = `## New Task Assigned

**Task ID:** ${task.id}
**Title:** ${task.title}
${task.description ? `\n**Description:**\n${task.description}` : ''}

Please work on this task. When complete, say "TASK COMPLETE".`;

    try {
      await this.tmuxManager.sendToWorker(handle, prompt);
      worker.currentTaskId = task.id;
      worker.state = 'working';
      worker.lastHeartbeat = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Dismiss a worker
   */
  async dismissWorker(handle: string): Promise<boolean> {
    const worker = this.workers.get(handle);
    if (!worker) {
      return false;
    }

    // Stop polling
    this.stopOutputPolling(handle);

    // Kill the pane
    const killed = this.tmuxManager.killWorker(handle);

    // Update state
    worker.state = 'stopped';
    this.workers.delete(handle);

    this.emit('worker:exit', {
      workerId: worker.id,
      handle,
    });

    return killed;
  }

  /**
   * Get worker by handle
   */
  getWorkerByHandle(handle: string): TmuxWorkerProcess | undefined {
    return this.workers.get(handle);
  }

  /**
   * Get all workers
   */
  getWorkers(): TmuxWorkerProcess[] {
    return Array.from(this.workers.values());
  }

  /**
   * Capture current output from worker
   */
  captureOutput(handle: string, lines?: number): string {
    return this.tmuxManager.captureWorkerOutput(handle, lines);
  }

  /**
   * Wait for worker to become idle
   */
  async waitForIdle(handle: string, options?: { timeout?: number; stableTime?: number }): Promise<boolean> {
    return this.tmuxManager.waitForWorkerIdle(handle, options);
  }

  /**
   * Interrupt worker (Ctrl+C)
   */
  interruptWorker(handle: string): void {
    this.tmuxManager.interruptWorker(handle);
  }

  /**
   * Focus on worker pane
   */
  focusWorker(handle: string): void {
    this.tmuxManager.focusWorker(handle);
  }

  /**
   * Dismiss all workers
   */
  async dismissAllWorkers(): Promise<number> {
    let dismissed = 0;
    for (const handle of this.workers.keys()) {
      if (await this.dismissWorker(handle)) {
        dismissed++;
      }
    }
    return dismissed;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Stop all polling
    for (const handle of this.outputPollers.keys()) {
      this.stopOutputPolling(handle);
    }

    this.workers.clear();
    this.removeAllListeners();
  }
}
