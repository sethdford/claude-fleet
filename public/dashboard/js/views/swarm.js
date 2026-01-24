/**
 * Swarm Detail View
 * Shows agent hierarchy, blackboard messages, and spawn queue
 */

import store from '../store.js';
import ApiClient, { MESSAGE_TYPES, MESSAGE_PRIORITIES } from '../api.js';

/**
 * Render swarm header
 */
function renderSwarmHeader(swarm) {
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

      ${swarm.description ? `<p style="color: var(--text-secondary); margin-top: var(--space-md);">${escapeHtml(swarm.description)}</p>` : ''}

      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-md); margin-top: var(--space-md);">
        <div>
          <div class="metric-label">Agents</div>
          <div style="font-size: 24px; font-weight: 700; color: var(--accent-blue);">${swarm.agents?.length || 0}</div>
        </div>
        <div>
          <div class="metric-label">Max Agents</div>
          <div style="font-size: 24px; font-weight: 700;">${swarm.maxAgents || 50}</div>
        </div>
        <div>
          <div class="metric-label">Created</div>
          <div style="font-weight: 600;">${swarm.createdAt ? dayjs(swarm.createdAt).fromNow() : 'Unknown'}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render agent hierarchy as D3 force graph
 */
function renderAgentGraph(container, workers) {
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
  const nodes = workers.map((w) => ({
    id: w.handle,
    health: w.health || 'healthy',
    state: w.state,
    depth: w.depthLevel || 1,
    x: width / 2 + (Math.random() - 0.5) * 100,
    y: height / 2 + (Math.random() - 0.5) * 100,
  }));

  // Links based on depth (simplified hierarchy)
  const links = [];
  const byDepth = {};
  nodes.forEach(n => {
    if (!byDepth[n.depth]) byDepth[n.depth] = [];
    byDepth[n.depth].push(n);
  });

  // Connect each level to parent level
  Object.keys(byDepth).forEach(depth => {
    if (depth > 1) {
      const parents = byDepth[depth - 1] || [];
      if (parents.length > 0) {
        byDepth[depth].forEach((child, i) => {
          const parent = parents[i % parents.length];
          links.push({ source: parent.id, target: child.id });
        });
      }
    }
  });

  // Create SVG
  const svg = d3.select(container)
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
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30));

  // Draw links
  const link = svg.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 2)
    .attr('marker-end', 'url(#arrowhead)');

  // Draw nodes
  const node = svg.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));

  // Node circles
  node.append('circle')
    .attr('r', 15)
    .attr('fill', d => {
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
    .text(d => d.id.slice(0, 2).toUpperCase())
    .attr('text-anchor', 'middle')
    .attr('dy', 4)
    .attr('fill', '#0d1117')
    .attr('font-size', 10)
    .attr('font-weight', 'bold');

  // Tooltips
  node.append('title')
    .text(d => `${d.id}\n${d.state} (${d.health})`);

  // Update positions on tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  function dragstarted(event) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragended(event) {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }
}

/**
 * Get badge color for message type
 */
function getTypeColor(type) {
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
function formatPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return escapeHtml(payload);
  if (payload.message) return escapeHtml(payload.message);
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
function renderBlackboard(messages, currentFilter) {
  // Valid message types from schema
  const types = ['all', ...MESSAGE_TYPES];

  return `
    <div class="blackboard">
      <div class="blackboard-header">
        <h3 class="card-title">Blackboard</h3>
        <div class="blackboard-filters">
          ${types.map(t => `
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
        ` : messages.map(m => `
          <div class="blackboard-message ${(!m.readBy || m.readBy.length === 0) ? 'unread' : ''}" data-id="${escapeAttr(m.id)}">
            <div class="message-header">
              <span class="message-author">${escapeHtml(m.senderHandle || m.fromHandle || 'unknown')}</span>
              <span class="badge ${getTypeColor(m.messageType || m.type)}">${escapeHtml(m.messageType || m.type || 'unknown')}</span>
              ${m.priority && m.priority !== 'normal' ? `<span class="badge ${m.priority === 'critical' ? 'red' : m.priority === 'high' ? 'yellow' : ''}">${escapeHtml(m.priority)}</span>` : ''}
              ${m.targetHandle ? `<span class="text-muted text-sm">→ ${escapeHtml(m.targetHandle)}</span>` : ''}
              <span class="message-time">${m.createdAt ? dayjs(m.createdAt).fromNow() : ''}</span>
            </div>
            <div class="message-content">${formatPayload(m.payload || m.message)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Escape for use in HTML attributes
 */
function escapeAttr(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render spawn queue status
 */
function renderSpawnQueue(queue) {
  if (!queue || (queue.pending === 0 && queue.active === 0)) {
    return `
      <div class="card">
        <h3 class="card-title mb-md">Spawn Queue</h3>
        <div class="empty-state" style="padding: var(--space-lg);">
          <div class="empty-state-title">Queue Empty</div>
          <div class="empty-state-text">No pending spawn requests</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="card">
      <h3 class="card-title mb-md">Spawn Queue</h3>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-md);">
        <div>
          <div class="metric-label">Pending</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--accent-yellow);">${queue.pending || 0}</div>
        </div>
        <div>
          <div class="metric-label">Active</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--accent-blue);">${queue.active || 0}</div>
        </div>
        <div>
          <div class="metric-label">Completed</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--accent-green);">${queue.completed || 0}</div>
        </div>
        <div>
          <div class="metric-label">Failed</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--accent-red);">${queue.failed || 0}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render the swarm view
 */
export async function renderSwarm(container, swarmId) {
  let swarm = store.get('swarms')?.find(s => s.id === swarmId);
  let blackboard = [];
  let spawnQueue = null;
  let currentFilter = 'all';

  // Fetch swarm details
  try {
    const data = await ApiClient.getSwarm(swarmId);
    swarm = data.swarm || data;
    store.set('currentSwarm', swarm);
  } catch (e) {
    console.error('Failed to fetch swarm:', e);
  }

  // Fetch blackboard messages
  async function fetchBlackboard(filter = 'all') {
    try {
      const options = { limit: 50 };
      if (filter !== 'all') {
        options.messageType = filter;
      }
      const data = await ApiClient.getBlackboard(swarmId, options);
      blackboard = data.messages || data || [];
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
  async function fetchSpawnQueue() {
    try {
      spawnQueue = await ApiClient.getSpawnQueue();
      const el = document.getElementById('spawn-queue-container');
      if (el) {
        el.innerHTML = renderSpawnQueue(spawnQueue);
      }
    } catch (e) {
      console.error('Failed to fetch spawn queue:', e);
    }
  }

  // Setup filter buttons
  function setupFilterButtons() {
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => fetchBlackboard(btn.dataset.filter));
    });
  }

  // Get workers in this swarm
  const swarmWorkers = (store.get('workers') || []).filter(w => w.swarmId === swarmId);

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg);">
      <div>
        <div id="swarm-header">
          ${renderSwarmHeader(swarm)}
        </div>

        <div class="mt-md">
          <h2 class="card-subtitle mb-md">Agent Hierarchy</h2>
          <div class="card">
            <div id="agent-graph" style="min-height: 300px;"></div>
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
          <select class="form-input" id="message-type" style="width: 140px;">
            ${MESSAGE_TYPES.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
          </select>
          <select class="form-input" id="message-priority" style="width: 100px;">
            ${MESSAGE_PRIORITIES.map(p => `<option value="${p}" ${p === 'normal' ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
          </select>
          <input type="text" class="form-input" id="blackboard-message" placeholder="Enter message..." style="flex: 1;">
          <button type="submit" class="btn btn-primary">Post</button>
        </form>
      </div>
    </div>
  `;

  // Render agent graph
  renderAgentGraph(document.getElementById('agent-graph'), swarmWorkers);

  // Fetch data
  await Promise.all([fetchBlackboard(), fetchSpawnQueue()]);

  // Kill swarm button
  document.getElementById('kill-swarm')?.addEventListener('click', async () => {
    if (confirm(`Are you sure you want to kill swarm "${swarm?.name}"? This will dismiss all agents.`)) {
      try {
        await ApiClient.killSwarm(swarmId);
        window.location.hash = '/';
      } catch (e) {
        alert('Failed to kill swarm: ' + e.message);
      }
    }
  });

  // Post to blackboard form
  document.getElementById('post-blackboard-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageType = document.getElementById('message-type').value;
    const priority = document.getElementById('message-priority').value;
    const message = document.getElementById('blackboard-message').value.trim();

    if (!message) return;

    try {
      await ApiClient.postBlackboard(swarmId, message, messageType, null, priority);
      document.getElementById('blackboard-message').value = '';
      await fetchBlackboard(currentFilter);
    } catch (e) {
      alert('Failed to post message: ' + e.message);
    }
  });

  // Subscribe to worker updates to refresh graph
  const unsubWorkers = store.subscribe('workers', (workers) => {
    const updated = workers?.filter(w => w.swarmId === swarmId) || [];
    renderAgentGraph(document.getElementById('agent-graph'), updated);
  });

  // Poll blackboard every 10 seconds
  const pollInterval = setInterval(() => fetchBlackboard(currentFilter), 10000);

  // Return cleanup function
  return () => {
    unsubWorkers();
    clearInterval(pollInterval);
  };
}
