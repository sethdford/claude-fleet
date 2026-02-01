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

import type { ActivityType } from '@/types';

// ---------------------------------------------------------------------------
// Dayjs plugins
// ---------------------------------------------------------------------------

dayjs.extend(relativeTime);

// ---------------------------------------------------------------------------
// parseClaudeEvent — turns a stream-json event into an activity entry
// ---------------------------------------------------------------------------

interface ParsedEvent {
  title: string;
  preview: string | null;
  activityType: ActivityType;
}

function parseClaudeEvent(output: unknown, handle: string): ParsedEvent {
  const safeHandle = escapeHtml(handle);

  let event = output;
  if (typeof output === 'string') {
    try {
      event = JSON.parse(output);
    } catch {
      return { title: `Output from ${safeHandle}`, preview: (output as string).slice(0, 120), activityType: 'output' };
    }
  }

  if (!event || typeof event !== 'object') {
    return { title: `Output from ${safeHandle}`, preview: String(output).slice(0, 120), activityType: 'output' };
  }

  const rec = event as Record<string, unknown>;
  const type = (rec.type as string) || 'unknown';

  switch (type) {
    case 'assistant': {
      const message = rec.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) break;
      const toolBlock = content.find((b: Record<string, unknown>) => b.type === 'tool_use') as Record<string, unknown> | undefined;
      const textBlock = content.find((b: Record<string, unknown>) => b.type === 'text') as Record<string, unknown> | undefined;
      if (toolBlock) {
        return {
          title: `${safeHandle}: Using tool: ${escapeHtml(toolBlock.name as string)}`,
          preview: toolBlock.input ? JSON.stringify(toolBlock.input).slice(0, 100) : null,
          activityType: 'tool',
        };
      }
      if (textBlock) {
        return {
          title: `${safeHandle}: Claude`,
          preview: (textBlock.text as string).slice(0, 120),
          activityType: 'output',
        };
      }
      break;
    }
    case 'result': {
      const result = rec.result as Record<string, unknown> | undefined;
      const cost = typeof result?.cost_usd === 'number' ? `$${result.cost_usd.toFixed(4)}` : '';
      const duration = typeof result?.duration_ms === 'number' ? `${(result.duration_ms / 1000).toFixed(1)}s` : '';
      const meta = [cost, duration].filter(Boolean).join(', ');
      return { title: `${safeHandle}: Completed`, preview: meta || 'Task finished', activityType: 'result' };
    }
    case 'system':
      return { title: `${safeHandle}: Session`, preview: (rec.subtype as string) || 'connected', activityType: 'system' };
    case 'user': {
      const message = rec.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (Array.isArray(content)) {
        const textBlock = content.find((b: Record<string, unknown>) => b.type === 'text') as Record<string, unknown> | undefined;
        if (textBlock) {
          return { title: `${safeHandle}: Input`, preview: (textBlock.text as string).slice(0, 120), activityType: 'message' };
        }
      }
      break;
    }
    case 'error':
      return {
        title: `${safeHandle}: Error`,
        preview: ((rec.error as string) || JSON.stringify(rec)).slice(0, 120),
        activityType: 'error',
      };
    default:
      break;
  }

  return { title: `Output from ${safeHandle}`, preview: JSON.stringify(rec).slice(0, 100), activityType: 'output' };
}

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
// WebSocket event handlers
// ---------------------------------------------------------------------------

function setupWebSocketHandlers(): void {
  wsManager.on('worker:spawned', (data) => {
    const worker = data as { handle: string; [key: string]: unknown };
    const workers = store.get('workers') ?? [];
    if (!workers.find(w => w.handle === worker.handle)) {
      store.set('workers', [...workers, worker as never]);
    }
    store.addActivity({ type: 'spawn', title: `Worker spawned: ${escapeHtml(worker.handle)}`, handle: worker.handle });
    updateSidebarLists();
  });

  wsManager.on('worker:dismissed', (data) => {
    const { handle } = data as { handle: string };
    store.removeWorker(handle);
    store.addActivity({ type: 'dismiss', title: `Worker dismissed: ${escapeHtml(handle)}`, handle });
    updateSidebarLists();
  });

  wsManager.on('worker:output', (data) => {
    const { handle, output } = data as { handle: string; output: unknown };
    store.appendWorkerOutput(handle, output);
    const parsed = parseClaudeEvent(output, handle);
    store.addActivity({ type: parsed.activityType, title: parsed.title, preview: parsed.preview ?? undefined, handle });
  });

  wsManager.on('authenticated', () => {
    refreshAll();
  });

  wsManager.on('swarm:created', (data) => {
    const swarm = data as { id: string; name: string; description?: string; [key: string]: unknown };
    const swarms = store.get('swarms') ?? [];
    if (!swarms.find(s => s.id === swarm.id)) {
      store.set('swarms', [...swarms, swarm as never]);
    }
    store.addActivity({ type: 'spawn', title: `Swarm created: ${escapeHtml(swarm.name)}`, preview: swarm.description });
    updateSidebarLists();
  });

  wsManager.on('swarm:killed', (data) => {
    const { swarmId, dismissed, deleted } = data as { swarmId: string; dismissed: unknown[]; deleted: boolean };
    if (deleted) {
      const swarms = store.get('swarms') ?? [];
      store.set('swarms', swarms.filter(s => s.id !== swarmId));
    }
    store.addActivity({
      type: 'dismiss',
      title: `Swarm ${deleted ? 'deleted' : 'cleared'}: ${escapeHtml(swarmId)}`,
      preview: `${dismissed.length} agents dismissed`,
    });
    updateSidebarLists();
  });

  wsManager.on('task:assigned', (data) => {
    const rec = data as { task?: { id: string; subject?: string; ownerHandle?: string; [key: string]: unknown } };
    const tasks = store.get('tasks') ?? [];
    if (rec.task && !tasks.find(t => t.id === rec.task!.id)) {
      store.set('tasks', [...tasks, rec.task as never]);
    }
    store.addActivity({
      type: 'message',
      title: `Task assigned: ${escapeHtml(rec.task?.subject ?? 'Unknown')}`,
      preview: rec.task?.ownerHandle ? `Assigned to ${escapeHtml(rec.task.ownerHandle)}` : undefined,
    });
    updateSidebarLists();
  });

  wsManager.on('task:updated', (data) => {
    const { taskId, status, ownerHandle } = data as { taskId: string; status: 'open' | 'in_progress' | 'blocked' | 'resolved'; ownerHandle?: string };
    const tasks = store.get('tasks') ?? [];
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      task.status = status;
      store.set('tasks', [...tasks]);
    }
    store.addActivity({
      type: 'message',
      title: `Task ${escapeHtml(status)}: ${escapeHtml(taskId.slice(0, 8))}`,
      preview: ownerHandle ? `Updated by ${escapeHtml(ownerHandle)}` : undefined,
    });
    updateSidebarLists();
  });

  wsManager.on('blackboard:message', (data) => {
    const { swarmId, message } = data as {
      swarmId: string;
      message: { messageType: string; senderHandle: string; targetHandle?: string; [key: string]: unknown };
    };
    store.addActivity({
      type: 'message',
      title: `Blackboard: ${escapeHtml(message.messageType)}`,
      preview: `${escapeHtml(message.senderHandle)} \u2192 ${escapeHtml(message.targetHandle ?? 'all')} in ${escapeHtml(swarmId)}`,
    });
    const blackboard = store.get('blackboard') ?? {};
    if (!blackboard[swarmId]) blackboard[swarmId] = [];
    blackboard[swarmId] = [message as never, ...blackboard[swarmId]].slice(0, 100);
    store.set('blackboard', blackboard);
  });
}

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------

function showLoginModal(): void {
  document.getElementById('login-modal')?.classList.add('active');
}

function hideLoginModal(): void {
  document.getElementById('login-modal')?.classList.remove('active');
}

function showSpawnModal(): void {
  const swarmSelect = document.getElementById('spawn-swarm') as HTMLSelectElement | null;
  const swarms = store.get('swarms') ?? [];
  if (swarmSelect) {
    swarmSelect.innerHTML =
      '<option value="">None</option>' +
      swarms.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  }
  document.getElementById('spawn-modal')?.classList.add('active');
}

function hideSpawnModal(): void {
  document.getElementById('spawn-modal')?.classList.remove('active');
  (document.getElementById('spawn-form') as HTMLFormElement | null)?.reset();
}

function showSwarmModal(): void {
  document.getElementById('swarm-modal')?.classList.add('active');
}

function hideSwarmModal(): void {
  document.getElementById('swarm-modal')?.classList.remove('active');
  (document.getElementById('swarm-form') as HTMLFormElement | null)?.reset();
}

function showTaskModal(): void {
  const assigneeSelect = document.getElementById('task-assignee') as HTMLSelectElement | null;
  const workers = store.get('workers') ?? [];
  if (assigneeSelect) {
    assigneeSelect.innerHTML =
      '<option value="">Select worker...</option>' +
      workers.map(w => `<option value="${escapeHtml(w.handle)}">${escapeHtml(w.handle)}</option>`).join('');
  }
  document.getElementById('task-modal')?.classList.add('active');
}

function hideTaskModal(): void {
  document.getElementById('task-modal')?.classList.remove('active');
  (document.getElementById('task-form') as HTMLFormElement | null)?.reset();
}

function showConnectModal(): void {
  document.getElementById('connect-command-output')?.classList.add('hidden');
  document.getElementById('connect-modal')?.classList.add('active');
}

function hideConnectModal(): void {
  document.getElementById('connect-modal')?.classList.remove('active');
  (document.getElementById('connect-form') as HTMLFormElement | null)?.reset();
  document.getElementById('connect-command-output')?.classList.add('hidden');
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

async function initializeApp(): Promise<void> {
  updateUserInfo();
  wsManager.connect();

  if (!appInitialized) {
    setupWebSocketHandlers();
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

    // Spawn modal
    document.getElementById('spawn-btn')?.addEventListener('click', showSpawnModal);
    document.getElementById('spawn-modal-close')?.addEventListener('click', hideSpawnModal);
    document.getElementById('spawn-cancel')?.addEventListener('click', hideSpawnModal);
    document.getElementById('spawn-submit')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const handle = (document.getElementById('spawn-handle') as HTMLInputElement).value.trim();
      const prompt = (document.getElementById('spawn-prompt') as HTMLTextAreaElement).value.trim();
      const swarmId = (document.getElementById('spawn-swarm') as HTMLSelectElement).value || undefined;
      const workingDir = (document.getElementById('spawn-workdir') as HTMLInputElement).value.trim() || undefined;

      if (!handle) { toast.warning('Handle is required'); return; }

      const btn = document.getElementById('spawn-submit') as HTMLButtonElement;
      try {
        btn.disabled = true;
        btn.textContent = 'Spawning...';
        await api.spawnWorker(handle, prompt || undefined, { swarmId, workingDir });
        hideSpawnModal();
        toast.success(`Worker "${handle}" spawned successfully`);
        await fetchWorkers();
        store.addActivity({ type: 'spawn', title: `Spawned worker: ${handle}`, handle });
      } catch (err) {
        toast.error('Failed to spawn worker: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Spawn';
      }
    });

    // Swarm modal
    document.getElementById('swarm-modal-close')?.addEventListener('click', hideSwarmModal);
    document.getElementById('swarm-cancel')?.addEventListener('click', hideSwarmModal);
    document.getElementById('swarm-submit')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const name = (document.getElementById('swarm-name') as HTMLInputElement).value.trim();
      const description = (document.getElementById('swarm-description') as HTMLTextAreaElement).value.trim() || undefined;
      const maxAgents = parseInt((document.getElementById('swarm-max-agents') as HTMLInputElement).value, 10) || 10;

      if (!name) { toast.warning('Name is required'); return; }

      const btn = document.getElementById('swarm-submit') as HTMLButtonElement;
      try {
        btn.disabled = true;
        btn.textContent = 'Creating...';
        await api.createSwarm(name, description, maxAgents);
        hideSwarmModal();
        toast.success(`Swarm "${name}" created`);
        await fetchSwarms();
      } catch (err) {
        toast.error('Failed to create swarm: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create';
      }
    });

    // Task modal
    document.getElementById('task-modal-close')?.addEventListener('click', hideTaskModal);
    document.getElementById('task-cancel')?.addEventListener('click', hideTaskModal);
    document.getElementById('task-submit')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const subject = (document.getElementById('task-subject') as HTMLInputElement).value.trim();
      const description = (document.getElementById('task-description') as HTMLTextAreaElement).value.trim() || undefined;
      const toHandle = (document.getElementById('task-assignee') as HTMLSelectElement).value;
      const user = api.getUser();

      if (!subject || !toHandle) { toast.warning('Subject and assignee are required'); return; }

      const btn = document.getElementById('task-submit') as HTMLButtonElement;
      try {
        btn.disabled = true;
        btn.textContent = 'Creating...';
        await api.createTask({
          fromUid: user!.uid,
          toHandle,
          teamName: user!.teamName,
          subject,
          description,
        });
        hideTaskModal();
        toast.success(`Task "${subject}" created`);
        await fetchTasks();
      } catch (err) {
        toast.error('Failed to create task: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create';
      }
    });

    // Connect modal
    document.getElementById('connect-modal-close')?.addEventListener('click', hideConnectModal);
    document.getElementById('connect-cancel')?.addEventListener('click', hideConnectModal);
    document.getElementById('connect-generate')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const handle = (document.getElementById('connect-handle') as HTMLInputElement).value.trim();
      const teamName = (document.getElementById('connect-team') as HTMLInputElement).value.trim() || 'default';
      const workingDir = (document.getElementById('connect-workdir') as HTMLInputElement).value.trim() || undefined;
      const serverOverride = (document.getElementById('connect-server') as HTMLInputElement).value.trim();

      if (!handle) { toast.warning('Agent handle is required'); return; }

      // Validate handle format — must match backend's handleSchema (alphanumeric, hyphens, underscores)
      const HANDLE_PATTERN = /^[a-zA-Z0-9_-]+$/;
      if (!HANDLE_PATTERN.test(handle)) {
        toast.warning('Handle must contain only letters, numbers, hyphens, and underscores');
        return;
      }
      if (handle.length > 50) {
        toast.warning('Handle must be at most 50 characters');
        return;
      }

      // Validate team name with same safe-character constraint
      if (!HANDLE_PATTERN.test(teamName)) {
        toast.warning('Team name must contain only letters, numbers, hyphens, and underscores');
        return;
      }

      const btn = document.getElementById('connect-generate') as HTMLButtonElement;
      try {
        btn.disabled = true;
        btn.textContent = 'Registering...';

        // Pre-register the external worker via team-lead token
        await api.registerExternalWorker({ handle, teamName, workingDir });

        // Build the connection command.
        // handle and teamName are validated as [a-zA-Z0-9_-]+ above,
        // so they are safe for shell interpolation without escaping.
        const serverUrl = serverOverride || window.location.origin;

        const command = `# Step 1: Authenticate
TOKEN=$(curl -s -X POST '${serverUrl}/auth' \\
  -H 'Content-Type: application/json' \\
  -d '{"handle":"${handle}","teamName":"${teamName}","agentType":"worker"}' \\
  | jq -r '.token')

# Step 2: Send heartbeat (run in a loop or from your agent)
curl -s -X POST '${serverUrl}/orchestrate/workers/${encodeURIComponent(handle)}/output' \\
  -H 'Content-Type: application/json' \\
  -d '{"event":{"type":"system","text":"connected"}}'`;

        const pre = document.getElementById('connect-command-pre');
        const output = document.getElementById('connect-command-output');
        if (pre) pre.textContent = command;
        output?.classList.remove('hidden');

        toast.success(`External worker "${handle}" registered`);
        await fetchWorkers();
      } catch (err) {
        toast.error('Failed to register worker: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Command';
      }
    });

    document.getElementById('connect-copy-btn')?.addEventListener('click', () => {
      const pre = document.getElementById('connect-command-pre');
      if (!pre?.textContent) {
        toast.warning('Generate a connection command first');
        return;
      }
      navigator.clipboard.writeText(pre.textContent).then(() => {
        toast.success('Copied to clipboard');
      }).catch((err) => {
        console.error('Clipboard write failed:', err);
        toast.warning('Failed to copy — select and copy manually');
      });
    });

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
    if (api.isAuthenticated()) await fetchMetrics();
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
