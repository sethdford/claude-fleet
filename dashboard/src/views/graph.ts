/**
 * Dependency Graph View
 * Interactive D3 force-directed graph for TLDR dependency visualization.
 * D3 rendering functions live in graph-d3.ts.
 */

import type { Simulation } from 'd3-force';
import store from '@/store';
import { getDependencyGraph, getTLDRStats } from '@/api';
import { escapeHtml, escapeAttr } from '@/utils/escape-html';
import type { TLDRStats } from '@/types';

import {
  renderD3Graph,
  setupGraphZoom,
  setupGraphSearch,
} from './graph-d3';
import type { GraphNode, GraphLink, GraphDataShape } from './graph-d3';

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
  async function addRootFile(): Promise<void> {
    const input = document.getElementById('root-file-input') as HTMLInputElement | null;
    const file = input?.value?.trim();
    if (file && !currentRootFiles.includes(file)) {
      currentRootFiles.push(file);
      store.set('graphRootFiles', currentRootFiles);
      renderRootFileTags();
      renderSuggestedFiles();
      if (input) input.value = '';
      await fetchGraphData();
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
        const stats = await getTLDRStats() as TLDRStats;
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

      const stats = await getTLDRStats() as TLDRStats;
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

  function renderStats(stats: TLDRStats): void {
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

  // Zoom and search controls (delegated to graph-d3.ts)
  setupGraphZoom('#graph-canvas');
  setupGraphSearch();

  document.getElementById('refresh-graph')?.addEventListener('click', fetchGraphData);

  // Return cleanup function
  return () => {
    if (simulation) {
      simulation.stop();
    }
  };
}
