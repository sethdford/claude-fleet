/**
 * Workflow Management View
 * Shows workflow templates, executions, and step status
 * Wired to: /workflows, /workflows/:id/start, /executions, /executions/:id/steps
 */

import dayjs from 'dayjs';
import toast from '@/components/toast';
import { confirm } from '@/components/confirm';
import { escapeHtml } from '@/utils/escape-html';
import {
  getWorkflows,
  getExecutions,
  startWorkflow,
  pauseExecution,
  resumeExecution,
  cancelExecution,
} from '@/api';
import type { Workflow, WorkflowExecution } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  pending: 'blue',
  running: 'yellow',
  completed: 'green',
  failed: 'red',
  paused: 'purple',
  cancelled: 'red',
};

/**
 * Render a workflow template card
 */
function renderWorkflowCard(wf: Workflow): string {
  return `
    <div class="workflow-card" data-workflow-id="${escapeHtml(wf.id)}">
      <div class="flex items-center justify-between mb-md">
        <div>
          <h3 class="text-[15px] font-semibold text-fg m-0">
            ${escapeHtml(wf.name)}
          </h3>
          ${wf.description ? `<p class="text-xs text-fg-secondary mt-xs">${escapeHtml(wf.description.slice(0, 120))}</p>` : ''}
        </div>
        <button class="btn btn-primary btn-sm workflow-start" data-workflow-id="${escapeHtml(wf.id)}" data-workflow-name="${escapeHtml(wf.name)}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Start
        </button>
      </div>
      <div class="flex gap-md text-xs text-fg-muted">
        <span>${wf.steps?.length || 0} steps</span>
        <span>${wf.triggers?.length || 0} triggers</span>
        <span>Created ${wf.createdAt ? dayjs(wf.createdAt).fromNow() : 'unknown'}</span>
      </div>
    </div>
  `;
}

/**
 * Render an execution row
 */
function renderExecutionRow(exec: WorkflowExecution): string {
  const statusColor = STATUS_COLORS[exec.status] || '';
  const completedSteps = exec.steps?.filter(s => s.status === 'completed').length || 0;
  const totalSteps = exec.steps?.length || exec.stepCount || 0;

  return `
    <div class="execution-row" data-execution-id="${escapeHtml(exec.id)}">
      <div class="flex items-center gap-md flex-1">
        <span class="badge ${statusColor}">${escapeHtml(exec.status)}</span>
        <div>
          <div class="font-medium text-fg">${escapeHtml(exec.workflowName || exec.workflowId?.slice(0, 8) || 'Unknown')}</div>
          <div class="font-mono text-[11px] text-fg-muted">${escapeHtml(exec.id.slice(0, 12))}</div>
        </div>
      </div>
      <div class="text-xs text-fg-secondary text-right">
        <div>${completedSteps}/${totalSteps} steps</div>
        <div>${exec.startedAt ? dayjs(exec.startedAt).fromNow() : ''}</div>
      </div>
      <div class="flex gap-sm ml-md">
        ${exec.status === 'running' ? `
          <button class="btn btn-secondary btn-sm exec-pause" data-exec-id="${escapeHtml(exec.id)}" title="Pause">\u23F8</button>
          <button class="btn btn-danger btn-sm exec-cancel" data-exec-id="${escapeHtml(exec.id)}" title="Cancel">\u2715</button>
        ` : ''}
        ${exec.status === 'paused' ? `
          <button class="btn btn-primary btn-sm exec-resume" data-exec-id="${escapeHtml(exec.id)}" title="Resume">\u25B6</button>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Render the workflows view
 */
export async function renderWorkflows(container: HTMLElement): Promise<() => void> {
  container.innerHTML = `
    <div class="workflow-layout">
      <div>
        <h2 class="card-subtitle mb-md">Workflow Templates</h2>
        <div id="workflow-list">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>

      <div>
        <h2 class="card-subtitle mb-md">Executions</h2>
        <div class="card p-0" id="execution-list">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  // Fetch workflows
  async function loadWorkflows(): Promise<void> {
    try {
      const workflows = await getWorkflows();
      const list: Workflow[] = Array.isArray(workflows) ? workflows as Workflow[] : [];
      const el = document.getElementById('workflow-list');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-8">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              <div class="empty-state-title">No Workflows</div>
              <div class="empty-state-text">Create workflows via the API to see them here</div>
            </div>
          </div>
        `;
      } else {
        el.innerHTML = list.map(renderWorkflowCard).join('');
      }
    } catch (e) {
      toast.error('Failed to load workflows: ' + (e as Error).message);
    }
  }

  // Fetch executions
  async function loadExecutions(): Promise<void> {
    try {
      const executions = await getExecutions();
      const list: WorkflowExecution[] = Array.isArray(executions) ? executions as WorkflowExecution[] : [];
      const el = document.getElementById('execution-list');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = `
          <div class="empty-state p-xl">
            <div class="empty-state-text">No executions yet</div>
          </div>
        `;
      } else {
        el.innerHTML = list.map(renderExecutionRow).join('');
      }
    } catch (e) {
      toast.error('Failed to load executions: ' + (e as Error).message);
    }
  }

  await Promise.all([loadWorkflows(), loadExecutions()]);

  // Event delegation
  container.addEventListener('click', async (e: MouseEvent) => {
    // Start workflow
    const startBtn = (e.target as HTMLElement).closest('.workflow-start') as HTMLElement | null;
    if (startBtn) {
      const wfId = startBtn.dataset.workflowId;
      const wfName = startBtn.dataset.workflowName;
      if (!wfId) return;
      const confirmed = await confirm({
        title: 'Start Workflow',
        message: `Start workflow "${wfName}"? This will begin executing all workflow steps.`,
        confirmText: 'Start',
        variant: 'primary',
      });
      if (confirmed) {
        try {
          await startWorkflow(wfId);
          toast.success(`Workflow "${wfName}" started`);
          await loadExecutions();
        } catch (err) {
          toast.error('Failed to start workflow: ' + (err as Error).message);
        }
      }
    }

    // Pause execution
    const pauseBtn = (e.target as HTMLElement).closest('.exec-pause') as HTMLElement | null;
    if (pauseBtn) {
      const execId = pauseBtn.dataset.execId;
      if (!execId) return;
      try {
        await pauseExecution(execId);
        toast.success('Execution paused');
        await loadExecutions();
      } catch (err) {
        toast.error('Failed to pause: ' + (err as Error).message);
      }
    }

    // Resume execution
    const resumeBtn = (e.target as HTMLElement).closest('.exec-resume') as HTMLElement | null;
    if (resumeBtn) {
      const execId = resumeBtn.dataset.execId;
      if (!execId) return;
      try {
        await resumeExecution(execId);
        toast.success('Execution resumed');
        await loadExecutions();
      } catch (err) {
        toast.error('Failed to resume: ' + (err as Error).message);
      }
    }

    // Cancel execution
    const cancelBtn = (e.target as HTMLElement).closest('.exec-cancel') as HTMLElement | null;
    if (cancelBtn) {
      const execId = cancelBtn.dataset.execId;
      if (!execId) return;
      const confirmed = await confirm({
        title: 'Cancel Execution',
        message: 'Are you sure you want to cancel this execution? This cannot be undone.',
        confirmText: 'Cancel Execution',
        variant: 'danger',
      });
      if (confirmed) {
        try {
          await cancelExecution(execId);
          toast.success('Execution cancelled');
          await loadExecutions();
        } catch (err) {
          toast.error('Failed to cancel: ' + (err as Error).message);
        }
      }
    }
  });

  // No subscriptions needed -- static data
  return () => {};
}
