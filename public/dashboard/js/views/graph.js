/**
 * Dependency Graph View
 * Interactive D3 force-directed graph for TLDR dependency visualization
 */

import store from '../store.js';
import ApiClient from '../api.js';

// File extension to color mapping
const EXTENSION_COLORS = {
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

/**
 * Get color for a file path
 */
function getFileColor(path) {
  const ext = path.substring(path.lastIndexOf('.'));
  return EXTENSION_COLORS[ext] || '#8b949e';
}

/**
 * Get short name from path
 */
function getShortName(path) {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * Render the D3 force graph visualization
 */
function renderD3Graph(container, graphData) {
  // Clear container
  container.innerHTML = '';

  if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="height: 100%;">
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
  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height]);

  // Add zoom behavior
  const g = svg.append('g');

  const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

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
  const nodes = graphData.nodes.map(n => ({
    id: n.path || n.id,
    path: n.path || n.id,
    summary: n.summary,
    ...n,
  }));

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const links = (graphData.edges || graphData.links || [])
    .filter(e => nodeMap.has(e.source || e.from) && nodeMap.has(e.target || e.to))
    .map(e => ({
      source: e.source || e.from,
      target: e.target || e.to,
      type: e.type,
    }));

  // Create simulation
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30));

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

  // Draw nodes
  const node = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));

  // Node circles
  node.append('circle')
    .attr('r', 8)
    .attr('fill', d => getFileColor(d.path))
    .attr('stroke', '#0d1117')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer');

  // Node labels
  node.append('text')
    .text(d => getShortName(d.path))
    .attr('x', 12)
    .attr('y', 4)
    .attr('font-size', 11)
    .attr('fill', '#c9d1d9')
    .attr('font-family', 'var(--font-mono)')
    .style('pointer-events', 'none');

  // Tooltips
  node.append('title')
    .text(d => `${d.path}\n${d.summary || ''}`);

  // Node click handler
  node.on('click', (event, d) => {
    showNodeDetail(d);
  });

  // Highlight on hover
  node.on('mouseover', function(event, d) {
    d3.select(this).select('circle')
      .transition()
      .duration(200)
      .attr('r', 12);

    // Highlight connected nodes and links
    const connectedNodes = new Set();
    links.forEach(l => {
      if (l.source.id === d.id) connectedNodes.add(l.target.id);
      if (l.target.id === d.id) connectedNodes.add(l.source.id);
    });

    node.style('opacity', n => connectedNodes.has(n.id) || n.id === d.id ? 1 : 0.3);
    link.style('opacity', l => l.source.id === d.id || l.target.id === d.id ? 1 : 0.1);
  });

  node.on('mouseout', function() {
    d3.select(this).select('circle')
      .transition()
      .duration(200)
      .attr('r', 8);

    node.style('opacity', 1);
    link.style('opacity', 0.6);
  });

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

  return simulation;
}

/**
 * Show node detail panel
 */
function showNodeDetail(node) {
  const detailPanel = document.getElementById('node-detail');
  if (!detailPanel) return;

  detailPanel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title" style="word-break: break-all;">${escapeHtml(getShortName(node.path))}</h3>
      </div>
      <div style="padding: var(--space-md);">
        <div class="form-label">Path</div>
        <p class="font-mono text-sm" style="color: var(--text-secondary); word-break: break-all; margin-bottom: var(--space-md);">
          ${escapeHtml(node.path)}
        </p>

        ${node.summary ? `
          <div class="form-label">Summary</div>
          <p style="color: var(--text-primary); line-height: 1.6;">
            ${escapeHtml(node.summary)}
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
      const data = await ApiClient.getFileSummary(node.path);
      if (data.summary) {
        const summaryText = typeof data.summary === 'string' ? data.summary : data.summary.summary || '';
        const content = `
          <div class="form-label">Summary</div>
          <p style="color: var(--text-primary); line-height: 1.6; white-space: pre-wrap;">
            ${escapeHtml(summaryText)}
          </p>
        `;
        const existingSummary = detailPanel.querySelector('.form-label + p');
        if (existingSummary) {
          existingSummary.parentElement.innerHTML = content;
        }
      }
    } catch (e) {
      alert('Failed to fetch summary: ' + e.message);
    }
  });
}

// Common entry point patterns to try
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
export async function renderGraph(container) {
  let graphData = store.get('dependencyGraph');
  let simulation = null;
  let currentRootFiles = store.get('graphRootFiles') || [];

  container.innerHTML = `
    <style>
      .graph-container {
        display: grid;
        grid-template-columns: 1fr 300px;
        gap: var(--space-lg);
        height: calc(100vh - 180px);
      }

      .graph-main {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        overflow: hidden;
        position: relative;
      }

      .graph-controls {
        position: absolute;
        top: var(--space-md);
        left: var(--space-md);
        z-index: 10;
        display: flex;
        gap: var(--space-sm);
      }

      .graph-legend {
        position: absolute;
        bottom: var(--space-md);
        left: var(--space-md);
        background: var(--bg-overlay);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        font-size: 11px;
        display: flex;
        gap: var(--space-md);
        flex-wrap: wrap;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
      }

      .legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }

      .graph-sidebar {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }

      .graph-search {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        padding: var(--space-md);
      }

      .root-files-input {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        padding: var(--space-md);
      }

      .root-file-tag {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        background: var(--bg-tertiary);
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        margin: 2px;
      }

      .root-file-tag button {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }

      .root-file-tag button:hover {
        color: var(--accent-red);
      }

      .suggested-files {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-xs);
        margin-top: var(--space-sm);
      }

      .suggested-file {
        font-size: 11px;
        padding: 2px 6px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        cursor: pointer;
        color: var(--text-secondary);
      }

      .suggested-file:hover {
        border-color: var(--accent-blue);
        color: var(--accent-blue);
      }
    </style>

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

        <div id="graph-canvas" style="width: 100%; height: 100%;"></div>

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
          <div class="form-help" style="font-size: 11px; color: var(--text-secondary); margin-bottom: var(--space-sm);">
            Specify root files to trace dependencies from
          </div>
          <div id="root-files-tags" style="margin-bottom: var(--space-sm);"></div>
          <div style="display: flex; gap: var(--space-sm);">
            <input type="text" class="form-input" id="root-file-input" placeholder="src/index.ts" style="flex: 1;">
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
          <div style="padding: var(--space-md);" id="graph-stats">
            <div class="loading">
              <div class="spinner"></div>
            </div>
          </div>
        </div>

        <div id="node-detail">
          <div class="card">
            <div class="empty-state" style="padding: var(--space-lg);">
              <div class="empty-state-title">Select a Node</div>
              <div class="empty-state-text">Click on a file node to see details</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render root file tags
  function renderRootFileTags() {
    const container = document.getElementById('root-files-tags');
    if (!container) return;

    if (currentRootFiles.length === 0) {
      container.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">No files selected</span>';
      return;
    }

    container.innerHTML = currentRootFiles.map(file => `
      <span class="root-file-tag">
        <span class="font-mono">${escapeHtml(file)}</span>
        <button data-file="${escapeAttr(file)}">&times;</button>
      </span>
    `).join('');

    // Add remove handlers
    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const file = btn.dataset.file;
        currentRootFiles = currentRootFiles.filter(f => f !== file);
        store.set('graphRootFiles', currentRootFiles);
        renderRootFileTags();
        renderSuggestedFiles();
      });
    });
  }

  // Render suggested files
  function renderSuggestedFiles() {
    const container = document.getElementById('suggested-files');
    if (!container) return;

    const suggestions = COMMON_ENTRY_POINTS.filter(f => !currentRootFiles.includes(f));
    if (suggestions.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <span style="font-size: 11px; color: var(--text-muted);">Suggestions:</span>
      ${suggestions.slice(0, 5).map(file => `
        <button class="suggested-file" data-file="${escapeAttr(file)}">${escapeHtml(file)}</button>
      `).join('')}
    `;

    container.querySelectorAll('.suggested-file').forEach(btn => {
      btn.addEventListener('click', () => {
        const file = btn.dataset.file;
        if (!currentRootFiles.includes(file)) {
          currentRootFiles.push(file);
          store.set('graphRootFiles', currentRootFiles);
          renderRootFileTags();
          renderSuggestedFiles();
        }
      });
    });
  }

  // Add root file handler
  function addRootFile() {
    const input = document.getElementById('root-file-input');
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
  document.getElementById('root-file-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addRootFile();
    }
  });

  // Initial render of tags
  renderRootFileTags();
  renderSuggestedFiles();

  // Fetch graph data
  async function fetchGraphData() {
    const canvas = document.getElementById('graph-canvas');

    // Check if we have root files
    if (currentRootFiles.length === 0) {
      if (canvas) {
        canvas.innerHTML = `
          <div class="empty-state" style="height: 100%;">
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
        const stats = await ApiClient.getTLDRStats();
        renderStats(stats);
      } catch (e) {
        console.error('Failed to fetch TLDR stats:', e);
      }
      return;
    }

    // Show loading state
    if (canvas) {
      canvas.innerHTML = `
        <div class="loading" style="height: 100%; display: flex; align-items: center; justify-content: center;">
          <div class="spinner"></div>
        </div>
      `;
    }

    try {
      graphData = await ApiClient.getDependencyGraph(currentRootFiles, 5);
      store.set('dependencyGraph', graphData);

      const stats = await ApiClient.getTLDRStats();
      renderStats(stats);

      if (graphData.error) {
        canvas.innerHTML = `
          <div class="empty-state" style="height: 100%;">
            <div class="empty-state-title">No Dependency Data</div>
            <div class="empty-state-text">${escapeHtml(graphData.error)}</div>
          </div>
        `;
        return;
      }

      simulation = renderD3Graph(document.getElementById('graph-canvas'), graphData);
    } catch (e) {
      console.error('Failed to fetch dependency graph:', e);
      if (canvas) {
        canvas.innerHTML = `
          <div class="empty-state" style="height: 100%;">
            <div class="empty-state-title">Failed to Load Graph</div>
            <div class="empty-state-text">${escapeHtml(e.message)}</div>
          </div>
        `;
      }
    }
  }

  function renderStats(stats) {
    document.getElementById('graph-stats').innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md);">
        <div>
          <div class="metric-label">Files</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--accent-blue);">
            ${stats.summaries || graphData?.nodes?.length || 0}
          </div>
        </div>
        <div>
          <div class="metric-label">Dependencies</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--accent-purple);">
            ${stats.dependencies || graphData?.edges?.length || 0}
          </div>
        </div>
        <div>
          <div class="metric-label">Overviews</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--accent-green);">
            ${stats.overviews || 0}
          </div>
        </div>
        <div>
          <div class="metric-label">Coverage</div>
          <div style="font-size: 20px; font-weight: 700;">
            ${stats.coverage || 'N/A'}
          </div>
        </div>
      </div>
    `;
  }

  // Initial fetch
  await fetchGraphData();

  // Zoom controls
  const svg = d3.select('#graph-canvas svg');

  document.getElementById('zoom-in')?.addEventListener('click', () => {
    svg.transition().call(d3.zoom().scaleBy, 1.5);
  });

  document.getElementById('zoom-out')?.addEventListener('click', () => {
    svg.transition().call(d3.zoom().scaleBy, 0.67);
  });

  document.getElementById('zoom-reset')?.addEventListener('click', () => {
    svg.transition().call(d3.zoom().transform, d3.zoomIdentity);
  });

  document.getElementById('refresh-graph')?.addEventListener('click', fetchGraphData);

  // Search
  document.getElementById('graph-search')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    d3.selectAll('#graph-canvas .nodes g').style('opacity', d => {
      if (!query) return 1;
      return d.path.toLowerCase().includes(query) ? 1 : 0.2;
    });
  });

  // Return cleanup function
  return () => {
    if (simulation) {
      simulation.stop();
    }
  };
}
