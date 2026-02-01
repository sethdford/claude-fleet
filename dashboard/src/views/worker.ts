/**
 * Worker Detail View
 * Shows worker info, live terminal output, and actions
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import store from '@/store';
import { getWorkerOutput, sendToWorker, dismissWorker } from '@/api';
import wsManager from '@/websocket';
import toast from '@/components/toast';
import { confirm as confirmDialog } from '@/components/confirm';
import { escapeHtml } from '@/utils/escape-html';

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

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ClaudeEvent {
  type?: string;
  message?: { content: ContentBlock[] };
  result?: {
    cost_usd?: number;
    duration_ms?: number;
    duration_api_ms?: number;
    model?: string;
    num_turns?: number;
  };
  error?: string;
  subtype?: string;
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
 * Render the worker view
 */
export async function renderWorker(container: HTMLElement, handle: string): Promise<() => void> {
  // Find worker in store
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
  // Server returns: { handle, state, output: string[] }
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

  // Clear terminal button
  document.getElementById('clear-terminal')!.addEventListener('click', () => {
    term.clear();
  });

  // Dismiss worker button
  document.getElementById('dismiss-worker')!.addEventListener('click', async () => {
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
      } catch (e) {
        toast.error('Failed to dismiss worker: ' + (e as Error).message);
      }
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
    } catch (e) {
      toast.error('Failed to send message: ' + (e as Error).message);
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

/**
 * Write content to terminal, handling JSON and plain text
 */
function writeToTerminal(term: Terminal, content: unknown): void {
  try {
    if (typeof content === 'string') {
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(content) as ClaudeEvent;
        formatEventToTerminal(term, parsed);
      } catch {
        // Plain text
        term.writeln(content);
      }
    } else if (typeof content === 'object') {
      formatEventToTerminal(term, content as ClaudeEvent);
    }
  } catch {
    term.writeln(String(content));
  }
}

/**
 * Format a timestamp prefix for terminal lines
 */
function termTimestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `\x1b[90m${hh}:${mm}:${ss}\x1b[0m`;
}

/**
 * Word-wrap text to a given width, returning an array of lines
 */
function wordWrap(text: string, width: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.length <= width) {
      lines.push(rawLine);
      continue;
    }
    let remaining = rawLine;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(' ', width);
      if (breakAt <= 0) breakAt = width;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

/**
 * Format a tool_use input object into a compact parameter summary
 */
function formatToolParams(input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return '';
  // Show the most useful param per common tool
  if (input.file_path) return ` ${input.file_path}`;
  if (input.command) return ` $ ${String(input.command).slice(0, 80)}`;
  if (input.pattern) return ` ${input.pattern}`;
  if (input.query) return ` "${String(input.query).slice(0, 60)}"`;
  if (input.url) return ` ${String(input.url).slice(0, 80)}`;
  // Fallback: first string value
  const firstStr = Object.values(input).find(v => typeof v === 'string');
  return firstStr ? ` ${String(firstStr).slice(0, 60)}` : '';
}

/**
 * Format Claude Code event to terminal
 */
function formatEventToTerminal(term: Terminal, event: ClaudeEvent): void {
  if (!event || typeof event !== 'object') {
    term.writeln(String(event));
    return;
  }

  const ts = termTimestamp();
  const type = event.type || 'unknown';
  const WRAP_WIDTH = 100;

  switch (type) {
    case 'assistant':
      if (event.message?.content) {
        event.message.content.forEach((block: ContentBlock) => {
          if (block.type === 'text') {
            const wrapped = wordWrap(block.text || '', WRAP_WIDTH);
            wrapped.forEach((line: string, i: number) => {
              const prefix = i === 0 ? `${ts} \x1b[36m` : '         \x1b[36m';
              term.writeln(`${prefix}${line}\x1b[0m`);
            });
          } else if (block.type === 'tool_use') {
            const params = formatToolParams(block.input);
            term.writeln(`${ts} \x1b[33m[Tool: ${block.name}${params}]\x1b[0m`);
          }
        });
      }
      break;

    case 'result': {
      const r = event.result || {};
      const parts: string[] = [];
      if (r.cost_usd !== null && r.cost_usd !== undefined) parts.push(`cost: $${r.cost_usd.toFixed(4)}`);
      if (r.duration_ms !== null && r.duration_ms !== undefined) parts.push(`duration: ${(r.duration_ms / 1000).toFixed(1)}s`);
      if (r.duration_api_ms !== null && r.duration_api_ms !== undefined) parts.push(`api: ${(r.duration_api_ms / 1000).toFixed(1)}s`);
      if (r.model) parts.push(`model: ${r.model}`);
      if (r.num_turns !== null && r.num_turns !== undefined) parts.push(`turns: ${r.num_turns}`);
      const summary = parts.length ? parts.join(' | ') : JSON.stringify(r).slice(0, 150);
      term.writeln(`${ts} \x1b[32m✓ Completed — ${summary}\x1b[0m`);
      break;
    }

    case 'user':
      if (event.message?.content) {
        event.message.content.forEach((block: ContentBlock) => {
          if (block.type === 'text') {
            const wrapped = wordWrap(block.text || '', WRAP_WIDTH - 2);
            wrapped.forEach((line: string, i: number) => {
              const prefix = i === 0 ? `${ts} \x1b[34m> ` : '         \x1b[34m  ';
              term.writeln(`${prefix}${line}\x1b[0m`);
            });
          }
        });
      }
      break;

    case 'error':
      term.writeln(`${ts} \x1b[31m✗ Error: ${event.error || JSON.stringify(event)}\x1b[0m`);
      break;

    case 'system':
      term.writeln(`${ts} \x1b[90m● ${event.subtype || 'system event'}\x1b[0m`);
      break;

    default: {
      const preview = JSON.stringify(event).slice(0, 120);
      term.writeln(`${ts} \x1b[90m[${type}] ${preview}${preview.length >= 120 ? '...' : ''}\x1b[0m`);
    }
  }
}
