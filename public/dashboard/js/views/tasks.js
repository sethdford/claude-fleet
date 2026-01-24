/**
 * Task Pipeline View
 * Kanban-style task management with columns for each status
 */

import store from '../store.js';
import ApiClient from '../api.js';

const STATUS_CONFIG = {
  open: {
    label: 'Open',
    color: 'blue',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
  },
  in_progress: {
    label: 'In Progress',
    color: 'yellow',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  },
  blocked: {
    label: 'Blocked',
    color: 'red',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>',
  },
  resolved: {
    label: 'Resolved',
    color: 'green',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>',
  },
};

/**
 * Render a task card
 */
function renderTaskCard(task) {
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.open;

  return `
    <div class="task-card" data-task-id="${escapeAttr(task.id)}" draggable="true">
      <div class="task-card-header">
        <span class="badge ${config.color}">${config.label}</span>
        ${task.ownerHandle ? `
          <span class="task-owner">
            <span class="status-dot healthy"></span>
            ${escapeHtml(task.ownerHandle)}
          </span>
        ` : ''}
      </div>
      <h4 class="task-subject">${escapeHtml(task.subject)}</h4>
      ${task.description ? `
        <p class="task-description">${escapeHtml(task.description.slice(0, 100))}${task.description.length > 100 ? '...' : ''}</p>
      ` : ''}
      <div class="task-card-footer">
        <span class="task-time">${task.createdAt ? dayjs(task.createdAt).fromNow() : ''}</span>
        ${task.blockedBy?.length > 0 ? `
          <span class="task-blocked-by">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
            </svg>
            ${task.blockedBy.length}
          </span>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Render a kanban column
 */
function renderColumn(status, tasks) {
  const config = STATUS_CONFIG[status];
  const statusTasks = tasks.filter(t => t.status === status);

  return `
    <div class="kanban-column" data-status="${status}">
      <div class="kanban-column-header">
        <div class="flex items-center gap-sm">
          ${config.icon}
          <span>${config.label}</span>
        </div>
        <span class="badge">${statusTasks.length}</span>
      </div>
      <div class="kanban-column-body" data-status="${status}">
        ${statusTasks.length === 0 ? `
          <div class="kanban-empty">No tasks</div>
        ` : statusTasks.map(renderTaskCard).join('')}
      </div>
    </div>
  `;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Escape for use in HTML attributes
 */
function escapeAttr(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Setup drag and drop
 */
function setupDragAndDrop() {
  const cards = document.querySelectorAll('.task-card');
  const columns = document.querySelectorAll('.kanban-column-body');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  columns.forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('drag-over');
    });

    column.addEventListener('dragleave', () => {
      column.classList.remove('drag-over');
    });

    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('drag-over');

      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = column.dataset.status;

      try {
        await ApiClient.updateTask(taskId, newStatus);
        // Refresh tasks
        const user = ApiClient.getUser();
        if (user?.teamName) {
          // Server returns array directly, not { tasks: [...] }
          const tasks = await ApiClient.getTasks(user.teamName);
          store.set('tasks', Array.isArray(tasks) ? tasks : []);
        }
      } catch (error) {
        alert('Failed to update task: ' + error.message);
      }
    });
  });
}

/**
 * Render task detail modal
 */
function renderTaskDetail(task) {
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.open;

  return `
    <div class="modal-overlay active" id="task-modal">
      <div class="modal" style="max-width: 600px;">
        <div class="modal-header">
          <div>
            <span class="badge ${config.color}">${config.label}</span>
            <h2 class="modal-title mt-md">${escapeHtml(task.subject)}</h2>
          </div>
        </div>
        <div class="modal-body">
          ${task.description ? `
            <div class="mb-md">
              <div class="form-label">Description</div>
              <p style="color: var(--text-primary); white-space: pre-wrap;">${escapeHtml(task.description)}</p>
            </div>
          ` : ''}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md);">
            <div>
              <div class="form-label">Owner</div>
              <div style="color: var(--text-primary);">${escapeHtml(task.ownerHandle) || 'Unassigned'}</div>
            </div>
            <div>
              <div class="form-label">Created By</div>
              <div style="color: var(--text-primary);">${escapeHtml(task.createdByHandle)}</div>
            </div>
            <div>
              <div class="form-label">Created</div>
              <div style="color: var(--text-primary);">${task.createdAt ? dayjs(task.createdAt).format('MMM D, YYYY h:mm A') : 'Unknown'}</div>
            </div>
            <div>
              <div class="form-label">Updated</div>
              <div style="color: var(--text-primary);">${task.updatedAt ? dayjs(task.updatedAt).format('MMM D, YYYY h:mm A') : 'Unknown'}</div>
            </div>
          </div>

          ${task.blockedBy?.length > 0 ? `
            <div class="mt-md">
              <div class="form-label">Blocked By</div>
              <div class="flex gap-sm" style="flex-wrap: wrap;">
                ${task.blockedBy.map(id => `
                  <span class="badge red">${escapeHtml(id.slice(0, 8))}</span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <div class="mt-md">
            <div class="form-label">Update Status</div>
            <div class="flex gap-sm">
              ${Object.keys(STATUS_CONFIG).map(status => `
                <button class="btn btn-sm ${task.status === status ? 'btn-primary' : 'btn-secondary'}" data-new-status="${status}">
                  ${STATUS_CONFIG[status].label}
                </button>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="close-task-modal">Close</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render the tasks view
 */
export async function renderTasks(container) {
  const tasks = store.get('tasks') || [];

  container.innerHTML = `
    <style>
      .kanban-board {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-md);
        height: calc(100vh - 200px);
        overflow-x: auto;
      }

      .kanban-column {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        display: flex;
        flex-direction: column;
        min-width: 280px;
      }

      .kanban-column-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-md);
        border-bottom: 1px solid var(--border-default);
        font-weight: 600;
      }

      .kanban-column-body {
        flex: 1;
        padding: var(--space-sm);
        overflow-y: auto;
      }

      .kanban-column-body.drag-over {
        background: rgba(88, 166, 255, 0.1);
      }

      .kanban-empty {
        color: var(--text-muted);
        text-align: center;
        padding: var(--space-lg);
        font-size: 14px;
      }

      .task-card {
        background: var(--bg-tertiary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        padding: var(--space-md);
        margin-bottom: var(--space-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .task-card:hover {
        border-color: var(--accent-blue);
        transform: translateY(-1px);
      }

      .task-card.dragging {
        opacity: 0.5;
      }

      .task-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-sm);
      }

      .task-subject {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        margin: 0 0 var(--space-xs) 0;
      }

      .task-description {
        font-size: 12px;
        color: var(--text-secondary);
        margin: 0;
        line-height: 1.4;
      }

      .task-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: var(--space-sm);
        font-size: 11px;
        color: var(--text-muted);
      }

      .task-owner {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--text-secondary);
      }

      .task-blocked-by {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--accent-red);
      }
    </style>

    <div class="kanban-board" id="kanban-board">
      ${['open', 'in_progress', 'blocked', 'resolved'].map(status => renderColumn(status, tasks)).join('')}
    </div>
  `;

  setupDragAndDrop();

  // Handle task card clicks
  container.addEventListener('click', async (e) => {
    const card = e.target.closest('.task-card');
    if (card) {
      const taskId = card.dataset.taskId;
      try {
        const task = await ApiClient.getTask(taskId);
        showTaskModal(task);
      } catch (error) {
        console.error('Failed to fetch task:', error);
      }
    }
  });

  // Show task modal
  function showTaskModal(task) {
    const modalHtml = renderTaskDetail(task);
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHtml;
    document.body.appendChild(modalContainer);

    // Close modal
    document.getElementById('close-task-modal').addEventListener('click', () => {
      modalContainer.remove();
    });

    document.getElementById('task-modal').addEventListener('click', (e) => {
      if (e.target.id === 'task-modal') {
        modalContainer.remove();
      }
    });

    // Status update buttons
    document.querySelectorAll('[data-new-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.dataset.newStatus;
        try {
          await ApiClient.updateTask(task.id, newStatus);
          modalContainer.remove();
          // Refresh tasks
          const user = ApiClient.getUser();
          if (user?.teamName) {
            // Server returns array directly, not { tasks: [...] }
            const tasks = await ApiClient.getTasks(user.teamName);
            store.set('tasks', Array.isArray(tasks) ? tasks : []);
          }
        } catch (error) {
          alert('Failed to update task: ' + error.message);
        }
      });
    });
  }

  // Subscribe to task updates
  const unsubTasks = store.subscribe('tasks', (tasks) => {
    const board = document.getElementById('kanban-board');
    if (board) {
      board.innerHTML = ['open', 'in_progress', 'blocked', 'resolved'].map(status => renderColumn(status, tasks)).join('');
      setupDragAndDrop();
    }
  });

  // Return cleanup function
  return () => {
    unsubTasks();
  };
}
