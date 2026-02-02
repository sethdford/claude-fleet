/**
 * Tests for swarm intelligence route handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';

// Mock all domain storage classes — use class + prototype methods so:
// 1) `new` works in Vitest 4 (class syntax)
// 2) prototype overrides in tests affect new instances (no class field shadowing)

vi.mock('../storage/pheromone.js', () => {
  class MockPheromoneStorage {}
  MockPheromoneStorage.prototype.depositTrail = vi.fn().mockReturnValue({ id: 'trail-1', resourceId: 'r1', trailType: 'touch', swarmId: 'swarm-1', depositorHandle: 'agent-1', intensity: 1.0, createdAt: Date.now() });
  MockPheromoneStorage.prototype.queryTrails = vi.fn().mockReturnValue([]);
  MockPheromoneStorage.prototype.getResourceTrails = vi.fn().mockReturnValue([]);
  MockPheromoneStorage.prototype.getResourceActivity = vi.fn().mockReturnValue([]);
  MockPheromoneStorage.prototype.processDecay = vi.fn().mockReturnValue({ decayed: 0, removed: 0 });
  MockPheromoneStorage.prototype.getStats = vi.fn().mockReturnValue({ totalTrails: 0, activeTrails: 0, byType: {} });
  return { PheromoneStorage: MockPheromoneStorage };
});

vi.mock('../storage/beliefs.js', () => {
  class MockBeliefStorage {}
  MockBeliefStorage.prototype.upsertBelief = vi.fn().mockReturnValue({ id: 'belief-1', swarmId: 'swarm-1', agentHandle: 'agent-1', subject: 'test', confidence: 0.8, createdAt: Date.now() });
  MockBeliefStorage.prototype.getBeliefs = vi.fn().mockReturnValue([]);
  MockBeliefStorage.prototype.upsertMetaBelief = vi.fn().mockReturnValue({ id: 'meta-1', swarmId: 'swarm-1', agentHandle: 'a1', aboutHandle: 'a2', subject: 'test', confidence: 0.7, createdAt: Date.now() });
  MockBeliefStorage.prototype.getSwarmConsensus = vi.fn().mockReturnValue({ subject: 'test', beliefs: [], consensus: null });
  MockBeliefStorage.prototype.getStats = vi.fn().mockReturnValue({ totalBeliefs: 0, totalMetaBeliefs: 0, byAgent: {} });
  return { BeliefStorage: MockBeliefStorage };
});

vi.mock('../storage/credits.js', () => {
  class MockCreditStorage {}
  MockCreditStorage.prototype.getOrCreateCredits = vi.fn().mockReturnValue({ swarmId: 'swarm-1', agentHandle: 'agent-1', balance: 100, reputationScore: 0.8, totalEarned: 200, totalSpent: 100, createdAt: Date.now() });
  MockCreditStorage.prototype.getCredits = vi.fn().mockReturnValue({ swarmId: 'swarm-1', agentHandle: 'agent-1', balance: 100, reputationScore: 0.8, totalEarned: 200, totalSpent: 100, createdAt: Date.now() });
  MockCreditStorage.prototype.getLeaderboard = vi.fn().mockReturnValue([]);
  MockCreditStorage.prototype.transferCredits = vi.fn().mockReturnValue({ success: true });
  MockCreditStorage.prototype.recordTransaction = vi.fn().mockReturnValue({ swarmId: 'swarm-1', agentHandle: 'agent-1', balance: 100, reputationScore: 0.8 });
  MockCreditStorage.prototype.getTransactionHistory = vi.fn().mockReturnValue([]);
  MockCreditStorage.prototype.getStats = vi.fn().mockReturnValue({ totalAgents: 0, totalTransactions: 0, totalCredits: 0 });
  return { CreditStorage: MockCreditStorage };
});

vi.mock('../storage/consensus.js', () => {
  class MockConsensusStorage {}
  MockConsensusStorage.prototype.createProposal = vi.fn().mockReturnValue({ id: 'prop-1', swarmId: 'swarm-1', title: 'Test', description: '', proposerHandle: 'agent-1', deadline: Date.now() + 3600000, status: 'open', createdAt: Date.now() });
  MockConsensusStorage.prototype.listProposals = vi.fn().mockReturnValue([]);
  MockConsensusStorage.prototype.getProposal = vi.fn().mockReturnValue(null);
  MockConsensusStorage.prototype.castVote = vi.fn().mockReturnValue({ id: 'vote-1', proposalId: 'prop-1', voterHandle: 'agent-1', vote: 'approve', weight: 1 });
  MockConsensusStorage.prototype.getVotes = vi.fn().mockReturnValue([]);
  MockConsensusStorage.prototype.closeAndTally = vi.fn().mockReturnValue(null);
  MockConsensusStorage.prototype.getStats = vi.fn().mockReturnValue({ totalProposals: 0, openProposals: 0, closedProposals: 0 });
  return { ConsensusStorage: MockConsensusStorage };
});

vi.mock('../storage/bidding.js', () => {
  class MockBiddingStorage {}
  MockBiddingStorage.prototype.submitBid = vi.fn().mockReturnValue({ id: 'bid-1', taskId: 'task-1', swarmId: 'swarm-1', bidderHandle: 'agent-1', bidAmount: 10, status: 'pending', createdAt: Date.now() });
  MockBiddingStorage.prototype.getBidsForTask = vi.fn().mockReturnValue([]);
  MockBiddingStorage.prototype.getBid = vi.fn().mockReturnValue(null);
  MockBiddingStorage.prototype.acceptBid = vi.fn().mockReturnValue(null);
  MockBiddingStorage.prototype.withdrawBid = vi.fn().mockReturnValue(false);
  MockBiddingStorage.prototype.evaluateBids = vi.fn().mockReturnValue([]);
  MockBiddingStorage.prototype.getStats = vi.fn().mockReturnValue({ totalBids: 0, activeBids: 0, byStatus: {} });
  return { BiddingStorage: MockBiddingStorage };
});

vi.mock('../metrics/prometheus.js', () => ({
  agentAuthentications: { inc: vi.fn() },
  tasksCreated: { inc: vi.fn() },
  tasksCompleted: { inc: vi.fn() },
}));

import {
  createDepositPheromoneHandler,
  createQueryPheromonesHandler,
  createGetResourceTrailsHandler,
  createGetResourceActivityHandler,
  createDecayPheromonesHandler,
  createPheromoneStatsHandler,
  createUpsertBeliefHandler,
  createGetBeliefsHandler,
  createUpsertMetaBeliefHandler,
  createGetSwarmConsensusHandler,
  createBeliefStatsHandler,
  createGetCreditsHandler,
  createGetLeaderboardHandler,
  createTransferCreditsHandler,
  createRecordTransactionHandler,
  createGetCreditHistoryHandler,
  createCreditStatsHandler,
  createCreateProposalHandler,
  createListProposalsHandler,
  createGetProposalHandler,
  createCastVoteHandler,
  createCloseProposalHandler,
  createConsensusStatsHandler,
  createSubmitBidHandler,
  createGetTaskBidsHandler,
  createGetBidHandler,
  createAcceptBidHandler,
  createWithdrawBidHandler,
  createEvaluateBidsHandler,
  createBiddingStatsHandler,
  createDefinePayoffHandler,
  createCalculatePayoffHandler,
  createGetPayoffsHandler,
  createUpdateReputationHandler,
  createRunAuctionHandler,
} from './swarm-intelligence.js';

describe('Swarm Intelligence Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  // ======================================================================
  // PHEROMONE ROUTES
  // ======================================================================

  describe('Pheromone Handlers', () => {
    it('should deposit a pheromone trail', async () => {
      const handler = createDepositPheromoneHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          depositorHandle: 'agent-1',
          resourceId: 'file-1',
          resourceType: 'file',
          trailType: 'touch',
          intensity: 0.8,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('trail-1');
    });

    it('should reject deposit with invalid body', async () => {
      const handler = createDepositPheromoneHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should broadcast on deposit when broadcastToAll is set', async () => {
      const handler = createDepositPheromoneHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          depositorHandle: 'agent-1',
          resourceId: 'file-1',
          resourceType: 'file',
          trailType: 'touch',
          intensity: 0.8,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      expect(deps.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pheromone:deposit' })
      );
    });

    it('should query pheromone trails', async () => {
      const handler = createQueryPheromonesHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('trails');
      expect(response).toHaveProperty('count');
    });

    it('should reject query with invalid swarmId param', async () => {
      const handler = createQueryPheromonesHandler(deps);
      const req = createMockReq({ params: {}, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should get resource trails', async () => {
      const handler = createGetResourceTrailsHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1', resourceId: 'file-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('trails');
    });

    it('should reject resource trails with missing params', async () => {
      const handler = createGetResourceTrailsHandler(deps);
      const req = createMockReq({ params: { swarmId: 'swarm-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should get resource activity', async () => {
      const handler = createGetResourceActivityHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('activity');
    });

    it('should process pheromone decay', async () => {
      const handler = createDecayPheromonesHandler(deps);
      const req = createMockReq({
        body: { swarmId: 'swarm-1', decayRate: 0.1, minIntensity: 0.01 },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should get pheromone stats', async () => {
      const handler = createPheromoneStatsHandler(deps);
      const req = createMockReq({ params: { swarmId: 'swarm-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('totalTrails');
    });
  });

  // ======================================================================
  // BELIEF ROUTES
  // ======================================================================

  describe('Belief Handlers', () => {
    it('should upsert a belief', async () => {
      const handler = createUpsertBeliefHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          agentHandle: 'agent-1',
          beliefType: 'knowledge',
          subject: 'code-quality',
          beliefValue: 'high',
          confidence: 0.9,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('belief-1');
    });

    it('should reject upsert belief with invalid body', async () => {
      const handler = createUpsertBeliefHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should get beliefs for an agent', async () => {
      const handler = createGetBeliefsHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1', handle: 'agent-1' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('beliefs');
    });

    it('should reject get beliefs with missing params', async () => {
      const handler = createGetBeliefsHandler(deps);
      const req = createMockReq({ params: {}, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should upsert a meta-belief', async () => {
      const handler = createUpsertMetaBeliefHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          agentHandle: 'agent-1',
          aboutHandle: 'agent-2',
          metaType: 'reliability',
          beliefValue: 'high',
          confidence: 0.8,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('meta-1');
    });

    it('should get swarm consensus', async () => {
      const handler = createGetSwarmConsensusHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1', subject: 'code-quality' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('subject');
    });

    it('should reject consensus with missing params', async () => {
      const handler = createGetSwarmConsensusHandler(deps);
      const req = createMockReq({ params: {}, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should get belief stats', async () => {
      const handler = createBeliefStatsHandler(deps);
      const req = createMockReq({ params: { swarmId: 'swarm-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });
  });

  // ======================================================================
  // CREDIT ROUTES
  // ======================================================================

  describe('Credit Handlers', () => {
    it('should get credits for an agent', async () => {
      const handler = createGetCreditsHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1', handle: 'agent-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.balance).toBe(100);
    });

    it('should reject get credits with missing params', async () => {
      const handler = createGetCreditsHandler(deps);
      const req = createMockReq({ params: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should get leaderboard', async () => {
      const handler = createGetLeaderboardHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('leaderboard');
    });

    it('should transfer credits', async () => {
      const handler = createTransferCreditsHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          fromHandle: 'agent-1',
          toHandle: 'agent-2',
          amount: 10,
          reason: 'payment',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should reject transfer with insufficient balance', async () => {
      const { CreditStorage } = await import('../storage/credits.js');
      // Override prototype method so future instances return low balance
      const origGetOrCreate = CreditStorage.prototype.getOrCreateCredits;
      CreditStorage.prototype.getOrCreateCredits = vi.fn().mockReturnValue({ balance: 5, reputationScore: 0.8 });

      const handler = createTransferCreditsHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          fromHandle: 'agent-1',
          toHandle: 'agent-2',
          amount: 100,
          reason: 'too-much',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);

      // Restore
      CreditStorage.prototype.getOrCreateCredits = origGetOrCreate;
    });

    it('should record a transaction', async () => {
      const handler = createRecordTransactionHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          agentHandle: 'agent-1',
          transactionType: 'earn',
          amount: 50,
          referenceType: 'task',
          referenceId: 'task-1',
          reason: 'task completed',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should get credit history', async () => {
      const handler = createGetCreditHistoryHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1', handle: 'agent-1' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('transactions');
    });

    it('should get credit stats', async () => {
      const handler = createCreditStatsHandler(deps);
      const req = createMockReq({ params: { swarmId: 'swarm-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });
  });

  // ======================================================================
  // CONSENSUS ROUTES
  // ======================================================================

  describe('Consensus Handlers', () => {
    it('should create a proposal', async () => {
      const handler = createCreateProposalHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          title: 'New Architecture',
          description: 'Proposal for new architecture',
          proposerHandle: 'agent-1',
          proposalType: 'decision',
          options: ['approve', 'reject'],
          deadlineMs: Date.now() + 3600000,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('prop-1');
    });

    it('should list proposals', async () => {
      const handler = createListProposalsHandler(deps);
      const req = createMockReq({
        params: { swarmId: 'swarm-1' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('proposals');
    });

    it('should get a specific proposal with votes', async () => {
      const { ConsensusStorage } = await import('../storage/consensus.js');
      // Override prototype methods so the handler's instance returns data
      ConsensusStorage.prototype.getProposal = vi.fn().mockReturnValue({ id: 'prop-1', title: 'Test', status: 'open' });
      ConsensusStorage.prototype.getVotes = vi.fn().mockReturnValue([{ voterHandle: 'a1', vote: 'approve' }]);

      const handler = createGetProposalHandler(deps);
      const req = createMockReq({ params: { id: 'prop-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('prop-1');
      expect(response.votes).toHaveLength(1);
    });

    it('should return 404 for missing proposal', async () => {
      const { ConsensusStorage } = await import('../storage/consensus.js');
      // Restore default: getProposal returns null
      ConsensusStorage.prototype.getProposal = vi.fn().mockReturnValue(null);

      const handler = createGetProposalHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should cast a vote', async () => {
      const handler = createCastVoteHandler(deps);
      const req = createMockReq({
        params: { id: 'prop-1' },
        body: { voterHandle: 'agent-1', voteValue: 'approve' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('vote-1');
    });

    it('should reject vote with missing proposal id', async () => {
      const handler = createCastVoteHandler(deps);
      const req = createMockReq({ params: {}, body: { voterHandle: 'a1', vote: 'approve' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when vote fails', async () => {
      const { ConsensusStorage } = await import('../storage/consensus.js');
      // Override prototype so the handler's instance returns null for castVote
      ConsensusStorage.prototype.castVote = vi.fn().mockReturnValue(null);

      const handler = createCastVoteHandler(deps);
      const req = createMockReq({
        params: { id: 'prop-1' },
        body: { voterHandle: 'agent-1', voteValue: 'approve' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should close a proposal and tally', async () => {
      const { ConsensusStorage } = await import('../storage/consensus.js');
      // Override prototype so the handler's instance returns tally result
      ConsensusStorage.prototype.closeAndTally = vi.fn().mockReturnValue({ winner: 'approve', quorumMet: true });

      const handler = createCloseProposalHandler(deps);

      const req = createMockReq({ params: { id: 'prop-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.winner).toBe('approve');
    });

    it('should return 400 when close fails', async () => {
      const { ConsensusStorage } = await import('../storage/consensus.js');
      // Restore default: closeAndTally returns null
      ConsensusStorage.prototype.closeAndTally = vi.fn().mockReturnValue(null);

      const handler = createCloseProposalHandler(deps);
      const req = createMockReq({ params: { id: 'prop-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should get consensus stats', async () => {
      const handler = createConsensusStatsHandler(deps);
      const req = createMockReq({ params: { swarmId: 'swarm-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });
  });

  // ======================================================================
  // BIDDING ROUTES
  // ======================================================================

  describe('Bidding Handlers', () => {
    it('should submit a bid', async () => {
      const handler = createSubmitBidHandler(deps);
      const req = createMockReq({
        body: {
          taskId: 'task-1',
          swarmId: 'swarm-1',
          bidderHandle: 'agent-1',
          bidAmount: 10,
          estimatedDuration: 3600000,
          strategy: 'I will focus on tests',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.id).toBe('bid-1');
    });

    it('should get bids for a task', async () => {
      const handler = createGetTaskBidsHandler(deps);
      const req = createMockReq({
        params: { taskId: 'task-1' },
        query: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('bids');
    });

    it('should reject get task bids with missing taskId', async () => {
      const handler = createGetTaskBidsHandler(deps);
      const req = createMockReq({ params: {}, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for missing bid', async () => {
      const handler = createGetBidHandler(deps);
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when accept bid fails', async () => {
      const handler = createAcceptBidHandler(deps);
      const req = createMockReq({
        params: { id: 'bid-1' },
        body: { settleCredits: false },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should withdraw a bid', async () => {
      const { BiddingStorage } = await import('../storage/bidding.js');
      // Override prototype so the handler's instance returns true for withdrawBid
      BiddingStorage.prototype.withdrawBid = vi.fn().mockReturnValue(true);

      const handler = createWithdrawBidHandler(deps);

      const req = createMockReq({
        params: { id: 'bid-1' },
        query: { handle: 'agent-1' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should reject withdraw with missing params', async () => {
      const handler = createWithdrawBidHandler(deps);
      const req = createMockReq({ params: {}, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should evaluate bids with no pending bids', async () => {
      const handler = createEvaluateBidsHandler(deps);
      const req = createMockReq({
        params: { taskId: 'task-1' },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.evaluations).toEqual([]);
    });

    it('should get bidding stats', async () => {
      const handler = createBiddingStatsHandler(deps);
      const req = createMockReq({ params: { swarmId: 'swarm-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });
  });

  // ======================================================================
  // PAYOFF ROUTES
  // ======================================================================

  describe('Payoff Handlers', () => {
    it('should define a payoff', async () => {
      const mockRow = { task_id: 'task-1', payoff_type: 'completion', base_value: 100 };
      (deps.legacyStorage.getDatabase as ReturnType<typeof vi.fn>).mockReturnValue({
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(mockRow),
          all: vi.fn().mockReturnValue([]),
          run: vi.fn(),
        }),
      });

      const handler = createDefinePayoffHandler(deps);
      const req = createMockReq({
        body: {
          taskId: 'task-1',
          payoffType: 'completion',
          baseValue: 100,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });
    });

    it('should calculate payoff for task with no payoffs', async () => {
      (deps.legacyStorage.getDatabase as ReturnType<typeof vi.fn>).mockReturnValue({
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([]),
          get: vi.fn(),
          run: vi.fn(),
        }),
      });

      const handler = createCalculatePayoffHandler(deps);
      const req = createMockReq({ params: { taskId: 'task-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.totalPayoff).toBe(0);
    });

    it('should reject calculate payoff with missing taskId', async () => {
      const handler = createCalculatePayoffHandler(deps);
      const req = createMockReq({ params: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should get payoffs for a task', async () => {
      (deps.legacyStorage.getDatabase as ReturnType<typeof vi.fn>).mockReturnValue({
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([{ task_id: 'task-1', payoff_type: 'completion', base_value: 100 }]),
          get: vi.fn(),
          run: vi.fn(),
        }),
      });

      const handler = createGetPayoffsHandler(deps);
      const req = createMockReq({ params: { taskId: 'task-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveLength(1);
    });
  });

  // ======================================================================
  // REPUTATION & AUCTION ROUTES
  // ======================================================================

  describe('Reputation & Auction Handlers', () => {
    it('should update reputation', async () => {
      (deps.legacyStorage.getDatabase as ReturnType<typeof vi.fn>).mockReturnValue({
        prepare: vi.fn().mockReturnValue({
          run: vi.fn(),
          all: vi.fn().mockReturnValue([]),
          get: vi.fn(),
        }),
      });

      const handler = createUpdateReputationHandler(deps);
      const req = createMockReq({
        body: {
          swarmId: 'swarm-1',
          agentHandle: 'agent-1',
          success: true,
          weight: 0.1,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.agentHandle).toBe('agent-1');
      expect(response.success).toBe(true);
    });

    it('should reject reputation update with missing fields', async () => {
      const handler = createUpdateReputationHandler(deps);
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject reputation update with non-boolean success', async () => {
      const handler = createUpdateReputationHandler(deps);
      const req = createMockReq({
        body: { swarmId: 'swarm-1', agentHandle: 'agent-1', success: 'yes' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when no pending bids for auction', async () => {
      const handler = createRunAuctionHandler(deps);
      const req = createMockReq({
        params: { taskId: 'task-1' },
        body: { auctionType: 'first-price' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject auction with invalid auction type', async () => {
      const handler = createRunAuctionHandler(deps);
      const req = createMockReq({
        params: { taskId: 'task-1' },
        body: { auctionType: 'invalid' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
