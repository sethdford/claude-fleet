/**
 * Scheduler View
 * Shows scheduler status, schedules list, task queue, and templates
 */

import ApiClient from '../api.js';

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Format a date string for display
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return dayjs(dateStr).fromNow();
}

// ============================================================================
// State
// ============================================================================

let schedulerStatus = null;
let schedules = [];
let queue = { queued: [], running: [], counts: { queued: 0, running: 0 } };
let templates = [];
let pollTimer = null;

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchStatus() {
  try {
    schedulerStatus = await ApiClient.request('/scheduler/status');
  } catch {
    schedulerStatus = null;
  }
}

async function fetchSchedules() {
  try {
    schedules = await ApiClient.request('/scheduler/schedules');
    if (!Array.isArray(schedules)) schedules = [];
  } catch {
    schedules = [];
  }
}

async function fetchQueue() {
  try {
    queue = await ApiClient.request('/scheduler/queue');
  } catch {
    queue = { queued: [], running: [], counts: { queued: 0, running: 0 } };
  }
}

async function fetchTemplates() {
  try {
    templates = await ApiClient.request('/scheduler/templates');
    if (!Array.isArray(templates)) templates = [];
  } catch {
    templates = [];
  }
}

async function fetchAll() {
  await Promise.all([fetchStatus(), fetchSchedules(), fetchQueue(), fetchTemplates()]);
}

// ============================================================================
// Actions
// ============================================================================

async function startScheduler() {
  try {
    await ApiClient.request('/scheduler/start', { method: 'POST' });
    await fetchStatus();
    renderContent();
  } catch (err) {
    alert('Failed to start scheduler: ' + err.message);
  }
}

async function stopScheduler() {
  try {
    await ApiClient.request('/scheduler/stop', { method: 'POST' });
    await fetchStatus();
    renderContent();
  } catch (err) {
    alert('Failed to stop scheduler: ' + err.message);
  }
}

async function loadDefaults() {
  try {
    await ApiClient.request('/scheduler/schedules/load-defaults', { method: 'POST' });
    await fetchSchedules();
    renderContent();
  } catch (err) {
    alert('Failed to load defaults: ' + err.message);
  }
}

async function toggleSchedule(id, enable) {
  try {
    const action = enable ? 'enable' : 'disable';
    await ApiClient.request(`/scheduler/schedules/${encodeURIComponent(id)}/${action}`, { method: 'PATCH' });
    await fetchSchedules();
    renderContent();
  } catch (err) {
    alert('Failed to update schedule: ' + err.message);
  }
}

async function deleteSchedule(id) {
  try {
    await ApiClient.request(`/scheduler/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await fetchSchedules();
    renderContent();
  } catch (err) {
    alert('Failed to delete schedule: ' + err.message);
  }
}

async function cancelTask(taskId) {
  try {
    await ApiClient.request(`/scheduler/queue/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    await fetchQueue();
    renderContent();
  } catch (err) {
    alert('Failed to cancel task: ' + err.message);
  }
}

// ============================================================================
// Rendering
// ============================================================================

function renderStatusCard() {
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

function renderSchedulesList() {
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
          <div class="worker-item" style="cursor: default;">
            <span class="status-dot ${isEnabled ? 'healthy' : 'stopped'}"></span>
            <div class="worker-info" style="flex: 1;">
              <div class="worker-handle">${escapeHtml(s.name)}</div>
              <div class="worker-meta">
                <code>${escapeHtml(s.cron)}</code>
                ${s.repository ? ` &bull; ${escapeHtml(s.repository)}` : ''}
                ${s.tasks ? ` &bull; ${s.tasks.length} task${s.tasks.length !== 1 ? 's' : ''}` : ''}
              </div>
            </div>
            <div style="display: flex; gap: 4px; align-items: center;">
              <button class="btn btn-secondary btn-sm schedule-toggle" data-id="${escapeHtml(s.id)}" data-enable="${isEnabled ? 'false' : 'true'}">
                ${isEnabled ? 'Disable' : 'Enable'}
              </button>
              <button class="btn btn-secondary btn-sm schedule-delete" data-id="${escapeHtml(s.id)}" style="color: var(--red);">
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

function renderQueueSection() {
  const allTasks = [...(queue.running || []), ...(queue.queued || [])];

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
          <div class="worker-item" style="cursor: default;">
            <span class="status-dot ${isRunning ? 'healthy' : 'pending'}"></span>
            <div class="worker-info" style="flex: 1;">
              <div class="worker-handle">${escapeHtml(t.name)}</div>
              <div class="worker-meta">
                ${escapeHtml(t.trigger || 'scheduled')}
                ${t.repository ? ` &bull; ${escapeHtml(t.repository)}` : ''}
                ${t.priority ? ` &bull; ${escapeHtml(t.priority)}` : ''}
                ${t.startedAt ? ` &bull; started ${formatDate(t.startedAt)}` : ''}
              </div>
            </div>
            <div style="display: flex; gap: 4px; align-items: center;">
              <span class="badge ${isRunning ? 'green' : ''}">${isRunning ? 'Running' : 'Queued'}</span>
              ${!isRunning ? `
                <button class="btn btn-secondary btn-sm queue-cancel" data-id="${escapeHtml(t.id)}" style="color: var(--red);">
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

function renderTemplatesList() {
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

  const categories = {};
  for (const t of templates) {
    const cat = t.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(t);
  }

  return Object.entries(categories).map(([category, items]) => `
    <div class="mb-md">
      <div class="worker-meta mb-sm" style="text-transform: capitalize; font-weight: 600;">${escapeHtml(category)}</div>
      <div class="worker-list">
        ${items.map(t => `
          <div class="worker-item" style="cursor: default;">
            <div class="worker-info" style="flex: 1;">
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

let container = null;

function renderContent() {
  if (!container) return;

  const isRunning = schedulerStatus?.running || schedulerStatus?.isRunning;

  container.innerHTML = `
    <section class="mb-md">
      <div style="display: flex; justify-content: space-between; align-items: center;" class="mb-md">
        <h2 class="card-subtitle">Scheduler Status</h2>
        <div style="display: flex; gap: 8px;">
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
      <div style="display: flex; justify-content: space-between; align-items: center;" class="mb-md">
        <h2 class="card-subtitle">Schedules</h2>
        <button class="btn btn-secondary btn-sm" id="sched-load-defaults">Load Defaults</button>
      </div>
      <div id="sched-schedules-container">
        ${renderSchedulesList()}
      </div>
    </section>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg);">
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

  attachEventListeners();
}

function attachEventListeners() {
  // Start/Stop scheduler
  document.getElementById('sched-start')?.addEventListener('click', startScheduler);
  document.getElementById('sched-stop')?.addEventListener('click', stopScheduler);

  // Load defaults
  document.getElementById('sched-load-defaults')?.addEventListener('click', loadDefaults);

  // Schedule toggle/delete
  document.querySelectorAll('.schedule-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const enable = btn.dataset.enable === 'true';
      toggleSchedule(id, enable);
    });
  });

  document.querySelectorAll('.schedule-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (confirm(`Delete schedule "${id}"?`)) {
        deleteSchedule(id);
      }
    });
  });

  // Queue cancel
  document.querySelectorAll('.queue-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      cancelTask(btn.dataset.id);
    });
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Render the scheduler view
 */
export async function renderScheduler(containerEl) {
  container = containerEl;

  // Initial loading
  container.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
    </div>
  `;

  await fetchAll();
  renderContent();

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
    container = null;
    schedulerStatus = null;
    schedules = [];
    queue = { queued: [], running: [], counts: { queued: 0, running: 0 } };
    templates = [];
  };
}
