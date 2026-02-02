/**
 * API Client — Swarm Intelligence Endpoints
 * Pheromone trails, beliefs, credits, consensus proposals, bidding, and payoffs.
 * Extracted from api.ts to keep files under 500 lines.
 */

import type {
  PheromoneTrail,
  HotResource,
  PheromoneStats,
  Belief,
  BeliefStats,
  CreditAccount,
  CreditStats,
  Consensus,
  ConsensusStats,
  Proposal,
  Bid,
  BiddingStats,
} from '@/types';
import { getUser, request } from './api';

// ---------------------------------------------------------------------------
// Pheromones
// ---------------------------------------------------------------------------

export interface PheromoneQueryOptions {
  resourceType?: string;
  trailType?: string;
  limit?: number;
}

export async function getPheromones(swarmId: string, options: PheromoneQueryOptions = {}): Promise<PheromoneTrail[]> {
  const params = new URLSearchParams();
  if (options.resourceType) params.set('resourceType', options.resourceType);
  if (options.trailType) params.set('trailType', options.trailType);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString() ? `?${params}` : '';
  return request<PheromoneTrail[]>(`/pheromones/${encodeURIComponent(swarmId)}${query}`);
}

export async function depositPheromone(
  swarmId: string,
  resourceId: string,
  resourceType: string,
  trailType: string,
  intensity = 1.0,
  metadata: Record<string, unknown> = {},
): Promise<PheromoneTrail> {
  const user = getUser();
  return request<PheromoneTrail>('/pheromones', {
    method: 'POST',
    body: JSON.stringify({
      swarmId,
      depositorHandle: user?.handle ?? 'dashboard',
      resourceId,
      resourceType,
      trailType,
      intensity,
      metadata,
    }),
  });
}

export async function getHotResources(swarmId: string, limit = 10): Promise<HotResource[]> {
  return request<HotResource[]>(`/pheromones/${encodeURIComponent(swarmId)}/activity?limit=${limit}`);
}

export async function getPheromoneStats(swarmId: string): Promise<PheromoneStats> {
  return request<PheromoneStats>(`/pheromones/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Beliefs
// ---------------------------------------------------------------------------

export interface BeliefQueryOptions {
  subject?: string;
  beliefType?: string;
}

export async function getBeliefs(swarmId: string, handle: string, options: BeliefQueryOptions = {}): Promise<Belief[]> {
  const params = new URLSearchParams();
  if (options.subject) params.set('subject', options.subject);
  if (options.beliefType) params.set('beliefType', options.beliefType);
  const query = params.toString() ? `?${params}` : '';
  return request<Belief[]>(`/beliefs/${encodeURIComponent(swarmId)}/${encodeURIComponent(handle)}${query}`);
}

export async function upsertBelief(
  swarmId: string,
  subject: string,
  beliefType: string,
  beliefValue: string,
  confidence = 0.8,
  evidence: string[] = [],
): Promise<Belief> {
  const user = getUser();
  return request<Belief>('/beliefs', {
    method: 'POST',
    body: JSON.stringify({
      swarmId,
      agentHandle: user?.handle ?? 'dashboard',
      subject,
      beliefType,
      beliefValue,
      confidence,
      evidence,
    }),
  });
}

export async function getConsensus(swarmId: string, subject: string): Promise<Consensus> {
  return request<Consensus>(`/beliefs/${encodeURIComponent(swarmId)}/consensus/${encodeURIComponent(subject)}`);
}

export async function getBeliefStats(swarmId: string): Promise<BeliefStats> {
  return request<BeliefStats>(`/beliefs/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Credits & Reputation
// ---------------------------------------------------------------------------

export async function getCredits(swarmId: string, handle: string): Promise<CreditAccount> {
  return request<CreditAccount>(`/credits/${encodeURIComponent(swarmId)}/${encodeURIComponent(handle)}`);
}

export async function getLeaderboard(swarmId: string, limit = 10): Promise<CreditAccount[]> {
  return request<CreditAccount[]>(`/credits/${encodeURIComponent(swarmId)}/leaderboard?limit=${limit}`);
}

export async function transferCredits(
  swarmId: string,
  toHandle: string,
  amount: number,
  description = '',
): Promise<unknown> {
  const user = getUser();
  return request('/credits/transfer', {
    method: 'POST',
    body: JSON.stringify({
      swarmId,
      fromHandle: user?.handle ?? 'dashboard',
      toHandle,
      amount,
      description,
    }),
  });
}

export async function getCreditStats(swarmId: string): Promise<CreditStats> {
  return request<CreditStats>(`/credits/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Consensus Proposals
// ---------------------------------------------------------------------------

export interface ProposalQueryOptions {
  status?: string;
  limit?: number;
}

export async function getProposals(swarmId: string, options: ProposalQueryOptions = {}): Promise<Proposal[]> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString() ? `?${params}` : '';
  return request<Proposal[]>(`/consensus/${encodeURIComponent(swarmId)}/proposals${query}`);
}

export async function createProposal(
  swarmId: string,
  title: string,
  description: string,
  options: string[],
  proposalType: 'decision' | 'election' | 'approval' | 'ranking' | 'allocation' = 'decision',
  deadlineMs: number | null = null,
): Promise<Proposal> {
  const user = getUser();
  const body: Record<string, unknown> = {
    swarmId,
    proposerHandle: user?.handle ?? 'dashboard',
    proposalType,
    title,
    description,
    options,
  };
  if (deadlineMs) body.deadlineMs = deadlineMs;
  return request<Proposal>('/consensus/proposals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getProposal(proposalId: string): Promise<Proposal> {
  return request<Proposal>(`/consensus/proposals/${encodeURIComponent(proposalId)}`);
}

export async function voteOnProposal(
  proposalId: string,
  voteValue: string,
  rationale = '',
): Promise<unknown> {
  const user = getUser();
  return request(`/consensus/proposals/${encodeURIComponent(proposalId)}/vote`, {
    method: 'POST',
    body: JSON.stringify({
      voterHandle: user?.handle ?? 'dashboard',
      voteValue,
      rationale: rationale || undefined,
    }),
  });
}

export async function closeProposal(proposalId: string): Promise<unknown> {
  return request(`/consensus/proposals/${encodeURIComponent(proposalId)}/close`, { method: 'POST' });
}

export async function getConsensusStats(swarmId: string): Promise<ConsensusStats> {
  return request<ConsensusStats>(`/consensus/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

export interface BidQueryOptions {
  status?: string;
}

export async function getBids(taskId: string, options: BidQueryOptions = {}): Promise<Bid[]> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  const query = params.toString() ? `?${params}` : '';
  return request<Bid[]>(`/bids/task/${encodeURIComponent(taskId)}${query}`);
}

export async function submitBid(
  swarmId: string,
  taskId: string,
  amount: number,
  estimatedDuration: number | null = null,
  rationale = '',
): Promise<Bid> {
  const user = getUser();
  const body: Record<string, unknown> = {
    swarmId,
    taskId,
    bidderHandle: user?.handle ?? 'dashboard',
    bidAmount: amount,
    rationale,
  };
  if (estimatedDuration) body.estimatedDuration = estimatedDuration;
  return request<Bid>('/bids', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function acceptBid(bidId: string): Promise<unknown> {
  return request(`/bids/${encodeURIComponent(bidId)}/accept`, { method: 'POST' });
}

export async function withdrawBid(bidId: string): Promise<unknown> {
  return request(`/bids/${encodeURIComponent(bidId)}`, { method: 'DELETE' });
}

export async function runAuction(taskId: string, auctionType = 'first_price'): Promise<unknown> {
  return request(`/bids/task/${encodeURIComponent(taskId)}/auction`, {
    method: 'POST',
    body: JSON.stringify({ auctionType }),
  });
}

export async function getBiddingStats(swarmId: string): Promise<BiddingStats> {
  return request<BiddingStats>(`/bids/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Payoffs
// ---------------------------------------------------------------------------

export async function getPayoffs(taskId: string): Promise<unknown> {
  return request(`/payoffs/${encodeURIComponent(taskId)}`);
}

export async function definePayoff(
  swarmId: string,
  taskId: string,
  payoffType: string,
  baseValue: number,
  decayRate = 0.0,
  bonusConditions: Record<string, unknown> = {},
): Promise<unknown> {
  return request('/payoffs', {
    method: 'POST',
    body: JSON.stringify({ swarmId, taskId, payoffType, baseValue, decayRate, bonusConditions }),
  });
}

export async function calculatePayoff(taskId: string): Promise<unknown> {
  return request(`/payoffs/${encodeURIComponent(taskId)}/calculate`);
}

// ---------------------------------------------------------------------------
// Extended endpoints (Phase 1F)
// ---------------------------------------------------------------------------

export async function decayPheromones(swarmId: string): Promise<unknown> {
  return request(`/swarm-intelligence/${encodeURIComponent(swarmId)}/pheromones/decay`, { method: 'POST' });
}

export async function getResourcePheromones(swarmId: string, resourceId: string): Promise<PheromoneTrail[]> {
  return request(`/swarm-intelligence/${encodeURIComponent(swarmId)}/pheromones/resource/${encodeURIComponent(resourceId)}`);
}

export async function getCreditHistory(swarmId: string, handle: string): Promise<unknown[]> {
  return request(`/swarm-intelligence/${encodeURIComponent(swarmId)}/credits/${encodeURIComponent(handle)}/history`);
}

export async function evaluateTaskBids(taskId: string): Promise<unknown> {
  return request(`/swarm-intelligence/bids/${encodeURIComponent(taskId)}/evaluate`, { method: 'POST' });
}
