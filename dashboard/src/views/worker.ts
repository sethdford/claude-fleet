/**
 * Worker Detail View
 * Shows worker info, live terminal output, checkpoints, and actions
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import dayjs from 'dayjs';
import store from '@/store';
import { getWorkerOutput, sendToWorker, dismissWorker } from '@/api';
import {
  listCheckpoints,
  getLatestCheckpoint,
  acceptCheckpoint,
  rejectCheckpoint,
} from '@/api-operations';
import wsManager from '@/websocket';
import toast from '@/components/toast';
import { confirm as confirmDialog } from '@/components/confirm';
import { escapeHtml } from '@/utils/escape-html';
import { writeToTerminal } from './worker-terminal';
import type { Checkpoint } from '@/types';

interface WorkerData {
  handle: string;
  teamName: string;
  state: string;
  health?: string;
  spawnedAt: number;
  restartCount?: number;
  swarmId?: string;
  currentTaskId?: string;
}

/**
 * Format state badge color
 */
function getStateBadgeClass(state: string): string {
  switch (state) {
    case 'working': return 'green';
    case 'ready': return 'blue';
    case 'starting': return 'yellow';
    case 'stopping':
    case 'stopped': return 'red';
    default: return '';
  }
}

/**
 * Format health status
 */
function getHealthClass(health: string): string {
  switch (health) {
    case 'healthy': return 'green';
    case 'degraded': return 'yellow';
    case 'unhealthy': return 'red';
    default: return '';
  }
}

/**
 * Render worker info card
 */
function renderWorkerInfo(worker: WorkerData | undefined): string {
  if (!worker) {
    return `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          <div class="empty-state-title">Worker Not Found</div>
          <div class="empty-state-text">This worker may have been dismissed</div>
        </div>
      </div>
    `;
  }

  const uptime = Date.now() - worker.spawnedAt;
  const hours = Math.floor(uptime / 3600000);
  const minutes = Math.floor((uptime % 3600000) / 60000);

  return `
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-md">
          <span class="status-dot ${worker.health || 'healthy'}"></span>
          <div>
            <h3 class="card-title">${escapeHtml(worker.handle)}</h3>
            <div class="card-subtitle">${escapeHtml(worker.teamName)}</div>
          </div>
        </div>
        <span class="badge ${getStateBadgeClass(worker.state)}">${escapeHtml(worker.state)}</span>
      </div>

      <div class="grid grid-cols-4 gap-md mt-md">
        <div>
          <div class="metric-label">Health</div>
          <div class="badge ${getHealthClass(worker.health || 'healthy')}">${escapeHtml(worker.health || 'healthy')}</div>
        </div>
        <div>
          <div class="metric-label">Uptime</div>
          <div class="font-semibold">${hours}h ${minutes}m</div>
        </div>
        <div>
          <div class="metric-label">Restarts</div>
          <div class="font-semibold">${worker.restartCount || 0}</div>
        </div>
        <div>
          <div class="metric-label">Swarm</div>
          <div class="font-semibold">${worker.swarmId ? escapeHtml(worker.swarmId.slice(0, 8)) : 'None'}</div>
        </div>
      </div>

      ${worker.currentTaskId ? `
        <div class="mt-md p-md bg-surface-raised rounded-md">
          <div class="metric-label">Current Task</div>
          <div class="font-mono text-blue text-xs">
            ${escapeHtml(worker.currentTaskId)}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render checkpoints section
 */
function renderCheckpoints(latest: Checkpoint | null, history: Checkpoint[]): string {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Checkpoints</h3>
      </div>
      ${latest ? `
        <div class="p-md border-b border-edge">
          <div class="flex items-center justify-between mb-sm">
            <span class="badge ${latest.status === 'accepted' ? 'green' : latest.status === 'rejected' ? 'red' : 'yellow'}">${escapeHtml(latest.status)}</span>
            <span class="text-xs text-fg-muted">${latest.createdAt ? dayjs(latest.createdAt).fromNow() : ''}</span>
          </div>
          ${latest.summary ? `<div class="text-sm text-fg-secondary mb-sm">${escapeHtml(latest.summary.slice(0, 200))}</div>` : ''}
          ${latest.status === 'pending' ? `
            <div class="flex gap-sm">
              <button class="btn btn-primary btn-sm checkpoint-accept" data-checkpoint-id="${escapeHtml(latest.id)}">Accept</button>
              <button class="btn btn-danger btn-sm checkpoint-reject" data-checkpoint-id="${escapeHtml(latest.id)}">Reject</button>
            </div>
          ` : ''}
        </div>
      ` : '<div class="p-md text-fg-muted text-sm">No checkpoints yet</div>'}
      ${history.length > 1 ? `
        <div class="p-md">
          <div class="text-xs text-fg-muted mb-sm">History (${history.length})</div>
          ${history.slice(0, 5).map(cp => `
            <div class="flex items-center gap-sm p-xs border-b border-edge text-xs">
              <span class="badge ${cp.status === 'accepted' ? 'green' : cp.status === 'rejected' ? 'red' : 'yellow'}">${escapeHtml(cp.status)}</span>
              <span class="flex-1 text-fg-secondary">${escapeHtml((cp.summary || cp.id).slice(0, 60))}</span>
              <span class="text-fg-muted">${cp.createdAt ? dayjs(cp.createdAt).fromNow() : ''}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render the worker view
 */
export async function renderWorker(container: HTMLElement, handle: string): Promise<() => void> {
  let worker = (store.get('workers') as WorkerData[] | undefined)?.find((w: WorkerData) => w.handle === handle);

  container.innerHTML = `
    <div class="grid grid-cols-1 gap-lg">
      <div id="worker-info">
        ${renderWorkerInfo(worker)}
      </div>

      <div>
        <div class="flex items-center justify-between mb-md">
          <h2 class="card-subtitle">Terminal Output</h2>
          <div class="flex gap-sm">
            <button class="btn btn-secondary btn-sm" id="clear-terminal">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
              </svg>
              Clear
            </button>
            <button class="btn btn-danger btn-sm" id="dismiss-worker">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
              Dismiss
            </button>
          </div>
        </div>

        <div class="terminal-container">
          <div class="terminal-header">
            <div class="terminal-dots">
              <span class="terminal-dot red"></span>
              <span class="terminal-dot yellow"></span>
              <span class="terminal-dot green"></span>
            </div>
            <span class="terminal-title">${escapeHtml(handle)}</span>
          </div>
          <div class="terminal-body" id="terminal"></div>
        </div>
      </div>

      <div id="worker-checkpoints">
        <h2 class="card-subtitle mb-md">Checkpoints</h2>
        <div id="checkpoints-container">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>

      <div>
        <h2 class="card-subtitle mb-md">Send Message</h2>
        <div class="card">
          <form id="send-message-form" class="flex gap-sm">
            <input type="text" class="form-input flex-1" id="message-input" placeholder="Enter message to send to worker...">
            <button type="submit" class="btn btn-primary">Send</button>
          </form>
        </div>
      </div>
    </div>
  `;

  // Load checkpoints
  async function loadCheckpoints(): Promise<void> {
    const el = document.getElementById('checkpoints-container');
    if (!el) return;
    try {
      const [latest, history] = await Promise.all([
        getLatestCheckpoint(handle).catch(() => null),
        listCheckpoints(handle).catch(() => []),
      ]);
      el.innerHTML = renderCheckpoints(
        latest as Checkpoint | null,
        Array.isArray(history) ? history as Checkpoint[] : [],
      );
    } catch {
      el.innerHTML = renderCheckpoints(null, []);
    }
  }

  // Initialize xterm.js terminal
  const term = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      black: '#0d1117',
      red: '#f85149',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#a371f7',
      cyan: '#39c5cf',
      white: '#c9d1d9',
      brightBlack: '#6e7681',
      brightRed: '#f85149',
      brightGreen: '#3fb950',
      brightYellow: '#d29922',
      brightBlue: '#58a6ff',
      brightMagenta: '#a371f7',
      brightCyan: '#39c5cf',
      brightWhite: '#ffffff',
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal')!);
  fitAddon.fit();

  // Write initial output from store
  const existingOutput = (store.get('workerOutput') as Record<string, { content: unknown }[]> | undefined)?.[handle] || [];
  existingOutput.forEach((entry: { content: unknown }) => {
    writeToTerminal(term, entry.content);
  });

  // Fetch current output from server
  try {
    const data = await getWorkerOutput(handle) as { output?: string[] };
    if (data.output && Array.isArray(data.output)) {
      data.output.forEach((line: string) => {
        writeToTerminal(term, line);
      });
    }
  } catch (e) {
    term.writeln(`\x1b[31mFailed to fetch output: ${(e as Error).message}\x1b[0m`);
  }

  // Load checkpoints in parallel
  await loadCheckpoints();

  // Handle window resize
  const handleResize = (): void => fitAddon.fit();
  window.addEventListener('resize', handleResize);

  // Subscribe to worker updates
  const unsubWorkers = store.subscribe('workers', (workers: unknown) => {
    worker = (workers as WorkerData[] | undefined)?.find((w: WorkerData) => w.handle === handle);
    document.getElementById('worker-info')!.innerHTML = renderWorkerInfo(worker);
  });

  // Subscribe to worker output
  const unsubOutput = store.subscribe('workerOutput', (workerOutput: unknown) => {
    const outputs = (workerOutput as Record<string, { content: unknown }[]> | undefined)?.[handle] || [];
    if (outputs.length > 0) {
      const latest = outputs[outputs.length - 1];
      writeToTerminal(term, latest.content);
    }
  });

  // WebSocket listener for live output
  const unsubWS = wsManager.on('worker:output', (data: unknown) => {
    const { handle: h, output } = data as { handle: string; output: unknown };
    if (h === handle) {
      writeToTerminal(term, output);
    }
  });

  // Event delegation for all click actions
  container.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Clear terminal
    if (target.closest('#clear-terminal')) {
      term.clear();
      return;
    }

    // Dismiss worker
    if (target.closest('#dismiss-worker')) {
      const confirmed = await confirmDialog({
        title: 'Dismiss Worker',
        message: `Are you sure you want to dismiss worker "${handle}"? This will terminate the worker process.`,
        confirmText: 'Dismiss',
        variant: 'danger',
      });
      if (confirmed) {
        try {
          await dismissWorker(handle);
          toast.success(`Worker "${handle}" dismissed`);
          window.location.hash = '/';
        } catch (err) {
          toast.error('Failed to dismiss worker: ' + (err as Error).message);
        }
      }
      return;
    }

    // Accept checkpoint
    const acceptBtn = target.closest('.checkpoint-accept') as HTMLElement | null;
    if (acceptBtn) {
      const cpId = acceptBtn.dataset.checkpointId;
      if (cpId) {
        try {
          await acceptCheckpoint(cpId);
          toast.success('Checkpoint accepted');
          await loadCheckpoints();
        } catch (err) {
          toast.error('Failed to accept: ' + (err as Error).message);
        }
      }
      return;
    }

    // Reject checkpoint
    const rejectBtn = target.closest('.checkpoint-reject') as HTMLElement | null;
    if (rejectBtn) {
      const cpId = rejectBtn.dataset.checkpointId;
      if (cpId) {
        try {
          await rejectCheckpoint(cpId);
          toast.success('Checkpoint rejected');
          await loadCheckpoints();
        } catch (err) {
          toast.error('Failed to reject: ' + (err as Error).message);
        }
      }
      return;
    }
  });

  // Send message form
  document.getElementById('send-message-form')!.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    const input = document.getElementById('message-input') as HTMLInputElement;
    const message = input.value.trim();

    if (!message) return;

    try {
      await sendToWorker(handle, message);
      term.writeln(`\x1b[34m> ${message}\x1b[0m`);
      input.value = '';
      toast.success('Message sent');
    } catch (err) {
      toast.error('Failed to send message: ' + (err as Error).message);
    }
  });

  // Return cleanup function
  return () => {
    window.removeEventListener('resize', handleResize);
    unsubWorkers();
    unsubOutput();
    unsubWS();
    term.dispose();
  };
}
