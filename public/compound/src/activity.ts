// Compounding Machine - Live Activity Feed

import type { ActivityItem, ActivityType, WSEvent, WSWorkerEvent, WSBlackboardEvent, WSTaskEvent } from './types';

const MAX_ACTIVITIES = 200;

let activities: ActivityItem[] = [];
let activityCounter = 0;

const TYPE_COLORS: Record<ActivityType, string> = {
  spawn: '#3fb950',
  dismiss: '#f85149',
  output: '#8b949e',
  knowledge: '#58a6ff',
  task: '#d29922',
  swarm: '#a371f7',
  error: '#f85149',
};

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export function addActivity(type: ActivityType, title: string, detail?: string, nodeId?: string): void {
  const item: ActivityItem = {
    id: `act-${++activityCounter}`,
    timestamp: Date.now(),
    type,
    title,
    detail,
    nodeId,
  };

  activities.unshift(item);
  if (activities.length > MAX_ACTIVITIES) {
    activities = activities.slice(0, MAX_ACTIVITIES);
  }

  renderActivity();
}

export function handleWSEvent(event: WSEvent): void {
  switch (event.type) {
    case 'worker_spawned':
    case 'worker:spawned': {
      const e = event as WSWorkerEvent;
      addActivity('spawn', `Agent spawned: ${e.handle}`, undefined, `worker-${e.handle}`);
      break;
    }
    case 'worker_dismissed':
    case 'worker:dismissed': {
      const e = event as WSWorkerEvent;
      addActivity('dismiss', `Agent dismissed: ${e.handle}`, undefined, `worker-${e.handle}`);
      break;
    }
    case 'worker_output':
    case 'worker:output': {
      const e = event as WSWorkerEvent & { output?: string };
      const preview = typeof e.output === 'string' ? e.output.slice(0, 100) : '';
      addActivity('output', `Output from ${e.handle}`, preview, `worker-${e.handle}`);
      break;
    }
    case 'blackboard_message':
    case 'blackboard:message': {
      const e = event as WSBlackboardEvent;
      const msg = e.message;
      const target = msg.targetHandle ? ` \u2192 ${msg.targetHandle}` : '';
      addActivity('knowledge', `${msg.senderHandle}${target}`, msg.content?.slice(0, 100));
      break;
    }
    case 'task_assigned':
    case 'task:assigned': {
      const e = event as WSTaskEvent;
      addActivity('task', `Task assigned: ${e.task?.subject ?? e.taskId}`, e.task?.ownerHandle);
      break;
    }
    case 'task_updated':
    case 'task:updated': {
      const e = event as WSTaskEvent;
      addActivity('task', `Task ${e.status}: ${e.taskId.slice(0, 8)}`, e.ownerHandle);
      break;
    }
    case 'swarm_created':
    case 'swarm:created': {
      const e = event as WSEvent & { name?: string; id?: string };
      addActivity('swarm', `Swarm created: ${e.name ?? e.id ?? 'unknown'}`);
      break;
    }
    case 'swarm_killed':
    case 'swarm:killed': {
      const e = event as WSEvent & { swarmId?: string };
      addActivity('swarm', `Swarm killed: ${e.swarmId ?? 'unknown'}`);
      break;
    }
  }
}

function renderActivity(): void {
  const list = document.getElementById('activity-list');
  if (!list) return;

  if (activities.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#9881;</div>
        <div class="empty-state-text">Waiting for fleet activity...</div>
      </div>
    `;
    return;
  }

  list.innerHTML = activities
    .slice(0, 50)
    .map(
      (item) => `
    <div class="activity-entry">
      <span class="activity-time">${formatTime(item.timestamp)}</span>
      <span class="activity-dot" style="background: ${TYPE_COLORS[item.type] ?? '#8b949e'}"></span>
      <span class="activity-text">${escapeHtml(item.title)}${
        item.detail ? `<span class="activity-detail">${escapeHtml(item.detail)}</span>` : ''
      }</span>
    </div>
  `
    )
    .join('');

  // Update badge
  const badge = document.getElementById('activity-badge');
  if (badge) badge.textContent = `${activities.length} events`;
}

export function getActivityCount(): number {
  return activities.length;
}
