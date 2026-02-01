/**
 * Tests for ConsensusStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { ConsensusStorage } from './consensus.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('ConsensusStorage', () => {
  let ctx: TestStorageContext;
  let consensus: ConsensusStorage;
  const swarmId = 'swarm-1';

  beforeEach(() => {
    ctx = createTestStorage();
    consensus = new ConsensusStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // createProposal()
  // ==========================================================================

  describe('createProposal()', () => {
    it('should create a proposal with defaults', () => {
      const proposal = consensus.createProposal({
        swarmId,
        proposerHandle: 'lead',
        proposalType: 'decision',
        title: 'Use TypeScript?',
        options: ['yes', 'no'],
      });

      expect(proposal.id).toBeDefined();
      expect(proposal.title).toBe('Use TypeScript?');
      expect(proposal.options).toEqual(['yes', 'no']);
      expect(proposal.votingMethod).toBe('majority');
      expect(proposal.quorumType).toBe('percentage');
      expect(proposal.quorumValue).toBe(0.5);
      expect(proposal.status).toBe('open');
      expect(proposal.result).toBeNull();
    });

    it('should create with custom voting method', () => {
      const proposal = consensus.createProposal({
        swarmId,
        proposerHandle: 'lead',
        proposalType: 'approval',
        title: 'Deploy to prod?',
        options: ['approve', 'reject'],
        votingMethod: 'supermajority',
        quorumType: 'absolute',
        quorumValue: 3,
      });

      expect(proposal.votingMethod).toBe('supermajority');
      expect(proposal.quorumType).toBe('absolute');
      expect(proposal.quorumValue).toBe(3);
    });
  });

  // ==========================================================================
  // getProposal()
  // ==========================================================================

  describe('getProposal()', () => {
    it('should retrieve by id', () => {
      const created = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Test', options: ['a', 'b'] });
      const retrieved = consensus.getProposal(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('Test');
    });

    it('should return null for missing proposal', () => {
      const result = consensus.getProposal('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // listProposals()
  // ==========================================================================

  describe('listProposals()', () => {
    beforeEach(() => {
      consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'P1', options: ['a', 'b'] });
      consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'election', title: 'P2', options: ['x', 'y'] });
      consensus.createProposal({ swarmId: 'other', proposerHandle: 'lead', proposalType: 'decision', title: 'P3', options: ['a', 'b'] });
    });

    it('should return proposals for a swarm', () => {
      const proposals = consensus.listProposals(swarmId);
      expect(proposals).toHaveLength(2);
    });

    it('should filter by status', () => {
      const proposals = consensus.listProposals(swarmId, { status: 'open' });
      expect(proposals).toHaveLength(2);
    });

    it('should filter by proposal type', () => {
      const proposals = consensus.listProposals(swarmId, { proposalType: 'election' });
      expect(proposals).toHaveLength(1);
      expect(proposals[0].title).toBe('P2');
    });
  });

  // ==========================================================================
  // cancelProposal()
  // ==========================================================================

  describe('cancelProposal()', () => {
    it('should cancel an open proposal by the proposer', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Cancel Me', options: ['a', 'b'] });

      const cancelled = consensus.cancelProposal(proposal.id, 'lead');
      expect(cancelled).toBe(true);

      const retrieved = consensus.getProposal(proposal.id);
      expect(retrieved!.status).toBe('cancelled');
    });

    it('should fail when not the proposer', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Protected', options: ['a', 'b'] });

      const result = consensus.cancelProposal(proposal.id, 'other-agent');
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // castVote()
  // ==========================================================================

  describe('castVote()', () => {
    it('should cast a vote on an open proposal', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Vote', options: ['yes', 'no'] });

      const vote = consensus.castVote({
        proposalId: proposal.id,
        voterHandle: 'agent-1',
        voteValue: 'yes',
      });

      expect(vote).not.toBeNull();
      expect(vote!.voteValue).toBe('yes');
      expect(vote!.voteWeight).toBe(1.0);
    });

    it('should reject invalid vote value', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Vote', options: ['yes', 'no'] });

      const vote = consensus.castVote({
        proposalId: proposal.id,
        voterHandle: 'agent-1',
        voteValue: 'maybe',
      });

      expect(vote).toBeNull();
    });

    it('should update vote on re-vote (upsert)', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Vote', options: ['yes', 'no'] });

      consensus.castVote({ proposalId: proposal.id, voterHandle: 'agent-1', voteValue: 'yes' });
      const updated = consensus.castVote({ proposalId: proposal.id, voterHandle: 'agent-1', voteValue: 'no' });

      expect(updated!.voteValue).toBe('no');

      // Should still be only one vote
      const votes = consensus.getVotes(proposal.id);
      expect(votes).toHaveLength(1);
    });

    it('should reject vote on closed proposal', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Closed', options: ['a', 'b'] });
      consensus.cancelProposal(proposal.id, 'lead');

      const vote = consensus.castVote({ proposalId: proposal.id, voterHandle: 'agent-1', voteValue: 'a' });
      expect(vote).toBeNull();
    });

    it('should reject vote past deadline', () => {
      const proposal = consensus.createProposal({
        swarmId,
        proposerHandle: 'lead',
        proposalType: 'decision',
        title: 'Expired',
        options: ['a', 'b'],
        deadline: Date.now() - 10000,
      });

      const vote = consensus.castVote({ proposalId: proposal.id, voterHandle: 'agent-1', voteValue: 'a' });
      expect(vote).toBeNull();
    });
  });

  // ==========================================================================
  // getVotes() / hasVoted()
  // ==========================================================================

  describe('getVotes() and hasVoted()', () => {
    it('should return all votes for a proposal', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Vote', options: ['a', 'b'] });
      consensus.castVote({ proposalId: proposal.id, voterHandle: 'a1', voteValue: 'a' });
      consensus.castVote({ proposalId: proposal.id, voterHandle: 'a2', voteValue: 'b' });

      const votes = consensus.getVotes(proposal.id);
      expect(votes).toHaveLength(2);
    });

    it('should check if agent has voted', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'Vote', options: ['a', 'b'] });
      consensus.castVote({ proposalId: proposal.id, voterHandle: 'a1', voteValue: 'a' });

      expect(consensus.hasVoted(proposal.id, 'a1')).toBe(true);
      expect(consensus.hasVoted(proposal.id, 'a2')).toBe(false);
    });
  });

  // ==========================================================================
  // closeAndTally()
  // ==========================================================================

  describe('closeAndTally()', () => {
    it('should close proposal and tally votes', () => {
      const proposal = consensus.createProposal({
        swarmId,
        proposerHandle: 'lead',
        proposalType: 'decision',
        title: 'Tally Test',
        options: ['yes', 'no'],
        quorumType: 'percentage',
      });

      consensus.castVote({ proposalId: proposal.id, voterHandle: 'a1', voteValue: 'yes' });
      consensus.castVote({ proposalId: proposal.id, voterHandle: 'a2', voteValue: 'yes' });
      consensus.castVote({ proposalId: proposal.id, voterHandle: 'a3', voteValue: 'no' });

      const result = consensus.closeAndTally(proposal.id);

      expect(result).not.toBeNull();
      expect(result!.totalVotes).toBe(3);
      expect(result!.tally.yes).toBe(2);
      expect(result!.tally.no).toBe(1);
      expect(result!.winner).toBe('yes');

      // Proposal should now be closed
      const closed = consensus.getProposal(proposal.id);
      expect(closed!.status).not.toBe('open');
    });

    it('should return null for non-open proposal', () => {
      const proposal = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'X', options: ['a', 'b'] });
      consensus.cancelProposal(proposal.id, 'lead');

      const result = consensus.closeAndTally(proposal.id);
      expect(result).toBeNull();
    });

    it('should handle no votes', () => {
      const proposal = consensus.createProposal({
        swarmId,
        proposerHandle: 'lead',
        proposalType: 'decision',
        title: 'Empty',
        options: ['a', 'b'],
        quorumType: 'percentage',
      });

      const result = consensus.closeAndTally(proposal.id);

      expect(result).not.toBeNull();
      expect(result!.totalVotes).toBe(0);
      expect(result!.quorumMet).toBe(false);
    });
  });

  // ==========================================================================
  // closeExpiredProposals()
  // ==========================================================================

  describe('closeExpiredProposals()', () => {
    it('should close proposals past their deadline', () => {
      consensus.createProposal({
        swarmId,
        proposerHandle: 'lead',
        proposalType: 'decision',
        title: 'Expired',
        options: ['a', 'b'],
        deadline: Date.now() - 10000,
        quorumType: 'percentage',
      });

      const closed = consensus.closeExpiredProposals(swarmId);
      expect(closed).toBe(1);
    });

    it('should not close non-expired proposals', () => {
      consensus.createProposal({
        swarmId,
        proposerHandle: 'lead',
        proposalType: 'decision',
        title: 'Still Open',
        options: ['a', 'b'],
        deadline: Date.now() + 100000,
      });

      const closed = consensus.closeExpiredProposals(swarmId);
      expect(closed).toBe(0);
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return proposal and vote counts', () => {
      const p1 = consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'decision', title: 'P1', options: ['a', 'b'], quorumType: 'percentage' });
      consensus.createProposal({ swarmId, proposerHandle: 'lead', proposalType: 'election', title: 'P2', options: ['x', 'y'] });

      consensus.castVote({ proposalId: p1.id, voterHandle: 'a1', voteValue: 'a' });
      consensus.castVote({ proposalId: p1.id, voterHandle: 'a2', voteValue: 'b' });

      consensus.closeAndTally(p1.id);

      const stats = consensus.getStats(swarmId);
      expect(stats.totalProposals).toBe(2);
      expect(stats.openProposals).toBe(1);
      expect(stats.totalVotes).toBe(2);
      expect(stats.byType.decision).toBe(1);
      expect(stats.byType.election).toBe(1);
    });
  });
});
