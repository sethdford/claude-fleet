/**
 * Workflow Engine
 *
 * Orchestrates workflow execution with:
 * - DAG traversal using Kahn's algorithm
 * - State machine transitions with guard evaluation
 * - Event-driven trigger processing
 * - Integration with WorkerManager, SpawnController, etc.
 */

import { EventEmitter } from 'node:events';
import type { WorkflowStorage } from '../storage/workflow.js';
import type { IWorkItemStorage, IBlackboardStorage } from '../storage/interfaces.js';
import type {
  WorkflowExecution,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowGuard,
  WorkflowTrigger,
  TaskStepConfig,
  SpawnStepConfig,
  CheckpointStepConfig,
  GateStepConfig,
  ScriptStepConfig,
  BlackboardMessageType,
} from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface WorkflowEngineEvents {
  'workflow:started': { executionId: string; workflowId: string };
  'workflow:completed': { executionId: string; outputs: Record<string, unknown> };
  'workflow:failed': { executionId: string; error: string };
  'workflow:paused': { executionId: string };
  'workflow:resumed': { executionId: string };
  'step:started': { executionId: string; stepId: string; stepKey: string };
  'step:completed': { executionId: string; stepId: string; output: Record<string, unknown> };
  'step:failed': { executionId: string; stepId: string; error: string };
  'trigger:fired': { triggerId: string; workflowId: string; executionId: string };
}

export interface WorkflowEngineOptions {
  processIntervalMs?: number;
  autoProcess?: boolean;
  maxConcurrentSteps?: number;
}

export interface WorkflowEngineDependencies {
  workflowStorage: WorkflowStorage;
  workItemStorage?: IWorkItemStorage;
  blackboardStorage?: IBlackboardStorage;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PROCESS_INTERVAL_MS = 5000;
const DEFAULT_MAX_CONCURRENT_STEPS = 5;

// ============================================================================
// WORKFLOW ENGINE
// ============================================================================

export class WorkflowEngine extends EventEmitter {
  private deps: WorkflowEngineDependencies;
  private processInterval: NodeJS.Timeout | null = null;
  private options: Required<WorkflowEngineOptions>;
  private isProcessing = false;

  constructor(deps: WorkflowEngineDependencies, options: WorkflowEngineOptions = {}) {
    super();
    this.deps = deps;
    this.options = {
      processIntervalMs: options.processIntervalMs ?? DEFAULT_PROCESS_INTERVAL_MS,
      autoProcess: options.autoProcess ?? true,
      maxConcurrentSteps: options.maxConcurrentSteps ?? DEFAULT_MAX_CONCURRENT_STEPS,
    };
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Start the workflow engine
   */
  start(): void {
    if (this.processInterval) return;

    if (this.options.autoProcess) {
      this.processInterval = setInterval(
        () => this.processCycle().catch(console.error),
        this.options.processIntervalMs
      );
    }
  }

  /**
   * Process one cycle: check triggers and process executions
   */
  private async processCycle(): Promise<void> {
    await this.processTriggers();
    await this.processExecutions();
  }

  /**
   * Check enabled triggers and fire workflows
   */
  async processTriggers(): Promise<number> {
    const { workflowStorage, blackboardStorage } = this.deps;
    if (!blackboardStorage) return 0;

    let fired = 0;

    // Get enabled blackboard triggers
    const triggers = workflowStorage.getEnabledTriggersByType('blackboard');

    for (const trigger of triggers) {
      try {
        if (await this.pollBlackboardTrigger(trigger)) {
          fired++;
        }
      } catch (err) {
        console.error(`Error checking trigger ${trigger.id}:`, err);
      }
    }

    return fired;
  }

  /**
   * Poll a blackboard trigger to check if it should fire
   */
  private async pollBlackboardTrigger(trigger: WorkflowTrigger): Promise<boolean> {
    const { workflowStorage, blackboardStorage } = this.deps;
    if (!blackboardStorage) return false;

    const config = trigger.config as { type: 'blackboard'; swarmId: string; messageType: BlackboardMessageType; filter?: Record<string, unknown> };

    // Get recent messages matching the trigger criteria
    const messages = blackboardStorage.readMessages(config.swarmId, {
      messageType: config.messageType,
      limit: 10,
    });

    // Find unprocessed messages (posted after last trigger fire)
    const sinceTime = trigger.lastFiredAt ?? 0;
    const newMessages = messages.filter((m) => m.createdAt > sinceTime);

    if (newMessages.length === 0) return false;

    // Check filter if specified
    for (const message of newMessages) {
      if (config.filter) {
        const matches = Object.entries(config.filter).every(
          ([key, value]) => message.payload?.[key] === value
        );
        if (!matches) continue;
      }

      // Fire the workflow
      const execution = await this.startWorkflow(
        trigger.workflowId,
        `trigger:${trigger.id}`,
        { triggerMessage: message.payload },
        config.swarmId
      );

      // Update trigger stats
      workflowStorage.recordTriggerFired(trigger.id);

      this.emit('trigger:fired', {
        triggerId: trigger.id,
        workflowId: trigger.workflowId,
        executionId: execution.id,
      });

      console.log(`[WORKFLOW] Trigger ${trigger.id} fired, started execution ${execution.id}`);
      return true;
    }

    return false;
  }

  /**
   * Stop the workflow engine
   */
  stop(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
  }

  // ==========================================================================
  // EXECUTION CONTROL
  // ==========================================================================

  /**
   * Start a new workflow execution
   */
  async startWorkflow(
    workflowId: string,
    createdBy: string,
    inputs?: Record<string, unknown>,
    swarmId?: string
  ): Promise<WorkflowExecution> {
    const { workflowStorage } = this.deps;

    // Get workflow definition
    const workflow = workflowStorage.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Validate required inputs
    if (workflow.definition.inputs) {
      for (const [key, spec] of Object.entries(workflow.definition.inputs)) {
        if (spec.required && (!inputs || inputs[key] === undefined)) {
          if (spec.default === undefined) {
            throw new Error(`Missing required input: ${key}`);
          }
        }
      }
    }

    // Create execution with merged inputs (defaults + provided)
    const context: Record<string, unknown> = { inputs: {} };
    if (workflow.definition.inputs) {
      for (const [key, spec] of Object.entries(workflow.definition.inputs)) {
        const value = inputs?.[key] ?? spec.default;
        if (value !== undefined) {
          (context.inputs as Record<string, unknown>)[key] = value;
        }
      }
    }

    const execution = workflowStorage.createExecution(workflowId, createdBy, {
      swarmId,
      context,
    });

    // Create steps from definition
    workflowStorage.createStepsFromDefinition(execution.id, workflow.definition);

    // Update status to running
    workflowStorage.updateExecutionStatus(execution.id, 'running');

    // Log event
    workflowStorage.logEvent(execution.id, 'started', {
      actor: createdBy,
      details: { inputs },
    });

    this.emit('workflow:started', { executionId: execution.id, workflowId });

    return { ...execution, status: 'running' };
  }

  /**
   * Pause a workflow execution
   */
  async pauseWorkflow(executionId: string): Promise<boolean> {
    const { workflowStorage } = this.deps;

    const execution = workflowStorage.getExecution(executionId);
    if (!execution || execution.status !== 'running') {
      return false;
    }

    workflowStorage.updateExecutionStatus(executionId, 'paused');
    workflowStorage.logEvent(executionId, 'paused');

    this.emit('workflow:paused', { executionId });
    return true;
  }

  /**
   * Resume a paused workflow execution
   */
  async resumeWorkflow(executionId: string): Promise<boolean> {
    const { workflowStorage } = this.deps;

    const execution = workflowStorage.getExecution(executionId);
    if (!execution || execution.status !== 'paused') {
      return false;
    }

    workflowStorage.updateExecutionStatus(executionId, 'running');
    workflowStorage.logEvent(executionId, 'resumed');

    this.emit('workflow:resumed', { executionId });
    return true;
  }

  /**
   * Cancel a workflow execution
   */
  async cancelWorkflow(executionId: string): Promise<boolean> {
    const { workflowStorage } = this.deps;

    const execution = workflowStorage.getExecution(executionId);
    if (!execution || (execution.status !== 'running' && execution.status !== 'paused')) {
      return false;
    }

    workflowStorage.updateExecutionStatus(executionId, 'cancelled');
    workflowStorage.logEvent(executionId, 'cancelled');

    this.emit('workflow:failed', { executionId, error: 'Cancelled by user' });
    return true;
  }

  /**
   * Retry a failed step
   */
  async retryStep(stepId: string): Promise<boolean> {
    const { workflowStorage } = this.deps;

    const step = workflowStorage.getStep(stepId);
    if (!step || step.status !== 'failed') {
      return false;
    }

    if (step.retryCount >= step.maxRetries) {
      return false;
    }

    workflowStorage.incrementRetryCount(stepId);
    workflowStorage.logEvent(step.executionId, 'step_retried', {
      stepId,
      details: { retryCount: step.retryCount + 1 },
    });

    return true;
  }

  /**
   * Manually complete a step
   */
  async completeStep(
    stepId: string,
    output?: Record<string, unknown>,
    error?: string
  ): Promise<boolean> {
    const { workflowStorage } = this.deps;

    const step = workflowStorage.getStep(stepId);
    if (!step || step.status === 'completed' || step.status === 'skipped') {
      return false;
    }

    const status: WorkflowStepStatus = error ? 'failed' : 'completed';
    workflowStorage.updateStepStatus(stepId, status, output, error);

    if (status === 'completed') {
      workflowStorage.decrementDependents(step.executionId, step.stepKey);
    }

    workflowStorage.logEvent(step.executionId, `step_${status}`, {
      stepId,
      details: { output, error },
    });

    if (status === 'completed') {
      this.emit('step:completed', { executionId: step.executionId, stepId, output: output ?? {} });
    } else {
      this.emit('step:failed', { executionId: step.executionId, stepId, error: error ?? 'Unknown error' });
    }

    // Check if workflow is complete
    await this.checkWorkflowCompletion(step.executionId);

    return true;
  }

  // ==========================================================================
  // CORE PROCESSING
  // ==========================================================================

  /**
   * Process all running executions
   */
  async processExecutions(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const { workflowStorage } = this.deps;
      const executions = workflowStorage.listExecutions({ status: 'running' });
      let processed = 0;

      for (const execution of executions) {
        try {
          await this.processExecution(execution);
          processed++;
        } catch (err) {
          console.error(`Error processing execution ${execution.id}:`, err);
          workflowStorage.updateExecutionStatus(
            execution.id,
            'failed',
            (err as Error).message
          );
          this.emit('workflow:failed', { executionId: execution.id, error: (err as Error).message });
        }
      }

      return processed;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single execution
   */
  private async processExecution(execution: WorkflowExecution): Promise<void> {
    const { workflowStorage } = this.deps;

    // Get ready steps
    const readySteps = workflowStorage.getReadySteps(
      execution.id,
      this.options.maxConcurrentSteps
    );

    // Process each ready step
    for (const step of readySteps) {
      try {
        await this.processStep(step, execution);
      } catch (err) {
        console.error(`Error processing step ${step.id}:`, err);
        workflowStorage.updateStepStatus(step.id, 'failed', undefined, (err as Error).message);
        workflowStorage.logEvent(execution.id, 'step_failed', {
          stepId: step.id,
          details: { error: (err as Error).message },
        });
        this.emit('step:failed', {
          executionId: execution.id,
          stepId: step.id,
          error: (err as Error).message,
        });

        // Handle failure strategy
        const workflow = workflowStorage.getWorkflow(execution.workflowId);
        const stepDef = workflow?.definition.steps.find(s => s.key === step.stepKey);
        const onFailure = stepDef?.onFailure ?? 'fail';

        if (onFailure === 'fail') {
          workflowStorage.updateExecutionStatus(execution.id, 'failed', (err as Error).message);
          this.emit('workflow:failed', { executionId: execution.id, error: (err as Error).message });
          return;
        } else if (onFailure === 'retry' && step.retryCount < step.maxRetries) {
          workflowStorage.incrementRetryCount(step.id);
        } else if (onFailure === 'skip') {
          workflowStorage.updateStepStatus(step.id, 'skipped');
          workflowStorage.decrementDependents(execution.id, step.stepKey);
        }
        // 'continue' - just move on
      }
    }

    // Check if workflow is complete
    await this.checkWorkflowCompletion(execution.id);
  }

  /**
   * Process a single step
   */
  private async processStep(step: WorkflowStep, execution: WorkflowExecution): Promise<void> {
    const { workflowStorage } = this.deps;

    // Get workflow definition for guard evaluation
    const workflow = workflowStorage.getWorkflow(execution.workflowId);
    const stepDef = workflow?.definition.steps.find(s => s.key === step.stepKey);

    // Evaluate guard if present
    if (stepDef?.guard) {
      const context = this.buildStepContext(step, execution);
      if (!this.evaluateGuard(stepDef.guard, context)) {
        workflowStorage.updateStepStatus(step.id, 'skipped');
        workflowStorage.decrementDependents(execution.id, step.stepKey);
        workflowStorage.logEvent(execution.id, 'step_skipped', {
          stepId: step.id,
          details: { reason: 'Guard condition not met' },
        });
        return;
      }
    }

    // Mark step as running
    workflowStorage.updateStepStatus(step.id, 'running');
    workflowStorage.logEvent(execution.id, 'step_started', { stepId: step.id });
    this.emit('step:started', { executionId: execution.id, stepId: step.id, stepKey: step.stepKey });

    // Execute based on step type
    let output: Record<string, unknown>;

    switch (step.stepType) {
      case 'task':
        output = await this.executeTaskStep(step, execution);
        break;
      case 'spawn':
        output = await this.executeSpawnStep(step, execution);
        break;
      case 'checkpoint':
        output = await this.executeCheckpointStep(step, execution);
        break;
      case 'gate':
        output = await this.executeGateStep(step, execution);
        break;
      case 'script':
        output = await this.executeScriptStep(step, execution);
        break;
      case 'parallel':
        output = await this.executeParallelStep(step, execution);
        break;
      default:
        throw new Error(`Unknown step type: ${step.stepType}`);
    }

    // Mark step as completed
    workflowStorage.updateStepStatus(step.id, 'completed', output);
    workflowStorage.decrementDependents(execution.id, step.stepKey);
    workflowStorage.logEvent(execution.id, 'step_completed', {
      stepId: step.id,
      details: { output },
    });

    this.emit('step:completed', { executionId: execution.id, stepId: step.id, output });
  }

  // ==========================================================================
  // STEP TYPE HANDLERS
  // ==========================================================================

  /**
   * Execute a task step (creates a work item)
   */
  private async executeTaskStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<Record<string, unknown>> {
    const config = step.config as TaskStepConfig;
    const context = this.buildStepContext(step, execution);

    const title = this.resolveVariable(config.title, context);
    const description = config.description
      ? this.resolveVariable(config.description, context)
      : undefined;

    // Create work item if storage is available
    if (this.deps.workItemStorage) {
      const workItem = await this.deps.workItemStorage.createWorkItem(title, { description });
      return { workItemId: workItem.id, title };
    }

    return { title, description };
  }

  /**
   * Execute a spawn step (queues agent spawn)
   */
  private async executeSpawnStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<Record<string, unknown>> {
    const config = step.config as SpawnStepConfig;
    const context = this.buildStepContext(step, execution);

    const task = this.resolveVariable(config.task, context);
    const swarmId = config.swarmId === '@context'
      ? execution.swarmId
      : config.swarmId;

    // Return spawn request details - actual spawning handled externally
    return {
      agentRole: config.agentRole,
      task,
      swarmId,
      pending: true,
    };
  }

  /**
   * Execute a checkpoint step
   */
  private async executeCheckpointStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<Record<string, unknown>> {
    const config = step.config as CheckpointStepConfig;
    const context = this.buildStepContext(step, execution);

    const goal = this.resolveVariable(config.goal, context);
    const toHandle = this.resolveVariable(config.toHandle, context);

    return {
      goal,
      toHandle,
      waitForAcceptance: config.waitForAcceptance ?? false,
      status: 'pending',
    };
  }

  /**
   * Execute a gate step (conditional branching)
   */
  private async executeGateStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<Record<string, unknown>> {
    const config = step.config as GateStepConfig;
    const context = this.buildStepContext(step, execution);
    const { workflowStorage } = this.deps;

    const result = this.evaluateGuard(config.condition, context);

    // Skip steps based on condition result
    if (result && config.onFalse) {
      for (const stepKey of config.onFalse) {
        const targetStep = workflowStorage.getStepByKey(execution.id, stepKey);
        if (targetStep && targetStep.status === 'pending') {
          workflowStorage.updateStepStatus(targetStep.id, 'skipped');
          workflowStorage.decrementDependents(execution.id, stepKey);
        }
      }
    } else if (!result && config.onTrue) {
      for (const stepKey of config.onTrue) {
        const targetStep = workflowStorage.getStepByKey(execution.id, stepKey);
        if (targetStep && targetStep.status === 'pending') {
          workflowStorage.updateStepStatus(targetStep.id, 'skipped');
          workflowStorage.decrementDependents(execution.id, stepKey);
        }
      }
    }

    return { conditionResult: result };
  }

  /**
   * Execute a script step
   */
  private async executeScriptStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<Record<string, unknown>> {
    const config = step.config as ScriptStepConfig;
    const context = this.buildStepContext(step, execution);

    // Safe evaluation of simple expressions
    const result = this.evaluateExpression(config.script, context);

    if (config.outputKey) {
      return { [config.outputKey]: result };
    }
    return { result };
  }

  /**
   * Execute a parallel step
   */
  private async executeParallelStep(
    _step: WorkflowStep,
    _execution: WorkflowExecution
  ): Promise<Record<string, unknown>> {
    // Parallel steps just mark their sub-steps as ready
    // The engine will process them in subsequent iterations
    return { status: 'parallel_initiated' };
  }

  // ==========================================================================
  // GUARD EVALUATION
  // ==========================================================================

  /**
   * Evaluate a guard condition
   */
  private evaluateGuard(guard: WorkflowGuard, context: Record<string, unknown>): boolean {
    try {
      switch (guard.type) {
        case 'expression':
          return this.evaluateExpression(guard.condition, context) === true;
        case 'output_check':
          return this.evaluateExpression(guard.condition, context) === true;
        case 'script':
          return this.evaluateExpression(guard.condition, context) === true;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Simple expression evaluator (safe, no eval)
   */
  private evaluateExpression(expr: string, context: Record<string, unknown>): unknown {
    // Handle simple comparisons and variable access
    // Format: variable === value, variable !== value, variable > value, etc.

    const operators = ['===', '!==', '>=', '<=', '>', '<', '==', '!='];

    for (const op of operators) {
      if (expr.includes(op)) {
        const [left, right] = expr.split(op).map(s => s.trim());
        // Try to resolve as context path first, fall back to parsing as literal
        const leftVal = this.resolveContextPath(left, context) ?? this.parseValue(left);
        const rightVal = this.parseValue(right);

        switch (op) {
          case '===':
          case '==':
            return leftVal === rightVal;
          case '!==':
          case '!=':
            return leftVal !== rightVal;
          case '>':
            return Number(leftVal) > Number(rightVal);
          case '>=':
            return Number(leftVal) >= Number(rightVal);
          case '<':
            return Number(leftVal) < Number(rightVal);
          case '<=':
            return Number(leftVal) <= Number(rightVal);
        }
      }
    }

    // Just resolve the path and return the value
    return this.resolveContextPath(expr, context);
  }

  /**
   * Parse a literal value from expression
   */
  private parseValue(str: string): unknown {
    const trimmed = str.trim();

    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed === 'undefined') return undefined;

    // String literal
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    // Number
    const num = Number(trimmed);
    if (!isNaN(num)) return num;

    return trimmed;
  }

  /**
   * Resolve a dotted path in context (e.g., "steps.scout.output.result")
   */
  private resolveContextPath(path: string, context: Record<string, unknown>): unknown {
    const parts = path.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  // ==========================================================================
  // CONTEXT RESOLUTION
  // ==========================================================================

  /**
   * Resolve template variables in a string
   */
  private resolveVariable(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
      const value = this.resolveContextPath(path, context);
      return value !== undefined ? String(value) : '';
    });
  }

  /**
   * Build context for step execution
   */
  private buildStepContext(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Record<string, unknown> {
    const { workflowStorage } = this.deps;

    // Get all steps for this execution
    const steps = workflowStorage.getStepsByExecution(execution.id);
    const stepOutputs: Record<string, unknown> = {};

    for (const s of steps) {
      if (s.output) {
        stepOutputs[s.stepKey] = {
          status: s.status,
          output: s.output,
        };
      }
    }

    return {
      ...execution.context,
      steps: stepOutputs,
      execution: {
        id: execution.id,
        workflowId: execution.workflowId,
        swarmId: execution.swarmId,
        createdBy: execution.createdBy,
      },
      currentStep: {
        key: step.stepKey,
        type: step.stepType,
      },
    };
  }

  // ==========================================================================
  // COMPLETION DETECTION
  // ==========================================================================

  /**
   * Check if a workflow execution is complete
   */
  private async checkWorkflowCompletion(executionId: string): Promise<void> {
    const { workflowStorage } = this.deps;

    const execution = workflowStorage.getExecution(executionId);
    if (!execution || execution.status !== 'running') return;

    const steps = workflowStorage.getStepsByExecution(executionId);

    const hasRunning = steps.some(s => s.status === 'running' || s.status === 'ready');
    const hasPending = steps.some(s => s.status === 'pending');
    const hasFailed = steps.some(s => s.status === 'failed');

    if (hasRunning) return; // Still processing

    if (hasFailed && !hasPending) {
      // All steps done, but some failed
      const failedSteps = steps.filter(s => s.status === 'failed');
      workflowStorage.updateExecutionStatus(
        executionId,
        'failed',
        `Steps failed: ${failedSteps.map(s => s.stepKey).join(', ')}`
      );
      workflowStorage.logEvent(executionId, 'completed', {
        details: { status: 'failed', failedSteps: failedSteps.map(s => s.stepKey) },
      });
      this.emit('workflow:failed', {
        executionId,
        error: `Steps failed: ${failedSteps.map(s => s.stepKey).join(', ')}`,
      });
      return;
    }

    if (!hasPending && !hasRunning) {
      // All steps completed
      const outputs = this.gatherOutputs(steps, execution);
      workflowStorage.updateExecutionStatus(executionId, 'completed');
      workflowStorage.logEvent(executionId, 'completed', {
        details: { status: 'completed', outputs },
      });
      this.emit('workflow:completed', { executionId, outputs });
    }
  }

  /**
   * Gather outputs from completed steps based on workflow output mappings
   */
  private gatherOutputs(
    steps: WorkflowStep[],
    execution: WorkflowExecution
  ): Record<string, unknown> {
    const { workflowStorage } = this.deps;
    const workflow = workflowStorage.getWorkflow(execution.workflowId);

    if (!workflow?.definition.outputs) {
      return {};
    }

    const context = this.buildStepContext(steps[0], execution);
    const outputs: Record<string, unknown> = {};

    for (const [key, path] of Object.entries(workflow.definition.outputs)) {
      outputs[key] = this.resolveContextPath(path, context);
    }

    return outputs;
  }

  // ==========================================================================
  // TRIGGER PROCESSING
  // ==========================================================================

  /**
   * Check if an event matches any triggers
   */
  async checkEventTrigger(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<void> {
    const { workflowStorage } = this.deps;
    const triggers = workflowStorage.getEnabledTriggersByType('event');

    for (const trigger of triggers) {
      if (trigger.config.type !== 'event') continue;
      if (trigger.config.eventType !== eventType) continue;

      if (trigger.config.filter) {
        if (!this.matchesFilter(eventData, trigger.config.filter)) continue;
      }

      await this.fireTrigger(trigger, eventData);
    }
  }

  /**
   * Check if a blackboard message matches any triggers
   */
  async checkBlackboardTrigger(
    swarmId: string,
    messageType: BlackboardMessageType,
    payload: Record<string, unknown>
  ): Promise<void> {
    const { workflowStorage } = this.deps;
    const triggers = workflowStorage.getEnabledTriggersByType('blackboard');

    for (const trigger of triggers) {
      if (trigger.config.type !== 'blackboard') continue;
      if (trigger.config.swarmId !== swarmId) continue;
      if (trigger.config.messageType !== messageType) continue;

      if (trigger.config.filter) {
        if (!this.matchesFilter(payload, trigger.config.filter)) continue;
      }

      await this.fireTrigger(trigger, payload);
    }
  }

  /**
   * Fire a trigger (start workflow)
   */
  private async fireTrigger(
    trigger: WorkflowTrigger,
    data: Record<string, unknown>
  ): Promise<void> {
    const { workflowStorage } = this.deps;

    try {
      const execution = await this.startWorkflow(
        trigger.workflowId,
        'trigger:' + trigger.id,
        data
      );

      workflowStorage.recordTriggerFired(trigger.id);

      this.emit('trigger:fired', {
        triggerId: trigger.id,
        workflowId: trigger.workflowId,
        executionId: execution.id,
      });
    } catch (err) {
      console.error(`Failed to fire trigger ${trigger.id}:`, err);
    }
  }

  /**
   * Check if data matches a filter
   */
  private matchesFilter(
    data: Record<string, unknown>,
    filter: Record<string, unknown>
  ): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      const actual = this.resolveContextPath(key, data);
      if (actual !== expected) return false;
    }
    return true;
  }
}
