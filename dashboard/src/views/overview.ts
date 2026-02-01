/**
 * Fleet Overview View -- Command Center
 * Dense layout with sparklines, health heatmap, cost tracking, and filtered activity
 */

import dayjs from 'dayjs';
import store from '@/store';
import { escapeHtml } from '@/utils/escape-html';
import { formatUptime } from '@/utils/format';
import type {
  ServerMetrics,
  WorkerInfo,
  SwarmInfo,
} from '@/types';
import type {
  MetricsHistoryEntry,
  Activity,
} from '@/types';

/**
 * Build an SVG sparkline from an array of numbers
 */
function sparkline(data: number[], color = '#58a6ff', width = 64, height = 28): string {
  if (!data || data.length < 2) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="${color}" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="2,2"/></svg>`;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const padding = 2;

  const points = data.map((v, i) => {
    const x = i * step;
    const y = padding + (height - 2 * padding) * (1 - (v - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Area fill
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <polygon points="${areaPoints}" fill="${color}" fill-opacity="0.1"/>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

interface TrendResult {
  direction: 'up' | 'down' | 'flat';
  text: string;
}

/**
 * Calculate trend direction from recent history
 */
function trend(data: number[]): TrendResult {
  if (!data || data.length < 2) return { direction: 'flat', text: '' };
  const recent = data[data.length - 1];
  const prev = data[data.length - 2];
  const diff = recent - prev;
  if (diff > 0) return { direction: 'up', text: `+${diff}` };
  if (diff < 0) return { direction: 'down', text: `${diff}` };
  return { direction: 'flat', text: '\u2014' };
}

/**
 * Render the 8-metric dense card grid
 */
function renderMetricCards(metrics: ServerMetrics | null, history: MetricsHistoryEntry[]): string {
  const workerData = history.map(h => h.workers?.total || 0);
  const healthyData = history.map(h => h.workers?.healthy || 0);
  const taskData = history.map(h => h.tasks?.total || 0);
  const restartData = history.map(h => h.restarts?.lastHour || 0);

  const workerTrend = trend(workerData);
  const healthyTrend = trend(healthyData);
  const taskTrend = trend(taskData);

  // Calculate total cost from activities
  const activities: Activity[] = store.get('activities') || [];
  const costActivities = activities.filter(a => a.preview && a.preview.includes('$'));
  let totalCost = 0;
  costActivities.forEach(a => {
    const match = a.preview?.match(/\$(\d+\.?\d*)/);
    if (match) totalCost += parseFloat(match[1]);
  });
  // totalCost is computed but not currently displayed — keeping for future use
  void totalCost;

  const openTasks = metrics?.tasks?.byStatus?.open || 0;
  const inProgress = metrics?.tasks?.byStatus?.in_progress || 0;
  const blocked = metrics?.tasks?.byStatus?.blocked || 0;
  const swarmCount = (store.get('swarms') || []).length;
  void swarmCount;

  return `
    <div class="metric-card-dense">
      <div class="metric-info">
        <div class="metric-label">Uptime</div>
        <div class="metric-value blue">${metrics ? formatUptime(metrics.uptime) : '-'}</div>
      </div>
    </div>

    <div class="metric-card-dense">
      <div class="metric-info">
        <div class="metric-label">Workers</div>
        <div class="metric-value">${metrics?.workers?.total || 0}</div>
        <div class="metric-trend ${workerTrend.direction}">${workerTrend.text}</div>
      </div>
      <div class="metric-sparkline">${sparkline(workerData, '#58a6ff')}</div>
    </div>

    <div class="metric-card-dense">
      <div class="metric-info">
        <div class="metric-label">Healthy</div>
        <div class="metric-value green">${metrics?.workers?.healthy || 0}</div>
        <div class="metric-trend ${healthyTrend.direction}">${healthyTrend.text}</div>
      </div>
      <div class="metric-sparkline">${sparkline(healthyData, '#3fb950')}</div>
    </div>

    <div class="metric-card-dense">
      <div class="metric-info">
        <div class="metric-label">Tasks</div>
        <div class="metric-value purple">${metrics?.tasks?.total || 0}</div>
        <div class="metric-trend ${taskTrend.direction}">${taskTrend.text}</div>
      </div>
      <div class="metric-sparkline">${sparkline(taskData, '#a371f7')}</div>
    </div>

    <div class="metric-card-dense">
      <div class="metric-info">
        <div class="metric-label">Open</div>
        <div class="metric-value blue">${openTasks}</div>
      </div>
    </div>

    <div class="metric-card-dense">
      <div class="metric-info">
        <div class="metric-label">In Progress</div>
        <div class="metric-value yellow">${inProgress}</div>
      </div>
    </div>

    <div class="metric-card-dense">
      <div class="metric-info">
        <div class="metric-label">Blocked</div>
        <div class="metric-value ${blocked > 0 ? 'red' : ''}">${blocked}</div>
      </div>
    </div>

    <div class="metric-card-dense">
      <div class="metric-info">
        <div class="metric-label">Restarts (1h)</div>
        <div class="metric-value ${(metrics?.restarts?.lastHour || 0) > 0 ? 'yellow' : ''}">${metrics?.restarts?.lastHour || 0}</div>
      </div>
      <div class="metric-sparkline">${sparkline(restartData, '#d29922')}</div>
    </div>
  `;
}

/**
 * Render worker health heatmap
 */
function renderHealthHeatmap(workers: WorkerInfo[]): string {
  if (!workers || workers.length === 0) {
    return '<div class="text-fg-muted text-sm">No workers active</div>';
  }

  return `
    <div class="health-heatmap">
      ${workers.map(w => `
        <a href="#/worker/${encodeURIComponent(w.handle)}" class="health-cell ${w.health || 'healthy'}" title="${escapeHtml(w.handle)} (${escapeHtml(w.state)})"></a>
      `).join('')}
    </div>
  `;
}

/**
 * Render swarm tiles (compact)
 */
function renderSwarmTiles(swarms: SwarmInfo[]): string {
  if (!swarms || swarms.length === 0) {
    return `
      <div class="empty-state p-lg">
        <div class="empty-state-text">No active swarms</div>
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
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
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
 * Render worker list (compact)
 */
function renderWorkerList(workers: WorkerInfo[]): string {
  if (!workers || workers.length === 0) {
    return `
      <div class="empty-state p-lg">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-8">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <div class="empty-state-text">Spawn workers to get started</div>
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
            <div class="worker-meta">${escapeHtml(w.state)} \u00b7 ${escapeHtml(w.teamName)}</div>
          </div>
          <span class="badge ${w.state === 'working' ? 'green' : w.state === 'starting' ? 'yellow' : ''}">${escapeHtml(w.state)}</span>
        </a>
      `).join('')}
    </div>
  `;
}

/**
 * Activity type icons (shared map to avoid repeated SVG soup)
 */
const ACTIVITY_ICONS: Record<string, string> = {
  spawn: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  dismiss: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  output: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  message: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  tool: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
  result: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  system: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>',
  error: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  gate_pass: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  gate_fail: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  iteration: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/></svg>',
};

/**
 * Render activity feed with type filters
 */
function renderActivityFeed(activities: Activity[], activeFilter: string): string {
  if (!activities || activities.length === 0) {
    return `
      <div class="empty-state p-lg">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-8">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <div class="empty-state-text">Events appear here in real-time</div>
      </div>
    `;
  }

  const types = [...new Set(activities.map(a => a.type))];
  const filtered = activeFilter && activeFilter !== 'all'
    ? activities.filter(a => a.type === activeFilter)
    : activities;

  return `
    <div class="activity-filters">
      <button class="activity-filter-btn ${!activeFilter || activeFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
      ${types.map(t => `
        <button class="activity-filter-btn ${activeFilter === t ? 'active' : ''}" data-filter="${t}">${t}</button>
      `).join('')}
    </div>
    <div class="activity-feed max-h-[360px]">
      ${filtered.slice(0, 30).map(a => `
        <div class="activity-item">
          <div class="activity-icon ${a.type}">
            ${ACTIVITY_ICONS[a.type] || ACTIVITY_ICONS.system}
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
 * Render the overview view -- dense command center layout
 */
export async function renderOverview(container: HTMLElement): Promise<() => void> {
  const metrics = store.get('metrics');
  const history = store.get('metricsHistory') || [];
  const swarms = store.get('swarms') || [];
  const workers = store.get('workers') || [];
  const activities = store.get('activities') || [];

  let activeFilter = 'all';

  container.innerHTML = `
    <!-- Row 1: 8 dense metric cards -->
    <section class="mb-md">
      <div class="grid grid-cols-4 gap-sm" id="metrics-container">
        ${renderMetricCards(metrics, history)}
      </div>
    </section>

    <!-- Row 2: Health heatmap + Swarms -->
    <div class="grid-2-col mb-md">
      <section>
        <div class="flex items-center justify-between mb-md">
          <h2 class="card-subtitle">Worker Health</h2>
          <span class="text-sm text-fg-muted">${workers.length} workers</span>
        </div>
        <div class="card" id="heatmap-container">
          <div class="p-sm">
            ${renderHealthHeatmap(workers)}
          </div>
        </div>
      </section>

      <section>
        <div class="flex justify-between items-center mb-md">
          <h2 class="card-subtitle">Swarms</h2>
          <button class="btn btn-secondary btn-sm" id="create-swarm-btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Create
          </button>
        </div>
        <div id="swarms-container">
          ${renderSwarmTiles(swarms)}
        </div>
      </section>
    </div>

    <!-- Row 3: Workers + Activity -->
    <div class="grid-2-col">
      <section>
        <h2 class="card-subtitle mb-md">Workers</h2>
        <div id="workers-container" class="max-h-[420px] overflow-y-auto">
          ${renderWorkerList(workers)}
        </div>
      </section>

      <section>
        <h2 class="card-subtitle mb-md">Activity</h2>
        <div id="activity-container">
          ${renderActivityFeed(activities, activeFilter)}
        </div>
      </section>
    </div>
  `;

  // Delegated click handler for overview interactions
  container.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Create swarm button
    if (target.closest('#create-swarm-btn')) {
      window.fleetDashboard?.showSwarmModal();
      return;
    }

    // Activity filter buttons
    const filterBtn = target.closest('.activity-filter-btn') as HTMLElement | null;
    if (filterBtn) {
      activeFilter = filterBtn.dataset.filter || 'all';
      const activityContainer = document.getElementById('activity-container');
      if (activityContainer) {
        activityContainer.innerHTML = renderActivityFeed(store.get('activities') || [], activeFilter);
      }
    }
  });

  // Subscribe to store updates
  const unsubMetrics = store.subscribe('metrics', () => {
    const el = document.getElementById('metrics-container');
    if (el) el.innerHTML = renderMetricCards(store.get('metrics'), store.get('metricsHistory') || []);
  });

  const unsubHistory = store.subscribe('metricsHistory', () => {
    const el = document.getElementById('metrics-container');
    if (el) el.innerHTML = renderMetricCards(store.get('metrics'), store.get('metricsHistory') || []);
  });

  const unsubSwarms = store.subscribe('swarms', (updatedSwarms: SwarmInfo[]) => {
    const el = document.getElementById('swarms-container');
    if (el) el.innerHTML = renderSwarmTiles(updatedSwarms);
  });

  const unsubWorkers = store.subscribe('workers', (updatedWorkers: WorkerInfo[]) => {
    const el = document.getElementById('workers-container');
    if (el) el.innerHTML = renderWorkerList(updatedWorkers);
    const hm = document.getElementById('heatmap-container');
    if (hm) hm.innerHTML = `<div class="p-sm">${renderHealthHeatmap(updatedWorkers)}</div>`;
  });

  const unsubActivities = store.subscribe('activities', (updatedActivities: Activity[]) => {
    const el = document.getElementById('activity-container');
    if (el) el.innerHTML = renderActivityFeed(updatedActivities, activeFilter);
  });

  // Return cleanup function
  return () => {
    unsubMetrics();
    unsubHistory();
    unsubSwarms();
    unsubWorkers();
    unsubActivities();
  };
}
