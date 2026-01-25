/**
 * Scheduler API Routes
 *
 * REST API for managing scheduled tasks, viewing queue status,
 * and triggering autonomous operations manually.
 */

import { Router, Request, Response } from 'express';
import { AutoScheduler, DEFAULT_SCHEDULES } from '../scheduler/auto-scheduler.js';
import { TaskTemplateEngine } from '../scheduler/templates.js';
import { NotificationService } from '../scheduler/notifications.js';

const router = Router();

// Initialize services
const scheduler = AutoScheduler.getInstance();
const templateEngine = TaskTemplateEngine.getInstance();
const notifications = NotificationService.getInstance();

// Wire up notifications
scheduler.on('taskStarted', (task) => {
  notifications.notifyTaskStarted(task.name, task.repository, task.id);
});

scheduler.on('taskCompleted', (task) => {
  notifications.notifyTaskCompleted(
    task.name,
    { duration: task.completedAt?.getTime() - task.startedAt?.getTime() },
    task.repository,
    task.id
  );
});

scheduler.on('taskFailed', (task) => {
  notifications.notifyTaskFailed(task.name, task.error || 'Unknown error', task.repository, task.id);
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULER STATUS & CONTROL
// ═══════════════════════════════════════════════════════════════

/**
 * GET /scheduler/status
 * Get overall scheduler status
 */
router.get('/status', (req: Request, res: Response) => {
  const status = scheduler.getStatus();
  res.json({
    ...status,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /scheduler/start
 * Start the scheduler
 */
router.post('/start', (req: Request, res: Response) => {
  scheduler.start();
  res.json({ message: 'Scheduler started', status: scheduler.getStatus() });
});

/**
 * POST /scheduler/stop
 * Stop the scheduler
 */
router.post('/stop', (req: Request, res: Response) => {
  scheduler.stop();
  res.json({ message: 'Scheduler stopped', status: scheduler.getStatus() });
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULES MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * GET /scheduler/schedules
 * List all registered schedules
 */
router.get('/schedules', (req: Request, res: Response) => {
  const schedules = scheduler.getSchedules();
  res.json(schedules);
});

/**
 * POST /scheduler/schedules
 * Register a new schedule
 */
router.post('/schedules', (req: Request, res: Response): void => {
  const { name, cron, tasks, repository, enabled } = req.body;

  if (!name || !cron || !tasks || !Array.isArray(tasks)) {
    res.status(400).json({
      error: 'Missing required fields: name, cron, tasks (array)'
    });
    return;
  }

  const id = scheduler.registerSchedule({
    name,
    cron,
    tasks,
    repository,
    enabled: enabled ?? true
  });

  res.status(201).json({ id, message: 'Schedule registered' });
});

/**
 * DELETE /scheduler/schedules/:id
 * Remove a schedule
 */
router.delete('/schedules/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const removed = scheduler.unregisterSchedule(id);

  if (removed) {
    res.json({ message: 'Schedule removed' });
  } else {
    res.status(404).json({ error: 'Schedule not found' });
  }
});

/**
 * PATCH /scheduler/schedules/:id/enable
 * Enable a schedule
 */
router.patch('/schedules/:id/enable', (req: Request, res: Response) => {
  const { id } = req.params;
  const updated = scheduler.setScheduleEnabled(id, true);

  if (updated) {
    res.json({ message: 'Schedule enabled' });
  } else {
    res.status(404).json({ error: 'Schedule not found' });
  }
});

/**
 * PATCH /scheduler/schedules/:id/disable
 * Disable a schedule
 */
router.patch('/schedules/:id/disable', (req: Request, res: Response) => {
  const { id } = req.params;
  const updated = scheduler.setScheduleEnabled(id, false);

  if (updated) {
    res.json({ message: 'Schedule disabled' });
  } else {
    res.status(404).json({ error: 'Schedule not found' });
  }
});

/**
 * POST /scheduler/schedules/load-defaults
 * Load default schedules
 */
router.post('/schedules/load-defaults', (req: Request, res: Response) => {
  scheduler.loadSchedulesFromConfig({ schedules: DEFAULT_SCHEDULES });
  res.json({
    message: 'Default schedules loaded',
    count: DEFAULT_SCHEDULES.length
  });
});

// ═══════════════════════════════════════════════════════════════
// QUEUE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * GET /scheduler/queue
 * Get queued tasks
 */
router.get('/queue', (req: Request, res: Response) => {
  const queue = scheduler.getQueue();
  const running = scheduler.getRunning();
  res.json({
    queued: queue,
    running,
    counts: {
      queued: queue.length,
      running: running.length
    }
  });
});

/**
 * POST /scheduler/queue
 * Manually queue a task
 */
router.post('/queue', async (req: Request, res: Response): Promise<void> => {
  const { name, repository, priority, payload } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Missing required field: name' });
    return;
  }

  const taskId = await scheduler.queueTask({
    name,
    trigger: 'manual',
    repository,
    priority: priority || 'normal',
    payload
  });

  res.status(201).json({ taskId, message: 'Task queued' });
});

/**
 * DELETE /scheduler/queue/:taskId
 * Cancel a queued task
 */
router.delete('/queue/:taskId', (req: Request, res: Response) => {
  const { taskId } = req.params;
  const cancelled = scheduler.cancelTask(taskId);

  if (cancelled) {
    res.json({ message: 'Task cancelled' });
  } else {
    res.status(404).json({ error: 'Task not found or already running' });
  }
});

// ═══════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════

/**
 * GET /scheduler/templates
 * List all available templates
 */
router.get('/templates', (req: Request, res: Response) => {
  const { category } = req.query;
  let templates = templateEngine.getAllTemplates();

  if (category && typeof category === 'string') {
    templates = templateEngine.getTemplatesByCategory(
      category as 'documentation' | 'testing' | 'security' | 'maintenance' | 'review' | 'conversion'
    );
  }

  res.json(templates.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    role: t.role,
    estimatedMinutes: t.estimatedMinutes,
    outputFormat: t.outputFormat,
    requiredContext: t.requiredContext
  })));
});

/**
 * GET /scheduler/templates/:id
 * Get a specific template with full details
 */
router.get('/templates/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const template = templateEngine.getTemplate(id);

  if (template) {
    res.json(template);
  } else {
    res.status(404).json({ error: 'Template not found' });
  }
});

/**
 * POST /scheduler/templates/:id/execute
 * Execute a template
 */
router.post('/templates/:id/execute', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { repository, branch, prNumber, issueNumber, files, labels } = req.body;

  if (!repository) {
    res.status(400).json({ error: 'Missing required field: repository' });
    return;
  }

  const template = templateEngine.getTemplate(id);
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }

  // Check required context
  if (template.requiredContext) {
    const missing = template.requiredContext.filter(ctx => {
      switch (ctx) {
        case 'prNumber': return !prNumber;
        case 'files': return !files || files.length === 0;
        default: return false;
      }
    });

    if (missing.length > 0) {
      res.status(400).json({
        error: `Missing required context: ${missing.join(', ')}`
      });
      return;
    }
  }

  const result = await templateEngine.executeTemplate(id, {
    repository,
    branch,
    prNumber,
    issueNumber,
    files,
    labels
  });

  res.json(result);
});

/**
 * POST /scheduler/templates
 * Register a custom template
 */
router.post('/templates', (req: Request, res: Response): void => {
  const template = req.body;

  const requiredFields = ['id', 'name', 'description', 'category', 'role', 'prompt'];
  const missing = requiredFields.filter(f => !template[f]);

  if (missing.length > 0) {
    res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`
    });
    return;
  }

  templateEngine.registerTemplate(template);
  res.status(201).json({ message: 'Template registered', id: template.id });
});

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * POST /scheduler/notifications/configure
 * Configure notification channels
 */
router.post('/notifications/configure', (req: Request, res: Response) => {
  const { slack, teams, discord } = req.body;

  notifications.configure({
    slack,
    teams,
    discord
  });

  res.json({ message: 'Notifications configured' });
});

/**
 * POST /scheduler/notifications/test
 * Send a test notification
 */
router.post('/notifications/test', async (req: Request, res: Response) => {
  await notifications.send({
    type: 'task_completed',
    title: 'Test Notification',
    message: 'This is a test notification from Claude Fleet.',
    severity: 'info',
    fields: {
      'Environment': process.env.NODE_ENV || 'development',
      'Timestamp': new Date().toISOString()
    }
  });

  res.json({ message: 'Test notification sent' });
});

/**
 * POST /scheduler/notifications/enable
 * Enable notifications
 */
router.post('/notifications/enable', (req: Request, res: Response) => {
  notifications.setEnabled(true);
  res.json({ message: 'Notifications enabled' });
});

/**
 * POST /scheduler/notifications/disable
 * Disable notifications
 */
router.post('/notifications/disable', (req: Request, res: Response) => {
  notifications.setEnabled(false);
  res.json({ message: 'Notifications disabled' });
});

export default router;
