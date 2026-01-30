// Compounding Machine - Agent Lineage Tree

import type { CompoundSnapshot, LineageNode } from './types';

// D3 loaded globally via CDN
declare const d3: typeof import('d3');

const STATUS_COLORS: Record<string, string> = {
  healthy: '#3fb950',
  working: '#d29922',
  degraded: '#fb923c',
  unhealthy: '#f85149',
  stopped: '#6e7681',
};

const TYPE_COLORS: Record<string, string> = {
  root: '#8b949e',
  swarm: '#a371f7',
  worker: '#3fb950',
  group: '#6e7681',
};

export function initLineage(): void {
  // Initial empty render handled by updateLineage
}

export function updateLineage(snapshot: CompoundSnapshot): void {
  const container = document.getElementById('lineage-panel')?.querySelector('.panel-content');
  if (!container) return;

  const workers = snapshot.workers;
  if (workers.length === 0) {
    const svg = container.querySelector('svg');
    if (svg) {
      svg.innerHTML = '';
    }
    const badge = document.getElementById('lineage-badge');
    if (badge) badge.textContent = '0 agents';
    return;
  }

  // Build lineage tree from workers
  const tree = buildLineageTree(workers, snapshot.swarms);
  renderTree(tree);

  const badge = document.getElementById('lineage-badge');
  if (badge) badge.textContent = `${workers.length} agents`;
}

function buildLineageTree(
  workers: CompoundSnapshot['workers'],
  swarms: CompoundSnapshot['swarms']
): LineageNode {
  const root: LineageNode = {
    id: 'fleet',
    name: 'Fleet',
    type: 'root',
    children: [],
  };

  // Group workers by swarm
  const bySwarm = new Map<string, typeof workers>();
  const unassigned: typeof workers = [];

  for (const w of workers) {
    if (w.swarmId) {
      const list = bySwarm.get(w.swarmId) ?? [];
      list.push(w);
      bySwarm.set(w.swarmId, list);
    } else {
      unassigned.push(w);
    }
  }

  // Create swarm subtrees
  for (const [swarmId, members] of bySwarm) {
    const swarm = swarms.find((s) => s.id === swarmId);
    const swarmNode: LineageNode = {
      id: swarmId,
      name: swarm?.name ?? `Swarm ${swarmId.slice(0, 8)}`,
      type: 'swarm',
      children: [],
    };

    // Sort by depth and build hierarchy
    const sorted = [...members].sort((a, b) => (a.depthLevel ?? 0) - (b.depthLevel ?? 0));

    for (const w of sorted) {
      swarmNode.children.push({
        id: w.handle,
        name: w.handle,
        type: 'worker',
        state: w.state,
        health: w.health,
        children: [],
      });
    }

    root.children.push(swarmNode);
  }

  // Unassigned workers
  if (unassigned.length > 0) {
    const groupNode: LineageNode = {
      id: 'unassigned',
      name: 'Unassigned',
      type: 'group',
      children: unassigned.map((w) => ({
        id: w.handle,
        name: w.handle,
        type: 'worker',
        state: w.state,
        health: w.health,
        children: [],
      })),
    };
    root.children.push(groupNode);
  }

  return root;
}

function renderTree(data: LineageNode): void {
  const svgEl = document.getElementById('lineage-tree') as SVGSVGElement | null;
  if (!svgEl) return;

  const container = svgEl.parentElement;
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  // Clear previous
  d3.select(svgEl).selectAll('*').remove();

  const svg = d3
    .select(svgEl)
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const g = svg.append('g').attr('transform', `translate(60, ${height / 2})`);

  // D3 tree layout (horizontal)
  const hierarchy = d3.hierarchy<LineageNode>(data);
  const treeLayout = d3.tree<LineageNode>().size([height - 40, width - 160]);

  const root = treeLayout(hierarchy);

  // Links
  g.selectAll('.lineage-link')
    .data(root.links())
    .join('path')
    .attr('class', 'lineage-link')
    .attr(
      'd',
      d3
        .linkHorizontal<d3.HierarchyLink<LineageNode>, d3.HierarchyPointNode<LineageNode>>()
        .x((d) => d.y)
        .y((d) => d.x) as unknown as (
          d: d3.HierarchyLink<LineageNode>,
          i: number,
          nodes: d3.BaseType[]
        ) => string
    );

  // Nodes
  const node = g
    .selectAll('.lineage-node')
    .data(root.descendants())
    .join('g')
    .attr('class', 'lineage-node')
    .attr('transform', (d) => `translate(${d.y}, ${d.x})`);

  node
    .append('circle')
    .attr('r', (d) => {
      const type = d.data.type;
      return type === 'root' ? 8 : type === 'swarm' ? 7 : 5;
    })
    .attr('fill', (d) => {
      if (d.data.health) return STATUS_COLORS[d.data.health] ?? '#6e7681';
      return TYPE_COLORS[d.data.type] ?? '#6e7681';
    })
    .attr('stroke', (d) => {
      if (d.data.state === 'working') return '#d29922';
      return '#0d1117';
    })
    .attr('stroke-width', 1.5);

  node
    .append('text')
    .attr('dy', '0.31em')
    .attr('x', (d) => (d.children ? -12 : 12))
    .attr('text-anchor', (d) => (d.children ? 'end' : 'start'))
    .text((d) => d.data.name);
}

export function destroyLineage(): void {
  const svgEl = document.getElementById('lineage-tree');
  if (svgEl) {
    d3.select(svgEl).selectAll('*').remove();
  }
}
