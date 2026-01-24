/**
 * Work Item Route Handlers
 *
 * Work item and batch management endpoints.
 */

import type { Request, Response } from 'express';
import {
  validateBody,
  createWorkItemSchema,
  updateWorkItemSchema,
  createBatchSchema,
  dispatchBatchSchema,
} from '../validation/schemas.js';
import type {
  ErrorResponse,
  WorkItemStatus,
  WorkItem,
} from '../types.js';
import type { RouteDependencies } from './types.js';

// ============================================================================
// WORK ITEM HANDLERS
// ============================================================================

export function createCreateWorkItemHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(createWorkItemSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { title, description, assignedTo, batchId } = validation.data;
    const workItem = await deps.storage.workItem.createWorkItem(title, {
      description: description ?? undefined,
      assignedTo,
      batchId: batchId ?? undefined,
    });
    console.log(`[WORKITEM] Created ${workItem.id}: ${title}`);
    res.json(workItem);
  };
}

export function createListWorkItemsHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const { status, assignee, batch } = req.query as {
      status?: string;
      assignee?: string;
      batch?: string;
    };

    const options: { status?: WorkItemStatus; assignedTo?: string; batchId?: string } = {};
    if (status) options.status = status as WorkItemStatus;
    if (assignee) options.assignedTo = assignee;
    if (batch) options.batchId = batch;

    const workItems = await deps.storage.workItem.listWorkItems(options);
    res.json(workItems);
  };
}

export function createGetWorkItemHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const workItem = await deps.storage.workItem.getWorkItem(id);

    if (!workItem) {
      res.status(404).json({ error: 'Work item not found' } as ErrorResponse);
      return;
    }

    res.json(workItem);
  };
}

export function createUpdateWorkItemHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const validation = validateBody(updateWorkItemSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { status, actor } = validation.data;

    // Check if work item exists first
    const existing = await deps.storage.workItem.getWorkItem(id);
    if (!existing) {
      res.status(404).json({ error: 'Work item not found' } as ErrorResponse);
      return;
    }

    await deps.storage.workItem.updateWorkItemStatus(id, status as WorkItemStatus, actor);

    // Get updated work item
    const updated = await deps.storage.workItem.getWorkItem(id);
    console.log(`[WORKITEM] ${id} -> ${status}`);
    res.json(updated);
  };
}

// ============================================================================
// BATCH HANDLERS
// ============================================================================

export function createCreateBatchHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(createBatchSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { name, workItemIds } = validation.data;
    const batch = await deps.storage.workItem.createBatch(name, workItemIds);
    console.log(`[BATCH] Created ${batch.id}: ${name}`);
    res.json(batch);
  };
}

export function createListBatchesHandler(deps: RouteDependencies) {
  return async (_req: Request, res: Response): Promise<void> => {
    const batches = await deps.storage.workItem.listBatches();
    res.json(batches);
  };
}

export function createGetBatchHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const batch = await deps.storage.workItem.getBatch(id);

    if (!batch) {
      res.status(404).json({ error: 'Batch not found' } as ErrorResponse);
      return;
    }

    const workItems = await deps.storage.workItem.listWorkItems({ batchId: id });
    res.json({ ...batch, workItems });
  };
}

export function createDispatchBatchHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const validation = validateBody(dispatchBatchSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const batch = await deps.storage.workItem.getBatch(id);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' } as ErrorResponse);
      return;
    }

    const result = await deps.storage.workItem.dispatchBatch(id);
    console.log(`[BATCH] Dispatched ${id} (${result.dispatchedCount} items)`);
    res.json(result);
  };
}
