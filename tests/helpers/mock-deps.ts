/**
 * Shared mock RouteDependencies factory for route handler tests
 *
 * Creates a fully-mocked RouteDependencies object with vi.fn() stubs
 * for all storage, worker manager, and controller methods.
 */

import { vi } from 'vitest';
import type { RouteDependencies } from '../../src/routes/types.js';

/**
 * Creates a complete mock RouteDependencies object.
 *
 * All methods are vi.fn() stubs that return sensible defaults.
 * Override specific methods in individual tests as needed.
 *
 * Usage:
 *   const deps = createMockDeps();
 *   deps.storage.team.getDebugInfo.mockResolvedValue({ users: [], chats: [], messageCount: 0, tasks: [] });
 *   const handler = createHealthHandler(deps);
 */
export function createMockDeps(): RouteDependencies {
  const mockTeamStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isHealthy: vi.fn().mockResolvedValue(true),
    getDebugInfo: vi.fn().mockResolvedValue({
      users: [],
      chats: [],
      messageCount: 0,
      tasks: [],
    }),
    insertUser: vi.fn().mockResolvedValue(undefined),
    getUser: vi.fn().mockResolvedValue(null),
    getUsersByTeam: vi.fn().mockResolvedValue([]),
    updateUserLastSeen: vi.fn().mockResolvedValue(undefined),
    insertTask: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue(null),
    getTasksByTeam: vi.fn().mockResolvedValue([]),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    insertChat: vi.fn().mockResolvedValue(undefined),
    getChat: vi.fn().mockResolvedValue(null),
    getChatsByUser: vi.fn().mockResolvedValue([]),
    insertMessage: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    getMessagesAfter: vi.fn().mockResolvedValue([]),
    getMessageCount: vi.fn().mockResolvedValue(0),
    setUnread: vi.fn().mockResolvedValue(undefined),
    incrementUnread: vi.fn().mockResolvedValue(undefined),
    clearUnread: vi.fn().mockResolvedValue(undefined),
    updateChatTime: vi.fn().mockResolvedValue(undefined),
    getUnread: vi.fn().mockResolvedValue(0),
  };

  const mockWorkerStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    insertWorker: vi.fn().mockResolvedValue('worker-1'),
    getWorker: vi.fn().mockResolvedValue(null),
    getWorkerByHandle: vi.fn().mockResolvedValue(null),
    getAllWorkers: vi.fn().mockResolvedValue([]),
    getActiveWorkers: vi.fn().mockResolvedValue([]),
    getWorkersBySwarm: vi.fn().mockResolvedValue([]),
    updateWorkerStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkerHeartbeat: vi.fn().mockResolvedValue(undefined),
    updateWorkerPid: vi.fn().mockResolvedValue(undefined),
    updateWorkerWorktree: vi.fn().mockResolvedValue(undefined),
    dismissWorker: vi.fn().mockResolvedValue(undefined),
    deleteWorkerByHandle: vi.fn().mockResolvedValue(undefined),
  };

  const mockWorkItemStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1', title: 'test', description: null, status: 'pending', assignedTo: null, batchId: null, createdAt: Date.now() }),
    getWorkItem: vi.fn().mockResolvedValue(null),
    listWorkItems: vi.fn().mockResolvedValue([]),
    updateWorkItemStatus: vi.fn().mockResolvedValue(undefined),
    assignWorkItem: vi.fn().mockResolvedValue(undefined),
    createBatch: vi.fn().mockResolvedValue({ id: 'batch-1', name: 'test', status: 'open', createdAt: Date.now() }),
    getBatch: vi.fn().mockResolvedValue(null),
    listBatches: vi.fn().mockResolvedValue([]),
    updateBatchStatus: vi.fn().mockResolvedValue(undefined),
    dispatchBatch: vi.fn().mockResolvedValue({ workItems: [], dispatchedCount: 0 }),
    addWorkItemEvent: vi.fn().mockResolvedValue(undefined),
    getWorkItemEvents: vi.fn().mockResolvedValue([]),
  };

  const mockMailStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sendMail: vi.fn().mockResolvedValue({ id: 1, fromHandle: '', toHandle: '', subject: null, body: '', readAt: null, createdAt: Date.now() }),
    getMail: vi.fn().mockResolvedValue([]),
    getUnreadMail: vi.fn().mockResolvedValue([]),
    markMailRead: vi.fn().mockResolvedValue(undefined),
    createHandoff: vi.fn().mockResolvedValue({ id: 1, fromHandle: '', toHandle: '', context: {}, acceptedAt: null, createdAt: Date.now() }),
    getHandoffs: vi.fn().mockResolvedValue([]),
    acceptHandoff: vi.fn().mockResolvedValue(undefined),
  };

  const mockBlackboardStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    postMessage: vi.fn().mockReturnValue({ id: 'msg-1', swarmId: '', senderHandle: '', messageType: 'status', targetHandle: null, priority: 'normal', payload: {}, readBy: [], createdAt: Date.now(), archivedAt: null }),
    readMessages: vi.fn().mockReturnValue([]),
    getMessage: vi.fn().mockReturnValue(null),
    markRead: vi.fn(),
    archiveMessage: vi.fn(),
    archiveMessages: vi.fn(),
    archiveOldMessages: vi.fn().mockReturnValue(0),
    getUnreadCount: vi.fn().mockReturnValue(0),
  };

  const mockCheckpointStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createCheckpoint: vi.fn().mockReturnValue({ id: 1, fromHandle: '', toHandle: '', checkpoint: {}, status: 'pending', outcome: null, createdAt: Date.now() }),
    loadCheckpoint: vi.fn().mockReturnValue(null),
    loadLatestCheckpoint: vi.fn().mockReturnValue(null),
    listCheckpoints: vi.fn().mockReturnValue([]),
    acceptCheckpoint: vi.fn().mockReturnValue(true),
    rejectCheckpoint: vi.fn().mockReturnValue(true),
  };

  const mockSpawnQueueStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue({ id: 'sq-1', status: 'pending' }),
    getItem: vi.fn().mockResolvedValue(null),
    getPendingItems: vi.fn().mockResolvedValue([]),
    getReadyItems: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    cancelItem: vi.fn().mockResolvedValue(undefined),
    getQueueStats: vi.fn().mockResolvedValue({ pending: 0, approved: 0, spawned: 0, rejected: 0, blocked: 0 }),
  };

  const mockTLDRStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    storeFileSummary: vi.fn(),
    getFileSummary: vi.fn().mockReturnValue(null),
    getFileSummaries: vi.fn().mockReturnValue([]),
    isSummaryCurrent: vi.fn().mockReturnValue(false),
    storeCodebaseOverview: vi.fn(),
    getCodebaseOverview: vi.fn().mockReturnValue(null),
    storeDependency: vi.fn(),
    getDependencyGraph: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
    getDependents: vi.fn().mockReturnValue([]),
    getDependencies: vi.fn().mockReturnValue([]),
    invalidateFile: vi.fn(),
    getStats: vi.fn().mockReturnValue({ files: 0, codebases: 0, dependencies: 0 }),
    clearAll: vi.fn(),
  };

  const mockStorage = {
    team: mockTeamStorage,
    worker: mockWorkerStorage,
    workItem: mockWorkItemStorage,
    mail: mockMailStorage,
    blackboard: mockBlackboardStorage,
    checkpoint: mockCheckpointStorage,
    spawnQueue: mockSpawnQueueStorage,
    tldr: mockTLDRStorage,
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isHealthy: vi.fn().mockResolvedValue(true),
    insertSwarm: vi.fn(),
    getSwarm: vi.fn().mockReturnValue(null),
    getAllSwarms: vi.fn().mockReturnValue([]),
    deleteSwarm: vi.fn(),
  };

  const mockWorkerManager = {
    getWorkers: vi.fn().mockReturnValue([]),
    getWorkerCount: vi.fn().mockReturnValue(0),
    getHealthStats: vi.fn().mockReturnValue({
      total: 0,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
    }),
    getRestartStats: vi.fn().mockReturnValue({
      total: 0,
      lastHour: 0,
    }),
    getAgentMemory: vi.fn().mockReturnValue(null),
    getRoutingRecommendation: vi.fn().mockReturnValue(null),
  };

  const mockLegacyStorage = {
    getDatabase: vi.fn().mockReturnValue({
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        run: vi.fn(),
      }),
    }),
  };

  const mockSpawnController = {
    getStatus: vi.fn().mockReturnValue({
      softLimit: 5,
      hardLimit: 10,
      maxDepth: 3,
      current: 0,
      pending: 0,
      approved: 0,
    }),
  };

  const config = {
    port: 3847,
    dbPath: ':memory:',
    storageBackend: 'sqlite' as const,
    jwtSecret: 'test-secret',
    jwtExpiresIn: '24h',
    maxWorkers: 5,
    rateLimitWindow: 60000,
    rateLimitMax: 100,
    corsOrigins: ['*'],
  };

  return {
    config,
    storage: mockStorage,
    legacyStorage: mockLegacyStorage,
    workerManager: mockWorkerManager,
    spawnController: mockSpawnController,
    swarms: new Map(),
    startTime: Date.now(),
    broadcastToAll: vi.fn(),
  } as unknown as RouteDependencies;
}
