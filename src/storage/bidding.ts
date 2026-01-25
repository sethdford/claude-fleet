/**
 * Task Bidding Storage
 *
 * Implements market-based task allocation via bidding.
 * Agents bid credits on tasks, with reputation influencing bid evaluation.
 * Supports multiple auction types and automatic bid processing.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from './sqlite.js';
import type {
  TaskBid,
  BidStatus,
  BidEvaluation,
} from '../types.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface SubmitBidOptions {
  taskId: string;
  swarmId: string;
  bidderHandle: string;
  bidAmount: number;
  estimatedDuration?: number;
  confidence?: number;
  rationale?: string;
}

export interface ListBidsOptions {
  status?: BidStatus;
  bidderHandle?: string;
  minBid?: number;
  maxBid?: number;
  limit?: number;
}

export interface EvaluateBidsOptions {
  reputationWeight?: number;
  confidenceWeight?: number;
  bidWeight?: number;
  preferLowerBids?: boolean;
}

// ============================================================================
// DATABASE ROW TYPE
// ============================================================================

interface BidRow {
  id: string;
  task_id: string;
  swarm_id: string;
  bidder_handle: string;
  bid_amount: number;
  estimated_duration: number | null;
  confidence: number;
  rationale: string | null;
  status: string;
  created_at: number;
  processed_at: number | null;
}

// ============================================================================
// BIDDING STORAGE CLASS
// ============================================================================

export class BiddingStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  // ============================================================================
  // BID MANAGEMENT
  // ============================================================================

  /**
   * Submit a bid for a task
   */
  submitBid(options: SubmitBidOptions): TaskBid {
    const db = this.storage.getDatabase();
    const now = Date.now();
    const id = uuidv4();

    // Check if agent already has a pending bid on this task
    const existingStmt = db.prepare(`
      SELECT id FROM task_bids
      WHERE task_id = ? AND bidder_handle = ? AND status = 'pending'
    `);
    const existing = existingStmt.get(options.taskId, options.bidderHandle);

    if (existing) {
      // Update existing bid
      const updateStmt = db.prepare(`
        UPDATE task_bids
        SET bid_amount = ?, estimated_duration = ?, confidence = ?, rationale = ?, created_at = ?
        WHERE task_id = ? AND bidder_handle = ? AND status = 'pending'
        RETURNING *
      `);
      const row = updateStmt.get(
        options.bidAmount,
        options.estimatedDuration ?? null,
        options.confidence ?? 0.5,
        options.rationale ?? null,
        now,
        options.taskId,
        options.bidderHandle
      ) as BidRow;
      return this.rowToBid(row);
    }

    // Create new bid
    const stmt = db.prepare(`
      INSERT INTO task_bids (id, task_id, swarm_id, bidder_handle, bid_amount, estimated_duration, confidence, rationale, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    stmt.run(
      id,
      options.taskId,
      options.swarmId,
      options.bidderHandle,
      options.bidAmount,
      options.estimatedDuration ?? null,
      options.confidence ?? 0.5,
      options.rationale ?? null,
      now
    );

    return {
      id,
      taskId: options.taskId,
      swarmId: options.swarmId,
      bidderHandle: options.bidderHandle,
      bidAmount: options.bidAmount,
      estimatedDuration: options.estimatedDuration ?? null,
      confidence: options.confidence ?? 0.5,
      rationale: options.rationale ?? null,
      status: 'pending',
      createdAt: now,
      processedAt: null,
    };
  }

  /**
   * Get a bid by ID
   */
  getBid(bidId: string): TaskBid | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM task_bids WHERE id = ?');
    const row = stmt.get(bidId) as BidRow | undefined;
    return row ? this.rowToBid(row) : null;
  }

  /**
   * Get all bids for a task
   */
  getBidsForTask(taskId: string, options: ListBidsOptions = {}): TaskBid[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = ['task_id = ?'];
    const params: (string | number)[] = [taskId];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options.bidderHandle) {
      conditions.push('bidder_handle = ?');
      params.push(options.bidderHandle);
    }

    if (options.minBid !== undefined) {
      conditions.push('bid_amount >= ?');
      params.push(options.minBid);
    }

    if (options.maxBid !== undefined) {
      conditions.push('bid_amount <= ?');
      params.push(options.maxBid);
    }

    const limit = options.limit ?? 50;
    const sql = `
      SELECT * FROM task_bids
      WHERE ${conditions.join(' AND ')}
      ORDER BY bid_amount DESC, confidence DESC, created_at ASC
      LIMIT ?
    `;

    params.push(limit);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as BidRow[];

    return rows.map((row) => this.rowToBid(row));
  }

  /**
   * Withdraw a bid (only pending bids can be withdrawn)
   */
  withdrawBid(bidId: string, bidderHandle: string): boolean {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      UPDATE task_bids
      SET status = 'withdrawn', processed_at = ?
      WHERE id = ? AND bidder_handle = ? AND status = 'pending'
    `);

    const result = stmt.run(now, bidId, bidderHandle);
    return result.changes > 0;
  }

  // ============================================================================
  // BID EVALUATION
  // ============================================================================

  /**
   * Evaluate bids for a task and return scored rankings
   * Considers bid amount, confidence, and optionally agent reputation
   */
  evaluateBids(
    taskId: string,
    agentReputations: Map<string, number>,
    options: EvaluateBidsOptions = {}
  ): BidEvaluation[] {
    const bids = this.getBidsForTask(taskId, { status: 'pending' });

    if (bids.length === 0) {
      return [];
    }

    const reputationWeight = options.reputationWeight ?? 0.3;
    const confidenceWeight = options.confidenceWeight ?? 0.2;
    const bidWeight = options.bidWeight ?? 0.5;
    const preferLower = options.preferLowerBids ?? false;

    // Normalize bid amounts
    const bidAmounts = bids.map((b) => b.bidAmount);
    const maxBid = Math.max(...bidAmounts);
    const minBid = Math.min(...bidAmounts);
    const bidRange = maxBid - minBid || 1;

    const evaluations: BidEvaluation[] = bids.map((bid) => {
      const reputation = agentReputations.get(bid.bidderHandle) ?? 0.5;

      // Normalize bid (0-1 scale)
      const normalizedBid = (bid.bidAmount - minBid) / bidRange;
      const bidScore = preferLower ? (1 - normalizedBid) : normalizedBid;

      // Calculate weighted score
      const score =
        bidScore * bidWeight +
        bid.confidence * confidenceWeight +
        reputation * reputationWeight;

      const factors: Record<string, number> = {
        bidAmount: bid.bidAmount,
        normalizedBid: bidScore,
        confidence: bid.confidence,
        reputation,
      };

      // Recommendation based on score threshold
      let recommendation: 'accept' | 'consider' | 'reject';
      if (score >= 0.7) {
        recommendation = 'accept';
      } else if (score >= 0.4) {
        recommendation = 'consider';
      } else {
        recommendation = 'reject';
      }

      return {
        bidId: bid.id,
        score,
        factors,
        recommendation,
      };
    });

    // Sort by score descending
    evaluations.sort((a, b) => b.score - a.score);

    return evaluations;
  }

  /**
   * Accept a winning bid
   */
  acceptBid(bidId: string): TaskBid | null {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const bid = this.getBid(bidId);
    if (!bid || bid.status !== 'pending') {
      return null;
    }

    // Accept this bid
    const acceptStmt = db.prepare(`
      UPDATE task_bids
      SET status = 'accepted', processed_at = ?
      WHERE id = ?
    `);
    acceptStmt.run(now, bidId);

    // Reject all other pending bids for this task
    const rejectStmt = db.prepare(`
      UPDATE task_bids
      SET status = 'rejected', processed_at = ?
      WHERE task_id = ? AND id != ? AND status = 'pending'
    `);
    rejectStmt.run(now, bid.taskId, bidId);

    return {
      ...bid,
      status: 'accepted',
      processedAt: now,
    };
  }

  /**
   * Reject a specific bid
   */
  rejectBid(bidId: string): boolean {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      UPDATE task_bids
      SET status = 'rejected', processed_at = ?
      WHERE id = ? AND status = 'pending'
    `);

    const result = stmt.run(now, bidId);
    return result.changes > 0;
  }

  /**
   * Expire old pending bids
   */
  expireBids(maxAgeMs: number, swarmId?: string): number {
    const db = this.storage.getDatabase();
    const now = Date.now();
    const cutoff = now - maxAgeMs;

    let sql = `
      UPDATE task_bids
      SET status = 'expired', processed_at = ?
      WHERE status = 'pending' AND created_at < ?
    `;
    const params: (string | number)[] = [now, cutoff];

    if (swarmId) {
      sql += ' AND swarm_id = ?';
      params.push(swarmId);
    }

    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    return result.changes;
  }

  // ============================================================================
  // AUCTION SUPPORT
  // ============================================================================

  /**
   * Run a first-price auction (highest bid wins)
   */
  runFirstPriceAuction(taskId: string, agentReputations: Map<string, number>): TaskBid | null {
    const evaluations = this.evaluateBids(taskId, agentReputations, {
      bidWeight: 0.6,
      reputationWeight: 0.3,
      confidenceWeight: 0.1,
      preferLowerBids: false,
    });

    if (evaluations.length === 0) {
      return null;
    }

    // Accept the top-scored bid
    return this.acceptBid(evaluations[0].bidId);
  }

  /**
   * Run a second-price auction (highest bidder pays second-highest price)
   * Returns the winning bid with adjusted amount
   */
  runSecondPriceAuction(taskId: string, _agentReputations: Map<string, number>): TaskBid | null {
    const bids = this.getBidsForTask(taskId, { status: 'pending' });

    if (bids.length === 0) {
      return null;
    }

    // Sort by bid amount descending
    bids.sort((a, b) => b.bidAmount - a.bidAmount);

    // Winner pays second-highest price (or their own if only one bid)
    const winningBid = bids[0];
    const secondPrice = bids.length > 1 ? bids[1].bidAmount : winningBid.bidAmount;

    // Accept the winning bid
    const accepted = this.acceptBid(winningBid.id);

    if (accepted) {
      // Return with adjusted price (note: the stored bid amount stays the same for audit)
      return {
        ...accepted,
        bidAmount: secondPrice, // Effective price to charge
      };
    }

    return null;
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get bidding statistics for a swarm
   */
  getStats(swarmId: string): {
    totalBids: number;
    pendingBids: number;
    acceptedBids: number;
    rejectedBids: number;
    avgBidAmount: number;
    avgConfidence: number;
    uniqueBidders: number;
    uniqueTasks: number;
  } {
    const db = this.storage.getDatabase();

    const stmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        AVG(bid_amount) as avg_bid,
        AVG(confidence) as avg_confidence,
        COUNT(DISTINCT bidder_handle) as unique_bidders,
        COUNT(DISTINCT task_id) as unique_tasks
      FROM task_bids
      WHERE swarm_id = ?
    `);

    const row = stmt.get(swarmId) as {
      total: number;
      pending: number;
      accepted: number;
      rejected: number;
      avg_bid: number;
      avg_confidence: number;
      unique_bidders: number;
      unique_tasks: number;
    };

    return {
      totalBids: row.total ?? 0,
      pendingBids: row.pending ?? 0,
      acceptedBids: row.accepted ?? 0,
      rejectedBids: row.rejected ?? 0,
      avgBidAmount: row.avg_bid ?? 0,
      avgConfidence: row.avg_confidence ?? 0.5,
      uniqueBidders: row.unique_bidders ?? 0,
      uniqueTasks: row.unique_tasks ?? 0,
    };
  }

  /**
   * Get agent's bidding history
   */
  getAgentBids(swarmId: string, agentHandle: string, limit = 50): TaskBid[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM task_bids
      WHERE swarm_id = ? AND bidder_handle = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(swarmId, agentHandle, limit) as BidRow[];
    return rows.map((row) => this.rowToBid(row));
  }

  // ============================================================================
  // ROW CONVERTERS
  // ============================================================================

  private rowToBid(row: BidRow): TaskBid {
    return {
      id: row.id,
      taskId: row.task_id,
      swarmId: row.swarm_id,
      bidderHandle: row.bidder_handle,
      bidAmount: row.bid_amount,
      estimatedDuration: row.estimated_duration,
      confidence: row.confidence,
      rationale: row.rationale ?? null,
      status: row.status as BidStatus,
      createdAt: row.created_at,
      processedAt: row.processed_at,
    };
  }
}
