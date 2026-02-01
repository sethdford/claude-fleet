/**
 * Connections View — Remote Agent Management
 * Shows external workers connected from other machines,
 * with health monitoring and connection command generation.
 */

import dayjs from 'dayjs';
import store from '@/store';
import toast from '@/components/toast';
import { confirm as confirmDialog } from '@/components/confirm';
import { escapeHtml } from '@/utils/escape-html';
import * as api from '@/api';
import type { WorkerInfo } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExternalWorkers(): WorkerInfo[] {
  const workers = store.get('workers') ?? [];
  return workers.filter(w => w.spawnMode === 'external');
}

interface ConnectionStats {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
}

function computeStats(workers: WorkerInfo[]): ConnectionStats {
  const stats: ConnectionStats = { total: workers.length, healthy: 0, degraded: 0, unhealthy: 0 };
  for (const w of workers) {
    const health = w.health ?? 'healthy';
    if (health === 'healthy') stats.healthy++;
    else if (health === 'degraded') stats.degraded++;
    else stats.unhealthy++;
  }
  return stats;
}

function initials(handle: string): string {
  if (!handle) return '??';
  const parts = handle.split(/[-_]/);
  if (parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return handle.slice(0, 2).toUpperCase() || '??';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderStats(stats: ConnectionStats): string {
  return `
    <div class="grid grid-cols-4 gap-md" style="margin-bottom: 24px;">
      <div class="card" style="text-align: center; padding: 16px;">
        <div style="font-size: 28px; font-weight: 700; color: var(--color-fg);">${stats.total}</div>
        <div class="text-fg-muted" style="font-size: 12px; margin-top: 4px;">Total Connections</div>
      </div>
      <div class="card" style="text-align: center; padding: 16px;">
        <div style="font-size: 28px; font-weight: 700; color: var(--color-green);">${stats.healthy}</div>
        <div class="text-fg-muted" style="font-size: 12px; margin-top: 4px;">Healthy</div>
      </div>
      <div class="card" style="text-align: center; padding: 16px;">
        <div style="font-size: 28px; font-weight: 700; color: var(--color-yellow);">${stats.degraded}</div>
        <div class="text-fg-muted" style="font-size: 12px; margin-top: 4px;">Degraded</div>
      </div>
      <div class="card" style="text-align: center; padding: 16px;">
        <div style="font-size: 28px; font-weight: 700; color: var(--color-red);">${stats.unhealthy}</div>
        <div class="text-fg-muted" style="font-size: 12px; margin-top: 4px;">Unhealthy</div>
      </div>
    </div>
  `;
}

function renderWorkerCard(worker: WorkerInfo): string {
  const health = worker.health ?? 'healthy';
  const handle = escapeHtml(worker.handle);
  const team = escapeHtml(worker.teamName ?? 'default');
  const avatar = initials(worker.handle);
  const spawnedAt = worker.spawnedAt ? dayjs(worker.spawnedAt).fromNow() : 'unknown';
  const workDir = worker.workingDir ? escapeHtml(worker.workingDir) : '<span class="text-fg-muted">not set</span>';
  const swarm = worker.swarmId ? `<span class="badge blue">${escapeHtml(worker.swarmId)}</span>` : '<span class="text-fg-muted">none</span>';

  return `
    <div class="card" style="padding: 16px;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
        <div style="width: 40px; height: 40px; border-radius: 8px; background: var(--color-surface-raised); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: var(--color-fg-muted);">
          ${avatar}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; font-size: 14px;">${handle}</div>
          <div class="text-fg-muted" style="font-size: 12px;">${team}</div>
        </div>
        <span class="status-dot ${health}" title="${health}"></span>
      </div>

      <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; margin-bottom: 12px;">
        <span class="text-fg-muted">State</span>
        <span><span class="badge ${worker.state === 'ready' ? 'green' : worker.state === 'working' ? 'blue' : 'yellow'}">${escapeHtml(worker.state)}</span></span>

        <span class="text-fg-muted">Connected</span>
        <span>${spawnedAt}</span>

        <span class="text-fg-muted">Directory</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${workDir}</span>

        <span class="text-fg-muted">Swarm</span>
        <span>${swarm}</span>
      </div>

      <div style="display: flex; gap: 8px;">
        <a href="#/worker/${encodeURIComponent(worker.handle)}" class="btn btn-secondary btn-sm" style="flex: 1; text-align: center; text-decoration: none;">
          View Terminal
        </a>
        <button class="btn btn-secondary btn-sm dismiss-connection-btn" data-handle="${handle}" style="color: var(--color-red);">
          Dismiss
        </button>
      </div>
    </div>
  `;
}

function renderEmptyState(): string {
  return `
    <div style="text-align: center; padding: 64px 24px;">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--color-fg-muted); margin-bottom: 16px;">
        <circle cx="12" cy="12" r="3"/>
        <circle cx="4" cy="5" r="2"/>
        <circle cx="20" cy="5" r="2"/>
        <circle cx="4" cy="19" r="2"/>
        <circle cx="20" cy="19" r="2"/>
        <path d="M5.5 6.5L9.5 10M18.5 6.5L14.5 10M5.5 17.5L9.5 14M18.5 17.5L14.5 14"/>
      </svg>
      <h3 style="margin: 0 0 8px; font-size: 16px;">No Remote Agents</h3>
      <p class="text-fg-muted" style="margin: 0 0 16px; font-size: 13px;">
        Connect Claude Code instances from other machines to this Fleet server.
      </p>
      <button class="btn btn-primary btn-sm empty-connect-btn">Connect New Agent</button>
    </div>
  `;
}

function renderView(container: HTMLElement, workers: WorkerInfo[]): void {
  const stats = computeStats(workers);

  let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <div>
        <h2 style="margin: 0 0 4px; font-size: 18px;">Remote Connections</h2>
        <p class="text-fg-muted" style="margin: 0; font-size: 13px;">
          Manage Claude Code agents connected from external machines.
        </p>
      </div>
      <button class="btn btn-primary btn-sm header-connect-btn">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Connect New Agent
      </button>
    </div>
  `;

  html += renderStats(stats);

  if (workers.length === 0) {
    html += renderEmptyState();
  } else {
    html += '<div class="grid grid-cols-3 gap-md">';
    for (const w of workers) {
      html += renderWorkerCard(w);
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Event delegation — attached ONCE on the stable container element.
// renderView replaces innerHTML (child nodes), but the container itself
// persists, so the delegated listener survives re-renders.
// ---------------------------------------------------------------------------

function attachEvents(container: HTMLElement): void {
  container.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    // "Connect New Agent" buttons
    if (target.closest('.header-connect-btn') || target.closest('.empty-connect-btn')) {
      if (window.fleetDashboard?.showConnectModal) {
        window.fleetDashboard.showConnectModal();
      } else {
        console.error('showConnectModal not available — dashboard may not be fully initialized');
      }
      return;
    }

    // "Dismiss" buttons
    const dismissBtn = target.closest('.dismiss-connection-btn') as HTMLElement | null;
    if (dismissBtn) {
      const handle = dismissBtn.dataset.handle;
      if (!handle) return;

      const confirmed = await confirmDialog({
        title: 'Dismiss Agent',
        message: `Dismiss remote agent "${handle}"? This will disconnect it from the server.`,
        confirmText: 'Dismiss',
        variant: 'danger',
      });
      if (!confirmed) return;

      try {
        await api.dismissWorker(handle);
        toast.success(`Agent "${handle}" dismissed`);
      } catch (err) {
        toast.error('Failed to dismiss worker: ' + (err instanceof Error ? err.message : String(err)));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Public render function
// ---------------------------------------------------------------------------

export function renderConnections(container: HTMLElement): () => void {
  const workers = getExternalWorkers();
  renderView(container, workers);

  // Attach event delegation ONCE — survives innerHTML re-renders
  attachEvents(container);

  const unsub = store.subscribe('workers', () => {
    const updated = getExternalWorkers();
    renderView(container, updated);
    // Do NOT re-attach events — delegated listener on container persists
  });

  return () => {
    unsub();
  };
}
