// Compounding Machine - Compounding Metrics Charts

import type { CompoundSnapshot, TimeSeriesPoint } from './types';

// Chart.js loaded globally via CDN
declare const Chart: typeof import('chart.js').Chart;

let growthChart: InstanceType<typeof Chart> | null = null;

// GitHub Dark chart theme
const CHART_COLORS = {
  tasks: '#3fb950',
  knowledge: '#58a6ff',
  credits: '#a371f7',
  workers: 'rgba(139, 148, 158, 0.3)',
  workersBorder: '#8b949e',
  grid: '#21262d',
  text: '#8b949e',
};

export function initMetrics(): void {
  const canvas = document.getElementById('growth-chart') as HTMLCanvasElement | null;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  growthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Tasks Completed',
          data: [],
          borderColor: CHART_COLORS.tasks,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
        },
        {
          label: 'Knowledge Entries',
          data: [],
          borderColor: CHART_COLORS.knowledge,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
        },
        {
          label: 'Credits Earned',
          data: [],
          borderColor: CHART_COLORS.credits,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
        },
        {
          label: 'Active Workers',
          data: [],
          borderColor: CHART_COLORS.workersBorder,
          backgroundColor: CHART_COLORS.workers,
          borderWidth: 1,
          tension: 0.3,
          pointRadius: 0,
          fill: true,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: CHART_COLORS.text,
            font: { size: 10 },
            boxWidth: 12,
            padding: 8,
          },
        },
      },
      scales: {
        x: {
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text, maxRotation: 0, maxTicksLimit: 8, font: { size: 9 } },
        },
        y: {
          position: 'left',
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text, font: { size: 9 } },
          beginAtZero: true,
        },
        y1: {
          position: 'right',
          grid: { display: false },
          ticks: { color: CHART_COLORS.text, font: { size: 9 } },
          beginAtZero: true,
        },
      },
      animation: {
        duration: 300,
      },
    },
  }) as unknown as InstanceType<typeof Chart>;
}

export function updateMetrics(snapshot: CompoundSnapshot): void {
  updateGrowthChart(snapshot.timeSeries);
  updateGauges(snapshot);
  updateMetricsBadge(snapshot);
}

function updateGrowthChart(series: TimeSeriesPoint[]): void {
  if (!growthChart || !series.length) return;

  const labels = series.map((p) => {
    const d = new Date(p.timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  });

  growthChart.data.labels = labels;
  growthChart.data.datasets[0].data = series.map((p) => p.tasksCompleted);
  growthChart.data.datasets[1].data = series.map((p) => p.knowledgeEntries);
  growthChart.data.datasets[2].data = series.map((p) => p.creditsEarned);
  growthChart.data.datasets[3].data = series.map((p) => p.activeWorkers);

  growthChart.update('none');
}

function updateGauges(snapshot: CompoundSnapshot): void {
  const workers = snapshot.workers;
  const working = workers.filter((w) => w.state === 'working').length;
  const total = workers.filter((w) => w.state !== 'stopped').length;
  const utilization = total > 0 ? working / total : 0;

  renderGauge('gauge-utilization', utilization, '#3fb950');
  const utilEl = document.getElementById('gauge-util-value');
  if (utilEl) utilEl.textContent = `${Math.round(utilization * 100)}%`;

  const velocity = snapshot.rates.knowledgeVelocity;
  const velNorm = Math.min(velocity / 10, 1); // normalize to 10/min target
  renderGauge('gauge-velocity', velNorm, '#58a6ff');
  const velEl = document.getElementById('gauge-vel-value');
  if (velEl) velEl.textContent = `${velocity.toFixed(1)}/min`;

  const throughput = snapshot.rates.compoundRate;
  const thruNorm = Math.min(throughput / 5, 1); // normalize to 5/min target
  renderGauge('gauge-throughput', thruNorm, '#a371f7');
  const thruEl = document.getElementById('gauge-thru-value');
  if (thruEl) thruEl.textContent = `${throughput.toFixed(1)}/min`;
}

function renderGauge(svgId: string, value: number, color: string): void {
  const svgEl = document.getElementById(svgId);
  if (!svgEl) return;

  const clamped = Math.max(0, Math.min(1, value));
  const startAngle = -Math.PI * 0.75;
  const endAngle = Math.PI * 0.75;
  const range = endAngle - startAngle;
  const valueAngle = startAngle + range * clamped;

  const cx = 60, cy = 55, r = 40;

  const arcPath = (start: number, end: number): string => {
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const largeArc = end - start > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  svgEl.innerHTML = `
    <path d="${arcPath(startAngle, endAngle)}" fill="none" stroke="#21262d" stroke-width="8" stroke-linecap="round"/>
    <path d="${arcPath(startAngle, valueAngle)}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
      style="transition: d 0.5s ease-out; filter: drop-shadow(0 0 4px ${color}40)"/>
  `;
}

function updateMetricsBadge(snapshot: CompoundSnapshot): void {
  const badge = document.getElementById('metrics-badge');
  if (badge) {
    badge.textContent = `${snapshot.timeSeries.length} pts`;
  }
}

export function destroyMetrics(): void {
  growthChart?.destroy();
  growthChart = null;
}
