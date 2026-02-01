/**
 * Task Pipeline View
 * Kanban-style task management with columns for each status
 */

import dayjs from 'dayjs';
import store from '@/store';
import { getTask, updateTask, getTasks, getUser } from '@/api';
import toast from '@/components/toast';
import { escapeHtml, escapeAttr } from '@/utils/escape-html';

interface TaskData {
  id: string;
  status: string;
  subject: string;
  description?: string;
  ownerHandle?: string;
  createdByHandle?: string;
  createdAt?: string;
  updatedAt?: string;
  blockedBy?: string[];
}

interface StatusConfigEntry {
  label: string;
  color: string;
  icon: string;
}

const STATUS_CONFIG: Record<string, StatusConfigEntry> = {
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
function renderTaskCard(task: TaskData): string {
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
        ${task.blockedBy && task.blockedBy.length > 0 ? `
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
function renderColumn(status: string, tasks: TaskData[]): string {
  const config = STATUS_CONFIG[status];
  const statusTasks = tasks.filter((t: TaskData) => t.status === status);

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
 * Setup drag and drop
 */
function setupDragAndDrop(): void {
  const cards = document.querySelectorAll('.task-card');
  const columns = document.querySelectorAll('.kanban-column-body');

  cards.forEach((card) => {
    card.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      const el = card as HTMLElement;
      dragEvent.dataTransfer!.setData('text/plain', el.dataset.taskId || '');
      el.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      (card as HTMLElement).classList.remove('dragging');
    });
  });

  columns.forEach((column) => {
    column.addEventListener('dragover', (e: Event) => {
      e.preventDefault();
      (column as HTMLElement).classList.add('drag-over');
    });

    column.addEventListener('dragleave', () => {
      (column as HTMLElement).classList.remove('drag-over');
    });

    column.addEventListener('drop', async (e: Event) => {
      e.preventDefault();
      const el = column as HTMLElement;
      el.classList.remove('drag-over');

      const dragEvent = e as DragEvent;
      const taskId = dragEvent.dataTransfer!.getData('text/plain');
      const newStatus = el.dataset.status;

      try {
        await updateTask(taskId, newStatus!);
        toast.success(`Task moved to ${newStatus!.replace('_', ' ')}`);
        // Refresh tasks
        const user = getUser();
        if (user?.teamName) {
          // Server returns array directly, not { tasks: [...] }
          const tasks = await getTasks(user.teamName);
          store.set('tasks', Array.isArray(tasks) ? tasks : []);
        }
      } catch (error) {
        toast.error('Failed to update task: ' + (error as Error).message);
      }
    });
  });
}

/**
 * Render task detail modal
 */
function renderTaskDetail(task: TaskData): string {
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.open;

  return `
    <div class="modal-overlay active" id="task-modal">
      <div class="modal max-w-[600px]">
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
              <p class="text-fg whitespace-pre-wrap">${escapeHtml(task.description)}</p>
            </div>
          ` : ''}

          <div class="grid grid-cols-2 gap-md">
            <div>
              <div class="form-label">Owner</div>
              <div class="text-fg">${escapeHtml(task.ownerHandle) || 'Unassigned'}</div>
            </div>
            <div>
              <div class="form-label">Created By</div>
              <div class="text-fg">${escapeHtml(task.createdByHandle)}</div>
            </div>
            <div>
              <div class="form-label">Created</div>
              <div class="text-fg">${task.createdAt ? dayjs(task.createdAt).format('MMM D, YYYY h:mm A') : 'Unknown'}</div>
            </div>
            <div>
              <div class="form-label">Updated</div>
              <div class="text-fg">${task.updatedAt ? dayjs(task.updatedAt).format('MMM D, YYYY h:mm A') : 'Unknown'}</div>
            </div>
          </div>

          ${task.blockedBy && task.blockedBy.length > 0 ? `
            <div class="mt-md">
              <div class="form-label">Blocked By</div>
              <div class="flex gap-sm flex-wrap">
                ${task.blockedBy.map((id: string) => `
                  <span class="badge red">${escapeHtml(id.slice(0, 8))}</span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <div class="mt-md">
            <div class="form-label">Update Status</div>
            <div class="flex gap-sm">
              ${Object.keys(STATUS_CONFIG).map((status: string) => `
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
export async function renderTasks(container: HTMLElement): Promise<() => void> {
  // Show loading state
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const tasks = (store.get('tasks') as TaskData[] | undefined) || [];

  container.innerHTML = `
    <div class="flex justify-end mb-md">
      <button class="btn btn-primary btn-sm" id="create-task-btn">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Create Task
      </button>
    </div>
    <div class="kanban-board" id="kanban-board">
      ${['open', 'in_progress', 'blocked', 'resolved'].map((status: string) => renderColumn(status, tasks)).join('')}
    </div>
  `;

  setupDragAndDrop();

  // Handle task card clicks and create button
  container.addEventListener('click', async (e: Event) => {
    const target = e.target as HTMLElement;

    // Create task button
    if (target.closest('#create-task-btn')) {
      window.fleetDashboard?.showTaskModal();
      return;
    }

    const card = target.closest('.task-card') as HTMLElement | null;
    if (card) {
      const taskId = card.dataset.taskId;
      try {
        const task = await getTask(taskId!) as TaskData;
        showTaskModal(task);
      } catch (error) {
        console.error('Failed to fetch task:', error);
      }
    }
  });

  // Show task modal
  function showTaskModal(task: TaskData): void {
    const modalHtml = renderTaskDetail(task);
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHtml;
    document.body.appendChild(modalContainer);

    // Close modal
    document.getElementById('close-task-modal')!.addEventListener('click', () => {
      modalContainer.remove();
    });

    document.getElementById('task-modal')!.addEventListener('click', (e: Event) => {
      if ((e.target as HTMLElement).id === 'task-modal') {
        modalContainer.remove();
      }
    });

    // Status update buttons
    document.querySelectorAll('[data-new-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newStatus = (btn as HTMLElement).dataset.newStatus;
        try {
          await updateTask(task.id, newStatus!);
          modalContainer.remove();
          // Refresh tasks
          const user = getUser();
          if (user?.teamName) {
            // Server returns array directly, not { tasks: [...] }
            const refreshedTasks = await getTasks(user.teamName);
            store.set('tasks', Array.isArray(refreshedTasks) ? refreshedTasks : []);
          }
        } catch (error) {
          toast.error('Failed to update task: ' + (error as Error).message);
        }
      });
    });
  }

  // Subscribe to task updates
  const unsubTasks = store.subscribe('tasks', (updatedTasks: unknown) => {
    const board = document.getElementById('kanban-board');
    if (board) {
      board.innerHTML = ['open', 'in_progress', 'blocked', 'resolved'].map((status: string) => renderColumn(status, updatedTasks as TaskData[])).join('');
      setupDragAndDrop();
    }
  });

  // Return cleanup function
  return () => {
    unsubTasks();
  };
}
