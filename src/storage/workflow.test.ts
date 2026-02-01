/**
 * Tests for WorkflowStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { WorkflowStorage } from './workflow.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';
import type { WorkflowDefinition } from '../types.js';

describe('WorkflowStorage', () => {
  let ctx: TestStorageContext;
  let workflows: WorkflowStorage;

  const simpleDefinition: WorkflowDefinition = {
    steps: [
      {
        key: 'step-a',
        name: 'Step A',
        type: 'task',
        config: { type: 'task', title: 'Do A', description: 'First step' },
      },
      {
        key: 'step-b',
        name: 'Step B',
        type: 'task',
        dependsOn: ['step-a'],
        config: { type: 'task', title: 'Do B', description: 'Second step' },
      },
      {
        key: 'step-c',
        name: 'Step C',
        type: 'task',
        dependsOn: ['step-a'],
        config: { type: 'task', title: 'Do C', description: 'Parallel with B' },
      },
      {
        key: 'step-d',
        name: 'Step D',
        type: 'task',
        dependsOn: ['step-b', 'step-c'],
        config: { type: 'task', title: 'Do D', description: 'Final step' },
      },
    ],
  };

  beforeEach(() => {
    ctx = createTestStorage();
    workflows = new WorkflowStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // Workflow CRUD
  // ==========================================================================

  describe('createWorkflow()', () => {
    it('should create a workflow with definition', () => {
      const wf = workflows.createWorkflow('test-wf', simpleDefinition);

      expect(wf.id).toBeDefined();
      expect(wf.name).toBe('test-wf');
      expect(wf.version).toBe(1);
      expect(wf.definition.steps).toHaveLength(4);
      expect(wf.isTemplate).toBe(false);
    });

    it('should create as template', () => {
      const wf = workflows.createWorkflow('template-wf', simpleDefinition, { isTemplate: true, description: 'A template' });

      expect(wf.isTemplate).toBe(true);
      expect(wf.description).toBe('A template');
    });
  });

  describe('getWorkflow() / getWorkflowByName()', () => {
    it('should retrieve by id', () => {
      const created = workflows.createWorkflow('wf', simpleDefinition);
      const retrieved = workflows.getWorkflow(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('wf');
    });

    it('should retrieve by name', () => {
      workflows.createWorkflow('named-wf', simpleDefinition);
      const retrieved = workflows.getWorkflowByName('named-wf');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('named-wf');
    });

    it('should return null for missing', () => {
      expect(workflows.getWorkflow('no-such-id')).toBeNull();
      expect(workflows.getWorkflowByName('no-such-name')).toBeNull();
    });
  });

  describe('listWorkflows()', () => {
    it('should list all workflows', () => {
      workflows.createWorkflow('wf1', simpleDefinition);
      workflows.createWorkflow('wf2', simpleDefinition);
      workflows.createWorkflow('tmpl', simpleDefinition, { isTemplate: true });

      const all = workflows.listWorkflows();
      expect(all).toHaveLength(3);
    });

    it('should filter by template flag', () => {
      workflows.createWorkflow('wf1', simpleDefinition);
      workflows.createWorkflow('tmpl', simpleDefinition, { isTemplate: true });

      const templates = workflows.listWorkflows({ isTemplate: true });
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('tmpl');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 5; i++) {
        workflows.createWorkflow(`wf-${i}`, simpleDefinition);
      }
      const limited = workflows.listWorkflows({ limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe('updateWorkflow()', () => {
    it('should update definition and increment version', () => {
      const wf = workflows.createWorkflow('updatable', simpleDefinition);
      const newDef: WorkflowDefinition = { steps: [{ key: 'only', name: 'Only Step', type: 'task', config: { type: 'task', title: 'X', description: 'Y' } }] };

      const updated = workflows.updateWorkflow(wf.id, newDef, 'Updated desc');
      expect(updated).toBe(true);

      const retrieved = workflows.getWorkflow(wf.id);
      expect(retrieved!.version).toBe(2);
      expect(retrieved!.definition.steps).toHaveLength(1);
      expect(retrieved!.description).toBe('Updated desc');
    });

    it('should return false for non-existent', () => {
      const result = workflows.updateWorkflow('fake-id', simpleDefinition);
      expect(result).toBe(false);
    });
  });

  describe('deleteWorkflow()', () => {
    it('should delete a workflow', () => {
      const wf = workflows.createWorkflow('deletable', simpleDefinition);
      const deleted = workflows.deleteWorkflow(wf.id);

      expect(deleted).toBe(true);
      expect(workflows.getWorkflow(wf.id)).toBeNull();
    });

    it('should return false for non-existent', () => {
      expect(workflows.deleteWorkflow('fake-id')).toBe(false);
    });
  });

  // ==========================================================================
  // Execution management
  // ==========================================================================

  describe('createExecution()', () => {
    it('should create an execution', () => {
      const wf = workflows.createWorkflow('exec-wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead-agent', { swarmId: 'swarm-1', context: { branch: 'main' } });

      expect(exec.id).toBeDefined();
      expect(exec.workflowId).toBe(wf.id);
      expect(exec.status).toBe('pending');
      expect(exec.context).toEqual({ branch: 'main' });
      expect(exec.createdBy).toBe('lead-agent');
    });
  });

  describe('getExecution()', () => {
    it('should retrieve by id', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      const retrieved = workflows.getExecution(exec.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.workflowId).toBe(wf.id);
    });

    it('should return null for missing', () => {
      expect(workflows.getExecution('fake')).toBeNull();
    });
  });

  describe('listExecutions()', () => {
    it('should filter by workflow id and status', () => {
      const wf1 = workflows.createWorkflow('wf1', simpleDefinition);
      const wf2 = workflows.createWorkflow('wf2', simpleDefinition);
      workflows.createExecution(wf1.id, 'lead');
      workflows.createExecution(wf1.id, 'lead');
      workflows.createExecution(wf2.id, 'lead');

      const all = workflows.listExecutions({ workflowId: wf1.id });
      expect(all).toHaveLength(2);

      const pending = workflows.listExecutions({ status: 'pending' });
      expect(pending).toHaveLength(3);
    });
  });

  describe('updateExecutionStatus()', () => {
    it('should set running with startedAt', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');

      const updated = workflows.updateExecutionStatus(exec.id, 'running');
      expect(updated).toBe(true);

      const retrieved = workflows.getExecution(exec.id);
      expect(retrieved!.status).toBe('running');
      expect(retrieved!.startedAt).not.toBeNull();
    });

    it('should set completed with completedAt', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      workflows.updateExecutionStatus(exec.id, 'running');
      workflows.updateExecutionStatus(exec.id, 'completed');

      const retrieved = workflows.getExecution(exec.id);
      expect(retrieved!.status).toBe('completed');
      expect(retrieved!.completedAt).not.toBeNull();
    });

    it('should set failed with error', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');

      workflows.updateExecutionStatus(exec.id, 'failed', 'Something went wrong');

      const retrieved = workflows.getExecution(exec.id);
      expect(retrieved!.status).toBe('failed');
      expect(retrieved!.error).toBe('Something went wrong');
    });
  });

  describe('setExecutionContext()', () => {
    it('should update context', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');

      workflows.setExecutionContext(exec.id, { key: 'value', step: 2 });

      const retrieved = workflows.getExecution(exec.id);
      expect(retrieved!.context).toEqual({ key: 'value', step: 2 });
    });
  });

  // ==========================================================================
  // Step management (DAG)
  // ==========================================================================

  describe('createStepsFromDefinition()', () => {
    it('should create steps and mark root steps as ready', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');

      const steps = workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      expect(steps).toHaveLength(4);

      const stepA = steps.find(s => s.stepKey === 'step-a');
      expect(stepA!.status).toBe('ready'); // No dependencies
      expect(stepA!.blockedByCount).toBe(0);

      const stepB = steps.find(s => s.stepKey === 'step-b');
      expect(stepB!.status).toBe('pending'); // Depends on step-a
      expect(stepB!.blockedByCount).toBe(1);

      const stepD = steps.find(s => s.stepKey === 'step-d');
      expect(stepD!.status).toBe('pending'); // Depends on step-b and step-c
      expect(stepD!.blockedByCount).toBe(2);
    });
  });

  describe('getStep() / getStepByKey()', () => {
    it('should retrieve step by id', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      const steps = workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      const found = workflows.getStep(steps[0].id);
      expect(found).not.toBeNull();
    });

    it('should retrieve step by key', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      const found = workflows.getStepByKey(exec.id, 'step-b');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Step B');
    });

    it('should return null for missing', () => {
      expect(workflows.getStep('fake')).toBeNull();
      expect(workflows.getStepByKey('fake-exec', 'fake-key')).toBeNull();
    });
  });

  describe('getStepsByExecution()', () => {
    it('should return all steps for an execution', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      const steps = workflows.getStepsByExecution(exec.id);
      expect(steps).toHaveLength(4);
    });
  });

  describe('getReadySteps()', () => {
    it('should return only ready steps', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      const ready = workflows.getReadySteps(exec.id);
      expect(ready).toHaveLength(1);
      expect(ready[0].stepKey).toBe('step-a');
    });
  });

  describe('updateStepStatus()', () => {
    it('should set running with startedAt', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      const steps = workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      const stepA = steps.find(s => s.stepKey === 'step-a')!;
      workflows.updateStepStatus(stepA.id, 'running');

      const retrieved = workflows.getStep(stepA.id);
      expect(retrieved!.status).toBe('running');
      expect(retrieved!.startedAt).not.toBeNull();
    });

    it('should set completed with output', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      const steps = workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      const stepA = steps.find(s => s.stepKey === 'step-a')!;
      workflows.updateStepStatus(stepA.id, 'completed', { result: 'done' });

      const retrieved = workflows.getStep(stepA.id);
      expect(retrieved!.status).toBe('completed');
      expect(retrieved!.output).toEqual({ result: 'done' });
    });

    it('should set failed with error', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      const steps = workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      const stepA = steps.find(s => s.stepKey === 'step-a')!;
      workflows.updateStepStatus(stepA.id, 'failed', undefined, 'Crash');

      const retrieved = workflows.getStep(stepA.id);
      expect(retrieved!.status).toBe('failed');
      expect(retrieved!.error).toBe('Crash');
    });
  });

  describe('assignStep()', () => {
    it('should assign a worker to a step', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      const steps = workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      const stepA = steps.find(s => s.stepKey === 'step-a')!;
      const assigned = workflows.assignStep(stepA.id, 'worker-1');

      expect(assigned).toBe(true);

      const retrieved = workflows.getStep(stepA.id);
      expect(retrieved!.assignedTo).toBe('worker-1');
    });
  });

  // ==========================================================================
  // Triggers
  // ==========================================================================

  describe('triggers', () => {
    it('should create and retrieve a trigger', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const trigger = workflows.createTrigger(wf.id, 'schedule', { type: 'schedule', cron: '0 * * * *' });

      expect(trigger.id).toBeDefined();
      expect(trigger.triggerType).toBe('schedule');
      expect(trigger.isEnabled).toBe(true);
      expect(trigger.fireCount).toBe(0);

      const retrieved = workflows.getTrigger(trigger.id);
      expect(retrieved).not.toBeNull();
    });

    it('should get triggers by workflow', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      workflows.createTrigger(wf.id, 'schedule', { type: 'schedule', cron: '0 * * * *' });
      workflows.createTrigger(wf.id, 'webhook', { type: 'webhook', path: '/hook' });

      const triggers = workflows.getTriggersByWorkflow(wf.id);
      expect(triggers).toHaveLength(2);
    });

    it('should toggle trigger enabled status', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const trigger = workflows.createTrigger(wf.id, 'schedule', { type: 'schedule', cron: '0 * * * *' });

      workflows.setTriggerEnabled(trigger.id, false);

      const retrieved = workflows.getTrigger(trigger.id);
      expect(retrieved!.isEnabled).toBe(false);
    });

    it('should record trigger fired', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const trigger = workflows.createTrigger(wf.id, 'schedule', { type: 'schedule', cron: '0 * * * *' });

      workflows.recordTriggerFired(trigger.id);
      workflows.recordTriggerFired(trigger.id);

      const retrieved = workflows.getTrigger(trigger.id);
      expect(retrieved!.fireCount).toBe(2);
      expect(retrieved!.lastFiredAt).not.toBeNull();
    });

    it('should delete a trigger', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const trigger = workflows.createTrigger(wf.id, 'schedule', { type: 'schedule', cron: '0 * * * *' });

      expect(workflows.deleteTrigger(trigger.id)).toBe(true);
      expect(workflows.getTrigger(trigger.id)).toBeNull();
    });
  });

  // ==========================================================================
  // Events
  // ==========================================================================

  describe('events', () => {
    it('should log and retrieve events', () => {
      const wf = workflows.createWorkflow('wf', simpleDefinition);
      const exec = workflows.createExecution(wf.id, 'lead');
      const steps = workflows.createStepsFromDefinition(exec.id, simpleDefinition);

      workflows.logEvent(exec.id, 'started', { actor: 'lead', details: { reason: 'manual' } });
      workflows.logEvent(exec.id, 'step_completed', { stepId: steps[0].id, actor: 'worker-1' });

      const events = workflows.getEvents(exec.id);
      expect(events).toHaveLength(2);
    });
  });
});
