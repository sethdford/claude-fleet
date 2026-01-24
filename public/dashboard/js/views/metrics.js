/**
 * Metrics Dashboard View
 * Real-time charts for worker stats, task status, and system metrics
 */

import store from '../store.js';
import ApiClient from '../api.js';

// Chart.js theme configuration
const CHART_COLORS = {
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#a371f7',
  gray: '#8b949e',
  gridColor: '#21262d',
  textColor: '#c9d1d9',
};

Chart.defaults.color = CHART_COLORS.textColor;
Chart.defaults.borderColor = CHART_COLORS.gridColor;

/**
 * Create worker count line chart
 */
function createWorkerChart(ctx, history) {
  const labels = history.map((_, i) => {
    const secondsAgo = (history.length - i - 1) * 5;
    return secondsAgo === 0 ? 'now' : `-${secondsAgo}s`;
  });

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Workers',
          data: history.map(h => h.workers?.total || 0),
          borderColor: CHART_COLORS.blue,
          backgroundColor: 'rgba(88, 166, 255, 0.1)',
          fill: true,
          tension: 0.3,
        },
        {
          label: 'Healthy',
          data: history.map(h => h.workers?.healthy || 0),
          borderColor: CHART_COLORS.green,
          backgroundColor: 'transparent',
          tension: 0.3,
        },
        {
          label: 'Unhealthy',
          data: history.map(h => h.workers?.unhealthy || 0),
          borderColor: CHART_COLORS.red,
          backgroundColor: 'transparent',
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, padding: 15 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
          grid: { color: CHART_COLORS.gridColor },
        },
        x: {
          grid: { display: false },
        },
      },
    },
  });
}

/**
 * Create task status doughnut chart
 */
function createTaskChart(ctx, tasks) {
  const byStatus = {
    open: 0,
    in_progress: 0,
    blocked: 0,
    resolved: 0,
  };

  if (tasks?.byStatus) {
    Object.assign(byStatus, tasks.byStatus);
  }

  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Open', 'In Progress', 'Blocked', 'Resolved'],
      datasets: [{
        data: [byStatus.open, byStatus.in_progress, byStatus.blocked, byStatus.resolved],
        backgroundColor: [
          CHART_COLORS.blue,
          CHART_COLORS.yellow,
          CHART_COLORS.red,
          CHART_COLORS.green,
        ],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 12, padding: 10 },
        },
      },
      cutout: '60%',
    },
  });
}

/**
 * Create worker state bar chart
 */
function createStateChart(ctx, workers) {
  const byState = workers?.byState || {
    starting: 0,
    ready: 0,
    working: 0,
    stopping: 0,
    stopped: 0,
  };

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Starting', 'Ready', 'Working', 'Stopping', 'Stopped'],
      datasets: [{
        label: 'Workers by State',
        data: [
          byState.starting || 0,
          byState.ready || 0,
          byState.working || 0,
          byState.stopping || 0,
          byState.stopped || 0,
        ],
        backgroundColor: [
          CHART_COLORS.yellow,
          CHART_COLORS.blue,
          CHART_COLORS.green,
          CHART_COLORS.purple,
          CHART_COLORS.gray,
        ],
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
          grid: { color: CHART_COLORS.gridColor },
        },
        x: {
          grid: { display: false },
        },
      },
    },
  });
}

/**
 * Create restarts sparkline
 */
function createRestartsChart(ctx, history) {
  const labels = history.map((_, i) => i);

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: history.map(h => h.restarts?.lastHour || 0),
        borderColor: CHART_COLORS.yellow,
        backgroundColor: 'rgba(210, 153, 34, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          display: false,
          beginAtZero: true,
        },
        x: {
          display: false,
        },
      },
    },
  });
}

/**
 * Format uptime
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
 * Render the metrics view
 */
export async function renderMetrics(container) {
  const metrics = store.get('metrics');
  const history = store.get('metricsHistory') || [];

  container.innerHTML = `
    <style>
      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-md);
        margin-bottom: var(--space-lg);
      }

      .chart-container {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        padding: var(--space-md);
      }

      .chart-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-md);
      }

      .chart-title {
        font-weight: 600;
        color: var(--text-primary);
      }

      .chart-wrapper {
        position: relative;
      }

      .chart-tall { height: 300px; }
      .chart-medium { height: 200px; }
      .chart-small { height: 100px; }
    </style>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Uptime</div>
        <div class="metric-value blue" id="m-uptime">${metrics ? formatUptime(metrics.uptime) : '-'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Workers</div>
        <div class="metric-value" id="m-workers">${metrics?.workers?.total || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Active Tasks</div>
        <div class="metric-value purple" id="m-tasks">${metrics?.tasks?.total || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Registered Agents</div>
        <div class="metric-value green" id="m-agents">${metrics?.agents || 0}</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-lg); margin-bottom: var(--space-lg);">
      <div class="chart-container">
        <div class="chart-header">
          <span class="chart-title">Worker Count Over Time</span>
        </div>
        <div class="chart-wrapper chart-tall">
          <canvas id="worker-chart"></canvas>
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-header">
          <span class="chart-title">Task Status Distribution</span>
        </div>
        <div class="chart-wrapper chart-tall">
          <canvas id="task-chart"></canvas>
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg);">
      <div class="chart-container">
        <div class="chart-header">
          <span class="chart-title">Workers by State</span>
        </div>
        <div class="chart-wrapper chart-medium">
          <canvas id="state-chart"></canvas>
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-header">
          <span class="chart-title">Restarts (Last Hour)</span>
          <span class="badge ${(metrics?.restarts?.lastHour || 0) > 0 ? 'yellow' : ''}">
            ${metrics?.restarts?.lastHour || 0} restarts
          </span>
        </div>
        <div class="chart-wrapper chart-medium">
          <canvas id="restarts-chart"></canvas>
        </div>
      </div>
    </div>

    <div class="mt-md">
      <div class="chart-container">
        <div class="chart-header">
          <span class="chart-title">System Information</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-md);">
          <div>
            <div class="form-label">Database</div>
            <div style="color: var(--text-primary);">SQLite (WAL mode)</div>
          </div>
          <div>
            <div class="form-label">WebSocket</div>
            <div id="ws-status" style="color: var(--accent-green);">Connected</div>
          </div>
          <div>
            <div class="form-label">Poll Rate</div>
            <div style="color: var(--text-primary);">5s</div>
          </div>
          <div>
            <div class="form-label">Active Swarms</div>
            <div style="color: var(--text-primary);" id="m-swarms">${store.get('swarms')?.length || 0}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Create charts
  let workerChart = createWorkerChart(
    document.getElementById('worker-chart'),
    history.length > 0 ? history : [metrics || {}]
  );

  let taskChart = createTaskChart(
    document.getElementById('task-chart'),
    metrics?.tasks
  );

  let stateChart = createStateChart(
    document.getElementById('state-chart'),
    metrics?.workers
  );

  let restartsChart = createRestartsChart(
    document.getElementById('restarts-chart'),
    history.length > 0 ? history : [metrics || {}]
  );

  // Subscribe to metrics updates
  const unsubMetrics = store.subscribe('metrics', (metrics) => {
    if (!metrics) return;

    // Update metric cards
    document.getElementById('m-uptime').textContent = formatUptime(metrics.uptime);
    document.getElementById('m-workers').textContent = metrics.workers?.total || 0;
    document.getElementById('m-tasks').textContent = metrics.tasks?.total || 0;
    document.getElementById('m-agents').textContent = metrics.agents || 0;
  });

  const unsubHistory = store.subscribe('metricsHistory', (history) => {
    if (!history || history.length === 0) return;

    // Update worker chart
    const labels = history.map((_, i) => {
      const secondsAgo = (history.length - i - 1) * 5;
      return secondsAgo === 0 ? 'now' : `-${secondsAgo}s`;
    });

    workerChart.data.labels = labels;
    workerChart.data.datasets[0].data = history.map(h => h.workers?.total || 0);
    workerChart.data.datasets[1].data = history.map(h => h.workers?.healthy || 0);
    workerChart.data.datasets[2].data = history.map(h => h.workers?.unhealthy || 0);
    workerChart.update('none');

    // Update restarts chart
    restartsChart.data.labels = history.map((_, i) => i);
    restartsChart.data.datasets[0].data = history.map(h => h.restarts?.lastHour || 0);
    restartsChart.update('none');

    // Update task chart with latest
    const latest = history[history.length - 1];
    if (latest?.tasks?.byStatus) {
      const byStatus = latest.tasks.byStatus;
      taskChart.data.datasets[0].data = [
        byStatus.open || 0,
        byStatus.in_progress || 0,
        byStatus.blocked || 0,
        byStatus.resolved || 0,
      ];
      taskChart.update('none');
    }

    // Update state chart with latest
    if (latest?.workers?.byState) {
      const byState = latest.workers.byState;
      stateChart.data.datasets[0].data = [
        byState.starting || 0,
        byState.ready || 0,
        byState.working || 0,
        byState.stopping || 0,
        byState.stopped || 0,
      ];
      stateChart.update('none');
    }
  });

  const unsubSwarms = store.subscribe('swarms', (swarms) => {
    document.getElementById('m-swarms').textContent = swarms?.length || 0;
  });

  // Return cleanup function
  return () => {
    unsubMetrics();
    unsubHistory();
    unsubSwarms();
    workerChart?.destroy();
    taskChart?.destroy();
    stateChart?.destroy();
    restartsChart?.destroy();
  };
}
