/**
 * Memory & Routing View
 * Agent memory browser and task routing classifier.
 * Wired to: GET /memory/:agentId, POST /memory/search, POST /routing/classify
 */

import dayjs from 'dayjs';
import store from '@/store';
import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import {
  listMemories,
  searchMemories,
  storeMemory,
  classifyTask,
} from '@/api';
import type { MemoryEntry, WorkerInfo, RoutingRecommendation } from '@/types';

const TYPE_COLORS: Record<string, string> = {
  fact: 'blue',
  decision: 'green',
  pattern: 'purple',
  error: 'red',
};

function renderMemoryCard(entry: MemoryEntry): string {
  const color = TYPE_COLORS[entry.memoryType] ?? 'blue';
  return `
    <div class="card mb-sm">
      <div class="flex items-center gap-sm mb-xs">
        <span class="badge ${color}">${escapeHtml(entry.memoryType)}</span>
        <strong>${escapeHtml(entry.key)}</strong>
        <span class="text-fg-muted text-sm ml-auto">${entry.lastAccessed ? dayjs(entry.lastAccessed).fromNow() : ''}</span>
      </div>
      <div class="text-sm mb-xs">${escapeHtml(entry.value.slice(0, 300))}${entry.value.length > 300 ? '...' : ''}</div>
      <div class="flex items-center gap-sm text-fg-muted text-xs">
        ${entry.tags.length > 0 ? entry.tags.map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('') : ''}
        <span class="ml-auto">relevance: ${entry.relevance.toFixed(2)} &middot; accessed: ${entry.accessCount}x</span>
      </div>
    </div>
  `;
}

function renderRoutingResult(rec: RoutingRecommendation): string {
  const complexityColors: Record<string, string> = { simple: 'green', medium: 'yellow', complex: 'red' };
  const strategyColors: Record<string, string> = { direct: 'blue', supervised: 'yellow', swarm: 'purple' };
  return `
    <div class="card">
      <div class="flex items-center gap-sm">
        <span class="badge ${complexityColors[rec.complexity] ?? 'blue'}">${escapeHtml(rec.complexity)}</span>
        <span class="badge ${strategyColors[rec.strategy] ?? 'blue'}">${escapeHtml(rec.strategy)}</span>
        <span class="badge blue">${escapeHtml(rec.model)}</span>
        <span class="text-fg-muted text-sm ml-auto">confidence: ${(rec.confidence * 100).toFixed(0)}%</span>
      </div>
    </div>
  `;
}

export async function renderMemory(container: HTMLElement): Promise<(() => void) | void> {
  const workers: WorkerInfo[] = store.get('workers') ?? [];
  const handles = workers.map(w => w.handle);

  let memories: MemoryEntry[] = [];
  let selectedAgent = handles[0] ?? '';
  let routingResult: RoutingRecommendation | null = null;

  function render(): void {
    container.innerHTML = `
      <div class="grid-2">
        <!-- Left: Memory browser -->
        <div>
          <div class="card mb-sm">
            <div class="card-header">
              <h3 class="card-title">Agent Memory</h3>
            </div>
            <div class="flex items-center gap-sm mb-sm">
              <select class="form-input" id="memory-agent-select" style="max-width: 200px">
                ${handles.length === 0 ? '<option value="">No agents</option>' : ''}
                ${handles.map(h => `<option value="${escapeHtml(h)}" ${h === selectedAgent ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
              </select>
              <input type="text" class="form-input" id="memory-search-input" placeholder="Search memories..." style="flex:1">
              <button class="btn btn-primary btn-sm" id="memory-search-btn">Search</button>
              <button class="btn btn-secondary btn-sm" id="memory-refresh-btn">Refresh</button>
            </div>
          </div>
          <div id="memory-list">
            ${memories.length === 0
              ? '<div class="text-fg-muted text-center py-md">No memories found</div>'
              : memories.map(renderMemoryCard).join('')}
          </div>
          <div class="card mt-sm">
            <div class="card-header"><h3 class="card-title">Store Memory</h3></div>
            <form id="memory-store-form">
              <div class="flex gap-sm mb-xs">
                <input type="text" class="form-input" id="store-key" placeholder="Key" required style="flex:1">
                <select class="form-input" id="store-type" style="max-width:120px">
                  <option value="fact">fact</option>
                  <option value="decision">decision</option>
                  <option value="pattern">pattern</option>
                  <option value="error">error</option>
                </select>
              </div>
              <textarea class="form-input mb-xs" id="store-value" placeholder="Value" rows="2" required></textarea>
              <div class="flex items-center gap-sm">
                <input type="text" class="form-input" id="store-tags" placeholder="Tags (comma-separated)" style="flex:1">
                <button type="submit" class="btn btn-primary btn-sm">Store</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Right: Task routing -->
        <div>
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Task Router</h3>
            </div>
            <form id="routing-form">
              <input type="text" class="form-input mb-xs" id="route-subject" placeholder="Task subject" required>
              <textarea class="form-input mb-xs" id="route-description" placeholder="Description (optional)" rows="2"></textarea>
              <button type="submit" class="btn btn-primary btn-sm">Classify</button>
            </form>
          </div>
          <div id="routing-result" class="mt-sm">
            ${routingResult ? renderRoutingResult(routingResult) : ''}
          </div>
        </div>
      </div>
    `;

    // Wire event handlers
    const agentSelect = document.getElementById('memory-agent-select') as HTMLSelectElement | null;
    agentSelect?.addEventListener('change', async () => {
      selectedAgent = agentSelect.value;
      await loadMemories();
    });

    document.getElementById('memory-refresh-btn')?.addEventListener('click', loadMemories);

    document.getElementById('memory-search-btn')?.addEventListener('click', async () => {
      const input = document.getElementById('memory-search-input') as HTMLInputElement | null;
      const query = input?.value.trim();
      if (!query || !selectedAgent) return;
      try {
        const result = await searchMemories(selectedAgent, query);
        memories = result.results ?? [];
        render();
      } catch {
        toast.error('Search failed');
      }
    });

    const storeForm = document.getElementById('memory-store-form');
    storeForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = (document.getElementById('store-key') as HTMLInputElement).value.trim();
      const value = (document.getElementById('store-value') as HTMLTextAreaElement).value.trim();
      const memoryType = (document.getElementById('store-type') as HTMLSelectElement).value;
      const tagsInput = (document.getElementById('store-tags') as HTMLInputElement).value.trim();
      const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : undefined;

      if (!selectedAgent) {
        toast.warning('Select an agent first');
        return;
      }
      if (!key || !value) return;
      try {
        await storeMemory(selectedAgent, key, value, memoryType, tags);
        toast.success('Memory stored');
        await loadMemories();
      } catch {
        toast.error('Failed to store memory');
      }
    });

    const routeForm = document.getElementById('routing-form');
    routeForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const subject = (document.getElementById('route-subject') as HTMLInputElement).value.trim();
      const description = (document.getElementById('route-description') as HTMLTextAreaElement).value.trim() || undefined;

      if (!subject) return;
      try {
        routingResult = await classifyTask(subject, description);
        const resultContainer = document.getElementById('routing-result');
        if (resultContainer) {
          resultContainer.innerHTML = renderRoutingResult(routingResult);
        }
      } catch {
        toast.error('Classification failed');
      }
    });
  }

  async function loadMemories(): Promise<void> {
    if (!selectedAgent) {
      memories = [];
      render();
      return;
    }
    try {
      const result = await listMemories(selectedAgent);
      memories = result.memories ?? [];
      render();
    } catch {
      memories = [];
      render();
    }
  }

  // Initial load
  await loadMemories();

  return () => {
    // No subscriptions or timers to clean up, but returning a cleanup
    // function satisfies the view lifecycle contract.
  };
}
