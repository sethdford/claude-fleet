/**
 * Tests for CreditStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { CreditStorage } from './credits.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('CreditStorage', () => {
  let ctx: TestStorageContext;
  let credits: CreditStorage;
  const swarmId = 'swarm-1';

  beforeEach(() => {
    ctx = createTestStorage();
    credits = new CreditStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // getOrCreateCredits()
  // ==========================================================================

  describe('getOrCreateCredits()', () => {
    it('should create new agent with 100 balance and 0.5 reputation', () => {
      const result = credits.getOrCreateCredits(swarmId, 'agent-1');

      expect(result.agentHandle).toBe('agent-1');
      expect(result.swarmId).toBe(swarmId);
      expect(result.balance).toBe(100);
      expect(result.reputationScore).toBe(0.5);
      expect(result.totalEarned).toBe(0);
      expect(result.totalSpent).toBe(0);
      expect(result.taskCount).toBe(0);
    });

    it('should return existing credits on subsequent calls', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');
      const second = credits.getOrCreateCredits(swarmId, 'agent-1');

      expect(second.balance).toBe(100);
    });
  });

  // ==========================================================================
  // getCredits()
  // ==========================================================================

  describe('getCredits()', () => {
    it('should retrieve credits by handle', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');
      const result = credits.getCredits(swarmId, 'agent-1');

      expect(result).not.toBeNull();
      expect(result!.balance).toBe(100);
    });

    it('should return null for non-existent agent', () => {
      const result = credits.getCredits(swarmId, 'unknown');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // recordTransaction()
  // ==========================================================================

  describe('recordTransaction()', () => {
    it('should record an earning transaction', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');

      const result = credits.recordTransaction({
        swarmId,
        agentHandle: 'agent-1',
        transactionType: 'earn',
        amount: 50,
        reason: 'Task completed',
      });

      expect(result.balance).toBe(150);
      expect(result.totalEarned).toBe(50);
    });

    it('should record a spending transaction', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');

      const result = credits.recordTransaction({
        swarmId,
        agentHandle: 'agent-1',
        transactionType: 'spend',
        amount: 30,
        reason: 'Bid on task',
      });

      expect(result.balance).toBe(70);
      expect(result.totalSpent).toBe(30);
    });

    it('should prevent negative balance', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');

      const result = credits.recordTransaction({
        swarmId,
        agentHandle: 'agent-1',
        transactionType: 'spend',
        amount: 200,
      });

      expect(result.balance).toBe(0);
    });

    it('should handle bonus and penalty types', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');

      const bonus = credits.recordTransaction({
        swarmId,
        agentHandle: 'agent-1',
        transactionType: 'bonus',
        amount: 25,
      });
      expect(bonus.balance).toBe(125);

      const penalty = credits.recordTransaction({
        swarmId,
        agentHandle: 'agent-1',
        transactionType: 'penalty',
        amount: 10,
      });
      expect(penalty.balance).toBe(115);
    });

    it('should handle adjustment type', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');

      const result = credits.recordTransaction({
        swarmId,
        agentHandle: 'agent-1',
        transactionType: 'adjustment',
        amount: -50,
      });

      expect(result.balance).toBe(50);
    });
  });

  // ==========================================================================
  // transferCredits()
  // ==========================================================================

  describe('transferCredits()', () => {
    it('should move credits between agents', () => {
      credits.getOrCreateCredits(swarmId, 'sender');
      credits.getOrCreateCredits(swarmId, 'receiver');

      const result = credits.transferCredits({
        swarmId,
        fromHandle: 'sender',
        toHandle: 'receiver',
        amount: 40,
      });

      expect(result.from.balance).toBe(60);
      expect(result.to.balance).toBe(140);
    });

    it('should clamp sender balance at 0', () => {
      credits.getOrCreateCredits(swarmId, 'poor-sender');
      credits.getOrCreateCredits(swarmId, 'receiver');

      const result = credits.transferCredits({
        swarmId,
        fromHandle: 'poor-sender',
        toHandle: 'receiver',
        amount: 200,
      });

      expect(result.from.balance).toBe(0);
      expect(result.to.balance).toBe(300);
    });
  });

  // ==========================================================================
  // updateReputation()
  // ==========================================================================

  describe('updateReputation()', () => {
    it('should increase reputation on success', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');
      const result = credits.updateReputation(swarmId, 'agent-1', true);

      expect(result.reputationScore).toBeGreaterThan(0.5);
      expect(result.taskCount).toBe(1);
      expect(result.successCount).toBe(1);
    });

    it('should decrease reputation on failure', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');
      const result = credits.updateReputation(swarmId, 'agent-1', false);

      expect(result.reputationScore).toBeLessThan(0.5);
      expect(result.taskCount).toBe(1);
      expect(result.successCount).toBe(0);
    });
  });

  // ==========================================================================
  // decayReputation()
  // ==========================================================================

  describe('decayReputation()', () => {
    it('should decay inactive agents toward 0.5', () => {
      // Create agent and backdate its updated_at
      credits.getOrCreateCredits(swarmId, 'stale-agent');
      credits.updateReputation(swarmId, 'stale-agent', true); // Score > 0.5

      // Backdate the update timestamp
      const db = ctx.storage.getDatabase();
      const twoDaysAgo = Date.now() - 2 * 86400000;
      db.prepare('UPDATE agent_credits SET updated_at = ? WHERE agent_handle = ?').run(twoDaysAgo, 'stale-agent');

      const decayed = credits.decayReputation(swarmId, 0.05, 86400000);
      expect(decayed).toBe(1);
    });

    it('should not decay recently active agents', () => {
      credits.getOrCreateCredits(swarmId, 'active-agent');
      const decayed = credits.decayReputation(swarmId, 0.05, 86400000);
      expect(decayed).toBe(0);
    });
  });

  // ==========================================================================
  // getLeaderboard()
  // ==========================================================================

  describe('getLeaderboard()', () => {
    it('should return sorted leaderboard', () => {
      credits.getOrCreateCredits(swarmId, 'rich');
      credits.recordTransaction({ swarmId, agentHandle: 'rich', transactionType: 'earn', amount: 500 });

      credits.getOrCreateCredits(swarmId, 'poor');

      const board = credits.getLeaderboard(swarmId, 'balance');
      expect(board).toHaveLength(2);
      expect(board[0].agentHandle).toBe('rich');
      expect(board[0].balance).toBe(600);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 5; i++) {
        credits.getOrCreateCredits(swarmId, `agent-${i}`);
      }

      const board = credits.getLeaderboard(swarmId, 'reputation', 3);
      expect(board).toHaveLength(3);
    });

    it('should compute success rate', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');
      credits.updateReputation(swarmId, 'agent-1', true);
      credits.updateReputation(swarmId, 'agent-1', true);
      credits.updateReputation(swarmId, 'agent-1', false);

      const board = credits.getLeaderboard(swarmId, 'tasks');
      expect(board[0].taskCount).toBe(3);
      expect(board[0].successCount).toBe(2);
      expect(board[0].successRate).toBeCloseTo(2 / 3);
    });
  });

  // ==========================================================================
  // getTransactionHistory()
  // ==========================================================================

  describe('getTransactionHistory()', () => {
    it('should return transactions for agent', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');
      credits.recordTransaction({ swarmId, agentHandle: 'agent-1', transactionType: 'earn', amount: 10 });
      credits.recordTransaction({ swarmId, agentHandle: 'agent-1', transactionType: 'spend', amount: 5 });

      const history = credits.getTransactionHistory(swarmId, 'agent-1');
      expect(history).toHaveLength(2);
    });

    it('should filter by transaction type', () => {
      credits.getOrCreateCredits(swarmId, 'agent-1');
      credits.recordTransaction({ swarmId, agentHandle: 'agent-1', transactionType: 'earn', amount: 10 });
      credits.recordTransaction({ swarmId, agentHandle: 'agent-1', transactionType: 'spend', amount: 5 });

      const earns = credits.getTransactionHistory(swarmId, 'agent-1', { transactionType: 'earn' });
      expect(earns).toHaveLength(1);
      expect(earns[0].transactionType).toBe('earn');
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return aggregated stats', () => {
      credits.getOrCreateCredits(swarmId, 'a1');
      credits.getOrCreateCredits(swarmId, 'a2');
      credits.recordTransaction({ swarmId, agentHandle: 'a1', transactionType: 'earn', amount: 50 });

      const stats = credits.getStats(swarmId);
      expect(stats.totalAgents).toBe(2);
      expect(stats.totalBalance).toBe(250); // 150 + 100
      expect(stats.totalEarned).toBe(50);
      expect(stats.avgReputation).toBe(0.5);
    });

    it('should return defaults for empty swarm', () => {
      const stats = credits.getStats('empty-swarm');
      expect(stats.totalAgents).toBe(0);
      expect(stats.avgReputation).toBe(0.5);
    });
  });
});
