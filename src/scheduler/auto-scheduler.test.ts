/**
 * Tests for AutoScheduler
 *
 * Co-located test that enhances the existing tests/scheduler.test.ts with
 * additional coverage for:
 * - start/stop lifecycle
 * - unregisterSchedule
 * - getRecentWebhookTasks
 * - loadSchedulesFromConfig
 * - DEFAULT_SCHEDULES export
 * - Priority queue behavior edge cases
 * - Event emissions
 * - Cron parsing and matching edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('AutoScheduler', () => {
  let AutoScheduler: typeof import('./auto-scheduler.js').AutoScheduler;
  let DEFAULT_SCHEDULES: typeof import('./auto-scheduler.js').DEFAULT_SCHEDULES;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import('./auto-scheduler.js');
    AutoScheduler = mod.AutoScheduler;
    DEFAULT_SCHEDULES = mod.DEFAULT_SCHEDULES;
  });

  afterEach(() => {
    try {
      AutoScheduler.getInstance().stop();
    } catch {
      // ignore cleanup errors
    }
    vi.useRealTimers();
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('getInstance()', () => {
    it('should return the same instance on subsequent calls', () => {
      const a = AutoScheduler.getInstance();
      const b = AutoScheduler.getInstance();
      expect(a).toBe(b);
    });

    it('should accept optional config on first creation', () => {
      const scheduler = AutoScheduler.getInstance({ maxConcurrentTasks: 10 });
      expect(scheduler).toBeDefined();
    });
  });

  // ==========================================================================
  // start / stop
  // ==========================================================================

  describe('start()', () => {
    it('should emit started event', () => {
      const scheduler = AutoScheduler.getInstance();
      const startedSpy = vi.fn();
      scheduler.on('started', startedSpy);

      scheduler.start();

      expect(startedSpy).toHaveBeenCalledOnce();
    });

    it('should set up cron and processing intervals', () => {
      const scheduler = AutoScheduler.getInstance();
      scheduler.start();

      // After starting, the intervals are active
      // Verify by advancing time and checking no errors
      vi.advanceTimersByTime(60000);
      vi.advanceTimersByTime(5000);
    });
  });

  describe('stop()', () => {
    it('should emit stopped event', () => {
      const scheduler = AutoScheduler.getInstance();
      const stoppedSpy = vi.fn();
      scheduler.on('stopped', stoppedSpy);

      scheduler.start();
      scheduler.stop();

      expect(stoppedSpy).toHaveBeenCalledOnce();
    });

    it('should be safe to call stop without start', () => {
      const scheduler = AutoScheduler.getInstance();
      expect(() => scheduler.stop()).not.toThrow();
    });

    it('should be safe to call stop multiple times', () => {
      const scheduler = AutoScheduler.getInstance();
      scheduler.start();
      scheduler.stop();
      scheduler.stop();
      // No errors
    });
  });

  // ==========================================================================
  // registerSchedule / unregisterSchedule
  // ==========================================================================

  describe('registerSchedule()', () => {
    it('should return an ID starting with sched_', () => {
      const scheduler = AutoScheduler.getInstance();
      const id = scheduler.registerSchedule({
        name: 'test',
        cron: '0 * * * *',
        tasks: ['task1'],
        enabled: true,
      });
      expect(id).toMatch(/^sched_/);
    });

    it('should store the schedule with nextRun calculated', () => {
      const scheduler = AutoScheduler.getInstance();
      scheduler.registerSchedule({
        name: 'hourly',
        cron: '0 * * * *',
        tasks: ['check'],
        enabled: true,
      });

      const schedules = scheduler.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].name).toBe('hourly');
      expect(schedules[0].nextRun).toBeInstanceOf(Date);
    });

    it('should handle invalid cron gracefully (nextRun is undefined)', () => {
      const scheduler = AutoScheduler.getInstance();
      scheduler.registerSchedule({
        name: 'bad-cron',
        cron: 'not-a-cron',
        tasks: ['task'],
        enabled: true,
      });

      const schedules = scheduler.getSchedules();
      expect(schedules[0].nextRun).toBeUndefined();
    });
  });

  describe('unregisterSchedule()', () => {
    it('should remove a registered schedule', () => {
      const scheduler = AutoScheduler.getInstance();
      const id = scheduler.registerSchedule({
        name: 'removable',
        cron: '0 * * * *',
        tasks: ['task'],
        enabled: true,
      });

      expect(scheduler.getSchedules()).toHaveLength(1);

      const result = scheduler.unregisterSchedule(id);
      expect(result).toBe(true);
      expect(scheduler.getSchedules()).toHaveLength(0);
    });

    it('should return false for non-existent ID', () => {
      const scheduler = AutoScheduler.getInstance();
      const result = scheduler.unregisterSchedule('sched_nonexistent');
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // setScheduleEnabled
  // ==========================================================================

  describe('setScheduleEnabled()', () => {
    it('should toggle enabled state', () => {
      const scheduler = AutoScheduler.getInstance();
      const id = scheduler.registerSchedule({
        name: 'toggle',
        cron: '0 * * * *',
        tasks: ['task'],
        enabled: true,
      });

      expect(scheduler.getSchedules()[0].enabled).toBe(true);

      scheduler.setScheduleEnabled(id, false);
      expect(scheduler.getSchedules()[0].enabled).toBe(false);

      scheduler.setScheduleEnabled(id, true);
      expect(scheduler.getSchedules()[0].enabled).toBe(true);
    });

    it('should return false for non-existent schedule', () => {
      const scheduler = AutoScheduler.getInstance();
      const result = scheduler.setScheduleEnabled('nonexistent', true);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // queueTask
  // ==========================================================================

  describe('queueTask()', () => {
    it('should return a task ID starting with task_', async () => {
      const scheduler = AutoScheduler.getInstance();
      const id = await scheduler.queueTask({
        name: 'test',
        trigger: 'manual',
      });
      expect(id).toMatch(/^task_/);
    });

    it('should default priority to normal', async () => {
      const scheduler = AutoScheduler.getInstance();
      await scheduler.queueTask({
        name: 'default-priority',
        trigger: 'manual',
      });

      const queue = scheduler.getQueue();
      expect(queue[0].priority).toBe('normal');
    });

    it('should emit taskQueued event', async () => {
      const scheduler = AutoScheduler.getInstance();
      const queuedSpy = vi.fn();
      scheduler.on('taskQueued', queuedSpy);

      await scheduler.queueTask({
        name: 'event-test',
        trigger: 'manual',
      });

      expect(queuedSpy).toHaveBeenCalledOnce();
      expect(queuedSpy.mock.calls[0][0].name).toBe('event-test');
    });

    it('should order tasks by priority', async () => {
      const scheduler = AutoScheduler.getInstance();

      await scheduler.queueTask({ name: 'low', trigger: 'manual', priority: 'low' });
      await scheduler.queueTask({ name: 'critical', trigger: 'manual', priority: 'critical' });
      await scheduler.queueTask({ name: 'normal', trigger: 'manual', priority: 'normal' });
      await scheduler.queueTask({ name: 'high', trigger: 'manual', priority: 'high' });

      const queue = scheduler.getQueue();
      expect(queue[0].name).toBe('critical');
      expect(queue[1].name).toBe('high');
      expect(queue[2].name).toBe('normal');
      expect(queue[3].name).toBe('low');
    });

    it('should track webhook tasks in history', async () => {
      const scheduler = AutoScheduler.getInstance();
      await scheduler.queueTask({
        name: 'webhook-task',
        trigger: 'webhook',
        triggerEvent: 'push',
      });

      const history = await scheduler.getRecentWebhookTasks();
      expect(history).toHaveLength(1);
      expect(history[0].name).toBe('webhook-task');
    });

    it('should not track non-webhook tasks in history', async () => {
      const scheduler = AutoScheduler.getInstance();
      await scheduler.queueTask({
        name: 'cron-task',
        trigger: 'cron',
      });

      const history = await scheduler.getRecentWebhookTasks();
      expect(history).toHaveLength(0);
    });

    it('should limit webhook history to 100 entries', async () => {
      const scheduler = AutoScheduler.getInstance();
      for (let i = 0; i < 105; i++) {
        await scheduler.queueTask({
          name: `webhook-${i}`,
          trigger: 'webhook',
        });
      }

      const history = await scheduler.getRecentWebhookTasks(200);
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it('should set correct status and metadata on queued task', async () => {
      const scheduler = AutoScheduler.getInstance();
      await scheduler.queueTask({
        name: 'meta-task',
        trigger: 'alert',
        triggerEvent: 'high-cpu',
        repository: 'org/repo',
        payload: { cpu: 95 },
        priority: 'high',
      });

      const queue = scheduler.getQueue();
      expect(queue[0].status).toBe('queued');
      expect(queue[0].trigger).toBe('alert');
      expect(queue[0].triggerEvent).toBe('high-cpu');
      expect(queue[0].repository).toBe('org/repo');
      expect(queue[0].payload).toEqual({ cpu: 95 });
      expect(queue[0].createdAt).toBeInstanceOf(Date);
      expect(queue[0].retries).toBe(0);
    });
  });

  // ==========================================================================
  // cancelTask
  // ==========================================================================

  describe('cancelTask()', () => {
    it('should cancel a queued task and emit event', async () => {
      const scheduler = AutoScheduler.getInstance();
      const cancelledSpy = vi.fn();
      scheduler.on('taskCancelled', cancelledSpy);

      const id = await scheduler.queueTask({
        name: 'cancelable',
        trigger: 'manual',
      });

      const result = scheduler.cancelTask(id);
      expect(result).toBe(true);
      expect(scheduler.getQueue()).toHaveLength(0);
      expect(cancelledSpy).toHaveBeenCalledOnce();
      expect(cancelledSpy.mock.calls[0][0].status).toBe('cancelled');
    });

    it('should return false for non-existent task ID', () => {
      const scheduler = AutoScheduler.getInstance();
      expect(scheduler.cancelTask('nonexistent')).toBe(false);
    });
  });

  // ==========================================================================
  // getRecentWebhookTasks
  // ==========================================================================

  describe('getRecentWebhookTasks()', () => {
    it('should return empty array initially', async () => {
      const scheduler = AutoScheduler.getInstance();
      const tasks = await scheduler.getRecentWebhookTasks();
      expect(tasks).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const scheduler = AutoScheduler.getInstance();
      for (let i = 0; i < 10; i++) {
        await scheduler.queueTask({
          name: `wh-${i}`,
          trigger: 'webhook',
        });
      }

      const tasks = await scheduler.getRecentWebhookTasks(3);
      expect(tasks).toHaveLength(3);
    });

    it('should default limit to 20', async () => {
      const scheduler = AutoScheduler.getInstance();
      for (let i = 0; i < 30; i++) {
        await scheduler.queueTask({
          name: `wh-${i}`,
          trigger: 'webhook',
        });
      }

      const tasks = await scheduler.getRecentWebhookTasks();
      expect(tasks).toHaveLength(20);
    });

    it('should return newest tasks first', async () => {
      const scheduler = AutoScheduler.getInstance();
      await scheduler.queueTask({ name: 'first', trigger: 'webhook' });
      await scheduler.queueTask({ name: 'second', trigger: 'webhook' });
      await scheduler.queueTask({ name: 'third', trigger: 'webhook' });

      const tasks = await scheduler.getRecentWebhookTasks();
      expect(tasks[0].name).toBe('third');
      expect(tasks[1].name).toBe('second');
      expect(tasks[2].name).toBe('first');
    });
  });

  // ==========================================================================
  // getStatus
  // ==========================================================================

  describe('getStatus()', () => {
    it('should return zeros when empty', () => {
      const scheduler = AutoScheduler.getInstance();
      const status = scheduler.getStatus();
      expect(status).toEqual({
        running: 0,
        queued: 0,
        schedules: 0,
        enabledSchedules: 0,
      });
    });

    it('should reflect registered schedules and queued tasks', async () => {
      const scheduler = AutoScheduler.getInstance();

      scheduler.registerSchedule({ name: 'a', cron: '0 * * * *', tasks: ['t'], enabled: true });
      scheduler.registerSchedule({ name: 'b', cron: '0 * * * *', tasks: ['t'], enabled: false });
      await scheduler.queueTask({ name: 'q1', trigger: 'manual' });
      await scheduler.queueTask({ name: 'q2', trigger: 'manual' });

      const status = scheduler.getStatus();
      expect(status.schedules).toBe(2);
      expect(status.enabledSchedules).toBe(1);
      expect(status.queued).toBe(2);
      expect(status.running).toBe(0);
    });
  });

  // ==========================================================================
  // getSchedules / getQueue / getRunning
  // ==========================================================================

  describe('getSchedules()', () => {
    it('should return array of all schedules', () => {
      const scheduler = AutoScheduler.getInstance();
      scheduler.registerSchedule({ name: 's1', cron: '0 * * * *', tasks: ['t'], enabled: true });
      scheduler.registerSchedule({ name: 's2', cron: '0 2 * * *', tasks: ['t'], enabled: false });

      const schedules = scheduler.getSchedules();
      expect(schedules).toHaveLength(2);
      expect(schedules.map(s => s.name)).toContain('s1');
      expect(schedules.map(s => s.name)).toContain('s2');
    });
  });

  describe('getQueue()', () => {
    it('should return a copy of the queue', async () => {
      const scheduler = AutoScheduler.getInstance();
      await scheduler.queueTask({ name: 'task1', trigger: 'manual' });

      const queue1 = scheduler.getQueue();
      const queue2 = scheduler.getQueue();
      expect(queue1).not.toBe(queue2); // Different array references
      expect(queue1).toEqual(queue2); // Same content
    });
  });

  describe('getRunning()', () => {
    it('should return empty array when nothing is running', () => {
      const scheduler = AutoScheduler.getInstance();
      expect(scheduler.getRunning()).toEqual([]);
    });
  });

  // ==========================================================================
  // loadSchedulesFromConfig
  // ==========================================================================

  describe('loadSchedulesFromConfig()', () => {
    it('should register all schedules from config', () => {
      const scheduler = AutoScheduler.getInstance();
      scheduler.loadSchedulesFromConfig({
        schedules: [
          { name: 'nightly', cron: '0 2 * * *', tasks: ['lint', 'test'], enabled: true },
          { name: 'weekly', cron: '0 9 * * 1', tasks: ['audit'], repository: 'org/repo' },
        ],
      });

      const schedules = scheduler.getSchedules();
      expect(schedules).toHaveLength(2);
      expect(schedules[0].name).toBe('nightly');
      expect(schedules[0].enabled).toBe(true);
      expect(schedules[1].name).toBe('weekly');
      // enabled defaults to true when omitted
      expect(schedules[1].enabled).toBe(true);
    });

    it('should handle empty schedule array', () => {
      const scheduler = AutoScheduler.getInstance();
      scheduler.loadSchedulesFromConfig({ schedules: [] });
      expect(scheduler.getSchedules()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // DEFAULT_SCHEDULES export
  // ==========================================================================

  describe('DEFAULT_SCHEDULES', () => {
    it('should export an array of schedule configs', () => {
      expect(Array.isArray(DEFAULT_SCHEDULES)).toBe(true);
      expect(DEFAULT_SCHEDULES.length).toBeGreaterThan(0);
    });

    it('should have valid structure for each default schedule', () => {
      for (const schedule of DEFAULT_SCHEDULES) {
        expect(schedule.name).toBeTruthy();
        expect(schedule.cron).toBeTruthy();
        expect(Array.isArray(schedule.tasks)).toBe(true);
        expect(schedule.tasks.length).toBeGreaterThan(0);
        expect(typeof schedule.enabled).toBe('boolean');
      }
    });

    it('should contain nightly-maintenance schedule', () => {
      const nightly = DEFAULT_SCHEDULES.find(s => s.name === 'nightly-maintenance');
      expect(nightly).toBeDefined();
      expect(nightly!.cron).toBe('0 2 * * *');
    });

    it('should contain weekly-security-audit schedule', () => {
      const weekly = DEFAULT_SCHEDULES.find(s => s.name === 'weekly-security-audit');
      expect(weekly).toBeDefined();
      expect(weekly!.cron).toBe('0 9 * * 1');
    });

    it('should contain hourly-health-check schedule', () => {
      const hourly = DEFAULT_SCHEDULES.find(s => s.name === 'hourly-health-check');
      expect(hourly).toBeDefined();
      expect(hourly!.cron).toBe('0 * * * *');
    });
  });
});
