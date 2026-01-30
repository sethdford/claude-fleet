// Compounding Machine - Main Entry Point
//
// Orchestrates authentication, data fetching, WebSocket connection,
// and all visualization components.

import type { CompoundSnapshot, WSEvent, WSBlackboardEvent } from './types';
import { authenticate, getToken, fetchSnapshot, fetchWorkers, fetchSwarms, fetchMetrics } from './api';
import { initGraph, updateGraph, animateKnowledgeFlow, destroyGraph } from './graph';
import { initMetrics, updateMetrics, destroyMetrics } from './metrics';
import { addActivity, handleWSEvent } from './activity';
import { initLineage, updateLineage, destroyLineage } from './lineage';

// --- State ---

let ws: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
const POLL_INTERVAL = 5000;
const MAX_BOOT_ATTEMPTS = 10;
let bootAttempts = 0;

// --- Bootstrap ---

async function boot(): Promise<void> {
  bootAttempts++;

  if (bootAttempts > MAX_BOOT_ATTEMPTS) {
    addActivity('error', `Boot failed after ${MAX_BOOT_ATTEMPTS} attempts`);
    setConnectionStatus('disconnected');
    return;
  }

  setConnectionStatus('connecting');

  try {
    await authenticate();
    addActivity('spawn', 'Connected to fleet');
    setConnectionStatus('connected');
  } catch (err) {
    setConnectionStatus('disconnected');
    addActivity('error', `Auth failed: ${(err as Error).message}`);
    // Exponential backoff retry
    const delay = Math.min(1000 * Math.pow(2, bootAttempts), 30000);
    setTimeout(boot, delay);
    return;
  }

  // Initialize visualization components — each wrapped in try/catch
  // so one CDN failure doesn't kill everything
  try {
    initGraph();
  } catch (err) {
    addActivity('error', `Graph init failed: ${(err as Error).message}`);
    console.error('[compound] initGraph failed:', err);
  }

  try {
    initMetrics();
  } catch (err) {
    addActivity('error', `Metrics init failed: ${(err as Error).message}`);
    console.error('[compound] initMetrics failed:', err);
  }

  try {
    initLineage();
  } catch (err) {
    addActivity('error', `Lineage init failed: ${(err as Error).message}`);
    console.error('[compound] initLineage failed:', err);
  }

  // Connect WebSocket
  connectWebSocket();

  // Start polling
  pollTimer = setInterval(poll, POLL_INTERVAL);

  // Initial data fetch
  await poll();
}

// --- Data Polling ---

async function poll(): Promise<void> {
  try {
    const snapshot = await fetchSnapshot();
    onSnapshot(snapshot);
  } catch {
    // Fallback: try individual endpoints if /compound/snapshot not available
    try {
      const snapshot = await buildFallbackSnapshot();
      onSnapshot(snapshot);
    } catch (err) {
      console.error('Poll failed:', err);
    }
  }
}

async function buildFallbackSnapshot(): Promise<CompoundSnapshot> {
  const [workers, swarms, metrics] = await Promise.allSettled([
    fetchWorkers(),
    fetchSwarms(),
    fetchMetrics(),
  ]);

  const workerList = workers.status === 'fulfilled' ? workers.value : [];
  const swarmList = swarms.status === 'fulfilled' ? swarms.value : [];
  const metricsData = metrics.status === 'fulfilled' ? metrics.value : {};

  return {
    timestamp: Date.now(),
    uptime: (metricsData as Record<string, number>).uptime ?? 0,
    workers: workerList as CompoundSnapshot['workers'],
    swarms: swarmList as CompoundSnapshot['swarms'],
    tasks: {
      total: (metricsData as Record<string, number>).tasks ?? 0,
      completed: 0,
      byStatus: {},
    },
    intelligence: {},
    timeSeries: [],
    rates: {
      compoundRate: 0,
      knowledgeVelocity: 0,
      creditsVelocity: 0,
    },
  };
}

function onSnapshot(snapshot: CompoundSnapshot): void {
  // Update each visualization independently — one failure shouldn't break others
  try {
    updateGraph(snapshot);
  } catch (err) {
    console.error('[compound] updateGraph error:', err);
  }

  try {
    updateMetrics(snapshot);
  } catch (err) {
    console.error('[compound] updateMetrics error:', err);
  }

  try {
    updateLineage(snapshot);
  } catch (err) {
    console.error('[compound] updateLineage error:', err);
  }

  try {
    updateStatsBar(snapshot);
  } catch (err) {
    console.error('[compound] updateStatsBar error:', err);
  }
}

function updateStatsBar(snapshot: CompoundSnapshot): void {
  const agentsEl = document.getElementById('stat-agents');
  const tasksEl = document.getElementById('stat-tasks');
  const knowledgeEl = document.getElementById('stat-knowledge');
  const rateEl = document.getElementById('stat-rate');

  const activeWorkers = snapshot.workers.filter((w) => w.state !== 'stopped').length;
  if (agentsEl) agentsEl.textContent = String(activeWorkers);
  if (tasksEl) tasksEl.textContent = String(snapshot.tasks.total);

  // Count total knowledge entries across all swarm intelligence
  let totalKnowledge = 0;
  for (const intel of Object.values(snapshot.intelligence)) {
    totalKnowledge += intel.beliefStats?.totalBeliefs ?? 0;
    totalKnowledge += intel.pheromoneStats?.totalTrails ?? 0;
  }
  if (knowledgeEl) knowledgeEl.textContent = String(totalKnowledge);

  if (rateEl) rateEl.textContent = snapshot.rates.compoundRate.toFixed(1);
}

// --- WebSocket ---

function connectWebSocket(): void {
  const token = getToken();
  if (!token) {
    console.warn('[compound] WebSocket skipped: no auth token available');
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    reconnectAttempts = 0;
    // Authenticate
    ws?.send(JSON.stringify({ type: 'auth', token }));
    setConnectionStatus('connected');
  };

  ws.onmessage = (event) => {
    let data: WSEvent;
    try {
      data = JSON.parse(event.data);
    } catch (parseErr) {
      console.warn('[compound] WebSocket JSON parse error:', parseErr);
      return;
    }

    try {
      handleWSEvent(data);

      // Knowledge flow animation on blackboard messages
      if (data.type === 'blackboard_message' || data.type === 'blackboard:message') {
        const bbEvent = data as WSBlackboardEvent;
        animateKnowledgeFlow(
          bbEvent.message.senderHandle,
          bbEvent.message.targetHandle
        );
      }
    } catch (handlerErr) {
      console.error('[compound] WebSocket handler error:', handlerErr);
    }
  };

  ws.onclose = () => {
    setConnectionStatus('disconnected');
    scheduleReconnect();
  };

  ws.onerror = () => {
    setConnectionStatus('disconnected');
  };
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT) {
    addActivity('error', 'Max reconnect attempts reached');
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  setTimeout(connectWebSocket, delay);
}

function setConnectionStatus(status: 'connected' | 'connecting' | 'disconnected'): void {
  const dot = document.getElementById('connection-dot');
  if (!dot) return;

  dot.className = 'dot';
  if (status === 'disconnected') dot.classList.add('disconnected');
  if (status === 'connecting') dot.classList.add('connecting');
}

// --- Cleanup ---

window.addEventListener('beforeunload', () => {
  if (pollTimer) clearInterval(pollTimer);
  ws?.close();
  destroyGraph();
  destroyMetrics();
  destroyLineage();
});

// --- Start ---

document.addEventListener('DOMContentLoaded', boot);
