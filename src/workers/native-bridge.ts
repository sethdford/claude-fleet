/**
 * Native Bridge
 *
 * Translates Fleet work items to Claude Code's built-in Task tool and
 * TeammateTool operations. Spawns workers via `claude --print` with native
 * team environment variables, and monitors ~/.claude/tasks/ for status changes.
 *
 * Falls back to 'process' mode if native features are unavailable.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { AgentRole } from '../types.js';

/**
 * Deterministic color assignment from an agent handle.
 * Uses a simple hash to pick from a palette of 12 distinct colors.
 */
const AGENT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8C471', '#82E0AA',
];

function agentColorFromHandle(handle: string): string {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = ((hash << 5) - hash + handle.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

/** JSON format for native task files at ~/.claude/tasks/{team}/{id}.json */
export interface NativeTaskFile {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner: string | null;
  blockedBy: string[];
  /** Task IDs that this task blocks (inverse of blockedBy) */
  blocks: string[];
  /** Present-continuous form shown in spinner UI (e.g. "Running tests") */
  activeForm: string | null;
  /** Arbitrary metadata for tool-specific data */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** JSON format for native message files */
export interface NativeMessage {
  from: string;
  text: string;
  timestamp: string;
  color?: string;
}

/** Event emitted when a new agent session directory is discovered */
export interface AgentDiscoveredEvent {
  teamName: string;
  /** The session/agent directory name (typically a UUID) */
  agentId: string;
  /** Full path to the discovered directory */
  path: string;
}

/** Configuration for the native bridge */
export interface NativeBridgeConfig {
  /** Base directory for teams (default: ~/.claude/teams) */
  teamsDir?: string;
  /** Base directory for tasks (default: ~/.claude/tasks) */
  tasksDir?: string;
  /** Path to Claude binary (default: 'claude', or 'claudesp' if available) */
  claudeBinary?: string;
  /** Whether to fall back to process mode if native unavailable */
  fallbackToProcess?: boolean;
}

/** Result of native availability check */
export interface NativeAvailability {
  isAvailable: boolean;
  claudeBinary: string | null;
  teamsDir: string;
  tasksDir: string;
  reason?: string;
}

export class NativeBridge extends EventEmitter {
  private readonly teamsDir: string;
  private readonly tasksDir: string;
  private claudeBinary: string | null;
  private readonly fallbackToProcess: boolean;
  private isAvailable: boolean;

  /** Watchers for team directories (auto-discovery) */
  private discoveryWatchers = new Map<string, ReturnType<typeof watch>>();
  /** Known agent session directories (avoids re-emitting) */
  private knownAgents = new Set<string>();
  /** Debounce timers for discovery events */
  private discoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(config: NativeBridgeConfig = {}) {
    super();
    const claudeDir = join(homedir(), '.claude');
    this.teamsDir = config.teamsDir ?? join(claudeDir, 'teams');
    this.tasksDir = config.tasksDir ?? join(claudeDir, 'tasks');
    this.fallbackToProcess = config.fallbackToProcess ?? true;
    this.claudeBinary = config.claudeBinary ?? null;
    this.isAvailable = false;
  }

  /**
   * Check whether native TeammateTool features are available.
   * Probes for patched binary and required directory structure.
   */
  checkAvailability(): NativeAvailability {
    // Try to find a working claude binary with native support
    const candidates = [
      this.claudeBinary,
      'claudesp',
      join(homedir(), '.claude-sneakpeek', 'claudesp', 'claude'),
      'claude',
    ].filter(Boolean) as string[];

    let foundBinary: string | null = null;
    for (const candidate of candidates) {
      try {
        const result = spawnSync(candidate, ['--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        });
        if (result.error) continue;
        foundBinary = candidate;
        break;
      } catch {
        continue;
      }
    }

    if (!foundBinary) {
      this.isAvailable = false;
      return {
        isAvailable: false,
        claudeBinary: null,
        teamsDir: this.teamsDir,
        tasksDir: this.tasksDir,
        reason: 'No Claude Code binary found',
      };
    }

    this.claudeBinary = foundBinary;
    this.isAvailable = true;

    // Ensure directories exist
    this.ensureDirectories();

    return {
      isAvailable: true,
      claudeBinary: foundBinary,
      teamsDir: this.teamsDir,
      tasksDir: this.tasksDir,
    };
  }

  /**
   * Check whether native mode is ready for use.
   * Throws a descriptive error if not available.
   */
  assertAvailable(): void {
    if (!this.isAvailable || !this.claudeBinary) {
      throw new Error(
        'Native features not available. ' +
        (this.fallbackToProcess
          ? 'Falling back to process mode.'
          : 'Install claude-sneakpeek or wait for official TeammateTool support.')
      );
    }
  }

  /**
   * Prepare native directories and start watching for a team.
   * Called by WorkerManager before spawning a native worker.
   */
  prepareForSpawn(teamName: string): void {
    this.assertAvailable();

    const teamTaskDir = join(this.tasksDir, teamName);
    if (!existsSync(teamTaskDir)) {
      mkdirSync(teamTaskDir, { recursive: true });
    }

    const teamDir = join(this.teamsDir, teamName);
    if (!existsSync(teamDir)) {
      mkdirSync(teamDir, { recursive: true });
    }
  }

  /**
   * Build the native environment variables for a spawned worker.
   */
  buildNativeEnv(handle: string, teamName: string, role: AgentRole): Record<string, string> {
    const agentId = `${teamName}-${handle}`;
    return {
      // Core identity
      CLAUDE_CODE_TEAM_NAME: teamName,
      CLAUDE_CODE_AGENT_ID: agentId,
      CLAUDE_CODE_AGENT_TYPE: role,
      CLAUDE_CODE_AGENT_NAME: handle,
      CLAUDE_FLEET_URL: process.env.CLAUDE_FLEET_URL ?? 'http://localhost:3847',
      CLAUDE_CODE_SPAWN_BACKEND: 'native',
      // Native team mode activation
      CLAUDE_CODE_TEAM_MODE: 'true',
      CLAUDE_CODE_AGENT_COLOR: agentColorFromHandle(handle),
      CLAUDE_CODE_PLAN_MODE_REQUIRED: process.env.CLAUDE_CODE_PLAN_MODE_REQUIRED ?? 'false',
      CLAUDE_CODE_PARENT_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? agentId,
    };
  }

  /**
   * Get the resolved Claude binary path for native spawning.
   */
  getClaudeBinary(): string {
    this.assertAvailable();
    return this.claudeBinary as string;
  }

  // ============================================================================
  // Task File Operations
  // ============================================================================

  /**
   * Write a task to the native file system.
   * Used for Fleet → native sync.
   */
  writeTask(teamName: string, task: NativeTaskFile): void {
    const teamDir = join(this.tasksDir, teamName);
    if (!existsSync(teamDir)) {
      mkdirSync(teamDir, { recursive: true });
    }
    const filePath = join(teamDir, `${task.id}.json`);
    writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf-8');
  }

  /**
   * Read a task from the native file system.
   */
  readTask(teamName: string, taskId: string): NativeTaskFile | null {
    const filePath = join(this.tasksDir, teamName, `${taskId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const raw = JSON.parse(content) as Partial<NativeTaskFile>;
      // Normalize: older files may lack blocks/activeForm/metadata
      return {
        id: raw.id ?? taskId,
        subject: raw.subject ?? '',
        description: raw.description ?? '',
        status: raw.status ?? 'pending',
        owner: raw.owner ?? null,
        blockedBy: raw.blockedBy ?? [],
        blocks: raw.blocks ?? [],
        activeForm: raw.activeForm ?? null,
        metadata: raw.metadata ?? {},
        createdAt: raw.createdAt ?? new Date().toISOString(),
        updatedAt: raw.updatedAt ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * List all tasks for a team from the native file system.
   */
  async listTasks(teamName: string): Promise<NativeTaskFile[]> {
    const teamDir = join(this.tasksDir, teamName);
    if (!existsSync(teamDir)) return [];

    const files = await readdir(teamDir);
    const tasks: NativeTaskFile[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = readFileSync(join(teamDir, file), 'utf-8');
        const raw = JSON.parse(content) as Partial<NativeTaskFile>;
        const taskId = file.replace('.json', '');
        tasks.push({
          id: raw.id ?? taskId,
          subject: raw.subject ?? '',
          description: raw.description ?? '',
          status: raw.status ?? 'pending',
          owner: raw.owner ?? null,
          blockedBy: raw.blockedBy ?? [],
          blocks: raw.blocks ?? [],
          activeForm: raw.activeForm ?? null,
          metadata: raw.metadata ?? {},
          createdAt: raw.createdAt ?? new Date().toISOString(),
          updatedAt: raw.updatedAt ?? new Date().toISOString(),
        });
      } catch {
        // Skip malformed files
      }
    }

    return tasks;
  }

  // ============================================================================
  // Message Operations
  // ============================================================================

  /**
   * Write a message to an agent's native inbox.
   */
  writeMessage(teamName: string, sessionId: string, message: NativeMessage): void {
    const inboxDir = join(this.teamsDir, teamName, 'messages', sessionId);
    if (!existsSync(inboxDir)) {
      mkdirSync(inboxDir, { recursive: true });
    }
    const fileName = `${Date.now()}-${message.from}.json`;
    const filePath = join(inboxDir, fileName);
    writeFileSync(filePath, JSON.stringify(message, null, 2), 'utf-8');
  }

  /**
   * Read messages from an agent's native inbox.
   */
  async readMessages(teamName: string, sessionId: string): Promise<NativeMessage[]> {
    const inboxDir = join(this.teamsDir, teamName, 'messages', sessionId);
    if (!existsSync(inboxDir)) return [];

    const files = await readdir(inboxDir);
    const messages: NativeMessage[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = readFileSync(join(inboxDir, file), 'utf-8');
        messages.push(JSON.parse(content) as NativeMessage);
      } catch {
        // Skip malformed files
      }
    }

    // Sort by timestamp
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return messages;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Ensure required directories exist.
   */
  private ensureDirectories(): void {
    if (!existsSync(this.teamsDir)) {
      mkdirSync(this.teamsDir, { recursive: true });
    }
    if (!existsSync(this.tasksDir)) {
      mkdirSync(this.tasksDir, { recursive: true });
    }
  }

  /**
   * Check if native mode should fall back to process mode.
   */
  shouldFallback(): boolean {
    return !this.isAvailable && this.fallbackToProcess;
  }

  /** Get the teams directory path */
  getTeamsDir(): string {
    return this.teamsDir;
  }

  /** Get the tasks directory path */
  getTasksDir(): string {
    return this.tasksDir;
  }

  // ============================================================================
  // Agent Auto-Discovery
  // ============================================================================

  /**
   * Start watching a team's directory for new agent session directories.
   * Watches ~/.claude/teams/{teamName}/ and emits 'agent:discovered' when
   * a new subdirectory appears (each native agent creates a session directory).
   *
   * Also watches ~/.claude/tasks/{teamName}/ for task file changes from
   * previously unknown agents.
   */
  startDiscovery(teamName: string): void {
    const teamDir = join(this.teamsDir, teamName);
    if (!existsSync(teamDir)) {
      mkdirSync(teamDir, { recursive: true });
    }

    const watchKey = `discovery:${teamName}`;
    if (this.discoveryWatchers.has(watchKey)) return;

    // Scan existing directories first
    this.scanExistingAgents(teamName);

    // Watch for new directories
    const watcher = watch(teamDir, (_eventType, filename) => {
      if (!filename) return;

      const timerKey = `disc:${teamName}:${filename}`;
      const existing = this.discoveryTimers.get(timerKey);
      if (existing) clearTimeout(existing);

      this.discoveryTimers.set(timerKey, setTimeout(() => {
        this.discoveryTimers.delete(timerKey);
        this.handlePossibleAgent(teamName, filename);
      }, 100));
    });

    this.discoveryWatchers.set(watchKey, watcher);

    // Also watch the messages/ subdirectory for new session inboxes
    const messagesDir = join(teamDir, 'messages');
    if (!existsSync(messagesDir)) {
      mkdirSync(messagesDir, { recursive: true });
    }

    const msgWatchKey = `discovery-msg:${teamName}`;
    if (!this.discoveryWatchers.has(msgWatchKey)) {
      const msgWatcher = watch(messagesDir, (_eventType, filename) => {
        if (!filename) return;

        const timerKey = `disc-msg:${teamName}:${filename}`;
        const existing = this.discoveryTimers.get(timerKey);
        if (existing) clearTimeout(existing);

        this.discoveryTimers.set(timerKey, setTimeout(() => {
          this.discoveryTimers.delete(timerKey);
          const sessionDir = join(messagesDir, filename);
          if (existsSync(sessionDir)) {
            this.handlePossibleAgent(teamName, filename);
          }
        }, 100));
      });

      this.discoveryWatchers.set(msgWatchKey, msgWatcher);
    }

    console.log(`[DISCOVERY] Watching ${teamDir} for new agents`);
  }

  /**
   * Scan existing directories and register them as known agents.
   */
  private scanExistingAgents(teamName: string): void {
    // Scan team directory
    const teamDir = join(this.teamsDir, teamName);
    if (existsSync(teamDir)) {
      try {
        const entries = readdirSync(teamDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'messages') {
            this.knownAgents.add(`${teamName}:${entry.name}`);
          }
        }
      } catch {
        // Directory may not be readable
      }
    }

    // Scan messages directory for session IDs
    const messagesDir = join(teamDir, 'messages');
    if (existsSync(messagesDir)) {
      try {
        const entries = readdirSync(messagesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            this.knownAgents.add(`${teamName}:${entry.name}`);
          }
        }
      } catch {
        // Directory may not be readable
      }
    }
  }

  /**
   * Handle a directory that might be a new agent session.
   */
  private handlePossibleAgent(teamName: string, dirName: string): void {
    // Skip known directories
    if (dirName === 'messages') return;
    const agentKey = `${teamName}:${dirName}`;
    if (this.knownAgents.has(agentKey)) return;

    const fullPath = join(this.teamsDir, teamName, dirName);
    // Only if it's actually a directory (or exists in messages)
    const messagesPath = join(this.teamsDir, teamName, 'messages', dirName);
    const isTeamDir = existsSync(fullPath);
    const isMessageDir = existsSync(messagesPath);

    if (!isTeamDir && !isMessageDir) return;

    this.knownAgents.add(agentKey);

    const event: AgentDiscoveredEvent = {
      teamName,
      agentId: dirName,
      path: isTeamDir ? fullPath : messagesPath,
    };

    console.log(`[DISCOVERY] New agent detected: ${teamName}/${dirName}`);
    this.emit('agent:discovered', event);
  }

  /**
   * Get all currently known agent IDs for a team.
   */
  getKnownAgents(teamName: string): string[] {
    const prefix = `${teamName}:`;
    const agents: string[] = [];
    for (const key of this.knownAgents) {
      if (key.startsWith(prefix)) {
        agents.push(key.slice(prefix.length));
      }
    }
    return agents;
  }

  /**
   * Stop all discovery watchers.
   */
  stopDiscovery(): void {
    for (const [, watcher] of this.discoveryWatchers) {
      watcher.close();
    }
    this.discoveryWatchers.clear();

    for (const [, timer] of this.discoveryTimers) {
      clearTimeout(timer);
    }
    this.discoveryTimers.clear();

    console.log('[DISCOVERY] Stopped');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Clean up all resources (watchers, timers).
   */
  shutdown(): void {
    this.stopDiscovery();
  }
}
