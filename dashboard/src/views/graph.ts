/**
 * Dependency Graph View
 * Interactive D3 force-directed graph for TLDR dependency visualization
 */

import { select, selectAll } from 'd3-selection';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import { drag as d3Drag } from 'd3-drag';
import 'd3-transition'; // Side-effect import — augments Selection with .transition()
import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import type { Selection } from 'd3-selection';
import store from '@/store';
import { getDependencyGraph, getTLDRStats, getFileSummary } from '@/api';
import toast from '@/components/toast';
import { escapeHtml, escapeAttr } from '@/utils/escape-html';

// File extension to color mapping
const EXTENSION_COLORS: Record<string, string> = {
  '.ts': '#3178c6',   // TypeScript blue
  '.tsx': '#3178c6',
  '.js': '#f7df1e',   // JavaScript yellow
  '.jsx': '#61dafb',  // React cyan
  '.json': '#8bc34a', // JSON green
  '.css': '#264de4',  // CSS blue
  '.scss': '#cd6799', // SCSS pink
  '.html': '#e34c26', // HTML orange
  '.md': '#083fa1',   // Markdown blue
  '.sql': '#e38c00',  // SQL orange
  '.go': '#00add8',   // Go cyan
  '.py': '#3776ab',   // Python blue
  '.rs': '#dea584',   // Rust orange
  '.sh': '#4eaa25',   // Shell green
  '.yml': '#cb171e',  // YAML red
  '.yaml': '#cb171e',
};

interface GraphNode extends SimulationNodeDatum {
  id: string;
  path: string;
  summary?: string;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type?: string;
}

interface GraphDataShape {
  nodes?: { path?: string; id?: string; summary?: string }[];
  edges?: { source?: string; from?: string; target?: string; to?: string; type?: string }[];
  links?: { source?: string; from?: string; target?: string; to?: string; type?: string }[];
  nodeCount?: number;
  edgeCount?: number;
  error?: string;
}

interface TLDRStatsShape {
  summaries?: number;
  dependencies?: number;
  overviews?: number;
  coverage?: string;
}

/**
 * Get color for a file path
 */
function getFileColor(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'));
  return EXTENSION_COLORS[ext] || '#8b949e';
}

/**
 * Get short name from path
 */
function getShortName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * Render the D3 force graph visualization
 */
function renderD3Graph(container: HTMLElement, graphData: GraphDataShape): Simulation<GraphNode, GraphLink> | null {
  // Clear container
  container.innerHTML = '';

  if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
    container.innerHTML = `
      <div class="empty-state h-full">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="2"/>
          <circle cx="6" cy="6" r="2"/>
          <circle cx="18" cy="6" r="2"/>
          <circle cx="6" cy="18" r="2"/>
          <circle cx="18" cy="18" r="2"/>
        </svg>
        <div class="empty-state-title">No Dependency Data</div>
        <div class="empty-state-text">Run TLDR analysis to generate dependency graph</div>
      </div>
    `;
    return null;
  }

  const width = container.clientWidth;
  const height = container.clientHeight || 600;

  // Create SVG
  const svg = select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height].join(' '));

  // Add zoom behavior
  const g = svg.append('g');

  const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event: { transform: unknown }) => {
      g.attr('transform', event.transform as string);
    });

  (svg as Selection<SVGSVGElement, unknown, null, undefined>).call(zoomBehavior);

  // Define arrow marker
  svg.append('defs').append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 15)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('fill', '#30363d')
    .attr('d', 'M0,-5L10,0L0,5');

  // Process nodes and links
  const nodes: GraphNode[] = graphData.nodes.map((n) => ({
    id: n.path || n.id || '',
    path: n.path || n.id || '',
    summary: n.summary,
    ...n,
  }));

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const links: GraphLink[] = (graphData.edges || graphData.links || [])
    .filter((e) => nodeMap.has(e.source || e.from || '') && nodeMap.has(e.target || e.to || ''))
    .map((e) => ({
      source: e.source || e.from || '',
      target: e.target || e.to || '',
      type: e.type,
    }));

  // Create simulation
  const simulation = forceSimulation<GraphNode>(nodes)
    .force('link', forceLink<GraphNode, GraphLink>(links).id((d: GraphNode) => d.id).distance(100))
    .force('charge', forceManyBody().strength(-300))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collision', forceCollide().radius(30));

  // Draw links
  const link = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.6)
    .attr('marker-end', 'url(#arrow)');

  // Drag handlers
  function dragstarted(event: { active: number; subject: GraphNode }): void {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event: { subject: GraphNode; x: number; y: number }): void {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragended(event: { active: number; subject: GraphNode }): void {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  // Draw nodes
  const node = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .call(d3Drag<SVGGElement, GraphNode>()
      .on('start', dragstarted as unknown as (event: unknown, d: GraphNode) => void)
      .on('drag', dragged as unknown as (event: unknown, d: GraphNode) => void)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('end', dragended as unknown as (event: unknown, d: GraphNode) => void) as any);

  // Node circles
  node.append('circle')
    .attr('r', 8)
    .attr('fill', (d: GraphNode) => getFileColor(d.path))
    .attr('stroke', '#0d1117')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer');

  // Node labels
  node.append('text')
    .text((d: GraphNode) => getShortName(d.path))
    .attr('x', 12)
    .attr('y', 4)
    .attr('font-size', 11)
    .attr('fill', '#c9d1d9')
    .attr('font-family', 'var(--font-mono)')
    .style('pointer-events', 'none');

  // Tooltips
  node.append('title')
    .text((d: GraphNode) => `${d.path}\n${d.summary || ''}`);

  // Node click handler
  node.on('click', (_event: unknown, d: GraphNode) => {
    showNodeDetail(d);
  });

  // Highlight on hover
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node.on('mouseover', function(this: any, _event: unknown, d: GraphNode) {
    select(this).select('circle')
      .transition()
      .duration(200)
      .attr('r', 12);

    // Highlight connected nodes and links
    const connectedNodes = new Set<string>();
    links.forEach((l) => {
      const sourceId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
      const targetId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
      if (sourceId === d.id) connectedNodes.add(targetId);
      if (targetId === d.id) connectedNodes.add(sourceId);
    });

    node.style('opacity', (n: GraphNode) => connectedNodes.has(n.id) || n.id === d.id ? 1 : 0.3);
    link.style('opacity', (l: GraphLink) => {
      const sourceId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
      const targetId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
      return sourceId === d.id || targetId === d.id ? 1 : 0.1;
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node.on('mouseout', function(this: any) {
    select(this).select('circle')
      .transition()
      .duration(200)
      .attr('r', 8);

    node.style('opacity', 1);
    link.style('opacity', 0.6);
  });

  // Update positions on tick
  simulation.on('tick', () => {
    link
      .attr('x1', (d: GraphLink) => (d.source as GraphNode).x!)
      .attr('y1', (d: GraphLink) => (d.source as GraphNode).y!)
      .attr('x2', (d: GraphLink) => (d.target as GraphNode).x!)
      .attr('y2', (d: GraphLink) => (d.target as GraphNode).y!);

    node.attr('transform', (d: GraphNode) => `translate(${d.x},${d.y})`);
  });

  return simulation;
}

/**
 * Show node detail panel
 */
function showNodeDetail(nodeData: GraphNode): void {
  const detailPanel = document.getElementById('node-detail');
  if (!detailPanel) return;

  detailPanel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title break-all">${escapeHtml(getShortName(nodeData.path))}</h3>
      </div>
      <div class="p-md">
        <div class="form-label">Path</div>
        <p class="font-mono text-sm text-fg-secondary break-all mb-md">
          ${escapeHtml(nodeData.path)}
        </p>

        ${nodeData.summary ? `
          <div class="form-label">Summary</div>
          <p class="text-fg leading-relaxed">
            ${escapeHtml(nodeData.summary)}
          </p>
        ` : ''}

        <button class="btn btn-secondary btn-sm mt-md" id="fetch-summary">
          Fetch Full Summary
        </button>
      </div>
    </div>
  `;

  document.getElementById('fetch-summary')?.addEventListener('click', async () => {
    try {
      const data = await getFileSummary(nodeData.path) as { summary?: string | { summary?: string } };
      if (data.summary) {
        const summaryText = typeof data.summary === 'string' ? data.summary : (data.summary as { summary?: string }).summary || '';
        const content = `
          <div class="form-label">Summary</div>
          <p class="text-fg leading-relaxed whitespace-pre-wrap">
            ${escapeHtml(summaryText)}
          </p>
        `;
        const existingSummary = detailPanel.querySelector('.form-label + p');
        if (existingSummary) {
          existingSummary.parentElement!.innerHTML = content;
        }
      }
    } catch (e) {
      toast.error('Failed to fetch summary: ' + (e as Error).message);
    }
  });
}

// Common entry point patterns to try
const COMMON_ENTRY_POINTS = [
  'src/index.ts',
  'src/server.ts',
  'src/main.ts',
  'src/app.ts',
  'index.ts',
  'server.ts',
  'main.ts',
  'src/index.js',
  'src/server.js',
  'index.js',
];

/**
 * Render the graph view
 */
export async function renderGraph(container: HTMLElement): Promise<() => void> {
  let graphData = store.get('dependencyGraph') as GraphDataShape | undefined;
  let simulation: Simulation<GraphNode, GraphLink> | null = null;
  let currentRootFiles = (store.get('graphRootFiles') as string[] | undefined) || [];

  container.innerHTML = `
    <div class="graph-container">
      <div class="graph-main">
        <div class="graph-controls">
          <button class="btn btn-secondary btn-sm" id="zoom-in">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>
            </svg>
          </button>
          <button class="btn btn-secondary btn-sm" id="zoom-out">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/>
            </svg>
          </button>
          <button class="btn btn-secondary btn-sm" id="zoom-reset">Reset</button>
          <button class="btn btn-primary btn-sm" id="refresh-graph">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Refresh
          </button>
        </div>

        <div id="graph-canvas" class="w-full h-full"></div>

        <div class="graph-legend">
          <div class="legend-item">
            <span class="legend-dot" style="background: #3178c6;"></span>
            TypeScript
          </div>
          <div class="legend-item">
            <span class="legend-dot" style="background: #f7df1e;"></span>
            JavaScript
          </div>
          <div class="legend-item">
            <span class="legend-dot" style="background: #8bc34a;"></span>
            JSON
          </div>
          <div class="legend-item">
            <span class="legend-dot" style="background: #264de4;"></span>
            CSS
          </div>
          <div class="legend-item">
            <span class="legend-dot" style="background: #8b949e;"></span>
            Other
          </div>
        </div>
      </div>

      <div class="graph-sidebar">
        <div class="root-files-input">
          <div class="form-label">Entry Point Files</div>
          <div class="form-help text-[11px] text-fg-secondary mb-sm">
            Specify root files to trace dependencies from
          </div>
          <div id="root-files-tags" class="mb-sm"></div>
          <div class="flex gap-sm">
            <input type="text" class="form-input flex-1" id="root-file-input" placeholder="src/index.ts">
            <button class="btn btn-secondary btn-sm" id="add-root-file">Add</button>
          </div>
          <div class="suggested-files" id="suggested-files"></div>
        </div>

        <div class="graph-search">
          <div class="form-label">Search Files</div>
          <input type="text" class="form-input" id="graph-search" placeholder="Filter by filename...">
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Stats</h3>
          </div>
          <div class="p-md" id="graph-stats">
            <div class="loading">
              <div class="spinner"></div>
            </div>
          </div>
        </div>

        <div id="node-detail">
          <div class="card">
            <div class="empty-state p-lg">
              <div class="empty-state-title">Select a Node</div>
              <div class="empty-state-text">Click on a file node to see details</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render root file tags
  function renderRootFileTags(): void {
    const tagsContainer = document.getElementById('root-files-tags');
    if (!tagsContainer) return;

    if (currentRootFiles.length === 0) {
      tagsContainer.innerHTML = '<span class="text-fg-muted text-xs">No files selected</span>';
      return;
    }

    tagsContainer.innerHTML = currentRootFiles.map((file: string) => `
      <span class="root-file-tag">
        <span class="font-mono">${escapeHtml(file)}</span>
        <button data-file="${escapeAttr(file)}">&times;</button>
      </span>
    `).join('');

    // Add remove handlers
    tagsContainer.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const file = (btn as HTMLElement).dataset.file;
        currentRootFiles = currentRootFiles.filter((f: string) => f !== file);
        store.set('graphRootFiles', currentRootFiles);
        renderRootFileTags();
        renderSuggestedFiles();
      });
    });
  }

  // Render suggested files
  function renderSuggestedFiles(): void {
    const suggestedContainer = document.getElementById('suggested-files');
    if (!suggestedContainer) return;

    const suggestions = COMMON_ENTRY_POINTS.filter((f: string) => !currentRootFiles.includes(f));
    if (suggestions.length === 0) {
      suggestedContainer.innerHTML = '';
      return;
    }

    suggestedContainer.innerHTML = `
      <span class="text-[11px] text-fg-muted">Suggestions:</span>
      ${suggestions.slice(0, 5).map((file: string) => `
        <button class="suggested-file" data-file="${escapeAttr(file)}">${escapeHtml(file)}</button>
      `).join('')}
    `;

    suggestedContainer.querySelectorAll('.suggested-file').forEach((btn) => {
      btn.addEventListener('click', () => {
        const file = (btn as HTMLElement).dataset.file;
        if (file && !currentRootFiles.includes(file)) {
          currentRootFiles.push(file);
          store.set('graphRootFiles', currentRootFiles);
          renderRootFileTags();
          renderSuggestedFiles();
        }
      });
    });
  }

  // Add root file handler
  function addRootFile(): void {
    const input = document.getElementById('root-file-input') as HTMLInputElement | null;
    const file = input?.value?.trim();
    if (file && !currentRootFiles.includes(file)) {
      currentRootFiles.push(file);
      store.set('graphRootFiles', currentRootFiles);
      renderRootFileTags();
      renderSuggestedFiles();
      if (input) input.value = '';
    }
  }

  document.getElementById('add-root-file')?.addEventListener('click', addRootFile);
  document.getElementById('root-file-input')?.addEventListener('keypress', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      addRootFile();
    }
  });

  // Initial render of tags
  renderRootFileTags();
  renderSuggestedFiles();

  // Fetch graph data
  async function fetchGraphData(): Promise<void> {
    const canvas = document.getElementById('graph-canvas');

    // Check if we have root files
    if (currentRootFiles.length === 0) {
      if (canvas) {
        canvas.innerHTML = `
          <div class="empty-state h-full">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
            <div class="empty-state-title">Specify Entry Points</div>
            <div class="empty-state-text">
              Add one or more entry point files to trace the dependency graph from.<br>
              Common entry points include <code>src/index.ts</code> or <code>src/server.ts</code>.
            </div>
          </div>
        `;
      }

      // Still fetch stats
      try {
        const stats = await getTLDRStats() as TLDRStatsShape;
        renderStats(stats);
      } catch (e) {
        console.error('Failed to fetch TLDR stats:', e);
      }
      return;
    }

    // Show loading state
    if (canvas) {
      canvas.innerHTML = `
        <div class="loading h-full flex items-center justify-center">
          <div class="spinner"></div>
        </div>
      `;
    }

    try {
      graphData = await getDependencyGraph(currentRootFiles, 5) as GraphDataShape;
      store.set('dependencyGraph', graphData);

      const stats = await getTLDRStats() as TLDRStatsShape;
      renderStats(stats);

      if (graphData.error) {
        canvas!.innerHTML = `
          <div class="empty-state h-full">
            <div class="empty-state-title">No Dependency Data</div>
            <div class="empty-state-text">${escapeHtml(graphData.error)}</div>
          </div>
        `;
        return;
      }

      simulation = renderD3Graph(document.getElementById('graph-canvas')!, graphData);
    } catch (e) {
      console.error('Failed to fetch dependency graph:', e);
      if (canvas) {
        canvas.innerHTML = `
          <div class="empty-state h-full">
            <div class="empty-state-title">Failed to Load Graph</div>
            <div class="empty-state-text">${escapeHtml((e as Error).message)}</div>
          </div>
        `;
      }
    }
  }

  function renderStats(stats: TLDRStatsShape): void {
    document.getElementById('graph-stats')!.innerHTML = `
      <div class="grid grid-cols-2 gap-md">
        <div>
          <div class="metric-label">Files</div>
          <div class="text-xl font-bold text-blue">
            ${stats.summaries || graphData?.nodes?.length || 0}
          </div>
        </div>
        <div>
          <div class="metric-label">Dependencies</div>
          <div class="text-xl font-bold text-purple">
            ${stats.dependencies || graphData?.edges?.length || 0}
          </div>
        </div>
        <div>
          <div class="metric-label">Overviews</div>
          <div class="text-xl font-bold text-green">
            ${stats.overviews || 0}
          </div>
        </div>
        <div>
          <div class="metric-label">Coverage</div>
          <div class="text-xl font-bold">
            ${stats.coverage || 'N/A'}
          </div>
        </div>
      </div>
    `;
  }

  // Initial fetch
  await fetchGraphData();

  // Zoom controls
  const svgSelection = select('#graph-canvas svg') as Selection<SVGSVGElement, unknown, HTMLElement, unknown>;

  document.getElementById('zoom-in')?.addEventListener('click', () => {
    svgSelection.transition().call(d3Zoom<SVGSVGElement, unknown>().scaleBy as unknown as (transition: unknown, k: number) => void, 1.5);
  });

  document.getElementById('zoom-out')?.addEventListener('click', () => {
    svgSelection.transition().call(d3Zoom<SVGSVGElement, unknown>().scaleBy as unknown as (transition: unknown, k: number) => void, 0.67);
  });

  document.getElementById('zoom-reset')?.addEventListener('click', () => {
    svgSelection.transition().call(d3Zoom<SVGSVGElement, unknown>().transform as unknown as (transition: unknown, transform: unknown) => void, zoomIdentity);
  });

  document.getElementById('refresh-graph')?.addEventListener('click', fetchGraphData);

  // Search
  document.getElementById('graph-search')?.addEventListener('input', (e: Event) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase();
    selectAll('#graph-canvas .nodes g').style('opacity', (d: unknown) => {
      if (!query) return 1;
      return (d as GraphNode).path.toLowerCase().includes(query) ? 1 : 0.2;
    });
  });

  // Return cleanup function
  return () => {
    if (simulation) {
      simulation.stop();
    }
  };
}
