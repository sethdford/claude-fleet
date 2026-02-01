/**
 * Routing Route Handlers
 *
 * Exposes task routing classification via HTTP endpoint.
 * Delegates to WorkerManager.getRoutingRecommendation() which uses the TaskRouter.
 */

import type { Request, Response } from 'express';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';

/**
 * POST /routing/classify
 *
 * Classify a task and return routing recommendation (complexity, strategy, model, confidence).
 * Body: { subject: string, description?: string, blockedBy?: string[] }
 */
export function createRoutingClassifyHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { subject, description, blockedBy } = req.body as {
      subject?: string;
      description?: string;
      blockedBy?: string[];
    };

    if (!subject) {
      res.status(400).json({ error: 'Missing required field: subject' });
      return;
    }

    const recommendation = deps.workerManager.getRoutingRecommendation({
      subject,
      description,
      blockedBy,
    });

    if (!recommendation) {
      res.status(503).json({ error: 'Task routing subsystem not available' });
      return;
    }

    res.json(recommendation);
  });
}
