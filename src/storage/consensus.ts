/**
 * Consensus Mechanism Storage
 *
 * Implements voting and consensus mechanisms for swarm decision-making.
 * Supports multiple voting methods: majority, supermajority, unanimous, ranked, weighted.
 * Enables democratic decision-making for critical swarm operations.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from './sqlite.js';
import type {
  ConsensusProposal,
  ConsensusVote,
  ConsensusResult,
  ConsensusProposalType,
  VotingMethod,
  ProposalStatus,
} from '../types.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface CreateProposalOptions {
  swarmId: string;
  proposerHandle: string;
  proposalType: ConsensusProposalType;
  title: string;
  description?: string;
  options: string[];
  votingMethod?: VotingMethod;
  quorumType?: 'percentage' | 'absolute' | 'none';
  quorumValue?: number;
  weightByReputation?: boolean;
  deadline?: number;
}

export interface CastVoteOptions {
  proposalId: string;
  voterHandle: string;
  voteValue: string;
  voteWeight?: number;
  rationale?: string;
}

export interface ListProposalsOptions {
  status?: ProposalStatus;
  proposalType?: ConsensusProposalType;
  proposerHandle?: string;
  limit?: number;
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

interface ProposalRow {
  id: string;
  swarm_id: string;
  proposer_handle: string;
  proposal_type: string;
  title: string;
  description: string | null;
  options: string;
  voting_method: string;
  quorum_type: string;
  quorum_value: number;
  weight_by_reputation: number;
  status: string;
  deadline: number | null;
  result: string | null;
  created_at: number;
  closed_at: number | null;
}

interface VoteRow {
  id: number;
  proposal_id: string;
  voter_handle: string;
  vote_value: string;
  vote_weight: number;
  rationale: string | null;
  created_at: number;
}

// ============================================================================
// CONSENSUS STORAGE CLASS
// ============================================================================

export class ConsensusStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  // ============================================================================
  // PROPOSAL MANAGEMENT
  // ============================================================================

  /**
   * Create a new proposal
   */
  createProposal(options: CreateProposalOptions): ConsensusProposal {
    const db = this.storage.getDatabase();
    const now = Date.now();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO consensus_proposals (id, swarm_id, proposer_handle, proposal_type, title, description, options, voting_method, quorum_type, quorum_value, weight_by_reputation, status, deadline, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `);

    stmt.run(
      id,
      options.swarmId,
      options.proposerHandle,
      options.proposalType,
      options.title,
      options.description ?? null,
      JSON.stringify(options.options),
      options.votingMethod ?? 'majority',
      options.quorumType ?? 'percentage',
      options.quorumValue ?? 0.5,
      options.weightByReputation ? 1 : 0,
      options.deadline ?? null,
      now
    );

    return {
      id,
      swarmId: options.swarmId,
      proposerHandle: options.proposerHandle,
      proposalType: options.proposalType,
      title: options.title,
      description: options.description ?? null,
      options: options.options,
      votingMethod: options.votingMethod ?? 'majority',
      quorumType: options.quorumType ?? 'percentage',
      quorumValue: options.quorumValue ?? 0.5,
      weightByReputation: options.weightByReputation ?? false,
      status: 'open',
      deadline: options.deadline ?? null,
      result: null,
      createdAt: now,
      closedAt: null,
    };
  }

  /**
   * Get a proposal by ID
   */
  getProposal(proposalId: string): ConsensusProposal | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM consensus_proposals WHERE id = ?');
    const row = stmt.get(proposalId) as ProposalRow | undefined;
    return row ? this.rowToProposal(row) : null;
  }

  /**
   * List proposals for a swarm
   */
  listProposals(swarmId: string, options: ListProposalsOptions = {}): ConsensusProposal[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = ['swarm_id = ?'];
    const params: (string | number)[] = [swarmId];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options.proposalType) {
      conditions.push('proposal_type = ?');
      params.push(options.proposalType);
    }

    if (options.proposerHandle) {
      conditions.push('proposer_handle = ?');
      params.push(options.proposerHandle);
    }

    const limit = options.limit ?? 50;
    const sql = `
      SELECT * FROM consensus_proposals
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?
    `;

    params.push(limit);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as ProposalRow[];

    return rows.map((row) => this.rowToProposal(row));
  }

  /**
   * Cancel a proposal (only proposer can cancel)
   */
  cancelProposal(proposalId: string, requesterHandle: string): boolean {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      UPDATE consensus_proposals
      SET status = 'cancelled', closed_at = ?
      WHERE id = ? AND proposer_handle = ? AND status = 'open'
    `);

    const result = stmt.run(now, proposalId, requesterHandle);
    return result.changes > 0;
  }

  // ============================================================================
  // VOTING
  // ============================================================================

  /**
   * Cast a vote on a proposal
   */
  castVote(options: CastVoteOptions): ConsensusVote | null {
    const db = this.storage.getDatabase();
    const now = Date.now();

    // Get proposal to validate
    const proposal = this.getProposal(options.proposalId);
    if (!proposal || proposal.status !== 'open') {
      return null;
    }

    // Check deadline
    if (proposal.deadline && now > proposal.deadline) {
      return null;
    }

    // Validate vote value (must be one of the options, or JSON for ranked)
    if (proposal.votingMethod !== 'ranked') {
      if (!proposal.options.includes(options.voteValue)) {
        return null;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO consensus_votes (proposal_id, voter_handle, vote_value, vote_weight, rationale, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(proposal_id, voter_handle)
      DO UPDATE SET
        vote_value = excluded.vote_value,
        vote_weight = excluded.vote_weight,
        rationale = excluded.rationale,
        created_at = excluded.created_at
      RETURNING *
    `);

    const row = stmt.get(
      options.proposalId,
      options.voterHandle,
      options.voteValue,
      options.voteWeight ?? 1.0,
      options.rationale ?? null,
      now
    ) as VoteRow;

    return this.rowToVote(row);
  }

  /**
   * Get all votes for a proposal
   */
  getVotes(proposalId: string): ConsensusVote[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM consensus_votes
      WHERE proposal_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(proposalId) as VoteRow[];
    return rows.map((row) => this.rowToVote(row));
  }

  /**
   * Check if an agent has voted
   */
  hasVoted(proposalId: string, voterHandle: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT 1 FROM consensus_votes
      WHERE proposal_id = ? AND voter_handle = ?
    `);
    return !!stmt.get(proposalId, voterHandle);
  }

  // ============================================================================
  // TALLY & CLOSE
  // ============================================================================

  /**
   * Close a proposal and tally votes
   */
  closeAndTally(proposalId: string): ConsensusResult | null {
    const db = this.storage.getDatabase();
    const proposal = this.getProposal(proposalId);

    if (!proposal || proposal.status !== 'open') {
      return null;
    }

    const votes = this.getVotes(proposalId);
    const result = this.calculateResult(proposal, votes);

    // Update proposal with result
    const now = Date.now();
    const stmt = db.prepare(`
      UPDATE consensus_proposals
      SET status = ?, result = ?, closed_at = ?
      WHERE id = ?
    `);

    stmt.run(result.quorumMet ? 'passed' : 'failed', JSON.stringify(result), now, proposalId);

    return result;
  }

  /**
   * Calculate result based on voting method
   */
  private calculateResult(proposal: ConsensusProposal, votes: ConsensusVote[]): ConsensusResult {
    // Count votes (weighted)
    const tally: Record<string, number> = {};
    for (const option of proposal.options) {
      tally[option] = 0;
    }

    let totalWeight = 0;
    for (const vote of votes) {
      if (proposal.votingMethod === 'ranked') {
        // Ranked choice: parse rankings and apply Borda count
        try {
          const rankings = JSON.parse(vote.voteValue) as string[];
          const weight = vote.voteWeight;
          for (let i = 0; i < rankings.length; i++) {
            const points = (rankings.length - i) * weight;
            tally[rankings[i]] = (tally[rankings[i]] ?? 0) + points;
          }
          totalWeight += weight;
        } catch {
          // Skip invalid ranked votes
        }
      } else {
        tally[vote.voteValue] = (tally[vote.voteValue] ?? 0) + vote.voteWeight;
        totalWeight += vote.voteWeight;
      }
    }

    // Find winner
    let winner: string | null = null;
    let maxVotes = 0;
    for (const [option, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = option;
      }
    }

    // Check quorum
    let quorumMet = false;
    const participationRate = votes.length > 0 ? votes.length / (totalWeight || 1) : 0;

    if (proposal.quorumType === 'none') {
      quorumMet = votes.length > 0;
    } else if (proposal.quorumType === 'absolute') {
      quorumMet = votes.length >= proposal.quorumValue;
    } else {
      // percentage - would need total eligible voters
      // For now, assume quorum met if we have any votes
      quorumMet = participationRate >= proposal.quorumValue || votes.length >= 2;
    }

    // Check voting method thresholds
    if (quorumMet && totalWeight > 0) {
      const winnerRatio = maxVotes / totalWeight;

      switch (proposal.votingMethod) {
        case 'supermajority':
          quorumMet = winnerRatio >= 0.667;
          break;
        case 'unanimous':
          quorumMet = winnerRatio >= 1.0;
          break;
        case 'majority':
        case 'ranked':
        case 'weighted':
        default:
          quorumMet = winnerRatio > 0.5 || Object.keys(tally).length <= 2;
          break;
      }
    }

    return {
      winner: quorumMet ? winner : null,
      tally,
      quorumMet,
      participationRate,
      totalVotes: votes.length,
      weightedVotes: totalWeight,
    };
  }

  /**
   * Auto-close expired proposals
   */
  closeExpiredProposals(swarmId?: string): number {
    const db = this.storage.getDatabase();
    const now = Date.now();

    // Get expired open proposals
    let sql = `
      SELECT id FROM consensus_proposals
      WHERE status = 'open' AND deadline IS NOT NULL AND deadline < ?
    `;
    const params: (string | number)[] = [now];

    if (swarmId) {
      sql += ' AND swarm_id = ?';
      params.push(swarmId);
    }

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{ id: string }>;

    let closed = 0;
    for (const row of rows) {
      const result = this.closeAndTally(row.id);
      if (result) closed++;
    }

    return closed;
  }

  /**
   * Get statistics for a swarm's consensus
   */
  getStats(swarmId: string): {
    totalProposals: number;
    openProposals: number;
    passedProposals: number;
    failedProposals: number;
    totalVotes: number;
    avgParticipation: number;
    byType: Record<ConsensusProposalType, number>;
  } {
    const db = this.storage.getDatabase();

    // Proposal stats
    const proposalStmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
      FROM consensus_proposals
      WHERE swarm_id = ?
    `);
    const proposalStats = proposalStmt.get(swarmId) as {
      total: number;
      open_count: number;
      passed_count: number;
      failed_count: number;
    };

    // Vote count
    const voteStmt = db.prepare(`
      SELECT COUNT(*) as total FROM consensus_votes cv
      JOIN consensus_proposals cp ON cv.proposal_id = cp.id
      WHERE cp.swarm_id = ?
    `);
    const voteStats = voteStmt.get(swarmId) as { total: number };

    // By type
    const typeStmt = db.prepare(`
      SELECT proposal_type, COUNT(*) as count
      FROM consensus_proposals
      WHERE swarm_id = ?
      GROUP BY proposal_type
    `);
    const typeRows = typeStmt.all(swarmId) as Array<{ proposal_type: string; count: number }>;
    const byType: Record<ConsensusProposalType, number> = {
      decision: 0,
      election: 0,
      approval: 0,
      ranking: 0,
      allocation: 0,
    };
    for (const row of typeRows) {
      byType[row.proposal_type as ConsensusProposalType] = row.count;
    }

    // Avg participation
    const avgParticipation = proposalStats.total > 0
      ? voteStats.total / proposalStats.total
      : 0;

    return {
      totalProposals: proposalStats.total ?? 0,
      openProposals: proposalStats.open_count ?? 0,
      passedProposals: proposalStats.passed_count ?? 0,
      failedProposals: proposalStats.failed_count ?? 0,
      totalVotes: voteStats.total ?? 0,
      avgParticipation,
      byType,
    };
  }

  // ============================================================================
  // ROW CONVERTERS
  // ============================================================================

  private rowToProposal(row: ProposalRow): ConsensusProposal {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      proposerHandle: row.proposer_handle,
      proposalType: row.proposal_type as ConsensusProposalType,
      title: row.title,
      description: row.description,
      options: JSON.parse(row.options),
      votingMethod: row.voting_method as VotingMethod,
      quorumType: row.quorum_type as 'percentage' | 'absolute' | 'none',
      quorumValue: row.quorum_value,
      weightByReputation: row.weight_by_reputation === 1,
      status: row.status as ProposalStatus,
      deadline: row.deadline,
      result: row.result ? JSON.parse(row.result) : null,
      createdAt: row.created_at,
      closedAt: row.closed_at,
    };
  }

  private rowToVote(row: VoteRow): ConsensusVote {
    return {
      id: row.id,
      proposalId: row.proposal_id,
      voterHandle: row.voter_handle,
      voteValue: row.vote_value,
      voteWeight: row.vote_weight,
      rationale: row.rationale ?? undefined,
      createdAt: row.created_at,
    };
  }
}
