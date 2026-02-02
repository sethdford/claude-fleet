/**
 * Scheduler Render Functions
 * Pure HTML-template functions for scheduler status, schedules, queue, and templates.
 * Extracted from scheduler.ts to keep files under 500 lines.
 */

import { escapeHtml } from '@/utils/escape-html';
import { formatTime } from '@/utils/format';
import type { SchedulerStatus, Schedule, QueueTask, TaskTemplate } from '@/types';

interface QueueState {
  queued: QueueTask[];
  running: QueueTask[];
  counts: { queued: number; running: number };
}

export function renderStatusCard(
  schedulerStatus: SchedulerStatus | null,
  scheduleCount: number,
  queue: QueueState,
  templateCount: number,
): string {
  if (!schedulerStatus) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
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
        <div class="metric-value">${scheduleCount}</div>
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
        <div class="metric-value">${templateCount}</div>
      </div>
    </div>
  `;
}

export function renderSchedulesList(schedules: Schedule[]): string {
  if (schedules.length === 0) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
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
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function renderQueueSection(queue: QueueState): string {
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
                <button class="btn btn-secondary btn-sm queue-cancel text-red" data-id="${escapeHtml(t.id)}">Cancel</button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function renderTemplatesList(templates: TaskTemplate[]): string {
  if (templates.length === 0) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
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
            <button class="btn btn-primary btn-sm run-template" data-template-id="${escapeHtml(t.id)}">Run</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}
