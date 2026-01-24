/**
 * Route Handler Types
 *
 * Shared types for route handler dependencies and factories.
 */

import type { Request, Response } from 'express';
import type { SQLiteStorage } from '../storage/sqlite.js';
import type { WorkerManager } from '../workers/manager.js';
import type { WorkItemStorage } from '../storage/workitems.js';
import type { MailStorage } from '../storage/mail.js';
import type { BlackboardStorage } from '../storage/blackboard.js';
import type { SpawnQueueStorage } from '../storage/spawn-queue.js';
import type { CheckpointStorage } from '../storage/checkpoint.js';
import type { SpawnController } from '../workers/spawn-controller.js';
import type { TLDRStorage } from '../storage/tldr.js';
import type { ServerConfig } from '../types.js';

/**
 * Dependencies required by route handlers
 */
export interface RouteDependencies {
  config: ServerConfig;
  storage: SQLiteStorage;
  workerManager: WorkerManager;
  workItemStorage: WorkItemStorage;
  mailStorage: MailStorage;
  blackboardStorage: BlackboardStorage;
  spawnQueueStorage: SpawnQueueStorage;
  checkpointStorage: CheckpointStorage;
  spawnController: SpawnController;
  tldrStorage?: TLDRStorage;
  swarms: Map<string, { id: string; name: string; description?: string; maxAgents: number; createdAt: number }>;
  startTime: number;
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
