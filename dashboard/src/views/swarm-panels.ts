/**
 * Swarm Detail Panel Renderers
 * Pure rendering functions for swarm header, agent graph, blackboard, and spawn queue.
 * Extracted from swarm.ts to keep files under 500 lines.
 */

import dayjs from 'dayjs';
import { select } from 'd3-selection';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import { drag as d3Drag } from 'd3-drag';
import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import { escapeHtml, escapeAttr } from '@/utils/escape-html';
import { MESSAGE_TYPES, MESSAGE_PRIORITIES } from '@/api';

// ---------------------------------------------------------------------------
// Types (local to swarm view)
// ---------------------------------------------------------------------------

export interface SwarmData {
  id: string;
  name: string;
  description?: string;
  agents?: unknown[];
  maxAgents?: number;
  createdAt?: string;
}

export interface WorkerData {
  handle: string;
  health?: string;
  state: string;
  depthLevel?: number;
  swarmId?: string;
}

interface AgentNode extends SimulationNodeDatum {
  id: string;
  health: string;
  state: string;
  depth: number;
}

interface AgentLink extends SimulationLinkDatum<AgentNode> {
  source: string | AgentNode;
  target: string | AgentNode;
}

export interface BlackboardMsg {
  id: string;
  senderHandle: string;
  messageType: string;
  priority: string;
  targetHandle: string | null;
  createdAt: number;
  payload: Record<string, unknown>;
  readBy: string[];
}

export interface SpawnQueueData {
  pending?: number;
  active?: number;
  completed?: number;
  failed?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get badge color for message type
 */
function getTypeColor(type: string): string {
  switch (type) {
    case 'request': return 'blue';
    case 'response': return 'green';
    case 'status': return 'yellow';
    case 'directive': return 'purple';
    case 'checkpoint': return 'red';
    default: return '';
  }
}

/**
 * Format payload for display
 */
function formatPayload(payload: unknown): string {
  if (!payload) return '';
  if (typeof payload === 'string') return escapeHtml(payload);
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    return escapeHtml((payload as { message: string }).message);
  }
  const str = JSON.stringify(payload);
  if (str.length > 200) {
    return `<code>${escapeHtml(str.slice(0, 200))}...</code>`;
  }
  return `<code>${escapeHtml(str)}</code>`;
}

// ---------------------------------------------------------------------------
// Panel Renderers
// ---------------------------------------------------------------------------

/**
 * Render swarm header
 */
export function renderSwarmHeader(swarm: SwarmData | undefined): string {
  if (!swarm) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          <div class="empty-state-title">Swarm Not Found</div>
          <div class="empty-state-text">This swarm may have been killed</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-md">
          <div class="swarm-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
            </svg>
          </div>
          <div>
            <h3 class="card-title">${escapeHtml(swarm.name)}</h3>
            <div class="card-subtitle font-mono">${swarm.id}</div>
          </div>
        </div>
        <button class="btn btn-danger btn-sm" id="kill-swarm">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
          Kill Swarm
        </button>
      </div>

      ${swarm.description ? `<p class="text-fg-secondary mt-md">${escapeHtml(swarm.description)}</p>` : ''}

      <div class="grid grid-cols-3 gap-md mt-md">
        <div>
          <div class="metric-label">Agents</div>
          <div class="text-2xl font-bold text-blue">${swarm.agents?.length || 0}</div>
        </div>
        <div>
          <div class="metric-label">Max Agents</div>
          <div class="text-2xl font-bold">${swarm.maxAgents || 50}</div>
        </div>
        <div>
          <div class="metric-label">Created</div>
          <div class="font-semibold">${swarm.createdAt ? dayjs(swarm.createdAt).fromNow() : 'Unknown'}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render agent hierarchy as D3 force graph
 */
export function renderAgentGraph(container: HTMLElement | null, workers: WorkerData[]): void {
  if (!container) return;

  const width = container.clientWidth || 400;
  const height = 300;

  container.innerHTML = '';

  if (!workers || workers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="2"/>
          <circle cx="6" cy="6" r="2"/>
          <circle cx="18" cy="6" r="2"/>
        </svg>
        <div class="empty-state-title">No Agents</div>
        <div class="empty-state-text">Agents in this swarm will appear here</div>
      </div>
    `;
    return;
  }

  const nodes: AgentNode[] = workers.map((w: WorkerData) => ({
    id: w.handle,
    health: w.health || 'healthy',
    state: w.state,
    depth: w.depthLevel || 1,
    x: width / 2 + (Math.random() - 0.5) * 100,
    y: height / 2 + (Math.random() - 0.5) * 100,
  }));

  const links: AgentLink[] = [];
  const byDepth: Record<number, AgentNode[]> = {};
  nodes.forEach((n: AgentNode) => {
    if (!byDepth[n.depth]) byDepth[n.depth] = [];
    byDepth[n.depth].push(n);
  });

  Object.keys(byDepth).forEach((depthStr: string) => {
    const depth = Number(depthStr);
    if (depth > 1) {
      const parents = byDepth[depth - 1] || [];
      if (parents.length > 0) {
        byDepth[depth].forEach((child: AgentNode, i: number) => {
          const parent = parents[i % parents.length];
          links.push({ source: parent.id, target: child.id });
        });
      }
    }
  });

  const svg = select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  svg.append('defs').append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .append('path')
    .attr('d', 'M 0,-5 L 10,0 L 0,5')
    .attr('fill', '#30363d');

  const simulation: Simulation<AgentNode, AgentLink> = forceSimulation<AgentNode>(nodes)
    .force('link', forceLink<AgentNode, AgentLink>(links).id((d: AgentNode) => d.id).distance(80))
    .force('charge', forceManyBody().strength(-200))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collision', forceCollide().radius(30));

  const link = svg.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 2)
    .attr('marker-end', 'url(#arrowhead)');

  function dragstarted(event: { active: number; subject: AgentNode }): void {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event: { subject: AgentNode; x: number; y: number }): void {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragended(event: { active: number; subject: AgentNode }): void {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  const node = svg.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .call(d3Drag<SVGGElement, AgentNode>()
      .on('start', dragstarted as unknown as (event: unknown, d: AgentNode) => void)
      .on('drag', dragged as unknown as (event: unknown, d: AgentNode) => void)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('end', dragended as unknown as (event: unknown, d: AgentNode) => void) as any);

  node.append('circle')
    .attr('r', 15)
    .attr('fill', (d: AgentNode) => {
      switch (d.health) {
        case 'healthy': return '#3fb950';
        case 'degraded': return '#d29922';
        case 'unhealthy': return '#f85149';
        default: return '#8b949e';
      }
    })
    .attr('stroke', '#0d1117')
    .attr('stroke-width', 2);

  node.append('text')
    .text((d: AgentNode) => d.id.slice(0, 2).toUpperCase())
    .attr('text-anchor', 'middle')
    .attr('dy', 4)
    .attr('fill', '#0d1117')
    .attr('font-size', 10)
    .attr('font-weight', 'bold');

  node.append('title')
    .text((d: AgentNode) => `${d.id}\n${d.state} (${d.health})`);

  simulation.on('tick', () => {
    link
      .attr('x1', (d: AgentLink) => (d.source as AgentNode).x!)
      .attr('y1', (d: AgentLink) => (d.source as AgentNode).y!)
      .attr('x2', (d: AgentLink) => (d.target as AgentNode).x!)
      .attr('y2', (d: AgentLink) => (d.target as AgentNode).y!);

    node.attr('transform', (d: AgentNode) => `translate(${d.x},${d.y})`);
  });
}

/**
 * Render blackboard messages
 */
export function renderBlackboard(messages: BlackboardMsg[], currentFilter: string): string {
  const types = ['all', ...MESSAGE_TYPES];

  return `
    <div class="blackboard">
      <div class="blackboard-header">
        <div class="flex items-center gap-sm">
          <h3 class="card-title">Blackboard</h3>
          <button class="btn btn-secondary btn-sm archive-blackboard" title="Archive all">Archive</button>
          <button class="btn btn-secondary btn-sm archive-old-messages" title="Archive messages older than 1 hour">Archive Old</button>
        </div>
        <div class="blackboard-filters">
          ${types.map((t: string) => `
            <button class="btn btn-sm ${currentFilter === t ? 'btn-primary' : 'btn-secondary'}" data-filter="${t}">
              ${t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="blackboard-messages" id="blackboard-messages">
        ${(!messages || messages.length === 0) ? `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M8 12h8M8 16h5"/>
            </svg>
            <div class="empty-state-title">No Messages</div>
            <div class="empty-state-text">Blackboard messages will appear here</div>
          </div>
        ` : messages.map((m: BlackboardMsg) => `
          <div class="blackboard-message ${(!m.readBy || m.readBy.length === 0) ? 'unread' : ''}" data-id="${escapeAttr(m.id)}">
            <div class="message-header">
              <span class="message-author">${escapeHtml(m.senderHandle)}</span>
              <span class="badge ${getTypeColor(m.messageType)}">${escapeHtml(m.messageType)}</span>
              ${m.priority && m.priority !== 'normal' ? `<span class="badge ${m.priority === 'critical' ? 'red' : m.priority === 'high' ? 'yellow' : ''}">${escapeHtml(m.priority)}</span>` : ''}
              ${m.targetHandle ? `<span class="text-fg-muted text-sm">→ ${escapeHtml(m.targetHandle)}</span>` : ''}
              <span class="message-time">${m.createdAt ? dayjs(m.createdAt).fromNow() : ''}</span>
            </div>
            <div class="message-content">${formatPayload(m.payload)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Render spawn queue status
 */
export function renderSpawnQueue(queue: SpawnQueueData | null): string {
  if (!queue || (queue.pending === 0 && queue.active === 0)) {
    return `
      <div class="card">
        <h3 class="card-title mb-md">Spawn Queue</h3>
        <div class="empty-state p-lg">
          <div class="empty-state-title">Queue Empty</div>
          <div class="empty-state-text">No pending spawn requests</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="card">
      <h3 class="card-title mb-md">Spawn Queue</h3>
      <div class="grid grid-cols-4 gap-md">
        <div>
          <div class="metric-label">Pending</div>
          <div class="text-xl font-bold text-yellow">${queue.pending || 0}</div>
        </div>
        <div>
          <div class="metric-label">Active</div>
          <div class="text-xl font-bold text-blue">${queue.active || 0}</div>
        </div>
        <div>
          <div class="metric-label">Completed</div>
          <div class="text-xl font-bold text-green">${queue.completed || 0}</div>
        </div>
        <div>
          <div class="metric-label">Failed</div>
          <div class="text-xl font-bold text-red">${queue.failed || 0}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render overview tab content
 */
export function renderOverviewContent(
  _swarm: SwarmData | undefined,
  _swarmWorkers: WorkerData[],
  blackboard: BlackboardMsg[],
  currentFilter: string,
  spawnQueue: SpawnQueueData | null,
): string {
  return `
    <div class="grid grid-cols-2 gap-lg">
      <div>
        <div class="mt-md">
          <h2 class="card-subtitle mb-md">Agent Hierarchy</h2>
          <div class="card">
            <div id="agent-graph" class="min-h-[300px]"></div>
          </div>
        </div>

        <div class="mt-md" id="spawn-queue-container">
          ${renderSpawnQueue(spawnQueue)}
        </div>
      </div>

      <div id="blackboard-container">
        ${renderBlackboard(blackboard, currentFilter)}
      </div>
    </div>

    <div class="mt-md">
      <h2 class="card-subtitle mb-md">Post to Blackboard</h2>
      <div class="card">
        <form id="post-blackboard-form" class="flex gap-sm">
          <select class="form-input w-[140px]" id="message-type">
            ${MESSAGE_TYPES.map((t: string) => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
          </select>
          <select class="form-input w-[100px]" id="message-priority">
            ${MESSAGE_PRIORITIES.map((p: string) => `<option value="${p}" ${p === 'normal' ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
          </select>
          <input type="text" class="form-input flex-1" id="blackboard-message" placeholder="Enter message...">
          <button type="submit" class="btn btn-primary">Post</button>
        </form>
      </div>
    </div>
  `;
}
