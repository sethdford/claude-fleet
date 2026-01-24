/**
 * Workflow Route Handlers
 *
 * REST API for workflow definitions, executions, steps, and triggers.
 * Requires WorkflowStorage and WorkflowEngine in RouteDependencies.
 */

import type { Request, Response } from 'express';
import {
  validateBody,
  validateQuery,
  createWorkflowSchema,
  updateWorkflowSchema,
  startWorkflowSchema,
  createTriggerSchema,
  completeStepSchema,
  listWorkflowsQuerySchema,
  listExecutionsQuerySchema,
  uuidIdParamSchema,
} from '../validation/schemas.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type { ErrorResponse } from '../types.js';
import type { RouteDependencies } from './types.js';

// ============================================================================
// WORKFLOW CRUD HANDLERS
// ============================================================================

/**
 * POST /workflows - Create a new workflow
 */
export function createCreateWorkflowHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const validation = validateBody(createWorkflowSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const { name, definition, description, isTemplate } = validation.data;

    // Check if workflow with this name already exists
    const existing = deps.workflowStorage.getWorkflowByName(name);
    if (existing) {
      res.status(409).json({ error: `Workflow '${name}' already exists` } as ErrorResponse);
      return;
    }

    const workflow = deps.workflowStorage.createWorkflow(name, definition, {
      description,
      isTemplate,
    });

    console.log(`[WORKFLOW] Created ${workflow.id}: ${name}`);
    res.status(201).json(workflow);
  };
}

/**
 * GET /workflows - List workflows
 */
export function createListWorkflowsHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const queryValidation = validateQuery(listWorkflowsQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const { isTemplate, limit } = queryValidation.data;
    const options: { isTemplate?: boolean; limit?: number } = {};
    if (isTemplate !== undefined) options.isTemplate = isTemplate === 'true';
    if (limit) options.limit = limit;

    const workflows = deps.workflowStorage.listWorkflows(options);
    res.json(workflows);
  };
}

/**
 * GET /workflows/:id - Get workflow by ID
 */
export function createGetWorkflowHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid workflow ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const workflow = deps.workflowStorage.getWorkflow(paramValidation.data.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' } as ErrorResponse);
      return;
    }

    res.json(workflow);
  };
}

/**
 * PATCH /workflows/:id - Update workflow
 */
export function createUpdateWorkflowHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid workflow ID format' } as ErrorResponse);
      return;
    }

    const validation = validateBody(updateWorkflowSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const { id } = paramValidation.data;
    const existing = deps.workflowStorage.getWorkflow(id);
    if (!existing) {
      res.status(404).json({ error: 'Workflow not found' } as ErrorResponse);
      return;
    }

    // updateWorkflow requires a definition - if not provided, use existing
    const definition = validation.data.definition ?? existing.definition;
    const success = deps.workflowStorage.updateWorkflow(id, definition, validation.data.description);
    if (!success) {
      res.status(500).json({ error: 'Failed to update workflow' } as ErrorResponse);
      return;
    }

    const updated = deps.workflowStorage.getWorkflow(id);

    console.log(`[WORKFLOW] Updated ${id}`);
    res.json(updated);
  };
}

/**
 * DELETE /workflows/:id - Delete workflow
 */
export function createDeleteWorkflowHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid workflow ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const { id } = paramValidation.data;
    const success = deps.workflowStorage.deleteWorkflow(id);
    if (!success) {
      res.status(404).json({ error: 'Workflow not found' } as ErrorResponse);
      return;
    }

    console.log(`[WORKFLOW] Deleted ${id}`);
    res.json({ success: true, id });
  };
}

// ============================================================================
// WORKFLOW EXECUTION HANDLERS
// ============================================================================

/**
 * POST /workflows/:id/start - Start workflow execution
 */
export function createStartWorkflowHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid workflow ID format' } as ErrorResponse);
      return;
    }

    const validation = validateBody(startWorkflowSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    if (!deps.workflowEngine) {
      res.status(500).json({ error: 'Workflow engine not initialized' } as ErrorResponse);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const createdBy = authReq.user?.handle ?? 'unknown';

    try {
      const execution = await deps.workflowEngine.startWorkflow(
        paramValidation.data.id,
        createdBy,
        validation.data.inputs,
        validation.data.swarmId
      );

      console.log(`[WORKFLOW] Started execution ${execution.id} for workflow ${paramValidation.data.id}`);
      res.status(201).json(execution);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message } as ErrorResponse);
    }
  };
}

/**
 * GET /executions - List executions
 */
export function createListExecutionsHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const queryValidation = validateQuery(listExecutionsQuerySchema, req.query);
    if (!queryValidation.success) {
      res.status(400).json({ error: queryValidation.error } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const { workflowId, status, swarmId, limit } = queryValidation.data;
    const options: {
      workflowId?: string;
      status?: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
      swarmId?: string;
      limit?: number;
    } = {};

    if (workflowId) options.workflowId = workflowId;
    if (status) options.status = status;
    if (swarmId) options.swarmId = swarmId;
    if (limit) options.limit = limit;

    const executions = deps.workflowStorage.listExecutions(options);
    res.json(executions);
  };
}

/**
 * GET /executions/:id - Get execution by ID
 */
export function createGetExecutionHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid execution ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const execution = deps.workflowStorage.getExecution(paramValidation.data.id);
    if (!execution) {
      res.status(404).json({ error: 'Execution not found' } as ErrorResponse);
      return;
    }

    res.json(execution);
  };
}

/**
 * POST /executions/:id/pause - Pause execution
 */
export function createPauseExecutionHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid execution ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowEngine) {
      res.status(500).json({ error: 'Workflow engine not initialized' } as ErrorResponse);
      return;
    }

    const success = await deps.workflowEngine.pauseWorkflow(paramValidation.data.id);
    if (!success) {
      res.status(400).json({ error: 'Cannot pause execution (not running or not found)' } as ErrorResponse);
      return;
    }

    console.log(`[WORKFLOW] Paused execution ${paramValidation.data.id}`);
    res.json({ success: true, id: paramValidation.data.id });
  };
}

/**
 * POST /executions/:id/resume - Resume execution
 */
export function createResumeExecutionHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid execution ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowEngine) {
      res.status(500).json({ error: 'Workflow engine not initialized' } as ErrorResponse);
      return;
    }

    const success = await deps.workflowEngine.resumeWorkflow(paramValidation.data.id);
    if (!success) {
      res.status(400).json({ error: 'Cannot resume execution (not paused or not found)' } as ErrorResponse);
      return;
    }

    console.log(`[WORKFLOW] Resumed execution ${paramValidation.data.id}`);
    res.json({ success: true, id: paramValidation.data.id });
  };
}

/**
 * POST /executions/:id/cancel - Cancel execution
 */
export function createCancelExecutionHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid execution ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowEngine) {
      res.status(500).json({ error: 'Workflow engine not initialized' } as ErrorResponse);
      return;
    }

    const success = await deps.workflowEngine.cancelWorkflow(paramValidation.data.id);
    if (!success) {
      res.status(400).json({ error: 'Cannot cancel execution (already completed/cancelled or not found)' } as ErrorResponse);
      return;
    }

    console.log(`[WORKFLOW] Cancelled execution ${paramValidation.data.id}`);
    res.json({ success: true, id: paramValidation.data.id });
  };
}

// ============================================================================
// STEP HANDLERS
// ============================================================================

/**
 * GET /executions/:id/steps - Get steps for execution
 */
export function createGetExecutionStepsHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid execution ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const execution = deps.workflowStorage.getExecution(paramValidation.data.id);
    if (!execution) {
      res.status(404).json({ error: 'Execution not found' } as ErrorResponse);
      return;
    }

    const steps = deps.workflowStorage.getStepsByExecution(paramValidation.data.id);
    res.json(steps);
  };
}

/**
 * POST /steps/:id/retry - Retry a failed step
 */
export function createRetryStepHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid step ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowEngine) {
      res.status(500).json({ error: 'Workflow engine not initialized' } as ErrorResponse);
      return;
    }

    const success = await deps.workflowEngine.retryStep(paramValidation.data.id);
    if (!success) {
      res.status(400).json({ error: 'Cannot retry step (not failed or max retries exceeded)' } as ErrorResponse);
      return;
    }

    console.log(`[WORKFLOW] Retrying step ${paramValidation.data.id}`);
    res.json({ success: true, id: paramValidation.data.id });
  };
}

/**
 * POST /steps/:id/complete - Manually complete a step
 */
export function createCompleteStepHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid step ID format' } as ErrorResponse);
      return;
    }

    const validation = validateBody(completeStepSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    if (!deps.workflowEngine) {
      res.status(500).json({ error: 'Workflow engine not initialized' } as ErrorResponse);
      return;
    }

    const success = await deps.workflowEngine.completeStep(
      paramValidation.data.id,
      validation.data.output,
      validation.data.error
    );

    if (!success) {
      res.status(400).json({ error: 'Cannot complete step (not in progress or not found)' } as ErrorResponse);
      return;
    }

    console.log(`[WORKFLOW] Completed step ${paramValidation.data.id}`);
    res.json({ success: true, id: paramValidation.data.id });
  };
}

// ============================================================================
// TRIGGER HANDLERS
// ============================================================================

/**
 * POST /workflows/:id/triggers - Create a trigger for workflow
 */
export function createCreateTriggerHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid workflow ID format' } as ErrorResponse);
      return;
    }

    const validation = validateBody(createTriggerSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    // Verify workflow exists
    const workflow = deps.workflowStorage.getWorkflow(paramValidation.data.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' } as ErrorResponse);
      return;
    }

    const { triggerType, config } = validation.data;
    const trigger = deps.workflowStorage.createTrigger(
      paramValidation.data.id,
      triggerType,
      config
    );

    console.log(`[WORKFLOW] Created trigger ${trigger.id} for workflow ${paramValidation.data.id}`);
    res.status(201).json(trigger);
  };
}

/**
 * GET /workflows/:id/triggers - List triggers for workflow
 */
export function createListTriggersHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid workflow ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    // Verify workflow exists
    const workflow = deps.workflowStorage.getWorkflow(paramValidation.data.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' } as ErrorResponse);
      return;
    }

    const triggers = deps.workflowStorage.getTriggersByWorkflow(paramValidation.data.id);
    res.json(triggers);
  };
}

/**
 * DELETE /triggers/:id - Delete a trigger
 */
export function createDeleteTriggerHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid trigger ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const success = deps.workflowStorage.deleteTrigger(paramValidation.data.id);
    if (!success) {
      res.status(404).json({ error: 'Trigger not found' } as ErrorResponse);
      return;
    }

    console.log(`[WORKFLOW] Deleted trigger ${paramValidation.data.id}`);
    res.json({ success: true, id: paramValidation.data.id });
  };
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * GET /executions/:id/events - Get events for execution
 */
export function createGetExecutionEventsHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const paramValidation = validateQuery(uuidIdParamSchema, req.params);
    if (!paramValidation.success) {
      res.status(400).json({ error: 'Invalid execution ID format' } as ErrorResponse);
      return;
    }

    if (!deps.workflowStorage) {
      res.status(500).json({ error: 'Workflow system not initialized' } as ErrorResponse);
      return;
    }

    const execution = deps.workflowStorage.getExecution(paramValidation.data.id);
    if (!execution) {
      res.status(404).json({ error: 'Execution not found' } as ErrorResponse);
      return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 100;
    const events = deps.workflowStorage.getEvents(paramValidation.data.id, limit);
    res.json(events);
  };
}
