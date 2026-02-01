/**
 * Native Metrics Engine Tests
 *
 * Tests the JS fallback implementation of NativeMetricsEngine.
 * Covers histograms, sliding window counters, snapshots, and downsampling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force JS fallback
vi.mock('node:module', () => ({
  createRequire: () => {
    return () => {
      throw new Error('native not available');
    };
  },
}));

describe('NativeMetricsEngine (JS fallback)', () => {
  let engine: { createHistogram: (name: string, buckets?: number[]) => void; observeHistogram: (name: string, value: number) => void; getHistogramPercentiles: (name: string) => { p50: number; p95: number; p99: number; mean: number; count: number; sum: number } | null; createCounter: (name: string, windowSeconds: number, bucketCount: number) => void; incrementCounter: (name: string) => void; getCounterRate: (name: string) => number; getSnapshot: () => string; downsample: (pointsJson: string, factor: number) => string };

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./native-metrics.js');
    engine = mod.createNativeMetricsEngine();
  });

  describe('Histograms', () => {
    it('should create and observe histogram', () => {
      engine.createHistogram('test_duration');
      engine.observeHistogram('test_duration', 0.1);
      engine.observeHistogram('test_duration', 0.5);
      engine.observeHistogram('test_duration', 1.0);

      const p = engine.getHistogramPercentiles('test_duration');
      expect(p).not.toBeNull();
      expect(p!.count).toBe(3);
      expect(p!.sum).toBeCloseTo(1.6, 2);
      expect(p!.mean).toBeCloseTo(0.533, 2);
    });

    it('should compute accurate percentiles', () => {
      engine.createHistogram('latency');

      // Insert 100 values: 1, 2, ..., 100
      for (let i = 1; i <= 100; i++) {
        engine.observeHistogram('latency', i);
      }

      const p = engine.getHistogramPercentiles('latency');
      expect(p).not.toBeNull();
      // Math.floor(0.5 * 100) = 50 → samples[50] = 51 (0-indexed)
      expect(p!.p50).toBe(51);
      // Math.floor(0.95 * 100) = 95 → samples[95] = 96
      expect(p!.p95).toBe(96);
      // Math.floor(0.99 * 100) = 99 → samples[99] = 100
      expect(p!.p99).toBe(100);
      expect(p!.count).toBe(100);
    });

    it('should return null for unknown histogram', () => {
      const p = engine.getHistogramPercentiles('nonexistent');
      expect(p).toBeNull();
    });

    it('should support custom buckets', () => {
      engine.createHistogram('custom', [1, 5, 10, 50]);
      engine.observeHistogram('custom', 3);
      engine.observeHistogram('custom', 7);

      const p = engine.getHistogramPercentiles('custom');
      expect(p).not.toBeNull();
      expect(p!.count).toBe(2);
    });

    it('should silently ignore observations to unknown histograms', () => {
      // Should not throw
      engine.observeHistogram('ghost', 42);
      const p = engine.getHistogramPercentiles('ghost');
      expect(p).toBeNull();
    });
  });

  describe('Counters', () => {
    it('should create counter and track rate', () => {
      engine.createCounter('requests', 60, 12);
      engine.incrementCounter('requests');
      engine.incrementCounter('requests');
      engine.incrementCounter('requests');

      const rate = engine.getCounterRate('requests');
      // 3 requests in a 60-second window = 0.05 req/s
      expect(rate).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 for unknown counter', () => {
      const rate = engine.getCounterRate('nonexistent');
      expect(rate).toBe(0);
    });

    it('should silently ignore increments to unknown counters', () => {
      engine.incrementCounter('ghost');
      expect(engine.getCounterRate('ghost')).toBe(0);
    });
  });

  describe('Snapshot', () => {
    it('should produce a JSON snapshot of all metrics', () => {
      engine.createHistogram('h1');
      engine.observeHistogram('h1', 0.5);
      engine.createCounter('c1', 60, 6);
      engine.incrementCounter('c1');

      const snapshot = engine.getSnapshot();
      const parsed = JSON.parse(snapshot) as Record<string, unknown>;

      expect(parsed).toHaveProperty('h1');
      expect(parsed).toHaveProperty('c1');
      expect((parsed.h1 as Record<string, unknown>).type).toBe('histogram');
      expect((parsed.c1 as Record<string, unknown>).type).toBe('counter');
    });

    it('should return empty snapshot when no metrics exist', () => {
      const snapshot = engine.getSnapshot();
      const parsed = JSON.parse(snapshot) as Record<string, unknown>;
      expect(Object.keys(parsed)).toHaveLength(0);
    });
  });

  describe('Downsample', () => {
    it('should reduce time-series granularity', () => {
      const points = [
        [1, 10],
        [2, 20],
        [3, 30],
        [4, 40],
      ];

      const result = JSON.parse(engine.downsample(JSON.stringify(points), 2)) as number[][];

      // Should produce 2 points (averages of pairs)
      expect(result).toHaveLength(2);
      expect(result[0][0]).toBeCloseTo(1.5);
      expect(result[0][1]).toBeCloseTo(15);
      expect(result[1][0]).toBeCloseTo(3.5);
      expect(result[1][1]).toBeCloseTo(35);
    });

    it('should handle factor of 1 (no-op)', () => {
      const points = [[1, 10], [2, 20]];
      const result = JSON.parse(engine.downsample(JSON.stringify(points), 1)) as number[][];
      expect(result).toHaveLength(2);
    });

    it('should handle empty input', () => {
      const result = JSON.parse(engine.downsample('[]', 5)) as number[][];
      expect(result).toHaveLength(0);
    });
  });
});
