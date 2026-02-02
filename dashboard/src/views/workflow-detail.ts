/**
 * Workflow Detail View
 * Shows workflow config, triggers, execution timeline, and step actions.
 * Route: #/workflow/:id
 */

import dayjs from 'dayjs';
import toast from '@/components/toast';
import { confirm } from '@/components/confirm';
import { escapeHtml } from '@/utils/escape-html';
import {
  getWorkflow,
  deleteWorkflow,
  createTrigger,
  getTriggers,
  deleteTrigger,
  getExecutions,
  getExecutionSteps,
  getExecutionEvents,
  retryStep,
  completeStep,
  startWorkflow,
} from '@/api-operations';
import type { Trigger, ExecutionDetail, ExecutionStep, ExecutionEvent } from '@/types';

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const STEP_STATUS_ICONS: Record<string, string> = {
  completed: '\u2714',
  running: '\u25B6',
  failed: '\u2716',
  pending: '\u25CB',
  skipped: '\u2500',
};

function renderStepTimeline(steps: ExecutionStep[]): string {
  if (!steps.length) return '<div class="text-fg-muted p-md">No steps</div>';
  return steps.map((s) => `
    <div class="flex items-center gap-md p-sm border-b border-edge step-row" data-step-id="${escapeHtml(s.id)}">
      <span class="text-lg">${STEP_STATUS_ICONS[s.status] || '\u25CB'}</span>
      <div class="flex-1">
        <div class="font-medium text-fg">${escapeHtml(s.name || s.id.slice(0, 12))}</div>
        <div class="text-xs text-fg-muted">
          ${s.startedAt ? dayjs(s.startedAt).fromNow() : 'Not started'}
          ${s.error ? ` \u2014 <span class="text-red">${escapeHtml(s.error.slice(0, 80))}</span>` : ''}
        </div>
      </div>
      <span class="badge ${s.status === 'completed' ? 'green' : s.status === 'failed' ? 'red' : s.status === 'running' ? 'yellow' : ''}">${escapeHtml(s.status)}</span>
      ${s.status === 'failed' ? `<button class="btn btn-secondary btn-sm retry-step">Retry</button>` : ''}
      ${s.status === 'running' ? `<button class="btn btn-secondary btn-sm complete-step">Complete</button>` : ''}
    </div>
  `).join('');
}

function renderTriggerList(triggers: Trigger[]): string {
  if (!triggers.length) return '<div class="text-fg-muted p-md">No triggers configured</div>';
  return triggers.map((t) => `
    <div class="flex items-center gap-md p-sm border-b border-edge" data-trigger-id="${escapeHtml(t.id)}">
      <span class="badge blue">${escapeHtml(t.triggerType)}</span>
      <span class="text-fg-secondary text-sm flex-1 font-mono">${escapeHtml(JSON.stringify(t.config || {}).slice(0, 80))}</span>
      <button class="btn btn-danger btn-sm delete-trigger">\u2715</button>
    </div>
  `).join('');
}

function renderEventLog(events: ExecutionEvent[]): string {
  if (!events.length) return '<div class="text-fg-muted p-md">No events</div>';
  return events.slice(0, 30).map((ev) => `
    <div class="flex items-center gap-sm p-xs border-b border-edge text-xs">
      <span class="badge">${escapeHtml(ev.eventType)}</span>
      <span class="text-fg-muted">${ev.createdAt ? dayjs(ev.createdAt).format('HH:mm:ss') : ''}</span>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export async function renderWorkflowDetail(container: HTMLElement, workflowId: string): Promise<() => void> {
  container.innerHTML = '<div class="loading p-xl text-center"><div class="spinner"></div></div>';

  let workflow: Record<string, unknown> | undefined;
  let triggers: Trigger[] = [];
  let executions: ExecutionDetail[] = [];

  try {
    const [wf, trig, execs] = await Promise.all([
      getWorkflow(workflowId),
      getTriggers(workflowId),
      getExecutions({ workflowId, limit: 10 }),
    ]);
    workflow = wf as Record<string, unknown>;
    triggers = Array.isArray(trig) ? trig : [];
    executions = Array.isArray(execs) ? execs : [];
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Failed to Load Workflow</div><div class="empty-state-text">${escapeHtml((e as Error).message)}</div></div>`;
    return () => {};
  }

  container.innerHTML = `
    <div class="mb-md">
      <a href="#/workflows" class="text-blue text-sm">\u2190 Back to Workflows</a>
    </div>

    <div class="card mb-md">
      <div class="card-header">
        <div>
          <h2 class="card-title">${escapeHtml(String(workflow?.name || 'Untitled'))}</h2>
          <div class="font-mono text-xs text-fg-muted">${escapeHtml(workflowId)}</div>
        </div>
        <div class="flex gap-sm">
          <button class="btn btn-primary btn-sm" id="wf-start">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Start
          </button>
          <button class="btn btn-danger btn-sm" id="wf-delete">\u2715 Delete</button>
        </div>
      </div>
      ${workflow?.description ? `<p class="text-fg-secondary mt-sm">${escapeHtml(String(workflow.description))}</p>` : ''}
      <div class="flex gap-lg mt-md text-sm text-fg-muted">
        <span>${(workflow?.steps as unknown[] | undefined)?.length || 0} steps</span>
        <span>${triggers.length} triggers</span>
        <span>${executions.length} executions</span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-lg">
      <div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Triggers</h3>
            <button class="btn btn-secondary btn-sm" id="add-trigger">+ Add</button>
          </div>
          <div id="triggers-list">${renderTriggerList(triggers)}</div>
        </div>

        <div class="card mt-md">
          <h3 class="card-title mb-md">Recent Executions</h3>
          <div id="executions-list">
            ${executions.length === 0 ? '<div class="text-fg-muted p-md">No executions yet</div>' : executions.map((ex) => `
              <div class="flex items-center gap-md p-sm border-b border-edge exec-row" data-exec-id="${escapeHtml(ex.id)}">
                <span class="badge ${ex.status === 'completed' ? 'green' : ex.status === 'failed' ? 'red' : ex.status === 'running' ? 'yellow' : ''}">${escapeHtml(ex.status)}</span>
                <span class="font-mono text-xs text-fg-muted">${escapeHtml(ex.id.slice(0, 12))}</span>
                <span class="text-xs text-fg-secondary">${ex.startedAt ? dayjs(ex.startedAt).fromNow() : ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <h3 class="card-title mb-md">Steps</h3>
          <div id="steps-timeline">
            <div class="text-fg-muted p-md">Select an execution to view steps</div>
          </div>
        </div>

        <div class="card mt-md">
          <h3 class="card-title mb-md">Event Log</h3>
          <div id="event-log" class="max-h-[300px] overflow-y-auto">
            <div class="text-fg-muted p-md">Select an execution to view events</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // --- Event delegation ---
  container.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Start workflow
    if (target.closest('#wf-start')) {
      try {
        await startWorkflow(workflowId);
        toast.success('Workflow started');
        const execs = await getExecutions({ workflowId, limit: 10 });
        executions = Array.isArray(execs) ? execs : [];
        const el = document.getElementById('executions-list');
        if (el) el.innerHTML = executions.map((ex) => `
          <div class="flex items-center gap-md p-sm border-b border-edge exec-row" data-exec-id="${escapeHtml(ex.id)}">
            <span class="badge ${ex.status === 'completed' ? 'green' : ex.status === 'failed' ? 'red' : ex.status === 'running' ? 'yellow' : ''}">${escapeHtml(ex.status)}</span>
            <span class="font-mono text-xs text-fg-muted">${escapeHtml(ex.id.slice(0, 12))}</span>
            <span class="text-xs text-fg-secondary">${ex.startedAt ? dayjs(ex.startedAt).fromNow() : ''}</span>
          </div>
        `).join('');
      } catch (err) {
        toast.error('Failed to start: ' + (err as Error).message);
      }
      return;
    }

    // Delete workflow
    if (target.closest('#wf-delete')) {
      const confirmed = await confirm({ title: 'Delete Workflow', message: 'This will permanently delete the workflow and all its triggers.', confirmText: 'Delete', variant: 'danger' });
      if (confirmed) {
        try {
          await deleteWorkflow(workflowId);
          toast.success('Workflow deleted');
          window.location.hash = '/workflows';
        } catch (err) {
          toast.error('Failed to delete: ' + (err as Error).message);
        }
      }
      return;
    }

    // Add trigger
    if (target.closest('#add-trigger')) {
      const triggerType = prompt('Trigger type (e.g. cron, webhook):');
      if (!triggerType) return;
      try {
        await createTrigger(workflowId, { triggerType });
        triggers = await getTriggers(workflowId);
        const el = document.getElementById('triggers-list');
        if (el) el.innerHTML = renderTriggerList(triggers);
        toast.success('Trigger added');
      } catch (err) {
        toast.error('Failed to add trigger: ' + (err as Error).message);
      }
      return;
    }

    // Delete trigger
    const delTrigBtn = target.closest('.delete-trigger') as HTMLElement | null;
    if (delTrigBtn) {
      const trigRow = delTrigBtn.closest('[data-trigger-id]') as HTMLElement | null;
      const triggerId = trigRow?.dataset.triggerId;
      if (triggerId) {
        try {
          await deleteTrigger(triggerId);
          triggers = await getTriggers(workflowId);
          const el = document.getElementById('triggers-list');
          if (el) el.innerHTML = renderTriggerList(triggers);
          toast.success('Trigger deleted');
        } catch (err) {
          toast.error('Failed to delete trigger: ' + (err as Error).message);
        }
      }
      return;
    }

    // Retry step
    const retryBtn = target.closest('.retry-step') as HTMLElement | null;
    if (retryBtn) {
      const stepRow = retryBtn.closest('[data-step-id]') as HTMLElement | null;
      const stepId = stepRow?.dataset.stepId;
      if (stepId) {
        try {
          await retryStep(stepId);
          toast.success('Step retried');
        } catch (err) {
          toast.error('Failed to retry: ' + (err as Error).message);
        }
      }
      return;
    }

    // Complete step
    const completeBtn = target.closest('.complete-step') as HTMLElement | null;
    if (completeBtn) {
      const stepRow = completeBtn.closest('[data-step-id]') as HTMLElement | null;
      const stepId = stepRow?.dataset.stepId;
      if (stepId) {
        try {
          await completeStep(stepId);
          toast.success('Step completed');
        } catch (err) {
          toast.error('Failed to complete: ' + (err as Error).message);
        }
      }
      return;
    }

    // Select execution to view steps/events
    const execRow = target.closest('.exec-row') as HTMLElement | null;
    if (execRow) {
      const execId = execRow.dataset.execId;
      if (!execId) return;
      try {
        const [steps, events] = await Promise.all([
          getExecutionSteps(execId),
          getExecutionEvents(execId),
        ]);
        const stepsEl = document.getElementById('steps-timeline');
        const eventsEl = document.getElementById('event-log');
        if (stepsEl) stepsEl.innerHTML = renderStepTimeline(Array.isArray(steps) ? steps : []);
        if (eventsEl) eventsEl.innerHTML = renderEventLog(Array.isArray(events) ? events : []);
      } catch (err) {
        toast.error('Failed to load execution details: ' + (err as Error).message);
      }
    }
  });

  return () => {};
}
