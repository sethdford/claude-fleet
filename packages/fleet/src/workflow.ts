/**
 * Workflow Engine
 *
 * DAG-based workflow execution for complex multi-step tasks.
 */

import type { Workflow, WorkflowStep, WorkflowStatus } from '@claude-fleet/common';
import { generateId } from '@claude-fleet/common';
import { getDatabase } from '@claude-fleet/storage';
import { EventEmitter } from 'node:events';

export interface WorkflowExecution {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkflowEvents {
  'step:start': (stepId: string, step: WorkflowStep) => void;
  'step:complete': (stepId: string, result: unknown) => void;
  'step:fail': (stepId: string, error: Error) => void;
  'workflow:complete': (workflow: Workflow) => void;
  'workflow:fail': (workflow: Workflow, error: Error) => void;
}

export class WorkflowEngine extends EventEmitter {
  private db = getDatabase();
  private running = new Map<string, boolean>();

  constructor() {
    super();
  }

  /**
   * Create a new workflow
   */
  create(workflow: {
    name: string;
    description?: string;
    steps: WorkflowStep[];
    context?: Record<string, unknown>;
  }): Workflow {
    const id = generateId();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO workflows (id, name, description, status, steps, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      workflow.name,
      workflow.description || null,
      'pending',
      JSON.stringify(workflow.steps),
      workflow.context ? JSON.stringify(workflow.context) : null,
      now
    );

    return {
      id,
      name: workflow.name,
      description: workflow.description,
      status: 'pending',
      steps: workflow.steps,
      context: workflow.context,
      createdAt: now,
    };
  }

  /**
   * Get a workflow by ID
   */
  get(id: string): Workflow | undefined {
    const row = this.db
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(id) as WorkflowRow | undefined;

    return row ? this.rowToWorkflow(row) : undefined;
  }

  /**
   * List workflows
   */
  list(options: {
    status?: WorkflowStatus;
    limit?: number;
  } = {}): Workflow[] {
    const { status, limit = 50 } = options;

    let sql = 'SELECT * FROM workflows';
    const params: unknown[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as WorkflowRow[];
    return rows.map((row) => this.rowToWorkflow(row));
  }

  /**
   * Execute a workflow
   */
  async execute(
    workflowId: string,
    executor: (step: WorkflowStep, context: Record<string, unknown>) => Promise<unknown>
  ): Promise<void> {
    const workflow = this.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (this.running.get(workflowId)) {
      throw new Error(`Workflow already running: ${workflowId}`);
    }

    this.running.set(workflowId, true);
    this.updateStatus(workflowId, 'running');

    const context = { ...workflow.context };
    const executions = new Map<string, WorkflowExecution>();

    // Initialize executions
    for (const step of workflow.steps) {
      executions.set(step.id, {
        stepId: step.id,
        status: 'pending',
      });
      this.createExecution(workflowId, step.id);
    }

    try {
      // Execute steps in dependency order
      await this.executeSteps(workflowId, workflow.steps, executor, context, executions);

      // Check if all steps completed
      const allCompleted = [...executions.values()].every(
        (e) => e.status === 'completed' || e.status === 'skipped'
      );

      if (allCompleted) {
        this.updateStatus(workflowId, 'completed');
        this.emit('workflow:complete', this.get(workflowId));
      } else {
        const failedStep = [...executions.values()].find((e) => e.status === 'failed');
        this.updateStatus(workflowId, 'failed');
        this.emit('workflow:fail', this.get(workflowId), new Error(failedStep?.error || 'Unknown error'));
      }
    } catch (error) {
      this.updateStatus(workflowId, 'failed');
      this.emit('workflow:fail', this.get(workflowId), error as Error);
      throw error;
    } finally {
      this.running.delete(workflowId);
    }
  }

  /**
   * Execute steps respecting dependencies
   */
  private async executeSteps(
    workflowId: string,
    steps: WorkflowStep[],
    executor: (step: WorkflowStep, context: Record<string, unknown>) => Promise<unknown>,
    context: Record<string, unknown>,
    executions: Map<string, WorkflowExecution>
  ): Promise<void> {
    const completed = new Set<string>();
    const pending = new Set(steps.map((s) => s.id));

    while (pending.size > 0) {
      // Find steps that can run (all dependencies completed)
      const ready: WorkflowStep[] = [];

      for (const stepId of pending) {
        const step = steps.find((s) => s.id === stepId)!;
        const deps = step.dependsOn || [];

        if (deps.every((d) => completed.has(d))) {
          ready.push(step);
        }
      }

      if (ready.length === 0) {
        // No steps can run - likely a circular dependency or failed dependency
        for (const stepId of pending) {
          const exec = executions.get(stepId)!;
          exec.status = 'skipped';
          exec.error = 'Dependencies not satisfied';
          this.updateExecution(workflowId, stepId, exec);
        }
        break;
      }

      // Execute ready steps in parallel
      const results = await Promise.allSettled(
        ready.map((step) => this.executeStep(workflowId, step, executor, context, executions))
      );

      // Process results
      for (let i = 0; i < ready.length; i++) {
        const step = ready[i];
        const result = results[i];
        const exec = executions.get(step.id)!;

        if (result.status === 'fulfilled') {
          exec.status = 'completed';
          exec.result = result.value;
          exec.completedAt = Date.now();
          completed.add(step.id);

          // Add result to context for dependent steps
          context[`result_${step.id}`] = result.value;
        } else {
          exec.status = 'failed';
          exec.error = result.reason?.message || 'Unknown error';
          exec.completedAt = Date.now();
        }

        this.updateExecution(workflowId, step.id, exec);
        pending.delete(step.id);
      }
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    workflowId: string,
    step: WorkflowStep,
    executor: (step: WorkflowStep, context: Record<string, unknown>) => Promise<unknown>,
    context: Record<string, unknown>,
    executions: Map<string, WorkflowExecution>
  ): Promise<unknown> {
    const exec = executions.get(step.id)!;
    exec.status = 'running';
    exec.startedAt = Date.now();
    this.updateExecution(workflowId, step.id, exec);

    this.emit('step:start', step.id, step);

    try {
      const result = await executor(step, context);
      this.emit('step:complete', step.id, result);
      return result;
    } catch (error) {
      this.emit('step:fail', step.id, error as Error);
      throw error;
    }
  }

  /**
   * Update workflow status
   */
  private updateStatus(id: string, status: WorkflowStatus): void {
    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (status === 'running') {
      updates.push('started_at = ?');
      params.push(Date.now());
    } else if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = ?');
      params.push(Date.now());
    }

    params.push(id);

    this.db
      .prepare(`UPDATE workflows SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  /**
   * Create execution record
   */
  private createExecution(workflowId: string, stepId: string): void {
    this.db.prepare(`
      INSERT INTO workflow_executions (workflow_id, step_id, status)
      VALUES (?, ?, ?)
    `).run(workflowId, stepId, 'pending');
  }

  /**
   * Update execution record
   */
  private updateExecution(workflowId: string, stepId: string, exec: WorkflowExecution): void {
    this.db.prepare(`
      UPDATE workflow_executions
      SET status = ?, result = ?, error = ?, started_at = ?, completed_at = ?
      WHERE workflow_id = ? AND step_id = ?
    `).run(
      exec.status,
      exec.result ? JSON.stringify(exec.result) : null,
      exec.error || null,
      exec.startedAt || null,
      exec.completedAt || null,
      workflowId,
      stepId
    );
  }

  /**
   * Get executions for a workflow
   */
  getExecutions(workflowId: string): WorkflowExecution[] {
    const rows = this.db
      .prepare(`
        SELECT step_id, status, result, error, started_at, completed_at
        FROM workflow_executions
        WHERE workflow_id = ?
      `)
      .all(workflowId) as ExecutionRow[];

    return rows.map((row) => ({
      stepId: row.step_id,
      status: row.status as WorkflowExecution['status'],
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
    }));
  }

  /**
   * Cancel a running workflow
   */
  cancel(id: string): void {
    this.running.delete(id);
    this.updateStatus(id, 'cancelled');
  }

  private rowToWorkflow(row: WorkflowRow): Workflow {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      status: row.status as WorkflowStatus,
      steps: JSON.parse(row.steps),
      context: row.context ? JSON.parse(row.context) : undefined,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
    };
  }
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  steps: string;
  context: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface ExecutionRow {
  step_id: string;
  status: string;
  result: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
}
