/**
 * Fleet Overview View
 * Shows metrics, swarm tiles, worker list, and activity feed
 */

import store from '../store.js';
import ApiClient from '../api.js';

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Format uptime duration
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Render metric cards
 */
function renderMetricCards(metrics) {
  if (!metrics) {
    return `
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Uptime</div><div class="metric-value">-</div></div>
        <div class="metric-card"><div class="metric-label">Workers</div><div class="metric-value">0</div></div>
        <div class="metric-card"><div class="metric-label">Healthy</div><div class="metric-value green">0</div></div>
        <div class="metric-card"><div class="metric-label">Tasks</div><div class="metric-value">0</div></div>
        <div class="metric-card"><div class="metric-label">Restarts (1h)</div><div class="metric-value yellow">0</div></div>
      </div>
    `;
  }

  return `
    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">Uptime</div>
        <div class="metric-value blue">${formatUptime(metrics.uptime)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Workers</div>
        <div class="metric-value">${metrics.workers?.total || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Healthy</div>
        <div class="metric-value green">${metrics.workers?.healthy || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Tasks</div>
        <div class="metric-value purple">${metrics.tasks?.total || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Restarts (1h)</div>
        <div class="metric-value ${(metrics.restarts?.lastHour || 0) > 0 ? 'yellow' : ''}">${metrics.restarts?.lastHour || 0}</div>
      </div>
    </div>
  `;
}

/**
 * Render swarm tiles
 */
function renderSwarmTiles(swarms) {
  if (!swarms || swarms.length === 0) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/>
          </svg>
          <div class="empty-state-title">No Active Swarms</div>
          <div class="empty-state-text">Swarms will appear here when agents spawn with swarmId</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="swarm-grid">
      ${swarms.map(s => `
        <a href="#/swarm/${encodeURIComponent(s.id)}" class="swarm-tile">
          <div class="swarm-header">
            <div class="swarm-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            </div>
            <div>
              <div class="swarm-name">${escapeHtml(s.name)}</div>
              <div class="swarm-id">${escapeHtml(s.id.slice(0, 8))}</div>
            </div>
          </div>
          <div class="swarm-stats">
            <div class="swarm-stat">
              <div class="swarm-stat-value">${s.agents?.length || 0}</div>
              <div class="swarm-stat-label">Agents</div>
            </div>
            <div class="swarm-stat">
              <div class="swarm-stat-value">${s.maxAgents || 50}</div>
              <div class="swarm-stat-label">Max</div>
            </div>
          </div>
        </a>
      `).join('')}
    </div>
  `;
}

/**
 * Render worker list
 */
function renderWorkerList(workers) {
  if (!workers || workers.length === 0) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <div class="empty-state-title">No Active Workers</div>
          <div class="empty-state-text">Spawn workers using the API or MCP tools</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="worker-list">
      ${workers.map(w => `
        <a href="#/worker/${encodeURIComponent(w.handle)}" class="worker-item">
          <span class="status-dot ${w.health || 'healthy'}"></span>
          <div class="worker-avatar">${escapeHtml(w.handle.slice(0, 2).toUpperCase())}</div>
          <div class="worker-info">
            <div class="worker-handle">${escapeHtml(w.handle)}</div>
            <div class="worker-meta">${escapeHtml(w.state)} &bull; ${escapeHtml(w.teamName)}</div>
          </div>
          <span class="badge ${w.state === 'working' ? 'green' : ''}">${escapeHtml(w.state)}</span>
        </a>
      `).join('')}
    </div>
  `;
}

/**
 * Render activity feed
 */
function renderActivityFeed(activities) {
  if (!activities || activities.length === 0) {
    return `
      <div class="activity-feed">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <div class="empty-state-title">No Recent Activity</div>
          <div class="empty-state-text">Events will appear here in real-time</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="activity-feed">
      ${activities.slice(0, 20).map(a => `
        <div class="activity-item">
          <div class="activity-icon ${a.type}">
            ${a.type === 'spawn' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' : ''}
            ${a.type === 'dismiss' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' : ''}
            ${a.type === 'output' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' : ''}
            ${a.type === 'message' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' : ''}
          </div>
          <div class="activity-content">
            <div class="activity-title">${escapeHtml(a.title)}</div>
            <div class="activity-time">${dayjs(a.timestamp).fromNow()}</div>
            ${a.preview ? `<div class="activity-preview">${escapeHtml(a.preview)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Render the overview view
 */
export async function renderOverview(container) {
  const metrics = store.get('metrics');
  const swarms = store.get('swarms') || [];
  const workers = store.get('workers') || [];
  const activities = store.get('activities') || [];

  container.innerHTML = `
    <section class="mb-md">
      <h2 class="card-subtitle mb-md">Server Metrics</h2>
      <div id="metrics-container">
        ${renderMetricCards(metrics)}
      </div>
    </section>

    <section class="mb-md">
      <div style="display: flex; justify-content: space-between; align-items: center;" class="mb-md">
        <h2 class="card-subtitle">Active Swarms</h2>
        <button class="btn btn-secondary btn-sm" onclick="window.fleetDashboard.showSwarmModal()">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Create Swarm
        </button>
      </div>
      <div id="swarms-container">
        ${renderSwarmTiles(swarms)}
      </div>
    </section>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg);">
      <section>
        <h2 class="card-subtitle mb-md">Workers</h2>
        <div id="workers-container">
          ${renderWorkerList(workers)}
        </div>
      </section>

      <section>
        <h2 class="card-subtitle mb-md">Activity</h2>
        <div id="activity-container">
          ${renderActivityFeed(activities)}
        </div>
      </section>
    </div>
  `;

  // Subscribe to store updates
  const unsubMetrics = store.subscribe('metrics', (metrics) => {
    document.getElementById('metrics-container').innerHTML = renderMetricCards(metrics);
  });

  const unsubSwarms = store.subscribe('swarms', (swarms) => {
    document.getElementById('swarms-container').innerHTML = renderSwarmTiles(swarms);
  });

  const unsubWorkers = store.subscribe('workers', (workers) => {
    document.getElementById('workers-container').innerHTML = renderWorkerList(workers);
  });

  const unsubActivities = store.subscribe('activities', (activities) => {
    document.getElementById('activity-container').innerHTML = renderActivityFeed(activities);
  });

  // Return cleanup function
  return () => {
    unsubMetrics();
    unsubSwarms();
    unsubWorkers();
    unsubActivities();
  };
}
