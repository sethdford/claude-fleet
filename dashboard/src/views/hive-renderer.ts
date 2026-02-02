/**
 * Hex Hive Renderer
 * SVG rendering functions for the hexagonal grid visualization.
 * Extracted from hive.ts to keep files under 500 lines.
 */

import { select } from 'd3-selection';
import { easeCubicOut } from 'd3-ease';
import 'd3-transition';
import type { Selection } from 'd3-selection';

import { escapeHtml } from '@/utils/escape-html';
import {
  axialToCartesian,
  hexToPolygonPoints,
} from '@/utils/hex-geometry';
import type { HiveNode, HiveConfig, WorkerActivity } from '@/types/hive';

// ---------------------------------------------------------------------------
// Constants (shared with hive.ts)
// ---------------------------------------------------------------------------

export const SWARM_COLORS = [
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
  working:  'M6 1.5A1.5 1.5 0 007.5 3h0A1.5 1.5 0 006 1.5zM3.8 4.2l1.5 2.5L3 9h2l1-1.5L7 9h2L6.7 6.7l1.5-2.5z',
  ready:    'M2.5 6.5L5 9l4.5-5',
  starting: 'M6 10V3M3 5.5L6 2.5 9 5.5',
  stopping: 'M6 2v7M3 6.5L6 9.5 9 6.5',
  stopped:  'M3 6h6',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatUptime(spawnedAt: number | undefined): string {
  if (!spawnedAt) return '—';
  const seconds = Math.floor((Date.now() - spawnedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function relativeTime(timestamp: number): string {
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

export function ensureGradientDefs(
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

export function gradientUrl(swarmColor: string): string {
  const index = SWARM_COLORS.indexOf(swarmColor);
  return `url(#hive-grad-${index >= 0 ? index : 0})`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderBackgroundGrid(
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

export function renderEmptyState(
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

export function renderHexCells(
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

export function pulseHex(
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
    .attr('opacity', 2)
    .transition().duration(500)
    .attr('opacity', 1);
}

export function renderDetailPanel(
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

export function renderLegend(legendEl: HTMLElement): void {
  const states: Array<{ label: string; cssClass: string }> = [
    { label: 'Starting', cssClass: 'bg-yellow' },
    { label: 'Ready', cssClass: 'bg-blue' },
    { label: 'Working', cssClass: 'bg-green' },
    { label: 'Stopping', cssClass: 'bg-purple' },
    { label: 'Stopped', cssClass: 'bg-fg-muted' },
  ];

  const miniHexPoints = hexToPolygonPoints(0, 0, 6);

  legendEl.innerHTML = states.map(s => {
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
