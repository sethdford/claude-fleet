/**
 * Compound Machine Route Handlers
 *
 * Aggregates fleet state into a unified snapshot for the
 * Compounding Machine visualization dashboard.
 *
 * The Rust NAPI accumulator is optional — when unavailable,
 * a pure-JS fallback accumulates time-series data and computes
 * growth rates using the same linear regression approach.
 */

import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';
import { PheromoneStorage } from '../storage/pheromone.js';
import { BeliefStorage } from '../storage/beliefs.js';
import { CreditStorage } from '../storage/credits.js';

// --- Shared Types ---

interface TimeSeriesPoint {
  timestamp: number;
  tasksCompleted: number;
  knowledgeEntries: number;
  creditsEarned: number;
  activeWorkers: number;
  healthyWorkers: number;
  totalSwarms: number;
  blackboardMessages: number;
  pheromoneTrails: number;
}

interface SnapshotInput {
  workers: Array<{ state: string; health: string }>;
  swarms: Array<unknown>;
  tasksCompleted: number;
  knowledgeEntries: number;
  creditsTotal: number;
  blackboardMessages: number;
  pheromoneTrails: number;
}

interface Accumulator {
  pushSnapshot(input: SnapshotInput): void;
  getTimeSeries(): TimeSeriesPoint[];
  getCompoundRate(): number;
  getKnowledgeVelocity(): number;
  getCreditsVelocity(): number;
}

// --- JS Fallback Accumulator ---

const MAX_POINTS = 720; // 1 hour at 5-second intervals

class JSCompoundAccumulator implements Accumulator {
  private head = 0;
  private count = 0;
  private readonly buffer: (TimeSeriesPoint | undefined)[] = new Array(MAX_POINTS);

  pushSnapshot(snapshot: SnapshotInput): void {
    const activeWorkers = snapshot.workers.filter(w => w.state !== 'stopped').length;
    const healthyWorkers = snapshot.workers.filter(w => w.health === 'healthy').length;

    const point: TimeSeriesPoint = {
      timestamp: Date.now(),
      tasksCompleted: snapshot.tasksCompleted,
      knowledgeEntries: snapshot.knowledgeEntries,
      creditsEarned: snapshot.creditsTotal,
      activeWorkers,
      healthyWorkers,
      totalSwarms: snapshot.swarms.length,
      blackboardMessages: snapshot.blackboardMessages,
      pheromoneTrails: snapshot.pheromoneTrails,
    };

    if (this.count < MAX_POINTS) {
      // Buffer not full: append at tail
      this.buffer[this.count] = point;
      this.count++;
    } else {
      // Buffer full: overwrite head, advance
      this.buffer[this.head] = point;
      this.head = (this.head + 1) % MAX_POINTS;
    }
  }

  getTimeSeries(): TimeSeriesPoint[] {
    const result: TimeSeriesPoint[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % MAX_POINTS;
      const p = this.buffer[idx];
      if (p) result.push(p);
    }
    return result;
  }

  getCompoundRate(): number {
    return this.computeRate(p => p.tasksCompleted, 60);
  }

  getKnowledgeVelocity(): number {
    return this.computeRate(p => p.knowledgeEntries, 60);
  }

  getCreditsVelocity(): number {
    return this.computeRate(p => p.creditsEarned, 60);
  }

  private computeRate(extract: (p: TimeSeriesPoint) => number, windowSize: number): number {
    if (this.count < 2) return 0;

    const start = this.count > windowSize ? this.count - windowSize : 0;
    const wn = this.count - start;
    if (wn < 2) return 0;

    // Linear regression: slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < wn; i++) {
      const idx = (this.head + start + i) % MAX_POINTS;
      const p = this.buffer[idx];
      if (!p) continue;
      const x = i;
      const y = extract(p);
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const denom = wn * sumXX - sumX * sumX;
    if (Math.abs(denom) < Number.EPSILON) return 0;

    const slopePerPoint = (wn * sumXY - sumX * sumY) / denom;
    // Convert from per-point (5s intervals) to per-minute (12 points/min)
    return slopePerPoint * 12;
  }
}

// --- Accumulator Initialization ---

function createAccumulator(): Accumulator {
  try {
    const esmRequire = createRequire(import.meta.url);
    const native = esmRequire('@claude-fleet/compound');
    const inst = new native.CompoundAccumulator();
    console.log('[compound] Using native Rust accumulator');

    return {
      pushSnapshot(input: SnapshotInput) { inst.pushSnapshot(JSON.stringify(input)); },
      getTimeSeries() { return inst.getTimeSeries(); },
      getCompoundRate() { return inst.getCompoundRate(); },
      getKnowledgeVelocity() { return inst.getKnowledgeVelocity(); },
      getCreditsVelocity() { return inst.getCreditsVelocity(); },
    };
  } catch {
    console.log('[compound] Rust accumulator not available, using JS fallback');
    return new JSCompoundAccumulator();
  }
}

const accumulator = createAccumulator();

// --- Route Handler ---

/**
 * GET /compound/snapshot
 *
 * Returns the full aggregated fleet snapshot including workers,
 * swarms, tasks, intelligence stats, and time-series data.
 */
export function createCompoundSnapshotHandler(deps: RouteDependencies) {
  const pheromoneStorage = new PheromoneStorage(deps.legacyStorage);
  const beliefStorage = new BeliefStorage(deps.legacyStorage);
  const creditStorage = new CreditStorage(deps.legacyStorage);

  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    // Gather workers
    const workers = deps.workerManager.getWorkers().map(w => ({
      id: w.id,
      handle: w.handle,
      teamName: w.teamName,
      state: w.state,
      health: w.health,
      spawnedAt: w.spawnedAt,
      currentTaskId: w.currentTaskId,
      swarmId: w.swarmId,
      depthLevel: w.depthLevel,
    }));

    // Gather swarms
    const swarms = Array.from(deps.swarms.entries()).map(([id, s]) => {
      const swarmWorkers = workers.filter(w => w.swarmId === id);
      return {
        id,
        name: s.name,
        description: s.description,
        maxAgents: s.maxAgents,
        createdAt: s.createdAt,
        agentCount: swarmWorkers.length,
        agents: swarmWorkers,
      };
    });

    // Gather task summary — aggregate across ALL teams
    const db = deps.legacyStorage.getDatabase();
    const allTasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Array<{
      id: string;
      status: string;
    }>;
    const tasksByStatus: Record<string, number> = {};
    for (const t of allTasks) {
      const status = t.status ?? 'unknown';
      tasksByStatus[status] = (tasksByStatus[status] ?? 0) + 1;
    }

    // Gather intelligence stats per swarm
    const intelligence: Record<string, {
      beliefStats?: { totalBeliefs: number; uniqueAgents: number; uniqueSubjects: number; avgConfidence: number };
      pheromoneStats?: { totalTrails: number; activeTrails: number };
      leaderboard?: Array<{ agentHandle: string; credits: number }>;
      creditStats?: { totalCredits: number; agentCount: number };
    }> = {};

    for (const [swarmId] of deps.swarms) {
      try {
        const bStats = beliefStorage.getStats(swarmId);
        const pStats = pheromoneStorage.getStats(swarmId);
        const leaders = creditStorage.getLeaderboard(swarmId, 'reputation', 10);

        intelligence[swarmId] = {
          beliefStats: bStats ? {
            totalBeliefs: bStats.totalBeliefs,
            uniqueAgents: bStats.uniqueAgents,
            uniqueSubjects: bStats.uniqueSubjects,
            avgConfidence: bStats.avgConfidence,
          } : undefined,
          pheromoneStats: pStats ? {
            totalTrails: pStats.activeTrails + pStats.decayedTrails,
            activeTrails: pStats.activeTrails,
          } : undefined,
          leaderboard: leaders.map(l => ({
            agentHandle: l.agentHandle,
            credits: l.balance,
          })),
          creditStats: {
            totalCredits: leaders.reduce((sum, l) => sum + l.balance, 0),
            agentCount: leaders.length,
          },
        };
      } catch {
        // Swarm intelligence stores may not be initialized
        intelligence[swarmId] = {};
      }
    }

    // Compute worker stats
    const activeWorkers = workers.filter(w => w.state !== 'stopped').length;
    const workingWorkers = workers.filter(w => w.state === 'working').length;

    // Aggregate intelligence totals for accumulator
    let totalKnowledge = 0;
    let totalPheromones = 0;
    let totalCredits = 0;
    for (const intel of Object.values(intelligence)) {
      totalKnowledge += intel.beliefStats?.totalBeliefs ?? 0;
      totalPheromones += intel.pheromoneStats?.totalTrails ?? 0;
      if (intel.leaderboard) {
        for (const entry of intel.leaderboard) {
          totalCredits += entry.credits;
        }
      }
    }

    // Feed accumulator and read back computed values
    accumulator.pushSnapshot({
      workers: workers.map(w => ({ state: w.state, health: w.health })),
      swarms,
      tasksCompleted: tasksByStatus['completed'] ?? 0,
      knowledgeEntries: totalKnowledge,
      creditsTotal: totalCredits,
      blackboardMessages: 0,
      pheromoneTrails: totalPheromones,
    });

    res.json({
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - deps.startTime) / 1000),
      workers,
      swarms,
      tasks: {
        total: allTasks.length,
        completed: tasksByStatus['completed'] ?? 0,
        byStatus: tasksByStatus,
      },
      intelligence,
      timeSeries: accumulator.getTimeSeries(),
      rates: {
        compoundRate: accumulator.getCompoundRate() || (workingWorkers > 0 ? workingWorkers * 0.5 : 0),
        knowledgeVelocity: accumulator.getKnowledgeVelocity(),
        creditsVelocity: accumulator.getCreditsVelocity(),
      },
      fleet: {
        totalWorkers: workers.length,
        activeWorkers,
        workingWorkers,
        healthStats: deps.workerManager.getHealthStats(),
      },
    });
  });
}
