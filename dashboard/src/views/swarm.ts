/**
 * Swarm Detail View
 * Shows agent hierarchy, blackboard messages, spawn queue, and swarm intelligence
 */

import dayjs from 'dayjs';
import { select } from 'd3-selection';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import { drag as d3Drag } from 'd3-drag';
import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import store from '@/store';
import {
  getSwarm,
  getBlackboard,
  postBlackboard,
  getSpawnQueue,
  killSwarm,
  MESSAGE_TYPES,
  MESSAGE_PRIORITIES,
} from '@/api';
import type { BlackboardQueryOptions } from '@/api';
import toast from '@/components/toast';
import { confirm as confirmDialog } from '@/components/confirm';
import { escapeHtml, escapeAttr } from '@/utils/escape-html';
import { renderSwarmIntelligence } from './swarm-intelligence';

interface SwarmData {
  id: string;
  name: string;
  description?: string;
  agents?: unknown[];
  maxAgents?: number;
  createdAt?: string;
}

interface WorkerData {
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

interface BlackboardMsg {
  id: string;
  senderHandle: string;
  messageType: string;
  priority: string;
  targetHandle: string | null;
  createdAt: number;
  payload: Record<string, unknown>;
  readBy: string[];
}

interface SpawnQueueData {
  pending?: number;
  active?: number;
  completed?: number;
  failed?: number;
}

/**
 * Render swarm header
 */
function renderSwarmHeader(swarm: SwarmData | undefined): string {
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
function renderAgentGraph(container: HTMLElement | null, workers: WorkerData[]): void {
  if (!container) return;

  const width = container.clientWidth || 400;
  const height = 300;

  // Clear previous content
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

  // Create nodes and links
  const nodes: AgentNode[] = workers.map((w: WorkerData) => ({
    id: w.handle,
    health: w.health || 'healthy',
    state: w.state,
    depth: w.depthLevel || 1,
    x: width / 2 + (Math.random() - 0.5) * 100,
    y: height / 2 + (Math.random() - 0.5) * 100,
  }));

  // Links based on depth (simplified hierarchy)
  const links: AgentLink[] = [];
  const byDepth: Record<number, AgentNode[]> = {};
  nodes.forEach((n: AgentNode) => {
    if (!byDepth[n.depth]) byDepth[n.depth] = [];
    byDepth[n.depth].push(n);
  });

  // Connect each level to parent level
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

  // Create SVG
  const svg = select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  // Define arrow marker
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

  // Create simulation
  const simulation: Simulation<AgentNode, AgentLink> = forceSimulation<AgentNode>(nodes)
    .force('link', forceLink<AgentNode, AgentLink>(links).id((d: AgentNode) => d.id).distance(80))
    .force('charge', forceManyBody().strength(-200))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collision', forceCollide().radius(30));

  // Draw links
  const link = svg.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 2)
    .attr('marker-end', 'url(#arrowhead)');

  // Drag handlers
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

  // Draw nodes
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

  // Node circles
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

  // Node labels
  node.append('text')
    .text((d: AgentNode) => d.id.slice(0, 2).toUpperCase())
    .attr('text-anchor', 'middle')
    .attr('dy', 4)
    .attr('fill', '#0d1117')
    .attr('font-size', 10)
    .attr('font-weight', 'bold');

  // Tooltips
  node.append('title')
    .text((d: AgentNode) => `${d.id}\n${d.state} (${d.health})`);

  // Update positions on tick
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
  // Show JSON preview for complex payloads
  const str = JSON.stringify(payload);
  if (str.length > 200) {
    return `<code>${escapeHtml(str.slice(0, 200))}...</code>`;
  }
  return `<code>${escapeHtml(str)}</code>`;
}

/**
 * Render blackboard messages
 */
function renderBlackboard(messages: BlackboardMsg[], currentFilter: string): string {
  // Valid message types from schema
  const types = ['all', ...MESSAGE_TYPES];

  return `
    <div class="blackboard">
      <div class="blackboard-header">
        <h3 class="card-title">Blackboard</h3>
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
function renderSpawnQueue(queue: SpawnQueueData | null): string {
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
function renderOverviewContent(
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

/**
 * Render the swarm view
 */
export async function renderSwarm(container: HTMLElement, swarmId: string): Promise<() => void> {
  let swarm = (store.get('swarms') as SwarmData[] | undefined)?.find((s: SwarmData) => s.id === swarmId);
  let blackboard: BlackboardMsg[] = [];
  let spawnQueue: SpawnQueueData | null = null;
  let currentFilter = 'all';
  let currentTab = 'overview';
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let unsubWorkers: (() => void) | null = null;

  // Fetch swarm details
  try {
    const data = await getSwarm(swarmId) as SwarmData & { swarm?: SwarmData };
    swarm = data.swarm || data;
    // swarm data used locally, no need to store globally
  } catch (e) {
    console.error('Failed to fetch swarm:', e);
  }

  // Fetch blackboard messages
  async function fetchBlackboard(filter = 'all'): Promise<void> {
    try {
      const options: BlackboardQueryOptions = { limit: 50 };
      if (filter !== 'all') {
        options.messageType = filter;
      }
      const data = await getBlackboard(swarmId, options) as BlackboardMsg[] | { messages?: BlackboardMsg[] };
      blackboard = (Array.isArray(data) ? data : (data as { messages?: BlackboardMsg[] }).messages || []) as BlackboardMsg[];
      currentFilter = filter;
      const el = document.getElementById('blackboard-container');
      if (el) {
        el.innerHTML = renderBlackboard(blackboard, currentFilter);
        setupFilterButtons();
      }
    } catch (e) {
      console.error('Failed to fetch blackboard:', e);
    }
  }

  // Fetch spawn queue
  async function fetchSpawnQueue(): Promise<void> {
    try {
      spawnQueue = await getSpawnQueue() as SpawnQueueData;
      const el = document.getElementById('spawn-queue-container');
      if (el) {
        el.innerHTML = renderSpawnQueue(spawnQueue);
      }
    } catch (e) {
      console.error('Failed to fetch spawn queue:', e);
    }
  }

  // Setup filter buttons
  function setupFilterButtons(): void {
    document.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => fetchBlackboard((btn as HTMLElement).dataset.filter || 'all'));
    });
  }

  // Get workers in this swarm
  const swarmWorkers = ((store.get('workers') as WorkerData[] | undefined) || []).filter((w: WorkerData) => w.swarmId === swarmId);

  // Render the main container with tabs
  container.innerHTML = `
    <div id="swarm-header">
      ${renderSwarmHeader(swarm)}
    </div>

    <!-- Tab Navigation -->
    <div class="flex gap-xs border-b border-edge mt-md mb-lg">
      <button class="tab-btn active py-sm px-md bg-transparent border-0 border-b-2 border-b-blue text-fg font-semibold cursor-pointer" data-tab="overview">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="align-middle mr-1.5">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
        </svg>
        Overview
      </button>
      <button class="tab-btn py-sm px-md bg-transparent border-0 border-b-2 border-b-transparent text-fg-secondary font-medium cursor-pointer" data-tab="intelligence">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="align-middle mr-1.5">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        Swarm Intelligence
      </button>
    </div>

    <!-- Tab Content -->
    <div id="tab-content">
      ${renderOverviewContent(swarm, swarmWorkers, blackboard, currentFilter, spawnQueue)}
    </div>
  `;

  // Setup tab switching
  function setupTabs(): void {
    container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tab = (btn as HTMLElement).dataset.tab;
        if (tab === currentTab) return;

        // Update tab styles via class toggling
        container.querySelectorAll('.tab-btn').forEach((b) => {
          b.classList.remove('active', 'border-b-blue', 'text-fg', 'font-semibold');
          b.classList.add('border-b-transparent', 'text-fg-secondary', 'font-medium');
        });
        btn.classList.add('active', 'border-b-blue', 'text-fg', 'font-semibold');
        btn.classList.remove('border-b-transparent', 'text-fg-secondary', 'font-medium');

        currentTab = tab!;
        const tabContent = document.getElementById('tab-content')!;

        if (tab === 'overview') {
          tabContent.innerHTML = renderOverviewContent(swarm, swarmWorkers, blackboard, currentFilter, spawnQueue);
          renderAgentGraph(document.getElementById('agent-graph'), swarmWorkers);
          await Promise.all([fetchBlackboard(), fetchSpawnQueue()]);
          setupPostForm();
          startOverviewPolling();
        } else if (tab === 'intelligence') {
          stopOverviewPolling();
          await renderSwarmIntelligence(tabContent, swarmId);
        }
      });
    });
  }

  // Setup post to blackboard form
  function setupPostForm(): void {
    document.getElementById('post-blackboard-form')?.addEventListener('submit', async (e: Event) => {
      e.preventDefault();
      const messageType = (document.getElementById('message-type') as HTMLSelectElement).value;
      const priority = (document.getElementById('message-priority') as HTMLSelectElement).value;
      const message = (document.getElementById('blackboard-message') as HTMLInputElement).value.trim();

      if (!message) return;

      try {
        await postBlackboard(swarmId, message, messageType, null, priority);
        (document.getElementById('blackboard-message') as HTMLInputElement).value = '';
        await fetchBlackboard(currentFilter);
      } catch (e) {
        toast.error('Failed to post message: ' + (e as Error).message);
      }
    });
  }

  // Start polling for overview tab
  function startOverviewPolling(): void {
    stopOverviewPolling();
    pollInterval = setInterval(() => fetchBlackboard(currentFilter), 10000);
  }

  // Stop polling
  function stopOverviewPolling(): void {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // Initial setup
  setupTabs();
  renderAgentGraph(document.getElementById('agent-graph'), swarmWorkers);
  await Promise.all([fetchBlackboard(), fetchSpawnQueue()]);
  setupPostForm();
  startOverviewPolling();

  // Kill swarm button
  document.getElementById('kill-swarm')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Kill Swarm',
      message: `Are you sure you want to kill swarm "${swarm?.name}"? This will dismiss all agents.`,
      confirmText: 'Kill Swarm',
      variant: 'danger',
    });
    if (confirmed) {
      try {
        await killSwarm(swarmId);
        toast.success(`Swarm "${swarm?.name}" killed`);
        window.location.hash = '/';
      } catch (e) {
        toast.error('Failed to kill swarm: ' + (e as Error).message);
      }
    }
  });

  // Subscribe to worker updates to refresh graph
  unsubWorkers = store.subscribe('workers', (workers: unknown) => {
    const updated = ((workers as WorkerData[] | undefined) || []).filter((w: WorkerData) => w.swarmId === swarmId);
    if (currentTab === 'overview') {
      renderAgentGraph(document.getElementById('agent-graph'), updated);
    }
  });

  // Return cleanup function
  return () => {
    if (unsubWorkers) unsubWorkers();
    stopOverviewPolling();
  };
}
