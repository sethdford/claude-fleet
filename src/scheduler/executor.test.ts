/**
 * Tests for TaskExecutor
 *
 * Covers: getInstance, configure, execute, getRunningCount, getRunningTasks,
 *         handleWorkerResult, handleWorkerError, handleWorkerExit
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock the template engine singleton
const mockGetTemplate = vi.fn();
const mockBuildPrompt = vi.fn();

vi.mock('./templates.js', () => ({
  TaskTemplateEngine: {
    getInstance: vi.fn(() => ({
      getTemplate: mockGetTemplate,
      buildPrompt: mockBuildPrompt,
    })),
  },
}));

// Mock the notification service singleton
const mockNotifyTaskStarted = vi.fn().mockResolvedValue(undefined);
const mockNotifyTaskCompleted = vi.fn().mockResolvedValue(undefined);
const mockNotifyTaskFailed = vi.fn().mockResolvedValue(undefined);

vi.mock('./notifications.js', () => ({
  NotificationService: {
    getInstance: vi.fn(() => ({
      notifyTaskStarted: mockNotifyTaskStarted,
      notifyTaskCompleted: mockNotifyTaskCompleted,
      notifyTaskFailed: mockNotifyTaskFailed,
    })),
  },
}));

describe('TaskExecutor', () => {
  let TaskExecutor: typeof import('./executor.js').TaskExecutor;
  let mockWorkerManager: EventEmitter & {
    spawnWorker: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Re-mock after resetModules
    vi.doMock('./templates.js', () => ({
      TaskTemplateEngine: {
        getInstance: vi.fn(() => ({
          getTemplate: mockGetTemplate,
          buildPrompt: mockBuildPrompt,
        })),
      },
    }));

    vi.doMock('./notifications.js', () => ({
      NotificationService: {
        getInstance: vi.fn(() => ({
          notifyTaskStarted: mockNotifyTaskStarted,
          notifyTaskCompleted: mockNotifyTaskCompleted,
          notifyTaskFailed: mockNotifyTaskFailed,
        })),
      },
    }));

    const mod = await import('./executor.js');
    TaskExecutor = mod.TaskExecutor;

    // Create a mock WorkerManager that extends EventEmitter
    const emitter = new EventEmitter();
    mockWorkerManager = Object.assign(emitter, {
      spawnWorker: vi.fn().mockResolvedValue({ id: 'worker-123' }),
    });
  });

  // ==========================================================================
  // getInstance()
  // ==========================================================================

  describe('getInstance()', () => {
    it('should return a singleton instance', () => {
      const instance1 = TaskExecutor.getInstance();
      const instance2 = TaskExecutor.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should be an instance of EventEmitter', () => {
      const executor = TaskExecutor.getInstance();
      expect(executor).toBeInstanceOf(EventEmitter);
    });
  });

  // ==========================================================================
  // configure()
  // ==========================================================================

  describe('configure()', () => {
    it('should accept a WorkerManager config', () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });
      // No error means success
    });

    it('should accept optional defaultWorkingDir and defaultRepository', () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
        defaultWorkingDir: '/tmp/work',
        defaultRepository: 'org/repo',
      });
    });

    it('should register worker event listeners', () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      // Check that the WorkerManager has listeners registered
      expect(mockWorkerManager.listenerCount('worker:result')).toBe(1);
      expect(mockWorkerManager.listenerCount('worker:error')).toBe(1);
      expect(mockWorkerManager.listenerCount('worker:exit')).toBe(1);
    });
  });

  // ==========================================================================
  // getRunningCount() / getRunningTasks()
  // ==========================================================================

  describe('getRunningCount()', () => {
    it('should return 0 initially', () => {
      const executor = TaskExecutor.getInstance();
      expect(executor.getRunningCount()).toBe(0);
    });
  });

  describe('getRunningTasks()', () => {
    it('should return empty array initially', () => {
      const executor = TaskExecutor.getInstance();
      expect(executor.getRunningTasks()).toEqual([]);
    });
  });

  // ==========================================================================
  // execute() - generic task (no template found)
  // ==========================================================================

  describe('execute() - generic task', () => {
    it('should execute a generic task when no template matches', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue(undefined);

      // The spawnWorker returns a promise, then we need to resolve
      // the internal event-based promise
      const executePromise = executor.execute({
        id: 'task-abc123',
        name: 'unknown-task',
        trigger: 'manual',
        priority: 'normal',
      });

      // Give the spawn call a tick to register
      await new Promise(resolve => setTimeout(resolve, 10));

      // Find the handle and emit the completion event
      const handle = 'auto-unknown-task-abc123';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Task output here',
        durationMs: 1000,
      });

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.templateId).toBe('unknown-task');
      expect(result.output).toBe('Task output here');
    });

    it('should return failure when WorkerManager is not configured', async () => {
      // Get a fresh instance without configuring WorkerManager
      vi.resetModules();
      vi.doMock('./templates.js', () => ({
        TaskTemplateEngine: {
          getInstance: vi.fn(() => ({
            getTemplate: vi.fn().mockReturnValue(undefined),
            buildPrompt: vi.fn(),
          })),
        },
      }));
      vi.doMock('./notifications.js', () => ({
        NotificationService: {
          getInstance: vi.fn(() => ({
            notifyTaskStarted: vi.fn(),
            notifyTaskCompleted: vi.fn(),
            notifyTaskFailed: vi.fn(),
          })),
        },
      }));

      const mod = await import('./executor.js');
      const FreshExecutor = mod.TaskExecutor;
      const executor = FreshExecutor.getInstance();

      const result = await executor.execute({
        id: 'task-no-wm',
        name: 'test-task',
        trigger: 'manual',
        priority: 'normal',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('WorkerManager not configured');
    });

    it('should include trigger event in generic prompt', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue(undefined);

      const executePromise = executor.execute({
        id: 'task-evt123',
        name: 'event-task',
        trigger: 'webhook',
        triggerEvent: 'push',
        repository: 'org/repo',
        payload: { ref: 'refs/heads/main' },
        priority: 'high',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-event-task-evt123';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Done',
        durationMs: 500,
      });

      const result = await executePromise;
      expect(result.success).toBe(true);

      // Check that spawnWorker was called with the prompt containing trigger info
      const spawnCall = mockWorkerManager.spawnWorker.mock.calls[0][0];
      expect(spawnCall.initialPrompt).toContain('event-task');
      expect(spawnCall.initialPrompt).toContain('webhook');
      expect(spawnCall.initialPrompt).toContain('push');
      expect(spawnCall.initialPrompt).toContain('org/repo');
    });
  });

  // ==========================================================================
  // execute() - with template
  // ==========================================================================

  describe('execute() - with template', () => {
    it('should execute a templated task and notify on start and complete', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue({
        id: 'update-documentation',
        name: 'Update Documentation',
        category: 'documentation',
        role: 'tech-writer',
        prompt: 'Update docs',
        notifyOn: ['start', 'complete'],
      });
      mockBuildPrompt.mockReturnValue('Full prompt with context');

      const executePromise = executor.execute({
        id: 'task-doc456',
        name: 'update-documentation',
        trigger: 'cron',
        repository: 'org/repo',
        priority: 'normal',
        payload: { branch: 'main' },
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockNotifyTaskStarted).toHaveBeenCalledWith(
        'update-documentation',
        'org/repo',
        'task-doc456'
      );

      const handle = 'auto-update-documentation-doc456';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Docs updated. See https://github.com/org/repo/pull/42 and commit abc1234def',
        durationMs: 5000,
      });

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.prUrl).toBe('https://github.com/org/repo/pull/42');
      expect(result.commitSha).toBe('abc1234def');
      expect(mockNotifyTaskCompleted).toHaveBeenCalled();
    });

    it('should notify on error when template has error notification', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue({
        id: 'security-scan',
        name: 'Security Scan',
        category: 'security',
        role: 'security-engineer',
        prompt: 'Scan for vulnerabilities',
        notifyOn: ['error'],
      });
      mockBuildPrompt.mockReturnValue('Security scan prompt');

      const executePromise = executor.execute({
        id: 'task-sec789',
        name: 'security-scan',
        trigger: 'manual',
        priority: 'critical',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-security-scan-sec789';
      mockWorkerManager.emit('worker:error', {
        handle,
        error: 'Worker crashed',
      });

      const result = await executePromise;
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Worker crashed');
      expect(mockNotifyTaskFailed).toHaveBeenCalledWith(
        'security-scan',
        'Worker crashed',
        undefined,
        'task-sec789'
      );
    });

    it('should use category-to-role mapping when template has no role', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue({
        id: 'test-gen',
        name: 'Generate Tests',
        category: 'testing',
        role: '',
        prompt: 'Generate tests',
        notifyOn: [],
      });
      mockBuildPrompt.mockReturnValue('Test generation prompt');

      const executePromise = executor.execute({
        id: 'task-tst111',
        name: 'test-gen',
        trigger: 'manual',
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify spawnWorker was called with qa-engineer role
      expect(mockWorkerManager.spawnWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'qa-engineer',
        })
      );

      // Clean up
      const handle = 'auto-test-gen-tst111';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Tests generated',
      });

      await executePromise;
    });

    it('should fall back to worker role when category is unknown', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue({
        id: 'custom-task',
        name: 'Custom Task',
        category: 'unknown-category',
        role: '',
        prompt: 'Do custom work',
        notifyOn: [],
      });
      mockBuildPrompt.mockReturnValue('Custom prompt');

      const executePromise = executor.execute({
        id: 'task-cus222',
        name: 'custom-task',
        trigger: 'manual',
        priority: 'low',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockWorkerManager.spawnWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'worker',
        })
      );

      const handle = 'auto-custom-task-cus222';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Done',
      });

      await executePromise;
    });

    it('should not notify when template has no notifyOn config', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue({
        id: 'quiet-task',
        name: 'Quiet Task',
        category: 'maintenance',
        role: 'fullstack-dev',
        prompt: 'Work quietly',
        // No notifyOn
      });
      mockBuildPrompt.mockReturnValue('Quiet prompt');

      const executePromise = executor.execute({
        id: 'task-qui333',
        name: 'quiet-task',
        trigger: 'manual',
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-quiet-task-qui333';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Done quietly',
      });

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(mockNotifyTaskStarted).not.toHaveBeenCalled();
      expect(mockNotifyTaskCompleted).not.toHaveBeenCalled();
    });

    it('should emit taskCompleted event on success', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue({
        id: 'emit-task',
        name: 'Emit Task',
        category: 'maintenance',
        role: 'worker',
        prompt: 'Do work',
        notifyOn: [],
      });
      mockBuildPrompt.mockReturnValue('Prompt');

      const completedSpy = vi.fn();
      executor.on('taskCompleted', completedSpy);

      const executePromise = executor.execute({
        id: 'task-emt444',
        name: 'emit-task',
        trigger: 'manual',
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-emit-task-emt444';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Completed',
      });

      await executePromise;
      expect(completedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ name: 'emit-task' }),
        })
      );
    });

    it('should emit taskFailed event on error', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue({
        id: 'fail-task',
        name: 'Fail Task',
        category: 'maintenance',
        role: 'worker',
        prompt: 'Fail gracefully',
        notifyOn: [],
      });
      mockBuildPrompt.mockReturnValue('Prompt');

      const failedSpy = vi.fn();
      executor.on('taskFailed', failedSpy);

      const executePromise = executor.execute({
        id: 'task-fal555',
        name: 'fail-task',
        trigger: 'manual',
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-fail-task-fal555';
      mockWorkerManager.emit('worker:error', {
        handle,
        error: 'Something broke',
      });

      await executePromise;
      expect(failedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Something broke',
        })
      );
    });
  });

  // ==========================================================================
  // handleWorkerResult() - PR URL and commit SHA parsing
  // ==========================================================================

  describe('handleWorkerResult()', () => {
    it('should parse PR URL from worker result', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue(undefined);

      const executePromise = executor.execute({
        id: 'task-pr-001',
        name: 'pr-task',
        trigger: 'manual',
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-pr-task-pr-001';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Created PR at https://github.com/myorg/myrepo/pull/99',
      });

      const result = await executePromise;
      expect(result.output).toContain('https://github.com/myorg/myrepo/pull/99');
    });

    it('should parse commit SHA from worker result', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue(undefined);

      const executePromise = executor.execute({
        id: 'task-cm-002',
        name: 'commit-task',
        trigger: 'manual',
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-commit-task-cm-002';
      mockWorkerManager.emit('worker:result', {
        handle,
        result: 'Changes applied in commit abc1234',
      });

      const result = await executePromise;
      expect(result.output).toContain('commit abc1234');
    });

    it('should ignore non-auto handles', () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      // Emit a result for a non-auto worker - should be silently ignored
      mockWorkerManager.emit('worker:result', {
        handle: 'manual-worker-1',
        result: 'Some result',
      });

      // No error, no running tasks affected
      expect(executor.getRunningCount()).toBe(0);
    });
  });

  // ==========================================================================
  // handleWorkerExit()
  // ==========================================================================

  describe('handleWorkerExit()', () => {
    it('should treat exit code 0 as completion for running tasks', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue(undefined);

      const executePromise = executor.execute({
        id: 'task-ex-001',
        name: 'exit-task',
        trigger: 'manual',
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-exit-task-ex-001';
      mockWorkerManager.emit('worker:exit', {
        handle,
        code: 0,
      });

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.output).toBe('Task completed');
    });

    it('should treat non-zero exit code as error for running tasks', async () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockGetTemplate.mockReturnValue(undefined);

      const executePromise = executor.execute({
        id: 'task-ex-002',
        name: 'fail-exit',
        trigger: 'manual',
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const handle = 'auto-fail-exit-ex-002';
      mockWorkerManager.emit('worker:exit', {
        handle,
        code: 1,
      });

      const result = await executePromise;
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('Worker exited with code 1');
    });

    it('should ignore exit events for non-auto handles', () => {
      const executor = TaskExecutor.getInstance();
      executor.configure({
        workerManager: mockWorkerManager as unknown as import('../workers/manager.js').WorkerManager,
      });

      mockWorkerManager.emit('worker:exit', {
        handle: 'manual-worker-2',
        code: 0,
      });

      expect(executor.getRunningCount()).toBe(0);
    });
  });
});
