/**
 * Modal Handlers
 * Show/hide/submit logic for Spawn, Swarm, Task, and Connect modals.
 * Extracted from main.ts to keep files under 500 lines.
 */

import store from '@/store';
import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import * as api from '@/api';
import type { WorkerInfo, SwarmInfo } from '@/types';

// ---------------------------------------------------------------------------
// Form lock helpers — disable all inputs during async submission
// ---------------------------------------------------------------------------

function setFormLocked(formId: string, locked: boolean): void {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  if (!form) return;
  const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(
    'input, textarea, select, button',
  );
  fields.forEach(field => { field.disabled = locked; });
}

// ---------------------------------------------------------------------------
// Show / Hide helpers
// ---------------------------------------------------------------------------

export function showLoginModal(): void {
  document.getElementById('login-modal')?.classList.add('active');
}

export function hideLoginModal(): void {
  document.getElementById('login-modal')?.classList.remove('active');
}

export function showSpawnModal(): void {
  const swarmSelect = document.getElementById('spawn-swarm') as HTMLSelectElement | null;
  const swarms: SwarmInfo[] = store.get('swarms') ?? [];
  if (swarmSelect) {
    swarmSelect.innerHTML =
      '<option value="">None</option>' +
      swarms.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  }
  document.getElementById('spawn-modal')?.classList.add('active');
}

export function hideSpawnModal(): void {
  document.getElementById('spawn-modal')?.classList.remove('active');
  (document.getElementById('spawn-form') as HTMLFormElement | null)?.reset();
}

export function showSwarmModal(): void {
  document.getElementById('swarm-modal')?.classList.add('active');
}

export function hideSwarmModal(): void {
  document.getElementById('swarm-modal')?.classList.remove('active');
  (document.getElementById('swarm-form') as HTMLFormElement | null)?.reset();
}

export function showTaskModal(): void {
  const assigneeSelect = document.getElementById('task-assignee') as HTMLSelectElement | null;
  const workers: WorkerInfo[] = store.get('workers') ?? [];
  if (assigneeSelect) {
    assigneeSelect.innerHTML =
      '<option value="">Select worker...</option>' +
      workers.map(w => `<option value="${escapeHtml(w.handle)}">${escapeHtml(w.handle)}</option>`).join('');
  }
  document.getElementById('task-modal')?.classList.add('active');
}

export function hideTaskModal(): void {
  document.getElementById('task-modal')?.classList.remove('active');
  (document.getElementById('task-form') as HTMLFormElement | null)?.reset();
}

export function showConnectModal(): void {
  document.getElementById('connect-command-output')?.classList.add('hidden');
  document.getElementById('connect-modal')?.classList.add('active');
}

export function hideConnectModal(): void {
  document.getElementById('connect-modal')?.classList.remove('active');
  (document.getElementById('connect-form') as HTMLFormElement | null)?.reset();
  document.getElementById('connect-command-output')?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Modal submit wiring — call once during app initialization
// ---------------------------------------------------------------------------

export function setupModalHandlers(deps: {
  fetchWorkers: () => Promise<void>;
  fetchSwarms: () => Promise<void>;
  fetchTasks: () => Promise<void>;
}): void {
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
      setFormLocked('spawn-form', true);
      btn.textContent = 'Spawning...';
      await api.spawnWorker(handle, prompt || undefined, { swarmId, workingDir });
      hideSpawnModal();
      toast.success(`Worker "${handle}" spawned successfully`);
      await deps.fetchWorkers();
      store.addActivity({ type: 'spawn', title: `Spawned worker: ${handle}`, handle });
    } catch (err) {
      toast.error('Failed to spawn worker: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFormLocked('spawn-form', false);
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
    const maxAgentsRaw = (document.getElementById('swarm-max-agents') as HTMLInputElement).value;
    const maxAgents = parseInt(maxAgentsRaw, 10);

    if (!name) { toast.warning('Name is required'); return; }
    if (maxAgentsRaw && (isNaN(maxAgents) || maxAgents < 1 || maxAgents > 1000)) {
      toast.warning('Max agents must be a number between 1 and 1000');
      return;
    }

    const btn = document.getElementById('swarm-submit') as HTMLButtonElement;
    try {
      setFormLocked('swarm-form', true);
      btn.textContent = 'Creating...';
      await api.createSwarm(name, description, isNaN(maxAgents) ? 50 : maxAgents);
      hideSwarmModal();
      toast.success(`Swarm "${name}" created`);
      await deps.fetchSwarms();
    } catch (err) {
      toast.error('Failed to create swarm: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFormLocked('swarm-form', false);
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
      setFormLocked('task-form', true);
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
      await deps.fetchTasks();
    } catch (err) {
      toast.error('Failed to create task: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFormLocked('task-form', false);
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

    // Validate server URL if provided
    if (serverOverride) {
      try {
        new URL(serverOverride);
      } catch {
        toast.warning('Server URL is not a valid URL (e.g. http://localhost:4321)');
        return;
      }
    }

    const btn = document.getElementById('connect-generate') as HTMLButtonElement;
    try {
      setFormLocked('connect-form', true);
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
  -H "Authorization: Bearer $TOKEN" \\
  -d '{"event":{"type":"system","text":"connected"}}'`;

      const pre = document.getElementById('connect-command-pre');
      const output = document.getElementById('connect-command-output');
      if (pre) pre.textContent = command;
      output?.classList.remove('hidden');

      toast.success(`External worker "${handle}" registered`);
      await deps.fetchWorkers();
    } catch (err) {
      toast.error('Failed to register worker: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFormLocked('connect-form', false);
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

  // Close any active modal on Escape key
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const modals = ['spawn-modal', 'swarm-modal', 'task-modal', 'connect-modal', 'login-modal'];
      for (const id of modals) {
        const modal = document.getElementById(id);
        if (modal?.classList.contains('active')) {
          modal.classList.remove('active');
          const form = modal.querySelector('form') as HTMLFormElement | null;
          form?.reset();
          e.stopPropagation();
          return;
        }
      }
    }
  });
}
