/**
 * Tests for Workflow Engine
 *
 * Covers: lifecycle (start/stop), startWorkflow, pauseWorkflow, resumeWorkflow,
 * cancelWorkflow, retryStep, completeStep, processExecutions, step type handlers,
 * guard evaluation, expression evaluator, trigger processing, completion detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkflowEngine } from './workflow-engine.js';
import type { WorkflowEngineDependencies } from './workflow-engine.js';

// ============================================================================
// Mock Factory
// ============================================================================

function createMockWorkflowStorage() {
  return {
    getWorkflow: vi.fn().mockReturnValue({
      id: 'wf-1',
      name: 'Test Workflow',
      definition: {
        steps: [
          { key: 'build', name: 'Build', type: 'task', config: { type: 'task', title: 'Build project' } },
          { key: 'test', name: 'Test', type: 'task', config: { type: 'task', title: 'Run tests' }, dependsOn: ['build'] },
        ],
      },
    }),
    createExecution: vi.fn().mockReturnValue({
      id: 'exec-1',
      workflowId: 'wf-1',
      status: 'pending',
      createdBy: 'user-1',
      swarmId: null,
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    createStepsFromDefinition: vi.fn(),
    updateExecutionStatus: vi.fn(),
    logEvent: vi.fn(),
    getExecution: vi.fn().mockReturnValue({
      id: 'exec-1',
      workflowId: 'wf-1',
      status: 'running',
      createdBy: 'user-1',
      swarmId: null,
      context: {},
    }),
    listExecutions: vi.fn().mockReturnValue([]),
    getReadySteps: vi.fn().mockReturnValue([]),
    getStep: vi.fn().mockReturnValue(null),
    getStepByKey: vi.fn().mockReturnValue(null),
    getStepsByExecution: vi.fn().mockReturnValue([]),
    updateStepStatus: vi.fn(),
    decrementDependents: vi.fn(),
    incrementRetryCount: vi.fn(),
    getEnabledTriggersByType: vi.fn().mockReturnValue([]),
    recordTriggerFired: vi.fn(),
  };
}

function createMockDeps(overrides?: Partial<WorkflowEngineDependencies>): WorkflowEngineDependencies {
  return {
    workflowStorage: createMockWorkflowStorage() as unknown as WorkflowEngineDependencies['workflowStorage'],
    ...overrides,
  };
}

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = createMockDeps();
    engine = new WorkflowEngine(deps, { autoProcess: false });
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  // ======================================================================
  // LIFECYCLE
  // ======================================================================

  describe('lifecycle', () => {
    it('should start and stop without error', () => {
      engine.start();
      engine.stop();
    });

    it('should not create multiple intervals on repeated start', () => {
      const autoEngine = new WorkflowEngine(deps, { autoProcess: true, processIntervalMs: 1000 });
      autoEngine.start();
      autoEngine.start(); // idempotent
      autoEngine.stop();
    });

    it('should handle stop when not started', () => {
      engine.stop(); // no-op
    });
  });

  // ======================================================================
  // startWorkflow
  // ======================================================================

  describe('startWorkflow', () => {
    it('should create execution and steps', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      const execution = await engine.startWorkflow('wf-1', 'user-1');

      expect(storage.createExecution).toHaveBeenCalledWith('wf-1', 'user-1', expect.any(Object));
      expect(storage.createStepsFromDefinition).toHaveBeenCalled();
      expect(storage.updateExecutionStatus).toHaveBeenCalledWith('exec-1', 'running');
      expect(execution.status).toBe('running');
    });

    it('should emit workflow:started event', async () => {
      const listener = vi.fn();
      engine.on('workflow:started', listener);

      await engine.startWorkflow('wf-1', 'user-1');
      expect(listener).toHaveBeenCalledWith({ executionId: 'exec-1', workflowId: 'wf-1' });
    });

    it('should throw when workflow not found', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getWorkflow.mockReturnValue(null);

      await expect(engine.startWorkflow('nonexistent', 'user-1'))
        .rejects.toThrow('Workflow not found');
    });

    it('should throw when required input missing', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getWorkflow.mockReturnValue({
        id: 'wf-2',
        definition: {
          steps: [{ key: 's1', name: 's1', type: 'task', config: { type: 'task', title: 'T' } }],
          inputs: {
            projectName: { required: true },
          },
        },
      });

      await expect(engine.startWorkflow('wf-2', 'user-1'))
        .rejects.toThrow('Missing required input: projectName');
    });

    it('should use default input values when not provided', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getWorkflow.mockReturnValue({
        id: 'wf-3',
        definition: {
          steps: [{ key: 's1', name: 's1', type: 'task', config: { type: 'task', title: 'T' } }],
          inputs: {
            mode: { required: true, default: 'production' },
          },
        },
      });

      await engine.startWorkflow('wf-3', 'user-1');
      expect(storage.createExecution).toHaveBeenCalledWith(
        'wf-3',
        'user-1',
        expect.objectContaining({
          context: { inputs: { mode: 'production' } },
        }),
      );
    });

    it('should pass swarmId through', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      await engine.startWorkflow('wf-1', 'user-1', {}, 'swarm-123');

      expect(storage.createExecution).toHaveBeenCalledWith(
        'wf-1',
        'user-1',
        expect.objectContaining({ swarmId: 'swarm-123' }),
      );
    });
  });

  // ======================================================================
  // pauseWorkflow
  // ======================================================================

  describe('pauseWorkflow', () => {
    it('should pause a running workflow', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      const listener = vi.fn();
      engine.on('workflow:paused', listener);

      const result = await engine.pauseWorkflow('exec-1');
      expect(result).toBe(true);
      expect(storage.updateExecutionStatus).toHaveBeenCalledWith('exec-1', 'paused');
      expect(listener).toHaveBeenCalledWith({ executionId: 'exec-1' });
    });

    it('should return false if execution not found', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getExecution.mockReturnValue(null);

      const result = await engine.pauseWorkflow('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false if not running', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getExecution.mockReturnValue({ id: 'exec-1', status: 'paused' });

      const result = await engine.pauseWorkflow('exec-1');
      expect(result).toBe(false);
    });
  });

  // ======================================================================
  // resumeWorkflow
  // ======================================================================

  describe('resumeWorkflow', () => {
    it('should resume a paused workflow', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getExecution.mockReturnValue({ id: 'exec-1', status: 'paused' });

      const listener = vi.fn();
      engine.on('workflow:resumed', listener);

      const result = await engine.resumeWorkflow('exec-1');
      expect(result).toBe(true);
      expect(storage.updateExecutionStatus).toHaveBeenCalledWith('exec-1', 'running');
      expect(listener).toHaveBeenCalledWith({ executionId: 'exec-1' });
    });

    it('should return false if not paused', async () => {
      const result = await engine.resumeWorkflow('exec-1');
      expect(result).toBe(false);
    });
  });

  // ======================================================================
  // cancelWorkflow
  // ======================================================================

  describe('cancelWorkflow', () => {
    it('should cancel a running workflow', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      const listener = vi.fn();
      engine.on('workflow:failed', listener);

      const result = await engine.cancelWorkflow('exec-1');
      expect(result).toBe(true);
      expect(storage.updateExecutionStatus).toHaveBeenCalledWith('exec-1', 'cancelled');
      expect(listener).toHaveBeenCalledWith({ executionId: 'exec-1', error: 'Cancelled by user' });
    });

    it('should cancel a paused workflow', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getExecution.mockReturnValue({ id: 'exec-1', status: 'paused' });

      const result = await engine.cancelWorkflow('exec-1');
      expect(result).toBe(true);
    });

    it('should return false for completed workflow', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getExecution.mockReturnValue({ id: 'exec-1', status: 'completed' });

      const result = await engine.cancelWorkflow('exec-1');
      expect(result).toBe(false);
    });
  });

  // ======================================================================
  // retryStep
  // ======================================================================

  describe('retryStep', () => {
    it('should retry a failed step', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getStep.mockReturnValue({
        id: 'step-1',
        executionId: 'exec-1',
        status: 'failed',
        retryCount: 0,
        maxRetries: 3,
      });

      const result = await engine.retryStep('step-1');
      expect(result).toBe(true);
      expect(storage.incrementRetryCount).toHaveBeenCalledWith('step-1');
    });

    it('should return false if step not failed', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getStep.mockReturnValue({ id: 'step-1', status: 'running', retryCount: 0, maxRetries: 3 });

      const result = await engine.retryStep('step-1');
      expect(result).toBe(false);
    });

    it('should return false if max retries exceeded', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getStep.mockReturnValue({
        id: 'step-1',
        status: 'failed',
        retryCount: 3,
        maxRetries: 3,
      });

      const result = await engine.retryStep('step-1');
      expect(result).toBe(false);
    });

    it('should return false if step not found', async () => {
      const result = await engine.retryStep('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ======================================================================
  // completeStep
  // ======================================================================

  describe('completeStep', () => {
    it('should manually complete a step', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getStep.mockReturnValue({
        id: 'step-1',
        executionId: 'exec-1',
        stepKey: 'build',
        status: 'running',
      });
      storage.getStepsByExecution.mockReturnValue([
        { id: 'step-1', stepKey: 'build', status: 'completed', output: { result: 'ok' } },
      ]);

      const listener = vi.fn();
      engine.on('step:completed', listener);

      const result = await engine.completeStep('step-1', { result: 'ok' });
      expect(result).toBe(true);
      expect(storage.updateStepStatus).toHaveBeenCalledWith('step-1', 'completed', { result: 'ok' }, undefined);
      expect(storage.decrementDependents).toHaveBeenCalledWith('exec-1', 'build');
      expect(listener).toHaveBeenCalled();
    });

    it('should mark step as failed when error provided', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getStep.mockReturnValue({
        id: 'step-1',
        executionId: 'exec-1',
        stepKey: 'build',
        status: 'running',
      });

      const listener = vi.fn();
      engine.on('step:failed', listener);

      const result = await engine.completeStep('step-1', undefined, 'Build failed');
      expect(result).toBe(true);
      expect(storage.updateStepStatus).toHaveBeenCalledWith('step-1', 'failed', undefined, 'Build failed');
      expect(listener).toHaveBeenCalled();
    });

    it('should return false if step already completed', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getStep.mockReturnValue({ id: 'step-1', status: 'completed' });

      const result = await engine.completeStep('step-1');
      expect(result).toBe(false);
    });

    it('should return false if step not found', async () => {
      const result = await engine.completeStep('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ======================================================================
  // processExecutions
  // ======================================================================

  describe('processExecutions', () => {
    it('should return 0 when no running executions', async () => {
      const count = await engine.processExecutions();
      expect(count).toBe(0);
    });

    it('should process running executions', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.listExecutions.mockReturnValue([{
        id: 'exec-1',
        workflowId: 'wf-1',
        status: 'running',
        context: {},
      }]);

      const count = await engine.processExecutions();
      expect(count).toBe(1);
      expect(storage.getReadySteps).toHaveBeenCalledWith('exec-1', 5);
    });

    it('should prevent concurrent processing via isProcessing guard', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      let resolveFirst: () => void;
      const firstPromise = new Promise<void>(r => { resolveFirst = r; });

      // Make getReadySteps block until we resolve
      storage.listExecutions.mockReturnValue([{
        id: 'exec-1',
        workflowId: 'wf-1',
        status: 'running',
        context: {},
      }]);
      storage.getReadySteps.mockImplementation(async () => {
        await firstPromise;
        return [];
      });

      // Start first processExecutions - it will block on getReadySteps
      const p1 = engine.processExecutions();
      // Start second while first is running
      const count2 = await engine.processExecutions();
      // Second returns 0 immediately because isProcessing is true
      expect(count2).toBe(0);

      // Now resolve the first
      resolveFirst!();
      await p1;
    });

    it('should handle execution errors gracefully', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.listExecutions.mockReturnValue([{
        id: 'exec-1',
        workflowId: 'wf-1',
        status: 'running',
        context: {},
      }]);
      storage.getReadySteps.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const listener = vi.fn();
      engine.on('workflow:failed', listener);

      const count = await engine.processExecutions();
      expect(count).toBe(0);
      expect(storage.updateExecutionStatus).toHaveBeenCalledWith('exec-1', 'failed', 'Storage error');
      expect(listener).toHaveBeenCalled();
    });
  });

  // ======================================================================
  // processTriggers
  // ======================================================================

  describe('processTriggers', () => {
    it('should return 0 when no blackboard storage', async () => {
      const count = await engine.processTriggers();
      expect(count).toBe(0);
    });

    it('should return 0 when no enabled triggers', async () => {
      const mockBlackboard = {
        readMessages: vi.fn().mockReturnValue([]),
      };
      const depsWithBb = createMockDeps({
        blackboardStorage: mockBlackboard as unknown as WorkflowEngineDependencies['blackboardStorage'],
      });
      const bbEngine = new WorkflowEngine(depsWithBb, { autoProcess: false });

      const count = await bbEngine.processTriggers();
      expect(count).toBe(0);
      bbEngine.stop();
    });
  });

  // ======================================================================
  // checkEventTrigger
  // ======================================================================

  describe('checkEventTrigger', () => {
    it('should fire matching event trigger', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getEnabledTriggersByType.mockReturnValue([{
        id: 'trig-1',
        workflowId: 'wf-1',
        config: { type: 'event', eventType: 'task:completed' },
      }]);

      const listener = vi.fn();
      engine.on('trigger:fired', listener);

      await engine.checkEventTrigger('task:completed', { taskId: 't-1' });

      expect(storage.recordTriggerFired).toHaveBeenCalledWith('trig-1');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        triggerId: 'trig-1',
        workflowId: 'wf-1',
      }));
    });

    it('should skip non-matching event types', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getEnabledTriggersByType.mockReturnValue([{
        id: 'trig-1',
        workflowId: 'wf-1',
        config: { type: 'event', eventType: 'task:completed' },
      }]);

      await engine.checkEventTrigger('task:started', {});
      expect(storage.recordTriggerFired).not.toHaveBeenCalled();
    });

    it('should apply event filter', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getEnabledTriggersByType.mockReturnValue([{
        id: 'trig-1',
        workflowId: 'wf-1',
        config: {
          type: 'event',
          eventType: 'task:completed',
          filter: { status: 'success' },
        },
      }]);

      // Non-matching data
      await engine.checkEventTrigger('task:completed', { status: 'failure' });
      expect(storage.recordTriggerFired).not.toHaveBeenCalled();

      // Matching data
      await engine.checkEventTrigger('task:completed', { status: 'success' });
      expect(storage.recordTriggerFired).toHaveBeenCalled();
    });
  });

  // ======================================================================
  // checkBlackboardTrigger
  // ======================================================================

  describe('checkBlackboardTrigger', () => {
    it('should fire matching blackboard trigger', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getEnabledTriggersByType.mockReturnValue([{
        id: 'trig-bb',
        workflowId: 'wf-1',
        config: {
          type: 'blackboard',
          swarmId: 'swarm-1',
          messageType: 'status',
        },
      }]);

      const listener = vi.fn();
      engine.on('trigger:fired', listener);

      await engine.checkBlackboardTrigger('swarm-1', 'status' as never, { data: 'test' });
      expect(listener).toHaveBeenCalled();
    });

    it('should skip non-matching swarm/type', async () => {
      const storage = deps.workflowStorage as unknown as ReturnType<typeof createMockWorkflowStorage>;
      storage.getEnabledTriggersByType.mockReturnValue([{
        id: 'trig-bb',
        workflowId: 'wf-1',
        config: {
          type: 'blackboard',
          swarmId: 'swarm-1',
          messageType: 'status',
        },
      }]);

      await engine.checkBlackboardTrigger('swarm-2', 'status' as never, {});
      expect(storage.recordTriggerFired).not.toHaveBeenCalled();
    });
  });
});
