/**
 * Tests for BeliefStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { BeliefStorage } from './beliefs.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('BeliefStorage', () => {
  let ctx: TestStorageContext;
  let beliefs: BeliefStorage;
  const swarmId = 'swarm-1';

  beforeEach(() => {
    ctx = createTestStorage();
    beliefs = new BeliefStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // upsertBelief()
  // ==========================================================================

  describe('upsertBelief()', () => {
    it('should create a new belief', () => {
      const belief = beliefs.upsertBelief({
        swarmId,
        agentHandle: 'agent-1',
        beliefType: 'knowledge',
        subject: 'db-type',
        beliefValue: 'PostgreSQL',
        confidence: 0.9,
      });

      expect(belief.id).toBeDefined();
      expect(belief.beliefType).toBe('knowledge');
      expect(belief.subject).toBe('db-type');
      expect(belief.beliefValue).toBe('PostgreSQL');
      expect(belief.confidence).toBe(0.9);
    });

    it('should update existing belief on same subject', () => {
      beliefs.upsertBelief({
        swarmId,
        agentHandle: 'agent-1',
        beliefType: 'assumption',
        subject: 'framework',
        beliefValue: 'Express',
      });

      const updated = beliefs.upsertBelief({
        swarmId,
        agentHandle: 'agent-1',
        beliefType: 'knowledge',
        subject: 'framework',
        beliefValue: 'Fastify',
        confidence: 0.95,
      });

      expect(updated.beliefValue).toBe('Fastify');
      expect(updated.confidence).toBe(0.95);
    });

    it('should use default confidence 0.5 and source type direct', () => {
      const belief = beliefs.upsertBelief({
        swarmId,
        agentHandle: 'agent-1',
        beliefType: 'observation',
        subject: 'test-subject',
        beliefValue: 'test-value',
      });

      expect(belief.confidence).toBe(0.5);
    });
  });

  // ==========================================================================
  // getBeliefs()
  // ==========================================================================

  describe('getBeliefs()', () => {
    beforeEach(() => {
      beliefs.upsertBelief({ swarmId, agentHandle: 'agent-1', beliefType: 'knowledge', subject: 's1', beliefValue: 'v1', confidence: 0.9 });
      beliefs.upsertBelief({ swarmId, agentHandle: 'agent-1', beliefType: 'assumption', subject: 's2', beliefValue: 'v2', confidence: 0.4 });
      beliefs.upsertBelief({ swarmId, agentHandle: 'agent-1', beliefType: 'knowledge', subject: 's3', beliefValue: 'v3', confidence: 0.7 });
    });

    it('should return all beliefs for an agent', () => {
      const result = beliefs.getBeliefs(swarmId, 'agent-1');
      expect(result).toHaveLength(3);
    });

    it('should filter by belief type', () => {
      const result = beliefs.getBeliefs(swarmId, 'agent-1', { beliefType: 'knowledge' });
      expect(result).toHaveLength(2);
    });

    it('should filter by subject', () => {
      const result = beliefs.getBeliefs(swarmId, 'agent-1', { subject: 's1' });
      expect(result).toHaveLength(1);
      expect(result[0].beliefValue).toBe('v1');
    });

    it('should filter by min confidence', () => {
      const result = beliefs.getBeliefs(swarmId, 'agent-1', { minConfidence: 0.5 });
      expect(result).toHaveLength(2);
    });

    it('should filter out expired beliefs by default', () => {
      beliefs.upsertBelief({
        swarmId,
        agentHandle: 'agent-1',
        beliefType: 'knowledge',
        subject: 'expired-subj',
        beliefValue: 'stale',
        validUntil: Date.now() - 10000,
      });

      const result = beliefs.getBeliefs(swarmId, 'agent-1');
      const expiredFound = result.find(b => b.subject === 'expired-subj');
      expect(expiredFound).toBeUndefined();
    });

    it('should include expired beliefs when requested', () => {
      beliefs.upsertBelief({
        swarmId,
        agentHandle: 'agent-1',
        beliefType: 'knowledge',
        subject: 'expired-subj',
        beliefValue: 'stale',
        validUntil: Date.now() - 10000,
      });

      const result = beliefs.getBeliefs(swarmId, 'agent-1', { includeExpired: true });
      const expiredFound = result.find(b => b.subject === 'expired-subj');
      expect(expiredFound).toBeDefined();
    });
  });

  // ==========================================================================
  // getBelief()
  // ==========================================================================

  describe('getBelief()', () => {
    it('should retrieve a single belief by subject', () => {
      beliefs.upsertBelief({ swarmId, agentHandle: 'agent-1', beliefType: 'knowledge', subject: 'target', beliefValue: 'found' });

      const result = beliefs.getBelief(swarmId, 'agent-1', 'target');
      expect(result).not.toBeNull();
      expect(result!.beliefValue).toBe('found');
    });

    it('should return null for missing belief', () => {
      const result = beliefs.getBelief(swarmId, 'agent-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // deleteBelief()
  // ==========================================================================

  describe('deleteBelief()', () => {
    it('should delete a belief and return true', () => {
      beliefs.upsertBelief({ swarmId, agentHandle: 'agent-1', beliefType: 'knowledge', subject: 'deleteme', beliefValue: 'v' });

      const deleted = beliefs.deleteBelief(swarmId, 'agent-1', 'deleteme');
      expect(deleted).toBe(true);

      const result = beliefs.getBelief(swarmId, 'agent-1', 'deleteme');
      expect(result).toBeNull();
    });

    it('should return false when nothing to delete', () => {
      const deleted = beliefs.deleteBelief(swarmId, 'agent-1', 'nonexistent');
      expect(deleted).toBe(false);
    });
  });

  // ==========================================================================
  // getSwarmConsensus()
  // ==========================================================================

  describe('getSwarmConsensus()', () => {
    it('should find consensus value and agreement level', () => {
      beliefs.upsertBelief({ swarmId, agentHandle: 'a1', beliefType: 'knowledge', subject: 'lang', beliefValue: 'TypeScript', confidence: 0.9 });
      beliefs.upsertBelief({ swarmId, agentHandle: 'a2', beliefType: 'knowledge', subject: 'lang', beliefValue: 'TypeScript', confidence: 0.8 });
      beliefs.upsertBelief({ swarmId, agentHandle: 'a3', beliefType: 'knowledge', subject: 'lang', beliefValue: 'Python', confidence: 0.6 });

      const consensus = beliefs.getSwarmConsensus(swarmId, 'lang');

      expect(consensus.subject).toBe('lang');
      expect(consensus.consensusValue).toBe('TypeScript');
      expect(consensus.agreementLevel).toBeGreaterThan(0.5);
      expect(consensus.beliefs).toHaveLength(3);
    });

    it('should return null consensus with no beliefs', () => {
      const consensus = beliefs.getSwarmConsensus(swarmId, 'no-subject');

      expect(consensus.consensusValue).toBeNull();
      expect(consensus.agreementLevel).toBe(0);
      expect(consensus.beliefs).toEqual([]);
    });
  });

  // ==========================================================================
  // Meta-beliefs
  // ==========================================================================

  describe('meta-beliefs', () => {
    it('should upsert a meta-belief', () => {
      const meta = beliefs.upsertMetaBelief({
        swarmId,
        agentHandle: 'a1',
        aboutHandle: 'a2',
        metaType: 'reliability',
        beliefValue: 'high',
        confidence: 0.8,
      });

      expect(meta.agentHandle).toBe('a1');
      expect(meta.aboutHandle).toBe('a2');
      expect(meta.metaType).toBe('reliability');
      expect(meta.evidenceCount).toBe(1);
    });

    it('should increment evidence count on update', () => {
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'a2', metaType: 'reliability', beliefValue: 'high', confidence: 0.8 });
      const updated = beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'a2', metaType: 'reliability', beliefValue: 'very high', confidence: 0.9 });

      expect(updated.evidenceCount).toBe(2);
    });

    it('should get meta-beliefs for an agent', () => {
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'a2', metaType: 'reliability', beliefValue: 'high' });
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'a3', metaType: 'capability', beliefValue: 'expert' });

      const metas = beliefs.getMetaBeliefs(swarmId, 'a1');
      expect(metas).toHaveLength(2);
    });

    it('should filter meta-beliefs by aboutHandle', () => {
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'a2', metaType: 'reliability', beliefValue: 'high' });
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'a3', metaType: 'reliability', beliefValue: 'low' });

      const metas = beliefs.getMetaBeliefs(swarmId, 'a1', 'a2');
      expect(metas).toHaveLength(1);
    });

    it('should get meta-beliefs about a specific agent', () => {
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'target', metaType: 'reliability', beliefValue: 'ok' });
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a2', aboutHandle: 'target', metaType: 'capability', beliefValue: 'good' });

      const about = beliefs.getMetaBeliefsAbout(swarmId, 'target');
      expect(about).toHaveLength(2);
    });
  });

  // ==========================================================================
  // getAgentReputation()
  // ==========================================================================

  describe('getAgentReputation()', () => {
    it('should calculate reputation from meta-beliefs', () => {
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'target', metaType: 'reliability', beliefValue: 'good', confidence: 0.9 });
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a2', aboutHandle: 'target', metaType: 'capability', beliefValue: 'expert', confidence: 0.8 });

      const rep = beliefs.getAgentReputation(swarmId, 'target');
      expect(rep.avgReliability).toBe(0.9);
      expect(rep.avgCapability).toBe(0.8);
      expect(rep.raters).toBe(2);
    });

    it('should return defaults for unknown agent', () => {
      const rep = beliefs.getAgentReputation(swarmId, 'unknown');
      expect(rep.avgReliability).toBe(0.5);
      expect(rep.avgCapability).toBe(0.5);
      expect(rep.raters).toBe(0);
    });
  });

  // ==========================================================================
  // expireBeliefs()
  // ==========================================================================

  describe('expireBeliefs()', () => {
    it('should delete expired beliefs', () => {
      beliefs.upsertBelief({ swarmId, agentHandle: 'a1', beliefType: 'knowledge', subject: 'old', beliefValue: 'v', validUntil: Date.now() - 10000 });
      beliefs.upsertBelief({ swarmId, agentHandle: 'a1', beliefType: 'knowledge', subject: 'fresh', beliefValue: 'v', validUntil: Date.now() + 100000 });

      const expired = beliefs.expireBeliefs(swarmId);
      expect(expired).toBe(1);

      const remaining = beliefs.getBeliefs(swarmId, 'a1', { includeExpired: true });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].subject).toBe('fresh');
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return belief counts and averages', () => {
      beliefs.upsertBelief({ swarmId, agentHandle: 'a1', beliefType: 'knowledge', subject: 's1', beliefValue: 'v', confidence: 0.8 });
      beliefs.upsertBelief({ swarmId, agentHandle: 'a2', beliefType: 'assumption', subject: 's2', beliefValue: 'v', confidence: 0.6 });
      beliefs.upsertMetaBelief({ swarmId, agentHandle: 'a1', aboutHandle: 'a2', metaType: 'reliability', beliefValue: 'ok' });

      const stats = beliefs.getStats(swarmId);
      expect(stats.totalBeliefs).toBe(2);
      expect(stats.totalMetaBeliefs).toBe(1);
      expect(stats.uniqueAgents).toBe(2);
      expect(stats.uniqueSubjects).toBe(2);
      expect(stats.byType.knowledge).toBe(1);
      expect(stats.byType.assumption).toBe(1);
      expect(stats.avgConfidence).toBe(0.7);
    });
  });
});
