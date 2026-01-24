/**
 * Checkpoint Storage
 *
 * Provides session continuity through YAML-based checkpoints.
 * Checkpoints capture work progress and can be used to resume sessions.
 */

import type { SQLiteStorage } from './sqlite.js';
import type { Checkpoint, CheckpointOutcome } from '../types.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface CreateCheckpointOptions {
  goal: string;
  now: string;
  test?: string;
  doneThisSession?: Array<{ task: string; files: string[] }>;
  blockers?: string[];
  questions?: string[];
  worked?: string[];
  failed?: string[];
  next?: string[];
  filesCreated?: string[];
  filesModified?: string[];
}

export interface CheckpointInfo {
  id: number;
  fromHandle: string;
  toHandle: string;
  checkpoint: Checkpoint;
  status: 'pending' | 'accepted' | 'rejected';
  outcome: CheckpointOutcome | null;
  createdAt: number;
  acceptedAt: number | null;
}

// ============================================================================
// DATABASE ROW TYPE
// ============================================================================

interface HandoffRow {
  id: number;
  from_handle: string;
  to_handle: string;
  context: string;
  checkpoint: string | null;
  status: string | null;
  outcome: string | null;
  accepted_at: number | null;
  created_at: number;
}

// ============================================================================
// CHECKPOINT STORAGE CLASS
// ============================================================================

export class CheckpointStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  /**
   * Create a checkpoint and store it as a handoff
   */
  createCheckpoint(
    fromHandle: string,
    toHandle: string,
    options: CreateCheckpointOptions
  ): CheckpointInfo {
    const checkpoint: Checkpoint = {
      goal: options.goal,
      now: options.now,
      test: options.test,
      doneThisSession: options.doneThisSession ?? [],
      blockers: options.blockers ?? [],
      questions: options.questions ?? [],
      worked: options.worked ?? [],
      failed: options.failed ?? [],
      next: options.next ?? [],
      files: {
        created: options.filesCreated ?? [],
        modified: options.filesModified ?? [],
      },
    };

    const now = Date.now();
    const db = this.storage.getDatabase();

    // Insert into handoffs table with checkpoint data
    const stmt = db.prepare(`
      INSERT INTO handoffs (from_handle, to_handle, context, checkpoint, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);

    const result = stmt.run(
      fromHandle,
      toHandle,
      JSON.stringify({ type: 'checkpoint' }),  // Basic context
      JSON.stringify(checkpoint),
      now
    );

    return {
      id: result.lastInsertRowid as number,
      fromHandle,
      toHandle,
      checkpoint,
      status: 'pending',
      outcome: null,
      createdAt: now,
      acceptedAt: null,
    };
  }

  /**
   * Load a checkpoint by ID
   */
  loadCheckpoint(checkpointId: number): CheckpointInfo | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM handoffs WHERE id = ? AND checkpoint IS NOT NULL
    `);

    const row = stmt.get(checkpointId) as HandoffRow | undefined;
    if (!row || !row.checkpoint) return null;

    return this.rowToCheckpointInfo(row);
  }

  /**
   * Load the most recent checkpoint for a handle
   */
  loadLatestCheckpoint(toHandle: string): CheckpointInfo | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM handoffs
      WHERE to_handle = ? AND checkpoint IS NOT NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);

    const row = stmt.get(toHandle) as HandoffRow | undefined;
    if (!row || !row.checkpoint) return null;

    return this.rowToCheckpointInfo(row);
  }

  /**
   * List all checkpoints for a handle
   */
  listCheckpoints(
    handle: string,
    options: { role?: 'from' | 'to' | 'both'; status?: 'pending' | 'accepted' | 'rejected'; limit?: number } = {}
  ): CheckpointInfo[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = ['checkpoint IS NOT NULL'];
    const params: (string | number)[] = [];

    const role = options.role ?? 'both';
    if (role === 'from') {
      conditions.push('from_handle = ?');
      params.push(handle);
    } else if (role === 'to') {
      conditions.push('to_handle = ?');
      params.push(handle);
    } else {
      conditions.push('(from_handle = ? OR to_handle = ?)');
      params.push(handle, handle);
    }

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const limit = options.limit ?? 50;
    const sql = `
      SELECT * FROM handoffs
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?
    `;

    params.push(limit);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as HandoffRow[];

    return rows.filter((row) => row.checkpoint).map((row) => this.rowToCheckpointInfo(row));
  }

  /**
   * Accept a checkpoint (mark as accepted)
   */
  acceptCheckpoint(checkpointId: number): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE handoffs SET status = 'accepted', accepted_at = ?
      WHERE id = ? AND checkpoint IS NOT NULL AND status = 'pending'
    `);

    const result = stmt.run(Date.now(), checkpointId);
    return result.changes > 0;
  }

  /**
   * Reject a checkpoint
   */
  rejectCheckpoint(checkpointId: number): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE handoffs SET status = 'rejected'
      WHERE id = ? AND checkpoint IS NOT NULL AND status = 'pending'
    `);

    const result = stmt.run(checkpointId);
    return result.changes > 0;
  }

  /**
   * Set the outcome of a checkpoint
   */
  setOutcome(checkpointId: number, outcome: CheckpointOutcome): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE handoffs SET outcome = ?
      WHERE id = ? AND checkpoint IS NOT NULL
    `);

    const result = stmt.run(outcome, checkpointId);
    return result.changes > 0;
  }

  /**
   * Get pending checkpoints count for a handle
   */
  getPendingCount(toHandle: string): number {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM handoffs
      WHERE to_handle = ? AND checkpoint IS NOT NULL AND status = 'pending'
    `);

    const result = stmt.get(toHandle) as { count: number };
    return result.count;
  }

  /**
   * Convert checkpoint to YAML format (for handoff files)
   */
  toYaml(checkpoint: Checkpoint): string {
    const lines: string[] = [
      '---',
      `goal: ${this.escapeYaml(checkpoint.goal)}`,
      `now: ${this.escapeYaml(checkpoint.now)}`,
    ];

    if (checkpoint.test) {
      lines.push(`test: ${this.escapeYaml(checkpoint.test)}`);
    }

    if (checkpoint.doneThisSession.length > 0) {
      lines.push('done_this_session:');
      for (const item of checkpoint.doneThisSession) {
        lines.push(`  - task: ${this.escapeYaml(item.task)}`);
        lines.push(`    files: [${item.files.map((f) => this.escapeYaml(f)).join(', ')}]`);
      }
    }

    if (checkpoint.blockers.length > 0) {
      lines.push(`blockers: [${checkpoint.blockers.map((b) => this.escapeYaml(b)).join(', ')}]`);
    }

    if (checkpoint.questions.length > 0) {
      lines.push(`questions: [${checkpoint.questions.map((q) => this.escapeYaml(q)).join(', ')}]`);
    }

    if (checkpoint.worked.length > 0) {
      lines.push(`worked: [${checkpoint.worked.map((w) => this.escapeYaml(w)).join(', ')}]`);
    }

    if (checkpoint.failed.length > 0) {
      lines.push(`failed: [${checkpoint.failed.map((f) => this.escapeYaml(f)).join(', ')}]`);
    }

    if (checkpoint.next.length > 0) {
      lines.push('next:');
      for (const item of checkpoint.next) {
        lines.push(`  - ${this.escapeYaml(item)}`);
      }
    }

    if (checkpoint.files.created.length > 0 || checkpoint.files.modified.length > 0) {
      lines.push('files:');
      if (checkpoint.files.created.length > 0) {
        lines.push(`  created: [${checkpoint.files.created.map((f) => this.escapeYaml(f)).join(', ')}]`);
      }
      if (checkpoint.files.modified.length > 0) {
        lines.push(`  modified: [${checkpoint.files.modified.map((f) => this.escapeYaml(f)).join(', ')}]`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Parse YAML checkpoint format
   */
  fromYaml(yaml: string): Checkpoint | null {
    try {
      // Simple YAML parser for checkpoint format
      const lines = yaml.split('\n');
      const checkpoint: Checkpoint = {
        goal: '',
        now: '',
        doneThisSession: [],
        blockers: [],
        questions: [],
        worked: [],
        failed: [],
        next: [],
        files: { created: [], modified: [] },
      };

      let currentSection = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '---' || trimmed === '') continue;

        if (trimmed.startsWith('goal:')) {
          checkpoint.goal = this.parseYamlValue(trimmed.slice(5));
        } else if (trimmed.startsWith('now:')) {
          checkpoint.now = this.parseYamlValue(trimmed.slice(4));
        } else if (trimmed.startsWith('test:')) {
          checkpoint.test = this.parseYamlValue(trimmed.slice(5));
        } else if (trimmed.startsWith('blockers:')) {
          checkpoint.blockers = this.parseYamlArray(trimmed.slice(9));
        } else if (trimmed.startsWith('questions:')) {
          checkpoint.questions = this.parseYamlArray(trimmed.slice(10));
        } else if (trimmed.startsWith('worked:')) {
          checkpoint.worked = this.parseYamlArray(trimmed.slice(7));
        } else if (trimmed.startsWith('failed:')) {
          checkpoint.failed = this.parseYamlArray(trimmed.slice(7));
        } else if (trimmed === 'done_this_session:') {
          currentSection = 'done';
        } else if (trimmed === 'next:') {
          currentSection = 'next';
        } else if (trimmed === 'files:') {
          currentSection = 'files';
        } else if (currentSection === 'next' && trimmed.startsWith('- ')) {
          checkpoint.next.push(this.parseYamlValue(trimmed.slice(2)));
        } else if (currentSection === 'files') {
          if (trimmed.startsWith('created:')) {
            checkpoint.files.created = this.parseYamlArray(trimmed.slice(8));
          } else if (trimmed.startsWith('modified:')) {
            checkpoint.files.modified = this.parseYamlArray(trimmed.slice(9));
          }
        }
      }

      return checkpoint;
    } catch {
      return null;
    }
  }

  /**
   * Escape a value for YAML
   */
  private escapeYaml(value: string): string {
    if (value.includes(':') || value.includes('"') || value.includes("'")) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  /**
   * Parse a simple YAML value
   */
  private parseYamlValue(value: string): string {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  /**
   * Parse a simple YAML array (inline format)
   */
  private parseYamlArray(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
      return [];
    }
    const inner = trimmed.slice(1, -1);
    if (!inner.trim()) return [];
    return inner.split(',').map((item) => this.parseYamlValue(item.trim()));
  }

  /**
   * Convert database row to CheckpointInfo
   */
  private rowToCheckpointInfo(row: HandoffRow): CheckpointInfo {
    return {
      id: row.id,
      fromHandle: row.from_handle,
      toHandle: row.to_handle,
      checkpoint: JSON.parse(row.checkpoint!) as Checkpoint,
      status: (row.status ?? 'pending') as 'pending' | 'accepted' | 'rejected',
      outcome: row.outcome as CheckpointOutcome | null,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
    };
  }
}
