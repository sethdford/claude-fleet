/**
 * Task Sync Bridge
 *
 * Bidirectional sync between Fleet's SQLite task system and
 * Claude Code's file-based ~/.claude/tasks/ system.
 *
 * - When a native agent updates task status → syncs to Fleet SQLite
 * - When Fleet updates a task → writes to ~/.claude/tasks/{team}/{id}.json
 * - Conflict resolution: last-write-wins with timestamps
 * - Debounced sync (100ms) to avoid thrashing
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { SQLiteStorage } from '../storage/sqlite.js';

// ============================================================================
// Types
// ============================================================================

/** Fleet task status values (matches TaskStatus from types.ts) */
type FleetTaskStatus = 'open' | 'in_progress' | 'resolved' | 'blocked';

/** Native task status values */
type NativeTaskStatus = 'pending' | 'in_progress' | 'completed';

/** JSON format for native task files */
interface NativeTaskFile {
  id: string;
  subject: string;
  description: string;
  status: NativeTaskStatus;
  owner: string | null;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

/** Events emitted by TaskSyncBridge */
export interface TaskSyncEvents {
  'sync:fleet-to-native': { taskId: string; teamName: string };
  'sync:native-to-fleet': { taskId: string; teamName: string };
  'sync:conflict': { taskId: string; teamName: string; resolution: 'fleet' | 'native' };
  'sync:error': { taskId: string; teamName: string; error: string };
}

/** Configuration for the task sync bridge */
export interface TaskSyncConfig {
  /** Base directory for native tasks (default: ~/.claude/tasks) */
  tasksDir?: string;
  /** Debounce interval in ms (default: 100) */
  debounceMs?: number;
  /** Enable sync (default: true when native mode is active) */
  enabled?: boolean;
}

// ============================================================================
// Status Mapping
// ============================================================================

/** Map Fleet status → native file status */
function fleetToNativeStatus(status: FleetTaskStatus): NativeTaskStatus {
  switch (status) {
    case 'open': return 'pending';
    case 'in_progress': return 'in_progress';
    case 'resolved': return 'completed';
    case 'blocked': return 'pending'; // blocked maps to pending (blockedBy carries the detail)
    default: return 'pending';
  }
}

/** Map native file status → Fleet status */
function nativeToFleetStatus(status: NativeTaskStatus): FleetTaskStatus {
  switch (status) {
    case 'pending': return 'open';
    case 'in_progress': return 'in_progress';
    case 'completed': return 'resolved';
    default: return 'open';
  }
}

// ============================================================================
// TaskSyncBridge
// ============================================================================

export class TaskSyncBridge extends EventEmitter {
  private readonly tasksDir: string;
  private readonly debounceMs: number;
  private storage: SQLiteStorage | null;
  private watchers = new Map<string, ReturnType<typeof watch>>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private isSyncing = false;
  private enabled: boolean;

  constructor(storage: SQLiteStorage | null, config: TaskSyncConfig = {}) {
    super();
    this.storage = storage;
    this.tasksDir = config.tasksDir ?? join(homedir(), '.claude', 'tasks');
    this.debounceMs = config.debounceMs ?? 100;
    this.enabled = config.enabled ?? true;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Start watching task directories for all known teams.
   */
  start(teamNames: string[]): void {
    if (!this.enabled) return;

    // Ensure base tasks directory exists
    if (!existsSync(this.tasksDir)) {
      mkdirSync(this.tasksDir, { recursive: true });
    }

    for (const team of teamNames) {
      this.watchTeam(team);
    }

    console.log(`[TASK-SYNC] Started watching ${teamNames.length} team(s)`);
  }

  /**
   * Start watching a specific team's task directory.
   */
  watchTeam(teamName: string): void {
    if (this.watchers.has(teamName)) return;

    const teamDir = join(this.tasksDir, teamName);
    if (!existsSync(teamDir)) {
      mkdirSync(teamDir, { recursive: true });
    }

    const watcher = watch(teamDir, (_eventType, filename) => {
      if (!filename?.endsWith('.json')) return;

      const timerKey = `${teamName}:${filename}`;
      const existing = this.debounceTimers.get(timerKey);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(timerKey, setTimeout(() => {
        this.debounceTimers.delete(timerKey);
        const taskId = filename.replace('.json', '');
        this.syncNativeToFleet(teamName, taskId).catch((error: Error) => {
          this.emit('sync:error', { taskId, teamName, error: error.message });
        });
      }, this.debounceMs));
    });

    this.watchers.set(teamName, watcher);
  }

  /**
   * Stop all watchers and clean up.
   */
  shutdown(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    console.log('[TASK-SYNC] Shut down');
  }

  // ============================================================================
  // Fleet → Native Sync
  // ============================================================================

  /**
   * Sync a Fleet task to the native file system.
   * Called when a task is created or updated via the Fleet HTTP API.
   */
  syncFleetToNative(teamName: string, taskId: string): void {
    if (!this.enabled || !this.storage) return;

    // Prevent sync loops
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const fleetTask = this.storage.getTask(taskId);
      if (!fleetTask) {
        this.isSyncing = false;
        return;
      }

      const nativeStatus = fleetToNativeStatus(fleetTask.status as FleetTaskStatus);
      const blockedBy = fleetTask.blockedBy ?? [];

      const nativeTask: NativeTaskFile = {
        id: fleetTask.id,
        subject: fleetTask.subject,
        description: fleetTask.description ?? '',
        status: nativeStatus,
        owner: fleetTask.ownerHandle ?? null,
        blockedBy: Array.isArray(blockedBy) ? blockedBy : [],
        createdAt: fleetTask.createdAt,
        updatedAt: new Date().toISOString(),
      };

      const teamDir = join(this.tasksDir, teamName);
      if (!existsSync(teamDir)) {
        mkdirSync(teamDir, { recursive: true });
      }

      const filePath = join(teamDir, `${taskId}.json`);
      writeFileSync(filePath, JSON.stringify(nativeTask, null, 2), 'utf-8');

      this.emit('sync:fleet-to-native', { taskId, teamName });
    } catch (error) {
      this.emit('sync:error', {
        taskId,
        teamName,
        error: (error as Error).message,
      });
    } finally {
      this.isSyncing = false;
    }
  }

  // ============================================================================
  // Native → Fleet Sync
  // ============================================================================

  /**
   * Sync a native task file to Fleet's SQLite database.
   * Called when a file change is detected in ~/.claude/tasks/{team}/.
   */
  private async syncNativeToFleet(teamName: string, taskId: string): Promise<void> {
    if (!this.storage) return;

    // Prevent sync loops
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const filePath = join(this.tasksDir, teamName, `${taskId}.json`);
      if (!existsSync(filePath)) {
        this.isSyncing = false;
        return;
      }

      const content = readFileSync(filePath, 'utf-8');
      const nativeTask = JSON.parse(content) as NativeTaskFile;
      const fleetStatus = nativeToFleetStatus(nativeTask.status);

      // Check if task exists in Fleet
      const existingTask = this.storage.getTask(taskId);

      if (existingTask) {
        // Conflict resolution: last-write-wins based on timestamps
        const nativeUpdated = new Date(nativeTask.updatedAt).getTime();
        const fleetUpdated = new Date(existingTask.updatedAt).getTime();

        if (nativeUpdated <= fleetUpdated) {
          // Fleet is newer or same — skip
          this.emit('sync:conflict', { taskId, teamName, resolution: 'fleet' });
          return;
        }

        // Native is newer — update Fleet (propagate owner + blockedBy too)
        this.storage.updateTaskAssignment(
          taskId,
          nativeTask.owner,
          nativeTask.blockedBy,
          fleetStatus,
          new Date().toISOString()
        );

        this.emit('sync:conflict', { taskId, teamName, resolution: 'native' });
      } else {
        // Task doesn't exist in Fleet — create it
        // We need a createdBy for the task; use the owner or a sentinel
        const createdByHandle = nativeTask.owner ?? 'native-agent';

        this.storage.insertTask({
          id: taskId,
          teamName,
          subject: nativeTask.subject,
          description: nativeTask.description,
          ownerHandle: nativeTask.owner,
          ownerUid: null,
          createdByHandle,
          createdByUid: 'native',
          status: fleetStatus,
          blockedBy: nativeTask.blockedBy,
          createdAt: nativeTask.createdAt,
          updatedAt: nativeTask.updatedAt,
        });
      }

      this.emit('sync:native-to-fleet', { taskId, teamName });
    } catch (error) {
      this.emit('sync:error', {
        taskId,
        teamName,
        error: (error as Error).message,
      });
    } finally {
      this.isSyncing = false;
    }
  }

  // ============================================================================
  // Bulk Sync
  // ============================================================================

  /**
   * Perform a full sync: read all native task files and sync to Fleet.
   * Useful on startup to catch changes that occurred while Fleet was offline.
   */
  async fullSync(teamName: string): Promise<{ synced: number; errors: number }> {
    const teamDir = join(this.tasksDir, teamName);
    if (!existsSync(teamDir)) return { synced: 0, errors: 0 };

    let synced = 0;
    let errors = 0;

    const files = await readdir(teamDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const taskId = file.replace('.json', '');
      try {
        await this.syncNativeToFleet(teamName, taskId);
        synced++;
      } catch {
        errors++;
      }
    }

    console.log(`[TASK-SYNC] Full sync for ${teamName}: ${synced} synced, ${errors} errors`);
    return { synced, errors };
  }
}
