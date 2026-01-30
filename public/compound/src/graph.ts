// Compounding Machine - D3 Force-Directed Agent Network Graph

import type {
  GraphNode,
  GraphEdge,
  CompoundSnapshot,
  WorkerData,
  SwarmData,
  NodeStatus,
} from './types';

// D3 is loaded globally via CDN
declare const d3: typeof import('d3');

// --- Color Constants ---

const NODE_COLORS: Record<string, string> = {
  worker: '#3fb950',
  swarm: '#a371f7',
  task: '#d29922',
};

const STATUS_STROKE: Record<string, string> = {
  healthy: '#3fb950',
  working: '#d29922',
  degraded: '#fb923c',
  unhealthy: '#f85149',
  stopped: '#6e7681',
  pending: '#8b949e',
};

const EDGE_COLORS: Record<string, string> = {
  membership: '#30363d',
  assignment: '#d29922',
  knowledge: '#58a6ff',
  spawn: '#a371f7',
};

// --- Graph State ---

let nodes: GraphNode[] = [];
let edges: GraphEdge[] = [];
let simulation: d3.Simulation<GraphNode, GraphEdge> | null = null;
let svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let container: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
let linksGroup: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
let nodesGroup: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
let zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
let isDragging = false;

function mapWorkerStatus(w: WorkerData): NodeStatus {
  if (w.state === 'stopped') return 'stopped';
  if (w.health === 'unhealthy') return 'unhealthy';
  if (w.health === 'degraded') return 'degraded';
  if (w.state === 'working') return 'working';
  return 'healthy';
}

function getNodeRadius(node: GraphNode): number {
  const base = node.type === 'swarm' ? 16 : node.type === 'task' ? 10 : 12;
  const creditBonus = node.credits ? Math.min(Math.sqrt(node.credits) * 0.5, 12) : 0;
  return base + creditBonus;
}

// --- Public API ---

export function initGraph(): void {
  svg = d3.select<SVGSVGElement, unknown>('#network-graph');
  container = svg.select<SVGGElement>('g.graph-root');

  if (container.empty()) {
    container = svg.append('g').attr('class', 'graph-root');
  }

  linksGroup = container.select<SVGGElement>('g.links');
  if (linksGroup.empty()) {
    linksGroup = container.append('g').attr('class', 'links');
  }

  nodesGroup = container.select<SVGGElement>('g.nodes');
  if (nodesGroup.empty()) {
    nodesGroup = container.append('g').attr('class', 'nodes');
  }

  zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      container.attr('transform', event.transform.toString());
    });

  svg.call(zoom);

  // Click background to deselect
  svg.on('click', () => {
    nodesGroup.selectAll('.node').style('opacity', 1);
    linksGroup.selectAll('.link').style('opacity', 0.6);
  });

  // Zoom controls
  document.getElementById('zoom-fit')?.addEventListener('click', fitToView);
  document.getElementById('zoom-reset')?.addEventListener('click', () => {
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  });

  initSimulation();
}

function initSimulation(): void {
  const el = document.getElementById('graph-container');
  const width = el?.clientWidth ?? 800;
  const height = el?.clientHeight ?? 600;

  simulation = d3
    .forceSimulation<GraphNode, GraphEdge>()
    .force(
      'link',
      d3
        .forceLink<GraphNode, GraphEdge>()
        .id((d) => d.id)
        .distance((d) => {
          const type = (d as GraphEdge).type;
          if (type === 'membership') return 60;
          if (type === 'assignment') return 100;
          if (type === 'spawn') return 140;
          return 80;
        })
        .strength(0.5)
    )
    .force('charge', d3.forceManyBody<GraphNode>().strength(-200).distanceMax(500))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force(
      'collision',
      d3.forceCollide<GraphNode>().radius((d) => getNodeRadius(d) + 8)
    )
    .on('tick', ticked);
}

function ticked(): void {
  linksGroup
    .selectAll<SVGLineElement, GraphEdge>('.link')
    .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
    .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
    .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
    .attr('y2', (d) => (d.target as GraphNode).y ?? 0);

  nodesGroup
    .selectAll<SVGGElement, GraphNode>('.node')
    .attr('transform', (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
}

export function updateGraph(snapshot: CompoundSnapshot): void {
  const newNodes: GraphNode[] = [];
  const newEdges: GraphEdge[] = [];
  const nodeMap = new Map<string, GraphNode>();

  // Create swarm nodes
  for (const swarm of snapshot.swarms) {
    const node: GraphNode = {
      id: `swarm-${swarm.id}`,
      label: swarm.name,
      type: 'swarm',
      status: 'healthy',
      radius: 16,
      color: NODE_COLORS.swarm,
    };
    newNodes.push(node);
    nodeMap.set(node.id, node);
  }

  // Create worker nodes
  for (const worker of snapshot.workers) {
    const credits = findWorkerCredits(worker.handle, snapshot);
    const node: GraphNode = {
      id: `worker-${worker.handle}`,
      label: worker.handle,
      type: 'worker',
      status: mapWorkerStatus(worker),
      radius: 12,
      color: NODE_COLORS.worker,
      credits,
      swarmId: worker.swarmId,
      depthLevel: worker.depthLevel,
    };
    node.radius = getNodeRadius(node);
    newNodes.push(node);
    nodeMap.set(node.id, node);

    // Membership edge
    if (worker.swarmId) {
      const swarmNodeId = `swarm-${worker.swarmId}`;
      if (nodeMap.has(swarmNodeId)) {
        newEdges.push({
          id: `${swarmNodeId}-${node.id}`,
          source: swarmNodeId,
          target: node.id,
          type: 'membership',
          sourceId: swarmNodeId,
          targetId: node.id,
        });
      }
    }
  }

  // Create task nodes (top 10 open tasks)
  const openTasks = Object.entries(snapshot.tasks.byStatus)
    .filter(([status]) => status === 'open' || status === 'in_progress')
    .reduce((sum, [, count]) => sum + count, 0);

  if (openTasks > 0) {
    // Add a summary task node
    const taskNode: GraphNode = {
      id: 'tasks-summary',
      label: `${openTasks} tasks`,
      type: 'task',
      status: 'pending',
      radius: 10 + Math.min(openTasks, 10),
      color: NODE_COLORS.task,
    };
    newNodes.push(taskNode);
    nodeMap.set(taskNode.id, taskNode);
  }

  // Preserve positions from existing nodes
  const existingMap = new Map(nodes.map((n) => [n.id, n]));
  for (const node of newNodes) {
    const existing = existingMap.get(node.id);
    if (existing) {
      node.x = existing.x;
      node.y = existing.y;
      node.vx = existing.vx;
      node.vy = existing.vy;
    }
  }

  nodes = newNodes;
  edges = newEdges;
  render();
}

function render(): void {
  if (!simulation) return;

  // Links
  const linkSel = linksGroup
    .selectAll<SVGLineElement, GraphEdge>('.link')
    .data(edges, (d) => d.id);

  linkSel.exit().remove();

  const linkEnter = linkSel
    .enter()
    .append('line')
    .attr('class', (d) => `link ${d.type}`)
    .attr('stroke', (d) => EDGE_COLORS[d.type] ?? '#30363d')
    .attr('stroke-width', (d) => (d.type === 'spawn' ? 3 : d.type === 'assignment' ? 2 : 1.5))
    .attr('stroke-linecap', 'round');

  linkSel.merge(linkEnter).attr('stroke', (d) => EDGE_COLORS[d.type] ?? '#30363d');

  // Nodes
  const nodeSel = nodesGroup
    .selectAll<SVGGElement, GraphNode>('.node')
    .data(nodes, (d) => d.id);

  nodeSel.exit().remove();

  const nodeEnter = nodeSel
    .enter()
    .append('g')
    .attr('class', 'node')
    .call(
      d3
        .drag<SVGGElement, GraphNode>()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded)
    )
    .on('click', (event: MouseEvent, d: GraphNode) => {
      if (!isDragging) {
        event.stopPropagation();
        highlightConnected(d);
      }
    });

  // Circle for workers and swarms
  nodeEnter
    .append('circle')
    .attr('r', (d) => d.radius)
    .attr('fill', (d) => d.color)
    .attr('stroke', (d) => STATUS_STROKE[d.status] ?? '#6e7681')
    .attr('stroke-width', 2)
    .attr('filter', (d) =>
      d.type === 'swarm' ? 'url(#glow-purple)' : d.status === 'working' ? 'url(#glow-green)' : ''
    );

  // Labels
  nodeEnter
    .append('text')
    .attr('class', 'node-label')
    .attr('dy', (d) => d.radius + 14)
    .attr('text-anchor', 'middle')
    .text((d) => d.label);

  // Update existing nodes
  const allNodes = nodeSel.merge(nodeEnter);

  allNodes
    .select('circle')
    .attr('r', (d) => d.radius)
    .attr('fill', (d) => d.color)
    .attr('stroke', (d) => STATUS_STROKE[d.status] ?? '#6e7681')
    .attr('stroke-width', (d) => (d.status === 'working' ? 3 : 2))
    .attr('filter', (d) =>
      d.type === 'swarm' ? 'url(#glow-purple)' : d.status === 'working' ? 'url(#glow-green)' : ''
    );

  allNodes.select('text').text((d) => d.label);

  // Update simulation
  simulation.nodes(nodes);
  (simulation.force('link') as d3.ForceLink<GraphNode, GraphEdge>).links(edges);
  simulation.alpha(0.3).restart();

  // Update badge
  const badge = document.getElementById('graph-badge');
  if (badge) badge.textContent = `${nodes.length} nodes`;
}

function highlightConnected(node: GraphNode): void {
  const connected = new Set<string>();
  connected.add(node.id);

  edges.forEach((e) => {
    const sid = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
    const tid = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
    if (sid === node.id) connected.add(tid);
    if (tid === node.id) connected.add(sid);
  });

  nodesGroup.selectAll<SVGGElement, GraphNode>('.node').style('opacity', (d) =>
    connected.has(d.id) ? 1 : 0.2
  );

  linksGroup.selectAll<SVGLineElement, GraphEdge>('.link').style('opacity', (d) => {
    const sid = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
    const tid = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
    return sid === node.id || tid === node.id ? 1 : 0.1;
  });
}

// --- Knowledge Flow Animation ---

export function animateKnowledgeFlow(sourceHandle: string, targetHandle?: string): void {
  if (!container || !targetHandle) return;

  const sourceNode = nodes.find((n) => n.id === `worker-${sourceHandle}`);
  const targetNode = nodes.find((n) => n.id === `worker-${targetHandle}`);

  if (!sourceNode?.x || !targetNode?.x) return;

  container
    .append('circle')
    .attr('class', 'knowledge-particle')
    .attr('r', 4)
    .attr('fill', '#58a6ff')
    .attr('filter', 'url(#glow-blue)')
    .attr('cx', sourceNode.x)
    .attr('cy', sourceNode.y!)
    .transition()
    .duration(1500)
    .ease(d3.easeQuadInOut)
    .attr('cx', targetNode.x)
    .attr('cy', targetNode.y!)
    .style('opacity', 0)
    .remove();
}

// --- Drag Handlers ---

function dragStarted(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>): void {
  isDragging = false;
  if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
  event.subject.fx = event.subject.x;
  event.subject.fy = event.subject.y;
}

function dragged(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>): void {
  isDragging = true;
  event.subject.fx = event.x;
  event.subject.fy = event.y;
}

function dragEnded(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>): void {
  if (!event.active && simulation) simulation.alphaTarget(0);
  event.subject.fx = null;
  event.subject.fy = null;
  setTimeout(() => {
    isDragging = false;
  }, 50);
}

// --- Zoom ---

function fitToView(): void {
  if (nodes.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    if (typeof n.x === 'number' && typeof n.y === 'number') {
      const r = n.radius;
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r);
      maxY = Math.max(maxY, n.y + r);
    }
  });

  if (minX === Infinity) return;

  const el = document.getElementById('graph-container');
  const width = el?.clientWidth ?? 800;
  const height = el?.clientHeight ?? 600;
  const padding = 80;

  const bboxW = maxX - minX + padding * 2;
  const bboxH = maxY - minY + padding * 2;
  const scale = Math.min(width / bboxW, height / bboxH, 1.5);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  svg
    .transition()
    .duration(500)
    .call(
      zoom.transform,
      d3.zoomIdentity
        .translate(width / 2 - cx * scale, height / 2 - cy * scale)
        .scale(scale)
    );
}

// --- Helpers ---

function findWorkerCredits(handle: string, snapshot: CompoundSnapshot): number {
  for (const intel of Object.values(snapshot.intelligence)) {
    const entry = intel.leaderboard?.find((e) => e.agentHandle === handle);
    if (entry) return entry.credits;
  }
  return 0;
}

export function destroyGraph(): void {
  simulation?.stop();
  simulation = null;
}
