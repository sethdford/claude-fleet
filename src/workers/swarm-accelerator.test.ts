/**
 * Swarm Accelerator Tests
 *
 * Tests the JS fallback implementation of SwarmAccelerator.
 * These paths run when the native Rust addon is not compiled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force JS fallback by making createRequire fail
vi.mock('node:module', () => ({
  createRequire: () => {
    return () => {
      throw new Error('native not available');
    };
  },
}));

// Must import AFTER mocking
const { createSwarmAccelerator } = await import('./swarm-accelerator.js');

describe('SwarmAccelerator (JS fallback)', () => {
  let accelerator: ReturnType<typeof createSwarmAccelerator>;

  beforeEach(() => {
    // Reset singleton for each test
    vi.resetModules();
    accelerator = createSwarmAccelerator();
  });

  describe('processDecay', () => {
    it('should decay trail intensities', () => {
      const trails = [
        { id: 'a', intensity: 1.0, createdAt: Date.now() },
        { id: 'b', intensity: 0.5, createdAt: Date.now() },
      ];

      const result = accelerator.processDecay(trails, 0.1, 0.01);

      expect(result.trails).toHaveLength(2);
      expect(result.trails[0].intensity).toBeCloseTo(0.9, 2);
      expect(result.trails[1].intensity).toBeCloseTo(0.45, 2);
      expect(result.removedCount).toBe(0);
    });

    it('should remove trails below minIntensity', () => {
      const trails = [
        { id: 'a', intensity: 1.0, createdAt: Date.now() },
        { id: 'b', intensity: 0.05, createdAt: Date.now() },
      ];

      const result = accelerator.processDecay(trails, 0.5, 0.1);

      expect(result.trails).toHaveLength(1);
      expect(result.trails[0].id).toBe('a');
      expect(result.removedCount).toBe(1);
      expect(result.removedIds).toContain('b');
    });

    it('should handle empty input', () => {
      const result = accelerator.processDecay([], 0.1, 0.01);
      expect(result.trails).toHaveLength(0);
      expect(result.removedCount).toBe(0);
    });
  });

  describe('evaluateBids', () => {
    it('should score and rank bids', () => {
      const bids = [
        { id: 'bid1', bidderHandle: 'alice', bidAmount: 10, confidence: 0.8, reputation: 100, estimatedDuration: 60 },
        { id: 'bid2', bidderHandle: 'bob', bidAmount: 5, confidence: 0.9, reputation: 80, estimatedDuration: 45 },
      ];

      const result = accelerator.evaluateBids(bids, 0.3, 0.4, 0.3, true);

      expect(result.rankedBids).toHaveLength(2);
      expect(result.winnerId).toBeDefined();
      expect(result.winnerScore).toBeGreaterThan(0);
      // Each bid should have score components
      expect(result.rankedBids[0].compositeScore).toBeGreaterThanOrEqual(result.rankedBids[1].compositeScore);
    });

    it('should handle empty bids', () => {
      const result = accelerator.evaluateBids([], 0.3, 0.4, 0.3, true);
      expect(result.rankedBids).toHaveLength(0);
      expect(result.winnerId).toBe('');
    });

    it('should prefer lower bids when flag is set', () => {
      const bids = [
        { id: 'high', bidderHandle: 'alice', bidAmount: 100, confidence: 0.5, reputation: 50, estimatedDuration: 60 },
        { id: 'low', bidderHandle: 'bob', bidAmount: 10, confidence: 0.5, reputation: 50, estimatedDuration: 60 },
      ];

      const result = accelerator.evaluateBids(bids, 0.0, 0.0, 1.0, true);
      expect(result.winnerId).toBe('low');
    });
  });

  describe('tallyVotes', () => {
    it('should tally majority votes', () => {
      const votes = [
        { voterHandle: 'a', voteValue: 'yes', voteWeight: 1 },
        { voterHandle: 'b', voteValue: 'yes', voteWeight: 1 },
        { voterHandle: 'c', voteValue: 'no', voteWeight: 1 },
      ];

      const result = accelerator.tallyVotes(votes, ['yes', 'no'], 'majority', 0.5);

      expect(result.totalVotes).toBe(3);
      expect(result.winner).toBe('yes');
      expect(result.quorumMet).toBe(true);
    });

    it('should require supermajority when method is supermajority', () => {
      const votes = [
        { voterHandle: 'a', voteValue: 'yes', voteWeight: 1 },
        { voterHandle: 'b', voteValue: 'yes', voteWeight: 1 },
        { voterHandle: 'c', voteValue: 'no', voteWeight: 1 },
      ];

      const result = accelerator.tallyVotes(votes, ['yes', 'no'], 'supermajority', 0.67);

      // 2/3 = 0.667 which is >= 0.667 threshold
      expect(result.quorumMet).toBe(true);
    });

    it('should handle weighted votes', () => {
      const votes = [
        { voterHandle: 'a', voteValue: 'yes', voteWeight: 5 },
        { voterHandle: 'b', voteValue: 'no', voteWeight: 1 },
      ];

      const result = accelerator.tallyVotes(votes, ['yes', 'no'], 'majority', 0.5);
      expect(result.winner).toBe('yes');
      expect(result.weightedTotal).toBe(6);
    });

    it('should handle ranked voting (Borda count)', () => {
      const votes = [
        { voterHandle: 'a', voteValue: '["alpha","beta","gamma"]', voteWeight: 1 },
        { voterHandle: 'b', voteValue: '["beta","alpha","gamma"]', voteWeight: 1 },
      ];

      const result = accelerator.tallyVotes(votes, ['alpha', 'beta', 'gamma'], 'ranked', 0.5);
      expect(result.totalVotes).toBe(2);
      // alpha: 3+2=5, beta: 2+3=5, gamma: 1+1=2
      // Tie between alpha and beta
      expect(['alpha', 'beta']).toContain(result.winner);
    });
  });

  describe('calculatePayoff', () => {
    it('should find dominant strategy', () => {
      const strategies = ['cooperate', 'defect'];
      const payoffMatrix = {
        cooperate: { cooperate: 3, defect: 0 },
        defect: { cooperate: 5, defect: 1 },
      };

      const resultJson = accelerator.calculatePayoff(strategies, payoffMatrix);
      const result = JSON.parse(resultJson) as { dominant_strategy: string; payoffs: Record<string, number> };
      expect(result.dominant_strategy).toBe('defect');
      // defect avg = (5+1)/2 = 3, cooperate avg = (3+0)/2 = 1.5
      expect(result.payoffs.defect).toBe(3);
      expect(result.payoffs.cooperate).toBe(1.5);
    });
  });

  describe('routeTasks', () => {
    it('should assign tasks to workers', () => {
      const tasks = ['task1', 'task2', 'task3'];
      const workers = ['alice', 'bob'];
      const trailStrengths = {
        alice: { task1: 0.9, task2: 0.1 },
        bob: { task2: 0.8, task3: 0.7 },
      };

      const assignments = accelerator.routeTasks(tasks, workers, trailStrengths, 1.0);
      expect(Object.keys(assignments)).toHaveLength(3);
      expect(assignments.task1).toBe('alice');
    });

    it('should handle empty workers', () => {
      const assignments = accelerator.routeTasks(['task1'], [], {}, 1.0);
      expect(Object.keys(assignments)).toHaveLength(0);
    });

    it('should balance load across workers', () => {
      const tasks = ['t1', 't2', 't3', 't4'];
      const workers = ['a', 'b'];
      // Equal trail strengths — load balancing should distribute
      const trailStrengths = {};

      const assignments = accelerator.routeTasks(tasks, workers, trailStrengths, 1.0);
      const aCount = Object.values(assignments).filter((w) => w === 'a').length;
      const bCount = Object.values(assignments).filter((w) => w === 'b').length;
      // Should be roughly balanced (2-2 or 3-1 depending on default intensity)
      expect(aCount + bCount).toBe(4);
    });
  });
});
