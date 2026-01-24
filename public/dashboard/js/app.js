/**
 * Claude Fleet Dashboard - Main Application
 * Handles routing, initialization, and view management
 */

import ApiClient from './api.js';
import wsManager from './websocket.js';
import store from './store.js';
import { renderOverview } from './views/overview.js';
import { renderWorker } from './views/worker.js';
import { renderSwarm } from './views/swarm.js';
import { renderTasks } from './views/tasks.js';
import { renderGraph } from './views/graph.js';
import { renderMetrics } from './views/metrics.js';

// Extend dayjs with relative time
dayjs.extend(dayjs_plugin_relativeTime);

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// ============================================================================
// Router
// ============================================================================

class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = null;
    this.currentCleanup = null;
  }

  /**
   * Register a route handler
   */
  register(path, handler) {
    this.routes.set(path, handler);
  }

  /**
   * Navigate to a route
   */
  navigate(path) {
    window.location.hash = path;
  }

  /**
   * Handle route change
   */
  async handleRoute() {
    const hash = window.location.hash.slice(1) || '/';
    const [path, ...params] = hash.split('/').filter(Boolean);
    const routePath = '/' + path;

    // Find matching route
    let handler = this.routes.get(routePath);
    let routeParams = params;

    // Check for parameterized routes
    if (!handler) {
      for (const [route, h] of this.routes) {
        const routeParts = route.split('/').filter(Boolean);
        const hashParts = hash.slice(1).split('/').filter(Boolean);

        if (routeParts.length === hashParts.length) {
          let match = true;
          const extractedParams = [];

          for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith(':')) {
              extractedParams.push(hashParts[i]);
            } else if (routeParts[i] !== hashParts[i]) {
              match = false;
              break;
            }
          }

          if (match) {
            handler = h;
            routeParams = extractedParams;
            break;
          }
        }
      }
    }

    // Cleanup previous view
    if (this.currentCleanup) {
      this.currentCleanup();
      this.currentCleanup = null;
    }

    // Default to overview if no route matches
    if (!handler) {
      handler = this.routes.get('/');
    }

    if (handler) {
      store.set('currentView', path || 'overview');
      updateNavigation(hash);
      this.currentCleanup = await handler(...routeParams);
    }
  }

  /**
   * Initialize router
   */
  init() {
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  }
}

const router = new Router();

// ============================================================================
// Navigation
// ============================================================================

function updateNavigation(currentHash) {
  // Update nav items
  document.querySelectorAll('.nav-item[data-route]').forEach(item => {
    const route = item.dataset.route;
    if (currentHash === route || currentHash === '#' + route) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function updateSidebarLists() {
  // Update swarm list
  const swarmList = document.getElementById('swarm-nav-list');
  const swarms = store.get('swarms') || [];

  if (swarms.length === 0) {
    swarmList.innerHTML = '<div class="nav-item text-muted">No swarms active</div>';
  } else {
    swarmList.innerHTML = swarms.map(s => `
      <a href="#/swarm/${encodeURIComponent(s.id)}" class="nav-item" data-route="/swarm/${encodeURIComponent(s.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        ${escapeHtml(s.name)}
        <span class="nav-badge">${s.agents?.length || 0}</span>
      </a>
    `).join('');
  }

  // Update worker list
  const workerList = document.getElementById('worker-nav-list');
  const workers = store.get('workers') || [];

  if (workers.length === 0) {
    workerList.innerHTML = '<div class="nav-item text-muted">No workers active</div>';
  } else {
    workerList.innerHTML = workers.slice(0, 10).map(w => `
      <a href="#/worker/${encodeURIComponent(w.handle)}" class="nav-item" data-route="/worker/${encodeURIComponent(w.handle)}">
        <span class="status-dot ${w.health || 'healthy'}"></span>
        ${escapeHtml(w.handle)}
      </a>
    `).join('');
  }

  // Update task count
  const tasks = store.get('tasks') || [];
  const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
  document.getElementById('task-count').textContent = openTasks.length;
}

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchMetrics() {
  try {
    const metrics = await ApiClient.getMetrics();
    store.set('metrics', metrics);
    store.addMetricsHistory(metrics);
    return metrics;
  } catch (e) {
    console.error('Failed to fetch metrics:', e);
    return null;
  }
}

async function fetchWorkers() {
  try {
    const workers = await ApiClient.getWorkers();
    store.set('workers', workers);
    updateSidebarLists();
    return workers;
  } catch (e) {
    console.error('Failed to fetch workers:', e);
    return [];
  }
}

async function fetchSwarms() {
  try {
    // Server returns array directly, not { swarms: [...] }
    const swarms = await ApiClient.getSwarms();
    store.set('swarms', Array.isArray(swarms) ? swarms : []);
    updateSidebarLists();
    return Array.isArray(swarms) ? swarms : [];
  } catch (e) {
    console.error('Failed to fetch swarms:', e);
    return [];
  }
}

async function fetchTasks() {
  try {
    const user = ApiClient.getUser();
    if (!user?.teamName) return [];
    // Server returns array directly, not { tasks: [...] }
    const tasks = await ApiClient.getTasks(user.teamName);
    store.set('tasks', Array.isArray(tasks) ? tasks : []);
    updateSidebarLists();
    return Array.isArray(tasks) ? tasks : [];
  } catch (e) {
    console.error('Failed to fetch tasks:', e);
    return [];
  }
}

async function refreshAll() {
  await Promise.all([
    fetchMetrics(),
    fetchWorkers(),
    fetchSwarms(),
    fetchTasks(),
  ]);
}

// ============================================================================
// WebSocket Event Handlers
// ============================================================================

function setupWebSocketHandlers() {
  wsManager.on('worker:spawned', (worker) => {
    const workers = store.get('workers') || [];
    if (!workers.find(w => w.handle === worker.handle)) {
      store.set('workers', [...workers, worker]);
    }
    store.addActivity({
      type: 'spawn',
      title: `Worker spawned: ${escapeHtml(worker.handle)}`,
      handle: worker.handle,
    });
    updateSidebarLists();
  });

  wsManager.on('worker:dismissed', ({ handle }) => {
    store.removeWorker(handle);
    store.addActivity({
      type: 'dismiss',
      title: `Worker dismissed: ${escapeHtml(handle)}`,
      handle,
    });
    updateSidebarLists();
  });

  wsManager.on('worker:output', ({ handle, output }) => {
    store.appendWorkerOutput(handle, output);
    store.addActivity({
      type: 'output',
      title: `Output from ${escapeHtml(handle)}`,
      preview: typeof output === 'string' ? output.slice(0, 100) : JSON.stringify(output).slice(0, 100),
      handle,
    });
  });

  wsManager.on('authenticated', () => {
    // Refresh data on reconnect
    refreshAll();
  });
}

// ============================================================================
// Authentication
// ============================================================================

function showLoginModal() {
  document.getElementById('login-modal').classList.add('active');
}

function hideLoginModal() {
  document.getElementById('login-modal').classList.remove('active');
}

function setupLoginForm() {
  const form = document.getElementById('login-form');
  const submitBtn = document.getElementById('login-submit');

  submitBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const handle = document.getElementById('handle').value.trim();
    const team = document.getElementById('team').value.trim();
    const agentType = document.getElementById('agent-type').value;

    if (!handle || !team) {
      alert('Please fill in all fields');
      return;
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';

      await ApiClient.login(handle, team, agentType);
      hideLoginModal();
      initializeApp();
    } catch (e) {
      alert('Login failed: ' + e.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Login';
    }
  });
}

function updateUserInfo() {
  const user = ApiClient.getUser();
  const userInfo = document.getElementById('user-info');
  const userHandle = document.getElementById('user-handle');

  if (user) {
    userInfo.classList.remove('hidden');
    userHandle.textContent = `${user.handle} @ ${user.teamName}`;
  } else {
    userInfo.classList.add('hidden');
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

// Register routes
router.register('/', async () => {
  document.getElementById('page-title').textContent = 'Fleet Overview';
  return renderOverview(document.getElementById('main-view'));
});

router.register('/metrics', async () => {
  document.getElementById('page-title').textContent = 'Metrics Dashboard';
  return renderMetrics(document.getElementById('main-view'));
});

router.register('/graph', async () => {
  document.getElementById('page-title').textContent = 'Dependency Graph';
  return renderGraph(document.getElementById('main-view'));
});

router.register('/tasks', async () => {
  document.getElementById('page-title').textContent = 'Task Pipeline';
  return renderTasks(document.getElementById('main-view'));
});

router.register('/worker/:handle', async (handle) => {
  // Handle comes from URL, needs to be decoded for display
  const decodedHandle = decodeURIComponent(handle);
  document.getElementById('page-title').textContent = `Worker: ${decodedHandle}`;
  return renderWorker(document.getElementById('main-view'), decodedHandle);
});

router.register('/swarm/:id', async (id) => {
  // ID comes from URL, needs to be decoded
  const decodedId = decodeURIComponent(id);
  document.getElementById('page-title').textContent = 'Swarm Details';
  return renderSwarm(document.getElementById('main-view'), decodedId);
});

// ============================================================================
// Initialization
// ============================================================================

let appInitialized = false;
let pollInterval = null;

async function initializeApp() {
  updateUserInfo();

  // Connect WebSocket
  wsManager.connect();

  // Only setup handlers once
  if (!appInitialized) {
    setupWebSocketHandlers();

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
      refreshAll();
      router.handleRoute();
    });

    // Handle logout events
    window.addEventListener('auth:logout', () => {
      wsManager.disconnect();
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      showLoginModal();
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      wsManager.disconnect();
    });

    // Initialize router once
    router.init();
    appInitialized = true;
  }

  // Clear any existing poll interval
  if (pollInterval) {
    clearInterval(pollInterval);
  }

  // Start polling for metrics
  pollInterval = setInterval(async () => {
    if (ApiClient.isAuthenticated()) {
      await fetchMetrics();
    }
  }, 5000);

  // Initial data fetch
  await refreshAll();

  // Re-trigger current route
  if (appInitialized) {
    router.handleRoute();
  }
}

// ============================================================================
// Bootstrap
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  setupLoginForm();

  if (ApiClient.isAuthenticated()) {
    hideLoginModal();
    initializeApp();
  } else {
    showLoginModal();
  }
});

// Export for debugging
window.fleetDashboard = {
  store,
  wsManager,
  ApiClient,
  router,
  refreshAll,
};
