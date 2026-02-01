/**
 * Task Router
 *
 * Classifies task complexity and routes to the optimal execution strategy.
 * Tracks routing outcomes to learn and adjust weights over time.
 *
 * Routing Table:
 *   Simple  (lint, format)      → Direct (single agent)  → Haiku
 *   Medium  (implement, test)   → Supervised (+ review)  → Sonnet
 *   Complex (architect, refactor) → Swarm (multi-agent)  → Opus
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from '../storage/sqlite.js';

// ============================================================================
// Types
// ============================================================================

/** Complexity classification */
export type TaskComplexity = 'simple' | 'medium' | 'complex';

/** Execution strategy */
export type TaskStrategy = 'direct' | 'supervised' | 'swarm';

/** Recommended model */
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

/** Task routing decision */
export interface RoutingDecision {
  complexity: TaskComplexity;
  strategy: TaskStrategy;
  model: ModelTier;
  confidence: number;
  signals: RoutingSignal[];
}

/** Individual signal contributing to the routing decision */
export interface RoutingSignal {
  name: string;
  value: number;
  weight: number;
  contribution: TaskComplexity;
}

/** Recorded outcome of a routing decision */
export interface RoutingOutcome {
  taskId: string;
  success: boolean;
  durationMs: number;
  restarts: number;
  errorCount: number;
}

/** Routing configuration / weights */
interface RoutingWeights {
  /** Threshold for description length (chars) */
  descriptionLengthThreshold: { simple: number; medium: number };
  /** Keywords that signal higher complexity */
  complexKeywords: string[];
  /** Keywords that signal lower complexity */
  simpleKeywords: string[];
  /** Weight multiplier for historical data */
  historyWeight: number;
  /** Weight multiplier for keyword signals */
  keywordWeight: number;
  /** Weight multiplier for dependency signals */
  dependencyWeight: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_WEIGHTS: RoutingWeights = {
  descriptionLengthThreshold: { simple: 200, medium: 800 },
  complexKeywords: [
    'architect', 'refactor', 'redesign', 'migrate', 'optimize',
    'security', 'authentication', 'authorization', 'database schema',
    'multi-file', 'cross-module', 'performance', 'scalability',
    'distributed', 'concurrent', 'parallel', 'real-time',
  ],
  simpleKeywords: [
    'lint', 'format', 'typo', 'rename', 'comment', 'log',
    'readme', 'docs', 'version', 'bump', 'config', 'env',
    'import', 'export', 'style', 'css', 'color', 'spacing',
  ],
  historyWeight: 0.3,
  keywordWeight: 0.4,
  dependencyWeight: 0.3,
};

// ============================================================================
// TaskRouter
// ============================================================================

export class TaskRouter {
  private storage: SQLiteStorage | null;
  private weights: RoutingWeights;

  constructor(storage: SQLiteStorage | null = null, weights?: Partial<RoutingWeights>) {
    this.storage = storage;
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Classify a task and return a routing decision.
   */
  classify(task: {
    subject: string;
    description?: string | null;
    blockedBy?: string[];
  }): RoutingDecision {
    const signals: RoutingSignal[] = [];
    const text = `${task.subject} ${task.description ?? ''}`.toLowerCase();

    // Signal 1: Description length
    const descLength = (task.description ?? '').length;
    let lengthComplexity: TaskComplexity = 'simple';
    if (descLength > this.weights.descriptionLengthThreshold.medium) {
      lengthComplexity = 'complex';
    } else if (descLength > this.weights.descriptionLengthThreshold.simple) {
      lengthComplexity = 'medium';
    }
    signals.push({
      name: 'description_length',
      value: descLength,
      weight: 0.2,
      contribution: lengthComplexity,
    });

    // Signal 2: Keyword analysis
    const complexMatches = this.weights.complexKeywords.filter((kw) => text.includes(kw));
    const simpleMatches = this.weights.simpleKeywords.filter((kw) => text.includes(kw));

    let keywordComplexity: TaskComplexity;
    if (complexMatches.length >= 2) {
      keywordComplexity = 'complex';
    } else if (complexMatches.length >= 1 && simpleMatches.length === 0) {
      keywordComplexity = 'medium';
    } else if (simpleMatches.length >= 1 && complexMatches.length === 0) {
      keywordComplexity = 'simple';
    } else {
      keywordComplexity = 'medium'; // ambiguous defaults to medium
    }
    signals.push({
      name: 'keyword_analysis',
      value: complexMatches.length - simpleMatches.length,
      weight: this.weights.keywordWeight,
      contribution: keywordComplexity,
    });

    // Signal 3: Dependency count
    const depCount = task.blockedBy?.length ?? 0;
    let depComplexity: TaskComplexity = 'simple';
    if (depCount >= 3) {
      depComplexity = 'complex';
    } else if (depCount >= 1) {
      depComplexity = 'medium';
    }
    signals.push({
      name: 'dependency_count',
      value: depCount,
      weight: this.weights.dependencyWeight,
      contribution: depComplexity,
    });

    // Signal 4: Historical data (if available)
    if (this.storage) {
      const historicalSignal = this.getHistoricalSignal(task.subject);
      if (historicalSignal) {
        signals.push(historicalSignal);
      }
    }

    // Aggregate signals into final complexity
    const complexity = this.aggregateSignals(signals);

    // Map complexity to strategy and model
    const strategy = this.complexityToStrategy(complexity);
    const model = this.complexityToModel(complexity);

    // Calculate confidence (how strongly signals agree)
    const confidence = this.calculateConfidence(signals, complexity);

    return { complexity, strategy, model, confidence, signals };
  }

  /**
   * Record the outcome of a routing decision for learning.
   */
  recordOutcome(decision: RoutingDecision, outcome: RoutingOutcome): void {
    if (!this.storage) return;

    this.storage.insertRoutingHistory({
      id: uuidv4(),
      taskId: outcome.taskId,
      complexity: decision.complexity,
      strategy: decision.strategy,
      model: decision.model,
      outcome: outcome.success ? 'success' : 'failure',
      durationMs: outcome.durationMs,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Get routing statistics for analysis.
   */
  getStats(): {
    totalDecisions: number;
    byComplexity: Record<TaskComplexity, { count: number; avgDuration: number; successRate: number }>;
  } {
    const stats: {
      totalDecisions: number;
      byComplexity: Record<TaskComplexity, { count: number; avgDuration: number; successRate: number }>;
    } = {
      totalDecisions: 0,
      byComplexity: {
        simple: { count: 0, avgDuration: 0, successRate: 0 },
        medium: { count: 0, avgDuration: 0, successRate: 0 },
        complex: { count: 0, avgDuration: 0, successRate: 0 },
      },
    };

    if (!this.storage) return stats;

    for (const complexity of ['simple', 'medium', 'complex'] as TaskComplexity[]) {
      const history = this.storage.getRoutingHistoryByComplexity(complexity, 100);
      const withOutcome = history.filter((h) => h.outcome !== null);

      stats.byComplexity[complexity].count = history.length;
      stats.totalDecisions += history.length;

      if (withOutcome.length > 0) {
        const successes = withOutcome.filter((h) => h.outcome === 'success').length;
        stats.byComplexity[complexity].successRate = successes / withOutcome.length;

        const durations = withOutcome
          .filter((h) => h.duration_ms !== null)
          .map((h) => h.duration_ms as number);
        if (durations.length > 0) {
          stats.byComplexity[complexity].avgDuration =
            durations.reduce((sum, d) => sum + d, 0) / durations.length;
        }
      }
    }

    return stats;
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  private getHistoricalSignal(_subject: string): RoutingSignal | null {
    if (!this.storage) return null;

    // Look for similar tasks in history by checking all complexity levels
    // and seeing which complexity had the best outcomes
    const allHistory = [
      ...this.storage.getRoutingHistoryByComplexity('simple', 20),
      ...this.storage.getRoutingHistoryByComplexity('medium', 20),
      ...this.storage.getRoutingHistoryByComplexity('complex', 20),
    ];

    if (allHistory.length === 0) return null;

    let bestComplexity: TaskComplexity = 'medium';
    let bestScore = 0;

    const complexityCounts: Record<string, { successes: number; total: number }> = {};

    for (const entry of allHistory) {
      if (entry.outcome === null) continue;

      if (!complexityCounts[entry.complexity]) {
        complexityCounts[entry.complexity] = { successes: 0, total: 0 };
      }
      complexityCounts[entry.complexity].total++;
      if (entry.outcome === 'success') {
        complexityCounts[entry.complexity].successes++;
      }
    }

    for (const [complexity, counts] of Object.entries(complexityCounts)) {
      if (counts.total === 0) continue;
      const score = counts.successes / counts.total;
      if (score > bestScore) {
        bestScore = score;
        bestComplexity = complexity as TaskComplexity;
      }
    }

    // Only return historical signal if we have meaningful data
    if (bestScore === 0 || Object.keys(complexityCounts).length === 0) return null;

    return {
      name: 'historical_performance',
      value: bestScore,
      weight: this.weights.historyWeight,
      contribution: bestComplexity,
    };
  }

  private aggregateSignals(signals: RoutingSignal[]): TaskComplexity {
    const scores: Record<TaskComplexity, number> = { simple: 0, medium: 0, complex: 0 };

    for (const signal of signals) {
      scores[signal.contribution] += signal.weight;
    }

    // Return complexity with highest weighted score
    if (scores.complex >= scores.medium && scores.complex >= scores.simple) {
      return 'complex';
    }
    if (scores.medium >= scores.simple) {
      return 'medium';
    }
    return 'simple';
  }

  private complexityToStrategy(complexity: TaskComplexity): TaskStrategy {
    switch (complexity) {
      case 'simple': return 'direct';
      case 'medium': return 'supervised';
      case 'complex': return 'swarm';
    }
  }

  private complexityToModel(complexity: TaskComplexity): ModelTier {
    switch (complexity) {
      case 'simple': return 'haiku';
      case 'medium': return 'sonnet';
      case 'complex': return 'opus';
    }
  }

  private calculateConfidence(signals: RoutingSignal[], finalComplexity: TaskComplexity): number {
    if (signals.length === 0) return 0.5;

    const agreeing = signals.filter((s) => s.contribution === finalComplexity);
    return agreeing.reduce((sum, s) => sum + s.weight, 0) /
           signals.reduce((sum, s) => sum + s.weight, 0);
  }
}
