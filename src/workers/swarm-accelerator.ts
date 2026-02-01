/**
 * Swarm Intelligence Accelerator
 *
 * Native Rust acceleration for swarm computation hot paths:
 * - Pheromone decay (batch intensity reduction)
 * - Bid evaluation (multi-factor weighted scoring)
 * - Vote tallying (majority, supermajority, ranked Borda, weighted)
 * - Game-theoretic payoff calculation
 * - ACO-style task routing
 *
 * Falls back to pure JS when Rust addon is unavailable.
 */

import { createRequire } from 'node:module';

// ============================================================================
// Types
// ============================================================================

export interface DecayInput {
  id: string;
  intensity: number;
  createdAt: number;
}

export interface DecayOutput {
  trails: Array<{ id: string; intensity: number; createdAt: number }>;
  removedCount: number;
  removedIds: string[];
}

export interface BidInput {
  id: string;
  bidderHandle: string;
  bidAmount: number;
  confidence: number;
  reputation: number;
  estimatedDuration: number;
}

export interface ScoredBidOutput {
  id: string;
  bidderHandle: string;
  compositeScore: number;
  reputationComponent: number;
  confidenceComponent: number;
  bidComponent: number;
}

export interface BidEvaluationOutput {
  rankedBids: ScoredBidOutput[];
  winnerId: string;
  winnerScore: number;
}

export interface VoteInput {
  voterHandle: string;
  voteValue: string;
  voteWeight: number;
}

export interface ConsensusOutput {
  winner: string | null;
  tally: Array<{ option: string; count: number }>;
  quorumMet: boolean;
  totalVotes: number;
  weightedTotal: number;
  participationRate: number;
}

export interface SwarmAccelerator {
  processDecay(trails: DecayInput[], decayRate: number, minIntensity: number): DecayOutput;
  evaluateBids(
    bids: BidInput[],
    reputationWeight: number,
    confidenceWeight: number,
    bidWeight: number,
    preferLowerBids: boolean
  ): BidEvaluationOutput;
  tallyVotes(
    votes: VoteInput[],
    options: string[],
    method: string,
    quorumValue: number
  ): ConsensusOutput;
  calculatePayoff(strategies: string[], payoffMatrix: Record<string, Record<string, number>>): string;
  routeTasks(
    tasks: string[],
    workers: string[],
    trailStrengths: Record<string, Record<string, number>>,
    alpha: number
  ): Record<string, string>;
}

// ============================================================================
// Native implementation
// ============================================================================

function createNativeAccelerator(native: Record<string, unknown>): SwarmAccelerator {
  const engine = new (native as { SwarmEngine: new () => Record<string, (...args: unknown[]) => unknown> }).SwarmEngine();

  return {
    processDecay(trails, decayRate, minIntensity) {
      const input = trails.map((t) => ({
        id: t.id,
        intensity: t.intensity,
        created_at: t.createdAt,
      }));
      const result = engine.processDecay(JSON.stringify(input), decayRate, minIntensity) as {
        trails: Array<{ id: string; intensity: number; created_at: number }>;
        removedCount: number;
        removedIds: string[];
      };
      return {
        trails: result.trails.map((t) => ({ id: t.id, intensity: t.intensity, createdAt: t.created_at })),
        removedCount: result.removedCount,
        removedIds: result.removedIds,
      };
    },

    evaluateBids(bids, reputationWeight, confidenceWeight, bidWeight, preferLowerBids) {
      const input = bids.map((b) => ({
        id: b.id,
        bidder_handle: b.bidderHandle,
        bid_amount: b.bidAmount,
        confidence: b.confidence,
        reputation: b.reputation,
        estimated_duration: b.estimatedDuration,
      }));
      const result = engine.evaluateBids(
        JSON.stringify(input),
        reputationWeight,
        confidenceWeight,
        bidWeight,
        preferLowerBids
      ) as {
        rankedBids: Array<{
          id: string;
          bidderHandle: string;
          compositeScore: number;
          reputationComponent: number;
          confidenceComponent: number;
          bidComponent: number;
        }>;
        winnerId: string;
        winnerScore: number;
      };
      return result;
    },

    tallyVotes(votes, options, method, quorumValue) {
      const input = votes.map((v) => ({
        voter_handle: v.voterHandle,
        vote_value: v.voteValue,
        vote_weight: v.voteWeight,
      }));
      const result = engine.tallyVotes(
        JSON.stringify(input),
        JSON.stringify(options),
        method,
        quorumValue
      ) as ConsensusOutput;
      return result;
    },

    calculatePayoff(strategies, payoffMatrix) {
      return engine.calculatePayoff(
        JSON.stringify(strategies),
        JSON.stringify(payoffMatrix)
      ) as string;
    },

    routeTasks(tasks, workers, trailStrengths, alpha) {
      const resultJson = engine.routeTasks(
        JSON.stringify(tasks),
        JSON.stringify(workers),
        JSON.stringify(trailStrengths),
        alpha
      ) as string;
      return JSON.parse(resultJson) as Record<string, string>;
    },
  };
}

// ============================================================================
// JS Fallback
// ============================================================================

class JSSwarmAccelerator implements SwarmAccelerator {
  processDecay(trails: DecayInput[], decayRate: number, minIntensity: number): DecayOutput {
    const factor = 1.0 - decayRate;
    const removedIds: string[] = [];

    for (const trail of trails) {
      trail.intensity *= factor;
      if (trail.intensity < minIntensity) {
        removedIds.push(trail.id);
      }
    }

    const surviving = trails.filter((t) => t.intensity >= minIntensity);

    return {
      trails: surviving.map((t) => ({ id: t.id, intensity: t.intensity, createdAt: t.createdAt })),
      removedCount: removedIds.length,
      removedIds,
    };
  }

  evaluateBids(
    bids: BidInput[],
    reputationWeight: number,
    confidenceWeight: number,
    bidWeight: number,
    preferLowerBids: boolean
  ): BidEvaluationOutput {
    if (bids.length === 0) {
      return { rankedBids: [], winnerId: '', winnerScore: 0 };
    }

    const maxBid = Math.max(...bids.map((b) => b.bidAmount));
    const maxRep = Math.max(...bids.map((b) => b.reputation));
    const totalWeight = reputationWeight + confidenceWeight + bidWeight;

    const scored: ScoredBidOutput[] = bids.map((b) => {
      const repNorm = maxRep > 0 ? b.reputation / maxRep : 0;
      const bidNorm = maxBid > 0
        ? (preferLowerBids ? 1.0 - b.bidAmount / maxBid : b.bidAmount / maxBid)
        : 0;

      const repComponent = (repNorm * reputationWeight) / totalWeight;
      const confComponent = (b.confidence * confidenceWeight) / totalWeight;
      const bidComponent = (bidNorm * bidWeight) / totalWeight;

      return {
        id: b.id,
        bidderHandle: b.bidderHandle,
        compositeScore: repComponent + confComponent + bidComponent,
        reputationComponent: repComponent,
        confidenceComponent: confComponent,
        bidComponent,
      };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    return {
      rankedBids: scored,
      winnerId: scored[0].id,
      winnerScore: scored[0].compositeScore,
    };
  }

  tallyVotes(
    votes: VoteInput[],
    options: string[],
    method: string,
    _quorumValue: number
  ): ConsensusOutput {
    const tally = new Map<string, number>();
    for (const opt of options) {
      tally.set(opt, 0);
    }

    let totalWeight = 0;
    for (const vote of votes) {
      if (method === 'ranked') {
        try {
          const rankings = JSON.parse(vote.voteValue) as string[];
          const n = rankings.length;
          for (let i = 0; i < n; i++) {
            const points = (n - i) * vote.voteWeight;
            tally.set(rankings[i], (tally.get(rankings[i]) ?? 0) + points);
          }
          totalWeight += vote.voteWeight;
        } catch {
          // Skip invalid
        }
      } else {
        tally.set(vote.voteValue, (tally.get(vote.voteValue) ?? 0) + vote.voteWeight);
        totalWeight += vote.voteWeight;
      }
    }

    let winner: string | null = null;
    let maxVotes = 0;
    for (const [opt, count] of tally) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = opt;
      }
    }

    let quorumMet = false;
    if (totalWeight > 0) {
      const winnerRatio = maxVotes / totalWeight;
      switch (method) {
        case 'supermajority':
          quorumMet = winnerRatio >= 0.667;
          break;
        case 'unanimous':
          quorumMet = winnerRatio >= 1.0;
          break;
        default:
          quorumMet = winnerRatio > 0.5 || options.length <= 2;
          break;
      }
    }

    const participationRate = totalWeight > 0 ? votes.length / totalWeight : 0;

    const tallyEntries = Array.from(tally.entries()).map(([option, count]) => ({
      option,
      count,
    }));

    return {
      winner: quorumMet ? winner : null,
      tally: tallyEntries,
      quorumMet,
      totalVotes: votes.length,
      weightedTotal: totalWeight,
      participationRate,
    };
  }

  calculatePayoff(strategies: string[], payoffMatrix: Record<string, Record<string, number>>): string {
    const payoffs: Record<string, number> = {};
    for (const strategy of strategies) {
      const row = payoffMatrix[strategy];
      if (row) {
        const values = Object.values(row);
        payoffs[strategy] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      } else {
        payoffs[strategy] = 0;
      }
    }

    let dominant: string | null = null;
    let maxPayoff = -Infinity;
    for (const [s, p] of Object.entries(payoffs)) {
      if (p > maxPayoff) {
        maxPayoff = p;
        dominant = s;
      }
    }

    return JSON.stringify({ payoffs, dominant_strategy: dominant });
  }

  routeTasks(
    tasks: string[],
    workers: string[],
    trailStrengths: Record<string, Record<string, number>>,
    alpha: number
  ): Record<string, string> {
    if (workers.length === 0) return {};

    const assignments: Record<string, string> = {};
    const workerLoad = new Map<string, number>();

    for (const task of tasks) {
      let bestWorker: string | null = null;
      let bestScore = -Infinity;

      for (const worker of workers) {
        const intensity = trailStrengths[worker]?.[task] ?? 0.1;
        const load = workerLoad.get(worker) ?? 0;
        const loadPenalty = 1.0 / (1.0 + load);
        const score = Math.pow(intensity, alpha) * loadPenalty;

        if (score > bestScore) {
          bestScore = score;
          bestWorker = worker;
        }
      }

      if (bestWorker) {
        assignments[task] = bestWorker;
        workerLoad.set(bestWorker, (workerLoad.get(bestWorker) ?? 0) + 1);
      }
    }

    return assignments;
  }
}

// ============================================================================
// Factory
// ============================================================================

let cachedAccelerator: SwarmAccelerator | null = null;

export function createSwarmAccelerator(): SwarmAccelerator {
  if (cachedAccelerator) return cachedAccelerator;

  try {
    const esmRequire = createRequire(import.meta.url);
    const native = esmRequire('@claude-fleet/swarm') as Record<string, unknown>;
    cachedAccelerator = createNativeAccelerator(native);
    console.log('[swarm] Using native Rust accelerator');
  } catch {
    cachedAccelerator = new JSSwarmAccelerator();
    console.log('[swarm] Rust accelerator not available, using JS fallback');
  }

  return cachedAccelerator;
}
