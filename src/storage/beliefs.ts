/**
 * Agent Belief Storage
 *
 * Implements Theory of Mind for multi-agent coordination.
 * Tracks what agents know (beliefs) and what they believe about other agents (meta-beliefs).
 * Enables better coordination through shared understanding.
 */

import type { SQLiteStorage } from './sqlite.js';
import type {
  AgentBelief,
  AgentMetaBelief,
  BeliefType,
  BeliefSourceType,
  MetaBeliefType,
} from '../types.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface UpsertBeliefOptions {
  swarmId: string;
  agentHandle: string;
  beliefType: BeliefType;
  subject: string;
  beliefValue: string;
  confidence?: number;
  sourceHandle?: string;
  sourceType?: BeliefSourceType;
  validUntil?: number;
}

export interface QueryBeliefOptions {
  beliefType?: BeliefType;
  subject?: string;
  minConfidence?: number;
  includeExpired?: boolean;
  limit?: number;
}

export interface UpsertMetaBeliefOptions {
  swarmId: string;
  agentHandle: string;
  aboutHandle: string;
  metaType: MetaBeliefType;
  beliefValue: string;
  confidence?: number;
}

export interface SwarmConsensus {
  subject: string;
  consensusValue: string | null;
  agreementLevel: number;
  beliefs: Array<{
    agentHandle: string;
    beliefValue: string;
    confidence: number;
  }>;
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

interface BeliefRow {
  id: number;
  swarm_id: string;
  agent_handle: string;
  belief_type: string;
  subject: string;
  belief_value: string;
  confidence: number;
  source_handle: string | null;
  source_type: string | null;
  valid_until: number | null;
  created_at: number;
  updated_at: number;
}

interface MetaBeliefRow {
  id: number;
  swarm_id: string;
  agent_handle: string;
  about_handle: string;
  meta_type: string;
  belief_value: string;
  confidence: number;
  evidence_count: number;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// BELIEF STORAGE CLASS
// ============================================================================

export class BeliefStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  // ============================================================================
  // AGENT BELIEFS
  // ============================================================================

  /**
   * Create or update an agent's belief
   * Uses UPSERT to handle conflicts on (swarm_id, agent_handle, subject)
   */
  upsertBelief(options: UpsertBeliefOptions): AgentBelief {
    const now = Date.now();
    const confidence = options.confidence ?? 0.5;
    const sourceType = options.sourceType ?? 'direct';

    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO agent_beliefs (swarm_id, agent_handle, belief_type, subject, belief_value, confidence, source_handle, source_type, valid_until, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(swarm_id, agent_handle, subject)
      DO UPDATE SET
        belief_type = excluded.belief_type,
        belief_value = excluded.belief_value,
        confidence = excluded.confidence,
        source_handle = excluded.source_handle,
        source_type = excluded.source_type,
        valid_until = excluded.valid_until,
        updated_at = excluded.updated_at
      RETURNING *
    `);

    const row = stmt.get(
      options.swarmId,
      options.agentHandle,
      options.beliefType,
      options.subject,
      options.beliefValue,
      confidence,
      options.sourceHandle ?? null,
      sourceType,
      options.validUntil ?? null,
      now,
      now
    ) as BeliefRow;

    return this.rowToBelief(row);
  }

  /**
   * Get beliefs for an agent
   */
  getBeliefs(swarmId: string, agentHandle: string, options: QueryBeliefOptions = {}): AgentBelief[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = ['swarm_id = ?', 'agent_handle = ?'];
    const params: (string | number)[] = [swarmId, agentHandle];

    if (!options.includeExpired) {
      conditions.push('(valid_until IS NULL OR valid_until > ?)');
      params.push(Date.now());
    }

    if (options.beliefType) {
      conditions.push('belief_type = ?');
      params.push(options.beliefType);
    }

    if (options.subject) {
      conditions.push('subject = ?');
      params.push(options.subject);
    }

    if (options.minConfidence !== undefined) {
      conditions.push('confidence >= ?');
      params.push(options.minConfidence);
    }

    const limit = options.limit ?? 100;
    const sql = `
      SELECT * FROM agent_beliefs
      WHERE ${conditions.join(' AND ')}
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `;

    params.push(limit);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as BeliefRow[];

    return rows.map((row) => this.rowToBelief(row));
  }

  /**
   * Get a specific belief
   */
  getBelief(swarmId: string, agentHandle: string, subject: string): AgentBelief | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM agent_beliefs
      WHERE swarm_id = ? AND agent_handle = ? AND subject = ?
    `);
    const row = stmt.get(swarmId, agentHandle, subject) as BeliefRow | undefined;
    return row ? this.rowToBelief(row) : null;
  }

  /**
   * Delete a belief
   */
  deleteBelief(swarmId: string, agentHandle: string, subject: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      DELETE FROM agent_beliefs
      WHERE swarm_id = ? AND agent_handle = ? AND subject = ?
    `);
    const result = stmt.run(swarmId, agentHandle, subject);
    return result.changes > 0;
  }

  /**
   * Get swarm consensus on a subject
   * Returns the most common belief value and agreement level
   */
  getSwarmConsensus(swarmId: string, subject: string, minConfidence = 0.5): SwarmConsensus {
    const db = this.storage.getDatabase();
    const now = Date.now();

    // Get all beliefs on this subject
    const stmt = db.prepare(`
      SELECT agent_handle, belief_value, confidence
      FROM agent_beliefs
      WHERE swarm_id = ? AND subject = ? AND confidence >= ?
        AND (valid_until IS NULL OR valid_until > ?)
      ORDER BY confidence DESC
    `);

    const rows = stmt.all(swarmId, subject, minConfidence, now) as Array<{
      agent_handle: string;
      belief_value: string;
      confidence: number;
    }>;

    if (rows.length === 0) {
      return {
        subject,
        consensusValue: null,
        agreementLevel: 0,
        beliefs: [],
      };
    }

    // Count belief values (weighted by confidence)
    const valueCounts = new Map<string, number>();
    let totalWeight = 0;

    for (const row of rows) {
      const current = valueCounts.get(row.belief_value) ?? 0;
      valueCounts.set(row.belief_value, current + row.confidence);
      totalWeight += row.confidence;
    }

    // Find consensus (highest weighted count)
    let consensusValue: string | null = null;
    let maxWeight = 0;

    for (const [value, weight] of valueCounts) {
      if (weight > maxWeight) {
        maxWeight = weight;
        consensusValue = value;
      }
    }

    const agreementLevel = totalWeight > 0 ? maxWeight / totalWeight : 0;

    return {
      subject,
      consensusValue,
      agreementLevel,
      beliefs: rows.map((r) => ({
        agentHandle: r.agent_handle,
        beliefValue: r.belief_value,
        confidence: r.confidence,
      })),
    };
  }

  // ============================================================================
  // META-BELIEFS (Beliefs about other agents)
  // ============================================================================

  /**
   * Create or update a meta-belief about another agent
   */
  upsertMetaBelief(options: UpsertMetaBeliefOptions): AgentMetaBelief {
    const now = Date.now();
    const confidence = options.confidence ?? 0.5;

    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO agent_meta_beliefs (swarm_id, agent_handle, about_handle, meta_type, belief_value, confidence, evidence_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(swarm_id, agent_handle, about_handle, meta_type)
      DO UPDATE SET
        belief_value = excluded.belief_value,
        confidence = excluded.confidence,
        evidence_count = evidence_count + 1,
        updated_at = excluded.updated_at
      RETURNING *
    `);

    const row = stmt.get(
      options.swarmId,
      options.agentHandle,
      options.aboutHandle,
      options.metaType,
      options.beliefValue,
      confidence,
      now,
      now
    ) as MetaBeliefRow;

    return this.rowToMetaBelief(row);
  }

  /**
   * Get meta-beliefs an agent has about others
   */
  getMetaBeliefs(swarmId: string, agentHandle: string, aboutHandle?: string): AgentMetaBelief[] {
    const db = this.storage.getDatabase();

    let sql = `
      SELECT * FROM agent_meta_beliefs
      WHERE swarm_id = ? AND agent_handle = ?
    `;
    const params: string[] = [swarmId, agentHandle];

    if (aboutHandle) {
      sql += ' AND about_handle = ?';
      params.push(aboutHandle);
    }

    sql += ' ORDER BY confidence DESC, updated_at DESC';

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as MetaBeliefRow[];

    return rows.map((row) => this.rowToMetaBelief(row));
  }

  /**
   * Get what other agents believe about a specific agent
   */
  getMetaBeliefsAbout(swarmId: string, aboutHandle: string): AgentMetaBelief[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM agent_meta_beliefs
      WHERE swarm_id = ? AND about_handle = ?
      ORDER BY confidence DESC, updated_at DESC
    `);
    const rows = stmt.all(swarmId, aboutHandle) as MetaBeliefRow[];
    return rows.map((row) => this.rowToMetaBelief(row));
  }

  /**
   * Get aggregate reputation based on meta-beliefs
   */
  getAgentReputation(swarmId: string, agentHandle: string): {
    avgReliability: number;
    avgCapability: number;
    evidenceCount: number;
    raters: number;
  } {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT
        AVG(CASE WHEN meta_type = 'reliability' THEN confidence ELSE NULL END) as avg_reliability,
        AVG(CASE WHEN meta_type = 'capability' THEN confidence ELSE NULL END) as avg_capability,
        SUM(evidence_count) as evidence_count,
        COUNT(DISTINCT agent_handle) as raters
      FROM agent_meta_beliefs
      WHERE swarm_id = ? AND about_handle = ?
        AND meta_type IN ('reliability', 'capability')
    `);

    const row = stmt.get(swarmId, agentHandle) as {
      avg_reliability: number | null;
      avg_capability: number | null;
      evidence_count: number | null;
      raters: number;
    };

    return {
      avgReliability: row.avg_reliability ?? 0.5,
      avgCapability: row.avg_capability ?? 0.5,
      evidenceCount: row.evidence_count ?? 0,
      raters: row.raters ?? 0,
    };
  }

  /**
   * Expire old beliefs
   */
  expireBeliefs(swarmId: string): number {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      DELETE FROM agent_beliefs
      WHERE swarm_id = ? AND valid_until IS NOT NULL AND valid_until < ?
    `);

    const result = stmt.run(swarmId, now);
    return result.changes;
  }

  /**
   * Get belief statistics for a swarm
   */
  getStats(swarmId: string): {
    totalBeliefs: number;
    totalMetaBeliefs: number;
    uniqueAgents: number;
    uniqueSubjects: number;
    byType: Record<BeliefType, number>;
    avgConfidence: number;
  } {
    const db = this.storage.getDatabase();

    // Belief stats
    const beliefStmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT agent_handle) as agents,
        COUNT(DISTINCT subject) as subjects,
        AVG(confidence) as avg_confidence
      FROM agent_beliefs
      WHERE swarm_id = ?
    `);
    const beliefStats = beliefStmt.get(swarmId) as {
      total: number;
      agents: number;
      subjects: number;
      avg_confidence: number;
    };

    // Meta-belief count
    const metaStmt = db.prepare(`
      SELECT COUNT(*) as total FROM agent_meta_beliefs WHERE swarm_id = ?
    `);
    const metaStats = metaStmt.get(swarmId) as { total: number };

    // By type
    const typeStmt = db.prepare(`
      SELECT belief_type, COUNT(*) as count
      FROM agent_beliefs
      WHERE swarm_id = ?
      GROUP BY belief_type
    `);
    const typeRows = typeStmt.all(swarmId) as Array<{ belief_type: string; count: number }>;
    const byType: Record<BeliefType, number> = {
      knowledge: 0,
      assumption: 0,
      inference: 0,
      observation: 0,
    };
    for (const row of typeRows) {
      byType[row.belief_type as BeliefType] = row.count;
    }

    return {
      totalBeliefs: beliefStats.total ?? 0,
      totalMetaBeliefs: metaStats.total ?? 0,
      uniqueAgents: beliefStats.agents ?? 0,
      uniqueSubjects: beliefStats.subjects ?? 0,
      byType,
      avgConfidence: beliefStats.avg_confidence ?? 0.5,
    };
  }

  // ============================================================================
  // ROW CONVERTERS
  // ============================================================================

  private rowToBelief(row: BeliefRow): AgentBelief {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      agentHandle: row.agent_handle,
      beliefType: row.belief_type as BeliefType,
      subject: row.subject,
      beliefValue: row.belief_value,
      confidence: row.confidence,
      sourceHandle: row.source_handle ?? undefined,
      sourceType: (row.source_type as BeliefSourceType) ?? undefined,
      validUntil: row.valid_until ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToMetaBelief(row: MetaBeliefRow): AgentMetaBelief {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      agentHandle: row.agent_handle,
      aboutHandle: row.about_handle,
      metaType: row.meta_type as MetaBeliefType,
      beliefValue: row.belief_value,
      confidence: row.confidence,
      evidenceCount: row.evidence_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
