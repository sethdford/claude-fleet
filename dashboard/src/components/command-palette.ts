/**
 * Command Palette (Cmd+K / Ctrl+K)
 * Quick navigation and actions for the fleet dashboard
 */

import store from '@/store';
import { escapeHtml } from '@/utils/escape-html';

interface Command {
  id: string;
  label: string;
  section: string;
  icon: string;
  meta?: string;
  action: () => void;
}

/**
 * The static commands reference window.fleetDashboard for modal actions
 * and window.location.hash for navigation. This coupling will be resolved
 * when main.ts wires everything together.
 */
const STATIC_COMMANDS: Command[] = [
  { id: 'nav-overview', label: 'Go to Dashboard', section: 'Navigation', icon: '\u229E', action: () => { window.location.hash = '/'; } },
  { id: 'nav-metrics', label: 'Go to Metrics', section: 'Navigation', icon: '\uD83D\uDCCA', action: () => { window.location.hash = '/metrics'; } },
  { id: 'nav-tasks', label: 'Go to Tasks', section: 'Navigation', icon: '\u2713', action: () => { window.location.hash = '/tasks'; } },
  { id: 'nav-graph', label: 'Go to Dependency Graph', section: 'Navigation', icon: '\u25CE', action: () => { window.location.hash = '/graph'; } },
  { id: 'nav-scheduler', label: 'Go to Scheduler', section: 'Navigation', icon: '\u23F1', action: () => { window.location.hash = '/scheduler'; } },
  { id: 'nav-mail', label: 'Go to Mail', section: 'Navigation', icon: '\u2709', action: () => { window.location.hash = '/mail'; } },
  { id: 'nav-workflows', label: 'Go to Workflows', section: 'Navigation', icon: '\u26A1', action: () => { window.location.hash = '/workflows'; } },
  { id: 'act-spawn', label: 'Spawn Worker', section: 'Actions', icon: '+', action: () => { window.fleetDashboard?.showSpawnModal(); } },
  { id: 'act-swarm', label: 'Create Swarm', section: 'Actions', icon: '\u2726', action: () => { window.fleetDashboard?.showSwarmModal(); } },
  { id: 'act-task', label: 'Create Task', section: 'Actions', icon: '\u2610', action: () => { window.fleetDashboard?.showTaskModal(); } },
  { id: 'act-refresh', label: 'Refresh All Data', section: 'Actions', icon: '\u21BB', action: () => { window.fleetDashboard?.refreshAll(); } },
];

// window.fleetDashboard is declared globally in main.ts

let overlay: HTMLElement | null = null;
let selectedIndex = 0;

function getDynamicCommands(): Command[] {
  const commands: Command[] = [];
  const workers = store.get('workers') ?? [];
  const swarms = store.get('swarms') ?? [];

  for (const w of workers) {
    commands.push({
      id: `worker-${w.handle}`,
      label: `Worker: ${w.handle}`,
      section: 'Workers',
      icon: '\u25CF',
      meta: `${w.state} \u00B7 ${w.health ?? 'healthy'}`,
      action: () => { window.location.hash = `/worker/${encodeURIComponent(w.handle)}`; },
    });
  }

  for (const s of swarms) {
    commands.push({
      id: `swarm-${s.id}`,
      label: `Swarm: ${s.name}`,
      section: 'Swarms',
      icon: '\u2726',
      meta: `${s.agents?.length ?? 0} agents`,
      action: () => { window.location.hash = `/swarm/${encodeURIComponent(s.id)}`; },
    });
  }

  return commands;
}

function getAllCommands(): Command[] {
  return [...STATIC_COMMANDS, ...getDynamicCommands()];
}

function filterCommands(query: string): Command[] {
  if (!query) return getAllCommands();
  const q = query.toLowerCase();
  return getAllCommands().filter(cmd =>
    cmd.label.toLowerCase().includes(q) ||
    cmd.section.toLowerCase().includes(q) ||
    (cmd.meta && cmd.meta.toLowerCase().includes(q)),
  );
}

function render(filtered: Command[]): string {
  const grouped: Record<string, Command[]> = {};
  for (const cmd of filtered) {
    if (!grouped[cmd.section]) grouped[cmd.section] = [];
    grouped[cmd.section].push(cmd);
  }

  let html = '';
  let index = 0;

  for (const [section, cmds] of Object.entries(grouped)) {
    html += `<div class="cmd-section">${escapeHtml(section)}</div>`;
    for (const cmd of cmds) {
      const isSelected = index === selectedIndex;
      html += `
        <div class="cmd-item ${isSelected ? 'cmd-selected' : ''}" data-index="${index}" data-id="${cmd.id}">
          <span class="cmd-icon">${cmd.icon}</span>
          <span class="cmd-label">${escapeHtml(cmd.label)}</span>
          ${cmd.meta ? `<span class="cmd-meta">${escapeHtml(cmd.meta)}</span>` : ''}
          ${isSelected ? '<kbd class="cmd-kbd">\u21B5</kbd>' : ''}
        </div>
      `;
      index++;
    }
  }

  return html || '<div class="cmd-empty">No matches found</div>';
}

function scrollSelected(containerEl: HTMLElement): void {
  const selected = containerEl.querySelector('.cmd-selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function open(): void {
  if (overlay) return;
  selectedIndex = 0;

  overlay = document.createElement('div');
  overlay.className = 'cmd-overlay';
  overlay.innerHTML = `
    <div class="cmd-palette">
      <div class="cmd-input-wrap">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="text-fg-muted shrink-0">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input type="text" class="cmd-input" placeholder="Type a command..." autofocus>
        <kbd class="cmd-esc">Esc</kbd>
      </div>
      <div class="cmd-results" id="cmd-results">
        ${render(getAllCommands())}
      </div>
    </div>
  `;

  const input = overlay.querySelector('.cmd-input') as HTMLInputElement;
  const results = overlay.querySelector('#cmd-results') as HTMLElement;
  let currentFiltered = getAllCommands();

  input.addEventListener('input', () => {
    currentFiltered = filterCommands(input.value);
    selectedIndex = 0;
    results.innerHTML = render(currentFiltered);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, currentFiltered.length - 1);
      results.innerHTML = render(currentFiltered);
      scrollSelected(results);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      results.innerHTML = render(currentFiltered);
      scrollSelected(results);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = currentFiltered[selectedIndex];
      if (cmd) {
        close();
        cmd.action();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  results.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.cmd-item') as HTMLElement | null;
    if (item) {
      const cmd = currentFiltered[parseInt(item.dataset.index!, 10)];
      if (cmd) {
        close();
        cmd.action();
      }
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay?.classList.add('cmd-visible');
    input.focus();
  });
}

function close(): void {
  if (!overlay) return;
  overlay.classList.remove('cmd-visible');
  const ref = overlay;
  setTimeout(() => {
    ref.remove();
    overlay = null;
  }, 200);
}

/** Register the global Cmd+K / Ctrl+K keyboard shortcut. */
export function initCommandPalette(): void {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (overlay) {
        close();
      } else {
        open();
      }
    }
  });
}

export default { open, close };
