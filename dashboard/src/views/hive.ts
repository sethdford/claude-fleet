/**
 * Hex Hive View
 * Real-time hexagonal grid visualization of fleet workers.
 * Each worker occupies a hex cell, colored by swarm, with activity pulse indicators.
 */

import { select } from 'd3-selection';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import { easeCubicOut } from 'd3-ease';
import 'd3-transition';
import type { Selection } from 'd3-selection';

import store from '@/store';
import wsManager from '@/websocket';
import { escapeHtml } from '@/utils/escape-html';
import {
  axialToCartesian,
  hexToPolygonPoints,
  HexOccupancy,
} from '@/utils/hex-geometry';
import type { HiveNode, HiveConfig, WorkerActivity } from '@/types/hive';
import type { WorkerInfo, SwarmInfo } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: HiveConfig = {
  hexRadius: 32,
  spacing: 1.08,
  animationDuration: 300,
};

const SWARM_COLORS = [
  '#58a6ff', '#3fb950', '#a371f7', '#d29922',
  '#f47067', '#39d4d4', '#f778ba', '#a3e635',
];

const STATE_COLORS: Record<string, string> = {
  starting: 'var(--color-yellow)',
  ready: 'var(--color-blue)',
  working: 'var(--color-green)',
  stopping: 'var(--color-purple)',
  stopped: 'var(--color-fg-muted)',
};

/** Tiny SVG path glyphs for worker states (12×12 viewBox centered). */
const STATE_ICONS: Record<string, string> = {
  working:  'M6 1.5A1.5 1.5 0 007.5 3h0A1.5 1.5 0 006 1.5zM3.8 4.2l1.5 2.5L3 9h2l1-1.5L7 9h2L6.7 6.7l1.5-2.5z', // gear-like
  ready:    'M2.5 6.5L5 9l4.5-5',                                          // checkmark
  starting: 'M6 10V3M3 5.5L6 2.5 9 5.5',                                   // up-arrow
  stopping: 'M6 2v7M3 6.5L6 9.5 9 6.5',                                    // down-arrow
  stopped:  'M3 6h6',                                                        // dash
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSwarmColor(swarmId: string | undefined, swarms: SwarmInfo[]): string {
  if (!swarmId) return SWARM_COLORS[0];
  const index = swarms.findIndex(s => s.id === swarmId);
  if (index < 0) return SWARM_COLORS[0];
  return SWARM_COLORS[(index + 1) % SWARM_COLORS.length];
}

function getSwarmName(swarmId: string | undefined, swarms: SwarmInfo[]): string | undefined {
  if (!swarmId) return undefined;
  return swarms.find(s => s.id === swarmId)?.name;
}

function buildHiveNodes(
  workers: WorkerInfo[],
  swarms: SwarmInfo[],
  occupancy: HexOccupancy,
): HiveNode[] {
  return workers.map(w => {
    let hex = occupancy.getPosition(w.handle);
    if (!hex) {
      hex = occupancy.getNextInSpiral();
      occupancy.occupy(hex, w.handle);
    }
    return {
      handle: w.handle,
      hex,
      state: w.state,
      health: w.health,
      swarmId: w.swarmId,
      swarmName: getSwarmName(w.swarmId, swarms),
      swarmColor: getSwarmColor(w.swarmId, swarms),
      currentTaskId: w.currentTaskId,
      workingDir: w.workingDir,
      spawnedAt: w.spawnedAt,
    };
  });
}

function formatUptime(spawnedAt: number | undefined): string {
  if (!spawnedAt) return '—';
  const seconds = Math.floor((Date.now() - spawnedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

// ---------------------------------------------------------------------------
// SVG Defs (gradients)
// ---------------------------------------------------------------------------

function ensureGradientDefs(
  svg: Selection<SVGSVGElement, unknown, null, undefined>,
): void {
  let defs = svg.select<SVGDefsElement>('defs');
  if (defs.empty()) {
    defs = svg.insert('defs', ':first-child');
  }

  SWARM_COLORS.forEach((color, i) => {
    const id = `hive-grad-${i}`;
    if (!defs.select(`#${id}`).empty()) return;
    const grad = defs.append('linearGradient')
      .attr('id', id)
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    grad.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', color)
      .attr('stop-opacity', 0.2);
    grad.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', color)
      .attr('stop-opacity', 0.05);
  });
}

function gradientUrl(swarmColor: string): string {
  const index = SWARM_COLORS.indexOf(swarmColor);
  return `url(#hive-grad-${index >= 0 ? index : 0})`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderBackgroundGrid(
  g: Selection<SVGGElement, unknown, null, undefined>,
  config: HiveConfig,
  gridRadius: number,
): void {
  const bgGroup = g.append('g').attr('class', 'hive-bg-grid')
    .style('animation', 'hive-bg-breathe 8s ease-in-out infinite');

  for (let q = -gridRadius; q <= gridRadius; q++) {
    for (let r = -gridRadius; r <= gridRadius; r++) {
      if (Math.abs(q + r) > gridRadius) continue;
      const { x, y } = axialToCartesian({ q, r }, config.hexRadius, config.spacing);
      bgGroup.append('polygon')
        .attr('points', hexToPolygonPoints(x, y, config.hexRadius * 0.95))
        .attr('fill', 'none')
        .attr('stroke', 'var(--color-edge-muted)')
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.35);
    }
  }
}

function renderEmptyState(
  g: Selection<SVGGElement, unknown, null, undefined>,
  config: HiveConfig,
): void {
  g.selectAll('.hive-empty-state').remove();

  const emptyGroup = g.append('g').attr('class', 'hive-empty-state');
  const radius = 80;

  emptyGroup.append('polygon')
    .attr('points', hexToPolygonPoints(0, 0, radius))
    .attr('fill', 'none')
    .attr('stroke', 'var(--color-edge-emphasis)')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '8,6')
    .style('animation', 'hive-empty-pulse 2s ease-in-out infinite');

  emptyGroup.append('text')
    .attr('text-anchor', 'middle')
    .attr('y', -6)
    .attr('font-size', 15)
    .attr('font-weight', '600')
    .text('No Workers Active');

  emptyGroup.append('text')
    .attr('text-anchor', 'middle')
    .attr('y', 14)
    .attr('font-size', 12)
    .attr('opacity', 0.7)
    .text('Spawn workers to populate the hive');

  // Add a small hex icon above the text
  emptyGroup.append('polygon')
    .attr('points', hexToPolygonPoints(0, -40, config.hexRadius * 0.5))
    .attr('fill', 'none')
    .attr('stroke', 'var(--color-edge-emphasis)')
    .attr('stroke-width', 1)
    .attr('opacity', 0.5);
}

function renderHexCells(
  g: Selection<SVGGElement, unknown, null, undefined>,
  nodes: HiveNode[],
  config: HiveConfig,
  selectedHandle: string | null,
  onSelect: (node: HiveNode | null) => void,
  tooltip: HTMLElement | null,
  canvasEl: HTMLElement,
): void {
  const hexPoints = hexToPolygonPoints(0, 0, config.hexRadius * 0.92);
  const highlightPoints = hexToPolygonPoints(0, 0, config.hexRadius * 0.85);

  const cells = g.selectAll<SVGGElement, HiveNode>('.hive-cell')
    .data(nodes, (d: HiveNode) => d.handle);

  // EXIT — scale down and fade out, then remove
  cells.exit<HiveNode>()
    .transition()
    .duration(300)
    .ease(easeCubicOut)
    .attr('transform', function () {
      const current = select(this).attr('transform');
      return current + ' scale(0.3)';
    })
    .style('opacity', 0)
    .remove();

  // ENTER — create new cells with staggered scale animation
  const enter = cells.enter()
    .append('g')
    .attr('class', 'hive-cell')
    .attr('data-handle', d => d.handle)
    .attr('transform', d => {
      const { x, y } = axialToCartesian(d.hex, config.hexRadius, config.spacing);
      return `translate(${x},${y}) scale(0.3)`;
    })
    .style('cursor', 'pointer')
    .style('opacity', 0);

  // Gradient background fill
  enter.append('polygon')
    .attr('class', 'hex-bg')
    .attr('points', hexPoints)
    .attr('fill', d => gradientUrl(d.swarmColor));

  // Selection highlight ring (inner)
  enter.append('polygon')
    .attr('class', 'hex-highlight')
    .attr('points', highlightPoints)
    .attr('fill', 'none')
    .attr('stroke', 'transparent')
    .attr('stroke-width', 1.5)
    .style('transition', 'stroke 150ms ease');

  // Border
  enter.append('polygon')
    .attr('class', 'hex-border')
    .attr('points', hexPoints)
    .attr('fill', 'none')
    .attr('stroke', d => d.swarmColor)
    .attr('stroke-width', d => d.health === 'unhealthy' ? 2.5 : d.health === 'degraded' ? 2 : 1.5)
    .attr('stroke-dasharray', d => d.health === 'degraded' ? '4,3' : d.health === 'unhealthy' ? '2,2' : 'none')
    .style('animation', d =>
      d.health === 'unhealthy' ? 'hive-pulse-border 1s ease-in-out infinite' :
      d.health === 'degraded' ? 'hive-pulse-border 2s ease-in-out infinite' : 'none',
    );

  // State icon at top
  enter.append('path')
    .attr('class', 'state-icon')
    .attr('d', d => STATE_ICONS[d.state] ?? STATE_ICONS.stopped)
    .attr('transform', `translate(-6,${-config.hexRadius * 0.55 - 6}) scale(1)`)
    .attr('fill', 'none')
    .attr('stroke', d => STATE_COLORS[d.state] ?? 'var(--color-fg-muted)')
    .attr('stroke-width', 1.5)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round');

  // Handle label
  enter.append('text')
    .attr('class', 'hex-label')
    .attr('text-anchor', 'middle')
    .attr('y', 2)
    .attr('font-size', 10)
    .attr('font-family', 'var(--font-mono)')
    .attr('fill', 'var(--color-fg)')
    .style('pointer-events', 'none')
    .text(d => d.handle.length > 10 ? d.handle.slice(0, 9) + '\u2026' : d.handle);

  // Task subtitle
  enter.append('text')
    .attr('class', 'hex-task')
    .attr('text-anchor', 'middle')
    .attr('y', 14)
    .attr('font-size', 8)
    .attr('fill', 'var(--color-fg-secondary)')
    .style('pointer-events', 'none')
    .text(d => d.currentTool ? `\u25B6 ${d.currentTool}` : '');

  // Activity pulse circle (initially hidden)
  enter.append('circle')
    .attr('class', 'activity-pulse')
    .attr('r', 0)
    .attr('fill', 'none')
    .attr('stroke', d => d.swarmColor)
    .attr('stroke-width', 2)
    .attr('opacity', 0);

  // Staggered enter animation
  enter.transition()
    .delay((_d: HiveNode, i: number) => i * 40)
    .duration(config.animationDuration)
    .ease(easeCubicOut)
    .attr('transform', d => {
      const { x, y } = axialToCartesian(d.hex, config.hexRadius, config.spacing);
      return `translate(${x},${y}) scale(1)`;
    })
    .style('opacity', 1);

  // MERGE — update existing cells
  const merged = enter.merge(cells);

  // Update positions, borders, state icons for existing cells
  merged.select('.hex-border')
    .attr('stroke', d => d.swarmColor)
    .attr('stroke-width', d => d.health === 'unhealthy' ? 2.5 : d.health === 'degraded' ? 2 : 1.5)
    .attr('stroke-dasharray', d => d.health === 'degraded' ? '4,3' : d.health === 'unhealthy' ? '2,2' : 'none')
    .style('animation', d =>
      d.health === 'unhealthy' ? 'hive-pulse-border 1s ease-in-out infinite' :
      d.health === 'degraded' ? 'hive-pulse-border 2s ease-in-out infinite' : 'none',
    );

  merged.select('.state-icon')
    .attr('d', d => STATE_ICONS[d.state] ?? STATE_ICONS.stopped)
    .attr('stroke', d => STATE_COLORS[d.state] ?? 'var(--color-fg-muted)');

  merged.select('.hex-bg')
    .attr('fill', d => gradientUrl(d.swarmColor));

  // Selection highlight
  merged.select('.hex-highlight')
    .attr('stroke', d => d.handle === selectedHandle ? 'rgba(255,255,255,0.8)' : 'transparent');

  // Click handler
  merged.on('click', (_event: unknown, d: HiveNode) => {
    onSelect(d);
  });

  // Hover effects with tooltip
  merged.on('mouseover', function (this: SVGGElement, _event: MouseEvent, d: HiveNode) {
    select(this).select('.hex-bg')
      .transition().duration(150)
      .attr('opacity', 1);

    // Dim non-swarm hexes
    if (d.swarmId) {
      g.selectAll<SVGGElement, HiveNode>('.hive-cell')
        .filter((other: HiveNode) => other.swarmId !== d.swarmId)
        .transition().duration(150)
        .style('opacity', 0.4);
    }

    // Show tooltip
    if (tooltip) {
      const stateText = d.state.charAt(0).toUpperCase() + d.state.slice(1);
      const toolText = d.currentTool ? ` \u00B7 ${d.currentTool}` : '';
      tooltip.innerHTML = `
        <div class="hive-tooltip-handle">${escapeHtml(d.handle)}</div>
        <div class="hive-tooltip-meta">${escapeHtml(stateText)}${escapeHtml(toolText)}</div>
      `;
      tooltip.classList.add('visible');

      // Position via bounding rect
      const rect = (this as SVGGElement).getBoundingClientRect();
      const containerRect = canvasEl.getBoundingClientRect();
      tooltip.style.left = `${rect.left - containerRect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
      tooltip.style.top = `${rect.top - containerRect.top - tooltip.offsetHeight - 8}px`;
    }
  });

  merged.on('mouseout', function (this: SVGGElement) {
    select(this).select('.hex-bg')
      .transition().duration(150)
      .attr('opacity', 1);

    g.selectAll('.hive-cell')
      .transition().duration(150)
      .style('opacity', 1);

    if (tooltip) {
      tooltip.classList.remove('visible');
    }
  });
}

function pulseHex(
  g: Selection<SVGGElement, unknown, null, undefined>,
  handle: string,
  hexRadius: number,
): void {
  const cell = g.select(`[data-handle="${handle}"]`);
  if (cell.empty()) return;

  // Phase 1: Border flash
  cell.select('.hex-border')
    .transition().duration(100)
    .attr('stroke-width', 3)
    .transition().duration(400)
    .attr('stroke-width', 1.5);

  // Phase 2: Expanding ring
  cell.select('.activity-pulse')
    .attr('r', hexRadius * 0.5)
    .attr('opacity', 0.6)
    .transition().duration(700).ease(easeCubicOut)
    .attr('r', hexRadius * 1.4)
    .attr('opacity', 0);

  // Phase 3: Background flash
  cell.select('.hex-bg')
    .transition().duration(100)
    .attr('opacity', 2)  // boosted opacity for gradient
    .transition().duration(500)
    .attr('opacity', 1);
}

function renderDetailPanel(
  container: HTMLElement,
  node: HiveNode | null,
  recentActivity: WorkerActivity[],
): void {
  const panel = container.querySelector('.hive-detail-content');
  if (!panel) return;

  if (!node) {
    panel.innerHTML = `
      <div class="empty-state p-lg">
        <div class="empty-state-title">Select a Worker</div>
        <div class="empty-state-text">Click on a hex cell to see details</div>
      </div>
    `;
    return;
  }

  const healthClass = node.health === 'healthy' ? 'green' : node.health === 'degraded' ? 'yellow' : 'red';
  const stateClass = node.state === 'working' ? 'green' : node.state === 'ready' ? 'blue' : 'yellow';
  const initials = node.handle.slice(0, 2).toUpperCase();
  const workerActivities = recentActivity
    .filter(a => a.handle === node.handle)
    .slice(0, 6);

  panel.innerHTML = `
    <div style="border-top: 3px solid ${node.swarmColor}; padding: var(--spacing-md);">
      <div class="flex items-center gap-sm mb-md">
        <div class="worker-avatar" style="background: ${node.swarmColor}22; color: ${node.swarmColor};">${escapeHtml(initials)}</div>
        <div>
          <strong class="text-fg" style="font-size: 14px;">${escapeHtml(node.handle)}</strong>
          <div class="flex gap-xs mt-xs">
            <span class="badge ${stateClass}">${escapeHtml(node.state)}</span>
            <span class="badge ${healthClass}">${escapeHtml(node.health)}</span>
          </div>
        </div>
      </div>

      <dl class="hive-detail-grid mb-md">
        ${node.swarmName ? `
          <dt>Swarm</dt>
          <dd>
            <span class="inline-block" style="width:8px;height:8px;border-radius:50%;background:${node.swarmColor};margin-right:4px;vertical-align:middle;"></span>
            ${escapeHtml(node.swarmName)}
          </dd>
        ` : ''}
        ${node.currentTaskId ? `
          <dt>Task</dt>
          <dd><a href="#/tasks" class="font-mono" style="font-size:12px;">${escapeHtml(node.currentTaskId.slice(0, 8))}</a></dd>
        ` : ''}
        ${node.workingDir ? `
          <dt>Directory</dt>
          <dd class="font-mono" style="font-size:11px;word-break:break-all;">${escapeHtml(node.workingDir)}</dd>
        ` : ''}
        <dt>Uptime</dt>
        <dd>${escapeHtml(formatUptime(node.spawnedAt))}</dd>
      </dl>

      <div class="form-label mb-xs">Activity</div>
      ${workerActivities.length > 0 ? `
        <div class="hive-timeline">
          ${workerActivities.map(a => `
            <div class="hive-timeline-item">
              <span class="hive-timeline-tool">${escapeHtml(a.tool)}</span>
              <span class="hive-timeline-time">${escapeHtml(relativeTime(a.timestamp))}</span>
            </div>
          `).join('')}
        </div>
      ` : '<p class="text-fg-muted" style="font-size:12px;">No recent activity</p>'}

      <div style="margin-top: var(--spacing-lg);">
        <a href="#/worker/${encodeURIComponent(node.handle)}" class="btn btn-secondary btn-sm">View Terminal</a>
      </div>
    </div>
  `;
}

function renderLegend(legendEl: HTMLElement): void {
  const states: Array<{ label: string; cssClass: string }> = [
    { label: 'Starting', cssClass: 'bg-yellow' },
    { label: 'Ready', cssClass: 'bg-blue' },
    { label: 'Working', cssClass: 'bg-green' },
    { label: 'Stopping', cssClass: 'bg-purple' },
    { label: 'Stopped', cssClass: 'bg-fg-muted' },
  ];

  const miniHexPoints = hexToPolygonPoints(0, 0, 6);

  legendEl.innerHTML = states.map(s => {
    // Extract color from the CSS class for the mini hex fill
    const colorMap: Record<string, string> = {
      'bg-yellow': 'var(--color-yellow)',
      'bg-blue': 'var(--color-blue)',
      'bg-green': 'var(--color-green)',
      'bg-purple': 'var(--color-purple)',
      'bg-fg-muted': 'var(--color-fg-muted)',
    };
    const fill = colorMap[s.cssClass] ?? 'var(--color-fg-muted)';
    return `
      <div class="hive-legend-item">
        <svg width="14" height="14" viewBox="-7 -7 14 14">
          <polygon points="${miniHexPoints}" fill="${fill}" opacity="0.6" stroke="${fill}" stroke-width="0.8"/>
        </svg>
        ${s.label}
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function renderHive(container: HTMLElement): Promise<() => void> {
  const config = { ...DEFAULT_CONFIG };
  const occupancy = new HexOccupancy();
  const recentActivity: WorkerActivity[] = [];
  let selectedNode: HiveNode | null = null;
  let swarmFilter: string | null = null;
  const cleanups: (() => void)[] = [];

  // Build initial layout
  container.innerHTML = `
    <div class="hive-container">
      <div class="hive-grid">
        <div class="hive-controls">
          <button class="btn btn-secondary btn-sm" id="hive-zoom-in">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>
            </svg>
          </button>
          <button class="btn btn-secondary btn-sm" id="hive-zoom-out">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/>
            </svg>
          </button>
          <button class="btn btn-secondary btn-sm" id="hive-zoom-reset">Reset</button>
        </div>
        <div id="hive-canvas" class="w-full h-full" style="position:relative;">
          <div class="hive-tooltip" id="hive-tooltip"></div>
        </div>
        <div class="hive-legend" id="hive-legend"></div>
      </div>

      <div class="hive-sidebar" id="hive-sidebar">
        <button class="hive-sidebar-close" id="hive-sidebar-close">&times;</button>
        <div class="hive-filter-card">
          <div class="form-label">Filter by Swarm</div>
          <select class="form-input mt-xs" id="hive-swarm-filter">
            <option value="">All Swarms</option>
          </select>
        </div>
        <div class="hive-detail-card">
          <div class="hive-detail-content">
            <div class="empty-state p-lg">
              <div class="empty-state-title">Select a Worker</div>
              <div class="empty-state-text">Click on a hex cell to see details</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render the legend with mini hex SVGs
  const legendEl = document.getElementById('hive-legend');
  if (legendEl) renderLegend(legendEl);

  // Set up SVG with D3
  const canvasEl = document.getElementById('hive-canvas')!;
  const tooltip = document.getElementById('hive-tooltip');
  const width = canvasEl.clientWidth || 800;
  const height = canvasEl.clientHeight || 600;

  const svg = select(canvasEl)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `${-width / 2} ${-height / 2} ${width} ${height}`);

  // Insert gradient defs
  ensureGradientDefs(svg as Selection<SVGSVGElement, unknown, null, undefined>);

  const g = svg.append('g');

  // Zoom behavior
  const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 3])
    .on('zoom', (event: { transform: unknown }) => {
      g.attr('transform', event.transform as string);
    });

  (svg as Selection<SVGSVGElement, unknown, null, undefined>).call(zoomBehavior);

  // Background grid
  renderBackgroundGrid(g, config, 6);

  // Render function
  function refresh(): void {
    const workers = store.get('workers') ?? [];
    const swarms = store.get('swarms') ?? [];

    // Remove workers that no longer exist
    const workerHandles = new Set(workers.map(w => w.handle));
    for (const handle of [...(occupancy as HexOccupancy)['reverseMap'].keys()]) {
      if (!workerHandles.has(handle)) {
        occupancy.release(handle);
      }
    }

    const nodes = buildHiveNodes(workers, swarms, occupancy);

    // Show empty state or hex cells
    if (nodes.length === 0) {
      g.selectAll('.hive-cell').remove();
      if (g.select('.hive-empty-state').empty()) {
        renderEmptyState(g, config);
      }
    } else {
      g.selectAll('.hive-empty-state').remove();
      renderHexCells(
        g, nodes, config,
        selectedNode?.handle ?? null,
        selectNode, tooltip, canvasEl,
      );

      if (swarmFilter) {
        nodes.forEach(n => {
          if (n.swarmId !== swarmFilter) {
            g.select(`[data-handle="${n.handle}"]`)
              .style('opacity', 0.2);
          }
        });
      }
    }

    // Update swarm filter dropdown
    updateSwarmFilter(swarms);

    // Update detail panel if selected worker still exists
    if (selectedNode) {
      const updated = nodes.find(n => n.handle === selectedNode!.handle);
      if (updated) {
        selectedNode = updated;
        renderDetailPanel(container, selectedNode, recentActivity);
      } else {
        selectedNode = null;
        renderDetailPanel(container, null, recentActivity);
      }
    }
  }

  function selectNode(node: HiveNode | null): void {
    selectedNode = node;
    renderDetailPanel(container, node, recentActivity);

    // Update highlight rings
    g.selectAll<SVGGElement, HiveNode>('.hive-cell')
      .select('.hex-highlight')
      .attr('stroke', (d: HiveNode) =>
        d.handle === node?.handle ? 'rgba(255,255,255,0.8)' : 'transparent',
      );

    // Mobile: open sidebar
    const sidebar = document.getElementById('hive-sidebar');
    if (sidebar && node && window.innerWidth < 768) {
      sidebar.classList.add('open');
    }
  }

  function updateSwarmFilter(swarms: SwarmInfo[]): void {
    const filterEl = document.getElementById('hive-swarm-filter') as HTMLSelectElement | null;
    if (!filterEl) return;

    const currentValue = filterEl.value;
    filterEl.innerHTML = '<option value="">All Swarms</option>' +
      swarms.map((s, i) => {
        const color = SWARM_COLORS[(i + 1) % SWARM_COLORS.length];
        return `<option value="${escapeHtml(s.id)}" style="color: ${color};">${escapeHtml(s.name)}</option>`;
      }).join('');
    filterEl.value = currentValue;
  }

  // Initial render
  refresh();

  // Store subscriptions
  const unsubWorkers = store.subscribe('workers', () => refresh());
  cleanups.push(unsubWorkers);

  const unsubSwarms = store.subscribe('swarms', () => refresh());
  cleanups.push(unsubSwarms);

  // WebSocket subscription for tool activity
  const unsubOutput = wsManager.on('worker:output', (data: unknown) => {
    const { handle, output } = data as { handle: string; output: unknown };

    let toolName: string | undefined;
    let event = output;
    if (typeof output === 'string') {
      try { event = JSON.parse(output); } catch { /* ignore */ }
    }

    if (event && typeof event === 'object') {
      const rec = event as Record<string, unknown>;
      if (rec.type === 'assistant') {
        const message = rec.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (Array.isArray(content)) {
          const toolBlock = content.find((b: Record<string, unknown>) => b.type === 'tool_use') as Record<string, unknown> | undefined;
          if (toolBlock?.name) {
            toolName = toolBlock.name as string;
          }
        }
      }
    }

    if (toolName) {
      recentActivity.unshift({ handle, tool: toolName, timestamp: Date.now() });
      if (recentActivity.length > 100) recentActivity.length = 100;

      // Triple-phase pulse effect
      pulseHex(g, handle, config.hexRadius);

      // Update tool name on hex label
      g.select(`[data-handle="${handle}"] .hex-task`)
        .text(`\u25B6 ${toolName}`);

      // Update detail panel if this worker is selected
      if (selectedNode?.handle === handle) {
        selectedNode.currentTool = toolName;
        selectedNode.lastActivity = Date.now();
        renderDetailPanel(container, selectedNode, recentActivity);
      }
    }
  });
  cleanups.push(unsubOutput);

  // Swarm filter handler
  document.getElementById('hive-swarm-filter')?.addEventListener('change', (e) => {
    const value = (e.target as HTMLSelectElement).value;
    swarmFilter = value || null;
    refresh();
  });

  // Mobile sidebar close
  document.getElementById('hive-sidebar-close')?.addEventListener('click', () => {
    document.getElementById('hive-sidebar')?.classList.remove('open');
  });

  // Zoom controls
  const svgSelection = select('#hive-canvas svg') as Selection<SVGSVGElement, unknown, HTMLElement, unknown>;

  document.getElementById('hive-zoom-in')?.addEventListener('click', () => {
    svgSelection.transition().duration(300).call(
      zoomBehavior.scaleBy as unknown as (transition: unknown, k: number) => void, 1.5,
    );
  });

  document.getElementById('hive-zoom-out')?.addEventListener('click', () => {
    svgSelection.transition().duration(300).call(
      zoomBehavior.scaleBy as unknown as (transition: unknown, k: number) => void, 0.67,
    );
  });

  document.getElementById('hive-zoom-reset')?.addEventListener('click', () => {
    svgSelection.transition().duration(300).call(
      zoomBehavior.transform as unknown as (transition: unknown, transform: unknown) => void, zoomIdentity,
    );
  });

  // Polling fallback — refresh worker list every 5s
  const pollInterval = setInterval(() => {
    const workers = store.get('workers');
    if (workers) refresh();
  }, 5000);
  cleanups.push(() => clearInterval(pollInterval));

  // Cleanup
  return () => {
    cleanups.forEach(fn => fn());
    occupancy.clear();
  };
}
