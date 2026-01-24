/**
 * Route Handler Types
 *
 * Shared types for route handler dependencies and factories.
 */

import type { Request, Response } from 'express';
import type { IStorage } from '../storage/interfaces.js';
import type { SQLiteStorage } from '../storage/sqlite.js';
import type { WorkerManager } from '../workers/manager.js';
import type { SpawnController } from '../workers/spawn-controller.js';
import type { WorkflowStorage } from '../storage/workflow.js';
import type { WorkflowEngine } from '../workers/workflow-engine.js';
import type { ServerConfig } from '../types.js';

/**
 * Dependencies required by route handlers
 *
 * Uses IStorage abstraction for storage backend flexibility.
 * Individual storage accessors (workItemStorage, mailStorage, etc.) are
 * provided for backward compatibility but delegate to storage.workItem, etc.
 */
export interface RouteDependencies {
  config: ServerConfig;
  /** Unified storage interface - preferred for new code */
  storage: IStorage;
  /** Legacy: direct SQLiteStorage access (for operations not yet in IStorage) */
  legacyStorage: SQLiteStorage;
  workerManager: WorkerManager;
  spawnController: SpawnController;
  workflowStorage?: WorkflowStorage;
  workflowEngine?: WorkflowEngine;
  swarms: Map<string, { id: string; name: string; description?: string; maxAgents: number; createdAt: number }>;
  startTime: number;
  /** Optional: WebSocket broadcast function for real-time events */
  broadcastToAll?: BroadcastToAll;
}

/**
 * Type for route handler functions
 */
export type RouteHandler = (req: Request, res: Response) => void | Promise<void>;

/**
 * Type for route handler factory functions
 */
export type RouteHandlerFactory<T extends RouteHandler = RouteHandler> = (deps: RouteDependencies) => T;

/**
 * Broadcast callback for WebSocket notifications
 */
export type BroadcastToChat = (chatId: string, message: unknown) => void;
export type BroadcastToAll = (message: unknown) => void;

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: string;
  [key: string]: unknown;
}

/**
 * Async handler wrapper that catches errors and returns 500 responses.
 *
 * This prevents unhandled promise rejections from crashing the server
 * and ensures consistent error responses.
 *
 * @example
 * export function createMyHandler(deps: RouteDependencies) {
 *   return asyncHandler(async (req, res) => {
 *     // handler code that might throw
 *   });
 * }
 */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response) => void {
  return (req: Request, res: Response): void => {
    handler(req, res).catch((error: unknown) => {
      const err = error as Error;
      console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
      if (process.env.NODE_ENV !== 'production') {
        console.error(err.stack);
      }

      // Don't send response if headers already sent
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          // Include message in non-production for debugging
          ...(process.env.NODE_ENV !== 'production' && { details: err.message }),
        } as ErrorResponse);
      }
    });
  };
}
