/**
 * SQLite Storage Adapter
 *
 * Wraps the existing SQLite storage modules into the unified IStorage interface.
 * This is the default storage backend for local development.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IStorage,
  ITeamStorage,
  IWorkerStorage,
  IWorkItemStorage,
  IMailStorage,
  IBlackboardStorage,
  ICheckpointStorage,
  ISpawnQueueStorage,
  ITLDRStorage,
  SwarmData,
} from '../interfaces.js';
import { SQLiteStorage } from '../sqlite.js';
import { BlackboardStorage } from '../blackboard.js';
import { CheckpointStorage, type CheckpointInfo } from '../checkpoint.js';
import { SpawnQueueStorage } from '../spawn-queue.js';
import { TLDRStorage, type FileSummary, type DependencyEdge } from '../tldr.js';
import type {
  TeamAgent,
  Chat,
  Message,
  TeamTask,
  TaskStatus,
  PersistentWorker,
  WorkerStatus,
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
} from '../../types.js';

// ============================================================================
// TEAM STORAGE ADAPTER
// ============================================================================

class SQLiteTeamStorage implements ITeamStorage {
  constructor(private storage: SQLiteStorage) {}

  async initialize(): Promise<void> {
    // Already initialized in constructor
  }

  async close(): Promise<void> {
    // Handled by parent
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.storage.getDebugInfo();
      return true;
    } catch {
      return false;
    }
  }

  async insertUser(user: TeamAgent): Promise<void> {
    this.storage.insertUser(user);
  }

  async getUser(uid: string): Promise<TeamAgent | null> {
    return this.storage.getUser(uid);
  }

  async getUsersByTeam(teamName: string): Promise<TeamAgent[]> {
    return this.storage.getUsersByTeam(teamName);
  }

  async updateUserLastSeen(uid: string, timestamp: string): Promise<void> {
    const user = this.storage.getUser(uid);
    if (user) {
      user.lastSeen = timestamp;
      this.storage.insertUser(user);
    }
  }

  async insertChat(chat: Chat): Promise<void> {
    this.storage.insertChat(chat);
  }

  async getChat(chatId: string): Promise<Chat | null> {
    return this.storage.getChat(chatId);
  }

  async getChatsByUser(uid: string): Promise<Chat[]> {
    return this.storage.getChatsByUser(uid);
  }

  async updateChatTime(chatId: string, timestamp: string): Promise<void> {
    this.storage.updateChatTime(chatId, timestamp);
  }

  async insertMessage(message: Message): Promise<void> {
    this.storage.insertMessage(message);
  }

  async getMessages(chatId: string, limit: number): Promise<Message[]> {
    return this.storage.getMessages(chatId, limit);
  }

  async getMessagesAfter(chatId: string, afterTimestamp: string, limit: number): Promise<Message[]> {
    return this.storage.getMessagesAfter(chatId, afterTimestamp, limit);
  }

  async getMessageCount(): Promise<number> {
    const debug = this.storage.getDebugInfo();
    return debug.messageCount;
  }

  async getUnread(chatId: string, uid: string): Promise<number> {
    return this.storage.getUnread(chatId, uid);
  }

  async setUnread(chatId: string, uid: string, count: number): Promise<void> {
    this.storage.setUnread(chatId, uid, count);
  }

  async incrementUnread(chatId: string, uid: string): Promise<void> {
    this.storage.incrementUnread(chatId, uid);
  }

  async clearUnread(chatId: string, uid: string): Promise<void> {
    this.storage.clearUnread(chatId, uid);
  }

  async insertTask(task: TeamTask): Promise<void> {
    this.storage.insertTask(task);
  }

  async getTask(taskId: string): Promise<TeamTask | null> {
    return this.storage.getTask(taskId);
  }

  async getTasksByTeam(teamName: string): Promise<TeamTask[]> {
    return this.storage.getTasksByTeam(teamName);
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, updatedAt: string): Promise<void> {
    this.storage.updateTaskStatus(taskId, status, updatedAt);
  }

  async getDebugInfo(): Promise<{
    users: TeamAgent[];
    chats: Chat[];
    messageCount: number;
    tasks: TeamTask[];
  }> {
    return this.storage.getDebugInfo();
  }
}

// ============================================================================
// WORKER STORAGE ADAPTER
// ============================================================================

class SQLiteWorkerStorage implements IWorkerStorage {
  constructor(private storage: SQLiteStorage) {}

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async insertWorker(worker: Omit<PersistentWorker, 'id'>): Promise<string> {
    const id = uuidv4();
    this.storage.insertWorker({ ...worker, id });
    return id;
  }

  async getWorker(id: string): Promise<PersistentWorker | null> {
    return this.storage.getWorker(id);
  }

  async getWorkerByHandle(handle: string): Promise<PersistentWorker | null> {
    return this.storage.getWorkerByHandle(handle);
  }

  async getAllWorkers(): Promise<PersistentWorker[]> {
    return this.storage.getAllWorkers();
  }

  async getActiveWorkers(): Promise<PersistentWorker[]> {
    return this.storage.getActiveWorkers();
  }

  async getWorkersBySwarm(swarmId: string): Promise<PersistentWorker[]> {
    // Filter in memory since SQLiteStorage doesn't have this method
    const all = this.storage.getAllWorkers();
    return all.filter(w => (w as PersistentWorker & { swarmId?: string }).swarmId === swarmId);
  }

  async updateWorkerStatus(id: string, status: WorkerStatus): Promise<void> {
    this.storage.updateWorkerStatus(id, status);
  }

  async updateWorkerHeartbeat(id: string, timestamp: number): Promise<void> {
    this.storage.updateWorkerHeartbeat(id, timestamp);
  }

  async updateWorkerPid(id: string, pid: number | null, sessionId: string | null): Promise<void> {
    this.storage.updateWorkerPid(id, pid ?? 0, sessionId);
  }

  async updateWorkerWorktree(id: string, path: string, branch: string): Promise<void> {
    const worker = this.storage.getWorker(id);
    if (worker) {
      worker.worktreePath = path;
      worker.worktreeBranch = branch;
      // Need to update via raw DB since SQLiteStorage doesn't expose this
      const db = this.storage.getDatabase();
      db.prepare('UPDATE workers SET worktree_path = ?, worktree_branch = ? WHERE id = ?')
        .run(path, branch, id);
    }
  }

  async dismissWorker(id: string, _timestamp: number): Promise<void> {
    this.storage.dismissWorker(id);
  }

  async deleteWorkerByHandle(handle: string): Promise<void> {
    this.storage.deleteWorkerByHandle(handle);
  }
}

// ============================================================================
// WORK ITEM STORAGE ADAPTER
// ============================================================================

class SQLiteWorkItemStorage implements IWorkItemStorage {
  constructor(private storage: SQLiteStorage) {}

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async createWorkItem(title: string, options?: { description?: string; batchId?: string; assignedTo?: string }): Promise<WorkItem> {
    const workItem: WorkItem = {
      id: uuidv4(),
      title,
      description: options?.description ?? null,
      status: 'pending',
      assignedTo: options?.assignedTo ?? null,
      batchId: options?.batchId ?? null,
      createdAt: Date.now(),
    };
    this.storage.insertWorkItem(workItem);

    // Add creation event
    this.storage.insertWorkItemEvent({
      workItemId: workItem.id,
      eventType: 'created',
      actor: null,
      details: null,
      createdAt: Date.now(),
    });

    return workItem;
  }

  async getWorkItem(id: string): Promise<WorkItem | null> {
    return this.storage.getWorkItem(id);
  }

  async listWorkItems(options?: { status?: WorkItemStatus; batchId?: string; assignedTo?: string; limit?: number }): Promise<WorkItem[]> {
    let items: WorkItem[];

    if (options?.batchId) {
      items = this.storage.getWorkItemsByBatch(options.batchId);
    } else if (options?.assignedTo) {
      items = this.storage.getWorkItemsByAssignee(options.assignedTo);
    } else {
      items = this.storage.getAllWorkItems();
    }

    if (options?.status) {
      items = items.filter(i => i.status === options.status);
    }

    if (options?.limit) {
      items = items.slice(0, options.limit);
    }

    return items;
  }

  async updateWorkItemStatus(id: string, status: WorkItemStatus, actor?: string): Promise<void> {
    this.storage.updateWorkItemStatus(id, status);

    // Map status to appropriate event type
    const eventType = status === 'in_progress' ? 'started' :
                      status === 'completed' ? 'completed' :
                      status === 'blocked' ? 'blocked' :
                      status === 'cancelled' ? 'cancelled' : 'started';

    this.storage.insertWorkItemEvent({
      workItemId: id,
      eventType,
      actor: actor ?? null,
      details: JSON.stringify({ newStatus: status }),
      createdAt: Date.now(),
    });
  }

  async assignWorkItem(id: string, handle: string): Promise<void> {
    this.storage.assignWorkItem(id, handle);

    this.storage.insertWorkItemEvent({
      workItemId: id,
      eventType: 'assigned',
      actor: handle,
      details: null,
      createdAt: Date.now(),
    });
  }

  async createBatch(name: string, workItemIds?: string[]): Promise<Batch> {
    const batch: Batch = {
      id: uuidv4(),
      name,
      status: 'open',
      createdAt: Date.now(),
    };
    this.storage.insertBatch(batch);

    // Associate work items with batch
    if (workItemIds && workItemIds.length > 0) {
      const db = this.storage.getDatabase();
      const stmt = db.prepare('UPDATE work_items SET batch_id = ? WHERE id = ?');
      for (const workItemId of workItemIds) {
        stmt.run(batch.id, workItemId);
      }
    }

    return batch;
  }

  async getBatch(id: string): Promise<Batch | null> {
    return this.storage.getBatch(id);
  }

  async listBatches(options?: { status?: BatchStatus; limit?: number }): Promise<Batch[]> {
    let batches = this.storage.getAllBatches();

    if (options?.status) {
      batches = batches.filter(b => b.status === options.status);
    }

    if (options?.limit) {
      batches = batches.slice(0, options.limit);
    }

    return batches;
  }

  async updateBatchStatus(id: string, status: BatchStatus): Promise<void> {
    this.storage.updateBatchStatus(id, status);
  }

  async dispatchBatch(id: string): Promise<{ workItems: WorkItem[]; dispatchedCount: number }> {
    const workItems = this.storage.getWorkItemsByBatch(id);
    let dispatchedCount = 0;

    for (const item of workItems) {
      if (item.status === 'pending') {
        // 'dispatched' maps to 'in_progress' since the item is now being worked
        this.storage.updateWorkItemStatus(item.id, 'in_progress');
        dispatchedCount++;
      }
    }

    this.storage.updateBatchStatus(id, 'dispatched');
    return { workItems, dispatchedCount };
  }

  async addWorkItemEvent(workItemId: string, eventType: WorkItemEventType, actor?: string, details?: string): Promise<void> {
    this.storage.insertWorkItemEvent({
      workItemId,
      eventType,
      actor: actor ?? null,
      details: details ?? null,
      createdAt: Date.now(),
    });
  }

  async getWorkItemEvents(workItemId: string): Promise<WorkItemEvent[]> {
    return this.storage.getWorkItemEvents(workItemId);
  }
}

// ============================================================================
// MAIL STORAGE ADAPTER
// ============================================================================

class SQLiteMailStorage implements IMailStorage {
  constructor(private storage: SQLiteStorage) {}

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async sendMail(from: string, to: string, body: string, subject?: string): Promise<MailMessage> {
    const now = Date.now();
    const id = this.storage.insertMail({
      fromHandle: from,
      toHandle: to,
      subject: subject ?? null,
      body,
      readAt: null,
      createdAt: now,
    });

    return {
      id,
      fromHandle: from,
      toHandle: to,
      subject: subject ?? null,
      body,
      readAt: null,
      createdAt: now,
    };
  }

  async getMail(handle: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<MailMessage[]> {
    if (options?.unreadOnly) {
      return this.storage.getUnreadMail(handle);
    }
    return this.storage.getAllMailTo(handle, options?.limit ?? 50);
  }

  async getUnreadMail(handle: string): Promise<MailMessage[]> {
    return this.storage.getUnreadMail(handle);
  }

  async markMailRead(id: number): Promise<void> {
    this.storage.markMailRead(id);
  }

  async createHandoff(from: string, to: string, context: Record<string, unknown>): Promise<Handoff> {
    const now = Date.now();
    const id = this.storage.insertHandoff({
      fromHandle: from,
      toHandle: to,
      context,
      acceptedAt: null,
      createdAt: now,
    });

    return {
      id,
      fromHandle: from,
      toHandle: to,
      context,
      acceptedAt: null,
      createdAt: now,
    };
  }

  async getHandoffs(handle: string, options?: { pendingOnly?: boolean }): Promise<Handoff[]> {
    if (options?.pendingOnly) {
      return this.storage.getPendingHandoffs(handle);
    }
    return this.storage.getPendingHandoffs(handle);
  }

  async acceptHandoff(id: number): Promise<void> {
    this.storage.acceptHandoff(id);
  }
}

// ============================================================================
// BLACKBOARD STORAGE ADAPTER
// ============================================================================

class SQLiteBlackboardStorage implements IBlackboardStorage {
  constructor(private blackboard: BlackboardStorage) {}

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  postMessage(
    swarmId: string,
    senderHandle: string,
    messageType: BlackboardMessageType,
    payload: Record<string, unknown>,
    options?: { targetHandle?: string; priority?: MessagePriority }
  ): BlackboardMessage {
    return this.blackboard.postMessage(swarmId, senderHandle, messageType, payload, options);
  }

  readMessages(
    swarmId: string,
    options?: { unreadOnly?: boolean; readerHandle?: string; messageType?: BlackboardMessageType; limit?: number }
  ): BlackboardMessage[] {
    return this.blackboard.readMessages(swarmId, options);
  }

  getMessage(id: string): BlackboardMessage | null {
    return this.blackboard.getMessage(id);
  }

  markRead(messageIds: string[], readerHandle: string): void {
    this.blackboard.markRead(messageIds, readerHandle);
  }

  archiveMessage(id: string): void {
    this.blackboard.archiveMessages([id]);
  }

  archiveMessages(ids: string[]): void {
    this.blackboard.archiveMessages(ids);
  }

  archiveOldMessages(swarmId: string, olderThanMs: number): number {
    return this.blackboard.archiveOldMessages(swarmId, olderThanMs);
  }

  getUnreadCount(swarmId: string, readerHandle: string): number {
    return this.blackboard.getUnreadCount(swarmId, readerHandle);
  }
}

// ============================================================================
// CHECKPOINT STORAGE ADAPTER
// ============================================================================

class SQLiteCheckpointStorage implements ICheckpointStorage {
  constructor(private checkpointStore: CheckpointStorage) {}

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  createCheckpoint(
    fromHandle: string,
    toHandle: string,
    checkpoint: Checkpoint
  ): CheckpointInfo {
    return this.checkpointStore.createCheckpoint(fromHandle, toHandle, {
      goal: checkpoint.goal,
      now: checkpoint.now,
      test: checkpoint.test,
      doneThisSession: checkpoint.doneThisSession ?? [],
      blockers: checkpoint.blockers ?? [],
      questions: checkpoint.questions ?? [],
      worked: checkpoint.worked ?? [],
      failed: checkpoint.failed ?? [],
      next: checkpoint.next ?? [],
      filesCreated: checkpoint.files?.created ?? [],
      filesModified: checkpoint.files?.modified ?? [],
    });
  }

  loadCheckpoint(id: number): CheckpointInfo | null {
    return this.checkpointStore.loadCheckpoint(id);
  }

  loadLatestCheckpoint(handle: string): CheckpointInfo | null {
    return this.checkpointStore.loadLatestCheckpoint(handle);
  }

  listCheckpoints(
    handle: string,
    options?: { role?: 'from' | 'to' | 'both'; status?: 'pending' | 'accepted' | 'rejected'; limit?: number }
  ): CheckpointInfo[] {
    return this.checkpointStore.listCheckpoints(handle, options);
  }

  acceptCheckpoint(id: number, _outcome?: CheckpointOutcome): boolean {
    // Note: outcome parameter not yet supported in underlying storage
    return this.checkpointStore.acceptCheckpoint(id);
  }

  rejectCheckpoint(id: number, _outcome?: CheckpointOutcome): boolean {
    // Note: outcome parameter not yet supported in underlying storage
    return this.checkpointStore.rejectCheckpoint(id);
  }
}

// ============================================================================
// SPAWN QUEUE STORAGE ADAPTER
// ============================================================================

class SQLiteSpawnQueueStorage implements ISpawnQueueStorage {
  constructor(private spawnQueue: SpawnQueueStorage) {}

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async enqueue(item: Omit<SpawnQueueItem, 'id' | 'status' | 'createdAt' | 'processedAt' | 'spawnedWorkerId' | 'blockedByCount'>): Promise<SpawnQueueItem> {
    return this.spawnQueue.enqueue(
      item.requesterHandle,
      item.targetAgentType,
      item.depthLevel,
      item.payload.task as string,
      {
        priority: item.priority,
        dependsOn: item.dependsOn,
        swarmId: item.swarmId ?? undefined,
        context: item.payload.context as Record<string, unknown> | undefined,
        checkpoint: item.payload.checkpoint as Record<string, unknown> | undefined,
      }
    );
  }

  async getItem(id: string): Promise<SpawnQueueItem | null> {
    return this.spawnQueue.get(id);
  }

  async getPendingItems(_limit?: number): Promise<SpawnQueueItem[]> {
    return this.spawnQueue.getPending();
  }

  async getReadyItems(limit?: number): Promise<SpawnQueueItem[]> {
    return this.spawnQueue.getReady(limit ?? 10);
  }

  async updateStatus(id: string, status: SpawnQueueStatus, spawnedWorkerId?: string): Promise<void> {
    switch (status) {
      case 'approved':
        this.spawnQueue.approve(id);
        break;
      case 'rejected':
        this.spawnQueue.reject(id);
        break;
      case 'spawned':
        if (spawnedWorkerId) {
          this.spawnQueue.markSpawned(id, spawnedWorkerId);
        }
        break;
    }
  }

  async cancelItem(id: string): Promise<void> {
    this.spawnQueue.reject(id);
  }

  async getQueueStats(): Promise<{
    pending: number;
    approved: number;
    spawned: number;
    rejected: number;
    blocked: number;
  }> {
    const stats = this.spawnQueue.getStats();
    return {
      pending: stats.byStatus.pending,
      approved: stats.byStatus.approved,
      spawned: stats.byStatus.spawned,
      rejected: stats.byStatus.rejected,
      blocked: stats.blocked,
    };
  }
}

// ============================================================================
// TLDR STORAGE ADAPTER
// ============================================================================

class SQLiteTLDRStorage implements ITLDRStorage {
  constructor(private tldrStore: TLDRStorage) {}

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

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
  ): void {
    this.tldrStore.storeFileSummary(filePath, contentHash, summary, options);
  }

  getFileSummary(filePath: string): FileSummary | null {
    return this.tldrStore.getFileSummary(filePath);
  }

  getFileSummaries(filePaths: string[]): FileSummary[] {
    return this.tldrStore.getFileSummaries(filePaths);
  }

  isSummaryCurrent(filePath: string, contentHash: string): boolean {
    return this.tldrStore.isSummaryCurrent(filePath, contentHash);
  }

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
  ): void {
    this.tldrStore.storeCodebaseOverview(rootPath, name, options);
  }

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
  } | null {
    return this.tldrStore.getCodebaseOverview(rootPath);
  }

  storeDependency(fromFile: string, toFile: string, importType?: 'static' | 'dynamic' | 'type-only'): void {
    this.tldrStore.storeDependency(fromFile, toFile, importType ?? 'static');
  }

  getDependencyGraph(rootFiles: string[], depth?: number): { nodes: string[]; edges: DependencyEdge[] } {
    return this.tldrStore.getDependencyGraph(rootFiles, depth);
  }

  getDependents(filePath: string): DependencyEdge[] {
    return this.tldrStore.getDependents(filePath);
  }

  getDependencies(filePath: string): DependencyEdge[] {
    return this.tldrStore.getDependencies(filePath);
  }

  invalidateFile(filePath: string): void {
    this.tldrStore.invalidateFile(filePath);
  }

  getStats(): { files: number; codebases: number; dependencies: number } {
    const stats = this.tldrStore.getStats();
    return {
      files: stats.fileSummaries,
      codebases: stats.codebaseOverviews,
      dependencies: stats.dependencyEdges,
    };
  }

  clearAll(): void {
    this.tldrStore.clearAll();
  }
}

// ============================================================================
// MAIN SQLITE STORAGE ADAPTER
// ============================================================================

export class SQLiteStorageAdapter implements IStorage {
  private storage: SQLiteStorage;
  private blackboardStorage: BlackboardStorage;
  private checkpointStorage: CheckpointStorage;
  private spawnQueueStorage: SpawnQueueStorage;
  private tldrStorage: TLDRStorage;

  public team: ITeamStorage;
  public worker: IWorkerStorage;
  public workItem: IWorkItemStorage;
  public mail: IMailStorage;
  public blackboard: IBlackboardStorage;
  public checkpoint: ICheckpointStorage;
  public spawnQueue: ISpawnQueueStorage;
  public tldr: ITLDRStorage;

  constructor(dbPath: string) {
    this.storage = new SQLiteStorage(dbPath);
    this.blackboardStorage = new BlackboardStorage(this.storage);
    this.checkpointStorage = new CheckpointStorage(this.storage);
    this.spawnQueueStorage = new SpawnQueueStorage(this.storage);
    this.tldrStorage = new TLDRStorage(this.storage);

    this.team = new SQLiteTeamStorage(this.storage);
    this.worker = new SQLiteWorkerStorage(this.storage);
    this.workItem = new SQLiteWorkItemStorage(this.storage);
    this.mail = new SQLiteMailStorage(this.storage);
    this.blackboard = new SQLiteBlackboardStorage(this.blackboardStorage);
    this.checkpoint = new SQLiteCheckpointStorage(this.checkpointStorage);
    this.spawnQueue = new SQLiteSpawnQueueStorage(this.spawnQueueStorage);
    this.tldr = new SQLiteTLDRStorage(this.tldrStorage);
  }

  async initialize(): Promise<void> {
    // All initialization happens in constructors for SQLite
  }

  async close(): Promise<void> {
    this.storage.close();
  }

  async isHealthy(): Promise<boolean> {
    return this.team.isHealthy();
  }

  /**
   * Get the raw SpawnQueueStorage for use with SpawnController.
   * The SpawnController requires direct access to the synchronous methods.
   */
  getRawSpawnQueue(): SpawnQueueStorage {
    return this.spawnQueueStorage;
  }

  // Swarm storage methods (delegating to SQLiteStorage)
  insertSwarm(swarm: { id: string; name: string; description?: string; maxAgents?: number }): void {
    this.storage.insertSwarm(swarm);
  }

  getSwarm(swarmId: string): SwarmData | null {
    return this.storage.getSwarm(swarmId);
  }

  getAllSwarms(): SwarmData[] {
    return this.storage.getAllSwarms();
  }

  deleteSwarm(swarmId: string): void {
    this.storage.deleteSwarm(swarmId);
  }
}
