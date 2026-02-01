/**
 * Coordination Adapter
 *
 * Abstracts agent coordination through Claude Code's native file-based
 * TeammateTool protocol. Uses NativeBridge for task I/O, TaskSyncBridge
 * for bidirectional task sync, and InboxBridge for messaging.
 */

import type { SpawnMode, AgentRole } from '../types.js';
import { NativeBridge } from './native-bridge.js';
import { TaskSyncBridge } from './task-sync.js';
import { InboxBridge } from './inbox-bridge.js';

// ============================================================================
// Types
// ============================================================================

/** Agent configuration for spawning */
export interface AgentConfig {
  handle: string;
  teamName: string;
  role: AgentRole;
  workingDir?: string;
  initialPrompt?: string;
  model?: string;
  sessionId?: string;
}

/** Handle returned after spawning an agent */
export interface AgentHandle {
  id: string;
  handle: string;
  teamName: string;
  spawnMode: SpawnMode;
}

/** Message to send between agents */
export interface CoordinationMessage {
  from: string;
  text: string;
  timestamp?: string;
  color?: string;
}

/** Task specification for assignment */
export interface TaskSpec {
  id: string;
  subject: string;
  description?: string;
  blockedBy?: string[];
}

/** Task status result */
export interface TaskStatusResult {
  id: string;
  status: string;
  owner: string | null;
  updatedAt: string;
}

// ============================================================================
// CoordinationAdapter Interface
// ============================================================================

/**
 * Abstract interface for agent coordination.
 * Implementations handle the specifics of how agents communicate.
 */
export interface CoordinationAdapter {
  /** Name of this adapter for logging */
  readonly name: string;

  /** Check if this adapter is available */
  isAvailable(): boolean;

  /** Send a message to a specific agent */
  sendMessage(to: string, message: CoordinationMessage): Promise<void>;

  /** Broadcast a message to all agents in a team */
  broadcastMessage(teamName: string, message: CoordinationMessage): Promise<void>;

  /** Assign a task to an agent */
  assignTask(agentId: string, task: TaskSpec): Promise<void>;

  /** Get task status */
  getTaskStatus(taskId: string, teamName: string): Promise<TaskStatusResult | null>;

  /** Shutdown/cleanup */
  shutdown(): void;
}

// ============================================================================
// NativeAdapter — File-based coordination (primary adapter)
// ============================================================================

export class NativeAdapter implements CoordinationAdapter {
  readonly name = 'native';
  private nativeBridge: NativeBridge;
  private taskSync: TaskSyncBridge;
  private inboxBridge: InboxBridge;
  private teamName: string;

  constructor(teamName: string, nativeBridge?: NativeBridge, taskSync?: TaskSyncBridge, inboxBridge?: InboxBridge) {
    this.teamName = teamName;
    this.nativeBridge = nativeBridge ?? new NativeBridge();
    this.taskSync = taskSync ?? new TaskSyncBridge(null);
    this.inboxBridge = inboxBridge ?? new InboxBridge();
  }

  isAvailable(): boolean {
    const availability = this.nativeBridge.checkAvailability();
    return availability.isAvailable;
  }

  async sendMessage(to: string, message: CoordinationMessage): Promise<void> {
    this.inboxBridge.send(this.teamName, to, message.from, message.text, message.color);
  }

  async broadcastMessage(teamName: string, message: CoordinationMessage): Promise<void> {
    this.inboxBridge.broadcast(teamName, message.from, message.text, message.color);
  }

  async assignTask(_agentId: string, task: TaskSpec): Promise<void> {
    this.nativeBridge.writeTask(this.teamName, {
      id: task.id,
      subject: task.subject,
      description: task.description ?? '',
      status: 'pending',
      owner: _agentId,
      blockedBy: task.blockedBy ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async getTaskStatus(taskId: string, teamName: string): Promise<TaskStatusResult | null> {
    const task = this.nativeBridge.readTask(teamName, taskId);
    if (!task) return null;

    return {
      id: task.id,
      status: task.status,
      owner: task.owner,
      updatedAt: task.updatedAt,
    };
  }

  /**
   * Get the name of the currently active adapter (for compatibility).
   */
  getActiveAdapterName(): string {
    return this.name;
  }

  /**
   * No-op for native adapter (no HTTP auth needed).
   */
  setAuthToken(_token: string): void {
    // Native adapter doesn't use HTTP auth
  }

  shutdown(): void {
    this.nativeBridge.shutdown();
    this.taskSync.shutdown();
  }
}
