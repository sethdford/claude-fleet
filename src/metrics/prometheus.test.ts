/**
 * Tests for Prometheus Metrics Exporter
 *
 * Mocks prom-client and native-metrics to test middleware,
 * metric handler, gauge updates, and path normalization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

const {
  mockInc,
  mockObserve,
  mockSet,
  mockEnd,
  mockMetrics,
  mockContentType,
} = vi.hoisted(() => ({
  mockInc: vi.fn(),
  mockObserve: vi.fn(),
  mockSet: vi.fn(),
  mockEnd: vi.fn(),
  mockMetrics: vi.fn().mockResolvedValue('# HELP test_metric\n# TYPE test_metric counter'),
  mockContentType: 'text/plain; version=0.0.4',
}));

vi.mock('prom-client', () => {
  function CounterMock() { return { inc: mockInc }; }
  function HistogramMock() { return { observe: mockObserve }; }
  function GaugeMock() { return { set: mockSet }; }
  function RegistryMock() {
    return { contentType: mockContentType, metrics: mockMetrics };
  }

  return {
    Registry: RegistryMock,
    Counter: CounterMock,
    Histogram: HistogramMock,
    Gauge: GaugeMock,
    collectDefaultMetrics: vi.fn(),
  };
});

vi.mock('./native-metrics.js', () => ({
  createNativeMetricsEngine: vi.fn().mockReturnValue({
    createHistogram: vi.fn(),
    observeHistogram: vi.fn(),
    getHistogramPercentiles: vi.fn(),
    createCounter: vi.fn(),
    incrementCounter: vi.fn(),
    getCounterRate: vi.fn(),
    getSnapshot: vi.fn(),
    downsample: vi.fn(),
  }),
}));

import {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  workersTotal,
  workersHealthy,
  workersByState,
  workerRestarts,
  workerSpawns,
  workerDismissals,
  tasksTotal,
  tasksByStatus,
  tasksCreated,
  tasksCompleted,
  messagesTotal,
  messagesSent,
  broadcastsSent,
  agentsTotal,
  agentAuthentications,
  workItemsTotal,
  workItemsByStatus,
  errorsTotal,
  authFailures,
  wsConnections,
  wsMessagesReceived,
  wsMessagesSent,
  nativeMetrics,
  metricsMiddleware,
  metricsHandler,
  updateGauges,
} from './prometheus.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockReq(overrides: Partial<{ method: string; path: string }> = {}) {
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/health',
  } as never;
}

function createMockRes(statusCode = 200) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    statusCode,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      listeners.set(event, fn);
    }),
    set: vi.fn(),
    end: mockEnd,
    status: vi.fn().mockReturnThis(),
    // Helper to trigger events
    _trigger(event: string) {
      const fn = listeners.get(event);
      if (fn) fn();
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Metric Exports
// ============================================================================

describe('metric exports', () => {
  it('should export the registry', () => {
    expect(register).toBeDefined();
  });

  it('should export HTTP metrics', () => {
    expect(httpRequestsTotal).toBeDefined();
    expect(httpRequestDuration).toBeDefined();
  });

  it('should export worker metrics', () => {
    expect(workersTotal).toBeDefined();
    expect(workersHealthy).toBeDefined();
    expect(workersByState).toBeDefined();
    expect(workerRestarts).toBeDefined();
    expect(workerSpawns).toBeDefined();
    expect(workerDismissals).toBeDefined();
  });

  it('should export task metrics', () => {
    expect(tasksTotal).toBeDefined();
    expect(tasksByStatus).toBeDefined();
    expect(tasksCreated).toBeDefined();
    expect(tasksCompleted).toBeDefined();
  });

  it('should export message metrics', () => {
    expect(messagesTotal).toBeDefined();
    expect(messagesSent).toBeDefined();
    expect(broadcastsSent).toBeDefined();
  });

  it('should export agent metrics', () => {
    expect(agentsTotal).toBeDefined();
    expect(agentAuthentications).toBeDefined();
  });

  it('should export work item metrics', () => {
    expect(workItemsTotal).toBeDefined();
    expect(workItemsByStatus).toBeDefined();
  });

  it('should export error metrics', () => {
    expect(errorsTotal).toBeDefined();
    expect(authFailures).toBeDefined();
  });

  it('should export websocket metrics', () => {
    expect(wsConnections).toBeDefined();
    expect(wsMessagesReceived).toBeDefined();
    expect(wsMessagesSent).toBeDefined();
  });

  it('should export native metrics engine', () => {
    expect(nativeMetrics).toBeDefined();
    expect(nativeMetrics.createHistogram).toBeDefined();
    expect(nativeMetrics.observeHistogram).toBeDefined();
    expect(nativeMetrics.incrementCounter).toBeDefined();
  });
});

// ============================================================================
// metricsMiddleware
// ============================================================================

describe('metricsMiddleware', () => {
  it('should call next immediately', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should register a finish listener on response', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('should increment httpRequestsTotal on finish', () => {
    const req = createMockReq({ method: 'POST', path: '/tasks' });
    const res = createMockRes(201);
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    res._trigger('finish');

    expect(mockInc).toHaveBeenCalledWith({
      method: 'POST',
      path: '/tasks',
      status: '201',
    });
  });

  it('should observe httpRequestDuration on finish', () => {
    const req = createMockReq({ method: 'GET', path: '/health' });
    const res = createMockRes(200);
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    res._trigger('finish');

    expect(mockObserve).toHaveBeenCalledWith(
      { method: 'GET', path: '/health', status: '200' },
      expect.any(Number),
    );
  });

  it('should record in native metrics engine on finish', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    res._trigger('finish');

    expect(nativeMetrics.observeHistogram).toHaveBeenCalledWith(
      'http_request_duration_native',
      expect.any(Number),
    );
    expect(nativeMetrics.incrementCounter).toHaveBeenCalledWith(
      'http_requests_native',
    );
  });

  it('should normalize UUID paths', () => {
    const req = createMockReq({
      path: '/tasks/550e8400-e29b-41d4-a716-446655440000/status',
    });
    const res = createMockRes();
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    res._trigger('finish');

    expect(mockInc).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tasks/:id/status' }),
    );
  });

  it('should normalize hex ID paths', () => {
    const req = createMockReq({
      path: '/workers/a1b2c3d4e5f6a7b8c9d0/output',
    });
    const res = createMockRes();
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    res._trigger('finish');

    expect(mockInc).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workers/:id/output' }),
    );
  });

  it('should normalize work item ID paths', () => {
    const req = createMockReq({
      path: '/workitems/wi-abc12',
    });
    const res = createMockRes();
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    res._trigger('finish');

    expect(mockInc).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workitems/:id' }),
    );
  });

  it('should normalize batch ID paths', () => {
    const req = createMockReq({
      path: '/batches/batch-xyz99',
    });
    const res = createMockRes();
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    res._trigger('finish');

    expect(mockInc).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/batches/:id' }),
    );
  });

  it('should not normalize short non-ID paths', () => {
    const req = createMockReq({ path: '/health' });
    const res = createMockRes();
    const next = vi.fn();

    metricsMiddleware(req, res as never, next);
    res._trigger('finish');

    expect(mockInc).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/health' }),
    );
  });
});

// ============================================================================
// metricsHandler
// ============================================================================

describe('metricsHandler', () => {
  it('should set content type from registry', async () => {
    const req = createMockReq();
    const res = createMockRes();

    await metricsHandler(req, res as never);

    expect(res.set).toHaveBeenCalledWith('Content-Type', mockContentType);
  });

  it('should return metrics from registry', async () => {
    const req = createMockReq();
    const res = createMockRes();

    await metricsHandler(req, res as never);

    expect(mockEnd).toHaveBeenCalledWith(
      '# HELP test_metric\n# TYPE test_metric counter',
    );
  });

  it('should return 500 on error', async () => {
    mockMetrics.mockRejectedValueOnce(new Error('Registry error'));

    const req = createMockReq();
    const res = createMockRes();

    await metricsHandler(req, res as never);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockEnd).toHaveBeenCalledWith('Registry error');
  });
});

// ============================================================================
// updateGauges
// ============================================================================

describe('updateGauges', () => {
  it('should set worker gauges', () => {
    updateGauges({
      workers: {
        total: 5,
        healthy: 4,
        byState: { running: 3, idle: 1 },
      },
      tasks: {
        total: 10,
        byStatus: { open: 5, resolved: 5 },
      },
      agents: 3,
      messages: 42,
    });

    // workersTotal.set, workersHealthy.set, workersByState.set x2,
    // tasksTotal.set, tasksByStatus.set x2, agentsTotal.set, messagesTotal.set
    expect(mockSet).toHaveBeenCalledWith(5); // workersTotal
    expect(mockSet).toHaveBeenCalledWith(4); // workersHealthy
    expect(mockSet).toHaveBeenCalledWith({ state: 'running' }, 3);
    expect(mockSet).toHaveBeenCalledWith({ state: 'idle' }, 1);
    expect(mockSet).toHaveBeenCalledWith(10); // tasksTotal
    expect(mockSet).toHaveBeenCalledWith({ status: 'open' }, 5);
    expect(mockSet).toHaveBeenCalledWith({ status: 'resolved' }, 5);
    expect(mockSet).toHaveBeenCalledWith(3); // agentsTotal
    expect(mockSet).toHaveBeenCalledWith(42); // messagesTotal
  });

  it('should set work item gauges when provided', () => {
    updateGauges({
      workers: { total: 0, healthy: 0, byState: {} },
      tasks: { total: 0, byStatus: {} },
      agents: 0,
      messages: 0,
      workItems: {
        total: 8,
        byStatus: { pending: 3, active: 5 },
      },
    });

    expect(mockSet).toHaveBeenCalledWith(8); // workItemsTotal
    expect(mockSet).toHaveBeenCalledWith({ status: 'pending' }, 3);
    expect(mockSet).toHaveBeenCalledWith({ status: 'active' }, 5);
  });

  it('should not set work item gauges when not provided', () => {
    mockSet.mockClear();

    updateGauges({
      workers: { total: 1, healthy: 1, byState: {} },
      tasks: { total: 0, byStatus: {} },
      agents: 0,
      messages: 0,
    });

    // Should have called set for: workersTotal, workersHealthy, tasksTotal,
    // agentsTotal, messagesTotal = 5 calls (no workItems)
    expect(mockSet).toHaveBeenCalledTimes(5);
  });

  it('should handle empty byState and byStatus', () => {
    updateGauges({
      workers: { total: 0, healthy: 0, byState: {} },
      tasks: { total: 0, byStatus: {} },
      agents: 0,
      messages: 0,
    });

    // Should not throw — iterates empty objects
    expect(mockSet).toHaveBeenCalled();
  });
});
