/**
 * Tests for PheromoneStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { PheromoneStorage } from './pheromone.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('PheromoneStorage', () => {
  let ctx: TestStorageContext;
  let pheromone: PheromoneStorage;
  const swarmId = 'swarm-1';

  beforeEach(() => {
    ctx = createTestStorage();
    pheromone = new PheromoneStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // depositTrail()
  // ==========================================================================

  describe('depositTrail()', () => {
    it('should create a trail with default intensity', () => {
      const trail = pheromone.depositTrail({
        swarmId,
        resourceType: 'file',
        resourceId: 'src/index.ts',
        depositorHandle: 'agent-1',
        trailType: 'touch',
      });

      expect(trail.id).toBeDefined();
      expect(trail.swarmId).toBe(swarmId);
      expect(trail.resourceType).toBe('file');
      expect(trail.resourceId).toBe('src/index.ts');
      expect(trail.intensity).toBe(1.0);
      expect(trail.decayedAt).toBeNull();
    });

    it('should create a trail with custom intensity and metadata', () => {
      const trail = pheromone.depositTrail({
        swarmId,
        resourceType: 'task',
        resourceId: 'task-123',
        depositorHandle: 'agent-2',
        trailType: 'complete',
        intensity: 5.0,
        metadata: { duration: 120 },
      });

      expect(trail.intensity).toBe(5.0);
      expect(trail.metadata).toEqual({ duration: 120 });
    });
  });

  // ==========================================================================
  // queryTrails()
  // ==========================================================================

  describe('queryTrails()', () => {
    beforeEach(() => {
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'a.ts', depositorHandle: 'agent-1', trailType: 'touch', intensity: 2.0 });
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'b.ts', depositorHandle: 'agent-2', trailType: 'modify', intensity: 1.0 });
      pheromone.depositTrail({ swarmId: 'other-swarm', resourceType: 'file', resourceId: 'c.ts', depositorHandle: 'agent-3', trailType: 'touch' });
    });

    it('should return trails for a swarm', () => {
      const trails = pheromone.queryTrails(swarmId);
      expect(trails).toHaveLength(2);
    });

    it('should filter by resource type', () => {
      pheromone.depositTrail({ swarmId, resourceType: 'task', resourceId: 't1', depositorHandle: 'agent-1', trailType: 'touch' });

      const trails = pheromone.queryTrails(swarmId, { resourceType: 'task' });
      expect(trails).toHaveLength(1);
      expect(trails[0].resourceId).toBe('t1');
    });

    it('should filter by min intensity', () => {
      const trails = pheromone.queryTrails(swarmId, { minIntensity: 1.5 });
      expect(trails).toHaveLength(1);
      expect(trails[0].intensity).toBeGreaterThanOrEqual(1.5);
    });

    it('should respect limit', () => {
      const trails = pheromone.queryTrails(swarmId, { limit: 1 });
      expect(trails).toHaveLength(1);
    });
  });

  // ==========================================================================
  // getResourceActivity()
  // ==========================================================================

  describe('getResourceActivity()', () => {
    it('should return aggregated activity per resource', () => {
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'x.ts', depositorHandle: 'a1', trailType: 'touch', intensity: 1.0 });
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'x.ts', depositorHandle: 'a2', trailType: 'modify', intensity: 2.0 });

      const activity = pheromone.getResourceActivity(swarmId);
      expect(activity).toHaveLength(1);
      expect(activity[0].resourceId).toBe('x.ts');
      expect(activity[0].totalIntensity).toBe(3.0);
      expect(activity[0].trailCount).toBe(2);
      expect(activity[0].uniqueDepositors).toBe(2);
    });

    it('should filter by resource type', () => {
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'f.ts', depositorHandle: 'a1', trailType: 'touch' });
      pheromone.depositTrail({ swarmId, resourceType: 'task', resourceId: 't1', depositorHandle: 'a1', trailType: 'touch' });

      const activity = pheromone.getResourceActivity(swarmId, 'task');
      expect(activity).toHaveLength(1);
      expect(activity[0].resourceType).toBe('task');
    });
  });

  // ==========================================================================
  // getResourceTrails()
  // ==========================================================================

  describe('getResourceTrails()', () => {
    it('should return trails for a specific resource', () => {
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'target.ts', depositorHandle: 'a1', trailType: 'touch' });
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'other.ts', depositorHandle: 'a1', trailType: 'touch' });

      const trails = pheromone.getResourceTrails(swarmId, 'target.ts');
      expect(trails).toHaveLength(1);
      expect(trails[0].resourceId).toBe('target.ts');
    });
  });

  // ==========================================================================
  // boostTrail()
  // ==========================================================================

  describe('boostTrail()', () => {
    it('should increase trail intensity', () => {
      const trail = pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'boosted.ts', depositorHandle: 'a1', trailType: 'touch', intensity: 2.0 });

      const boosted = pheromone.boostTrail(trail.id, 3.0);
      expect(boosted).not.toBeNull();
      expect(boosted!.intensity).toBe(5.0);
    });

    it('should cap intensity at 10.0', () => {
      const trail = pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'maxed.ts', depositorHandle: 'a1', trailType: 'touch', intensity: 9.0 });

      const boosted = pheromone.boostTrail(trail.id, 5.0);
      expect(boosted!.intensity).toBe(10.0);
    });

    it('should return null for non-existent trail', () => {
      const result = pheromone.boostTrail('nonexistent-id', 1.0);
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getTrailById()
  // ==========================================================================

  describe('getTrailById()', () => {
    it('should retrieve by id', () => {
      const trail = pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'find-me.ts', depositorHandle: 'a1', trailType: 'touch' });

      const found = pheromone.getTrailById(trail.id);
      expect(found).not.toBeNull();
      expect(found!.resourceId).toBe('find-me.ts');
    });

    it('should return null for missing id', () => {
      const result = pheromone.getTrailById('no-such-id');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // processDecay()
  // ==========================================================================

  describe('processDecay()', () => {
    it('should decay trails and return counts', () => {
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'decaying.ts', depositorHandle: 'a1', trailType: 'touch', intensity: 0.5 });

      const result = pheromone.processDecay(swarmId, 0.1, 0.01);
      expect(result.decayed).toBeGreaterThanOrEqual(0);
      expect(typeof result.removed).toBe('number');
    });
  });

  // ==========================================================================
  // purgeDecayed()
  // ==========================================================================

  describe('purgeDecayed()', () => {
    it('should remove decayed trails', () => {
      const trail = pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'old.ts', depositorHandle: 'a1', trailType: 'touch', intensity: 0.001 });

      // Manually mark as decayed
      const db = ctx.storage.getDatabase();
      db.prepare('UPDATE pheromone_trails SET decayed_at = ? WHERE id = ?').run(Date.now(), trail.id);

      const purged = pheromone.purgeDecayed(swarmId);
      expect(purged).toBe(1);
    });

    it('should return 0 when nothing to purge', () => {
      const purged = pheromone.purgeDecayed(swarmId);
      expect(purged).toBe(0);
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return trail counts and stats', () => {
      pheromone.depositTrail({ swarmId, resourceType: 'file', resourceId: 'a.ts', depositorHandle: 'a1', trailType: 'touch', intensity: 2.0 });
      pheromone.depositTrail({ swarmId, resourceType: 'task', resourceId: 't1', depositorHandle: 'a2', trailType: 'modify', intensity: 3.0 });

      const stats = pheromone.getStats(swarmId);
      expect(stats.activeTrails).toBe(2);
      expect(stats.decayedTrails).toBe(0);
      expect(stats.totalIntensity).toBe(5.0);
      expect(stats.byType.touch).toBe(1);
      expect(stats.byType.modify).toBe(1);
      expect(stats.byResource.file).toBe(1);
      expect(stats.byResource.task).toBe(1);
    });

    it('should return zeros for empty swarm', () => {
      const stats = pheromone.getStats('empty-swarm');
      expect(stats.activeTrails).toBe(0);
      expect(stats.totalIntensity).toBe(0);
    });
  });
});
