/**
 * D3 Force Graph Renderer
 * Force-directed graph visualization and node detail panel.
 * Extracted from graph.ts to keep files under 500 lines.
 */

import { select, selectAll } from 'd3-selection';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import { drag as d3Drag } from 'd3-drag';
import 'd3-transition';
import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import type { Selection } from 'd3-selection';
import { getFileSummary, getDependencies, getDependents } from '@/api';
import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';

// File extension to color mapping
const EXTENSION_COLORS: Record<string, string> = {
  '.ts': '#3178c6',
  '.tsx': '#3178c6',
  '.js': '#f7df1e',
  '.jsx': '#61dafb',
  '.json': '#8bc34a',
  '.css': '#264de4',
  '.scss': '#cd6799',
  '.html': '#e34c26',
  '.md': '#083fa1',
  '.sql': '#e38c00',
  '.go': '#00add8',
  '.py': '#3776ab',
  '.rs': '#dea584',
  '.sh': '#4eaa25',
  '.yml': '#cb171e',
  '.yaml': '#cb171e',
};

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  path: string;
  summary?: string;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type?: string;
}

export interface GraphDataShape {
  nodes?: { path?: string; id?: string; summary?: string }[];
  edges?: { source?: string; from?: string; target?: string; to?: string; type?: string }[];
  links?: { source?: string; from?: string; target?: string; to?: string; type?: string }[];
  nodeCount?: number;
  edgeCount?: number;
  error?: string;
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
export function getShortName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * Render the D3 force graph visualization
 */
export function renderD3Graph(container: HTMLElement, graphData: GraphDataShape): Simulation<GraphNode, GraphLink> | null {
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

  const svg = select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height].join(' '));

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

        <div class="flex gap-sm mt-md">
          <button class="btn btn-secondary btn-sm" id="fetch-summary">Summary</button>
          <button class="btn btn-secondary btn-sm" id="fetch-deps">Dependencies</button>
          <button class="btn btn-secondary btn-sm" id="fetch-dependents">Dependents</button>
        </div>
        <div id="node-extra-detail" class="mt-md"></div>
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

  document.getElementById('fetch-deps')?.addEventListener('click', async () => {
    const extra = document.getElementById('node-extra-detail');
    if (!extra) return;
    try {
      const data = await getDependencies(nodeData.path) as { dependencies?: string[] };
      const deps = data.dependencies || [];
      extra.innerHTML = `<div class="form-label">Dependencies (${deps.length})</div><div class="max-h-[200px] overflow-y-auto">${deps.map((d) => `<div class="font-mono text-xs py-xs border-b border-edge">${escapeHtml(d)}</div>`).join('') || '<div class="text-fg-muted text-sm">None</div>'}</div>`;
    } catch (e) { toast.error('Failed: ' + (e as Error).message); }
  });

  document.getElementById('fetch-dependents')?.addEventListener('click', async () => {
    const extra = document.getElementById('node-extra-detail');
    if (!extra) return;
    try {
      const data = await getDependents(nodeData.path) as { dependents?: string[] };
      const deps = data.dependents || [];
      extra.innerHTML = `<div class="form-label">Dependents (${deps.length})</div><div class="max-h-[200px] overflow-y-auto">${deps.map((d) => `<div class="font-mono text-xs py-xs border-b border-edge">${escapeHtml(d)}</div>`).join('') || '<div class="text-fg-muted text-sm">None</div>'}</div>`;
    } catch (e) { toast.error('Failed: ' + (e as Error).message); }
  });
}

/**
 * Setup zoom controls for the graph
 */
export function setupGraphZoom(canvasSelector: string): void {
  const svgSelection = select(`${canvasSelector} svg`) as Selection<SVGSVGElement, unknown, HTMLElement, unknown>;

  document.getElementById('zoom-in')?.addEventListener('click', () => {
    svgSelection.transition().call(d3Zoom<SVGSVGElement, unknown>().scaleBy as unknown as (transition: unknown, k: number) => void, 1.5);
  });

  document.getElementById('zoom-out')?.addEventListener('click', () => {
    svgSelection.transition().call(d3Zoom<SVGSVGElement, unknown>().scaleBy as unknown as (transition: unknown, k: number) => void, 0.67);
  });

  document.getElementById('zoom-reset')?.addEventListener('click', () => {
    svgSelection.transition().call(d3Zoom<SVGSVGElement, unknown>().transform as unknown as (transition: unknown, transform: unknown) => void, zoomIdentity);
  });
}

/**
 * Setup graph search filtering
 */
export function setupGraphSearch(): void {
  document.getElementById('graph-search')?.addEventListener('input', (e: Event) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase();
    selectAll('#graph-canvas .nodes g').style('opacity', (d: unknown) => {
      if (!query) return 1;
      return (d as GraphNode).path.toLowerCase().includes(query) ? 1 : 0.2;
    });
  });
}
