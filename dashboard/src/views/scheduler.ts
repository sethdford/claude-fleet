/**
 * Scheduler View
 * Shows scheduler status, schedules list, task queue, and templates.
 * Render functions live in scheduler-render.ts.
 */

import toast from '@/components/toast';
import { confirm as confirmDialog } from '@/components/confirm';
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
import {
  createSchedule as apiCreateSchedule,
  enqueueTask as apiEnqueueTask,
  executeTemplate as apiExecuteTemplate,
  enableNotifications,
  disableNotifications,
  testNotification,
} from '@/api-operations';
import type { SchedulerStatus, Schedule, QueueTask, TaskTemplate } from '@/types';
import {
  renderStatusCard,
  renderSchedulesList,
  renderQueueSection,
  renderTemplatesList,
} from './scheduler-render';

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
  try { schedulerStatus = (await fetchSchedulerStatus()) as SchedulerStatus; }
  catch { schedulerStatus = null; }
}

async function fetchSchedules(): Promise<void> {
  try { const result = await apiGetSchedules(); schedules = Array.isArray(result) ? result as Schedule[] : []; }
  catch { schedules = []; }
}

async function fetchQueue(): Promise<void> {
  try { queue = (await apiGetQueue()) as unknown as QueueState; }
  catch { queue = { queued: [], running: [], counts: { queued: 0, running: 0 } }; }
}

async function fetchTemplates(): Promise<void> {
  try { const result = await apiGetTemplates(); templates = Array.isArray(result) ? result as TaskTemplate[] : []; }
  catch { templates = []; }
}

async function fetchAll(): Promise<void> {
  await Promise.all([fetchStatus(), fetchSchedules(), fetchQueue(), fetchTemplates()]);
}

// ============================================================================
// Actions
// ============================================================================

async function startScheduler(): Promise<void> {
  try { await apiStartScheduler(); await fetchStatus(); renderContent(); }
  catch (err) { toast.error('Failed to start scheduler: ' + (err as Error).message); }
}

async function stopScheduler(): Promise<void> {
  try { await apiStopScheduler(); await fetchStatus(); renderContent(); }
  catch (err) { toast.error('Failed to stop scheduler: ' + (err as Error).message); }
}

async function loadDefaults(): Promise<void> {
  try { await loadDefaultSchedules(); await fetchSchedules(); renderContent(); }
  catch (err) { toast.error('Failed to load defaults: ' + (err as Error).message); }
}

async function toggleSchedule(id: string, enable: boolean): Promise<void> {
  try { await apiToggleSchedule(id, enable); await fetchSchedules(); renderContent(); }
  catch (err) { toast.error('Failed to update schedule: ' + (err as Error).message); }
}

async function deleteSchedule(id: string): Promise<void> {
  try { await apiDeleteSchedule(id); await fetchSchedules(); renderContent(); }
  catch (err) { toast.error('Failed to delete schedule: ' + (err as Error).message); }
}

async function cancelTask(taskId: string): Promise<void> {
  try { await apiCancelQueueTask(taskId); await fetchQueue(); renderContent(); }
  catch (err) { toast.error('Failed to cancel task: ' + (err as Error).message); }
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
        ${renderStatusCard(schedulerStatus, schedules.length, queue, templates.length)}
      </div>
    </section>

    <section class="mb-md">
      <div class="flex justify-between items-center mb-md">
        <h2 class="card-subtitle">Schedules</h2>
        <div class="flex gap-sm">
          <button class="btn btn-primary btn-sm" id="sched-create">+ Create</button>
          <button class="btn btn-secondary btn-sm" id="sched-load-defaults">Load Defaults</button>
        </div>
      </div>
      <div id="sched-schedules-container">
        ${renderSchedulesList(schedules)}
      </div>
    </section>

    <div class="grid-2-col">
      <section>
        <div class="flex justify-between items-center mb-md">
          <h2 class="card-subtitle">Task Queue</h2>
          <button class="btn btn-secondary btn-sm" id="sched-enqueue">+ Enqueue Task</button>
        </div>
        <div id="sched-queue-container">
          ${renderQueueSection(queue)}
        </div>
      </section>

      <section>
        <h2 class="card-subtitle mb-md">Templates</h2>
        <div id="sched-templates-container">
          ${renderTemplatesList(templates)}
        </div>
      </section>
    </div>

    <section class="mt-md">
      <h2 class="card-subtitle mb-md">Notifications</h2>
      <div class="card">
        <div class="flex gap-sm">
          <button class="btn btn-secondary btn-sm" id="notif-enable">Enable</button>
          <button class="btn btn-secondary btn-sm" id="notif-disable">Disable</button>
          <button class="btn btn-secondary btn-sm" id="notif-test">Test</button>
        </div>
      </div>
    </section>
  `;
}

function attachEventDelegation(): void {
  if (!containerEl) return;

  containerEl.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    if (target.closest('#sched-start')) { startScheduler(); return; }
    if (target.closest('#sched-stop')) { stopScheduler(); return; }
    if (target.closest('#sched-load-defaults')) { loadDefaults(); return; }

    if (target.closest('#sched-create')) {
      const name = prompt('Schedule name:');
      if (!name) return;
      const cron = prompt('Cron expression (e.g. 0 */6 * * *):');
      if (!cron) return;
      const repository = prompt('Repository (optional):') || undefined;
      try {
        await apiCreateSchedule({ name, cron, repository });
        toast.success('Schedule created');
        await fetchSchedules();
        renderContent();
      } catch (err) { toast.error('Failed to create schedule: ' + (err as Error).message); }
      return;
    }

    if (target.closest('#sched-enqueue')) {
      const name = prompt('Task name:');
      if (!name) return;
      try {
        await apiEnqueueTask({ name });
        toast.success('Task enqueued');
        await fetchQueue();
        renderContent();
      } catch (err) { toast.error('Failed to enqueue task: ' + (err as Error).message); }
      return;
    }

    if (target.closest('#notif-enable')) {
      try { await enableNotifications(); toast.success('Notifications enabled'); } catch (err) { toast.error((err as Error).message); }
      return;
    }
    if (target.closest('#notif-disable')) {
      try { await disableNotifications(); toast.success('Notifications disabled'); } catch (err) { toast.error((err as Error).message); }
      return;
    }
    if (target.closest('#notif-test')) {
      try { await testNotification(); toast.success('Test notification sent'); } catch (err) { toast.error((err as Error).message); }
      return;
    }

    const toggleBtn = target.closest('.schedule-toggle') as HTMLElement | null;
    if (toggleBtn) {
      const id = toggleBtn.dataset.id;
      const enable = toggleBtn.dataset.enable === 'true';
      if (id) toggleSchedule(id, enable);
      return;
    }

    const deleteBtn = target.closest('.schedule-delete') as HTMLElement | null;
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      if (!id) return;
      confirmDialog({
        title: 'Delete Schedule',
        message: `Delete schedule "${id}"? This cannot be undone.`,
        confirmText: 'Delete',
        variant: 'danger',
      }).then(confirmed => { if (confirmed) deleteSchedule(id); });
      return;
    }

    const runBtn = target.closest('.run-template') as HTMLElement | null;
    if (runBtn) {
      const templateId = runBtn.dataset.templateId;
      if (templateId) {
        try { await apiExecuteTemplate(templateId); toast.success('Template executed'); } catch (err) { toast.error((err as Error).message); }
      }
      return;
    }

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

export async function renderScheduler(container: HTMLElement): Promise<() => void> {
  containerEl = container;
  containerEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  await fetchAll();
  renderContent();
  attachEventDelegation();

  pollTimer = setInterval(async () => {
    await Promise.all([fetchStatus(), fetchQueue()]);
    const statusEl = document.getElementById('sched-status-container');
    if (statusEl) statusEl.innerHTML = renderStatusCard(schedulerStatus, schedules.length, queue, templates.length);
    const queueEl = document.getElementById('sched-queue-container');
    if (queueEl) queueEl.innerHTML = renderQueueSection(queue);
  }, 5000);

  return () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    containerEl = null;
    schedulerStatus = null;
    schedules = [];
    queue = { queued: [], running: [], counts: { queued: 0, running: 0 } };
    templates = [];
  };
}
