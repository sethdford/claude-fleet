/**
 * Tests for workflow route handlers
 *
 * Covers: workflow CRUD, executions, steps, triggers, events
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';

vi.mock('../metrics/prometheus.js', () => ({
  agentAuthentications: { inc: vi.fn() },
  tasksCreated: { inc: vi.fn() },
  tasksCompleted: { inc: vi.fn() },
}));

import {
  createCreateWorkflowHandler,
  createListWorkflowsHandler,
  createGetWorkflowHandler,
  createUpdateWorkflowHandler,
  createDeleteWorkflowHandler,
  createStartWorkflowHandler,
  createListExecutionsHandler,
  createGetExecutionHandler,
  createPauseExecutionHandler,
  createResumeExecutionHandler,
  createCancelExecutionHandler,
  createGetExecutionStepsHandler,
  createRetryStepHandler,
  createCompleteStepHandler,
  createCreateTriggerHandler,
  createListTriggersHandler,
  createDeleteTriggerHandler,
  createGetExecutionEventsHandler,
} from './workflows.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_STEP = { key: 'build', name: 'build', type: 'task' as const, config: { type: 'task' as const, title: 'Build project' } };
const VALID_DEFINITION = { steps: [VALID_STEP] };

describe('Workflow Route Handlers', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  // ======================================================================
  // WORKFLOW CRUD
  // ======================================================================

  describe('Workflow CRUD', () => {
    it('should create a workflow', () => {
      const handler = createCreateWorkflowHandler(deps);
      const req = createMockReq({
        body: {
          name: 'deploy-pipeline',
          definition: VALID_DEFINITION,
          description: 'CI/CD pipeline',
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should reject duplicate workflow name', () => {
      (deps.workflowStorage!.getWorkflowByName as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'wf-1',
        name: 'deploy-pipeline',
      });

      const handler = createCreateWorkflowHandler(deps);
      const req = createMockReq({
        body: {
          name: 'deploy-pipeline',
          definition: VALID_DEFINITION,
        },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('should return 500 when workflowStorage is not initialized', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createCreateWorkflowHandler(deps);
      const req = createMockReq({
        body: { name: 'test', definition: VALID_DEFINITION },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should list workflows', () => {
      (deps.workflowStorage!.listWorkflows as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'wf-1', name: 'test', createdAt: Date.now() },
      ]);

      const handler = createListWorkflowsHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveLength(1);
    });

    it('should get a workflow by id', () => {
      (deps.workflowStorage!.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue({
        id: VALID_UUID,
        name: 'test',
      });

      const handler = createGetWorkflowHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
    });

    it('should return 404 for missing workflow', () => {
      const handler = createGetWorkflowHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should update a workflow', () => {
      (deps.workflowStorage!.getWorkflow as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ id: VALID_UUID, name: 'test', definition: { steps: [] } })
        .mockReturnValueOnce({ id: VALID_UUID, name: 'test', definition: { steps: [{ name: 'build' }] } });

      const handler = createUpdateWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { definition: { steps: [{ name: 'build' }] } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
    });

    it('should return 404 when updating non-existent workflow', () => {
      const handler = createUpdateWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { description: 'updated' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should delete a workflow', () => {
      const handler = createDeleteWorkflowHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should return 404 when deleting non-existent workflow', () => {
      (deps.workflowStorage!.deleteWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const handler = createDeleteWorkflowHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ======================================================================
  // EXECUTION HANDLERS
  // ======================================================================

  describe('Execution Handlers', () => {
    it('should start a workflow execution', async () => {
      const handler = createStartWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { inputs: { branch: 'main' } },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return 500 when workflow engine not initialized', async () => {
      deps = { ...deps, workflowEngine: undefined } as unknown as RouteDependencies;

      const handler = createStartWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { inputs: {} },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should list executions', () => {
      (deps.workflowStorage!.listExecutions as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createListExecutionsHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
    });

    it('should get execution by id', () => {
      (deps.workflowStorage!.getExecution as ReturnType<typeof vi.fn>).mockReturnValue({
        id: VALID_UUID,
        status: 'running',
      });

      const handler = createGetExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
    });

    it('should return 404 for missing execution', () => {
      const handler = createGetExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should pause an execution', async () => {
      const handler = createPauseExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should return 400 when pause fails', async () => {
      (deps.workflowEngine!.pauseWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const handler = createPauseExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should resume an execution', async () => {
      const handler = createResumeExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should cancel an execution', async () => {
      const handler = createCancelExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });
  });

  // ======================================================================
  // STEP HANDLERS
  // ======================================================================

  describe('Step Handlers', () => {
    it('should get steps for an execution', () => {
      (deps.workflowStorage!.getExecution as ReturnType<typeof vi.fn>).mockReturnValue({
        id: VALID_UUID,
        status: 'running',
      });
      (deps.workflowStorage!.getStepsByExecution as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'step-1', name: 'build', status: 'completed' },
      ]);

      const handler = createGetExecutionStepsHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveLength(1);
    });

    it('should return 404 for steps of missing execution', () => {
      const handler = createGetExecutionStepsHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should retry a step', async () => {
      const handler = createRetryStepHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should return 400 when retry fails', async () => {
      (deps.workflowEngine!.retryStep as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const handler = createRetryStepHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should complete a step', async () => {
      const handler = createCompleteStepHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { output: { result: 'success' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.json).toHaveBeenCalled();
      });

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should return 400 when complete step fails', async () => {
      (deps.workflowEngine!.completeStep as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const handler = createCompleteStepHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { output: {} },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ======================================================================
  // TRIGGER HANDLERS
  // ======================================================================

  describe('Trigger Handlers', () => {
    it('should create a trigger', () => {
      (deps.workflowStorage!.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue({
        id: VALID_UUID,
        name: 'test',
      });

      const handler = createCreateTriggerHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { triggerType: 'schedule', config: { type: 'schedule', cron: '0 * * * *' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return 404 when creating trigger for missing workflow', () => {
      const handler = createCreateTriggerHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { triggerType: 'schedule', config: { type: 'schedule', cron: '*/5 * * * *' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should list triggers', () => {
      (deps.workflowStorage!.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue({
        id: VALID_UUID,
        name: 'test',
      });
      (deps.workflowStorage!.getTriggersByWorkflow as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createListTriggersHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
    });

    it('should delete a trigger', () => {
      const handler = createDeleteTriggerHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should return 404 when deleting non-existent trigger', () => {
      (deps.workflowStorage!.deleteTrigger as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const handler = createDeleteTriggerHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ======================================================================
  // EVENT HANDLERS
  // ======================================================================

  describe('Event Handlers', () => {
    it('should get events for an execution', () => {
      (deps.workflowStorage!.getExecution as ReturnType<typeof vi.fn>).mockReturnValue({
        id: VALID_UUID,
        status: 'running',
      });
      (deps.workflowStorage!.getEvents as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'evt-1', type: 'step_started', timestamp: Date.now() },
      ]);

      const handler = createGetExecutionEventsHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID }, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveLength(1);
    });

    it('should return 404 for events of missing execution', () => {
      const handler = createGetExecutionEventsHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID }, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ======================================================================
  // VALIDATION & ERROR BRANCH COVERAGE
  // ======================================================================

  describe('Validation Failures', () => {
    // --- createCreateWorkflowHandler: body validation failure (lines 37-38) ---
    it('should return 400 when create workflow body is invalid', () => {
      const handler = createCreateWorkflowHandler(deps);
      const req = createMockReq({
        body: { name: '', definition: {} },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createListWorkflowsHandler: query validation failure (lines 72-73) ---
    it('should return 400 when list workflows query is invalid', () => {
      const handler = createListWorkflowsHandler(deps);
      const req = createMockReq({
        query: { limit: 'not-a-number' } as Record<string, string | undefined>,
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createGetWorkflowHandler: invalid param (lines 98-99) ---
    it('should return 400 when get workflow id is invalid', () => {
      const handler = createGetWorkflowHandler(deps);
      const req = createMockReq({ params: { id: 'not-a-uuid' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createUpdateWorkflowHandler: invalid param (lines 124-125) ---
    it('should return 400 when update workflow id is invalid', () => {
      const handler = createUpdateWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: 'bad-uuid' },
        body: { description: 'updated' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createUpdateWorkflowHandler: body validation failure (lines 129-131) ---
    it('should return 400 when update workflow body is invalid', () => {
      const handler = createUpdateWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: {},
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createDeleteWorkflowHandler: invalid param (lines 168-169) ---
    it('should return 400 when delete workflow id is invalid', () => {
      const handler = createDeleteWorkflowHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createStartWorkflowHandler: invalid param (lines 200-201) ---
    it('should return 400 when start workflow id is invalid', async () => {
      const handler = createStartWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: 'bad-id' },
        body: { inputs: {} },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createStartWorkflowHandler: body validation failure (lines 206-207) ---
    it('should return 400 when start workflow body is invalid', async () => {
      const handler = createStartWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { inputs: 'not-an-object' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createListExecutionsHandler: query validation failure (lines 241-242) ---
    it('should return 400 when list executions query is invalid', () => {
      const handler = createListExecutionsHandler(deps);
      const req = createMockReq({
        query: { status: 'invalid-status' } as Record<string, string | undefined>,
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createGetExecutionHandler: invalid param (lines 275-276) ---
    it('should return 400 when get execution id is invalid', () => {
      const handler = createGetExecutionHandler(deps);
      const req = createMockReq({ params: { id: 'not-uuid' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createPauseExecutionHandler: invalid param (lines 301-302) ---
    it('should return 400 when pause execution id is invalid', async () => {
      const handler = createPauseExecutionHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createResumeExecutionHandler: invalid param (lines 328-329) ---
    it('should return 400 when resume execution id is invalid', async () => {
      const handler = createResumeExecutionHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createCancelExecutionHandler: invalid param (lines 355-356) ---
    it('should return 400 when cancel execution id is invalid', async () => {
      const handler = createCancelExecutionHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createGetExecutionStepsHandler: invalid param (lines 386-387) ---
    it('should return 400 when get execution steps id is invalid', () => {
      const handler = createGetExecutionStepsHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createRetryStepHandler: invalid param (lines 413-414) ---
    it('should return 400 when retry step id is invalid', async () => {
      const handler = createRetryStepHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createCompleteStepHandler: invalid param (lines 440-441) ---
    it('should return 400 when complete step id is invalid', async () => {
      const handler = createCompleteStepHandler(deps);
      const req = createMockReq({
        params: { id: 'bad-id' },
        body: { output: {} },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createCompleteStepHandler: body validation failure (lines 446-447) ---
    it('should return 400 when complete step body is invalid', async () => {
      const handler = createCompleteStepHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { error: 'x'.repeat(1001) },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createCreateTriggerHandler: invalid param (lines 482-483) ---
    it('should return 400 when create trigger workflow id is invalid', () => {
      const handler = createCreateTriggerHandler(deps);
      const req = createMockReq({
        params: { id: 'bad-id' },
        body: { triggerType: 'schedule', config: { type: 'schedule', cron: '0 * * * *' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createCreateTriggerHandler: body validation failure (lines 488-489) ---
    it('should return 400 when create trigger body is invalid', () => {
      const handler = createCreateTriggerHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { triggerType: 'invalid-type' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createListTriggersHandler: invalid param (lines 523-524) ---
    it('should return 400 when list triggers workflow id is invalid', () => {
      const handler = createListTriggersHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createDeleteTriggerHandler: invalid param (lines 551-552) ---
    it('should return 400 when delete trigger id is invalid', () => {
      const handler = createDeleteTriggerHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createGetExecutionEventsHandler: invalid param (lines 582-583) ---
    it('should return 400 when get execution events id is invalid', () => {
      const handler = createGetExecutionEventsHandler(deps);
      const req = createMockReq({ params: { id: 'bad-id' }, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ======================================================================
  // MISSING DEPENDENCY (workflowStorage/workflowEngine undefined) COVERAGE
  // ======================================================================

  describe('Missing Dependencies', () => {
    // --- createListWorkflowsHandler: workflowStorage undefined (lines 77-78) ---
    it('should return 500 when listing workflows without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createListWorkflowsHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createGetWorkflowHandler: workflowStorage undefined (lines 103-104) ---
    it('should return 500 when getting workflow without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createGetWorkflowHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createUpdateWorkflowHandler: workflowStorage undefined (lines 135-136) ---
    it('should return 500 when updating workflow without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createUpdateWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { description: 'updated' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createDeleteWorkflowHandler: workflowStorage undefined (lines 173-174) ---
    it('should return 500 when deleting workflow without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createDeleteWorkflowHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createListExecutionsHandler: workflowStorage undefined (lines 246-247) ---
    it('should return 500 when listing executions without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createListExecutionsHandler(deps);
      const req = createMockReq({ query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createGetExecutionHandler: workflowStorage undefined (lines 280-281) ---
    it('should return 500 when getting execution without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createGetExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createPauseExecutionHandler: workflowEngine undefined (lines 306-307) ---
    it('should return 500 when pausing execution without workflowEngine', async () => {
      deps = { ...deps, workflowEngine: undefined } as unknown as RouteDependencies;

      const handler = createPauseExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createResumeExecutionHandler: workflowEngine undefined (lines 333-334) ---
    it('should return 500 when resuming execution without workflowEngine', async () => {
      deps = { ...deps, workflowEngine: undefined } as unknown as RouteDependencies;

      const handler = createResumeExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createCancelExecutionHandler: workflowEngine undefined (lines 360-361) ---
    it('should return 500 when cancelling execution without workflowEngine', async () => {
      deps = { ...deps, workflowEngine: undefined } as unknown as RouteDependencies;

      const handler = createCancelExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createGetExecutionStepsHandler: workflowStorage undefined (lines 391-392) ---
    it('should return 500 when getting execution steps without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createGetExecutionStepsHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createRetryStepHandler: workflowEngine undefined (lines 418-419) ---
    it('should return 500 when retrying step without workflowEngine', async () => {
      deps = { ...deps, workflowEngine: undefined } as unknown as RouteDependencies;

      const handler = createRetryStepHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createCompleteStepHandler: workflowEngine undefined (lines 451-452) ---
    it('should return 500 when completing step without workflowEngine', async () => {
      deps = { ...deps, workflowEngine: undefined } as unknown as RouteDependencies;

      const handler = createCompleteStepHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { output: { result: 'done' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createCreateTriggerHandler: workflowStorage undefined (lines 493-494) ---
    it('should return 500 when creating trigger without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createCreateTriggerHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { triggerType: 'schedule', config: { type: 'schedule', cron: '0 * * * *' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createListTriggersHandler: workflowStorage undefined (lines 528-529) ---
    it('should return 500 when listing triggers without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createListTriggersHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createDeleteTriggerHandler: workflowStorage undefined (lines 556-557) ---
    it('should return 500 when deleting trigger without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createDeleteTriggerHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createGetExecutionEventsHandler: workflowStorage undefined (lines 587-588) ---
    it('should return 500 when getting execution events without workflowStorage', () => {
      deps = { ...deps, workflowStorage: undefined } as unknown as RouteDependencies;

      const handler = createGetExecutionEventsHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID }, query: {} });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ======================================================================
  // EDGE CASES & ADDITIONAL ERROR BRANCHES
  // ======================================================================

  describe('Edge Cases', () => {
    // --- createUpdateWorkflowHandler: updateWorkflow returns false (lines 150-151) ---
    it('should return 500 when updateWorkflow fails', () => {
      (deps.workflowStorage!.getWorkflow as ReturnType<typeof vi.fn>)
        .mockReturnValue({ id: VALID_UUID, name: 'test', definition: VALID_DEFINITION });
      (deps.workflowStorage!.updateWorkflow as ReturnType<typeof vi.fn>)
        .mockReturnValue(false);

      const handler = createUpdateWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { description: 'updated desc' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // --- createUpdateWorkflowHandler: uses existing definition when none provided (line 147) ---
    it('should use existing definition when update body has no definition', () => {
      const existingDef = { steps: [VALID_STEP] };
      (deps.workflowStorage!.getWorkflow as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ id: VALID_UUID, name: 'test', definition: existingDef })
        .mockReturnValueOnce({ id: VALID_UUID, name: 'test', definition: existingDef, description: 'new desc' });
      (deps.workflowStorage!.updateWorkflow as ReturnType<typeof vi.fn>)
        .mockReturnValue(true);

      const handler = createUpdateWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { description: 'new desc' },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(deps.workflowStorage!.updateWorkflow).toHaveBeenCalledWith(VALID_UUID, existingDef, 'new desc');
      expect(res.json).toHaveBeenCalled();
    });

    // --- createStartWorkflowHandler: startWorkflow throws error (line 229) ---
    it('should return 400 when startWorkflow throws', async () => {
      (deps.workflowEngine!.startWorkflow as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('Workflow not found'));

      const handler = createStartWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { inputs: {} },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createStartWorkflowHandler: user handle defaults to 'unknown' ---
    it('should default createdBy to unknown when no user on request', async () => {
      const handler = createStartWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { inputs: { key: 'value' } },
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(deps.workflowEngine!.startWorkflow).toHaveBeenCalledWith(
        VALID_UUID,
        'unknown',
        { key: 'value' },
        undefined,
      );
    });

    // --- createListExecutionsHandler: with all filter options (lines 258-261) ---
    it('should pass all query options to listExecutions', () => {
      (deps.workflowStorage!.listExecutions as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createListExecutionsHandler(deps);
      const req = createMockReq({
        query: {
          workflowId: VALID_UUID,
          status: 'running',
          swarmId: 'swarm-1',
          limit: '10',
        } as Record<string, string | undefined>,
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(deps.workflowStorage!.listExecutions).toHaveBeenCalledWith({
        workflowId: VALID_UUID,
        status: 'running',
        swarmId: 'swarm-1',
        limit: 10,
      });
      expect(res.json).toHaveBeenCalled();
    });

    // --- createListWorkflowsHandler: with isTemplate and limit options (lines 83-84) ---
    it('should pass isTemplate and limit options to listWorkflows', () => {
      (deps.workflowStorage!.listWorkflows as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const handler = createListWorkflowsHandler(deps);
      const req = createMockReq({
        query: { isTemplate: 'true', limit: '5' } as Record<string, string | undefined>,
      });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(deps.workflowStorage!.listWorkflows).toHaveBeenCalledWith({
        isTemplate: true,
        limit: 5,
      });
      expect(res.json).toHaveBeenCalled();
    });

    // --- createResumeExecutionHandler: resume fails (lines 339-340) ---
    it('should return 400 when resume fails', async () => {
      (deps.workflowEngine!.resumeWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const handler = createResumeExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createCancelExecutionHandler: cancel fails (lines 366-367) ---
    it('should return 400 when cancel fails', async () => {
      (deps.workflowEngine!.cancelWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const handler = createCancelExecutionHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // --- createListTriggersHandler: workflow not found (lines 535-536) ---
    it('should return 404 when listing triggers for non-existent workflow', () => {
      const handler = createListTriggersHandler(deps);
      const req = createMockReq({ params: { id: VALID_UUID } });
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    // --- createStartWorkflowHandler: with swarmId (line 223) ---
    it('should pass swarmId to startWorkflow', async () => {
      const handler = createStartWorkflowHandler(deps);
      const req = createMockReq({
        params: { id: VALID_UUID },
        body: { inputs: { x: 1 }, swarmId: 'my-swarm' },
      });
      ((req as unknown) as Record<string, unknown>).user = { handle: 'agent-1' };
      const res = createMockRes();

      handler(req as unknown as Request, res as unknown as Response);
      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalled();
      });

      expect(deps.workflowEngine!.startWorkflow).toHaveBeenCalledWith(
        VALID_UUID,
        'agent-1',
        { x: 1 },
        'my-swarm',
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });
});
