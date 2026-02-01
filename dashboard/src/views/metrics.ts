/**
 * Metrics Dashboard View
 * Real-time charts for worker stats, task status, and system metrics
 */

import { Chart } from 'chart.js/auto';
import store from '@/store';
import { formatUptime } from '@/utils/format';
import type { ServerMetrics } from '@/types';
import type { MetricsHistoryEntry } from '@/types';

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
} as const;

Chart.defaults.color = CHART_COLORS.textColor;
Chart.defaults.borderColor = CHART_COLORS.gridColor;

/**
 * Create worker count line chart
 */
function createWorkerChart(ctx: HTMLCanvasElement, history: MetricsHistoryEntry[]): Chart {
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
function createTaskChart(ctx: HTMLCanvasElement, tasks: ServerMetrics['tasks'] | undefined): Chart {
  const byStatus: Record<string, number> = {
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
function createStateChart(ctx: HTMLCanvasElement, workers: ServerMetrics['workers'] | undefined): Chart {
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
function createRestartsChart(ctx: HTMLCanvasElement, history: MetricsHistoryEntry[]): Chart {
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
 * Render the metrics view
 */
export async function renderMetrics(container: HTMLElement): Promise<() => void> {
  // Show loading state while store data may still be populating
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const metrics = store.get('metrics');
  const history = store.get('metricsHistory') || [];

  container.innerHTML = `
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

    <div class="grid-2-1-col mb-md">
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

    <div class="grid-2-col">
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
        <div class="grid grid-cols-4 gap-md">
          <div>
            <div class="form-label">Database</div>
            <div class="text-fg">SQLite (WAL mode)</div>
          </div>
          <div>
            <div class="form-label">WebSocket</div>
            <div id="ws-status" class="text-green">Connected</div>
          </div>
          <div>
            <div class="form-label">Poll Rate</div>
            <div class="text-fg">5s</div>
          </div>
          <div>
            <div class="form-label">Active Swarms</div>
            <div class="text-fg" id="m-swarms">${store.get('swarms')?.length || 0}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Create charts
  const workerChart = createWorkerChart(
    document.getElementById('worker-chart') as HTMLCanvasElement,
    history.length > 0 ? history : [{ ...metrics, timestamp: Date.now() } as MetricsHistoryEntry],
  );

  const taskChart = createTaskChart(
    document.getElementById('task-chart') as HTMLCanvasElement,
    metrics?.tasks,
  );

  const stateChart = createStateChart(
    document.getElementById('state-chart') as HTMLCanvasElement,
    metrics?.workers,
  );

  const restartsChart = createRestartsChart(
    document.getElementById('restarts-chart') as HTMLCanvasElement,
    history.length > 0 ? history : [{ ...metrics, timestamp: Date.now() } as MetricsHistoryEntry],
  );

  // Subscribe to metrics updates
  const unsubMetrics = store.subscribe('metrics', (updatedMetrics: ServerMetrics | null) => {
    if (!updatedMetrics) return;

    // Update metric cards
    const uptimeEl = document.getElementById('m-uptime');
    if (uptimeEl) uptimeEl.textContent = formatUptime(updatedMetrics.uptime);

    const workersEl = document.getElementById('m-workers');
    if (workersEl) workersEl.textContent = String(updatedMetrics.workers?.total || 0);

    const tasksEl = document.getElementById('m-tasks');
    if (tasksEl) tasksEl.textContent = String(updatedMetrics.tasks?.total || 0);

    const agentsEl = document.getElementById('m-agents');
    if (agentsEl) agentsEl.textContent = String(updatedMetrics.agents || 0);
  });

  const unsubHistory = store.subscribe('metricsHistory', (updatedHistory: MetricsHistoryEntry[]) => {
    if (!updatedHistory || updatedHistory.length === 0) return;

    // Update worker chart
    const labels = updatedHistory.map((_, i) => {
      const secondsAgo = (updatedHistory.length - i - 1) * 5;
      return secondsAgo === 0 ? 'now' : `-${secondsAgo}s`;
    });

    workerChart.data.labels = labels;
    workerChart.data.datasets[0].data = updatedHistory.map(h => h.workers?.total || 0);
    workerChart.data.datasets[1].data = updatedHistory.map(h => h.workers?.healthy || 0);
    workerChart.data.datasets[2].data = updatedHistory.map(h => h.workers?.unhealthy || 0);
    workerChart.update('none');

    // Update restarts chart
    restartsChart.data.labels = updatedHistory.map((_, i) => i);
    restartsChart.data.datasets[0].data = updatedHistory.map(h => h.restarts?.lastHour || 0);
    restartsChart.update('none');

    // Update task chart with latest
    const latest = updatedHistory[updatedHistory.length - 1];
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

  const unsubSwarms = store.subscribe('swarms', (swarms: unknown[]) => {
    const el = document.getElementById('m-swarms');
    if (el) el.textContent = String(swarms?.length || 0);
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
