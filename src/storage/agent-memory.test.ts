/**
 * Tests for AgentMemory storage layer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { AgentMemory } from './agent-memory.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('AgentMemory', () => {
  let ctx: TestStorageContext;
  let memory: AgentMemory;
  const agentId = 'agent-1';

  beforeEach(() => {
    ctx = createTestStorage();
    memory = new AgentMemory(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // store()
  // ==========================================================================

  describe('store()', () => {
    it('should store a memory and return the entry', () => {
      const result = memory.store(agentId, 'api-pattern', 'REST with versioning');

      expect(result.id).toBeDefined();
      expect(result.agentId).toBe(agentId);
      expect(result.key).toBe('api-pattern');
      expect(result.value).toBe('REST with versioning');
      expect(result.memoryType).toBe('fact');
      expect(result.relevance).toBe(1.0);
      expect(result.accessCount).toBe(0);
      expect(result.tags).toEqual([]);
    });

    it('should update existing memory with same key', () => {
      memory.store(agentId, 'db-type', 'MySQL');
      const updated = memory.store(agentId, 'db-type', 'PostgreSQL');

      expect(updated.value).toBe('PostgreSQL');

      // Only one memory should exist for this key
      const recalled = memory.recall(agentId, 'db-type');
      expect(recalled).not.toBeNull();
      expect(recalled!.value).toBe('PostgreSQL');
    });

    it('should store with custom tags, type, and relevance', () => {
      const result = memory.store(agentId, 'deploy-error', 'OOM on staging', {
        tags: ['deploy', 'staging', 'oom'],
        memoryType: 'error',
        relevance: 0.8,
      });

      expect(result.tags).toEqual(['deploy', 'staging', 'oom']);
      expect(result.memoryType).toBe('error');
      expect(result.relevance).toBe(0.8);
    });

    it('should use default options when none provided', () => {
      const result = memory.store(agentId, 'key1', 'value1');

      expect(result.memoryType).toBe('fact');
      expect(result.relevance).toBe(1.0);
      expect(result.tags).toEqual([]);
    });
  });

  // ==========================================================================
  // recall()
  // ==========================================================================

  describe('recall()', () => {
    it('should recall a stored memory by key', () => {
      memory.store(agentId, 'framework', 'Express.js');
      const result = memory.recall(agentId, 'framework');

      expect(result).not.toBeNull();
      expect(result!.key).toBe('framework');
      expect(result!.value).toBe('Express.js');
    });

    it('should return null for missing key', () => {
      const result = memory.recall(agentId, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should bump access count on recall', () => {
      memory.store(agentId, 'fact-1', 'some fact');

      // Recall twice
      memory.recall(agentId, 'fact-1');
      const second = memory.recall(agentId, 'fact-1');

      // Access count should have increased (at least 1 from the first recall)
      expect(second!.accessCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // search()
  // ==========================================================================

  describe('search()', () => {
    beforeEach(() => {
      memory.store(agentId, 'auth-pattern', 'JWT with refresh tokens', {
        memoryType: 'pattern',
        relevance: 0.9,
      });
      memory.store(agentId, 'auth-error', 'Token expiry caused 401', {
        memoryType: 'error',
        relevance: 0.7,
      });
      memory.store(agentId, 'db-decision', 'Use Postgres for ACID', {
        memoryType: 'decision',
        relevance: 0.5,
      });
    });

    it('should search by query text', () => {
      const results = memory.search(agentId, 'auth');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by memoryType', () => {
      const results = memory.search(agentId, 'auth', { memoryType: 'error' });

      for (const entry of results) {
        expect(entry.memoryType).toBe('error');
      }
    });

    it('should filter by minRelevance', () => {
      const results = memory.search(agentId, 'auth', { minRelevance: 0.8 });

      for (const entry of results) {
        expect(entry.relevance).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('should respect limit', () => {
      const results = memory.search(agentId, 'auth', { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  // ==========================================================================
  // getAll()
  // ==========================================================================

  describe('getAll()', () => {
    it('should return all memories for an agent', () => {
      memory.store(agentId, 'k1', 'v1');
      memory.store(agentId, 'k2', 'v2');
      memory.store(agentId, 'k3', 'v3');

      const all = memory.getAll(agentId);
      expect(all).toHaveLength(3);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        memory.store(agentId, `key-${i}`, `value-${i}`);
      }

      const limited = memory.getAll(agentId, 5);
      expect(limited).toHaveLength(5);
    });

    it('should return empty array for unknown agent', () => {
      const result = memory.getAll('unknown-agent');
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // delete()
  // ==========================================================================

  describe('delete()', () => {
    it('should delete a memory by id', () => {
      const stored = memory.store(agentId, 'temp', 'temporary data');
      memory.delete(stored.id);

      const recalled = memory.recall(agentId, 'temp');
      expect(recalled).toBeNull();
    });
  });

  // ==========================================================================
  // applyDecay()
  // ==========================================================================

  describe('applyDecay()', () => {
    it('should decay old memories', () => {
      // Store a memory, then manually backdate its last_accessed
      const entry = memory.store(agentId, 'old-fact', 'some old fact', {
        relevance: 1.0,
      });

      // Backdate last_accessed to 30 days ago
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const db = ctx.storage.getDatabase();
      db.prepare('UPDATE agent_memory_content SET last_accessed = ? WHERE id = ?').run(
        thirtyDaysAgo,
        entry.id
      );

      const result = memory.applyDecay(agentId);
      // Should have either decayed or pruned
      expect(result.decayed + result.pruned).toBeGreaterThanOrEqual(1);
    });

    it('should prune memories below 0.01 relevance', () => {
      const entry = memory.store(agentId, 'forgotten', 'irrelevant', {
        relevance: 0.02,
      });

      // Backdate to force heavy decay
      const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const db = ctx.storage.getDatabase();
      db.prepare('UPDATE agent_memory_content SET last_accessed = ? WHERE id = ?').run(
        longAgo,
        entry.id
      );

      const result = memory.applyDecay(agentId);
      expect(result.pruned).toBeGreaterThanOrEqual(1);

      // Memory should be gone
      const recalled = memory.recall(agentId, 'forgotten');
      expect(recalled).toBeNull();
    });

    it('should skip recently accessed memories', () => {
      memory.store(agentId, 'fresh', 'just accessed');

      const result = memory.applyDecay(agentId);
      expect(result.decayed).toBe(0);
      expect(result.pruned).toBe(0);
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return correct counts by type', () => {
      memory.store(agentId, 'f1', 'fact1', { memoryType: 'fact' });
      memory.store(agentId, 'f2', 'fact2', { memoryType: 'fact' });
      memory.store(agentId, 'd1', 'decision', { memoryType: 'decision' });
      memory.store(agentId, 'p1', 'pattern', { memoryType: 'pattern' });

      const stats = memory.getStats(agentId);

      expect(stats.totalMemories).toBe(4);
      expect(stats.byType.fact).toBe(2);
      expect(stats.byType.decision).toBe(1);
      expect(stats.byType.pattern).toBe(1);
      expect(stats.byType.error).toBe(0);
    });

    it('should return avgRelevance and totalAccessCount', () => {
      memory.store(agentId, 'a', 'v', { relevance: 0.6 });
      memory.store(agentId, 'b', 'v', { relevance: 1.0 });

      const stats = memory.getStats(agentId);
      expect(stats.avgRelevance).toBe(0.8);
      expect(stats.totalAccessCount).toBe(0);
    });

    it('should return zeros for unknown agent', () => {
      const stats = memory.getStats('no-such-agent');

      expect(stats.totalMemories).toBe(0);
      expect(stats.avgRelevance).toBe(0);
      expect(stats.totalAccessCount).toBe(0);
    });
  });
});
