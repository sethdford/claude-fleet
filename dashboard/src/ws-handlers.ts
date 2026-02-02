/**
 * WebSocket Event Handlers
 * Processes real-time events from the fleet server and updates store state.
 * Extracted from main.ts to keep files under 500 lines.
 */

import store from '@/store';
import wsManager from '@/websocket';
import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import type { ActivityType } from '@/types';

// ---------------------------------------------------------------------------
// parseClaudeEvent — turns a stream-json event into an activity entry
// ---------------------------------------------------------------------------

interface ParsedEvent {
  title: string;
  preview: string | null;
  activityType: ActivityType;
}

export function parseClaudeEvent(output: unknown, handle: string): ParsedEvent {
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
// WebSocket event handlers
// ---------------------------------------------------------------------------

export function setupWebSocketHandlers(
  updateSidebarLists: () => void,
  refreshAll: () => Promise<void>,
): void {
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

  wsManager.on('reconnect:failed', () => {
    toast.warning('Lost connection to server. Real-time updates are paused. Try refreshing the page.');
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
