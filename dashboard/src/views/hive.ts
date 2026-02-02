/**
 * Hex Hive View
 * Real-time hexagonal grid visualization of fleet workers.
 * Each worker occupies a hex cell, colored by swarm, with activity pulse indicators.
 * SVG rendering functions live in hive-renderer.ts.
 */

import { select } from 'd3-selection';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import 'd3-transition';
import type { Selection } from 'd3-selection';

import store from '@/store';
import wsManager from '@/websocket';
import { escapeHtml } from '@/utils/escape-html';
import { HexOccupancy } from '@/utils/hex-geometry';
import type { HiveNode, HiveConfig, WorkerActivity } from '@/types/hive';
import type { WorkerInfo, SwarmInfo } from '@/types';

import {
  SWARM_COLORS,
  ensureGradientDefs,
  renderBackgroundGrid,
  renderEmptyState,
  renderHexCells,
  pulseHex,
  renderDetailPanel,
  renderLegend,
} from './hive-renderer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: HiveConfig = {
  hexRadius: 32,
  spacing: 1.08,
  animationDuration: 300,
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
