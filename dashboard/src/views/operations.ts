/**
 * Operations View
 * Four-tab layout: Waves, Multi-Repo, Batches, Worktrees.
 * Route: #/operations
 */

import dayjs from 'dayjs';
import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import store from '@/store';
import {
  getWaves, cancelWave,
  getMultiRepoOps,
  multiRepoUpdateDeps, multiRepoSecurityAudit, multiRepoFormatCode, multiRepoRunTests,
  createBatch, getBatches, dispatchBatch, createWorkItem, getWorkItems,
  getWorktreeStatus, worktreeCommit, worktreePush, worktreeCreatePR,
} from '@/api-operations';
import type { Wave, MultiRepoOp, Batch, WorkItem, WorkerInfo } from '@/types';

// ---------------------------------------------------------------------------
// Tab renderers
// ---------------------------------------------------------------------------

function renderWavesTab(waves: Wave[]): string {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Wave Executions</h3>
        <button class="btn btn-primary btn-sm" id="create-wave">+ Create Wave</button>
      </div>
      ${waves.length === 0 ? '<div class="empty-state p-lg"><div class="empty-state-title">No Waves</div><div class="empty-state-text">Create a wave to orchestrate phased deployments</div></div>' : `
        <div class="p-0">
          ${waves.map((w) => `
            <div class="flex items-center gap-md p-md border-b border-edge wave-row" data-wave-id="${escapeHtml(w.id)}">
              <span class="badge ${w.status === 'completed' ? 'green' : w.status === 'failed' ? 'red' : w.status === 'running' ? 'yellow' : 'blue'}">${escapeHtml(w.status)}</span>
              <span class="font-mono text-sm">${escapeHtml(w.id.slice(0, 12))}</span>
              <span class="text-xs text-fg-muted">Phase ${w.currentPhase ?? 0}/${(w.phases as unknown[])?.length || 0}</span>
              <span class="text-xs text-fg-muted flex-1 text-right">${w.createdAt ? dayjs(w.createdAt).fromNow() : ''}</span>
              ${w.status === 'running' ? `<button class="btn btn-danger btn-sm cancel-wave">Cancel</button>` : ''}
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function renderMultiRepoTab(ops: MultiRepoOp[]): string {
  return `
    <div class="card mb-md">
      <div class="card-header">
        <h3 class="card-title">Multi-Repo Operations</h3>
      </div>
      <div class="p-md grid grid-cols-4 gap-sm">
        <button class="btn btn-secondary btn-sm multi-repo-shortcut" data-action="update-deps">Update Deps</button>
        <button class="btn btn-secondary btn-sm multi-repo-shortcut" data-action="security-audit">Security Audit</button>
        <button class="btn btn-secondary btn-sm multi-repo-shortcut" data-action="format-code">Format Code</button>
        <button class="btn btn-secondary btn-sm multi-repo-shortcut" data-action="run-tests">Run Tests</button>
      </div>
    </div>
    <div class="card">
      <h3 class="card-title mb-md">Recent Operations</h3>
      ${ops.length === 0 ? '<div class="empty-state p-lg"><div class="empty-state-text">No operations yet</div></div>' : `
        ${ops.map((op) => `
          <div class="flex items-center gap-md p-sm border-b border-edge">
            <span class="badge ${op.status === 'completed' ? 'green' : op.status === 'failed' ? 'red' : 'yellow'}">${escapeHtml(op.status)}</span>
            <span class="font-medium">${escapeHtml(op.operation)}</span>
            <span class="text-xs text-fg-muted flex-1">${op.repos?.length || 0} repos</span>
            <span class="text-xs text-fg-muted">${op.createdAt ? dayjs(op.createdAt).fromNow() : ''}</span>
          </div>
        `).join('')}
      `}
    </div>
  `;
}

function renderBatchesTab(batches: Batch[], workItems: WorkItem[]): string {
  return `
    <div class="card mb-md">
      <div class="card-header">
        <h3 class="card-title">Batches</h3>
        <button class="btn btn-primary btn-sm" id="create-batch">+ Create Batch</button>
      </div>
      ${batches.length === 0 ? '<div class="empty-state p-lg"><div class="empty-state-text">No batches</div></div>' : `
        ${batches.map((b) => `
          <div class="flex items-center gap-md p-sm border-b border-edge batch-row" data-batch-id="${escapeHtml(b.id)}">
            <span class="badge ${b.status === 'completed' ? 'green' : b.status === 'dispatched' ? 'yellow' : 'blue'}">${escapeHtml(b.status || 'pending')}</span>
            <span class="font-medium">${escapeHtml(b.name || b.id.slice(0, 12))}</span>
            <span class="text-xs text-fg-muted flex-1">${b.itemCount || 0} items</span>
            ${b.status === 'pending' ? `<button class="btn btn-primary btn-sm dispatch-batch">Dispatch</button>` : ''}
          </div>
        `).join('')}
      `}
    </div>
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Work Items</h3>
        <button class="btn btn-secondary btn-sm" id="create-work-item">+ Add Item</button>
      </div>
      ${workItems.length === 0 ? '<div class="empty-state p-lg"><div class="empty-state-text">No work items</div></div>' : `
        ${workItems.map((wi) => `
          <div class="flex items-center gap-md p-sm border-b border-edge">
            <span class="badge ${wi.status === 'completed' ? 'green' : wi.status === 'failed' ? 'red' : wi.status === 'in_progress' ? 'yellow' : ''}">${escapeHtml(wi.status)}</span>
            <span class="flex-1">${escapeHtml(wi.subject || wi.id.slice(0, 12))}</span>
            ${wi.assignee ? `<span class="text-xs text-fg-muted">${escapeHtml(wi.assignee)}</span>` : ''}
          </div>
        `).join('')}
      `}
    </div>
  `;
}

function renderWorktreeTab(workers: WorkerInfo[]): string {
  return `
    <div class="card">
      <h3 class="card-title mb-md">Worker Worktrees</h3>
      ${workers.length === 0 ? '<div class="empty-state p-lg"><div class="empty-state-text">No active workers</div></div>' : `
        ${workers.map((w) => `
          <div class="flex items-center gap-md p-sm border-b border-edge worktree-row" data-handle="${escapeHtml(w.handle)}">
            <span class="font-mono text-sm font-medium">${escapeHtml(w.handle)}</span>
            <span class="badge ${w.state === 'working' ? 'yellow' : w.state === 'ready' ? 'green' : ''}">${escapeHtml(w.state)}</span>
            <span class="flex-1"></span>
            <button class="btn btn-secondary btn-sm wt-status">Status</button>
            <button class="btn btn-secondary btn-sm wt-commit">Commit</button>
            <button class="btn btn-secondary btn-sm wt-push">Push</button>
            <button class="btn btn-primary btn-sm wt-pr">PR</button>
          </div>
        `).join('')}
      `}
    </div>
    <div class="card mt-md" id="worktree-detail">
      <div class="empty-state p-lg"><div class="empty-state-text">Select a worker to view worktree status</div></div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export async function renderOperations(container: HTMLElement): Promise<() => void> {
  let currentTab = 'waves';
  let waves: Wave[] = [];
  let multiRepoOps: MultiRepoOp[] = [];
  let batches: Batch[] = [];
  let workItems: WorkItem[] = [];

  const workers = (store.get('workers') ?? []) as WorkerInfo[];

  container.innerHTML = `
    <div class="flex gap-xs border-b border-edge mb-lg">
      <button class="tab-btn active border-b-2 border-b-blue text-fg font-semibold py-sm px-md bg-transparent border-0 cursor-pointer" data-tab="waves">Waves</button>
      <button class="tab-btn py-sm px-md bg-transparent border-0 border-b-2 border-b-transparent text-fg-secondary cursor-pointer" data-tab="multi-repo">Multi-Repo</button>
      <button class="tab-btn py-sm px-md bg-transparent border-0 border-b-2 border-b-transparent text-fg-secondary cursor-pointer" data-tab="batches">Batches</button>
      <button class="tab-btn py-sm px-md bg-transparent border-0 border-b-2 border-b-transparent text-fg-secondary cursor-pointer" data-tab="worktrees">Worktrees</button>
    </div>
    <div id="ops-tab-content">
      <div class="loading"><div class="spinner"></div></div>
    </div>
  `;

  async function loadTab(tab: string): Promise<void> {
    const el = document.getElementById('ops-tab-content')!;
    try {
      if (tab === 'waves') {
        waves = await getWaves().catch(() => []);
        el.innerHTML = renderWavesTab(waves);
      } else if (tab === 'multi-repo') {
        multiRepoOps = await getMultiRepoOps().catch(() => []);
        el.innerHTML = renderMultiRepoTab(multiRepoOps);
      } else if (tab === 'batches') {
        [batches, workItems] = await Promise.all([
          getBatches().catch(() => []),
          getWorkItems().catch(() => []),
        ]);
        el.innerHTML = renderBatchesTab(batches, workItems);
      } else if (tab === 'worktrees') {
        el.innerHTML = renderWorktreeTab(workers);
      }
    } catch (e) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state-text">${escapeHtml((e as Error).message)}</div></div>`;
    }
  }

  // Tab switching
  container.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab!;
      if (tab === currentTab) return;
      container.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.remove('active', 'border-b-blue', 'text-fg', 'font-semibold');
        b.classList.add('border-b-transparent', 'text-fg-secondary');
      });
      btn.classList.add('active', 'border-b-blue', 'text-fg', 'font-semibold');
      btn.classList.remove('border-b-transparent', 'text-fg-secondary');
      currentTab = tab;
      loadTab(tab);
    });
  });

  // Event delegation
  container.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Cancel wave
    const cancelBtn = target.closest('.cancel-wave') as HTMLElement | null;
    if (cancelBtn) {
      const row = cancelBtn.closest('[data-wave-id]') as HTMLElement | null;
      if (row?.dataset.waveId) {
        try { await cancelWave(row.dataset.waveId); toast.success('Wave cancelled'); await loadTab('waves'); } catch (err) { toast.error((err as Error).message); }
      }
      return;
    }

    // Multi-repo shortcuts
    const shortcut = target.closest('.multi-repo-shortcut') as HTMLElement | null;
    if (shortcut) {
      const repos = prompt('Enter repo paths (comma-separated):');
      if (!repos) return;
      const repoList = repos.split(',').map((r) => r.trim()).filter(Boolean);
      const action = shortcut.dataset.action!;
      try {
        if (action === 'update-deps') await multiRepoUpdateDeps(repoList);
        else if (action === 'security-audit') await multiRepoSecurityAudit(repoList);
        else if (action === 'format-code') await multiRepoFormatCode(repoList);
        else if (action === 'run-tests') await multiRepoRunTests(repoList);
        toast.success(`${action} started`);
        await loadTab('multi-repo');
      } catch (err) { toast.error((err as Error).message); }
      return;
    }

    // Dispatch batch
    const dispatchBtn = target.closest('.dispatch-batch') as HTMLElement | null;
    if (dispatchBtn) {
      const row = dispatchBtn.closest('[data-batch-id]') as HTMLElement | null;
      if (row?.dataset.batchId) {
        try { await dispatchBatch(row.dataset.batchId); toast.success('Batch dispatched'); await loadTab('batches'); } catch (err) { toast.error((err as Error).message); }
      }
      return;
    }

    // Create batch
    if (target.closest('#create-batch')) {
      const name = prompt('Batch name:');
      if (name) {
        try { await createBatch({ name }); toast.success('Batch created'); await loadTab('batches'); } catch (err) { toast.error((err as Error).message); }
      }
      return;
    }

    // Create work item
    if (target.closest('#create-work-item')) {
      const subject = prompt('Work item subject:');
      if (subject) {
        try { await createWorkItem({ subject }); toast.success('Item created'); await loadTab('batches'); } catch (err) { toast.error((err as Error).message); }
      }
      return;
    }

    // Worktree actions
    const wtRow = target.closest('.worktree-row') as HTMLElement | null;
    if (wtRow) {
      const handle = wtRow.dataset.handle!;
      if (target.closest('.wt-status')) {
        try {
          const status = await getWorktreeStatus(handle);
          document.getElementById('worktree-detail')!.innerHTML = `
            <h3 class="card-title mb-md">Worktree: ${escapeHtml(handle)}</h3>
            <pre class="text-xs bg-bg-secondary p-md rounded">${escapeHtml(JSON.stringify(status, null, 2))}</pre>
          `;
        } catch (err) { toast.error((err as Error).message); }
      } else if (target.closest('.wt-commit')) {
        const msg = prompt('Commit message:');
        if (msg) { try { await worktreeCommit(handle, msg); toast.success('Committed'); } catch (err) { toast.error((err as Error).message); } }
      } else if (target.closest('.wt-push')) {
        try { await worktreePush(handle); toast.success('Pushed'); } catch (err) { toast.error((err as Error).message); }
      } else if (target.closest('.wt-pr')) {
        const title = prompt('PR title:');
        if (title) { try { await worktreeCreatePR(handle, { title }); toast.success('PR created'); } catch (err) { toast.error((err as Error).message); } }
      }
    }
  });

  await loadTab('waves');

  return () => {};
}
