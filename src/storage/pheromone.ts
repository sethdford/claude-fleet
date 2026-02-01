/**
 * Pheromone Trail Storage
 *
 * Implements stigmergic coordination via pheromone trails.
 * Agents deposit trails on resources (files, tasks, etc.) that decay over time,
 * enabling indirect communication and emergent coordination patterns.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from './sqlite.js';
import type {
  PheromoneTrail,
  PheromoneResourceType,
  PheromoneTrailType,
} from '../types.js';
import { createSwarmAccelerator } from '../workers/swarm-accelerator.js';
import type { SwarmAccelerator } from '../workers/swarm-accelerator.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface DepositTrailOptions {
  swarmId: string;
  resourceType: PheromoneResourceType;
  resourceId: string;
  depositorHandle: string;
  trailType: PheromoneTrailType;
  intensity?: number;
  metadata?: Record<string, unknown>;
}

export interface QueryTrailOptions {
  resourceType?: PheromoneResourceType;
  resourceId?: string;
  trailType?: PheromoneTrailType;
  depositorHandle?: string;
  minIntensity?: number;
  activeOnly?: boolean;
  limit?: number;
}

export interface ResourceActivity {
  resourceId: string;
  resourceType: PheromoneResourceType;
  totalIntensity: number;
  trailCount: number;
  uniqueDepositors: number;
  lastActivity: number;
}

export interface DecayResult {
  decayed: number;
  removed: number;
}

// ============================================================================
// DATABASE ROW TYPE
// ============================================================================

interface PheromoneRow {
  id: string;
  swarm_id: string;
  resource_type: string;
  resource_id: string;
  depositor_handle: string;
  trail_type: string;
  intensity: number;
  metadata: string;
  created_at: number;
  decayed_at: number | null;
}

// ============================================================================
// PHEROMONE STORAGE CLASS
// ============================================================================

export class PheromoneStorage {
  private storage: SQLiteStorage;
  private accelerator: SwarmAccelerator;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
    this.accelerator = createSwarmAccelerator();
  }

  /**
   * Deposit a pheromone trail on a resource
   */
  depositTrail(options: DepositTrailOptions): PheromoneTrail {
    const id = uuidv4();
    const now = Date.now();
    const intensity = options.intensity ?? 1.0;
    const metadata = options.metadata ?? {};

    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO pheromone_trails (id, swarm_id, resource_type, resource_id, depositor_handle, trail_type, intensity, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      options.swarmId,
      options.resourceType,
      options.resourceId,
      options.depositorHandle,
      options.trailType,
      intensity,
      JSON.stringify(metadata),
      now
    );

    return {
      id,
      swarmId: options.swarmId,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      depositorHandle: options.depositorHandle,
      trailType: options.trailType,
      intensity,
      metadata,
      createdAt: now,
      decayedAt: null,
    };
  }

  /**
   * Query pheromone trails with filtering
   */
  queryTrails(swarmId: string, options: QueryTrailOptions = {}): PheromoneTrail[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = ['swarm_id = ?'];
    const params: (string | number)[] = [swarmId];

    if (options.activeOnly !== false) {
      conditions.push('decayed_at IS NULL');
    }

    if (options.resourceType) {
      conditions.push('resource_type = ?');
      params.push(options.resourceType);
    }

    if (options.resourceId) {
      conditions.push('resource_id = ?');
      params.push(options.resourceId);
    }

    if (options.trailType) {
      conditions.push('trail_type = ?');
      params.push(options.trailType);
    }

    if (options.depositorHandle) {
      conditions.push('depositor_handle = ?');
      params.push(options.depositorHandle);
    }

    if (options.minIntensity !== undefined) {
      conditions.push('intensity >= ?');
      params.push(options.minIntensity);
    }

    const limit = options.limit ?? 100;
    const sql = `
      SELECT * FROM pheromone_trails
      WHERE ${conditions.join(' AND ')}
      ORDER BY intensity DESC, created_at DESC
      LIMIT ?
    `;

    params.push(limit);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as PheromoneRow[];

    return rows.map((row) => this.rowToTrail(row));
  }

  /**
   * Get aggregated activity for resources in a swarm
   */
  getResourceActivity(swarmId: string, resourceType?: PheromoneResourceType, limit = 20): ResourceActivity[] {
    const db = this.storage.getDatabase();

    let sql = `
      SELECT
        resource_id,
        resource_type,
        SUM(intensity) as total_intensity,
        COUNT(*) as trail_count,
        COUNT(DISTINCT depositor_handle) as unique_depositors,
        MAX(created_at) as last_activity
      FROM pheromone_trails
      WHERE swarm_id = ? AND decayed_at IS NULL
    `;

    const params: (string | number)[] = [swarmId];

    if (resourceType) {
      sql += ' AND resource_type = ?';
      params.push(resourceType);
    }

    sql += `
      GROUP BY resource_id, resource_type
      ORDER BY total_intensity DESC
      LIMIT ?
    `;
    params.push(limit);

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      resource_id: string;
      resource_type: string;
      total_intensity: number;
      trail_count: number;
      unique_depositors: number;
      last_activity: number;
    }>;

    return rows.map((row) => ({
      resourceId: row.resource_id,
      resourceType: row.resource_type as PheromoneResourceType,
      totalIntensity: row.total_intensity,
      trailCount: row.trail_count,
      uniqueDepositors: row.unique_depositors,
      lastActivity: row.last_activity,
    }));
  }

  /**
   * Get trails for a specific resource
   */
  getResourceTrails(swarmId: string, resourceId: string): PheromoneTrail[] {
    return this.queryTrails(swarmId, { resourceId, activeOnly: true });
  }

  /**
   * Process decay for all trails
   * Reduces intensity and marks fully decayed trails.
   * Uses native Rust accelerator for batch decay computation when available.
   */
  processDecay(swarmId?: string, decayRate = 0.1, minIntensity = 0.01): DecayResult {
    const db = this.storage.getDatabase();
    const now = Date.now();

    // Read active trails for native batch computation
    let selectSql = 'SELECT id, intensity, created_at FROM pheromone_trails WHERE decayed_at IS NULL';
    const selectParams: (string | number)[] = [];
    if (swarmId) {
      selectSql += ' AND swarm_id = ?';
      selectParams.push(swarmId);
    }
    const selectStmt = db.prepare(selectSql);
    const rows = selectStmt.all(...selectParams) as Array<{ id: string; intensity: number; created_at: number }>;

    // Compute decay in native/JS accelerator
    const decayInput = rows.map((r) => ({ id: r.id, intensity: r.intensity, createdAt: r.created_at }));
    const result = this.accelerator.processDecay(decayInput, decayRate, minIntensity);

    // Write back decayed intensities
    const updateStmt = db.prepare('UPDATE pheromone_trails SET intensity = ? WHERE id = ?');
    for (const trail of result.trails) {
      updateStmt.run(trail.intensity, trail.id);
    }

    // Mark trails below minimum as decayed
    if (result.removedIds.length > 0) {
      const placeholders = result.removedIds.map(() => '?').join(',');
      const markStmt = db.prepare(`UPDATE pheromone_trails SET decayed_at = ? WHERE id IN (${placeholders})`);
      markStmt.run(now, ...result.removedIds);
    }

    return {
      decayed: rows.length,
      removed: result.removedCount,
    };
  }

  /**
   * Boost trail intensity (reinforcement)
   */
  boostTrail(trailId: string, amount: number): PheromoneTrail | null {
    const db = this.storage.getDatabase();

    const stmt = db.prepare(`
      UPDATE pheromone_trails
      SET intensity = MIN(intensity + ?, 10.0)
      WHERE id = ? AND decayed_at IS NULL
    `);

    stmt.run(amount, trailId);

    return this.getTrailById(trailId);
  }

  /**
   * Get a single trail by ID
   */
  getTrailById(trailId: string): PheromoneTrail | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM pheromone_trails WHERE id = ?');
    const row = stmt.get(trailId) as PheromoneRow | undefined;
    return row ? this.rowToTrail(row) : null;
  }

  /**
   * Delete all decayed trails for a swarm
   */
  purgeDecayed(swarmId: string): number {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      DELETE FROM pheromone_trails
      WHERE swarm_id = ? AND decayed_at IS NOT NULL
    `);
    const result = stmt.run(swarmId);
    return result.changes;
  }

  /**
   * Get statistics for a swarm's pheromone trails
   */
  getStats(swarmId: string): {
    activeTrails: number;
    decayedTrails: number;
    totalIntensity: number;
    byType: Record<PheromoneTrailType, number>;
    byResource: Record<PheromoneResourceType, number>;
  } {
    const db = this.storage.getDatabase();

    // Active and decayed counts
    const countStmt = db.prepare(`
      SELECT
        SUM(CASE WHEN decayed_at IS NULL THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN decayed_at IS NOT NULL THEN 1 ELSE 0 END) as decayed,
        SUM(CASE WHEN decayed_at IS NULL THEN intensity ELSE 0 END) as total_intensity
      FROM pheromone_trails
      WHERE swarm_id = ?
    `);
    const counts = countStmt.get(swarmId) as { active: number; decayed: number; total_intensity: number };

    // By trail type
    const typeStmt = db.prepare(`
      SELECT trail_type, COUNT(*) as count
      FROM pheromone_trails
      WHERE swarm_id = ? AND decayed_at IS NULL
      GROUP BY trail_type
    `);
    const typeRows = typeStmt.all(swarmId) as Array<{ trail_type: string; count: number }>;
    const byType: Record<PheromoneTrailType, number> = {
      touch: 0, modify: 0, complete: 0, error: 0, warning: 0, success: 0
    };
    for (const row of typeRows) {
      byType[row.trail_type as PheromoneTrailType] = row.count;
    }

    // By resource type
    const resourceStmt = db.prepare(`
      SELECT resource_type, COUNT(*) as count
      FROM pheromone_trails
      WHERE swarm_id = ? AND decayed_at IS NULL
      GROUP BY resource_type
    `);
    const resourceRows = resourceStmt.all(swarmId) as Array<{ resource_type: string; count: number }>;
    const byResource: Record<PheromoneResourceType, number> = {
      file: 0, task: 0, endpoint: 0, module: 0, custom: 0
    };
    for (const row of resourceRows) {
      byResource[row.resource_type as PheromoneResourceType] = row.count;
    }

    return {
      activeTrails: counts.active ?? 0,
      decayedTrails: counts.decayed ?? 0,
      totalIntensity: counts.total_intensity ?? 0,
      byType,
      byResource,
    };
  }

  /**
   * Convert database row to PheromoneTrail
   */
  private rowToTrail(row: PheromoneRow): PheromoneTrail {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      resourceType: row.resource_type as PheromoneResourceType,
      resourceId: row.resource_id,
      depositorHandle: row.depositor_handle,
      trailType: row.trail_type as PheromoneTrailType,
      intensity: row.intensity,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      decayedAt: row.decayed_at,
    };
  }
}
