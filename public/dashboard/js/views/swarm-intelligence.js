/**
 * Swarm Intelligence View Components
 * Visualizations for pheromones, beliefs, credits, proposals, and bidding
 */

import ApiClient from '../api.js';

// Trail type colors
const TRAIL_COLORS = {
  touch: '#8b949e',
  modify: '#58a6ff',
  complete: '#3fb950',
  error: '#f85149',
  warning: '#d29922',
  success: '#238636',
};

// Belief type colors
const BELIEF_COLORS = {
  knowledge: '#58a6ff',
  assumption: '#d29922',
  inference: '#a371f7',
  observation: '#3fb950',
};

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
  return dayjs(timestamp).fromNow();
}

// ============================================================================
// Pheromone Trails Visualization
// ============================================================================

/**
 * Render pheromone trails as a heatmap-style list
 */
export function renderPheromoneTrails(trails, onDeposit) {
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
  const byResource = {};
  trails.forEach(t => {
    const key = `${t.resourceType}:${t.resourceId}`;
    if (!byResource[key]) {
      byResource[key] = { resourceType: t.resourceType, resourceId: t.resourceId, trails: [] };
    }
    byResource[key].trails.push(t);
  });

  const resources = Object.values(byResource).sort((a, b) => {
    const aIntensity = a.trails.reduce((sum, t) => sum + (t.intensity || 1), 0);
    const bIntensity = b.trails.reduce((sum, t) => sum + (t.intensity || 1), 0);
    return bIntensity - aIntensity;
  });

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Pheromone Trails</h3>
        <span class="badge">${trails.length} trails</span>
      </div>
      <div class="pheromone-list" style="max-height: 400px; overflow-y: auto;">
        ${resources.map(r => {
          const totalIntensity = r.trails.reduce((sum, t) => sum + (t.intensity || 1), 0);
          const heatLevel = Math.min(totalIntensity / 5, 1);
          return `
            <div class="pheromone-item" style="
              padding: var(--space-sm) var(--space-md);
              border-left: 4px solid rgba(88, 166, 255, ${0.3 + heatLevel * 0.7});
              background: rgba(88, 166, 255, ${heatLevel * 0.1});
              margin-bottom: var(--space-xs);
            ">
              <div class="flex justify-between items-center">
                <div>
                  <span class="badge ${r.resourceType === 'file' ? 'blue' : ''}">${escapeHtml(r.resourceType)}</span>
                  <span class="font-mono text-sm ml-sm">${escapeHtml(r.resourceId)}</span>
                </div>
                <div class="flex gap-xs">
                  ${r.trails.slice(0, 5).map(t => `
                    <span class="badge" style="background: ${TRAIL_COLORS[t.trailType] || '#8b949e'};" title="${escapeHtml(t.depositorHandle)} - ${escapeHtml(t.trailType)}">
                      ${escapeHtml(t.trailType?.slice(0, 3) || '?')}
                    </span>
                  `).join('')}
                  ${r.trails.length > 5 ? `<span class="text-muted text-sm">+${r.trails.length - 5}</span>` : ''}
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
export function renderHotResources(container, activity) {
  if (!container || !activity || activity.length === 0) {
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="padding: var(--space-lg);">
          <div class="empty-state-title">No Activity</div>
          <div class="empty-state-text">Hot resources will appear here</div>
        </div>
      `;
    }
    return;
  }

  // Create horizontal bar chart
  const maxCount = Math.max(...activity.map(a => a.trailCount || 0));

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: var(--space-xs);">
      ${activity.slice(0, 8).map(a => {
        const width = maxCount > 0 ? ((a.trailCount || 0) / maxCount) * 100 : 0;
        return `
          <div class="hot-resource-item">
            <div class="flex justify-between items-center mb-xs">
              <span class="font-mono text-sm" title="${escapeHtml(a.resourceId)}">${escapeHtml(a.resourceId?.slice(-30) || 'unknown')}</span>
              <span class="text-muted text-sm">${a.trailCount || 0} trails</span>
            </div>
            <div style="height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">
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
export function renderBeliefs(beliefs) {
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
  const bySubject = {};
  beliefs.forEach(b => {
    if (!bySubject[b.subject]) bySubject[b.subject] = [];
    bySubject[b.subject].push(b);
  });

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Agent Beliefs</h3>
        <span class="badge">${beliefs.length} beliefs</span>
      </div>
      <div class="beliefs-list" style="max-height: 400px; overflow-y: auto;">
        ${Object.entries(bySubject).map(([subject, subjectBeliefs]) => `
          <div class="belief-group" style="margin-bottom: var(--space-md); padding: var(--space-sm); background: var(--bg-secondary); border-radius: var(--radius-md);">
            <div class="belief-subject" style="font-weight: 600; margin-bottom: var(--space-xs);">${escapeHtml(subject)}</div>
            ${subjectBeliefs.map(b => `
              <div class="belief-item" style="display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) 0; border-top: 1px solid var(--border-primary);">
                <span class="badge" style="background: ${BELIEF_COLORS[b.beliefType] || '#8b949e'};">${escapeHtml(b.beliefType)}</span>
                <span class="text-sm" style="flex: 1;">${escapeHtml(b.beliefValue)}</span>
                <div class="confidence-bar" style="width: 60px; height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;" title="Confidence: ${((b.confidence || 0) * 100).toFixed(0)}%">
                  <div style="height: 100%; width: ${(b.confidence || 0) * 100}%; background: ${b.confidence > 0.7 ? '#3fb950' : b.confidence > 0.4 ? '#d29922' : '#f85149'};"></div>
                </div>
                <span class="text-muted text-xs">${escapeHtml(b.agentHandle)}</span>
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
export function renderConsensusView(consensus) {
  if (!consensus) {
    return `<div class="text-muted">No consensus data</div>`;
  }

  return `
    <div class="consensus-view" style="padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius-md);">
      <div class="flex justify-between items-center mb-sm">
        <span class="font-semibold">Swarm Consensus</span>
        <span class="badge ${consensus.hasConsensus ? 'green' : 'yellow'}">${consensus.hasConsensus ? 'Reached' : 'Pending'}</span>
      </div>
      ${consensus.dominantBelief ? `
        <div class="dominant-belief" style="padding: var(--space-sm); background: var(--bg-primary); border-radius: var(--radius-sm); margin-top: var(--space-sm);">
          <div class="text-sm text-muted">Dominant Belief:</div>
          <div class="font-mono">${escapeHtml(consensus.dominantBelief)}</div>
          <div class="text-sm text-muted mt-xs">Agreement: ${((consensus.agreementLevel || 0) * 100).toFixed(0)}%</div>
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
export function renderLeaderboard(leaderboard) {
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

  const maxCredits = Math.max(...leaderboard.map(a => a.credits || 0));

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Credits Leaderboard</h3>
      </div>
      <div class="leaderboard" style="max-height: 400px; overflow-y: auto;">
        ${leaderboard.map((agent, i) => {
          const medal = i === 0 ? '&#x1F947;' : i === 1 ? '&#x1F948;' : i === 2 ? '&#x1F949;' : `#${i + 1}`;
          const barWidth = maxCredits > 0 ? ((agent.credits || 0) / maxCredits) * 100 : 0;
          return `
            <div class="leaderboard-item" style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) 0; border-bottom: 1px solid var(--border-primary);">
              <span style="width: 32px; text-align: center; font-size: ${i < 3 ? '1.2em' : '0.9em'};">${medal}</span>
              <div style="flex: 1;">
                <div class="flex justify-between items-center">
                  <span class="font-semibold">${escapeHtml(agent.agentHandle || agent.handle)}</span>
                  <span class="font-mono" style="color: var(--accent-green);">${(agent.credits || 0).toLocaleString()} credits</span>
                </div>
                <div style="height: 4px; background: var(--bg-tertiary); border-radius: 2px; margin-top: 4px; overflow: hidden;">
                  <div style="height: 100%; width: ${barWidth}%; background: linear-gradient(90deg, #238636, #3fb950);"></div>
                </div>
                <div class="flex justify-between text-xs text-muted mt-xs">
                  <span>Rep: ${((agent.reputationScore || agent.reputation || 0) * 100).toFixed(0)}%</span>
                  <span>${agent.tasksCompleted || 0} tasks</span>
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
export function renderProposals(proposals, onVote, onClose) {
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

  const statusColors = {
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
      <div class="proposals-list" style="max-height: 500px; overflow-y: auto;">
        ${proposals.map(p => `
          <div class="proposal-item" style="padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius-md); margin-bottom: var(--space-sm);" data-proposal-id="${escapeHtml(p.id)}">
            <div class="flex justify-between items-start mb-sm">
              <div>
                <span class="badge ${statusColors[p.status] || ''}">${escapeHtml(p.status)}</span>
                <span class="font-semibold ml-sm">${escapeHtml(p.subject)}</span>
              </div>
              <span class="text-xs text-muted">${formatTime(p.createdAt)}</span>
            </div>
            ${p.description ? `<p class="text-sm text-muted mb-sm">${escapeHtml(p.description)}</p>` : ''}

            ${p.options ? `
              <div class="proposal-options" style="margin-top: var(--space-sm);">
                ${(Array.isArray(p.options) ? p.options : []).map((opt, i) => {
                  const voteCount = p.votes?.filter(v => v.vote === opt).length || 0;
                  const totalVotes = p.votes?.length || 0;
                  const percentage = totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
                  const isWinner = p.status === 'closed' && p.winner === opt;
                  return `
                    <div class="proposal-option ${isWinner ? 'winner' : ''}" style="
                      display: flex; align-items: center; gap: var(--space-sm);
                      padding: var(--space-xs) var(--space-sm);
                      background: ${isWinner ? 'rgba(63, 185, 80, 0.1)' : 'var(--bg-primary)'};
                      border: 1px solid ${isWinner ? 'var(--accent-green)' : 'var(--border-primary)'};
                      border-radius: var(--radius-sm);
                      margin-bottom: var(--space-xs);
                    ">
                      <span style="flex: 1;">${escapeHtml(opt)}</span>
                      <div style="width: 80px; height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">
                        <div style="height: 100%; width: ${percentage}%; background: ${isWinner ? 'var(--accent-green)' : 'var(--accent-blue)'};"></div>
                      </div>
                      <span class="text-xs text-muted" style="width: 40px; text-align: right;">${voteCount} votes</span>
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

            ${p.winner ? `
              <div class="proposal-winner" style="margin-top: var(--space-sm); padding: var(--space-sm); background: rgba(63, 185, 80, 0.1); border-radius: var(--radius-sm);">
                <span class="text-sm">Winner: <strong>${escapeHtml(p.winner)}</strong></span>
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
export function renderBids(bids, taskId, onAccept) {
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

  const statusColors = {
    pending: 'yellow',
    accepted: 'green',
    rejected: 'red',
    withdrawn: '',
  };

  // Sort by amount (highest first)
  const sortedBids = [...bids].sort((a, b) => (b.amount || 0) - (a.amount || 0));
  const maxAmount = Math.max(...bids.map(b => b.amount || 0));

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Task Bids</h3>
        <div class="flex gap-sm">
          <span class="badge">${bids.length} bids</span>
          <button class="btn btn-sm btn-primary run-auction-btn" data-task-id="${escapeHtml(taskId)}">Run Auction</button>
        </div>
      </div>
      <div class="bids-list" style="max-height: 400px; overflow-y: auto;">
        ${sortedBids.map((bid, i) => {
          const barWidth = maxAmount > 0 ? ((bid.amount || 0) / maxAmount) * 100 : 0;
          return `
            <div class="bid-item" style="padding: var(--space-sm); background: var(--bg-secondary); border-radius: var(--radius-md); margin-bottom: var(--space-xs);" data-bid-id="${escapeHtml(bid.id)}">
              <div class="flex justify-between items-center">
                <div class="flex items-center gap-sm">
                  <span style="width: 24px; text-align: center; color: ${i === 0 ? 'var(--accent-green)' : 'var(--text-secondary)'};">#${i + 1}</span>
                  <span class="font-semibold">${escapeHtml(bid.bidderHandle)}</span>
                  <span class="badge ${statusColors[bid.status] || ''}">${escapeHtml(bid.status)}</span>
                </div>
                <span class="font-mono" style="color: var(--accent-green); font-weight: 600;">${(bid.amount || 0).toLocaleString()} credits</span>
              </div>
              <div style="height: 4px; background: var(--bg-tertiary); border-radius: 2px; margin: var(--space-xs) 0; overflow: hidden;">
                <div style="height: 100%; width: ${barWidth}%; background: ${i === 0 ? 'var(--accent-green)' : 'var(--accent-blue)'};"></div>
              </div>
              ${bid.rationale ? `<p class="text-sm text-muted">${escapeHtml(bid.rationale)}</p>` : ''}
              ${bid.estimatedDuration ? `<span class="text-xs text-muted">Est. duration: ${bid.estimatedDuration}ms</span>` : ''}
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
export function renderSwarmIntelStats(pheromoneStats, beliefStats, creditStats, consensusStats, biddingStats) {
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
    <div class="swarm-intel-stats" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--space-md); margin-bottom: var(--space-lg);">
      ${stats.map(s => `
        <div class="stat-card" style="padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius-md); border-left: 4px solid var(--accent-${s.color});">
          <div class="flex items-center gap-sm mb-sm">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent-${s.color})" stroke-width="2">
              ${s.icon}
            </svg>
            <span class="text-sm text-muted">${s.label}</span>
          </div>
          <div style="font-size: 24px; font-weight: 700;">${s.value.toLocaleString()}</div>
          <div class="text-xs text-muted">${s.subtext}</div>
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
export async function renderSwarmIntelligence(container, swarmId) {
  // Show loading state
  container.innerHTML = `
    <div class="loading" style="padding: var(--space-xl); text-align: center;">
      <div class="spinner"></div>
      <div class="text-muted mt-md">Loading swarm intelligence data...</div>
    </div>
  `;

  // Fetch all data in parallel
  let pheromones = [], beliefs = [], leaderboard = [], proposals = [];
  let pheromoneStats = {}, beliefStats = {}, creditStats = {}, consensusStats = {}, biddingStats = {};
  let hotResources = [];

  try {
    const results = await Promise.allSettled([
      ApiClient.getPheromones(swarmId, { limit: 100 }),
      ApiClient.getBeliefStats(swarmId),
      ApiClient.getLeaderboard(swarmId, 20),
      ApiClient.getProposals(swarmId, { limit: 20 }),
      ApiClient.getPheromoneStats(swarmId),
      ApiClient.getCreditStats(swarmId),
      ApiClient.getHotResources(swarmId, 10),
    ]);

    if (results[0].status === 'fulfilled') pheromones = results[0].value.trails || results[0].value || [];
    if (results[1].status === 'fulfilled') beliefStats = results[1].value;
    if (results[2].status === 'fulfilled') leaderboard = results[2].value.leaderboard || results[2].value || [];
    if (results[3].status === 'fulfilled') proposals = results[3].value.proposals || results[3].value || [];
    if (results[4].status === 'fulfilled') pheromoneStats = results[4].value;
    if (results[5].status === 'fulfilled') creditStats = results[5].value;
    if (results[6].status === 'fulfilled') hotResources = results[6].value.resources || results[6].value || [];
  } catch (e) {
    console.error('Failed to fetch swarm intelligence data:', e);
  }

  // Render the view
  container.innerHTML = `
    <div class="swarm-intelligence-view">
      <!-- Stats Overview -->
      ${renderSwarmIntelStats(pheromoneStats, beliefStats, creditStats, consensusStats, biddingStats)}

      <!-- Main Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg);">
        <!-- Left Column -->
        <div>
          <!-- Pheromone Trails -->
          ${renderPheromoneTrails(pheromones)}

          <!-- Hot Resources -->
          <div class="card mt-md">
            <div class="card-header">
              <h3 class="card-title">Hot Resources</h3>
            </div>
            <div id="hot-resources-chart" style="padding: var(--space-md);"></div>
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

  // Setup event handlers
  setupSwarmIntelEventHandlers(container, swarmId);
}

/**
 * Setup event handlers for swarm intelligence interactions
 */
function setupSwarmIntelEventHandlers(container, swarmId) {
  // Vote buttons
  container.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const option = btn.dataset.option;
      const proposalItem = btn.closest('.proposal-item');
      const proposalId = proposalItem?.dataset.proposalId;
      if (proposalId && option) {
        try {
          await ApiClient.voteOnProposal(proposalId, option);
          // Refresh proposals
          const proposals = await ApiClient.getProposals(swarmId, { limit: 20 });
          const proposalsContainer = container.querySelector('.proposals-list')?.parentElement;
          if (proposalsContainer) {
            proposalsContainer.outerHTML = renderProposals(proposals.proposals || proposals || []);
            setupSwarmIntelEventHandlers(container, swarmId);
          }
        } catch (e) {
          alert('Failed to vote: ' + e.message);
        }
      }
    });
  });

  // Close proposal buttons
  container.querySelectorAll('.close-proposal-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const proposalItem = btn.closest('.proposal-item');
      const proposalId = proposalItem?.dataset.proposalId;
      if (proposalId) {
        try {
          await ApiClient.closeProposal(proposalId);
          // Refresh proposals
          const proposals = await ApiClient.getProposals(swarmId, { limit: 20 });
          const proposalsContainer = container.querySelector('.proposals-list')?.parentElement;
          if (proposalsContainer) {
            proposalsContainer.outerHTML = renderProposals(proposals.proposals || proposals || []);
            setupSwarmIntelEventHandlers(container, swarmId);
          }
        } catch (e) {
          alert('Failed to close proposal: ' + e.message);
        }
      }
    });
  });

  // Accept bid buttons
  container.querySelectorAll('.accept-bid-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bidItem = btn.closest('.bid-item');
      const bidId = bidItem?.dataset.bidId;
      if (bidId) {
        try {
          await ApiClient.acceptBid(bidId);
          btn.textContent = 'Accepted';
          btn.disabled = true;
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-secondary');
        } catch (e) {
          alert('Failed to accept bid: ' + e.message);
        }
      }
    });
  });

  // Run auction buttons
  container.querySelectorAll('.run-auction-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      if (taskId) {
        try {
          const result = await ApiClient.runAuction(taskId);
          alert(`Auction complete! Winner: ${result.winner?.bidderHandle || 'No winner'}`);
        } catch (e) {
          alert('Failed to run auction: ' + e.message);
        }
      }
    });
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
