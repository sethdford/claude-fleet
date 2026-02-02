/**
 * Tests for scheduler route handlers
 *
 * Covers all endpoints on the scheduler Router:
 * - Scheduler status and control (start/stop)
 * - Schedules CRUD (list, create, delete, enable, disable, load-defaults)
 * - Queue management (list, queue task, cancel task)
 * - Templates (list, get, execute, register)
 * - Notifications (configure, test, enable, disable)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';

// ── Hoisted mocks for singleton services ──────────────────────────────────

const { mockScheduler, mockTemplateEngine, mockNotifications } = vi.hoisted(() => ({
  mockScheduler: {
    getInstance: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ isRunning: false, uptime: 100 }),
    start: vi.fn(),
    stop: vi.fn(),
    getSchedules: vi.fn().mockReturnValue([]),
    registerSchedule: vi.fn().mockReturnValue('sched-1'),
    unregisterSchedule: vi.fn().mockReturnValue(true),
    setScheduleEnabled: vi.fn().mockReturnValue(true),
    loadSchedulesFromConfig: vi.fn(),
    getQueue: vi.fn().mockReturnValue([]),
    getRunning: vi.fn().mockReturnValue([]),
    queueTask: vi.fn().mockResolvedValue('task-1'),
    cancelTask: vi.fn().mockReturnValue(true),
    getRecentWebhookTasks: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
  },
  mockTemplateEngine: {
    getInstance: vi.fn(),
    getAllTemplates: vi.fn().mockReturnValue([]),
    getTemplatesByCategory: vi.fn().mockReturnValue([]),
    getTemplate: vi.fn().mockReturnValue(null),
    executeTemplate: vi.fn().mockResolvedValue({ success: true }),
    registerTemplate: vi.fn(),
  },
  mockNotifications: {
    getInstance: vi.fn(),
    notifyTaskStarted: vi.fn(),
    notifyTaskCompleted: vi.fn(),
    notifyTaskFailed: vi.fn(),
    configure: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn(),
  },
}));

vi.mock('../scheduler/auto-scheduler.js', () => ({
  AutoScheduler: {
    getInstance: () => mockScheduler,
  },
  DEFAULT_SCHEDULES: [{ name: 'default', cron: '0 0 * * *', tasks: ['test'] }],
}));

vi.mock('../scheduler/templates.js', () => ({
  TaskTemplateEngine: {
    getInstance: () => mockTemplateEngine,
  },
}));

vi.mock('../scheduler/notifications.js', () => ({
  NotificationService: {
    getInstance: () => mockNotifications,
  },
}));

// ── Import the router under test (picks up mocks) ────────────────────────

import schedulerRouter from './scheduler.js';

// ── Capture event listener callbacks registered at module load time ────────
// The module-level code calls scheduler.on('taskStarted', ...) etc. during
// import. We capture these before beforeEach clears mock call history.

type EventCallback = (task: Record<string, unknown>) => void;
const eventCallbacks: Record<string, EventCallback> = {};

for (const call of (mockScheduler.on as ReturnType<typeof vi.fn>).mock.calls) {
  const [eventName, callback] = call as [string, EventCallback];
  eventCallbacks[eventName] = callback;
}

// ── Helper to extract route handlers from Express Router ──────────────────

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response) => void | Promise<void> }>;
  };
}

function getHandler(method: string, path: string): ((req: Request, res: Response) => void | Promise<void>) {
  const layer = (schedulerRouter.stack as RouteLayer[]).find(
    (l) => l.route?.path === path && l.route?.methods[method]
  );
  const handle = layer?.route?.stack[0]?.handle;
  if (!handle) {
    throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
  }
  return handle;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Scheduler Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.log during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset mock return values to defaults
    mockScheduler.getStatus.mockReturnValue({ isRunning: false, uptime: 100 });
    mockScheduler.getSchedules.mockReturnValue([]);
    mockScheduler.registerSchedule.mockReturnValue('sched-1');
    mockScheduler.unregisterSchedule.mockReturnValue(true);
    mockScheduler.setScheduleEnabled.mockReturnValue(true);
    mockScheduler.getQueue.mockReturnValue([]);
    mockScheduler.getRunning.mockReturnValue([]);
    mockScheduler.queueTask.mockResolvedValue('task-1');
    mockScheduler.cancelTask.mockReturnValue(true);
    mockTemplateEngine.getAllTemplates.mockReturnValue([]);
    mockTemplateEngine.getTemplatesByCategory.mockReturnValue([]);
    mockTemplateEngine.getTemplate.mockReturnValue(null);
    mockTemplateEngine.executeTemplate.mockResolvedValue({ success: true });
    mockNotifications.send.mockResolvedValue(undefined);
  });

  // ════════════════════════════════════════════════════════════════════════
  // SCHEDULER STATUS & CONTROL
  // ════════════════════════════════════════════════════════════════════════

  describe('GET /status', () => {
    it('should return scheduler status with uptime and timestamp', () => {
      const handler = getHandler('get', '/status');
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.getStatus).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body).toHaveProperty('isRunning', false);
      expect(body).toHaveProperty('uptime');
      expect(typeof body.uptime).toBe('number');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.timestamp).toBe('string');
    });
  });

  describe('POST /start', () => {
    it('should start the scheduler and return status', () => {
      const handler = getHandler('post', '/start');
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.start).toHaveBeenCalled();
      expect(mockScheduler.getStatus).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Scheduler started');
      expect(body).toHaveProperty('status');
    });
  });

  describe('POST /stop', () => {
    it('should stop the scheduler and return status', () => {
      const handler = getHandler('post', '/stop');
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.stop).toHaveBeenCalled();
      expect(mockScheduler.getStatus).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Scheduler stopped');
      expect(body).toHaveProperty('status');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SCHEDULES MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════

  describe('GET /schedules', () => {
    it('should return list of schedules', () => {
      const fakeSchedules = [
        { id: 's1', name: 'nightly', cron: '0 0 * * *', tasks: ['lint'] },
      ];
      mockScheduler.getSchedules.mockReturnValue(fakeSchedules);

      const handler = getHandler('get', '/schedules');
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.getSchedules).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(fakeSchedules);
    });
  });

  describe('POST /schedules', () => {
    it('should register a new schedule with valid data', () => {
      const handler = getHandler('post', '/schedules');
      const req = createMockReq({
        body: { name: 'daily-lint', cron: '0 6 * * *', tasks: ['lint', 'test'] },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.registerSchedule).toHaveBeenCalledWith({
        name: 'daily-lint',
        cron: '0 6 * * *',
        tasks: ['lint', 'test'],
        repository: undefined,
        enabled: true,
      });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return 400 when name is missing', () => {
      const handler = getHandler('post', '/schedules');
      const req = createMockReq({
        body: { cron: '0 6 * * *', tasks: ['lint'] },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockScheduler.registerSchedule).not.toHaveBeenCalled();
    });

    it('should return 400 when cron is missing', () => {
      const handler = getHandler('post', '/schedules');
      const req = createMockReq({
        body: { name: 'test', tasks: ['lint'] },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when tasks is not an array', () => {
      const handler = getHandler('post', '/schedules');
      const req = createMockReq({
        body: { name: 'test', cron: '0 0 * * *', tasks: 'not-an-array' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('DELETE /schedules/:id', () => {
    it('should remove a schedule that exists', () => {
      mockScheduler.unregisterSchedule.mockReturnValue(true);

      const handler = getHandler('delete', '/schedules/:id');
      const req = createMockReq({ params: { id: 'sched-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.unregisterSchedule).toHaveBeenCalledWith('sched-1');
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Schedule removed');
    });

    it('should return 404 when schedule not found', () => {
      mockScheduler.unregisterSchedule.mockReturnValue(false);

      const handler = getHandler('delete', '/schedules/:id');
      const req = createMockReq({ params: { id: 'no-exist' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('PATCH /schedules/:id/enable', () => {
    it('should enable a schedule that exists', () => {
      mockScheduler.setScheduleEnabled.mockReturnValue(true);

      const handler = getHandler('patch', '/schedules/:id/enable');
      const req = createMockReq({ params: { id: 'sched-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.setScheduleEnabled).toHaveBeenCalledWith('sched-1', true);
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Schedule enabled');
    });

    it('should return 404 when schedule not found', () => {
      mockScheduler.setScheduleEnabled.mockReturnValue(false);

      const handler = getHandler('patch', '/schedules/:id/enable');
      const req = createMockReq({ params: { id: 'no-exist' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('PATCH /schedules/:id/disable', () => {
    it('should disable a schedule that exists', () => {
      mockScheduler.setScheduleEnabled.mockReturnValue(true);

      const handler = getHandler('patch', '/schedules/:id/disable');
      const req = createMockReq({ params: { id: 'sched-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.setScheduleEnabled).toHaveBeenCalledWith('sched-1', false);
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Schedule disabled');
    });

    it('should return 404 when schedule not found', () => {
      mockScheduler.setScheduleEnabled.mockReturnValue(false);

      const handler = getHandler('patch', '/schedules/:id/disable');
      const req = createMockReq({ params: { id: 'no-exist' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('POST /schedules/load-defaults', () => {
    it('should load default schedules and return count', () => {
      const handler = getHandler('post', '/schedules/load-defaults');
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.loadSchedulesFromConfig).toHaveBeenCalledWith({
        schedules: [{ name: 'default', cron: '0 0 * * *', tasks: ['test'] }],
      });
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Default schedules loaded');
      expect(body.count).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // QUEUE MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════

  describe('GET /queue', () => {
    it('should return queued and running tasks with counts', () => {
      const queued = [{ id: 'q1', name: 'lint' }];
      const running = [{ id: 'r1', name: 'test' }];
      mockScheduler.getQueue.mockReturnValue(queued);
      mockScheduler.getRunning.mockReturnValue(running);

      const handler = getHandler('get', '/queue');
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.queued).toEqual(queued);
      expect(body.running).toEqual(running);
      expect(body.counts).toEqual({ queued: 1, running: 1 });
    });
  });

  describe('POST /queue', () => {
    it('should queue a task with valid data', async () => {
      const handler = getHandler('post', '/queue');
      const req = createMockReq({
        body: { name: 'lint', repository: 'my-repo', priority: 'high' },
      });
      const res = createMockRes();

      await handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.queueTask).toHaveBeenCalledWith({
        name: 'lint',
        trigger: 'manual',
        repository: 'my-repo',
        priority: 'high',
        payload: undefined,
      });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return 400 when name is missing', async () => {
      const handler = getHandler('post', '/queue');
      const req = createMockReq({ body: {} });
      const res = createMockRes();

      await handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockScheduler.queueTask).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /queue/:taskId', () => {
    it('should cancel a queued task', () => {
      mockScheduler.cancelTask.mockReturnValue(true);

      const handler = getHandler('delete', '/queue/:taskId');
      const req = createMockReq({ params: { taskId: 'task-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockScheduler.cancelTask).toHaveBeenCalledWith('task-1');
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Task cancelled');
    });

    it('should return 404 when task not found or already running', () => {
      mockScheduler.cancelTask.mockReturnValue(false);

      const handler = getHandler('delete', '/queue/:taskId');
      const req = createMockReq({ params: { taskId: 'no-exist' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ════════════════════════════════════════════════════════════════════════

  describe('GET /templates', () => {
    const fakeTemplate = {
      id: 'tpl-1',
      name: 'Lint Check',
      description: 'Run linting',
      category: 'maintenance',
      role: 'worker',
      estimatedMinutes: 5,
      outputFormat: 'text',
      requiredContext: [],
      prompt: 'Run lint checks',
    };

    it('should return all templates', () => {
      mockTemplateEngine.getAllTemplates.mockReturnValue([fakeTemplate]);

      const handler = getHandler('get', '/templates');
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockTemplateEngine.getAllTemplates).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('tpl-1');
      // Should not include the prompt field in list view
      expect(body[0]).not.toHaveProperty('prompt');
    });

    it('should filter templates by category', () => {
      mockTemplateEngine.getTemplatesByCategory.mockReturnValue([fakeTemplate]);

      const handler = getHandler('get', '/templates');
      const req = createMockReq({ query: { category: 'maintenance' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockTemplateEngine.getTemplatesByCategory).toHaveBeenCalledWith('maintenance');
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe('GET /templates/:id', () => {
    it('should return a template when found', () => {
      const template = { id: 'tpl-1', name: 'Test', prompt: 'test prompt' };
      mockTemplateEngine.getTemplate.mockReturnValue(template);

      const handler = getHandler('get', '/templates/:id');
      const req = createMockReq({ params: { id: 'tpl-1' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockTemplateEngine.getTemplate).toHaveBeenCalledWith('tpl-1');
      expect(res.json).toHaveBeenCalledWith(template);
    });

    it('should return 404 when template not found', () => {
      mockTemplateEngine.getTemplate.mockReturnValue(null);

      const handler = getHandler('get', '/templates/:id');
      const req = createMockReq({ params: { id: 'no-exist' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('POST /templates/:id/execute', () => {
    it('should execute a template with valid data', async () => {
      const template = { id: 'tpl-1', name: 'Test', requiredContext: undefined };
      mockTemplateEngine.getTemplate.mockReturnValue(template);

      const handler = getHandler('post', '/templates/:id/execute');
      const req = createMockReq({
        params: { id: 'tpl-1' },
        body: { repository: 'my-repo', branch: 'main' },
      });
      const res = createMockRes();

      await handler(req as unknown as Request, res as unknown as Response);

      expect(mockTemplateEngine.executeTemplate).toHaveBeenCalledWith('tpl-1', {
        repository: 'my-repo',
        branch: 'main',
        prNumber: undefined,
        issueNumber: undefined,
        files: undefined,
        labels: undefined,
      });
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('should return 400 when repository is missing', async () => {
      const handler = getHandler('post', '/templates/:id/execute');
      const req = createMockReq({
        params: { id: 'tpl-1' },
        body: {},
      });
      const res = createMockRes();

      await handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTemplateEngine.executeTemplate).not.toHaveBeenCalled();
    });

    it('should return 404 when template not found', async () => {
      mockTemplateEngine.getTemplate.mockReturnValue(null);

      const handler = getHandler('post', '/templates/:id/execute');
      const req = createMockReq({
        params: { id: 'no-exist' },
        body: { repository: 'my-repo' },
      });
      const res = createMockRes();

      await handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when required context is missing', async () => {
      const template = {
        id: 'tpl-pr',
        name: 'PR Review',
        requiredContext: ['prNumber', 'files'],
      };
      mockTemplateEngine.getTemplate.mockReturnValue(template);

      const handler = getHandler('post', '/templates/:id/execute');
      const req = createMockReq({
        params: { id: 'tpl-pr' },
        body: { repository: 'my-repo' },
      });
      const res = createMockRes();

      await handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTemplateEngine.executeTemplate).not.toHaveBeenCalled();
    });
  });

  describe('POST /templates', () => {
    it('should register a custom template with valid data', () => {
      const handler = getHandler('post', '/templates');
      const req = createMockReq({
        body: {
          id: 'custom-1',
          name: 'Custom Lint',
          description: 'Run custom lint',
          category: 'maintenance',
          role: 'worker',
          prompt: 'Run custom lint checks',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockTemplateEngine.registerTemplate).toHaveBeenCalledWith(req.body);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return 400 when required fields are missing', () => {
      const handler = getHandler('post', '/templates');
      const req = createMockReq({
        body: { id: 'custom-1', name: 'Custom Lint' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTemplateEngine.registerTemplate).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ════════════════════════════════════════════════════════════════════════

  describe('POST /notifications/configure', () => {
    it('should configure notification channels', () => {
      const handler = getHandler('post', '/notifications/configure');
      const req = createMockReq({
        body: { slack: { webhookUrl: 'https://hooks.slack.com/test' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockNotifications.configure).toHaveBeenCalledWith({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
        teams: undefined,
        discord: undefined,
      });
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Notifications configured');
    });
  });

  describe('POST /notifications/test', () => {
    it('should send a test notification', async () => {
      const handler = getHandler('post', '/notifications/test');
      const req = createMockReq();
      const res = createMockRes();

      await handler(req as unknown as Request, res as unknown as Response);

      expect(mockNotifications.send).toHaveBeenCalled();
      const sendArg = (mockNotifications.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sendArg.type).toBe('task_completed');
      expect(sendArg.title).toBe('Test Notification');
      expect(sendArg.severity).toBe('info');
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Test notification sent');
    });
  });

  describe('POST /notifications/enable', () => {
    it('should enable notifications', () => {
      const handler = getHandler('post', '/notifications/enable');
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockNotifications.setEnabled).toHaveBeenCalledWith(true);
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Notifications enabled');
    });
  });

  describe('POST /notifications/disable', () => {
    it('should disable notifications', () => {
      const handler = getHandler('post', '/notifications/disable');
      const req = createMockReq();
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(mockNotifications.setEnabled).toHaveBeenCalledWith(false);
      expect(res.json).toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Notifications disabled');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // EVENT LISTENER WIRING
  // ════════════════════════════════════════════════════════════════════════

  describe('event listener wiring', () => {
    it('should register taskStarted, taskCompleted, and taskFailed listeners', () => {
      expect(eventCallbacks).toHaveProperty('taskStarted');
      expect(eventCallbacks).toHaveProperty('taskCompleted');
      expect(eventCallbacks).toHaveProperty('taskFailed');
    });

    it('should call notifyTaskStarted on taskStarted event', () => {
      eventCallbacks['taskStarted']({ name: 'lint', repository: 'my-repo', id: 'task-1' });

      expect(mockNotifications.notifyTaskStarted).toHaveBeenCalledWith('lint', 'my-repo', 'task-1');
    });

    it('should call notifyTaskCompleted on taskCompleted event', () => {
      const startedAt = new Date('2025-01-01T00:00:00Z');
      const completedAt = new Date('2025-01-01T00:05:00Z');
      eventCallbacks['taskCompleted']({
        name: 'lint',
        repository: 'my-repo',
        id: 'task-1',
        startedAt,
        completedAt,
      });

      expect(mockNotifications.notifyTaskCompleted).toHaveBeenCalledWith(
        'lint',
        { duration: completedAt.getTime() - startedAt.getTime() },
        'my-repo',
        'task-1',
      );
    });

    it('should call notifyTaskFailed on taskFailed event', () => {
      eventCallbacks['taskFailed']({
        name: 'lint',
        error: 'Process exited with code 1',
        repository: 'my-repo',
        id: 'task-1',
      });

      expect(mockNotifications.notifyTaskFailed).toHaveBeenCalledWith(
        'lint',
        'Process exited with code 1',
        'my-repo',
        'task-1',
      );
    });

    it('should use fallback error message when error is missing', () => {
      eventCallbacks['taskFailed']({ name: 'lint', repository: 'my-repo', id: 'task-2' });

      expect(mockNotifications.notifyTaskFailed).toHaveBeenCalledWith(
        'lint',
        'Unknown error',
        'my-repo',
        'task-2',
      );
    });
  });
});
