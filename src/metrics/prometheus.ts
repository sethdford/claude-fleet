/**
 * Prometheus Metrics Exporter
 *
 * Provides application metrics in Prometheus format for monitoring.
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

// Create a new registry
export const register = new Registry();

// Add default metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register });

// ============================================================================
// HTTP METRICS
// ============================================================================

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// ============================================================================
// WORKER METRICS
// ============================================================================

export const workersTotal = new Gauge({
  name: 'collab_workers_total',
  help: 'Total number of workers',
  registers: [register],
});

export const workersHealthy = new Gauge({
  name: 'collab_workers_healthy',
  help: 'Number of healthy workers',
  registers: [register],
});

export const workersByState = new Gauge({
  name: 'collab_workers_by_state',
  help: 'Number of workers by state',
  labelNames: ['state'],
  registers: [register],
});

export const workerRestarts = new Counter({
  name: 'collab_worker_restarts_total',
  help: 'Total number of worker restarts',
  registers: [register],
});

export const workerSpawns = new Counter({
  name: 'collab_worker_spawns_total',
  help: 'Total number of worker spawns',
  registers: [register],
});

export const workerDismissals = new Counter({
  name: 'collab_worker_dismissals_total',
  help: 'Total number of worker dismissals',
  registers: [register],
});

// ============================================================================
// TASK METRICS
// ============================================================================

export const tasksTotal = new Gauge({
  name: 'collab_tasks_total',
  help: 'Total number of tasks',
  registers: [register],
});

export const tasksByStatus = new Gauge({
  name: 'collab_tasks_by_status',
  help: 'Number of tasks by status',
  labelNames: ['status'],
  registers: [register],
});

export const tasksCreated = new Counter({
  name: 'collab_tasks_created_total',
  help: 'Total number of tasks created',
  registers: [register],
});

export const tasksCompleted = new Counter({
  name: 'collab_tasks_completed_total',
  help: 'Total number of tasks completed',
  registers: [register],
});

// ============================================================================
// MESSAGE METRICS
// ============================================================================

export const messagesTotal = new Gauge({
  name: 'collab_messages_total',
  help: 'Total number of messages',
  registers: [register],
});

export const messagesSent = new Counter({
  name: 'collab_messages_sent_total',
  help: 'Total number of messages sent',
  registers: [register],
});

export const broadcastsSent = new Counter({
  name: 'collab_broadcasts_sent_total',
  help: 'Total number of broadcasts sent',
  registers: [register],
});

// ============================================================================
// AGENT METRICS
// ============================================================================

export const agentsTotal = new Gauge({
  name: 'collab_agents_total',
  help: 'Total number of registered agents',
  registers: [register],
});

export const agentAuthentications = new Counter({
  name: 'collab_agent_authentications_total',
  help: 'Total number of agent authentications',
  registers: [register],
});

// ============================================================================
// WORK ITEM METRICS
// ============================================================================

export const workItemsTotal = new Gauge({
  name: 'collab_workitems_total',
  help: 'Total number of work items',
  registers: [register],
});

export const workItemsByStatus = new Gauge({
  name: 'collab_workitems_by_status',
  help: 'Number of work items by status',
  labelNames: ['status'],
  registers: [register],
});

// ============================================================================
// ERROR METRICS
// ============================================================================

export const errorsTotal = new Counter({
  name: 'collab_errors_total',
  help: 'Total number of errors',
  labelNames: ['type'],
  registers: [register],
});

export const authFailures = new Counter({
  name: 'collab_auth_failures_total',
  help: 'Total number of authentication failures',
  labelNames: ['reason'],
  registers: [register],
});

// ============================================================================
// WEBSOCKET METRICS
// ============================================================================

export const wsConnections = new Gauge({
  name: 'collab_websocket_connections',
  help: 'Current number of WebSocket connections',
  registers: [register],
});

export const wsMessagesReceived = new Counter({
  name: 'collab_websocket_messages_received_total',
  help: 'Total WebSocket messages received',
  registers: [register],
});

export const wsMessagesSent = new Counter({
  name: 'collab_websocket_messages_sent_total',
  help: 'Total WebSocket messages sent',
  registers: [register],
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Express middleware to track HTTP request metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const path = normalizePath(req.path);

    httpRequestsTotal.inc({
      method: req.method,
      path,
      status: res.statusCode.toString(),
    });

    httpRequestDuration.observe(
      {
        method: req.method,
        path,
        status: res.statusCode.toString(),
      },
      duration
    );
  });

  next();
}

/**
 * Normalize path to prevent high cardinality
 * Replaces dynamic segments like UUIDs with placeholders
 */
function normalizePath(path: string): string {
  return path
    // Replace UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    // Replace hex IDs (16-24 chars)
    .replace(/\/[0-9a-f]{16,24}(\/|$)/gi, '/:id$1')
    // Replace work item IDs (wi-xxxxx)
    .replace(/\/wi-[a-z0-9]{5}(\/|$)/gi, '/:id$1')
    // Replace batch IDs (batch-xxxxx)
    .replace(/\/batch-[a-z0-9]{5}(\/|$)/gi, '/:id$1');
}

/**
 * Handler for /metrics endpoint
 */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end((error as Error).message);
  }
}

/**
 * Update gauge metrics from current state
 */
export function updateGauges(stats: {
  workers: {
    total: number;
    healthy: number;
    byState: Record<string, number>;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
  };
  agents: number;
  messages: number;
  workItems?: {
    total: number;
    byStatus: Record<string, number>;
  };
}): void {
  workersTotal.set(stats.workers.total);
  workersHealthy.set(stats.workers.healthy);

  for (const [state, count] of Object.entries(stats.workers.byState)) {
    workersByState.set({ state }, count);
  }

  tasksTotal.set(stats.tasks.total);
  for (const [status, count] of Object.entries(stats.tasks.byStatus)) {
    tasksByStatus.set({ status }, count);
  }

  agentsTotal.set(stats.agents);
  messagesTotal.set(stats.messages);

  if (stats.workItems) {
    workItemsTotal.set(stats.workItems.total);
    for (const [status, count] of Object.entries(stats.workItems.byStatus)) {
      workItemsByStatus.set({ status }, count);
    }
  }
}
