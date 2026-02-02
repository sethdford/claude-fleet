/**
 * Claude Fleet Dashboard — Main Entry Point
 * Initializes the application, registers routes, and wires up event handlers.
 */

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import './styles/main.css';

import store from '@/store';
import wsManager from '@/websocket';
import router from '@/router';
import toast from '@/components/toast';
import commandPalette, { initCommandPalette } from '@/components/command-palette';
import { escapeHtml } from '@/utils/escape-html';
import * as api from '@/api';
import { setupWebSocketHandlers } from '@/ws-handlers';
import {
  showLoginModal,
  hideLoginModal,
  showSpawnModal,
  showSwarmModal,
  showTaskModal,
  showConnectModal,
  setupModalHandlers,
} from '@/modals';

import { renderOverview } from '@/views/overview';
import { renderWorker } from '@/views/worker';
import { renderSwarm } from '@/views/swarm';
import { renderTasks } from '@/views/tasks';
import { renderGraph } from '@/views/graph';
import { renderMetrics } from '@/views/metrics';
import { renderScheduler } from '@/views/scheduler';
import { renderMail } from '@/views/mail';
import { renderWorkflows } from '@/views/workflows';
import { renderHive } from '@/views/hive';
import { renderConnections } from '@/views/connections';
import { renderMemory } from '@/views/memory';
import { renderWorkflowDetail } from '@/views/workflow-detail';
import { renderOperations } from '@/views/operations';
import { renderAudit } from '@/views/audit';
import { renderSearch } from '@/views/search';
import { renderTemplates } from '@/views/templates';

dayjs.extend(relativeTime);

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

function updateNavigation(currentHash: string): void {
  document.querySelectorAll<HTMLElement>('.nav-item[data-route]').forEach(item => {
    const route = item.dataset.route ?? '';
    if (currentHash === route || currentHash === '#' + route) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function updateSidebarLists(): void {
  const swarmList = document.getElementById('swarm-nav-list');
  const swarms = store.get('swarms') ?? [];

  if (swarmList) {
    if (swarms.length === 0) {
      swarmList.innerHTML = '<div class="nav-item text-fg-muted">No swarms active</div>';
    } else {
      swarmList.innerHTML = swarms.map(s => `
        <a href="#/swarm/${encodeURIComponent(s.id)}" class="nav-item" data-route="/swarm/${encodeURIComponent(s.id)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          ${escapeHtml(s.name)}
          <span class="nav-badge">${s.agents?.length ?? 0}</span>
        </a>
      `).join('');
    }
  }

  const workerList = document.getElementById('worker-nav-list');
  const workers = store.get('workers') ?? [];

  if (workerList) {
    if (workers.length === 0) {
      workerList.innerHTML = '<div class="nav-item text-fg-muted">No workers active</div>';
    } else {
      workerList.innerHTML = workers.slice(0, 10).map(w => `
        <a href="#/worker/${encodeURIComponent(w.handle)}" class="nav-item" data-route="/worker/${encodeURIComponent(w.handle)}">
          <span class="status-dot ${w.health ?? 'healthy'}"></span>
          ${escapeHtml(w.handle)}
        </a>
      `).join('');
    }
  }

  const tasks = store.get('tasks') ?? [];
  const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
  const taskCountEl = document.getElementById('task-count');
  if (taskCountEl) taskCountEl.textContent = String(openTasks.length);
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchMetrics(): Promise<void> {
  try {
    const metrics = await api.getMetrics();
    store.set('metrics', metrics);
    store.addMetricsHistory(metrics);
  } catch (e) {
    console.error('Failed to fetch metrics:', e);
  }
}

async function fetchWorkers(): Promise<void> {
  try {
    const workers = await api.getWorkers();
    store.set('workers', workers);
    updateSidebarLists();
  } catch (e) {
    console.error('Failed to fetch workers:', e);
  }
}

async function fetchSwarms(): Promise<void> {
  try {
    const swarms = await api.getSwarms();
    store.set('swarms', Array.isArray(swarms) ? swarms : []);
    updateSidebarLists();
  } catch (e) {
    console.error('Failed to fetch swarms:', e);
  }
}

async function fetchTasks(): Promise<void> {
  try {
    const user = api.getUser();
    if (!user?.teamName) return;
    const tasks = await api.getTasks(user.teamName);
    store.set('tasks', Array.isArray(tasks) ? tasks : []);
    updateSidebarLists();
  } catch (e) {
    console.error('Failed to fetch tasks:', e);
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([fetchMetrics(), fetchWorkers(), fetchSwarms(), fetchTasks()]);
}


// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

router.setOnNavigate(updateNavigation);

router.register('/', async () => {
  el('page-title').textContent = 'Fleet Overview';
  return renderOverview(el('main-view'));
});

router.register('/metrics', async () => {
  el('page-title').textContent = 'Metrics Dashboard';
  return renderMetrics(el('main-view'));
});

router.register('/graph', async () => {
  el('page-title').textContent = 'Dependency Graph';
  return renderGraph(el('main-view'));
});

router.register('/tasks', async () => {
  el('page-title').textContent = 'Task Pipeline';
  return renderTasks(el('main-view'));
});

router.register('/scheduler', async () => {
  el('page-title').textContent = 'Scheduler';
  return renderScheduler(el('main-view'));
});

router.register('/mail', async () => {
  el('page-title').textContent = 'Mail';
  return renderMail(el('main-view'));
});

router.register('/workflows', async () => {
  el('page-title').textContent = 'Workflows';
  return renderWorkflows(el('main-view'));
});

router.register('/hive', async () => {
  el('page-title').textContent = 'Hex Hive';
  return renderHive(el('main-view'));
});

router.register('/connections', async () => {
  el('page-title').textContent = 'Connections';
  return renderConnections(el('main-view'));
});

router.register('/memory', async () => {
  el('page-title').textContent = 'Memory & Routing';
  return renderMemory(el('main-view'));
});

router.register('/workflow/:id', async (id: string) => {
  const decoded = decodeURIComponent(id);
  el('page-title').textContent = 'Workflow Details';
  return renderWorkflowDetail(el('main-view'), decoded);
});

router.register('/operations', async () => {
  el('page-title').textContent = 'Operations';
  return renderOperations(el('main-view'));
});

router.register('/audit', async () => {
  el('page-title').textContent = 'Audit';
  return renderAudit(el('main-view'));
});

router.register('/search', async () => {
  el('page-title').textContent = 'Search & Analysis';
  return renderSearch(el('main-view'));
});

router.register('/templates', async () => {
  el('page-title').textContent = 'Templates';
  return renderTemplates(el('main-view'));
});

router.register('/worker/:handle', async (handle: string) => {
  const decoded = decodeURIComponent(handle);
  el('page-title').textContent = `Worker: ${decoded}`;
  return renderWorker(el('main-view'), decoded);
});

router.register('/swarm/:id', async (id: string) => {
  const decoded = decodeURIComponent(id);
  el('page-title').textContent = 'Swarm Details';
  return renderSwarm(el('main-view'), decoded);
});

// ---------------------------------------------------------------------------
// Login form setup
// ---------------------------------------------------------------------------

function setupLoginForm(): void {
  const submitBtn = document.getElementById('login-submit') as HTMLButtonElement | null;

  submitBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const handle = (document.getElementById('handle') as HTMLInputElement).value.trim();
    const team = (document.getElementById('team') as HTMLInputElement).value.trim();
    const agentType = (document.getElementById('agent-type') as HTMLSelectElement).value;

    if (!handle || !team) {
      toast.warning('Please fill in all fields');
      return;
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';
      await api.login(handle, team, agentType);
      hideLoginModal();
      initializeApp();
    } catch (err) {
      toast.error('Login failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Login';
    }
  });
}

function updateUserInfo(): void {
  const user = api.getUser();
  const userInfo = document.getElementById('user-info');
  const userHandle = document.getElementById('user-handle');

  if (user) {
    userInfo?.classList.remove('hidden');
    if (userHandle) userHandle.textContent = `${user.handle} @ ${user.teamName}`;
  } else {
    userInfo?.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let appInitialized = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let isPollRunning = false;

async function initializeApp(): Promise<void> {
  updateUserInfo();
  wsManager.connect();

  if (!appInitialized) {
    setupWebSocketHandlers(updateSidebarLists, refreshAll);
    initCommandPalette();

    document.getElementById('cmd-palette-btn')?.addEventListener('click', () => commandPalette.open());

    document.getElementById('refresh-btn')?.addEventListener('click', () => {
      refreshAll();
      router.handleRoute();
    });

    document.getElementById('logout-btn')?.addEventListener('click', () => {
      api.logout();
      wsManager.disconnect();
      store.clear();
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      showLoginModal();
      updateUserInfo();
    });

    setupModalHandlers({ fetchWorkers, fetchSwarms, fetchTasks });

    // Global events
    window.addEventListener('auth:logout', () => {
      wsManager.disconnect();
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      showLoginModal();
    });

    window.addEventListener('beforeunload', () => {
      if (pollInterval) clearInterval(pollInterval);
      wsManager.disconnect();
    });

    router.init();
    appInitialized = true;
  }

  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    if (isPollRunning || !api.isAuthenticated()) return;
    isPollRunning = true;
    try {
      await fetchMetrics();
    } finally {
      isPollRunning = false;
    }
  }, 5000);

  await refreshAll();
  if (appInitialized) router.handleRoute();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  setupLoginForm();

  if (api.isAuthenticated()) {
    hideLoginModal();
    initializeApp();
  } else {
    try {
      await api.login('dashboard-viewer', 'compound-team', 'team-lead');
      hideLoginModal();
      initializeApp();
    } catch {
      showLoginModal();
    }
  }
});

// ---------------------------------------------------------------------------
// Global export for views that reference window.fleetDashboard
// ---------------------------------------------------------------------------

interface FleetDashboard {
  store: typeof store;
  wsManager: typeof wsManager;
  router: typeof router;
  refreshAll: typeof refreshAll;
  showSpawnModal: typeof showSpawnModal;
  showSwarmModal: typeof showSwarmModal;
  showTaskModal: typeof showTaskModal;
  showConnectModal: typeof showConnectModal;
}

declare global {
  interface Window {
    fleetDashboard?: FleetDashboard;
  }
}

window.fleetDashboard = {
  store,
  wsManager,
  router,
  refreshAll,
  showSpawnModal,
  showSwarmModal,
  showTaskModal,
  showConnectModal,
};
