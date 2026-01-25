/**
 * Scheduler Tests
 *
 * Tests for autonomous operations components:
 * - AutoScheduler
 * - TaskTemplateEngine
 * - NotificationService
 * - ConfigLoader
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fetch for notification tests
global.fetch = vi.fn();

describe('AutoScheduler', () => {
  let AutoScheduler: typeof import('../src/scheduler/auto-scheduler.js').AutoScheduler;

  beforeEach(async () => {
    // Reset singleton for each test
    vi.resetModules();
    const module = await import('../src/scheduler/auto-scheduler.js');
    AutoScheduler = module.AutoScheduler;
  });

  afterEach(() => {
    const scheduler = AutoScheduler.getInstance();
    scheduler.stop();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = AutoScheduler.getInstance();
      const instance2 = AutoScheduler.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('queueTask', () => {
    it('should queue a task with correct properties', async () => {
      const scheduler = AutoScheduler.getInstance();
      const taskId = await scheduler.queueTask({
        name: 'test-task',
        trigger: 'manual',
        repository: 'owner/repo',
        priority: 'normal'
      });

      expect(taskId).toMatch(/^task_/);

      const queue = scheduler.getQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].name).toBe('test-task');
      expect(queue[0].trigger).toBe('manual');
      expect(queue[0].repository).toBe('owner/repo');
    });

    it('should respect priority ordering', async () => {
      const scheduler = AutoScheduler.getInstance();

      await scheduler.queueTask({ name: 'low', trigger: 'manual', priority: 'low' });
      await scheduler.queueTask({ name: 'critical', trigger: 'manual', priority: 'critical' });
      await scheduler.queueTask({ name: 'high', trigger: 'manual', priority: 'high' });
      await scheduler.queueTask({ name: 'normal', trigger: 'manual', priority: 'normal' });

      const queue = scheduler.getQueue();
      expect(queue[0].name).toBe('critical');
      expect(queue[1].name).toBe('high');
      expect(queue[2].name).toBe('normal');
      expect(queue[3].name).toBe('low');
    });
  });

  describe('registerSchedule', () => {
    it('should register a schedule', () => {
      const scheduler = AutoScheduler.getInstance();
      const id = scheduler.registerSchedule({
        name: 'test-schedule',
        cron: '0 * * * *',
        tasks: ['task1', 'task2'],
        enabled: true
      });

      expect(id).toMatch(/^sched_/);

      const schedules = scheduler.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].name).toBe('test-schedule');
      expect(schedules[0].tasks).toEqual(['task1', 'task2']);
    });

    it('should calculate next run time', () => {
      const scheduler = AutoScheduler.getInstance();
      scheduler.registerSchedule({
        name: 'every-hour',
        cron: '0 * * * *',
        tasks: ['hourly-task'],
        enabled: true
      });

      const schedules = scheduler.getSchedules();
      expect(schedules[0].nextRun).toBeDefined();
      expect(schedules[0].nextRun).toBeInstanceOf(Date);
    });
  });

  describe('cancelTask', () => {
    it('should cancel a queued task', async () => {
      const scheduler = AutoScheduler.getInstance();
      const taskId = await scheduler.queueTask({
        name: 'cancelable',
        trigger: 'manual'
      });

      expect(scheduler.getQueue()).toHaveLength(1);

      const cancelled = scheduler.cancelTask(taskId);
      expect(cancelled).toBe(true);
      expect(scheduler.getQueue()).toHaveLength(0);
    });

    it('should return false for non-existent task', () => {
      const scheduler = AutoScheduler.getInstance();
      const cancelled = scheduler.cancelTask('non-existent-id');
      expect(cancelled).toBe(false);
    });
  });

  describe('setScheduleEnabled', () => {
    it('should enable/disable a schedule', () => {
      const scheduler = AutoScheduler.getInstance();
      const id = scheduler.registerSchedule({
        name: 'toggleable',
        cron: '0 * * * *',
        tasks: ['task'],
        enabled: true
      });

      let schedules = scheduler.getSchedules();
      expect(schedules[0].enabled).toBe(true);

      scheduler.setScheduleEnabled(id, false);
      schedules = scheduler.getSchedules();
      expect(schedules[0].enabled).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return correct status', async () => {
      const scheduler = AutoScheduler.getInstance();

      scheduler.registerSchedule({
        name: 'enabled',
        cron: '0 * * * *',
        tasks: ['task'],
        enabled: true
      });

      scheduler.registerSchedule({
        name: 'disabled',
        cron: '0 * * * *',
        tasks: ['task'],
        enabled: false
      });

      await scheduler.queueTask({ name: 'queued', trigger: 'manual' });

      const status = scheduler.getStatus();
      expect(status.schedules).toBe(2);
      expect(status.enabledSchedules).toBe(1);
      expect(status.queued).toBe(1);
      expect(status.running).toBe(0);
    });
  });
});

describe('TaskTemplateEngine', () => {
  let TaskTemplateEngine: typeof import('../src/scheduler/templates.js').TaskTemplateEngine;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../src/scheduler/templates.js');
    TaskTemplateEngine = module.TaskTemplateEngine;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = TaskTemplateEngine.getInstance();
      const instance2 = TaskTemplateEngine.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getTemplate', () => {
    it('should return built-in template by id', () => {
      const engine = TaskTemplateEngine.getInstance();
      const template = engine.getTemplate('update-documentation');

      expect(template).toBeDefined();
      expect(template?.name).toBe('Update Documentation');
      expect(template?.category).toBe('documentation');
    });

    it('should return undefined for non-existent template', () => {
      const engine = TaskTemplateEngine.getInstance();
      const template = engine.getTemplate('non-existent');
      expect(template).toBeUndefined();
    });
  });

  describe('getAllTemplates', () => {
    it('should return all built-in templates', () => {
      const engine = TaskTemplateEngine.getInstance();
      const templates = engine.getAllTemplates();

      expect(templates.length).toBeGreaterThan(10);
      expect(templates.some(t => t.id === 'update-documentation')).toBe(true);
      expect(templates.some(t => t.id === 'generate-tests')).toBe(true);
      expect(templates.some(t => t.id === 'security-scan')).toBe(true);
    });
  });

  describe('getTemplatesByCategory', () => {
    it('should filter templates by category', () => {
      const engine = TaskTemplateEngine.getInstance();

      const docTemplates = engine.getTemplatesByCategory('documentation');
      expect(docTemplates.every(t => t.category === 'documentation')).toBe(true);

      const testTemplates = engine.getTemplatesByCategory('testing');
      expect(testTemplates.every(t => t.category === 'testing')).toBe(true);
    });
  });

  describe('registerTemplate', () => {
    it('should register a custom template', () => {
      const engine = TaskTemplateEngine.getInstance();

      engine.registerTemplate({
        id: 'custom-task',
        name: 'Custom Task',
        description: 'A custom task',
        category: 'maintenance',
        role: 'worker',
        estimatedMinutes: 5,
        prompt: 'Do something custom'
      });

      const template = engine.getTemplate('custom-task');
      expect(template).toBeDefined();
      expect(template?.name).toBe('Custom Task');
    });
  });

  describe('buildPrompt', () => {
    it('should build prompt with context', () => {
      const engine = TaskTemplateEngine.getInstance();

      const prompt = engine.buildPrompt('update-documentation', {
        repository: 'owner/repo',
        branch: 'main',
        prNumber: 42,
        files: ['src/index.ts', 'README.md']
      });

      expect(prompt).toContain('Repository: owner/repo');
      expect(prompt).toContain('Branch: main');
      expect(prompt).toContain('Pull Request: #42');
      expect(prompt).toContain('src/index.ts');
      expect(prompt).toContain('README.md');
    });

    it('should throw for non-existent template', () => {
      const engine = TaskTemplateEngine.getInstance();

      expect(() => {
        engine.buildPrompt('non-existent', { repository: 'test' });
      }).toThrow('Template not found');
    });
  });
});

describe('NotificationService', () => {
  let NotificationService: typeof import('../src/scheduler/notifications.js').NotificationService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    const module = await import('../src/scheduler/notifications.js');
    NotificationService = module.NotificationService;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = NotificationService.getInstance();
      const instance2 = NotificationService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('configure', () => {
    it('should accept slack configuration', () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: {
          webhookUrl: 'https://hooks.slack.com/test',
          channel: '#test'
        }
      });
      // Configuration stored successfully (no error thrown)
    });
  });

  describe('send', () => {
    it('should send to Slack when configured', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: {
          webhookUrl: 'https://hooks.slack.com/test'
        }
      });

      await service.send({
        type: 'task_completed',
        title: 'Test',
        message: 'Test message',
        severity: 'info'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should not send when disabled', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' }
      });
      service.setEnabled(false);

      await service.send({
        type: 'task_completed',
        title: 'Test',
        message: 'Test message'
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('convenience methods', () => {
    it('should send task started notification', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' }
      });
      service.setEnabled(true);

      await service.notifyTaskStarted('test-task', 'owner/repo', 'task-123');

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should send task completed notification', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' }
      });

      await service.notifyTaskCompleted(
        'test-task',
        { prUrl: 'https://github.com/org/repo/pull/1', duration: 5000 },
        'owner/repo'
      );

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should send security alert notification', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' }
      });

      await service.notifySecurityAlert('SQL Injection found', 'critical', 'owner/repo');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.attachments[0].color).toBe('#dc2626'); // Critical color
    });
  });
});

describe('ConfigLoader', () => {
  let loadConfig: typeof import('../src/scheduler/config-loader.js').loadConfig;
  let validateConfig: typeof import('../src/scheduler/config-loader.js').validateConfig;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../src/scheduler/config-loader.js');
    loadConfig = module.loadConfig;
    validateConfig = module.validateConfig;
  });

  describe('validateConfig', () => {
    it('should pass valid configuration', () => {
      const result = validateConfig({
        schedules: [
          { name: 'test', cron: '0 * * * *', tasks: ['task1'] }
        ],
        templates: [
          {
            id: 'custom',
            name: 'Custom',
            description: 'Test',
            category: 'maintenance',
            role: 'worker',
            prompt: 'Do something'
          }
        ]
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for schedule missing name', () => {
      const result = validateConfig({
        schedules: [
          { name: '', cron: '0 * * * *', tasks: ['task1'] }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Schedule missing name');
    });

    it('should fail for schedule missing cron', () => {
      const result = validateConfig({
        schedules: [
          { name: 'test', cron: '', tasks: ['task1'] }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing cron'))).toBe(true);
    });

    it('should fail for schedule with no tasks', () => {
      const result = validateConfig({
        schedules: [
          { name: 'test', cron: '0 * * * *', tasks: [] }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('has no tasks'))).toBe(true);
    });

    it('should fail for template missing prompt', () => {
      const result = validateConfig({
        templates: [
          {
            id: 'custom',
            name: 'Custom',
            description: 'Test',
            category: 'maintenance',
            role: 'worker',
            prompt: ''
          }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing prompt'))).toBe(true);
    });
  });
});
