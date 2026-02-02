/**
 * Search & Analysis View
 * Three sections: Search, DAG Analysis, LMSH Shell.
 * Route: #/search
 */

import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import {
  search, getSearchStats,
  dagSort, dagCycles, dagCriticalPath, dagReady,
  lmshTranslate, lmshGetAliases, lmshCreateAlias,
} from '@/api-operations';
import type { SearchResult, SearchStats, LMSHAlias } from '@/types';

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export async function renderSearch(container: HTMLElement): Promise<() => void> {
  let searchStats: SearchStats = {};
  let aliases: LMSHAlias[] = [];

  try {
    [searchStats, aliases] = await Promise.all([
      getSearchStats().catch(() => ({} as SearchStats)),
      lmshGetAliases().catch(() => []),
    ]);
  } catch {
    // Non-critical
  }

  container.innerHTML = `
    <div class="grid grid-cols-2 gap-lg">
      <!-- Left: Search + DAG -->
      <div>
        <!-- Search Section -->
        <div class="card mb-md">
          <div class="card-header">
            <h3 class="card-title">Full-Text Search</h3>
            <span class="text-xs text-fg-muted">${searchStats.totalDocuments ?? 0} indexed documents</span>
          </div>
          <div class="p-md">
            <form id="search-form" class="flex gap-sm">
              <input type="text" class="form-input flex-1" id="search-query" placeholder="Search sessions...">
              <button type="submit" class="btn btn-primary btn-sm">Search</button>
            </form>
            <div id="search-results" class="mt-md"></div>
          </div>
        </div>

        <!-- DAG Section -->
        <div class="card">
          <h3 class="card-title mb-md">DAG Analysis</h3>
          <div class="p-md">
            <textarea class="form-input w-full" id="dag-input" rows="4" placeholder='JSON array of tasks: [{"id":"a","dependencies":["b"]},{"id":"b"}]'></textarea>
            <div class="flex gap-sm mt-sm">
              <button class="btn btn-secondary btn-sm dag-action" data-action="sort">Topo Sort</button>
              <button class="btn btn-secondary btn-sm dag-action" data-action="cycles">Detect Cycles</button>
              <button class="btn btn-secondary btn-sm dag-action" data-action="critical">Critical Path</button>
              <button class="btn btn-secondary btn-sm dag-action" data-action="ready">Ready Tasks</button>
            </div>
            <div id="dag-results" class="mt-md"></div>
          </div>
        </div>
      </div>

      <!-- Right: LMSH -->
      <div>
        <div class="card mb-md">
          <h3 class="card-title mb-md">LMSH Shell</h3>
          <div class="p-md">
            <p class="text-xs text-fg-muted mb-sm">Translate natural language to fleet CLI commands</p>
            <form id="lmsh-form" class="flex gap-sm">
              <input type="text" class="form-input flex-1" id="lmsh-input" placeholder="e.g. spawn 3 workers for testing">
              <button type="submit" class="btn btn-primary btn-sm">Translate</button>
            </form>
            <div id="lmsh-result" class="mt-md"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Aliases</h3>
            <button class="btn btn-secondary btn-sm" id="add-alias">+ Add</button>
          </div>
          <div id="alias-list" class="p-md">
            ${aliases.length === 0 ? '<div class="text-fg-muted text-sm">No aliases configured</div>' : aliases.map((a) => `
              <div class="flex items-center gap-md p-xs border-b border-edge">
                <span class="font-mono font-bold text-blue">${escapeHtml(a.name)}</span>
                <span class="font-mono text-xs text-fg-secondary flex-1">${escapeHtml(a.command)}</span>
                ${a.description ? `<span class="text-xs text-fg-muted">${escapeHtml(a.description)}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  // Search form
  document.getElementById('search-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = (document.getElementById('search-query') as HTMLInputElement).value.trim();
    if (!query) return;
    const resultsEl = document.getElementById('search-results')!;
    resultsEl.innerHTML = '<div class="spinner"></div>';
    try {
      const results = await search(query);
      const list: SearchResult[] = Array.isArray(results) ? results : [];
      if (list.length === 0) {
        resultsEl.innerHTML = '<div class="text-fg-muted text-sm">No results found</div>';
      } else {
        resultsEl.innerHTML = list.map((r) => `
          <div class="p-sm border-b border-edge">
            <div class="font-medium">${escapeHtml(r.title || r.sessionId)}</div>
            <div class="text-xs text-fg-muted">Score: ${r.score.toFixed(2)}</div>
            ${r.snippet ? `<div class="text-xs text-fg-secondary mt-xs">${escapeHtml(r.snippet)}</div>` : ''}
          </div>
        `).join('');
      }
    } catch (err) {
      resultsEl.innerHTML = `<div class="text-red text-sm">${escapeHtml((err as Error).message)}</div>`;
    }
  });

  // DAG actions
  container.querySelectorAll('.dag-action').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const resultsEl = document.getElementById('dag-results')!;
      const input = (document.getElementById('dag-input') as HTMLTextAreaElement).value.trim();
      if (!input) { resultsEl.innerHTML = '<div class="text-fg-muted text-sm">Enter tasks JSON</div>'; return; }
      let tasks: { id: string; dependencies?: string[]; duration?: number; status?: string }[];
      try { tasks = JSON.parse(input); } catch { resultsEl.innerHTML = '<div class="text-red text-sm">Invalid JSON</div>'; return; }

      resultsEl.innerHTML = '<div class="spinner"></div>';
      const action = (btn as HTMLElement).dataset.action!;
      try {
        let result: unknown;
        if (action === 'sort') result = await dagSort(tasks);
        else if (action === 'cycles') result = await dagCycles(tasks);
        else if (action === 'critical') result = await dagCriticalPath(tasks);
        else if (action === 'ready') result = await dagReady(tasks);
        resultsEl.innerHTML = `<pre class="text-xs bg-bg-secondary p-md rounded overflow-x-auto">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
      } catch (err) {
        resultsEl.innerHTML = `<div class="text-red text-sm">${escapeHtml((err as Error).message)}</div>`;
      }
    });
  });

  // LMSH translate
  document.getElementById('lmsh-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = (document.getElementById('lmsh-input') as HTMLInputElement).value.trim();
    if (!input) return;
    const resultEl = document.getElementById('lmsh-result')!;
    resultEl.innerHTML = '<div class="spinner"></div>';
    try {
      const result = await lmshTranslate(input);
      resultEl.innerHTML = `
        <div class="bg-bg-secondary p-md rounded font-mono text-sm">
          <div class="text-green">$ ${escapeHtml(result.command)}</div>
          ${result.explanation ? `<div class="text-fg-muted text-xs mt-sm">${escapeHtml(result.explanation)}</div>` : ''}
        </div>
      `;
    } catch (err) {
      resultEl.innerHTML = `<div class="text-red text-sm">${escapeHtml((err as Error).message)}</div>`;
    }
  });

  // Add alias
  document.getElementById('add-alias')?.addEventListener('click', async () => {
    const name = prompt('Alias name:');
    if (!name) return;
    const command = prompt('Command:');
    if (!command) return;
    try {
      await lmshCreateAlias({ name, command });
      toast.success('Alias created');
      aliases = await lmshGetAliases();
      const el = document.getElementById('alias-list');
      if (el) el.innerHTML = aliases.map((a) => `
        <div class="flex items-center gap-md p-xs border-b border-edge">
          <span class="font-mono font-bold text-blue">${escapeHtml(a.name)}</span>
          <span class="font-mono text-xs text-fg-secondary flex-1">${escapeHtml(a.command)}</span>
        </div>
      `).join('');
    } catch (err) {
      toast.error((err as Error).message);
    }
  });

  return () => {};
}
