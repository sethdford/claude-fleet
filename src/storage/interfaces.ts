/**
 * Storage Interfaces
 *
 * Abstract interfaces for multi-backend storage support.
 * Implementations: SQLite, DynamoDB, S3, Firestore, PostgreSQL
 */

import type {
  TeamAgent,
  Chat,
  Message,
  TeamTask,
  TaskStatus,
  PersistentWorker,
  WorkerStatus,
  AgentRole,
  WorkItem,
  WorkItemStatus,
  Batch,
  BatchStatus,
  WorkItemEvent,
  WorkItemEventType,
  MailMessage,
  Handoff,
  BlackboardMessage,
  BlackboardMessageType,
  MessagePriority,
  SpawnQueueItem,
  SpawnQueueStatus,
  Checkpoint,
  CheckpointOutcome,
} from '../types.js';

import type { CheckpointInfo } from './checkpoint.js';
import type { FileSummary, DependencyEdge } from './tldr.js';

// ============================================================================
// CORE STORAGE INTERFACE
// ============================================================================

/**
 * Core team storage - users, chats, messages, tasks
 */
export interface ITeamStorage {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Health
  isHealthy(): Promise<boolean>;

  // Users/Agents
  insertUser(user: TeamAgent): Promise<void>;
  getUser(uid: string): Promise<TeamAgent | null>;
  getUsersByTeam(teamName: string): Promise<TeamAgent[]>;
  updateUserLastSeen(uid: string, timestamp: string): Promise<void>;

  // Chats
  insertChat(chat: Chat): Promise<void>;
  getChat(chatId: string): Promise<Chat | null>;
  getChatsByUser(uid: string): Promise<Chat[]>;
  updateChatTime(chatId: string, timestamp: string): Promise<void>;

  // Messages
  insertMessage(message: Message): Promise<void>;
  getMessages(chatId: string, limit: number): Promise<Message[]>;
  getMessagesAfter(chatId: string, afterTimestamp: string, limit: number): Promise<Message[]>;
  getMessageCount(): Promise<number>;

  // Unread counts
  getUnread(chatId: string, uid: string): Promise<number>;
  setUnread(chatId: string, uid: string, count: number): Promise<void>;
  incrementUnread(chatId: string, uid: string): Promise<void>;
  clearUnread(chatId: string, uid: string): Promise<void>;

  // Tasks
  insertTask(task: TeamTask): Promise<void>;
  getTask(taskId: string): Promise<TeamTask | null>;
  getTasksByTeam(teamName: string): Promise<TeamTask[]>;
  updateTaskStatus(taskId: string, status: TaskStatus, updatedAt: string): Promise<void>;

  // Debug
  getDebugInfo(): Promise<{
    users: TeamAgent[];
    chats: Chat[];
    messageCount: number;
    tasks: TeamTask[];
  }>;
}

// ============================================================================
// WORKER STORAGE INTERFACE
// ============================================================================

/**
 * Worker storage - persistent worker state
 */
export interface IWorkerStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  insertWorker(worker: Omit<PersistentWorker, 'id'>): Promise<string>;
  getWorker(id: string): Promise<PersistentWorker | null>;
  getWorkerByHandle(handle: string): Promise<PersistentWorker | null>;
  getAllWorkers(): Promise<PersistentWorker[]>;
  getActiveWorkers(): Promise<PersistentWorker[]>;
  getWorkersBySwarm(swarmId: string): Promise<PersistentWorker[]>;

  updateWorkerStatus(id: string, status: WorkerStatus): Promise<void>;
  updateWorkerHeartbeat(id: string, timestamp: number): Promise<void>;
  updateWorkerPid(id: string, pid: number | null, sessionId: string | null): Promise<void>;
  updateWorkerWorktree(id: string, path: string, branch: string): Promise<void>;

  dismissWorker(id: string, timestamp: number): Promise<void>;
  deleteWorkerByHandle(handle: string): Promise<void>;
}

// ============================================================================
// WORK ITEM STORAGE INTERFACE
// ============================================================================

/**
 * Work item storage - work items and batches
 */
export interface IWorkItemStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Work Items
  createWorkItem(title: string, options?: { description?: string; batchId?: string; assignedTo?: string }): Promise<WorkItem>;
  getWorkItem(id: string): Promise<WorkItem | null>;
  listWorkItems(options?: { status?: WorkItemStatus; batchId?: string; assignedTo?: string; limit?: number }): Promise<WorkItem[]>;
  updateWorkItemStatus(id: string, status: WorkItemStatus, actor?: string): Promise<void>;
  assignWorkItem(id: string, handle: string): Promise<void>;

  // Batches
  createBatch(name: string, workItemIds?: string[]): Promise<Batch>;
  getBatch(id: string): Promise<Batch | null>;
  listBatches(options?: { status?: BatchStatus; limit?: number }): Promise<Batch[]>;
  updateBatchStatus(id: string, status: BatchStatus): Promise<void>;
  dispatchBatch(id: string): Promise<{ workItems: WorkItem[]; dispatchedCount: number }>;

  // Events
  addWorkItemEvent(workItemId: string, eventType: WorkItemEventType, actor?: string, details?: string): Promise<void>;
  getWorkItemEvents(workItemId: string): Promise<WorkItemEvent[]>;
}

// ============================================================================
// MAIL STORAGE INTERFACE
// ============================================================================

/**
 * Mail storage - inter-agent messaging
 */
export interface IMailStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  sendMail(from: string, to: string, body: string, subject?: string): Promise<MailMessage>;
  getMail(handle: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<MailMessage[]>;
  getUnreadMail(handle: string): Promise<MailMessage[]>;
  markMailRead(id: number): Promise<void>;

  createHandoff(from: string, to: string, context: Record<string, unknown>): Promise<Handoff>;
  getHandoffs(handle: string, options?: { pendingOnly?: boolean }): Promise<Handoff[]>;
  acceptHandoff(id: number): Promise<void>;
}

// ============================================================================
// BLACKBOARD STORAGE INTERFACE
// ============================================================================

/**
 * Blackboard storage - swarm coordination messages
 */
export interface IBlackboardStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  postMessage(
    swarmId: string,
    senderHandle: string,
    messageType: BlackboardMessageType,
    payload: Record<string, unknown>,
    options?: { targetHandle?: string; priority?: MessagePriority }
  ): BlackboardMessage;

  readMessages(
    swarmId: string,
    options?: { unreadOnly?: boolean; readerHandle?: string; messageType?: BlackboardMessageType; limit?: number }
  ): BlackboardMessage[];

  getMessage(id: string): BlackboardMessage | null;
  markRead(messageIds: string[], readerHandle: string): void;
  archiveMessage(id: string): void;
  archiveMessages(ids: string[]): void;
  archiveOldMessages(swarmId: string, olderThanMs: number): number;

  getUnreadCount(swarmId: string, readerHandle: string): number;
}

// ============================================================================
// CHECKPOINT STORAGE INTERFACE
// ============================================================================

/**
 * Checkpoint storage - agent state snapshots and handoffs
 * Checkpoints represent progress reports from one agent (fromHandle) to another (toHandle)
 */
export interface ICheckpointStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  createCheckpoint(
    fromHandle: string,
    toHandle: string,
    options: Checkpoint
  ): CheckpointInfo;

  loadCheckpoint(id: number): CheckpointInfo | null;
  loadLatestCheckpoint(handle: string): CheckpointInfo | null;

  listCheckpoints(
    handle: string,
    options?: { role?: 'from' | 'to' | 'both'; status?: 'pending' | 'accepted' | 'rejected'; limit?: number }
  ): CheckpointInfo[];

  acceptCheckpoint(id: number, outcome?: CheckpointOutcome): boolean;
  rejectCheckpoint(id: number, outcome?: CheckpointOutcome): boolean;
}

// ============================================================================
// SPAWN QUEUE STORAGE INTERFACE
// ============================================================================

/**
 * Spawn queue storage - controlled agent spawning
 */
export interface ISpawnQueueStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  enqueue(item: Omit<SpawnQueueItem, 'id' | 'status' | 'createdAt' | 'processedAt' | 'spawnedWorkerId' | 'blockedByCount'>): Promise<SpawnQueueItem>;
  getItem(id: string): Promise<SpawnQueueItem | null>;
  getPendingItems(limit?: number): Promise<SpawnQueueItem[]>;
  getReadyItems(limit?: number): Promise<SpawnQueueItem[]>;

  updateStatus(id: string, status: SpawnQueueStatus, spawnedWorkerId?: string): Promise<void>;
  cancelItem(id: string): Promise<void>;

  getQueueStats(): Promise<{
    pending: number;
    approved: number;
    spawned: number;
    rejected: number;
    blocked: number;
  }>;
}

// ============================================================================
// TLDR STORAGE INTERFACE
// ============================================================================

/**
 * TLDR storage - code analysis cache
 */
export interface ITLDRStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  // File summaries
  storeFileSummary(
    filePath: string,
    contentHash: string,
    summary: string,
    options?: {
      exports?: string[];
      imports?: string[];
      dependencies?: string[];
      lineCount?: number;
      language?: string;
    }
  ): void;

  getFileSummary(filePath: string): FileSummary | null;
  getFileSummaries(filePaths: string[]): FileSummary[];
  isSummaryCurrent(filePath: string, contentHash: string): boolean;

  // Codebase overview
  storeCodebaseOverview(
    rootPath: string,
    name: string,
    options?: {
      description?: string;
      structure?: Record<string, unknown>;
      keyFiles?: string[];
      patterns?: string[];
      techStack?: string[];
    }
  ): void;

  getCodebaseOverview(rootPath: string): {
    id: number;
    rootPath: string;
    name: string;
    description: string | null;
    structure: Record<string, unknown> | null;
    keyFiles: string[];
    patterns: string[];
    techStack: string[];
    createdAt: number;
    updatedAt: number;
  } | null;

  // Dependencies
  storeDependency(fromFile: string, toFile: string, importType?: 'static' | 'dynamic' | 'type-only'): void;
  getDependencyGraph(rootFiles: string[], depth?: number): { nodes: string[]; edges: DependencyEdge[] };
  getDependents(filePath: string): DependencyEdge[];
  getDependencies(filePath: string): DependencyEdge[];

  // Cache management
  invalidateFile(filePath: string): void;
  getStats(): { files: number; codebases: number; dependencies: number };
  clearAll(): void;
}

// ============================================================================
// COMPOSITE STORAGE INTERFACE
// ============================================================================

/**
 * Composite storage - combines all storage interfaces
 */
export interface IStorage {
  team: ITeamStorage;
  worker: IWorkerStorage;
  workItem: IWorkItemStorage;
  mail: IMailStorage;
  blackboard: IBlackboardStorage;
  checkpoint: ICheckpointStorage;
  spawnQueue: ISpawnQueueStorage;
  tldr: ITLDRStorage;

  initialize(): Promise<void>;
  close(): Promise<void>;
  isHealthy(): Promise<boolean>;

  /**
   * Get the raw SpawnQueueStorage for SpawnController (SQLite-specific).
   * Returns undefined for non-SQLite backends.
   */
  getRawSpawnQueue?(): unknown;
}

// ============================================================================
// STORAGE CONFIGURATION
// ============================================================================

export type StorageBackend = 'sqlite' | 'dynamodb' | 's3' | 'firestore' | 'postgresql';

export interface SQLiteConfig {
  backend: 'sqlite';
  path: string;
}

export interface DynamoDBConfig {
  backend: 'dynamodb';
  region: string;
  tablePrefix?: string;
  endpoint?: string; // For local development
}

export interface S3Config {
  backend: 's3';
  bucket: string;
  region: string;
  prefix?: string;
  endpoint?: string; // For local development (MinIO)
}

export interface FirestoreConfig {
  backend: 'firestore';
  projectId: string;
  credentials?: string; // Path to service account JSON
}

export interface PostgreSQLConfig {
  backend: 'postgresql';
  connectionString: string;
  schema?: string;
  poolSize?: number;
}

export type StorageConfig =
  | SQLiteConfig
  | DynamoDBConfig
  | S3Config
  | FirestoreConfig
  | PostgreSQLConfig;
