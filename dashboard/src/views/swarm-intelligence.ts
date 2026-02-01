/**
 * Swarm Intelligence View Components
 * Visualizations for pheromones, beliefs, credits, proposals, and bidding
 */

import {
  getPheromones,
  getBeliefStats,
  getLeaderboard,
  getProposals,
  getPheromoneStats,
  getCreditStats,
  getHotResources,
  voteOnProposal,
  closeProposal,
  acceptBid,
  runAuction,
} from '@/api';
import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import { formatTime } from '@/utils/format';

// Trail type colors
const TRAIL_COLORS: Record<string, string> = {
  touch: '#8b949e',
  modify: '#58a6ff',
  complete: '#3fb950',
  error: '#f85149',
  warning: '#d29922',
  success: '#238636',
};

// Belief type colors
const BELIEF_COLORS: Record<string, string> = {
  knowledge: '#58a6ff',
  assumption: '#d29922',
  inference: '#a371f7',
  observation: '#3fb950',
};

interface PheromoneTrailData {
  resourceType: string;
  resourceId: string;
  trailType?: string;
  intensity?: number;
  depositorHandle?: string;
}

interface ResourceGroup {
  resourceType: string;
  resourceId: string;
  trails: PheromoneTrailData[];
}

interface HotResourceData {
  resourceId?: string;
  trailCount?: number;
}

interface BeliefData {
  subject: string;
  beliefType: string;
  beliefValue: string;
  confidence?: number;
  agentHandle?: string;
}

interface ConsensusData {
  winner?: string | null;
  quorumMet?: boolean;
  participationRate?: number;
  tally?: Record<string, number>;
  totalVotes?: number;
}

interface LeaderboardAgent {
  agentHandle: string;
  balance?: number;
  reputationScore?: number;
  totalEarned?: number;
  taskCount?: number;
  successCount?: number;
  successRate?: number;
}

interface ProposalData {
  id: string;
  status: string;
  title: string;
  description?: string;
  createdAt?: number;
  options?: string[];
  votes?: { voteValue: string }[];
  result?: { winner: string | null } | null;
}

interface BidData {
  id: string;
  bidderHandle: string;
  status: string;
  bidAmount?: number;
  confidence?: number;
  rationale?: string;
  estimatedDuration?: number;
}

interface PheromoneStatsData {
  totalTrails?: number;
  activeTrails?: number;
}

interface BeliefStatsData {
  totalBeliefs?: number;
  uniqueSubjects?: number;
}

interface CreditStatsData {
  totalCredits?: number;
  agentCount?: number;
}

interface ConsensusStatsData {
  totalProposals?: number;
  openProposals?: number;
}

interface BiddingStatsData {
  pendingBids?: number;
  totalBids?: number;
}

// ============================================================================
// Pheromone Trails Visualization
// ============================================================================

/**
 * Render pheromone trails as a heatmap-style list
 */
export function renderPheromoneTrails(trails: PheromoneTrailData[], _onDeposit?: unknown): string {
  if (!trails || trails.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Pheromone Trails</h3>
        </div>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <div class="empty-state-title">No Pheromone Trails</div>
          <div class="empty-state-text">Agents leave trails on resources they interact with</div>
        </div>
      </div>
    `;
  }

  // Group by resource
  const byResource: Record<string, ResourceGroup> = {};
  trails.forEach((t: PheromoneTrailData) => {
    const key = `${t.resourceType}:${t.resourceId}`;
    if (!byResource[key]) {
      byResource[key] = { resourceType: t.resourceType, resourceId: t.resourceId, trails: [] };
    }
    byResource[key].trails.push(t);
  });

  const resources = Object.values(byResource).sort((a: ResourceGroup, b: ResourceGroup) => {
    const aIntensity = a.trails.reduce((sum: number, t: PheromoneTrailData) => sum + (t.intensity || 1), 0);
    const bIntensity = b.trails.reduce((sum: number, t: PheromoneTrailData) => sum + (t.intensity || 1), 0);
    return bIntensity - aIntensity;
  });

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Pheromone Trails</h3>
        <span class="badge">${trails.length} trails</span>
      </div>
      <div class="pheromone-list max-h-[400px] overflow-y-auto">
        ${resources.map((r: ResourceGroup) => {
          const totalIntensity = r.trails.reduce((sum: number, t: PheromoneTrailData) => sum + (t.intensity || 1), 0);
          const heatLevel = Math.min(totalIntensity / 5, 1);
          return `
            <div class="pheromone-item" style="
              padding: var(--spacing-sm) var(--spacing-md);
              border-left: 4px solid rgba(88, 166, 255, ${0.3 + heatLevel * 0.7});
              background: rgba(88, 166, 255, ${heatLevel * 0.1});
              margin-bottom: var(--spacing-xs);
            ">
              <div class="flex justify-between items-center">
                <div>
                  <span class="badge ${r.resourceType === 'file' ? 'blue' : ''}">${escapeHtml(r.resourceType)}</span>
                  <span class="font-mono text-sm ml-sm">${escapeHtml(r.resourceId)}</span>
                </div>
                <div class="flex gap-xs">
                  ${r.trails.slice(0, 5).map((t: PheromoneTrailData) => `
                    <span class="badge" style="background: ${TRAIL_COLORS[t.trailType || ''] || '#8b949e'};" title="${escapeHtml(t.depositorHandle)} - ${escapeHtml(t.trailType)}">
                      ${escapeHtml(t.trailType?.slice(0, 3) || '?')}
                    </span>
                  `).join('')}
                  ${r.trails.length > 5 ? `<span class="text-fg-muted text-sm">+${r.trails.length - 5}</span>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/**
 * Render hot resources chart
 */
export function renderHotResources(container: HTMLElement | null, activity: HotResourceData[]): void {
  if (!container || !activity || activity.length === 0) {
    if (container) {
      container.innerHTML = `
        <div class="empty-state p-lg">
          <div class="empty-state-title">No Activity</div>
          <div class="empty-state-text">Hot resources will appear here</div>
        </div>
      `;
    }
    return;
  }

  // Create horizontal bar chart
  const maxCount = Math.max(...activity.map((a: HotResourceData) => a.trailCount || 0));

  container.innerHTML = `
    <div class="flex flex-col gap-xs">
      ${activity.slice(0, 8).map((a: HotResourceData) => {
        const width = maxCount > 0 ? ((a.trailCount || 0) / maxCount) * 100 : 0;
        return `
          <div class="hot-resource-item">
            <div class="flex justify-between items-center mb-xs">
              <span class="font-mono text-sm" title="${escapeHtml(a.resourceId)}">${escapeHtml(a.resourceId?.slice(-30) || 'unknown')}</span>
              <span class="text-fg-muted text-sm">${a.trailCount || 0} trails</span>
            </div>
            <div style="height: 6px; background: var(--color-surface-raised); border-radius: 3px; overflow: hidden;">
              <div style="height: 100%; width: ${width}%; background: linear-gradient(90deg, #58a6ff, #a371f7); transition: width 0.3s;"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ============================================================================
// Agent Beliefs Visualization
// ============================================================================

/**
 * Render agent beliefs
 */
export function renderBeliefs(beliefs: BeliefData[]): string {
  if (!beliefs || beliefs.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Agent Beliefs</h3>
        </div>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          <div class="empty-state-title">No Beliefs Recorded</div>
          <div class="empty-state-text">Agents share knowledge through the belief system</div>
        </div>
      </div>
    `;
  }

  // Group by subject
  const bySubject: Record<string, BeliefData[]> = {};
  beliefs.forEach((b: BeliefData) => {
    if (!bySubject[b.subject]) bySubject[b.subject] = [];
    bySubject[b.subject].push(b);
  });

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Agent Beliefs</h3>
        <span class="badge">${beliefs.length} beliefs</span>
      </div>
      <div class="beliefs-list max-h-[400px] overflow-y-auto">
        ${Object.entries(bySubject).map(([subject, subjectBeliefs]: [string, BeliefData[]]) => `
          <div class="belief-group mb-md p-sm bg-surface-alt rounded-md">
            <div class="belief-subject font-semibold mb-xs">${escapeHtml(subject)}</div>
            ${subjectBeliefs.map((b: BeliefData) => `
              <div class="belief-item flex items-center gap-sm py-xs border-t border-edge">
                <span class="badge" style="background: ${BELIEF_COLORS[b.beliefType] || '#8b949e'};">${escapeHtml(b.beliefType)}</span>
                <span class="text-sm flex-1">${escapeHtml(b.beliefValue)}</span>
                <div class="confidence-bar" style="width: 60px; height: 6px; background: var(--color-surface-raised); border-radius: 3px; overflow: hidden;" title="Confidence: ${((b.confidence || 0) * 100).toFixed(0)}%">
                  <div style="height: 100%; width: ${(b.confidence || 0) * 100}%; background: ${(b.confidence || 0) > 0.7 ? '#3fb950' : (b.confidence || 0) > 0.4 ? '#d29922' : '#f85149'};"></div>
                </div>
                <span class="text-fg-muted text-xs">${escapeHtml(b.agentHandle)}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Render consensus view
 */
export function renderConsensusView(consensus: ConsensusData | null): string {
  if (!consensus) {
    return '<div class="text-fg-muted">No consensus data</div>';
  }

  return `
    <div class="consensus-view p-md bg-surface-alt rounded-md">
      <div class="flex justify-between items-center mb-sm">
        <span class="font-semibold">Swarm Consensus</span>
        <span class="badge ${consensus.quorumMet ? 'green' : 'yellow'}">${consensus.quorumMet ? 'Reached' : 'Pending'}</span>
      </div>
      ${consensus.winner ? `
        <div class="dominant-belief p-sm bg-surface rounded-sm mt-sm">
          <div class="text-sm text-fg-muted">Winner:</div>
          <div class="font-mono">${escapeHtml(consensus.winner)}</div>
          <div class="text-sm text-fg-muted mt-xs">Participation: ${((consensus.participationRate || 0) * 100).toFixed(0)}%</div>
        </div>
      ` : ''}
    </div>
  `;
}

// ============================================================================
// Credits & Reputation Visualization
// ============================================================================

/**
 * Render credits leaderboard
 */
export function renderLeaderboard(leaderboard: LeaderboardAgent[]): string {
  if (!leaderboard || leaderboard.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Credits Leaderboard</h3>
        </div>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          <div class="empty-state-title">No Rankings Yet</div>
          <div class="empty-state-text">Agents earn credits through task completion</div>
        </div>
      </div>
    `;
  }

  const maxCredits = Math.max(...leaderboard.map((a: LeaderboardAgent) => a.balance || 0));

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Credits Leaderboard</h3>
      </div>
      <div class="leaderboard max-h-[400px] overflow-y-auto">
        ${leaderboard.map((agent: LeaderboardAgent, i: number) => {
          const medal = i === 0 ? '&#x1F947;' : i === 1 ? '&#x1F948;' : i === 2 ? '&#x1F949;' : `#${i + 1}`;
          const barWidth = maxCredits > 0 ? ((agent.balance || 0) / maxCredits) * 100 : 0;
          return `
            <div class="leaderboard-item flex items-center gap-md py-sm border-b border-edge">
              <span style="width: 32px; text-align: center; font-size: ${i < 3 ? '1.2em' : '0.9em'};">${medal}</span>
              <div class="flex-1">
                <div class="flex justify-between items-center">
                  <span class="font-semibold">${escapeHtml(agent.agentHandle)}</span>
                  <span class="font-mono text-green">${(agent.balance || 0).toLocaleString()} credits</span>
                </div>
                <div style="height: 4px; background: var(--color-surface-raised); border-radius: 2px; margin-top: 4px; overflow: hidden;">
                  <div style="height: 100%; width: ${barWidth}%; background: linear-gradient(90deg, #238636, #3fb950);"></div>
                </div>
                <div class="flex justify-between text-xs text-fg-muted mt-xs">
                  <span>Rep: ${((agent.reputationScore || 0) * 100).toFixed(0)}%</span>
                  <span>${agent.taskCount || 0} tasks</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ============================================================================
// Proposals & Voting Visualization
// ============================================================================

/**
 * Render proposals list
 */
export function renderProposals(proposals: ProposalData[], _onVote?: unknown, _onClose?: unknown): string {
  if (!proposals || proposals.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Proposals</h3>
        </div>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <div class="empty-state-title">No Proposals</div>
          <div class="empty-state-text">Create proposals for swarm-level decisions</div>
        </div>
      </div>
    `;
  }

  const statusColors: Record<string, string> = {
    open: 'blue',
    closed: 'green',
    cancelled: 'red',
  };

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Proposals</h3>
        <span class="badge">${proposals.length}</span>
      </div>
      <div class="proposals-list max-h-[500px] overflow-y-auto">
        ${proposals.map((p: ProposalData) => `
          <div class="proposal-item p-md bg-surface-alt rounded-md mb-sm" data-proposal-id="${escapeHtml(p.id)}">
            <div class="flex justify-between items-start mb-sm">
              <div>
                <span class="badge ${statusColors[p.status] || ''}">${escapeHtml(p.status)}</span>
                <span class="font-semibold ml-sm">${escapeHtml(p.title)}</span>
              </div>
              <span class="text-xs text-fg-muted">${formatTime(p.createdAt)}</span>
            </div>
            ${p.description ? `<p class="text-sm text-fg-muted mb-sm">${escapeHtml(p.description)}</p>` : ''}

            ${p.options ? `
              <div class="proposal-options mt-sm">
                ${(Array.isArray(p.options) ? p.options : []).map((opt: string) => {
                  const voteCount = p.votes?.filter((v: { voteValue: string }) => v.voteValue === opt).length || 0;
                  const totalVotes = p.votes?.length || 0;
                  const percentage = totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
                  const isWinner = p.status === 'closed' && p.result?.winner === opt;
                  return `
                    <div class="proposal-option ${isWinner ? 'winner' : ''}" style="
                      display: flex; align-items: center; gap: var(--spacing-sm);
                      padding: var(--spacing-xs) var(--spacing-sm);
                      background: ${isWinner ? 'rgba(63, 185, 80, 0.1)' : 'var(--color-surface)'};
                      border: 1px solid ${isWinner ? 'var(--color-green)' : 'var(--color-edge)'};
                      border-radius: var(--radius-sm);
                      margin-bottom: var(--spacing-xs);
                    ">
                      <span class="flex-1">${escapeHtml(opt)}</span>
                      <div style="width: 80px; height: 6px; background: var(--color-surface-raised); border-radius: 3px; overflow: hidden;">
                        <div style="height: 100%; width: ${percentage}%; background: ${isWinner ? 'var(--color-green)' : 'var(--color-blue)'};"></div>
                      </div>
                      <span class="text-xs text-fg-muted" style="width: 40px; text-align: right;">${voteCount} votes</span>
                      ${p.status === 'open' ? `<button class="btn btn-sm btn-secondary vote-btn" data-option="${escapeHtml(opt)}">Vote</button>` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}

            ${p.status === 'open' ? `
              <div class="flex justify-end mt-sm">
                <button class="btn btn-sm btn-primary close-proposal-btn">Close Voting</button>
              </div>
            ` : ''}

            ${p.result?.winner ? `
              <div class="proposal-winner mt-sm p-sm bg-green/10 rounded-sm">
                <span class="text-sm">Winner: <strong>${escapeHtml(p.result.winner)}</strong></span>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ============================================================================
// Task Bidding Visualization
// ============================================================================

/**
 * Render bids for a task
 */
export function renderBids(bids: BidData[], taskId: string, _onAccept?: unknown): string {
  if (!bids || bids.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Task Bids</h3>
        </div>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
          </svg>
          <div class="empty-state-title">No Bids</div>
          <div class="empty-state-text">Agents bid for tasks based on capability</div>
        </div>
      </div>
    `;
  }

  const statusColors: Record<string, string> = {
    pending: 'yellow',
    accepted: 'green',
    rejected: 'red',
    withdrawn: '',
  };

  // Sort by amount (highest first)
  const sortedBids = [...bids].sort((a: BidData, b: BidData) => (b.bidAmount || 0) - (a.bidAmount || 0));
  const maxAmount = Math.max(...bids.map((b: BidData) => b.bidAmount || 0));

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Task Bids</h3>
        <div class="flex gap-sm">
          <span class="badge">${bids.length} bids</span>
          <button class="btn btn-sm btn-primary run-auction-btn" data-task-id="${escapeHtml(taskId)}">Run Auction</button>
        </div>
      </div>
      <div class="bids-list max-h-[400px] overflow-y-auto">
        ${sortedBids.map((bid: BidData, i: number) => {
          const barWidth = maxAmount > 0 ? ((bid.bidAmount || 0) / maxAmount) * 100 : 0;
          return `
            <div class="bid-item p-sm bg-surface-alt rounded-md mb-xs" data-bid-id="${escapeHtml(bid.id)}">
              <div class="flex justify-between items-center">
                <div class="flex items-center gap-sm">
                  <span style="width: 24px; text-align: center; color: ${i === 0 ? 'var(--color-green)' : 'var(--color-fg-secondary)'};">#${i + 1}</span>
                  <span class="font-semibold">${escapeHtml(bid.bidderHandle)}</span>
                  <span class="badge ${statusColors[bid.status] || ''}">${escapeHtml(bid.status)}</span>
                </div>
                <span class="font-mono text-green font-semibold">${(bid.bidAmount || 0).toLocaleString()} credits</span>
              </div>
              <div style="height: 4px; background: var(--color-surface-raised); border-radius: 2px; margin: var(--spacing-xs) 0; overflow: hidden;">
                <div style="height: 100%; width: ${barWidth}%; background: ${i === 0 ? 'var(--color-green)' : 'var(--color-blue)'};"></div>
              </div>
              ${bid.rationale ? `<p class="text-sm text-fg-muted">${escapeHtml(bid.rationale)}</p>` : ''}
              ${bid.estimatedDuration ? `<span class="text-xs text-fg-muted">Est. duration: ${bid.estimatedDuration}ms</span>` : ''}
              ${bid.status === 'pending' ? `
                <div class="flex justify-end gap-xs mt-sm">
                  <button class="btn btn-sm btn-primary accept-bid-btn">Accept</button>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ============================================================================
// Swarm Intelligence Stats Dashboard
// ============================================================================

/**
 * Render swarm intelligence stats cards
 */
export function renderSwarmIntelStats(
  pheromoneStats: PheromoneStatsData,
  beliefStats: BeliefStatsData,
  creditStats: CreditStatsData,
  consensusStats: ConsensusStatsData,
  biddingStats: BiddingStatsData,
): string {
  const stats = [
    {
      label: 'Pheromone Trails',
      value: pheromoneStats?.totalTrails || 0,
      subtext: `${pheromoneStats?.activeTrails || 0} active`,
      color: 'blue',
      icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v6l4 2"/>',
    },
    {
      label: 'Agent Beliefs',
      value: beliefStats?.totalBeliefs || 0,
      subtext: `${beliefStats?.uniqueSubjects || 0} subjects`,
      color: 'purple',
      icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    },
    {
      label: 'Total Credits',
      value: creditStats?.totalCredits || 0,
      subtext: `${creditStats?.agentCount || 0} agents`,
      color: 'green',
      icon: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    },
    {
      label: 'Proposals',
      value: consensusStats?.totalProposals || 0,
      subtext: `${consensusStats?.openProposals || 0} open`,
      color: 'yellow',
      icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
    },
    {
      label: 'Active Bids',
      value: biddingStats?.pendingBids || 0,
      subtext: `${biddingStats?.totalBids || 0} total`,
      color: 'red',
      icon: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
    },
  ];

  return `
    <div class="swarm-intel-stats grid grid-cols-5 gap-md mb-lg">
      ${stats.map((s) => `
        <div class="stat-card p-md bg-surface-alt rounded-md border-l-4 border-l-${s.color}">
          <div class="flex items-center gap-sm mb-sm">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--color-${s.color})" stroke-width="2">
              ${s.icon}
            </svg>
            <span class="text-sm text-fg-muted">${s.label}</span>
          </div>
          <div class="text-2xl font-bold">${s.value.toLocaleString()}</div>
          <div class="text-xs text-fg-muted">${s.subtext}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ============================================================================
// Main Swarm Intelligence View
// ============================================================================

/**
 * Main swarm intelligence view renderer
 */
export async function renderSwarmIntelligence(container: HTMLElement, swarmId: string): Promise<() => void> {
  // Show loading state
  container.innerHTML = `
    <div class="loading p-xl text-center">
      <div class="spinner"></div>
      <div class="text-fg-muted mt-md">Loading swarm intelligence data...</div>
    </div>
  `;

  // Fetch all data in parallel
  let pheromones: PheromoneTrailData[] = [];
  let leaderboard: LeaderboardAgent[] = [];
  let proposals: ProposalData[] = [];
  let pheromoneStats: PheromoneStatsData = {};
  let beliefStats: BeliefStatsData = {};
  let creditStats: CreditStatsData = {};
  const consensusStats: ConsensusStatsData = {};
  const biddingStats: BiddingStatsData = {};
  let hotResources: HotResourceData[] = [];

  try {
    const results = await Promise.allSettled([
      getPheromones(swarmId, { limit: 100 }),
      getBeliefStats(swarmId),
      getLeaderboard(swarmId, 20),
      getProposals(swarmId, { limit: 20 }),
      getPheromoneStats(swarmId),
      getCreditStats(swarmId),
      getHotResources(swarmId, 10),
    ]);

    if (results[0].status === 'fulfilled') {
      const val = results[0].value as PheromoneTrailData[] | { trails?: PheromoneTrailData[] };
      pheromones = Array.isArray(val) ? val : (val as { trails?: PheromoneTrailData[] }).trails || [];
    }
    if (results[1].status === 'fulfilled') beliefStats = results[1].value as BeliefStatsData;
    if (results[2].status === 'fulfilled') {
      const val = results[2].value as LeaderboardAgent[] | { leaderboard?: LeaderboardAgent[] };
      leaderboard = Array.isArray(val) ? val : (val as { leaderboard?: LeaderboardAgent[] }).leaderboard || [];
    }
    if (results[3].status === 'fulfilled') {
      const val = results[3].value as ProposalData[] | { proposals?: ProposalData[] };
      proposals = Array.isArray(val) ? val : (val as { proposals?: ProposalData[] }).proposals || [];
    }
    if (results[4].status === 'fulfilled') pheromoneStats = results[4].value as PheromoneStatsData;
    if (results[5].status === 'fulfilled') creditStats = results[5].value as CreditStatsData;
    if (results[6].status === 'fulfilled') {
      const val = results[6].value as HotResourceData[] | { resources?: HotResourceData[] };
      hotResources = Array.isArray(val) ? val : (val as { resources?: HotResourceData[] }).resources || [];
    }
  } catch (e) {
    console.error('Failed to fetch swarm intelligence data:', e);
  }

  // Render the view
  container.innerHTML = `
    <div class="swarm-intelligence-view">
      <!-- Stats Overview -->
      ${renderSwarmIntelStats(pheromoneStats, beliefStats, creditStats, consensusStats, biddingStats)}

      <!-- Main Grid -->
      <div class="grid grid-cols-2 gap-lg">
        <!-- Left Column -->
        <div>
          <!-- Pheromone Trails -->
          ${renderPheromoneTrails(pheromones)}

          <!-- Hot Resources -->
          <div class="card mt-md">
            <div class="card-header">
              <h3 class="card-title">Hot Resources</h3>
            </div>
            <div id="hot-resources-chart" class="p-md"></div>
          </div>

          <!-- Proposals -->
          <div class="mt-md">
            ${renderProposals(proposals)}
          </div>
        </div>

        <!-- Right Column -->
        <div>
          <!-- Leaderboard -->
          ${renderLeaderboard(leaderboard)}

          <!-- Beliefs (fetch for current user) -->
          <div class="mt-md" id="beliefs-container">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">Agent Beliefs</h3>
              </div>
              <div class="empty-state">
                <div class="empty-state-text">Select an agent to view beliefs</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render hot resources chart
  renderHotResources(document.getElementById('hot-resources-chart'), hotResources);

  // Setup event delegation ONCE — survives innerHTML replacements from vote/close refreshes
  setupSwarmIntelEventDelegation(container, swarmId);

  return () => {
    // Event delegation is on the container which gets cleaned up by the view router.
  };
}

/**
 * Refresh proposals section after vote/close — replaces only the proposals HTML.
 */
async function refreshProposals(container: HTMLElement, swarmId: string): Promise<void> {
  try {
    const updatedProposals = await getProposals(swarmId, { limit: 20 }) as ProposalData[] | { proposals?: ProposalData[] };
    const proposalsList = Array.isArray(updatedProposals) ? updatedProposals : (updatedProposals as { proposals?: ProposalData[] }).proposals || [];
    const proposalsContainer = container.querySelector('.proposals-list')?.parentElement;
    if (proposalsContainer) {
      proposalsContainer.outerHTML = renderProposals(proposalsList);
    }
  } catch (e) {
    toast.error('Failed to refresh proposals: ' + (e as Error).message);
  }
}

/**
 * Event delegation for swarm intelligence interactions.
 * Attached ONCE to the container — survives innerHTML replacements from vote/close refreshes.
 */
function setupSwarmIntelEventDelegation(container: HTMLElement, swarmId: string): void {
  container.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Vote buttons
    const voteBtn = target.closest('.vote-btn') as HTMLElement | null;
    if (voteBtn) {
      const option = voteBtn.dataset.option;
      const proposalItem = voteBtn.closest('.proposal-item') as HTMLElement | null;
      const proposalId = proposalItem?.dataset.proposalId;
      if (proposalId && option) {
        try {
          await voteOnProposal(proposalId, option);
          await refreshProposals(container, swarmId);
        } catch (e) {
          toast.error('Failed to vote: ' + (e as Error).message);
        }
      }
      return;
    }

    // Close proposal buttons
    const closeBtn = target.closest('.close-proposal-btn') as HTMLElement | null;
    if (closeBtn) {
      const proposalItem = closeBtn.closest('.proposal-item') as HTMLElement | null;
      const proposalId = proposalItem?.dataset.proposalId;
      if (proposalId) {
        try {
          await closeProposal(proposalId);
          await refreshProposals(container, swarmId);
        } catch (e) {
          toast.error('Failed to close proposal: ' + (e as Error).message);
        }
      }
      return;
    }

    // Accept bid buttons
    const acceptBtn = target.closest('.accept-bid-btn') as HTMLElement | null;
    if (acceptBtn) {
      const bidItem = acceptBtn.closest('.bid-item') as HTMLElement | null;
      const bidId = bidItem?.dataset.bidId;
      if (bidId) {
        try {
          await acceptBid(bidId);
          (acceptBtn as HTMLButtonElement).textContent = 'Accepted';
          (acceptBtn as HTMLButtonElement).disabled = true;
          acceptBtn.classList.remove('btn-primary');
          acceptBtn.classList.add('btn-secondary');
        } catch (e) {
          toast.error('Failed to accept bid: ' + (e as Error).message);
        }
      }
      return;
    }

    // Run auction buttons
    const auctionBtn = target.closest('.run-auction-btn') as HTMLElement | null;
    if (auctionBtn) {
      const taskId = auctionBtn.dataset.taskId;
      if (taskId) {
        try {
          const result = await runAuction(taskId) as { winner?: { bidderHandle?: string } };
          toast.success(`Auction complete! Winner: ${result.winner?.bidderHandle || 'No winner'}`);
        } catch (e) {
          toast.error('Failed to run auction: ' + (e as Error).message);
        }
      }
    }
  });
}

export default {
  renderPheromoneTrails,
  renderHotResources,
  renderBeliefs,
  renderConsensusView,
  renderLeaderboard,
  renderProposals,
  renderBids,
  renderSwarmIntelStats,
  renderSwarmIntelligence,
};
