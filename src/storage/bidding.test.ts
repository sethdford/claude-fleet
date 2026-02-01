/**
 * Tests for BiddingStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { BiddingStorage } from './bidding.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('BiddingStorage', () => {
  let ctx: TestStorageContext;
  let bidding: BiddingStorage;
  const swarmId = 'swarm-1';
  const taskId = 'task-1';

  beforeEach(() => {
    ctx = createTestStorage();
    bidding = new BiddingStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // submitBid()
  // ==========================================================================

  describe('submitBid()', () => {
    it('should create a new bid', () => {
      const bid = bidding.submitBid({
        taskId,
        swarmId,
        bidderHandle: 'agent-1',
        bidAmount: 50,
        confidence: 0.8,
        rationale: 'I can do this efficiently',
      });

      expect(bid.id).toBeDefined();
      expect(bid.taskId).toBe(taskId);
      expect(bid.bidderHandle).toBe('agent-1');
      expect(bid.bidAmount).toBe(50);
      expect(bid.confidence).toBe(0.8);
      expect(bid.status).toBe('pending');
    });

    it('should update existing pending bid from same agent', () => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'agent-1', bidAmount: 50 });
      const updated = bidding.submitBid({ taskId, swarmId, bidderHandle: 'agent-1', bidAmount: 75 });

      expect(updated.bidAmount).toBe(75);

      // Should still be only one bid
      const bids = bidding.getBidsForTask(taskId);
      expect(bids).toHaveLength(1);
    });

    it('should use default confidence 0.5', () => {
      const bid = bidding.submitBid({ taskId, swarmId, bidderHandle: 'agent-1', bidAmount: 30 });
      expect(bid.confidence).toBe(0.5);
    });
  });

  // ==========================================================================
  // getBid()
  // ==========================================================================

  describe('getBid()', () => {
    it('should retrieve a bid by id', () => {
      const created = bidding.submitBid({ taskId, swarmId, bidderHandle: 'agent-1', bidAmount: 50 });
      const retrieved = bidding.getBid(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.bidAmount).toBe(50);
    });

    it('should return null for missing bid', () => {
      const result = bidding.getBid('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getBidsForTask()
  // ==========================================================================

  describe('getBidsForTask()', () => {
    beforeEach(() => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50, confidence: 0.9 });
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a2', bidAmount: 30, confidence: 0.5 });
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a3', bidAmount: 80, confidence: 0.7 });
    });

    it('should return all bids for a task', () => {
      const bids = bidding.getBidsForTask(taskId);
      expect(bids).toHaveLength(3);
    });

    it('should filter by status', () => {
      const bids = bidding.getBidsForTask(taskId, { status: 'pending' });
      expect(bids).toHaveLength(3);
    });

    it('should filter by bidder handle', () => {
      const bids = bidding.getBidsForTask(taskId, { bidderHandle: 'a1' });
      expect(bids).toHaveLength(1);
    });

    it('should filter by min/max bid', () => {
      const bids = bidding.getBidsForTask(taskId, { minBid: 40, maxBid: 70 });
      expect(bids).toHaveLength(1);
      expect(bids[0].bidAmount).toBe(50);
    });

    it('should respect limit', () => {
      const bids = bidding.getBidsForTask(taskId, { limit: 2 });
      expect(bids).toHaveLength(2);
    });
  });

  // ==========================================================================
  // withdrawBid()
  // ==========================================================================

  describe('withdrawBid()', () => {
    it('should mark bid as withdrawn', () => {
      const bid = bidding.submitBid({ taskId, swarmId, bidderHandle: 'agent-1', bidAmount: 50 });
      const withdrawn = bidding.withdrawBid(bid.id, 'agent-1');

      expect(withdrawn).toBe(true);

      const retrieved = bidding.getBid(bid.id);
      expect(retrieved!.status).toBe('withdrawn');
    });

    it('should fail for wrong bidder', () => {
      const bid = bidding.submitBid({ taskId, swarmId, bidderHandle: 'agent-1', bidAmount: 50 });
      const result = bidding.withdrawBid(bid.id, 'agent-2');

      expect(result).toBe(false);
    });

    it('should fail for non-pending bid', () => {
      const bid = bidding.submitBid({ taskId, swarmId, bidderHandle: 'agent-1', bidAmount: 50 });
      bidding.acceptBid(bid.id);

      const result = bidding.withdrawBid(bid.id, 'agent-1');
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // evaluateBids()
  // ==========================================================================

  describe('evaluateBids()', () => {
    it('should evaluate and rank bids', () => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50, confidence: 0.9 });
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a2', bidAmount: 80, confidence: 0.5 });

      const reputations = new Map([['a1', 0.8], ['a2', 0.3]]);
      const evaluations = bidding.evaluateBids(taskId, reputations);

      expect(evaluations.length).toBe(2);
      expect(evaluations[0].score).toBeGreaterThanOrEqual(evaluations[1].score);
      expect(evaluations[0].recommendation).toBeDefined();
    });

    it('should return empty array for no pending bids', () => {
      const evaluations = bidding.evaluateBids('no-task', new Map());
      expect(evaluations).toEqual([]);
    });
  });

  // ==========================================================================
  // acceptBid() / rejectBid()
  // ==========================================================================

  describe('acceptBid() and rejectBid()', () => {
    it('should accept a bid and reject others', () => {
      const bid1 = bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50 });
      const bid2 = bidding.submitBid({ taskId, swarmId, bidderHandle: 'a2', bidAmount: 30 });

      const accepted = bidding.acceptBid(bid1.id);

      expect(accepted).not.toBeNull();
      expect(accepted!.status).toBe('accepted');
      expect(accepted!.processedAt).not.toBeNull();

      // Other bid should be rejected
      const other = bidding.getBid(bid2.id);
      expect(other!.status).toBe('rejected');
    });

    it('should return null when accepting non-pending bid', () => {
      const bid = bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50 });
      bidding.withdrawBid(bid.id, 'a1');

      const result = bidding.acceptBid(bid.id);
      expect(result).toBeNull();
    });

    it('should reject a specific bid', () => {
      const bid = bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50 });
      const rejected = bidding.rejectBid(bid.id);

      expect(rejected).toBe(true);

      const retrieved = bidding.getBid(bid.id);
      expect(retrieved!.status).toBe('rejected');
    });
  });

  // ==========================================================================
  // expireBids()
  // ==========================================================================

  describe('expireBids()', () => {
    it('should expire old pending bids', () => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50 });

      // Backdate the bid
      const db = ctx.storage.getDatabase();
      db.prepare('UPDATE task_bids SET created_at = ?').run(Date.now() - 100000);

      const expired = bidding.expireBids(50000, swarmId);
      expect(expired).toBe(1);
    });

    it('should not expire recent bids', () => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50 });
      const expired = bidding.expireBids(86400000, swarmId);
      expect(expired).toBe(0);
    });
  });

  // ==========================================================================
  // Auction types
  // ==========================================================================

  describe('auctions', () => {
    it('should run first-price auction', () => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50, confidence: 0.9 });
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a2', bidAmount: 80, confidence: 0.8 });

      const reputations = new Map([['a1', 0.7], ['a2', 0.7]]);
      const winner = bidding.runFirstPriceAuction(taskId, reputations);

      expect(winner).not.toBeNull();
      expect(winner!.status).toBe('accepted');
    });

    it('should return null for first-price auction with no bids', () => {
      const result = bidding.runFirstPriceAuction('empty-task', new Map());
      expect(result).toBeNull();
    });

    it('should run second-price auction (winner pays second-highest)', () => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 100, confidence: 0.8 });
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a2', bidAmount: 60, confidence: 0.8 });

      const winner = bidding.runSecondPriceAuction(taskId, new Map());

      expect(winner).not.toBeNull();
      expect(winner!.bidderHandle).toBe('a1');
      // Effective price should be second-highest (60)
      expect(winner!.bidAmount).toBe(60);
    });

    it('should use own bid in second-price with single bidder', () => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50 });

      const winner = bidding.runSecondPriceAuction(taskId, new Map());
      expect(winner).not.toBeNull();
      expect(winner!.bidAmount).toBe(50);
    });
  });

  // ==========================================================================
  // getStats() / getAgentBids()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return bidding statistics', () => {
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a1', bidAmount: 50, confidence: 0.8 });
      bidding.submitBid({ taskId, swarmId, bidderHandle: 'a2', bidAmount: 30, confidence: 0.6 });

      const bid1 = bidding.getBidsForTask(taskId)[0];
      bidding.acceptBid(bid1.id);

      const stats = bidding.getStats(swarmId);
      expect(stats.totalBids).toBe(2);
      expect(stats.acceptedBids).toBe(1);
      expect(stats.rejectedBids).toBe(1);
      expect(stats.uniqueBidders).toBe(2);
      expect(stats.uniqueTasks).toBe(1);
      expect(stats.avgBidAmount).toBe(40);
    });
  });

  describe('getAgentBids()', () => {
    it('should return bids by agent', () => {
      bidding.submitBid({ taskId: 'task-1', swarmId, bidderHandle: 'a1', bidAmount: 50 });
      bidding.submitBid({ taskId: 'task-2', swarmId, bidderHandle: 'a1', bidAmount: 30 });
      bidding.submitBid({ taskId: 'task-1', swarmId, bidderHandle: 'a2', bidAmount: 40 });

      const bids = bidding.getAgentBids(swarmId, 'a1');
      expect(bids).toHaveLength(2);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        bidding.submitBid({ taskId: `task-${i}`, swarmId, bidderHandle: 'a1', bidAmount: 10 });
      }

      const bids = bidding.getAgentBids(swarmId, 'a1', 5);
      expect(bids).toHaveLength(5);
    });
  });
});
