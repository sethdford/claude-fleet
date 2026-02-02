/**
 * Swarm Detail View
 * Shows agent hierarchy, blackboard messages, spawn queue, and swarm intelligence.
 * Panel renderers live in swarm-panels.ts.
 */

import store from '@/store';
import {
  getSwarm,
  getBlackboard,
  postBlackboard,
  getSpawnQueue,
  killSwarm,
} from '@/api';
import { archiveBlackboard, archiveOldMessages } from '@/api-operations';
import type { BlackboardQueryOptions } from '@/api';
import toast from '@/components/toast';
import { confirm as confirmDialog } from '@/components/confirm';
import { renderSwarmIntelligence } from './swarm-intelligence';

import {
  renderSwarmHeader,
  renderAgentGraph,
  renderBlackboard,
  renderSpawnQueue,
  renderOverviewContent,
} from './swarm-panels';
import type { SwarmData, WorkerData, BlackboardMsg, SpawnQueueData } from './swarm-panels';

/**
 * Render the swarm view
 */
export async function renderSwarm(container: HTMLElement, swarmId: string): Promise<() => void> {
  let swarm = (store.get('swarms') as SwarmData[] | undefined)?.find((s: SwarmData) => s.id === swarmId);
  let blackboard: BlackboardMsg[] = [];
  let spawnQueue: SpawnQueueData | null = null;
  let currentFilter = 'all';
  let currentTab = 'overview';
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let unsubWorkers: (() => void) | null = null;

  // Fetch swarm details
  try {
    const data = await getSwarm(swarmId) as SwarmData & { swarm?: SwarmData };
    swarm = data.swarm || data;
  } catch (e) {
    console.error('Failed to fetch swarm:', e);
  }

  // Fetch blackboard messages
  async function fetchBlackboard(filter = 'all'): Promise<void> {
    try {
      const options: BlackboardQueryOptions = { limit: 50 };
      if (filter !== 'all') {
        options.messageType = filter;
      }
      const data = await getBlackboard(swarmId, options) as BlackboardMsg[] | { messages?: BlackboardMsg[] };
      blackboard = (Array.isArray(data) ? data : (data as { messages?: BlackboardMsg[] }).messages || []) as BlackboardMsg[];
      currentFilter = filter;
      const el = document.getElementById('blackboard-container');
      if (el) {
        el.innerHTML = renderBlackboard(blackboard, currentFilter);
        setupFilterButtons();
      }
    } catch (e) {
      console.error('Failed to fetch blackboard:', e);
    }
  }

  // Fetch spawn queue
  async function fetchSpawnQueue(): Promise<void> {
    try {
      spawnQueue = await getSpawnQueue() as SpawnQueueData;
      const el = document.getElementById('spawn-queue-container');
      if (el) {
        el.innerHTML = renderSpawnQueue(spawnQueue);
      }
    } catch (e) {
      console.error('Failed to fetch spawn queue:', e);
    }
  }

  // Setup filter buttons
  function setupFilterButtons(): void {
    document.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => fetchBlackboard((btn as HTMLElement).dataset.filter || 'all'));
    });

    // Archive buttons
    document.querySelector('.archive-blackboard')?.addEventListener('click', async () => {
      try {
        await archiveBlackboard(swarmId);
        toast.success('Blackboard archived');
        await fetchBlackboard(currentFilter);
      } catch (err) {
        toast.error('Failed to archive: ' + (err as Error).message);
      }
    });
    document.querySelector('.archive-old-messages')?.addEventListener('click', async () => {
      try {
        await archiveOldMessages(swarmId, 3600000);
        toast.success('Old messages archived');
        await fetchBlackboard(currentFilter);
      } catch (err) {
        toast.error('Failed to archive: ' + (err as Error).message);
      }
    });
  }

  // Get workers in this swarm
  const swarmWorkers = ((store.get('workers') as WorkerData[] | undefined) || []).filter((w: WorkerData) => w.swarmId === swarmId);

  // Render the main container with tabs
  container.innerHTML = `
    <div id="swarm-header">
      ${renderSwarmHeader(swarm)}
    </div>

    <!-- Tab Navigation -->
    <div class="flex gap-xs border-b border-edge mt-md mb-lg">
      <button class="tab-btn active py-sm px-md bg-transparent border-0 border-b-2 border-b-blue text-fg font-semibold cursor-pointer" data-tab="overview">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="align-middle mr-1.5">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
        </svg>
        Overview
      </button>
      <button class="tab-btn py-sm px-md bg-transparent border-0 border-b-2 border-b-transparent text-fg-secondary font-medium cursor-pointer" data-tab="intelligence">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="align-middle mr-1.5">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        Swarm Intelligence
      </button>
    </div>

    <!-- Tab Content -->
    <div id="tab-content">
      ${renderOverviewContent(swarm, swarmWorkers, blackboard, currentFilter, spawnQueue)}
    </div>
  `;

  // Setup tab switching
  function setupTabs(): void {
    container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tab = (btn as HTMLElement).dataset.tab;
        if (tab === currentTab) return;

        // Update tab styles via class toggling
        container.querySelectorAll('.tab-btn').forEach((b) => {
          b.classList.remove('active', 'border-b-blue', 'text-fg', 'font-semibold');
          b.classList.add('border-b-transparent', 'text-fg-secondary', 'font-medium');
        });
        btn.classList.add('active', 'border-b-blue', 'text-fg', 'font-semibold');
        btn.classList.remove('border-b-transparent', 'text-fg-secondary', 'font-medium');

        currentTab = tab!;
        const tabContent = document.getElementById('tab-content')!;

        if (tab === 'overview') {
          tabContent.innerHTML = renderOverviewContent(swarm, swarmWorkers, blackboard, currentFilter, spawnQueue);
          renderAgentGraph(document.getElementById('agent-graph'), swarmWorkers);
          await Promise.all([fetchBlackboard(), fetchSpawnQueue()]);
          setupPostForm();
          startOverviewPolling();
        } else if (tab === 'intelligence') {
          stopOverviewPolling();
          await renderSwarmIntelligence(tabContent, swarmId);
        }
      });
    });
  }

  // Setup post to blackboard form
  function setupPostForm(): void {
    document.getElementById('post-blackboard-form')?.addEventListener('submit', async (e: Event) => {
      e.preventDefault();
      const messageType = (document.getElementById('message-type') as HTMLSelectElement).value;
      const priority = (document.getElementById('message-priority') as HTMLSelectElement).value;
      const message = (document.getElementById('blackboard-message') as HTMLInputElement).value.trim();

      if (!message) return;

      try {
        await postBlackboard(swarmId, message, messageType, null, priority);
        (document.getElementById('blackboard-message') as HTMLInputElement).value = '';
        await fetchBlackboard(currentFilter);
      } catch (e) {
        toast.error('Failed to post message: ' + (e as Error).message);
      }
    });
  }

  // Start polling for overview tab
  function startOverviewPolling(): void {
    stopOverviewPolling();
    pollInterval = setInterval(() => fetchBlackboard(currentFilter), 10000);
  }

  // Stop polling
  function stopOverviewPolling(): void {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // Initial setup
  setupTabs();
  renderAgentGraph(document.getElementById('agent-graph'), swarmWorkers);
  await Promise.all([fetchBlackboard(), fetchSpawnQueue()]);
  setupPostForm();
  startOverviewPolling();

  // Kill swarm button
  document.getElementById('kill-swarm')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Kill Swarm',
      message: `Are you sure you want to kill swarm "${swarm?.name}"? This will dismiss all agents.`,
      confirmText: 'Kill Swarm',
      variant: 'danger',
    });
    if (confirmed) {
      try {
        await killSwarm(swarmId);
        toast.success(`Swarm "${swarm?.name}" killed`);
        window.location.hash = '/';
      } catch (e) {
        toast.error('Failed to kill swarm: ' + (e as Error).message);
      }
    }
  });

  // Spawn button in queue panel — uses delegation since panel re-renders
  container.addEventListener('click', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.request-spawn-btn')) {
      window.fleetDashboard?.showSpawnModal();
    }
  });

  // Subscribe to worker updates to refresh graph
  unsubWorkers = store.subscribe('workers', (workers: unknown) => {
    const updated = ((workers as WorkerData[] | undefined) || []).filter((w: WorkerData) => w.swarmId === swarmId);
    if (currentTab === 'overview') {
      renderAgentGraph(document.getElementById('agent-graph'), updated);
    }
  });

  // Return cleanup function
  return () => {
    if (unsubWorkers) unsubWorkers();
    stopOverviewPolling();
  };
}
