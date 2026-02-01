/**
 * Hex Hive View
 * Real-time hexagonal grid visualization of fleet workers.
 * Each worker occupies a hex cell, colored by swarm, with activity pulse indicators.
 */

import { select } from 'd3-selection';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
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
  '#58a6ff', // Blue (default / no swarm)
  '#3fb950', // Green
  '#a371f7', // Purple
  '#d29922', // Yellow
  '#f47067', // Red
  '#39d4d4', // Teal
  '#f778ba', // Pink
  '#a3e635', // Lime
];

const STATE_COLORS: Record<string, string> = {
  starting: 'var(--color-yellow)',
  ready: 'var(--color-blue)',
  working: 'var(--color-green)',
  stopping: 'var(--color-purple)',
  stopped: 'var(--color-fg-muted)',
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
    };
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderBackgroundGrid(
  g: Selection<SVGGElement, unknown, null, undefined>,
  config: HiveConfig,
  gridRadius: number,
): void {
  const bgGroup = g.append('g').attr('class', 'hive-bg-grid');

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

function renderHexCells(
  g: Selection<SVGGElement, unknown, null, undefined>,
  nodes: HiveNode[],
  config: HiveConfig,
  onSelect: (node: HiveNode | null) => void,
): void {
  // Remove old cells
  g.selectAll('.hive-cell').remove();

  const cells = g.selectAll<SVGGElement, HiveNode>('.hive-cell')
    .data(nodes, (d: HiveNode) => d.handle)
    .join(
      enter => {
        const cell = enter.append('g')
          .attr('class', 'hive-cell')
          .attr('data-handle', d => d.handle)
          .attr('transform', d => {
            const { x, y } = axialToCartesian(d.hex, config.hexRadius, config.spacing);
            return `translate(${x},${y})`;
          })
          .style('cursor', 'pointer')
          .style('opacity', 0);

        // Pre-compute hex points (same for every cell since they're centered at 0,0)
        const hexPoints = hexToPolygonPoints(0, 0, config.hexRadius * 0.92);

        // Background fill
        cell.append('polygon')
          .attr('class', 'hex-bg')
          .attr('points', hexPoints)
          .attr('fill', d => d.swarmColor)
          .attr('opacity', 0.15);

        // Border
        cell.append('polygon')
          .attr('class', 'hex-border')
          .attr('points', hexPoints)
          .attr('fill', 'none')
          .attr('stroke', d => d.swarmColor)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', d => d.health === 'degraded' ? '4,3' : d.health === 'unhealthy' ? '2,2' : 'none');

        // State dot at top
        cell.append('circle')
          .attr('class', 'state-dot')
          .attr('cx', 0)
          .attr('cy', -config.hexRadius * 0.55)
          .attr('r', 4)
          .attr('fill', d => STATE_COLORS[d.state] ?? 'var(--color-fg-muted)');

        // Handle label
        cell.append('text')
          .attr('class', 'hex-label')
          .attr('text-anchor', 'middle')
          .attr('y', 2)
          .attr('font-size', 10)
          .attr('font-family', 'var(--font-mono)')
          .attr('fill', 'var(--color-fg)')
          .style('pointer-events', 'none')
          .text(d => d.handle.length > 10 ? d.handle.slice(0, 9) + '\u2026' : d.handle);

        // Task subtitle
        cell.append('text')
          .attr('class', 'hex-task')
          .attr('text-anchor', 'middle')
          .attr('y', 14)
          .attr('font-size', 8)
          .attr('fill', 'var(--color-fg-secondary)')
          .style('pointer-events', 'none')
          .text(d => d.currentTool ? `\u25B6 ${d.currentTool}` : '');

        // Activity pulse circle (initially hidden)
        cell.append('circle')
          .attr('class', 'activity-pulse')
          .attr('r', 0)
          .attr('fill', 'none')
          .attr('stroke', d => d.swarmColor)
          .attr('stroke-width', 2)
          .attr('opacity', 0);

        // Enter animation
        cell.transition()
          .duration(config.animationDuration)
          .style('opacity', 1);

        return cell;
      },
    );

  // Click handler
  cells.on('click', (_event: unknown, d: HiveNode) => {
    onSelect(d);
  });

  // Hover effects
  cells.on('mouseover', function (this: SVGGElement, _event: unknown, d: HiveNode) {
    select(this).select('.hex-bg')
      .transition().duration(150)
      .attr('opacity', 0.3);

    // Dim non-swarm hexes
    if (d.swarmId) {
      g.selectAll<SVGGElement, HiveNode>('.hive-cell')
        .filter((other: HiveNode) => other.swarmId !== d.swarmId)
        .transition().duration(150)
        .style('opacity', 0.4);
    }
  });

  cells.on('mouseout', function (this: SVGGElement) {
    select(this).select('.hex-bg')
      .transition().duration(150)
      .attr('opacity', 0.15);

    g.selectAll('.hive-cell')
      .transition().duration(150)
      .style('opacity', 1);
  });
}

function pulseHex(
  g: Selection<SVGGElement, unknown, null, undefined>,
  handle: string,
  hexRadius: number,
): void {
  const cell = g.select(`[data-handle="${handle}"]`);
  if (cell.empty()) return;

  cell.select('.activity-pulse')
    .attr('r', 0)
    .attr('opacity', 0.8)
    .transition().duration(600)
    .attr('r', hexRadius * 1.2)
    .attr('opacity', 0);
}

function renderDetailPanel(container: HTMLElement, node: HiveNode | null, recentActivity: WorkerActivity[]): void {
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
  const workerActivities = recentActivity
    .filter(a => a.handle === node.handle)
    .slice(0, 5);

  panel.innerHTML = `
    <div class="p-md">
      <div class="flex items-center gap-sm mb-md">
        <span class="status-dot ${node.health}"></span>
        <strong class="text-fg text-[16px]">${escapeHtml(node.handle)}</strong>
      </div>

      <div class="flex gap-sm mb-md">
        <span class="badge ${stateClass}">${escapeHtml(node.state)}</span>
        <span class="badge ${healthClass}">${escapeHtml(node.health)}</span>
      </div>

      ${node.swarmName ? `
        <div class="form-label">Swarm</div>
        <p class="text-fg mb-md">
          <span class="inline-block size-2 rounded-full mr-1.5" style="background: ${node.swarmColor};"></span>
          ${escapeHtml(node.swarmName)}
        </p>
      ` : ''}

      ${node.currentTaskId ? `
        <div class="form-label">Current Task</div>
        <p class="mb-md">
          <a href="#/tasks" class="font-mono text-xs">
            ${escapeHtml(node.currentTaskId.slice(0, 8))}
          </a>
        </p>
      ` : ''}

      ${node.workingDir ? `
        <div class="form-label">Working Directory</div>
        <p class="font-mono text-sm text-fg-secondary mb-md break-all">
          ${escapeHtml(node.workingDir)}
        </p>
      ` : ''}

      <div class="form-label">Recent Tools</div>
      ${workerActivities.length > 0 ? `
        <div class="flex flex-col gap-xs">
          ${workerActivities.map(a => `
            <div class="flex justify-between items-center text-xs">
              <span class="font-mono text-yellow">${escapeHtml(a.tool)}</span>
              <span class="text-fg-muted">${new Date(a.timestamp).toLocaleTimeString()}</span>
            </div>
          `).join('')}
        </div>
      ` : '<p class="text-fg-muted text-xs">No recent activity</p>'}

      <div class="mt-lg flex gap-sm">
        <a href="#/worker/${encodeURIComponent(node.handle)}" class="btn btn-secondary btn-sm">View Terminal</a>
      </div>
    </div>
  `;
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
        <div id="hive-canvas" class="w-full h-full"></div>
        <div class="hive-legend">
          <div class="hive-legend-item">
            <span class="hive-legend-dot bg-yellow"></span>
            Starting
          </div>
          <div class="hive-legend-item">
            <span class="hive-legend-dot bg-blue"></span>
            Ready
          </div>
          <div class="hive-legend-item">
            <span class="hive-legend-dot bg-green"></span>
            Working
          </div>
          <div class="hive-legend-item">
            <span class="hive-legend-dot bg-purple"></span>
            Stopping
          </div>
          <div class="hive-legend-item">
            <span class="hive-legend-dot bg-fg-muted"></span>
            Stopped
          </div>
        </div>
      </div>

      <div class="hive-sidebar">
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

  // Set up SVG with D3
  const canvasEl = document.getElementById('hive-canvas')!;
  const width = canvasEl.clientWidth || 800;
  const height = canvasEl.clientHeight || 600;

  const svg = select(canvasEl)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `${-width / 2} ${-height / 2} ${width} ${height}`);

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

    // Render all cells, then dim non-matching if filtered
    renderHexCells(g, nodes, config, selectNode);

    if (swarmFilter) {
      nodes.forEach(n => {
        if (n.swarmId !== swarmFilter) {
          g.select(`[data-handle="${n.handle}"]`)
            .style('opacity', 0.2);
        }
      });
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

    // Parse tool name from Claude event
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

      // Pulse the hex cell
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
