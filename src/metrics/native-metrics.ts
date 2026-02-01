/**
 * Native Metrics Accelerator
 *
 * Native Rust acceleration for metrics hot paths:
 * - Histogram observation with O(log n) bucket insertion
 * - Percentile computation (p50, p95, p99)
 * - Sliding window rate counters
 * - Time-series downsampling
 *
 * Falls back to pure JS when Rust addon is unavailable.
 */

import { createRequire } from 'node:module';

// ============================================================================
// Types
// ============================================================================

export interface PercentileSnapshot {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  count: number;
  sum: number;
}

export interface NativeMetricsEngine {
  createHistogram(name: string, buckets?: number[]): void;
  observeHistogram(name: string, value: number): void;
  getHistogramPercentiles(name: string): PercentileSnapshot | null;
  createCounter(name: string, windowSeconds: number, bucketCount: number): void;
  incrementCounter(name: string): void;
  getCounterRate(name: string): number;
  getSnapshot(): string;
  downsample(pointsJson: string, factor: number): string;
}

// ============================================================================
// Native implementation
// ============================================================================

function createNativeEngine(native: Record<string, unknown>): NativeMetricsEngine {
  const engine = new (native as { MetricsEngine: new () => Record<string, (...args: unknown[]) => unknown> }).MetricsEngine();
  const downsampleFn = native.downsample as (points: string, factor: number) => string;

  return {
    createHistogram(name, buckets) {
      engine.createHistogram(name, buckets);
    },
    observeHistogram(name, value) {
      engine.observeHistogram(name, value);
    },
    getHistogramPercentiles(name) {
      return engine.getHistogramPercentiles(name) as PercentileSnapshot | null;
    },
    createCounter(name, windowSeconds, bucketCount) {
      engine.createCounter(name, windowSeconds, bucketCount);
    },
    incrementCounter(name) {
      engine.incrementCounter(name, Date.now());
    },
    getCounterRate(name) {
      return engine.getCounterRate(name, Date.now()) as number;
    },
    getSnapshot() {
      return engine.getSnapshot() as string;
    },
    downsample(pointsJson, factor) {
      return downsampleFn(pointsJson, factor);
    },
  };
}

// ============================================================================
// JS Fallback
// ============================================================================

interface JSHistogram {
  buckets: number[];
  counts: number[];
  samples: number[];
  sum: number;
  count: number;
  maxSamples: number;
}

interface JSCounter {
  bucketDurationMs: number;
  bucketCount: number;
  buckets: number[];
  timestamps: number[];
  head: number;
}

class JSMetricsEngine implements NativeMetricsEngine {
  private histograms = new Map<string, JSHistogram>();
  private counters = new Map<string, JSCounter>();

  createHistogram(name: string, buckets?: number[]): void {
    const b = (buckets ?? [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]).sort((a, c) => a - c);
    this.histograms.set(name, {
      buckets: b,
      counts: new Array(b.length + 1).fill(0),
      samples: [],
      sum: 0,
      count: 0,
      maxSamples: 10_000,
    });
  }

  observeHistogram(name: string, value: number): void {
    const h = this.histograms.get(name);
    if (!h) return;
    h.sum += value;
    h.count++;

    let placed = false;
    for (let i = 0; i < h.buckets.length; i++) {
      if (value <= h.buckets[i]) {
        h.counts[i]++;
        placed = true;
        break;
      }
    }
    if (!placed) h.counts[h.counts.length - 1]++;

    if (h.samples.length < h.maxSamples) {
      h.samples.push(value);
    }
  }

  getHistogramPercentiles(name: string): PercentileSnapshot | null {
    const h = this.histograms.get(name);
    if (!h || h.samples.length === 0) return null;

    h.samples.sort((a, b) => a - b);
    const len = h.samples.length;

    return {
      p50: h.samples[Math.floor(0.5 * len)],
      p95: h.samples[Math.min(Math.floor(0.95 * len), len - 1)],
      p99: h.samples[Math.min(Math.floor(0.99 * len), len - 1)],
      mean: h.count > 0 ? h.sum / h.count : 0,
      count: h.count,
      sum: h.sum,
    };
  }

  createCounter(name: string, windowSeconds: number, bucketCount: number): void {
    const bc = Math.max(bucketCount, 1);
    const bucketDurationMs = (windowSeconds * 1000) / bc;
    this.counters.set(name, {
      bucketDurationMs,
      bucketCount: bc,
      buckets: new Array(bc).fill(0),
      timestamps: new Array(bc).fill(0),
      head: 0,
    });
  }

  incrementCounter(name: string): void {
    const c = this.counters.get(name);
    if (!c) return;
    const now = Date.now();
    this.advanceTo(c, now);
    c.buckets[c.head]++;
  }

  getCounterRate(name: string): number {
    const c = this.counters.get(name);
    if (!c) return 0;
    const now = Date.now();
    this.advanceTo(c, now);

    const windowMs = c.bucketDurationMs * c.bucketCount;
    const cutoff = now - windowMs;
    let total = 0;
    for (let i = 0; i < c.bucketCount; i++) {
      if (c.timestamps[i] >= cutoff) total += c.buckets[i];
    }
    const windowSeconds = windowMs / 1000;
    return windowSeconds > 0 ? total / windowSeconds : 0;
  }

  getSnapshot(): string {
    const result: Record<string, unknown> = {};

    for (const [name] of this.histograms) {
      const p = this.getHistogramPercentiles(name);
      if (p) {
        result[name] = { type: 'histogram', ...p };
      }
    }

    for (const [name] of this.counters) {
      const rate = this.getCounterRate(name);
      result[name] = { type: 'counter', rate };
    }

    return JSON.stringify(result);
  }

  downsample(pointsJson: string, factor: number): string {
    const points = JSON.parse(pointsJson) as number[][];
    const f = Math.max(factor, 1);
    const result: number[][] = [];

    for (let i = 0; i < points.length; i += f) {
      const chunk = points.slice(i, i + f);
      if (chunk.length === 0) continue;
      const cols = chunk[0].length;
      const avg = new Array(cols).fill(0);
      for (const point of chunk) {
        for (let j = 0; j < cols; j++) {
          avg[j] += point[j] ?? 0;
        }
      }
      for (let j = 0; j < cols; j++) {
        avg[j] /= chunk.length;
      }
      result.push(avg);
    }

    return JSON.stringify(result);
  }

  private advanceTo(c: JSCounter, nowMs: number): void {
    const currentTs = c.timestamps[c.head];
    if (currentTs === 0) {
      c.timestamps[c.head] = nowMs;
      return;
    }

    const elapsed = nowMs - currentTs;
    if (elapsed < c.bucketDurationMs) return;

    const bucketsToAdvance = Math.min(Math.floor(elapsed / c.bucketDurationMs), c.bucketCount);
    for (let i = 0; i < bucketsToAdvance; i++) {
      c.head = (c.head + 1) % c.bucketCount;
      c.buckets[c.head] = 0;
      c.timestamps[c.head] = nowMs;
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let cachedEngine: NativeMetricsEngine | null = null;

export function createNativeMetricsEngine(): NativeMetricsEngine {
  if (cachedEngine) return cachedEngine;

  try {
    const esmRequire = createRequire(import.meta.url);
    const native = esmRequire('@claude-fleet/metrics') as Record<string, unknown>;
    cachedEngine = createNativeEngine(native);
    console.log('[metrics] Using native Rust metrics engine');
  } catch {
    cachedEngine = new JSMetricsEngine();
    console.log('[metrics] Rust engine not available, using JS fallback');
  }

  return cachedEngine;
}
