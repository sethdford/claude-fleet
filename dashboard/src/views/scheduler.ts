/**
 * Scheduler View
 * Shows scheduler status, schedules list, task queue, and templates
 */

import toast from '@/components/toast';
import { confirm as confirmDialog } from '@/components/confirm';
import { escapeHtml } from '@/utils/escape-html';
import { formatTime } from '@/utils/format';
import {
  getSchedulerStatus as fetchSchedulerStatus,
  startScheduler as apiStartScheduler,
  stopScheduler as apiStopScheduler,
  getSchedules as apiGetSchedules,
  loadDefaultSchedules,
  toggleSchedule as apiToggleSchedule,
  deleteSchedule as apiDeleteSchedule,
  getQueue as apiGetQueue,
  cancelQueueTask as apiCancelQueueTask,
  getTemplates as apiGetTemplates,
} from '@/api';
import type {
  SchedulerStatus,
  Schedule,
  QueueTask,
  TaskTemplate,
} from '@/types';

// ============================================================================
// State
// ============================================================================

interface QueueState {
  queued: QueueTask[];
  running: QueueTask[];
  counts: { queued: number; running: number };
}

let schedulerStatus: SchedulerStatus | null = null;
let schedules: Schedule[] = [];
let queue: QueueState = { queued: [], running: [], counts: { queued: 0, running: 0 } };
let templates: TaskTemplate[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchStatus(): Promise<void> {
  try {
    schedulerStatus = (await fetchSchedulerStatus()) as SchedulerStatus;
  } catch {
    schedulerStatus = null;
  }
}

async function fetchSchedules(): Promise<void> {
  try {
    const result = await apiGetSchedules();
    schedules = Array.isArray(result) ? result as Schedule[] : [];
  } catch {
    schedules = [];
  }
}

async function fetchQueue(): Promise<void> {
  try {
    queue = (await apiGetQueue()) as unknown as QueueState;
  } catch {
    queue = { queued: [], running: [], counts: { queued: 0, running: 0 } };
  }
}

async function fetchTemplates(): Promise<void> {
  try {
    const result = await apiGetTemplates();
    templates = Array.isArray(result) ? result as TaskTemplate[] : [];
  } catch {
    templates = [];
  }
}

async function fetchAll(): Promise<void> {
  await Promise.all([fetchStatus(), fetchSchedules(), fetchQueue(), fetchTemplates()]);
}

// ============================================================================
// Actions
// ============================================================================

async function startScheduler(): Promise<void> {
  try {
    await apiStartScheduler();
    await fetchStatus();
    renderContent();
  } catch (err) {
    toast.error('Failed to start scheduler: ' + (err as Error).message);
  }
}

async function stopScheduler(): Promise<void> {
  try {
    await apiStopScheduler();
    await fetchStatus();
    renderContent();
  } catch (err) {
    toast.error('Failed to stop scheduler: ' + (err as Error).message);
  }
}

async function loadDefaults(): Promise<void> {
  try {
    await loadDefaultSchedules();
    await fetchSchedules();
    renderContent();
  } catch (err) {
    toast.error('Failed to load defaults: ' + (err as Error).message);
  }
}

async function toggleSchedule(id: string, enable: boolean): Promise<void> {
  try {
    await apiToggleSchedule(id, enable);
    await fetchSchedules();
    renderContent();
  } catch (err) {
    toast.error('Failed to update schedule: ' + (err as Error).message);
  }
}

async function deleteSchedule(id: string): Promise<void> {
  try {
    await apiDeleteSchedule(id);
    await fetchSchedules();
    renderContent();
  } catch (err) {
    toast.error('Failed to delete schedule: ' + (err as Error).message);
  }
}

async function cancelTask(taskId: string): Promise<void> {
  try {
    await apiCancelQueueTask(taskId);
    await fetchQueue();
    renderContent();
  } catch (err) {
    toast.error('Failed to cancel task: ' + (err as Error).message);
  }
}

// ============================================================================
// Rendering
// ============================================================================

function renderStatusCard(): string {
  if (!schedulerStatus) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <div class="empty-state-title">Scheduler Unavailable</div>
          <div class="empty-state-text">Could not connect to scheduler service</div>
        </div>
      </div>
    `;
  }

  const isRunning = schedulerStatus.running || schedulerStatus.isRunning;
  const statusClass = isRunning ? 'green' : 'yellow';
  const statusText = isRunning ? 'Running' : 'Stopped';

  return `
    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">Status</div>
        <div class="metric-value ${statusClass}">${statusText}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Schedules</div>
        <div class="metric-value">${schedules.length}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Queued</div>
        <div class="metric-value purple">${queue.counts?.queued || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Running</div>
        <div class="metric-value blue">${queue.counts?.running || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Templates</div>
        <div class="metric-value">${templates.length}</div>
      </div>
    </div>
  `;
}

function renderSchedulesList(): string {
  if (schedules.length === 0) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <div class="empty-state-title">No Schedules</div>
          <div class="empty-state-text">Click "Load Defaults" to add standard schedules, or create custom ones via the API</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="worker-list">
      ${schedules.map(s => {
        const isEnabled = s.enabled !== false;
        return `
          <div class="worker-item cursor-default">
            <span class="status-dot ${isEnabled ? 'healthy' : 'stopped'}"></span>
            <div class="worker-info flex-1">
              <div class="worker-handle">${escapeHtml(s.name)}</div>
              <div class="worker-meta">
                <code>${escapeHtml(s.cron)}</code>
                ${s.repository ? ` &bull; ${escapeHtml(s.repository)}` : ''}
                ${s.tasks ? ` &bull; ${s.tasks.length} task${s.tasks.length !== 1 ? 's' : ''}` : ''}
              </div>
            </div>
            <div class="flex items-center gap-1">
              <button class="btn btn-secondary btn-sm schedule-toggle" data-id="${escapeHtml(s.id)}" data-enable="${isEnabled ? 'false' : 'true'}">
                ${isEnabled ? 'Disable' : 'Enable'}
              </button>
              <button class="btn btn-secondary btn-sm schedule-delete text-red" data-id="${escapeHtml(s.id)}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-2 14H7L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderQueueSection(): string {
  const allTasks: QueueTask[] = [...(queue.running || []), ...(queue.queued || [])];

  if (allTasks.length === 0) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
          <div class="empty-state-title">Queue Empty</div>
          <div class="empty-state-text">No tasks are queued or running</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="worker-list">
      ${allTasks.map(t => {
        const isRunning = t.status === 'running';
        return `
          <div class="worker-item cursor-default">
            <span class="status-dot ${isRunning ? 'healthy' : 'pending'}"></span>
            <div class="worker-info flex-1">
              <div class="worker-handle">${escapeHtml(t.name)}</div>
              <div class="worker-meta">
                ${escapeHtml(t.trigger || 'scheduled')}
                ${t.repository ? ` &bull; ${escapeHtml(t.repository)}` : ''}
                ${t.priority ? ` &bull; ${escapeHtml(t.priority)}` : ''}
                ${t.startedAt ? ` &bull; started ${formatTime(t.startedAt)}` : ''}
              </div>
            </div>
            <div class="flex items-center gap-1">
              <span class="badge ${isRunning ? 'green' : ''}">${isRunning ? 'Running' : 'Queued'}</span>
              ${!isRunning ? `
                <button class="btn btn-secondary btn-sm queue-cancel text-red" data-id="${escapeHtml(t.id)}">
                  Cancel
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderTemplatesList(): string {
  if (templates.length === 0) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <div class="empty-state-title">No Templates</div>
          <div class="empty-state-text">Task templates will appear here when registered</div>
        </div>
      </div>
    `;
  }

  const categories: Record<string, TaskTemplate[]> = {};
  for (const t of templates) {
    const cat = t.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(t);
  }

  return Object.entries(categories).map(([category, items]) => `
    <div class="mb-md">
      <div class="worker-meta mb-sm capitalize font-semibold">${escapeHtml(category)}</div>
      <div class="worker-list">
        ${items.map(t => `
          <div class="worker-item cursor-default">
            <div class="worker-info flex-1">
              <div class="worker-handle">${escapeHtml(t.name)}</div>
              <div class="worker-meta">
                ${escapeHtml(t.description || '')}
                ${t.estimatedMinutes ? ` &bull; ~${t.estimatedMinutes}min` : ''}
                ${t.role ? ` &bull; ${escapeHtml(t.role)}` : ''}
              </div>
            </div>
            <span class="badge">${escapeHtml(t.id)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// ============================================================================
// Main Render
// ============================================================================

let containerEl: HTMLElement | null = null;

function renderContent(): void {
  if (!containerEl) return;

  const isRunning = schedulerStatus?.running || schedulerStatus?.isRunning;

  containerEl.innerHTML = `
    <section class="mb-md">
      <div class="flex justify-between items-center mb-md">
        <h2 class="card-subtitle">Scheduler Status</h2>
        <div class="flex gap-sm">
          ${isRunning
            ? '<button class="btn btn-secondary btn-sm" id="sched-stop">Stop Scheduler</button>'
            : '<button class="btn btn-primary btn-sm" id="sched-start">Start Scheduler</button>'
          }
        </div>
      </div>
      <div id="sched-status-container">
        ${renderStatusCard()}
      </div>
    </section>

    <section class="mb-md">
      <div class="flex justify-between items-center mb-md">
        <h2 class="card-subtitle">Schedules</h2>
        <button class="btn btn-secondary btn-sm" id="sched-load-defaults">Load Defaults</button>
      </div>
      <div id="sched-schedules-container">
        ${renderSchedulesList()}
      </div>
    </section>

    <div class="grid-2-col">
      <section>
        <h2 class="card-subtitle mb-md">Task Queue</h2>
        <div id="sched-queue-container">
          ${renderQueueSection()}
        </div>
      </section>

      <section>
        <h2 class="card-subtitle mb-md">Templates</h2>
        <div id="sched-templates-container">
          ${renderTemplatesList()}
        </div>
      </section>
    </div>
  `;

}

function attachEventDelegation(): void {
  if (!containerEl) return;

  containerEl.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Start/Stop scheduler
    if (target.closest('#sched-start')) { startScheduler(); return; }
    if (target.closest('#sched-stop')) { stopScheduler(); return; }

    // Load defaults
    if (target.closest('#sched-load-defaults')) { loadDefaults(); return; }

    // Schedule toggle
    const toggleBtn = target.closest('.schedule-toggle') as HTMLElement | null;
    if (toggleBtn) {
      const id = toggleBtn.dataset.id;
      const enable = toggleBtn.dataset.enable === 'true';
      if (id) toggleSchedule(id, enable);
      return;
    }

    // Schedule delete
    const deleteBtn = target.closest('.schedule-delete') as HTMLElement | null;
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      if (!id) return;
      confirmDialog({
        title: 'Delete Schedule',
        message: `Delete schedule "${id}"? This cannot be undone.`,
        confirmText: 'Delete',
        variant: 'danger',
      }).then(confirmed => {
        if (confirmed) deleteSchedule(id);
      });
      return;
    }

    // Queue cancel
    const cancelBtn = target.closest('.queue-cancel') as HTMLElement | null;
    if (cancelBtn) {
      const id = cancelBtn.dataset.id;
      if (id) cancelTask(id);
    }
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Render the scheduler view
 */
export async function renderScheduler(container: HTMLElement): Promise<() => void> {
  containerEl = container;

  // Initial loading
  containerEl.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
    </div>
  `;

  await fetchAll();
  renderContent();

  // Attach event delegation ONCE — survives innerHTML re-renders from polling
  attachEventDelegation();

  // Poll for updates
  pollTimer = setInterval(async () => {
    await Promise.all([fetchStatus(), fetchQueue()]);
    // Only re-render the dynamic sections
    const statusEl = document.getElementById('sched-status-container');
    if (statusEl) statusEl.innerHTML = renderStatusCard();
    const queueEl = document.getElementById('sched-queue-container');
    if (queueEl) queueEl.innerHTML = renderQueueSection();
  }, 5000);

  // Return cleanup
  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    containerEl = null;
    schedulerStatus = null;
    schedules = [];
    queue = { queued: [], running: [], counts: { queued: 0, running: 0 } };
    templates = [];
  };
}
