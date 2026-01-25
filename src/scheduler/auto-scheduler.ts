/**
 * Auto Scheduler
 *
 * Manages scheduled tasks using cron expressions and handles
 * the task queue for autonomous operations.
 */

import { EventEmitter } from 'events';

interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  tasks: string[];
  repository?: string;
}

interface QueuedTask {
  id: string;
  name: string;
  trigger: 'webhook' | 'cron' | 'manual' | 'alert';
  triggerEvent?: string;
  repository?: string;
  payload?: Record<string, unknown>;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retries: number;
  maxRetries: number;
  error?: string;
}

interface SchedulerConfig {
  maxConcurrentTasks: number;
  defaultRetries: number;
  retryDelayMs: number;
}

/**
 * Cron expression parser (simplified)
 * Format: minute hour day month dayOfWeek
 */
function parseCron(expression: string): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const parse = (val: string, max: number): number => {
    if (val === '*') return -1;
    const num = parseInt(val, 10);
    return isNaN(num) || num < 0 || num > max ? -1 : num;
  };

  return {
    minute: parse(parts[0], 59),
    hour: parse(parts[1], 23),
    dayOfMonth: parse(parts[2], 31),
    month: parse(parts[3], 12),
    dayOfWeek: parse(parts[4], 6)
  };
}

/**
 * Check if cron should run at given time
 */
function shouldRunCron(cron: ReturnType<typeof parseCron>, date: Date): boolean {
  if (!cron) return false;

  const matches = (cronVal: number, dateVal: number) => cronVal === -1 || cronVal === dateVal;

  return (
    matches(cron.minute, date.getMinutes()) &&
    matches(cron.hour, date.getHours()) &&
    matches(cron.dayOfMonth, date.getDate()) &&
    matches(cron.month, date.getMonth() + 1) &&
    matches(cron.dayOfWeek, date.getDay())
  );
}

/**
 * Calculate next run time for a cron expression
 */
function getNextRunTime(expression: string, from: Date = new Date()): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;

  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  // Look up to 7 days ahead
  for (let i = 0; i < 7 * 24 * 60; i++) {
    if (shouldRunCron(cron, next)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  return null;
}

export class AutoScheduler extends EventEmitter {
  private static instance: AutoScheduler;
  private schedules: Map<string, ScheduledTask> = new Map();
  private queue: QueuedTask[] = [];
  private running: Map<string, QueuedTask> = new Map();
  private cronInterval: NodeJS.Timeout | null = null;
  private processingInterval: NodeJS.Timeout | null = null;
  private config: SchedulerConfig;
  private webhookHistory: QueuedTask[] = [];

  private constructor(config?: Partial<SchedulerConfig>) {
    super();
    this.config = {
      maxConcurrentTasks: config?.maxConcurrentTasks ?? 3,
      defaultRetries: config?.defaultRetries ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 5000
    };
  }

  static getInstance(config?: Partial<SchedulerConfig>): AutoScheduler {
    if (!AutoScheduler.instance) {
      AutoScheduler.instance = new AutoScheduler(config);
    }
    return AutoScheduler.instance;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    console.log('[Scheduler] Starting auto-scheduler...');

    // Check cron schedules every minute
    this.cronInterval = setInterval(() => this.checkSchedules(), 60000);

    // Process queue every 5 seconds
    this.processingInterval = setInterval(() => this.processQueue(), 5000);

    // Initial check
    this.checkSchedules();
    this.processQueue();

    this.emit('started');
    console.log('[Scheduler] Auto-scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
    }
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.emit('stopped');
    console.log('[Scheduler] Auto-scheduler stopped');
  }

  /**
   * Register a scheduled task
   */
  registerSchedule(schedule: Omit<ScheduledTask, 'id' | 'nextRun'>): string {
    const id = `sched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const task: ScheduledTask = {
      ...schedule,
      id,
      nextRun: getNextRunTime(schedule.cron) || undefined
    };

    this.schedules.set(id, task);
    console.log(`[Scheduler] Registered schedule: ${schedule.name} (${schedule.cron})`);

    return id;
  }

  /**
   * Remove a scheduled task
   */
  unregisterSchedule(id: string): boolean {
    const result = this.schedules.delete(id);
    if (result) {
      console.log(`[Scheduler] Unregistered schedule: ${id}`);
    }
    return result;
  }

  /**
   * Enable/disable a schedule
   */
  setScheduleEnabled(id: string, enabled: boolean): boolean {
    const schedule = this.schedules.get(id);
    if (schedule) {
      schedule.enabled = enabled;
      console.log(`[Scheduler] Schedule ${id} ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    }
    return false;
  }

  /**
   * Queue a task for execution
   */
  async queueTask(options: {
    name: string;
    trigger: QueuedTask['trigger'];
    triggerEvent?: string;
    repository?: string;
    payload?: Record<string, unknown>;
    priority?: QueuedTask['priority'];
  }): Promise<string> {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const task: QueuedTask = {
      id,
      name: options.name,
      trigger: options.trigger,
      triggerEvent: options.triggerEvent,
      repository: options.repository,
      payload: options.payload,
      priority: options.priority || 'normal',
      status: 'queued',
      createdAt: new Date(),
      retries: 0,
      maxRetries: this.config.defaultRetries
    };

    // Insert based on priority
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const insertIndex = this.queue.findIndex(
      t => priorityOrder[t.priority] > priorityOrder[task.priority]
    );

    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }

    // Track webhook tasks
    if (options.trigger === 'webhook') {
      this.webhookHistory.unshift(task);
      if (this.webhookHistory.length > 100) {
        this.webhookHistory.pop();
      }
    }

    this.emit('taskQueued', task);
    console.log(`[Scheduler] Queued task: ${task.name} (${task.priority}) [${task.id}]`);

    return id;
  }

  /**
   * Check and run scheduled tasks
   */
  private checkSchedules(): void {
    const now = new Date();

    for (const [id, schedule] of this.schedules) {
      if (!schedule.enabled) continue;

      const cron = parseCron(schedule.cron);
      if (cron && shouldRunCron(cron, now)) {
        console.log(`[Scheduler] Triggering scheduled task: ${schedule.name}`);

        // Queue all tasks for this schedule
        for (const taskName of schedule.tasks) {
          this.queueTask({
            name: taskName,
            trigger: 'cron',
            triggerEvent: schedule.name,
            repository: schedule.repository,
            payload: { scheduleId: id, scheduleName: schedule.name }
          });
        }

        schedule.lastRun = now;
        schedule.nextRun = getNextRunTime(schedule.cron, now) || undefined;
      }
    }
  }

  /**
   * Process the task queue
   */
  private async processQueue(): Promise<void> {
    // Check if we can run more tasks
    if (this.running.size >= this.config.maxConcurrentTasks) {
      return;
    }

    // Get next task
    const task = this.queue.shift();
    if (!task) return;

    // Mark as running
    task.status = 'running';
    task.startedAt = new Date();
    this.running.set(task.id, task);

    this.emit('taskStarted', task);
    console.log(`[Scheduler] Starting task: ${task.name} [${task.id}]`);

    try {
      // Execute the task
      await this.executeTask(task);

      task.status = 'completed';
      task.completedAt = new Date();
      this.emit('taskCompleted', task);
      console.log(`[Scheduler] Completed task: ${task.name} [${task.id}]`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      task.error = errorMessage;

      if (task.retries < task.maxRetries) {
        task.retries++;
        task.status = 'queued';
        task.startedAt = undefined;

        console.log(`[Scheduler] Retrying task: ${task.name} (${task.retries}/${task.maxRetries})`);

        // Re-queue with delay
        setTimeout(() => {
          this.queue.unshift(task);
        }, this.config.retryDelayMs * task.retries);
      } else {
        task.status = 'failed';
        task.completedAt = new Date();
        this.emit('taskFailed', task);
        console.error(`[Scheduler] Failed task: ${task.name} [${task.id}] - ${errorMessage}`);
      }
    } finally {
      this.running.delete(task.id);
    }
  }

  /**
   * Execute a task (override this in subclass or via event handlers)
   */
  private async executeTask(task: QueuedTask): Promise<void> {
    // Emit event for external handlers
    this.emit('executeTask', task);

    // Default implementation - just log
    console.log(`[Scheduler] Executing task: ${task.name}`, task.payload);

    // Simulate some work (in real implementation, this would call the template engine)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Get queue status
   */
  getStatus(): {
    running: number;
    queued: number;
    schedules: number;
    enabledSchedules: number;
  } {
    return {
      running: this.running.size,
      queued: this.queue.length,
      schedules: this.schedules.size,
      enabledSchedules: Array.from(this.schedules.values()).filter(s => s.enabled).length
    };
  }

  /**
   * Get all schedules
   */
  getSchedules(): ScheduledTask[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Get queue contents
   */
  getQueue(): QueuedTask[] {
    return [...this.queue];
  }

  /**
   * Get running tasks
   */
  getRunning(): QueuedTask[] {
    return Array.from(this.running.values());
  }

  /**
   * Get recent webhook tasks
   */
  async getRecentWebhookTasks(limit: number = 20): Promise<QueuedTask[]> {
    return this.webhookHistory.slice(0, limit);
  }

  /**
   * Cancel a queued task
   */
  cancelTask(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      const task = this.queue.splice(index, 1)[0];
      task.status = 'cancelled';
      this.emit('taskCancelled', task);
      return true;
    }
    return false;
  }

  /**
   * Load schedules from configuration
   */
  loadSchedulesFromConfig(config: {
    schedules: Array<{
      name: string;
      cron: string;
      tasks: string[];
      repository?: string;
      enabled?: boolean;
    }>;
  }): void {
    for (const schedule of config.schedules) {
      this.registerSchedule({
        name: schedule.name,
        cron: schedule.cron,
        tasks: schedule.tasks,
        repository: schedule.repository,
        enabled: schedule.enabled ?? true
      });
    }
    console.log(`[Scheduler] Loaded ${config.schedules.length} schedules from config`);
  }
}

// Default schedules for autonomous operations
export const DEFAULT_SCHEDULES = [
  {
    name: 'nightly-maintenance',
    cron: '0 2 * * *', // 2 AM daily
    tasks: ['update-dependencies', 'fix-lint-errors', 'optimize-imports'],
    enabled: true
  },
  {
    name: 'weekly-security-audit',
    cron: '0 9 * * 1', // 9 AM Monday
    tasks: ['security-audit', 'vulnerability-scan', 'dependency-check'],
    enabled: true
  },
  {
    name: 'daily-documentation-sync',
    cron: '0 6 * * *', // 6 AM daily
    tasks: ['sync-api-docs', 'update-readme', 'generate-changelog'],
    enabled: true
  },
  {
    name: 'hourly-health-check',
    cron: '0 * * * *', // Every hour
    tasks: ['health-check', 'metrics-collection'],
    enabled: true
  },
  {
    name: 'weekly-coverage-report',
    cron: '0 10 * * 5', // 10 AM Friday
    tasks: ['coverage-report', 'test-quality-analysis'],
    enabled: true
  }
];

export default AutoScheduler;
