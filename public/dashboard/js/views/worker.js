/**
 * Worker Detail View
 * Shows worker info, live terminal output, and actions
 */

import store from '../store.js';
import ApiClient from '../api.js';
import wsManager from '../websocket.js';

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Format state badge color
 */
function getStateBadgeClass(state) {
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
function getHealthClass(health) {
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
function renderWorkerInfo(worker) {
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

      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-md); margin-top: var(--space-md);">
        <div>
          <div class="metric-label">Health</div>
          <div class="badge ${getHealthClass(worker.health)}">${escapeHtml(worker.health || 'healthy')}</div>
        </div>
        <div>
          <div class="metric-label">Uptime</div>
          <div style="font-weight: 600;">${hours}h ${minutes}m</div>
        </div>
        <div>
          <div class="metric-label">Restarts</div>
          <div style="font-weight: 600;">${worker.restartCount || 0}</div>
        </div>
        <div>
          <div class="metric-label">Swarm</div>
          <div style="font-weight: 600;">${worker.swarmId ? escapeHtml(worker.swarmId.slice(0, 8)) : 'None'}</div>
        </div>
      </div>

      ${worker.currentTaskId ? `
        <div style="margin-top: var(--space-md); padding: var(--space-md); background: var(--bg-tertiary); border-radius: var(--radius-md);">
          <div class="metric-label">Current Task</div>
          <div style="font-family: var(--font-mono); font-size: 12px; color: var(--accent-blue);">
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
export async function renderWorker(container, handle) {
  // Find worker in store
  let worker = store.get('workers')?.find(w => w.handle === handle);

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr; gap: var(--space-lg);">
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
            <input type="text" class="form-input" id="message-input" placeholder="Enter message to send to worker..." style="flex: 1;">
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

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  // Write initial output from store
  const existingOutput = store.get('workerOutput')?.[handle] || [];
  existingOutput.forEach(entry => {
    writeToTerminal(term, entry.content);
  });

  // Fetch current output from server
  // Server returns: { handle, state, output: string[] }
  try {
    const data = await ApiClient.getWorkerOutput(handle);
    if (data.output && Array.isArray(data.output)) {
      data.output.forEach(line => {
        writeToTerminal(term, line);
      });
    }
  } catch (e) {
    term.writeln(`\x1b[31mFailed to fetch output: ${e.message}\x1b[0m`);
  }

  // Handle window resize
  const handleResize = () => fitAddon.fit();
  window.addEventListener('resize', handleResize);

  // Subscribe to worker updates
  const unsubWorkers = store.subscribe('workers', (workers) => {
    worker = workers?.find(w => w.handle === handle);
    document.getElementById('worker-info').innerHTML = renderWorkerInfo(worker);
  });

  // Subscribe to worker output
  const unsubOutput = store.subscribe('workerOutput', (workerOutput) => {
    const outputs = workerOutput?.[handle] || [];
    if (outputs.length > 0) {
      const latest = outputs[outputs.length - 1];
      writeToTerminal(term, latest.content);
    }
  });

  // WebSocket listener for live output
  const unsubWS = wsManager.on('worker:output', ({ handle: h, output }) => {
    if (h === handle) {
      writeToTerminal(term, output);
    }
  });

  // Clear terminal button
  document.getElementById('clear-terminal').addEventListener('click', () => {
    term.clear();
  });

  // Dismiss worker button
  document.getElementById('dismiss-worker').addEventListener('click', async () => {
    if (confirm(`Are you sure you want to dismiss worker "${handle}"?`)) {
      try {
        await ApiClient.dismissWorker(handle);
        window.location.hash = '/';
      } catch (e) {
        alert('Failed to dismiss worker: ' + e.message);
      }
    }
  });

  // Send message form
  document.getElementById('send-message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const message = input.value.trim();

    if (!message) return;

    try {
      await ApiClient.sendToWorker(handle, message);
      term.writeln(`\x1b[34m> ${message}\x1b[0m`);
      input.value = '';
    } catch (e) {
      alert('Failed to send message: ' + e.message);
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
function writeToTerminal(term, content) {
  try {
    if (typeof content === 'string') {
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(content);
        formatEventToTerminal(term, parsed);
      } catch {
        // Plain text
        term.writeln(content);
      }
    } else if (typeof content === 'object') {
      formatEventToTerminal(term, content);
    }
  } catch (e) {
    term.writeln(String(content));
  }
}

/**
 * Format Claude Code event to terminal
 */
function formatEventToTerminal(term, event) {
  if (!event || typeof event !== 'object') {
    term.writeln(String(event));
    return;
  }

  const type = event.type || 'unknown';

  switch (type) {
    case 'assistant':
      if (event.message?.content) {
        event.message.content.forEach(block => {
          if (block.type === 'text') {
            term.writeln(`\x1b[36m${block.text}\x1b[0m`);
          } else if (block.type === 'tool_use') {
            term.writeln(`\x1b[33m[Tool: ${block.name}]\x1b[0m`);
          }
        });
      }
      break;

    case 'result':
      if (event.result) {
        term.writeln(`\x1b[32m${JSON.stringify(event.result).slice(0, 200)}\x1b[0m`);
      }
      break;

    case 'user':
      if (event.message?.content) {
        event.message.content.forEach(block => {
          if (block.type === 'text') {
            term.writeln(`\x1b[34m> ${block.text}\x1b[0m`);
          }
        });
      }
      break;

    case 'error':
      term.writeln(`\x1b[31mError: ${event.error || JSON.stringify(event)}\x1b[0m`);
      break;

    default:
      // Compact display for other events
      const preview = JSON.stringify(event).slice(0, 150);
      term.writeln(`\x1b[90m[${type}] ${preview}${preview.length >= 150 ? '...' : ''}\x1b[0m`);
  }
}
