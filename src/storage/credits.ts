/**
 * Agent Credits & Reputation Storage
 *
 * Implements a credit and reputation system for market-based task allocation.
 * Agents earn credits for completing tasks and spend them to claim work.
 * Reputation scores influence priority in bidding and task assignment.
 */

import type { SQLiteStorage } from './sqlite.js';
import type {
  AgentCredits,
  CreditTransaction,
  CreditTransactionType,
} from '../types.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface RecordTransactionOptions {
  swarmId: string;
  agentHandle: string;
  transactionType: CreditTransactionType;
  amount: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
}

export interface TransferCreditsOptions {
  swarmId: string;
  fromHandle: string;
  toHandle: string;
  amount: number;
  reason?: string;
}

export interface LeaderboardEntry {
  agentHandle: string;
  balance: number;
  reputationScore: number;
  totalEarned: number;
  taskCount: number;
  successCount: number;
  successRate: number;
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

interface CreditsRow {
  id: number;
  swarm_id: string;
  agent_handle: string;
  balance: number;
  reputation_score: number;
  total_earned: number;
  total_spent: number;
  task_count: number;
  success_count: number;
  created_at: number;
  updated_at: number;
}

interface TransactionRow {
  id: number;
  swarm_id: string;
  agent_handle: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  created_at: number;
}

// ============================================================================
// CREDIT STORAGE CLASS
// ============================================================================

export class CreditStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  // ============================================================================
  // CREDITS MANAGEMENT
  // ============================================================================

  /**
   * Get or create credits for an agent
   * New agents start with 100 credits and 0.5 reputation
   */
  getOrCreateCredits(swarmId: string, agentHandle: string): AgentCredits {
    const db = this.storage.getDatabase();
    const now = Date.now();

    // Try to get existing
    const getStmt = db.prepare(`
      SELECT * FROM agent_credits
      WHERE swarm_id = ? AND agent_handle = ?
    `);
    let row = getStmt.get(swarmId, agentHandle) as CreditsRow | undefined;

    if (!row) {
      // Create new credits
      const insertStmt = db.prepare(`
        INSERT INTO agent_credits (swarm_id, agent_handle, balance, reputation_score, total_earned, total_spent, task_count, success_count, created_at, updated_at)
        VALUES (?, ?, 100.0, 0.5, 0.0, 0.0, 0, 0, ?, ?)
        RETURNING *
      `);
      row = insertStmt.get(swarmId, agentHandle, now, now) as CreditsRow;
    }

    return this.rowToCredits(row);
  }

  /**
   * Get credits for an agent (returns null if not found)
   */
  getCredits(swarmId: string, agentHandle: string): AgentCredits | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM agent_credits
      WHERE swarm_id = ? AND agent_handle = ?
    `);
    const row = stmt.get(swarmId, agentHandle) as CreditsRow | undefined;
    return row ? this.rowToCredits(row) : null;
  }

  /**
   * Record a credit transaction and update balance
   * Returns the updated credits
   */
  recordTransaction(options: RecordTransactionOptions): AgentCredits {
    const db = this.storage.getDatabase();
    const now = Date.now();

    // Get or create credits first
    const credits = this.getOrCreateCredits(options.swarmId, options.agentHandle);

    // Calculate new balance
    let newBalance = credits.balance;
    let totalEarned = credits.totalEarned;
    let totalSpent = credits.totalSpent;

    switch (options.transactionType) {
      case 'earn':
      case 'bonus':
        newBalance += options.amount;
        totalEarned += options.amount;
        break;
      case 'spend':
      case 'penalty':
        newBalance -= options.amount;
        totalSpent += options.amount;
        break;
      case 'transfer':
        newBalance += options.amount; // Can be positive or negative
        if (options.amount > 0) {
          totalEarned += options.amount;
        } else {
          totalSpent -= options.amount;
        }
        break;
      case 'adjustment':
        newBalance += options.amount;
        break;
    }

    // Prevent negative balance
    newBalance = Math.max(0, newBalance);

    // Update credits
    const updateStmt = db.prepare(`
      UPDATE agent_credits
      SET balance = ?, total_earned = ?, total_spent = ?, updated_at = ?
      WHERE swarm_id = ? AND agent_handle = ?
    `);
    updateStmt.run(newBalance, totalEarned, totalSpent, now, options.swarmId, options.agentHandle);

    // Record transaction
    const txStmt = db.prepare(`
      INSERT INTO credit_transactions (swarm_id, agent_handle, transaction_type, amount, balance_after, reference_type, reference_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    txStmt.run(
      options.swarmId,
      options.agentHandle,
      options.transactionType,
      options.amount,
      newBalance,
      options.referenceType ?? null,
      options.referenceId ?? null,
      options.reason ?? null,
      now
    );

    return {
      ...credits,
      balance: newBalance,
      totalEarned,
      totalSpent,
      updatedAt: now,
    };
  }

  /**
   * Transfer credits between agents
   */
  transferCredits(options: TransferCreditsOptions): { from: AgentCredits; to: AgentCredits } {
    const db = this.storage.getDatabase();

    // Use transaction for atomicity
    const transfer = db.transaction(() => {
      // Deduct from sender
      const fromCredits = this.recordTransaction({
        swarmId: options.swarmId,
        agentHandle: options.fromHandle,
        transactionType: 'transfer',
        amount: -options.amount,
        referenceType: 'transfer',
        referenceId: options.toHandle,
        reason: options.reason ?? `Transfer to ${options.toHandle}`,
      });

      // Add to receiver
      const toCredits = this.recordTransaction({
        swarmId: options.swarmId,
        agentHandle: options.toHandle,
        transactionType: 'transfer',
        amount: options.amount,
        referenceType: 'transfer',
        referenceId: options.fromHandle,
        reason: options.reason ?? `Transfer from ${options.fromHandle}`,
      });

      return { from: fromCredits, to: toCredits };
    });

    return transfer();
  }

  // ============================================================================
  // REPUTATION MANAGEMENT
  // ============================================================================

  /**
   * Update reputation score based on task outcomes
   * Uses exponential moving average for smooth updates
   */
  updateReputation(swarmId: string, agentHandle: string, success: boolean, weight = 0.1): AgentCredits {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const credits = this.getOrCreateCredits(swarmId, agentHandle);

    // Exponential moving average update
    const outcome = success ? 1.0 : 0.0;
    const newReputation = credits.reputationScore * (1 - weight) + outcome * weight;

    // Update task counts
    const newTaskCount = credits.taskCount + 1;
    const newSuccessCount = success ? credits.successCount + 1 : credits.successCount;

    const stmt = db.prepare(`
      UPDATE agent_credits
      SET reputation_score = ?, task_count = ?, success_count = ?, updated_at = ?
      WHERE swarm_id = ? AND agent_handle = ?
    `);
    stmt.run(newReputation, newTaskCount, newSuccessCount, now, swarmId, agentHandle);

    return {
      ...credits,
      reputationScore: newReputation,
      taskCount: newTaskCount,
      successCount: newSuccessCount,
      updatedAt: now,
    };
  }

  /**
   * Decay reputation for inactive agents
   * Moves reputation toward 0.5 (neutral)
   */
  decayReputation(swarmId: string, decayRate = 0.05, inactivityThreshold = 86400000): number {
    const db = this.storage.getDatabase();
    const now = Date.now();
    const cutoff = now - inactivityThreshold;

    const stmt = db.prepare(`
      UPDATE agent_credits
      SET reputation_score = reputation_score * (1 - ?) + 0.5 * ?,
          updated_at = ?
      WHERE swarm_id = ? AND updated_at < ?
    `);

    const result = stmt.run(decayRate, decayRate, now, swarmId, cutoff);
    return result.changes;
  }

  // ============================================================================
  // LEADERBOARD & QUERIES
  // ============================================================================

  /**
   * Get leaderboard for a swarm
   */
  getLeaderboard(
    swarmId: string,
    orderBy: 'balance' | 'reputation' | 'earned' | 'tasks' = 'reputation',
    limit = 20
  ): LeaderboardEntry[] {
    const db = this.storage.getDatabase();

    const orderColumn = {
      balance: 'balance',
      reputation: 'reputation_score',
      earned: 'total_earned',
      tasks: 'task_count',
    }[orderBy];

    const stmt = db.prepare(`
      SELECT * FROM agent_credits
      WHERE swarm_id = ?
      ORDER BY ${orderColumn} DESC
      LIMIT ?
    `);

    const rows = stmt.all(swarmId, limit) as CreditsRow[];

    return rows.map((row) => ({
      agentHandle: row.agent_handle,
      balance: row.balance,
      reputationScore: row.reputation_score,
      totalEarned: row.total_earned,
      taskCount: row.task_count,
      successCount: row.success_count,
      successRate: row.task_count > 0 ? row.success_count / row.task_count : 0,
    }));
  }

  /**
   * Get transaction history for an agent
   */
  getTransactionHistory(
    swarmId: string,
    agentHandle: string,
    options: {
      transactionType?: CreditTransactionType;
      since?: number;
      limit?: number;
    } = {}
  ): CreditTransaction[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = ['swarm_id = ?', 'agent_handle = ?'];
    const params: (string | number)[] = [swarmId, agentHandle];

    if (options.transactionType) {
      conditions.push('transaction_type = ?');
      params.push(options.transactionType);
    }

    if (options.since) {
      conditions.push('created_at >= ?');
      params.push(options.since);
    }

    const limit = options.limit ?? 100;
    const sql = `
      SELECT * FROM credit_transactions
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?
    `;

    params.push(limit);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as TransactionRow[];

    return rows.map((row) => this.rowToTransaction(row));
  }

  /**
   * Get summary statistics for a swarm
   */
  getStats(swarmId: string): {
    totalAgents: number;
    totalBalance: number;
    totalEarned: number;
    totalSpent: number;
    avgReputation: number;
    totalTasks: number;
    totalSuccesses: number;
  } {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT
        COUNT(*) as agents,
        SUM(balance) as total_balance,
        SUM(total_earned) as total_earned,
        SUM(total_spent) as total_spent,
        AVG(reputation_score) as avg_reputation,
        SUM(task_count) as total_tasks,
        SUM(success_count) as total_successes
      FROM agent_credits
      WHERE swarm_id = ?
    `);

    const row = stmt.get(swarmId) as {
      agents: number;
      total_balance: number;
      total_earned: number;
      total_spent: number;
      avg_reputation: number;
      total_tasks: number;
      total_successes: number;
    };

    return {
      totalAgents: row.agents ?? 0,
      totalBalance: row.total_balance ?? 0,
      totalEarned: row.total_earned ?? 0,
      totalSpent: row.total_spent ?? 0,
      avgReputation: row.avg_reputation ?? 0.5,
      totalTasks: row.total_tasks ?? 0,
      totalSuccesses: row.total_successes ?? 0,
    };
  }

  // ============================================================================
  // ROW CONVERTERS
  // ============================================================================

  private rowToCredits(row: CreditsRow): AgentCredits {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      agentHandle: row.agent_handle,
      balance: row.balance,
      reputationScore: row.reputation_score,
      totalEarned: row.total_earned,
      totalSpent: row.total_spent,
      taskCount: row.task_count,
      successCount: row.success_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToTransaction(row: TransactionRow): CreditTransaction {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      agentHandle: row.agent_handle,
      transactionType: row.transaction_type as CreditTransactionType,
      amount: row.amount,
      balanceAfter: row.balance_after,
      referenceType: row.reference_type ?? null,
      referenceId: row.reference_id ?? null,
      reason: row.reason ?? null,
      createdAt: row.created_at,
    };
  }
}
