/**
 * Swarm Intelligence Route Handlers
 *
 * Endpoints for advanced multi-agent coordination:
 * - Pheromone trails (stigmergic coordination)
 * - Agent beliefs (Theory of Mind)
 * - Credits & reputation (market-based allocation)
 * - Consensus mechanisms (voting)
 * - Task bidding (auctions)
 * - Game-theoretic payoffs
 */

import type { Request, Response } from 'express';
import {
  validateBody,
  validateQuery,
  depositPheromoneSchema,
  queryPheromonesSchema,
  decayPheromonesSchema,
  upsertBeliefSchema,
  queryBeliefsSchema,
  upsertMetaBeliefSchema,
  transferCreditsSchema,
  recordCreditTransactionSchema,
  creditHistoryQuerySchema,
  leaderboardQuerySchema,
  definePayoffSchema,
  createProposalSchema,
  castVoteSchema,
  listProposalsQuerySchema,
  submitBidSchema,
  listBidsQuerySchema,
  acceptBidSchema,
  swarmIdParamSchema,
} from '../validation/schemas.js';
import { PheromoneStorage } from '../storage/pheromone.js';
import { BeliefStorage } from '../storage/beliefs.js';
import { CreditStorage } from '../storage/credits.js';
import { ConsensusStorage } from '../storage/consensus.js';
import { BiddingStorage } from '../storage/bidding.js';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';
import type { PheromoneResourceType } from '../types.js';

// ============================================================================
// PHEROMONE TRAIL ROUTES
// ============================================================================

/**
 * POST /pheromones
 * Deposit a pheromone trail on a resource
 */
export function createDepositPheromoneHandler(deps: RouteDependencies) {
  const pheromoneStorage = new PheromoneStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(depositPheromoneSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const trail = pheromoneStorage.depositTrail(validation.data);

    // Broadcast to WebSocket if available
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'pheromone:deposit',
        trail: { id: trail.id, resourceId: trail.resourceId, trailType: trail.trailType },
      });
    }

    res.status(201).json(trail);
  });
}

/**
 * GET /pheromones/:swarmId
 * Query pheromone trails for a swarm
 */
export function createQueryPheromonesHandler(deps: RouteDependencies) {
  const pheromoneStorage = new PheromoneStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const queryValidation = validateQuery(queryPheromonesSchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error });
      return;
    }

    const trails = pheromoneStorage.queryTrails(paramValidation.data.swarmId, queryValidation.data);
    res.json({ trails, count: trails.length });
  });
}

/**
 * GET /pheromones/:swarmId/resource/:resourceId
 * Get trails for a specific resource
 */
export function createGetResourceTrailsHandler(deps: RouteDependencies) {
  const pheromoneStorage = new PheromoneStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { swarmId, resourceId } = req.params;
    if (!swarmId || !resourceId) {
      res.status(400).json({ error: 'swarmId and resourceId are required' });
      return;
    }

    const trails = pheromoneStorage.getResourceTrails(swarmId, resourceId);
    res.json({ trails, count: trails.length });
  });
}

/**
 * GET /pheromones/:swarmId/activity
 * Get hot resources by pheromone activity
 */
export function createGetResourceActivityHandler(deps: RouteDependencies) {
  const pheromoneStorage = new PheromoneStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const { resourceType, limit } = req.query;
    const activity = pheromoneStorage.getResourceActivity(
      paramValidation.data.swarmId,
      resourceType as PheromoneResourceType | undefined,
      limit ? parseInt(limit as string, 10) : 20
    );

    res.json({ activity, count: activity.length });
  });
}

/**
 * POST /pheromones/decay
 * Trigger pheromone decay processing
 */
export function createDecayPheromonesHandler(deps: RouteDependencies) {
  const pheromoneStorage = new PheromoneStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(decayPheromonesSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const result = pheromoneStorage.processDecay(
      validation.data.swarmId,
      validation.data.decayRate,
      validation.data.minIntensity
    );

    res.json({ success: true, ...result });
  });
}

/**
 * GET /pheromones/:swarmId/stats
 * Get pheromone statistics for a swarm
 */
export function createPheromoneStatsHandler(deps: RouteDependencies) {
  const pheromoneStorage = new PheromoneStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const stats = pheromoneStorage.getStats(paramValidation.data.swarmId);
    res.json(stats);
  });
}

// ============================================================================
// AGENT BELIEF ROUTES
// ============================================================================

/**
 * POST /beliefs
 * Create or update an agent belief
 */
export function createUpsertBeliefHandler(deps: RouteDependencies) {
  const beliefStorage = new BeliefStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(upsertBeliefSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const belief = beliefStorage.upsertBelief(validation.data);
    res.status(201).json(belief);
  });
}

/**
 * GET /beliefs/:swarmId/:handle
 * Get beliefs for an agent
 */
export function createGetBeliefsHandler(deps: RouteDependencies) {
  const beliefStorage = new BeliefStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { swarmId, handle } = req.params;
    if (!swarmId || !handle) {
      res.status(400).json({ error: 'swarmId and handle are required' });
      return;
    }

    const queryValidation = validateQuery(queryBeliefsSchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error });
      return;
    }

    const beliefs = beliefStorage.getBeliefs(swarmId, handle, queryValidation.data);
    res.json({ beliefs, count: beliefs.length });
  });
}

/**
 * POST /beliefs/meta
 * Create or update a meta-belief (belief about another agent)
 */
export function createUpsertMetaBeliefHandler(deps: RouteDependencies) {
  const beliefStorage = new BeliefStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(upsertMetaBeliefSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const metaBelief = beliefStorage.upsertMetaBelief(validation.data);
    res.status(201).json(metaBelief);
  });
}

/**
 * GET /beliefs/:swarmId/consensus/:subject
 * Get swarm consensus on a subject
 */
export function createGetSwarmConsensusHandler(deps: RouteDependencies) {
  const beliefStorage = new BeliefStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { swarmId, subject } = req.params;
    if (!swarmId || !subject) {
      res.status(400).json({ error: 'swarmId and subject are required' });
      return;
    }

    const { minConfidence } = req.query;
    const consensus = beliefStorage.getSwarmConsensus(
      swarmId,
      decodeURIComponent(subject),
      minConfidence ? parseFloat(minConfidence as string) : 0.5
    );

    res.json(consensus);
  });
}

/**
 * GET /beliefs/:swarmId/stats
 * Get belief statistics for a swarm
 */
export function createBeliefStatsHandler(deps: RouteDependencies) {
  const beliefStorage = new BeliefStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const stats = beliefStorage.getStats(paramValidation.data.swarmId);
    res.json(stats);
  });
}

// ============================================================================
// CREDIT & REPUTATION ROUTES
// ============================================================================

/**
 * GET /credits/:swarmId/:handle
 * Get credits for an agent
 */
export function createGetCreditsHandler(deps: RouteDependencies) {
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { swarmId, handle } = req.params;
    if (!swarmId || !handle) {
      res.status(400).json({ error: 'swarmId and handle are required' });
      return;
    }

    const credits = creditStorage.getOrCreateCredits(swarmId, handle);
    res.json(credits);
  });
}

/**
 * GET /credits/:swarmId/leaderboard
 * Get credit/reputation leaderboard
 */
export function createGetLeaderboardHandler(deps: RouteDependencies) {
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const queryValidation = validateQuery(leaderboardQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error });
      return;
    }

    const leaderboard = creditStorage.getLeaderboard(
      paramValidation.data.swarmId,
      queryValidation.data.orderBy,
      queryValidation.data.limit
    );

    res.json({ leaderboard, count: leaderboard.length });
  });
}

/**
 * POST /credits/transfer
 * Transfer credits between agents
 */
export function createTransferCreditsHandler(deps: RouteDependencies) {
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(transferCreditsSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Check sender has sufficient balance
    const senderCredits = creditStorage.getOrCreateCredits(
      validation.data.swarmId,
      validation.data.fromHandle
    );

    if (senderCredits.balance < validation.data.amount) {
      res.status(400).json({
        error: 'Insufficient balance',
        balance: senderCredits.balance,
        requested: validation.data.amount,
      });
      return;
    }

    const result = creditStorage.transferCredits(validation.data);

    // Broadcast transfer
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'credits:transfer',
        from: validation.data.fromHandle,
        to: validation.data.toHandle,
        amount: validation.data.amount,
      });
    }

    res.json({ success: true, ...result });
  });
}

/**
 * POST /credits/transaction
 * Record a credit transaction (earn, spend, bonus, penalty)
 */
export function createRecordTransactionHandler(deps: RouteDependencies) {
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(recordCreditTransactionSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const credits = creditStorage.recordTransaction(validation.data);
    res.json(credits);
  });
}

/**
 * GET /credits/:swarmId/:handle/history
 * Get transaction history for an agent
 */
export function createGetCreditHistoryHandler(deps: RouteDependencies) {
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { swarmId, handle } = req.params;
    if (!swarmId || !handle) {
      res.status(400).json({ error: 'swarmId and handle are required' });
      return;
    }

    const queryValidation = validateQuery(creditHistoryQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error });
      return;
    }

    const history = creditStorage.getTransactionHistory(swarmId, handle, queryValidation.data);
    res.json({ transactions: history, count: history.length });
  });
}

/**
 * GET /credits/:swarmId/stats
 * Get credit statistics for a swarm
 */
export function createCreditStatsHandler(deps: RouteDependencies) {
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const stats = creditStorage.getStats(paramValidation.data.swarmId);
    res.json(stats);
  });
}

// ============================================================================
// CONSENSUS / VOTING ROUTES
// ============================================================================

/**
 * POST /consensus/proposals
 * Create a new proposal
 */
export function createCreateProposalHandler(deps: RouteDependencies) {
  const consensusStorage = new ConsensusStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(createProposalSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const proposal = consensusStorage.createProposal(validation.data);

    // Broadcast new proposal
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'consensus:proposal',
        proposal: { id: proposal.id, title: proposal.title, deadline: proposal.deadline },
      });
    }

    res.status(201).json(proposal);
  });
}

/**
 * GET /consensus/:swarmId/proposals
 * List proposals for a swarm
 */
export function createListProposalsHandler(deps: RouteDependencies) {
  const consensusStorage = new ConsensusStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const queryValidation = validateQuery(listProposalsQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error });
      return;
    }

    const proposals = consensusStorage.listProposals(paramValidation.data.swarmId, queryValidation.data);
    res.json({ proposals, count: proposals.length });
  });
}

/**
 * GET /consensus/proposals/:id
 * Get a specific proposal
 */
export function createGetProposalHandler(deps: RouteDependencies) {
  const consensusStorage = new ConsensusStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Proposal ID is required' });
      return;
    }

    const proposal = consensusStorage.getProposal(id);
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }

    // Include votes
    const votes = consensusStorage.getVotes(id);
    res.json({ ...proposal, votes });
  });
}

/**
 * POST /consensus/proposals/:id/vote
 * Cast a vote on a proposal
 */
export function createCastVoteHandler(deps: RouteDependencies) {
  const consensusStorage = new ConsensusStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Proposal ID is required' });
      return;
    }

    const validation = validateBody(castVoteSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const vote = consensusStorage.castVote({
      proposalId: id,
      ...validation.data,
    });

    if (!vote) {
      res.status(400).json({ error: 'Cannot vote on this proposal (closed, expired, or invalid vote)' });
      return;
    }

    // Broadcast vote
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'consensus:vote',
        proposalId: id,
        voter: validation.data.voterHandle,
      });
    }

    res.status(201).json(vote);
  });
}

/**
 * POST /consensus/proposals/:id/close
 * Close a proposal and tally votes
 */
export function createCloseProposalHandler(deps: RouteDependencies) {
  const consensusStorage = new ConsensusStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Proposal ID is required' });
      return;
    }

    const result = consensusStorage.closeAndTally(id);
    if (!result) {
      res.status(400).json({ error: 'Cannot close proposal (not found or already closed)' });
      return;
    }

    // Broadcast result
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'consensus:result',
        proposalId: id,
        winner: result.winner,
        quorumMet: result.quorumMet,
      });
    }

    res.json(result);
  });
}

/**
 * GET /consensus/:swarmId/stats
 * Get consensus statistics for a swarm
 */
export function createConsensusStatsHandler(deps: RouteDependencies) {
  const consensusStorage = new ConsensusStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const stats = consensusStorage.getStats(paramValidation.data.swarmId);
    res.json(stats);
  });
}

// ============================================================================
// TASK BIDDING ROUTES
// ============================================================================

/**
 * POST /bids
 * Submit a bid on a task
 */
export function createSubmitBidHandler(deps: RouteDependencies) {
  const biddingStorage = new BiddingStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(submitBidSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const bid = biddingStorage.submitBid(validation.data);

    // Broadcast new bid
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'bidding:bid',
        bid: { id: bid.id, taskId: bid.taskId, bidder: bid.bidderHandle, amount: bid.bidAmount },
      });
    }

    res.status(201).json(bid);
  });
}

/**
 * GET /bids/task/:taskId
 * Get all bids for a task
 */
export function createGetTaskBidsHandler(deps: RouteDependencies) {
  const biddingStorage = new BiddingStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { taskId } = req.params;
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }

    const queryValidation = validateQuery(listBidsQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error });
      return;
    }

    const bids = biddingStorage.getBidsForTask(taskId, queryValidation.data);
    res.json({ bids, count: bids.length });
  });
}

/**
 * GET /bids/:id
 * Get a specific bid
 */
export function createGetBidHandler(deps: RouteDependencies) {
  const biddingStorage = new BiddingStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Bid ID is required' });
      return;
    }

    const bid = biddingStorage.getBid(id);
    if (!bid) {
      res.status(404).json({ error: 'Bid not found' });
      return;
    }

    res.json(bid);
  });
}

/**
 * POST /bids/:id/accept
 * Accept a winning bid
 */
export function createAcceptBidHandler(deps: RouteDependencies) {
  const biddingStorage = new BiddingStorage(deps.legacyStorage);
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Bid ID is required' });
      return;
    }

    const validation = validateBody(acceptBidSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const acceptedBid = biddingStorage.acceptBid(id);
    if (!acceptedBid) {
      res.status(400).json({ error: 'Cannot accept bid (not found or not pending)' });
      return;
    }

    // Settle credits if requested
    let creditSettlement = null;
    if (validation.data.settleCredits) {
      creditSettlement = creditStorage.recordTransaction({
        swarmId: acceptedBid.swarmId,
        agentHandle: acceptedBid.bidderHandle,
        transactionType: 'spend',
        amount: acceptedBid.bidAmount,
        referenceType: 'bid',
        referenceId: acceptedBid.id,
        reason: `Winning bid on task ${acceptedBid.taskId}`,
      });
    }

    // Broadcast acceptance
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'bidding:accepted',
        bid: { id: acceptedBid.id, taskId: acceptedBid.taskId, winner: acceptedBid.bidderHandle },
      });
    }

    res.json({ bid: acceptedBid, creditSettlement });
  });
}

/**
 * DELETE /bids/:id
 * Withdraw a bid
 */
export function createWithdrawBidHandler(deps: RouteDependencies) {
  const biddingStorage = new BiddingStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { handle } = req.query;

    if (!id || !handle) {
      res.status(400).json({ error: 'Bid ID and handle are required' });
      return;
    }

    const success = biddingStorage.withdrawBid(id, handle as string);
    if (!success) {
      res.status(400).json({ error: 'Cannot withdraw bid (not found, not yours, or not pending)' });
      return;
    }

    res.json({ success: true, message: 'Bid withdrawn' });
  });
}

/**
 * POST /bids/task/:taskId/evaluate
 * Evaluate and rank bids for a task
 */
export function createEvaluateBidsHandler(deps: RouteDependencies) {
  const biddingStorage = new BiddingStorage(deps.legacyStorage);
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { taskId } = req.params;
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }

    // Get bids to determine swarmId
    const bids = biddingStorage.getBidsForTask(taskId, { status: 'pending' });
    if (bids.length === 0) {
      res.json({ evaluations: [], count: 0 });
      return;
    }

    // Get reputations for all bidders
    const swarmId = bids[0].swarmId;
    const reputations = new Map<string, number>();
    for (const bid of bids) {
      const credits = creditStorage.getCredits(swarmId, bid.bidderHandle);
      reputations.set(bid.bidderHandle, credits?.reputationScore ?? 0.5);
    }

    const evaluations = biddingStorage.evaluateBids(taskId, reputations, req.body);
    res.json({ evaluations, count: evaluations.length });
  });
}

/**
 * GET /bids/:swarmId/stats
 * Get bidding statistics for a swarm
 */
export function createBiddingStatsHandler(deps: RouteDependencies) {
  const biddingStorage = new BiddingStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateBody(swarmIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: paramValidation.error });
      return;
    }

    const stats = biddingStorage.getStats(paramValidation.data.swarmId);
    res.json(stats);
  });
}

// ============================================================================
// GAME-THEORETIC PAYOFF ROUTES
// ============================================================================

/**
 * POST /payoffs
 * Define a payoff for a task
 */
export function createDefinePayoffHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(definePayoffSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const db = deps.legacyStorage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO task_payoffs (task_id, swarm_id, payoff_type, base_value, multiplier, deadline, decay_rate, dependencies, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, payoff_type)
      DO UPDATE SET
        base_value = excluded.base_value,
        multiplier = excluded.multiplier,
        deadline = excluded.deadline,
        decay_rate = excluded.decay_rate,
        dependencies = excluded.dependencies,
        updated_at = excluded.updated_at
      RETURNING *
    `);

    const row = stmt.get(
      validation.data.taskId,
      validation.data.swarmId ?? null,
      validation.data.payoffType,
      validation.data.baseValue,
      validation.data.multiplier ?? 1.0,
      validation.data.deadline ?? null,
      validation.data.decayRate ?? 0,
      JSON.stringify(validation.data.dependencies ?? []),
      now,
      now
    );

    res.status(201).json(row);
  });
}

/**
 * GET /payoffs/:taskId/calculate
 * Calculate current payoff value for a task
 */
export function createCalculatePayoffHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { taskId } = req.params;
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }

    const db = deps.legacyStorage.getDatabase();
    const now = Date.now();

    // Get all payoffs for this task
    const stmt = db.prepare(`
      SELECT * FROM task_payoffs WHERE task_id = ?
    `);
    const payoffs = stmt.all(taskId) as Array<{
      payoff_type: string;
      base_value: number;
      multiplier: number;
      deadline: number | null;
      decay_rate: number;
    }>;

    if (payoffs.length === 0) {
      res.json({
        taskId,
        totalPayoff: 0,
        breakdown: {},
        bonuses: [],
        penalties: [],
        timeDecay: 0,
      });
      return;
    }

    // Calculate payoff with time decay
    let totalPayoff = 0;
    const breakdown: Record<string, number> = {};
    const bonuses: string[] = [];
    const penalties: string[] = [];
    let totalTimeDecay = 0;

    for (const p of payoffs) {
      let value = p.base_value * p.multiplier;

      // Apply time decay if deadline exists
      if (p.deadline && p.decay_rate > 0) {
        if (now > p.deadline) {
          const overdue = now - p.deadline;
          const decay = 1 - Math.min(1, (overdue / 3600000) * p.decay_rate); // decay per hour
          value *= Math.max(0, decay);
          totalTimeDecay += (1 - decay) * p.base_value;
        }
      }

      breakdown[p.payoff_type] = value;

      if (p.payoff_type === 'penalty') {
        penalties.push(`${p.payoff_type}: -${Math.abs(value)}`);
        totalPayoff -= Math.abs(value);
      } else {
        if (p.payoff_type === 'bonus' || p.payoff_type === 'cooperation') {
          bonuses.push(`${p.payoff_type}: +${value}`);
        }
        totalPayoff += value;
      }
    }

    res.json({
      taskId,
      totalPayoff,
      breakdown,
      bonuses,
      penalties,
      timeDecay: totalTimeDecay,
    });
  });
}

/**
 * GET /payoffs/:taskId
 * List all payoffs defined for a task
 */
export function createGetPayoffsHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { taskId } = req.params;
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }

    const db = deps.legacyStorage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM task_payoffs WHERE task_id = ? ORDER BY created_at DESC
    `);
    const payoffs = stmt.all(taskId);

    res.json(payoffs);
  });
}

/**
 * POST /credits/reputation
 * Update an agent's reputation based on task success/failure
 */
export function createUpdateReputationHandler(deps: RouteDependencies) {
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { swarmId, agentHandle, success, weight } = req.body as {
      swarmId?: string;
      agentHandle?: string;
      success?: boolean;
      weight?: number;
    };

    if (!swarmId || !agentHandle) {
      res.status(400).json({ error: 'swarmId and agentHandle are required' });
      return;
    }

    if (typeof success !== 'boolean') {
      res.status(400).json({ error: 'success must be a boolean' });
      return;
    }

    const credits = creditStorage.getOrCreateCredits(swarmId, agentHandle);
    const currentRep = credits.reputationScore;
    const delta = weight ?? 0.1;

    // Update reputation: increase for success, decrease for failure
    const newRep = success
      ? Math.min(1.0, currentRep + delta * (1 - currentRep))
      : Math.max(0.0, currentRep - delta * currentRep);

    // Record as a transaction for audit trail
    const updated = creditStorage.recordTransaction({
      swarmId,
      agentHandle,
      transactionType: success ? 'earn' : 'spend',
      amount: 0, // No credit change, just reputation
      referenceType: 'reputation',
      referenceId: `rep-${Date.now()}`,
      reason: success ? 'Task completed successfully' : 'Task failed',
    });

    // Manually update reputation score
    const db = deps.legacyStorage.getDatabase();
    db.prepare(`
      UPDATE agent_credits SET reputation_score = ?, updated_at = ? WHERE swarm_id = ? AND agent_handle = ?
    `).run(newRep, Date.now(), swarmId, agentHandle);

    res.json({
      agentHandle,
      previousReputation: currentRep,
      newReputation: newRep,
      change: newRep - currentRep,
      success,
      credits: updated,
    });
  });
}

/**
 * POST /bids/task/:taskId/auction
 * Run an auction for a task to automatically select a winner
 */
export function createRunAuctionHandler(deps: RouteDependencies) {
  const biddingStorage = new BiddingStorage(deps.legacyStorage);
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { taskId } = req.params;
    const { auctionType = 'first-price' } = req.body as { auctionType?: string };

    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }

    if (!['first-price', 'second-price'].includes(auctionType)) {
      res.status(400).json({ error: 'auctionType must be first-price or second-price' });
      return;
    }

    // Get all pending bids for the task
    const bids = biddingStorage.getBidsForTask(taskId, { status: 'pending' });

    if (bids.length === 0) {
      res.status(400).json({ error: 'No pending bids for this task' });
      return;
    }

    // Get reputations for evaluation
    const swarmId = bids[0].swarmId;
    const reputations = new Map<string, number>();
    for (const bid of bids) {
      const credits = creditStorage.getCredits(swarmId, bid.bidderHandle);
      reputations.set(bid.bidderHandle, credits?.reputationScore ?? 0.5);
    }

    // Evaluate bids
    const evaluations = biddingStorage.evaluateBids(taskId, reputations, {});

    if (evaluations.length === 0) {
      res.status(400).json({ error: 'No valid bids to evaluate' });
      return;
    }

    // Select winner (highest score)
    const winner = evaluations[0];
    const winningBid = bids.find(b => b.id === winner.bidId);

    if (!winningBid) {
      res.status(500).json({ error: 'Failed to find winning bid' });
      return;
    }

    // Determine price based on auction type
    let price = winningBid.bidAmount;
    if (auctionType === 'second-price' && evaluations.length > 1) {
      // Second-price: winner pays second-highest bid
      const secondBid = bids.find(b => b.id === evaluations[1].bidId);
      if (secondBid) {
        price = secondBid.bidAmount;
      }
    }

    // Accept the winning bid
    const acceptedBid = biddingStorage.acceptBid(winner.bidId);

    // Settle credits
    const settlement = creditStorage.recordTransaction({
      swarmId,
      agentHandle: winningBid.bidderHandle,
      transactionType: 'spend',
      amount: price,
      referenceType: 'auction',
      referenceId: winningBid.id,
      reason: `Won ${auctionType} auction for task ${taskId}`,
    });

    // Broadcast auction result
    if (deps.broadcastToAll) {
      deps.broadcastToAll({
        type: 'bidding:auction_complete',
        taskId,
        winner: winningBid.bidderHandle,
        price,
        auctionType,
      });
    }

    res.json({
      taskId,
      auctionType,
      winner: {
        bidId: winningBid.id,
        bidder: winningBid.bidderHandle,
        originalBid: winningBid.bidAmount,
        finalPrice: price,
      },
      totalBids: bids.length,
      evaluation: winner,
      settlement,
      acceptedBid,
    });
  });
}
