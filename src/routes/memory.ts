/**
 * Memory Route Handlers
 *
 * Exposes agent memory store/recall/search/list via HTTP endpoints.
 * Delegates to the AgentMemory class for persistent storage with FTS5 search.
 */

import type { Request, Response } from 'express';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';
import type { MemoryType } from '../storage/agent-memory.js';

/**
 * POST /memory/store
 *
 * Store a memory for an agent. If a memory with the same key exists, it is updated.
 * Body: { agentId: string, key: string, value: string, memoryType?: string, tags?: string[] }
 */
export function createMemoryStoreHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const agentMemory = deps.workerManager.getAgentMemory();
    if (!agentMemory) {
      res.status(503).json({ error: 'Agent memory subsystem not available' });
      return;
    }

    const { agentId, key, value, memoryType, tags } = req.body as {
      agentId?: string;
      key?: string;
      value?: string;
      memoryType?: string;
      tags?: string[];
    };

    if (!agentId || !key || !value) {
      res.status(400).json({ error: 'Missing required fields: agentId, key, value' });
      return;
    }

    const entry = agentMemory.store(agentId, key, value, {
      memoryType: memoryType as MemoryType | undefined,
      tags,
    });

    res.json(entry);
  });
}

/**
 * GET /memory/recall/:agentId/:key
 *
 * Recall a specific memory by agent ID and key.
 * Bumps access count on retrieval.
 */
export function createMemoryRecallHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const agentMemory = deps.workerManager.getAgentMemory();
    if (!agentMemory) {
      res.status(503).json({ error: 'Agent memory subsystem not available' });
      return;
    }

    const { agentId, key } = req.params;
    if (!agentId || !key) {
      res.status(400).json({ error: 'Missing required params: agentId, key' });
      return;
    }

    const entry = agentMemory.recall(agentId, key);
    if (!entry) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }

    res.json(entry);
  });
}

/**
 * POST /memory/search
 *
 * Search agent memories using full-text search.
 * Body: { agentId: string, query: string, memoryType?: string, limit?: number }
 */
export function createMemorySearchHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const agentMemory = deps.workerManager.getAgentMemory();
    if (!agentMemory) {
      res.status(503).json({ error: 'Agent memory subsystem not available' });
      return;
    }

    const { agentId, query, memoryType, limit } = req.body as {
      agentId?: string;
      query?: string;
      memoryType?: string;
      limit?: number;
    };

    if (!agentId || !query) {
      res.status(400).json({ error: 'Missing required fields: agentId, query' });
      return;
    }

    const entries = agentMemory.search(agentId, query, {
      memoryType: memoryType as MemoryType | undefined,
      limit,
    });

    res.json({ results: entries });
  });
}

/**
 * GET /memory/:agentId
 *
 * List all memories for an agent, ordered by relevance.
 * Query params: limit (default 50)
 */
export function createMemoryListHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const agentMemory = deps.workerManager.getAgentMemory();
    if (!agentMemory) {
      res.status(503).json({ error: 'Agent memory subsystem not available' });
      return;
    }

    const { agentId } = req.params;
    if (!agentId) {
      res.status(400).json({ error: 'Missing required param: agentId' });
      return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const entries = agentMemory.getAll(agentId, limit);

    res.json({ memories: entries });
  });
}
