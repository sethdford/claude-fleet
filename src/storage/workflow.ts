/**
 * Workflow Storage
 *
 * Manages workflow definitions, executions, steps, triggers, and events.
 * Implements Kahn's algorithm for DAG dependency resolution (like SpawnQueue).
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from './sqlite.js';
import type {
  Workflow,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowStepConfig,
  WorkflowStepDefinition,
  WorkflowTrigger,
  WorkflowTriggerType,
  WorkflowTriggerConfig,
  WorkflowEvent,
} from '../types.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface CreateWorkflowOptions {
  description?: string;
  isTemplate?: boolean;
}

export interface ListWorkflowsOptions {
  isTemplate?: boolean;
  limit?: number;
}

export interface CreateExecutionOptions {
  swarmId?: string;
  context?: Record<string, unknown>;
}

export interface ListExecutionsOptions {
  workflowId?: string;
  status?: WorkflowStatus;
  swarmId?: string;
  limit?: number;
}

export interface LogEventOptions {
  stepId?: string;
  actor?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  definition: string;
  is_template: number;
  created_at: number;
  updated_at: number;
}

interface ExecutionRow {
  id: string;
  workflow_id: string;
  swarm_id: string | null;
  status: string;
  context: string;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
  created_at: number;
  created_by: string;
}

interface StepRow {
  id: string;
  execution_id: string;
  step_key: string;
  name: string | null;
  step_type: string;
  status: string;
  config: string;
  depends_on: string;
  blocked_by_count: number;
  output: string | null;
  assigned_to: string | null;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
  retry_count: number;
  max_retries: number;
  created_at: number;
}

interface TriggerRow {
  id: string;
  workflow_id: string;
  trigger_type: string;
  config: string;
  is_enabled: number;
  last_fired_at: number | null;
  fire_count: number;
  created_at: number;
}

interface EventRow {
  id: number;
  execution_id: string;
  step_id: string | null;
  event_type: string;
  actor: string | null;
  details: string | null;
  created_at: number;
}

// ============================================================================
// WORKFLOW STORAGE CLASS
// ============================================================================

export class WorkflowStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  // ==========================================================================
  // WORKFLOW CRUD
  // ==========================================================================

  /**
   * Create a new workflow
   */
  createWorkflow(
    name: string,
    definition: WorkflowDefinition,
    options: CreateWorkflowOptions = {}
  ): Workflow {
    const id = uuidv4();
    const now = Date.now();
    const db = this.storage.getDatabase();

    const stmt = db.prepare(`
      INSERT INTO workflows (id, name, description, version, definition, is_template, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      name,
      options.description ?? null,
      JSON.stringify(definition),
      options.isTemplate ? 1 : 0,
      now,
      now
    );

    return {
      id,
      name,
      description: options.description ?? null,
      version: 1,
      definition,
      isTemplate: options.isTemplate ?? false,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(id: string): Workflow | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM workflows WHERE id = ?');
    const row = stmt.get(id) as WorkflowRow | undefined;
    return row ? this.rowToWorkflow(row) : null;
  }

  /**
   * Get workflow by name
   */
  getWorkflowByName(name: string): Workflow | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM workflows WHERE name = ?');
    const row = stmt.get(name) as WorkflowRow | undefined;
    return row ? this.rowToWorkflow(row) : null;
  }

  /**
   * List workflows
   */
  listWorkflows(options: ListWorkflowsOptions = {}): Workflow[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.isTemplate !== undefined) {
      conditions.push('is_template = ?');
      params.push(options.isTemplate ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 100;
    params.push(limit);

    const stmt = db.prepare(`
      SELECT * FROM workflows ${where}
      ORDER BY updated_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(...params) as WorkflowRow[];
    return rows.map((row) => this.rowToWorkflow(row));
  }

  /**
   * Update workflow definition (increments version)
   */
  updateWorkflow(
    id: string,
    definition: WorkflowDefinition,
    description?: string
  ): boolean {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      UPDATE workflows
      SET definition = ?, description = COALESCE(?, description), version = version + 1, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(JSON.stringify(definition), description, now, id);
    return result.changes > 0;
  }

  /**
   * Delete workflow
   */
  deleteWorkflow(id: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('DELETE FROM workflows WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ==========================================================================
  // EXECUTION MANAGEMENT
  // ==========================================================================

  /**
   * Create a new workflow execution
   */
  createExecution(
    workflowId: string,
    createdBy: string,
    options: CreateExecutionOptions = {}
  ): WorkflowExecution {
    const id = uuidv4();
    const now = Date.now();
    const db = this.storage.getDatabase();

    const stmt = db.prepare(`
      INSERT INTO workflow_executions (id, workflow_id, swarm_id, status, context, created_at, created_by)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `);

    stmt.run(
      id,
      workflowId,
      options.swarmId ?? null,
      JSON.stringify(options.context ?? {}),
      now,
      createdBy
    );

    return {
      id,
      workflowId,
      swarmId: options.swarmId ?? null,
      status: 'pending',
      context: options.context ?? {},
      startedAt: null,
      completedAt: null,
      error: null,
      createdAt: now,
      createdBy,
    };
  }

  /**
   * Get execution by ID
   */
  getExecution(id: string): WorkflowExecution | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM workflow_executions WHERE id = ?');
    const row = stmt.get(id) as ExecutionRow | undefined;
    return row ? this.rowToExecution(row) : null;
  }

  /**
   * List executions
   */
  listExecutions(options: ListExecutionsOptions = {}): WorkflowExecution[] {
    const db = this.storage.getDatabase();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.workflowId) {
      conditions.push('workflow_id = ?');
      params.push(options.workflowId);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options.swarmId) {
      conditions.push('swarm_id = ?');
      params.push(options.swarmId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 100;
    params.push(limit);

    const stmt = db.prepare(`
      SELECT * FROM workflow_executions ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(...params) as ExecutionRow[];
    return rows.map((row) => this.rowToExecution(row));
  }

  /**
   * Update execution status
   */
  updateExecutionStatus(
    id: string,
    status: WorkflowStatus,
    error?: string
  ): boolean {
    const db = this.storage.getDatabase();
    const now = Date.now();

    let stmt;
    if (status === 'running') {
      stmt = db.prepare(`
        UPDATE workflow_executions
        SET status = ?, started_at = COALESCE(started_at, ?), error = ?
        WHERE id = ?
      `);
      const result = stmt.run(status, now, error ?? null, id);
      return result.changes > 0;
    } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      stmt = db.prepare(`
        UPDATE workflow_executions
        SET status = ?, completed_at = ?, error = ?
        WHERE id = ?
      `);
      const result = stmt.run(status, now, error ?? null, id);
      return result.changes > 0;
    } else {
      stmt = db.prepare(`
        UPDATE workflow_executions
        SET status = ?, error = ?
        WHERE id = ?
      `);
      const result = stmt.run(status, error ?? null, id);
      return result.changes > 0;
    }
  }

  /**
   * Update execution context
   */
  setExecutionContext(id: string, context: Record<string, unknown>): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE workflow_executions SET context = ? WHERE id = ?
    `);
    const result = stmt.run(JSON.stringify(context), id);
    return result.changes > 0;
  }

  // ==========================================================================
  // STEP MANAGEMENT (DAG)
  // ==========================================================================

  /**
   * Create steps from workflow definition
   */
  createStepsFromDefinition(
    executionId: string,
    definition: WorkflowDefinition
  ): WorkflowStep[] {
    const db = this.storage.getDatabase();
    const steps: WorkflowStep[] = [];

    const stmt = db.prepare(`
      INSERT INTO workflow_steps (id, execution_id, step_key, name, step_type, status, config, depends_on, blocked_by_count, max_retries)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `);

    // First pass: create all steps
    for (const stepDef of definition.steps) {
      const id = uuidv4();
      const dependsOn = stepDef.dependsOn ?? [];
      const blockedByCount = dependsOn.length; // Will be recalculated if needed

      stmt.run(
        id,
        executionId,
        stepDef.key,
        stepDef.name,
        stepDef.type,
        JSON.stringify(stepDef.config),
        JSON.stringify(dependsOn),
        blockedByCount,
        stepDef.maxRetries ?? 0
      );

      steps.push({
        id,
        executionId,
        stepKey: stepDef.key,
        name: stepDef.name,
        stepType: stepDef.type,
        status: 'pending',
        config: stepDef.config,
        dependsOn,
        blockedByCount,
        output: null,
        assignedTo: null,
        startedAt: null,
        completedAt: null,
        error: null,
        retryCount: 0,
        maxRetries: stepDef.maxRetries ?? 0,
      });
    }

    // Mark steps with no dependencies as ready
    const updateStmt = db.prepare(`
      UPDATE workflow_steps SET status = 'ready'
      WHERE execution_id = ? AND blocked_by_count = 0
    `);
    updateStmt.run(executionId);

    // Update returned steps
    for (const step of steps) {
      if (step.blockedByCount === 0) {
        step.status = 'ready';
      }
    }

    return steps;
  }

  /**
   * Get step by ID
   */
  getStep(id: string): WorkflowStep | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM workflow_steps WHERE id = ?');
    const row = stmt.get(id) as StepRow | undefined;
    return row ? this.rowToStep(row) : null;
  }

  /**
   * Get step by key within an execution
   */
  getStepByKey(executionId: string, stepKey: string): WorkflowStep | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(
      'SELECT * FROM workflow_steps WHERE execution_id = ? AND step_key = ?'
    );
    const row = stmt.get(executionId, stepKey) as StepRow | undefined;
    return row ? this.rowToStep(row) : null;
  }

  /**
   * Get all steps for an execution
   */
  getStepsByExecution(executionId: string): WorkflowStep[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM workflow_steps WHERE execution_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(executionId) as StepRow[];
    return rows.map((row) => this.rowToStep(row));
  }

  /**
   * Get steps ready to execute (ready status, blockedByCount = 0)
   */
  getReadySteps(executionId: string, limit: number = 10): WorkflowStep[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM workflow_steps
      WHERE execution_id = ? AND status = 'ready' AND blocked_by_count = 0
      LIMIT ?
    `);
    const rows = stmt.all(executionId, limit) as StepRow[];
    return rows.map((row) => this.rowToStep(row));
  }

  /**
   * Update step status
   */
  updateStepStatus(
    id: string,
    status: WorkflowStepStatus,
    output?: Record<string, unknown>,
    error?: string
  ): boolean {
    const db = this.storage.getDatabase();
    const now = Date.now();

    let stmt;
    if (status === 'running') {
      stmt = db.prepare(`
        UPDATE workflow_steps
        SET status = ?, started_at = COALESCE(started_at, ?)
        WHERE id = ?
      `);
      const result = stmt.run(status, now, id);
      return result.changes > 0;
    } else if (status === 'completed' || status === 'failed' || status === 'skipped') {
      stmt = db.prepare(`
        UPDATE workflow_steps
        SET status = ?, completed_at = ?, output = ?, error = ?
        WHERE id = ?
      `);
      const result = stmt.run(
        status,
        now,
        output ? JSON.stringify(output) : null,
        error ?? null,
        id
      );
      return result.changes > 0;
    } else {
      stmt = db.prepare(`
        UPDATE workflow_steps SET status = ?, error = ? WHERE id = ?
      `);
      const result = stmt.run(status, error ?? null, id);
      return result.changes > 0;
    }
  }

  /**
   * Assign step to a worker
   */
  assignStep(id: string, handle: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE workflow_steps SET assigned_to = ? WHERE id = ?
    `);
    const result = stmt.run(handle, id);
    return result.changes > 0;
  }

  /**
   * Increment retry count
   */
  incrementRetryCount(id: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE workflow_steps
      SET retry_count = retry_count + 1, status = 'ready', error = NULL
      WHERE id = ?
    `);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Decrement blocked_by_count for steps depending on completed step
   * Implements Kahn's algorithm cascade
   */
  decrementDependents(executionId: string, completedStepKey: string): void {
    const db = this.storage.getDatabase();

    // Find all steps that depend on this step
    const findStmt = db.prepare(`
      SELECT id, depends_on, blocked_by_count FROM workflow_steps
      WHERE execution_id = ? AND status = 'pending' AND depends_on LIKE '%' || ? || '%'
    `);

    const dependents = findStmt.all(executionId, completedStepKey) as Array<{
      id: string;
      depends_on: string;
      blocked_by_count: number;
    }>;

    const updateStmt = db.prepare(`
      UPDATE workflow_steps SET blocked_by_count = MAX(0, blocked_by_count - 1)
      WHERE id = ?
    `);

    const markReadyStmt = db.prepare(`
      UPDATE workflow_steps SET status = 'ready'
      WHERE id = ? AND blocked_by_count <= 1
    `);

    for (const dep of dependents) {
      const dependsOn = JSON.parse(dep.depends_on) as string[];
      if (dependsOn.includes(completedStepKey)) {
        updateStmt.run(dep.id);
        // If this was the last blocker, mark as ready
        if (dep.blocked_by_count <= 1) {
          markReadyStmt.run(dep.id);
        }
      }
    }
  }

  // ==========================================================================
  // TRIGGER MANAGEMENT
  // ==========================================================================

  /**
   * Create a trigger
   */
  createTrigger(
    workflowId: string,
    triggerType: WorkflowTriggerType,
    config: WorkflowTriggerConfig
  ): WorkflowTrigger {
    const id = uuidv4();
    const now = Date.now();
    const db = this.storage.getDatabase();

    const stmt = db.prepare(`
      INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, is_enabled, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    stmt.run(id, workflowId, triggerType, JSON.stringify(config), now);

    return {
      id,
      workflowId,
      triggerType,
      config,
      isEnabled: true,
      lastFiredAt: null,
      fireCount: 0,
      createdAt: now,
    };
  }

  /**
   * Get trigger by ID
   */
  getTrigger(id: string): WorkflowTrigger | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM workflow_triggers WHERE id = ?');
    const row = stmt.get(id) as TriggerRow | undefined;
    return row ? this.rowToTrigger(row) : null;
  }

  /**
   * Get triggers by workflow
   */
  getTriggersByWorkflow(workflowId: string): WorkflowTrigger[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM workflow_triggers WHERE workflow_id = ?');
    const rows = stmt.all(workflowId) as TriggerRow[];
    return rows.map((row) => this.rowToTrigger(row));
  }

  /**
   * Get enabled triggers by type
   */
  getEnabledTriggersByType(triggerType: WorkflowTriggerType): WorkflowTrigger[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(
      'SELECT * FROM workflow_triggers WHERE trigger_type = ? AND is_enabled = 1'
    );
    const rows = stmt.all(triggerType) as TriggerRow[];
    return rows.map((row) => this.rowToTrigger(row));
  }

  /**
   * Update trigger enabled status
   */
  setTriggerEnabled(id: string, isEnabled: boolean): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(
      'UPDATE workflow_triggers SET is_enabled = ? WHERE id = ?'
    );
    const result = stmt.run(isEnabled ? 1 : 0, id);
    return result.changes > 0;
  }

  /**
   * Record trigger fired
   */
  recordTriggerFired(id: string): void {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      UPDATE workflow_triggers
      SET last_fired_at = ?, fire_count = fire_count + 1
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }

  /**
   * Delete trigger
   */
  deleteTrigger(id: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('DELETE FROM workflow_triggers WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ==========================================================================
  // EVENT LOGGING
  // ==========================================================================

  /**
   * Log a workflow event
   */
  logEvent(
    executionId: string,
    eventType: string,
    options: LogEventOptions = {}
  ): number {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO workflow_events (execution_id, step_id, event_type, actor, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      executionId,
      options.stepId ?? null,
      eventType,
      options.actor ?? null,
      options.details ? JSON.stringify(options.details) : null,
      now
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get events for an execution
   */
  getEvents(executionId: string, limit: number = 100): WorkflowEvent[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM workflow_events
      WHERE execution_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(executionId, limit) as EventRow[];
    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * Get events for a step
   */
  getEventsByStep(stepId: string): WorkflowEvent[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM workflow_events
      WHERE step_id = ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(stepId) as EventRow[];
    return rows.map((row) => this.rowToEvent(row));
  }

  // ==========================================================================
  // TEMPLATES
  // ==========================================================================

  /**
   * Seed built-in workflow templates
   */
  seedTemplates(): void {
    const templates = [
      {
        name: 'feature-branch',
        description: 'Standard feature development: scout → implement → review → checkpoint',
        definition: {
          steps: [
            {
              key: 'scout',
              name: 'Scout Codebase',
              type: 'spawn' as const,
              config: {
                type: 'spawn' as const,
                agentRole: 'scout',
                task: 'Analyze codebase for {{feature}} implementation approach',
              },
            },
            {
              key: 'implement',
              name: 'Implement Feature',
              type: 'spawn' as const,
              dependsOn: ['scout'],
              config: {
                type: 'spawn' as const,
                agentRole: 'kraken',
                task: 'Implement {{feature}} based on scout analysis',
              },
            },
            {
              key: 'review',
              name: 'Code Review',
              type: 'checkpoint' as const,
              dependsOn: ['implement'],
              config: {
                type: 'checkpoint' as const,
                goal: 'Review {{feature}} implementation',
                toHandle: '@lead',
              },
            },
          ],
          inputs: {
            feature: { type: 'string', required: true },
          },
        },
      },
      {
        name: 'parallel-test',
        description: 'Parallel testing: setup → run tests in parallel → aggregate results',
        definition: {
          steps: [
            {
              key: 'setup',
              name: 'Test Setup',
              type: 'task' as const,
              config: {
                type: 'task' as const,
                title: 'Prepare test environment',
                description: 'Set up test fixtures and dependencies',
              },
            },
            {
              key: 'parallel-tests',
              name: 'Run Tests',
              type: 'parallel' as const,
              dependsOn: ['setup'],
              config: {
                type: 'parallel' as const,
                stepKeys: ['unit-tests', 'integration-tests', 'e2e-tests'],
              },
            },
            {
              key: 'unit-tests',
              name: 'Unit Tests',
              type: 'task' as const,
              config: {
                type: 'task' as const,
                title: 'Run unit tests',
                description: 'Execute unit test suite',
              },
            },
            {
              key: 'integration-tests',
              name: 'Integration Tests',
              type: 'task' as const,
              config: {
                type: 'task' as const,
                title: 'Run integration tests',
                description: 'Execute integration test suite',
              },
            },
            {
              key: 'e2e-tests',
              name: 'E2E Tests',
              type: 'task' as const,
              config: {
                type: 'task' as const,
                title: 'Run E2E tests',
                description: 'Execute end-to-end test suite',
              },
            },
            {
              key: 'aggregate',
              name: 'Aggregate Results',
              type: 'task' as const,
              dependsOn: ['parallel-tests'],
              config: {
                type: 'task' as const,
                title: 'Aggregate test results',
                description: 'Combine test results into final report',
              },
            },
          ],
        },
      },
      {
        name: 'checkpoint-gate',
        description: 'Approval workflow: prepare → checkpoint → gate → execute or reject',
        definition: {
          steps: [
            {
              key: 'prepare',
              name: 'Prepare Proposal',
              type: 'task' as const,
              config: {
                type: 'task' as const,
                title: 'Prepare {{action}} proposal',
                description: 'Document the proposed {{action}} and its impact',
              },
            },
            {
              key: 'approval',
              name: 'Request Approval',
              type: 'checkpoint' as const,
              dependsOn: ['prepare'],
              config: {
                type: 'checkpoint' as const,
                goal: 'Approve {{action}}',
                toHandle: '@lead',
              },
            },
            {
              key: 'gate',
              name: 'Approval Gate',
              type: 'gate' as const,
              dependsOn: ['approval'],
              config: {
                type: 'gate' as const,
                condition: {
                  type: 'expression' as const,
                  condition: 'steps.approval.output.approved === true',
                },
                onTrue: ['execute'],
                onFalse: ['reject'],
              },
            },
            {
              key: 'execute',
              name: 'Execute Action',
              type: 'task' as const,
              dependsOn: ['gate'],
              config: {
                type: 'task' as const,
                title: 'Execute {{action}}',
                description: 'Perform the approved {{action}}',
              },
            },
            {
              key: 'reject',
              name: 'Handle Rejection',
              type: 'task' as const,
              dependsOn: ['gate'],
              config: {
                type: 'task' as const,
                title: 'Handle rejection',
                description: 'Document rejection reason and notify stakeholders',
              },
            },
          ],
          inputs: {
            action: { type: 'string', required: true },
          },
        },
      },
    ];

    for (const template of templates) {
      const existing = this.getWorkflowByName(template.name);
      if (existing) {
        // Update existing template to latest definition
        this.updateWorkflow(
          existing.id,
          template.definition as WorkflowDefinition,
          template.description
        );
        console.log(`[WORKFLOW] Updated template: ${template.name}`);
        continue;
      }

      this.createWorkflow(template.name, template.definition as WorkflowDefinition, {
        description: template.description,
        isTemplate: true,
      });

      console.log(`[WORKFLOW] Seeded template: ${template.name}`);
    }
  }

  // ==========================================================================
  // ROW CONVERTERS
  // ==========================================================================

  private rowToWorkflow(row: WorkflowRow): Workflow {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      definition: JSON.parse(row.definition) as WorkflowDefinition,
      isTemplate: row.is_template === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToExecution(row: ExecutionRow): WorkflowExecution {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      swarmId: row.swarm_id,
      status: row.status as WorkflowStatus,
      context: JSON.parse(row.context) as Record<string, unknown>,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      createdAt: row.created_at,
      createdBy: row.created_by,
    };
  }

  private rowToStep(row: StepRow): WorkflowStep {
    return {
      id: row.id,
      executionId: row.execution_id,
      stepKey: row.step_key,
      name: row.name,
      stepType: row.step_type as WorkflowStep['stepType'],
      status: row.status as WorkflowStepStatus,
      config: JSON.parse(row.config) as WorkflowStepConfig,
      dependsOn: JSON.parse(row.depends_on) as string[],
      blockedByCount: row.blocked_by_count,
      output: row.output ? (JSON.parse(row.output) as Record<string, unknown>) : null,
      assignedTo: row.assigned_to,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
    };
  }

  private rowToTrigger(row: TriggerRow): WorkflowTrigger {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      triggerType: row.trigger_type as WorkflowTriggerType,
      config: JSON.parse(row.config) as WorkflowTriggerConfig,
      isEnabled: row.is_enabled === 1,
      lastFiredAt: row.last_fired_at,
      fireCount: row.fire_count,
      createdAt: row.created_at,
    };
  }

  private rowToEvent(row: EventRow): WorkflowEvent {
    return {
      id: row.id,
      executionId: row.execution_id,
      stepId: row.step_id,
      eventType: row.event_type,
      actor: row.actor,
      details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
      createdAt: row.created_at,
    };
  }
}
