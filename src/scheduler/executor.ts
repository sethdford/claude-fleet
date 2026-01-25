/**
 * Task Executor
 *
 * Bridges the scheduler to the WorkerManager, executing queued tasks
 * by spawning workers with appropriate roles and prompts.
 */

import { EventEmitter } from 'events';
import type { WorkerManager } from '../workers/manager.js';
import { TaskTemplateEngine, type TaskExecutionContext, type TaskExecutionResult } from './templates.js';
import { NotificationService } from './notifications.js';

interface ExecutorConfig {
  workerManager: WorkerManager;
  defaultWorkingDir?: string;
  defaultRepository?: string;
}

interface QueuedTask {
  id: string;
  name: string;
  trigger: 'webhook' | 'cron' | 'manual' | 'alert';
  triggerEvent?: string;
  repository?: string;
  payload?: Record<string, unknown>;
  priority: 'critical' | 'high' | 'normal' | 'low';
}

/**
 * Maps template categories to worker roles
 */
const CATEGORY_TO_ROLE: Record<string, string> = {
  'documentation': 'tech-writer',
  'testing': 'qa-engineer',
  'security': 'security-engineer',
  'maintenance': 'fullstack-dev',
  'review': 'architect',
  'conversion': 'fullstack-dev'
};

export class TaskExecutor extends EventEmitter {
  private static instance: TaskExecutor;
  private workerManager: WorkerManager | null = null;
  private templateEngine: TaskTemplateEngine;
  private notifications: NotificationService;
  private defaultWorkingDir: string;
  private defaultRepository: string;
  private runningTasks = new Map<string, { workerId: string; startTime: number }>();

  private constructor() {
    super();
    this.templateEngine = TaskTemplateEngine.getInstance();
    this.notifications = NotificationService.getInstance();
    this.defaultWorkingDir = process.cwd();
    this.defaultRepository = '';
  }

  static getInstance(): TaskExecutor {
    if (!TaskExecutor.instance) {
      TaskExecutor.instance = new TaskExecutor();
    }
    return TaskExecutor.instance;
  }

  /**
   * Configure the executor with a WorkerManager
   */
  configure(config: ExecutorConfig): void {
    this.workerManager = config.workerManager;
    this.defaultWorkingDir = config.defaultWorkingDir ?? process.cwd();
    this.defaultRepository = config.defaultRepository ?? '';

    // Listen for worker events to track task completion
    this.workerManager.on('worker:result', ({ handle, result, durationMs }) => {
      this.handleWorkerResult(handle, result, durationMs);
    });

    this.workerManager.on('worker:error', ({ handle, error }) => {
      this.handleWorkerError(handle, error);
    });

    this.workerManager.on('worker:exit', ({ handle, code }) => {
      this.handleWorkerExit(handle, code);
    });

    console.log('[Executor] Configured with WorkerManager');
  }

  /**
   * Execute a task from the queue
   */
  async execute(task: QueuedTask): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    // Find the template for this task
    const template = this.templateEngine.getTemplate(task.name);

    if (!template) {
      // If no template, try to execute as a generic task
      return this.executeGenericTask(task, startTime);
    }

    // Build context from task payload
    const context: TaskExecutionContext = {
      repository: task.repository || this.defaultRepository,
      branch: task.payload?.branch as string,
      prNumber: task.payload?.prNumber as number,
      issueNumber: task.payload?.issueNumber as number,
      files: task.payload?.files as string[],
      labels: task.payload?.labels as string[],
      sender: task.payload?.sender as string,
      customData: task.payload
    };

    // Build the full prompt
    const prompt = this.templateEngine.buildPrompt(task.name, context);

    // Determine role from template
    const role = template.role || CATEGORY_TO_ROLE[template.category] || 'worker';

    // Notify if configured
    if (template.notifyOn?.includes('start')) {
      await this.notifications.notifyTaskStarted(task.name, task.repository, task.id);
    }

    try {
      // Spawn a worker to execute the task
      const result = await this.spawnTaskWorker(task, prompt, role);

      const duration = Date.now() - startTime;

      // Notify completion
      if (template.notifyOn?.includes('complete')) {
        await this.notifications.notifyTaskCompleted(
          task.name,
          { prUrl: result.prUrl, commitSha: result.commitSha, duration },
          task.repository,
          task.id
        );
      }

      this.emit('taskCompleted', { task, result, duration });

      return {
        success: true,
        templateId: task.name,
        duration,
        output: result.output,
        prUrl: result.prUrl,
        commitSha: result.commitSha
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Notify failure
      if (template.notifyOn?.includes('error')) {
        await this.notifications.notifyTaskFailed(task.name, errorMessage, task.repository, task.id);
      }

      this.emit('taskFailed', { task, error: errorMessage, duration });

      return {
        success: false,
        templateId: task.name,
        duration,
        errors: [errorMessage]
      };
    }
  }

  /**
   * Execute a generic task without a template
   */
  private async executeGenericTask(task: QueuedTask, startTime: number): Promise<TaskExecutionResult> {
    const prompt = this.buildGenericPrompt(task);

    try {
      const result = await this.spawnTaskWorker(task, prompt, 'worker');
      const duration = Date.now() - startTime;

      return {
        success: true,
        templateId: task.name,
        duration,
        output: result.output
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        templateId: task.name,
        duration,
        errors: [errorMessage]
      };
    }
  }

  /**
   * Build a generic prompt for tasks without templates
   */
  private buildGenericPrompt(task: QueuedTask): string {
    let prompt = `Execute the following task: ${task.name}\n\n`;

    if (task.triggerEvent) {
      prompt += `Triggered by: ${task.trigger} (${task.triggerEvent})\n`;
    }

    if (task.repository) {
      prompt += `Repository: ${task.repository}\n`;
    }

    if (task.payload) {
      prompt += `\nContext:\n${JSON.stringify(task.payload, null, 2)}\n`;
    }

    prompt += '\nComplete this task and report your results.';

    return prompt;
  }

  /**
   * Spawn a worker to execute the task
   */
  private async spawnTaskWorker(
    task: QueuedTask,
    prompt: string,
    role: string
  ): Promise<{ output?: string; prUrl?: string; commitSha?: string }> {
    if (!this.workerManager) {
      throw new Error('WorkerManager not configured');
    }

    // Generate a unique handle for this task
    const handle = `auto-${task.name.replace(/[^a-z0-9]/gi, '-')}-${task.id.slice(-6)}`;

    // Determine working directory
    const workingDir = this.defaultWorkingDir;
    if (task.repository) {
      // Could map repository to local path here
      // For now, use default
    }

    console.log(`[Executor] Spawning worker for task: ${task.name} (${handle})`);

    // Spawn the worker
    const workerResponse = await this.workerManager.spawnWorker({
      handle,
      initialPrompt: prompt,
      workingDir,
      role: role as 'worker' | 'team-lead',
      teamName: 'autonomous'
    });

    // Track the running task
    this.runningTasks.set(handle, {
      workerId: workerResponse.id,
      startTime: Date.now()
    });

    // Wait for the worker to complete (with timeout)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.runningTasks.delete(handle);
        reject(new Error('Task timed out after 30 minutes'));
      }, 30 * 60 * 1000); // 30 minute timeout

      // Store the resolve/reject for later
      this.once(`task:${handle}:complete`, (result) => {
        clearTimeout(timeout);
        this.runningTasks.delete(handle);
        resolve(result);
      });

      this.once(`task:${handle}:error`, (error) => {
        clearTimeout(timeout);
        this.runningTasks.delete(handle);
        reject(new Error(error));
      });
    });
  }

  /**
   * Handle worker result
   */
  private handleWorkerResult(handle: string, result: string, _durationMs?: number): void {
    if (!handle.startsWith('auto-')) return;

    console.log(`[Executor] Worker ${handle} completed`);

    // Parse result for PR URL or commit SHA
    const prUrlMatch = result.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
    const commitMatch = result.match(/commit\s+([a-f0-9]{7,40})/i);

    this.emit(`task:${handle}:complete`, {
      output: result,
      prUrl: prUrlMatch?.[0],
      commitSha: commitMatch?.[1]
    });
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(handle: string, error: string): void {
    if (!handle.startsWith('auto-')) return;

    console.error(`[Executor] Worker ${handle} error: ${error}`);
    this.emit(`task:${handle}:error`, error);
  }

  /**
   * Handle worker exit
   */
  private handleWorkerExit(handle: string, code: number | null): void {
    if (!handle.startsWith('auto-')) return;

    // If we haven't already handled completion/error, treat exit as completion
    if (this.runningTasks.has(handle)) {
      console.log(`[Executor] Worker ${handle} exited with code ${code}`);
      if (code === 0) {
        this.emit(`task:${handle}:complete`, { output: 'Task completed' });
      } else {
        this.emit(`task:${handle}:error`, `Worker exited with code ${code}`);
      }
    }
  }

  /**
   * Get running task count
   */
  getRunningCount(): number {
    return this.runningTasks.size;
  }

  /**
   * Get running tasks
   */
  getRunningTasks(): Array<{ handle: string; workerId: string; startTime: number }> {
    return Array.from(this.runningTasks.entries()).map(([handle, info]) => ({
      handle,
      ...info
    }));
  }
}

export default TaskExecutor;
