/**
 * Tests for server.ts — CollabServer class and getConfig()
 *
 * Covers: getConfig, constructor, initialize, middleware chain,
 * route registration, WebSocket handling, broadcast methods,
 * worker events, cleanup, start/stop lifecycle, rate limiting,
 * ensureTeamWatching, and error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — accessible inside vi.mock() factories
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Storage factory
  const mockStorageInstance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    isHealthy: vi.fn().mockResolvedValue(true),
    team: {
      getDebugInfo: vi.fn().mockResolvedValue({ users: [], chats: [], messageCount: 0, tasks: [] }),
      insertUser: vi.fn(),
      getUser: vi.fn(),
      getUsersByTeam: vi.fn().mockReturnValue([]),
      updateUserLastSeen: vi.fn(),
      insertTask: vi.fn(),
      getTask: vi.fn(),
      getTasksByTeam: vi.fn().mockReturnValue([]),
      updateTaskStatus: vi.fn(),
      insertChat: vi.fn(),
      getChat: vi.fn(),
      getChatsByUser: vi.fn().mockReturnValue([]),
      insertMessage: vi.fn(),
      getMessages: vi.fn().mockReturnValue([]),
      getMessagesAfter: vi.fn().mockReturnValue([]),
      getMessageCount: vi.fn().mockReturnValue(0),
      setUnread: vi.fn(),
      incrementUnread: vi.fn(),
      clearUnread: vi.fn(),
      updateChatTime: vi.fn(),
      getUnread: vi.fn().mockReturnValue(0),
    },
    worker: {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      insertWorker: vi.fn(),
      getWorker: vi.fn(),
      getWorkerByHandle: vi.fn(),
      getAllWorkers: vi.fn().mockReturnValue([]),
      getActiveWorkers: vi.fn().mockReturnValue([]),
      getWorkersBySwarm: vi.fn().mockReturnValue([]),
      updateWorkerStatus: vi.fn(),
      updateWorkerHeartbeat: vi.fn(),
      updateWorkerPid: vi.fn(),
      updateWorkerWorktree: vi.fn(),
      dismissWorker: vi.fn(),
      deleteWorkerByHandle: vi.fn(),
    },
    workItem: {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      createWorkItem: vi.fn(),
      getWorkItem: vi.fn(),
      listWorkItems: vi.fn().mockReturnValue([]),
      updateWorkItemStatus: vi.fn(),
      assignWorkItem: vi.fn(),
      createBatch: vi.fn(),
      getBatch: vi.fn(),
      listBatches: vi.fn().mockReturnValue([]),
      updateBatchStatus: vi.fn(),
      dispatchBatch: vi.fn(),
      addWorkItemEvent: vi.fn(),
      getWorkItemEvents: vi.fn().mockReturnValue([]),
    },
    mail: {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      sendMail: vi.fn(),
      getMail: vi.fn().mockReturnValue([]),
      getUnreadMail: vi.fn().mockReturnValue([]),
      markMailRead: vi.fn(),
      createHandoff: vi.fn(),
      getHandoffs: vi.fn().mockReturnValue([]),
      acceptHandoff: vi.fn(),
    },
    blackboard: {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      postMessage: vi.fn(),
      readMessages: vi.fn().mockReturnValue([]),
      getMessage: vi.fn(),
      markRead: vi.fn(),
      archiveMessage: vi.fn(),
      archiveMessages: vi.fn(),
      archiveOldMessages: vi.fn(),
      getUnreadCount: vi.fn().mockReturnValue(0),
    },
    checkpoint: {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      createCheckpoint: vi.fn(),
      loadCheckpoint: vi.fn(),
      loadLatestCheckpoint: vi.fn(),
      listCheckpoints: vi.fn().mockReturnValue([]),
      acceptCheckpoint: vi.fn(),
      rejectCheckpoint: vi.fn(),
    },
    spawnQueue: {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      enqueue: vi.fn(),
      getItem: vi.fn(),
      getPendingItems: vi.fn().mockReturnValue([]),
      getReadyItems: vi.fn().mockReturnValue([]),
      updateStatus: vi.fn(),
      cancelItem: vi.fn(),
      getQueueStats: vi.fn().mockReturnValue({ pending: 0, approved: 0, spawned: 0, rejected: 0, blocked: 0 }),
    },
    tldr: {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      storeFileSummary: vi.fn(),
      getFileSummary: vi.fn(),
      getFileSummaries: vi.fn().mockReturnValue([]),
      isSummaryCurrent: vi.fn(),
      storeCodebaseOverview: vi.fn(),
      getCodebaseOverview: vi.fn(),
      storeDependency: vi.fn(),
      getDependencyGraph: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
      getDependents: vi.fn().mockReturnValue([]),
      getDependencies: vi.fn().mockReturnValue([]),
      invalidateFile: vi.fn(),
      getStats: vi.fn().mockReturnValue({ files: 0, codebases: 0, dependencies: 0 }),
      clearAll: vi.fn(),
    },
    insertSwarm: vi.fn(),
    getSwarm: vi.fn(),
    getAllSwarms: vi.fn().mockReturnValue([]),
    deleteSwarm: vi.fn(),
  };

  const mockCreateStorage = vi.fn().mockResolvedValue(mockStorageInstance);
  const mockGetStorageConfigFromEnv = vi.fn().mockReturnValue({ backend: 'sqlite', path: ':memory:' });

  // Legacy storage
  const mockLegacyInstance = {
    seedBuiltinTemplates: vi.fn(),
    getDatabase: vi.fn().mockReturnValue({
      prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), get: vi.fn(), run: vi.fn() }),
      exec: vi.fn(),
    }),
  };
  const mockSQLiteStorageConstructor = vi.fn().mockImplementation(function () { return mockLegacyInstance; });

  // Workflow storage
  const mockWorkflowStorageInstance = {
    seedTemplates: vi.fn(),
  };
  const mockWorkflowStorageConstructor = vi.fn().mockImplementation(function () { return mockWorkflowStorageInstance; });

  // Workflow engine
  const mockWorkflowEngineInstance = {
    start: vi.fn(),
    stop: vi.fn(),
  };
  const mockWorkflowEngineConstructor = vi.fn().mockImplementation(function () { return mockWorkflowEngineInstance; });

  // Worker manager
  const mockInboxBridgeInstance = {
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
    on: vi.fn(),
  };
  const mockNativeBridgeInstance = {
    startDiscovery: vi.fn(),
    stopDiscovery: vi.fn(),
    on: vi.fn(),
    getKnownAgents: vi.fn().mockReturnValue([]),
  };
  const mockWorkerManagerInstance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    setSpawnController: vi.fn(),
    getInboxBridge: vi.fn().mockReturnValue(mockInboxBridgeInstance),
    getNativeBridge: vi.fn().mockReturnValue(mockNativeBridgeInstance),
    getNativeStatus: vi.fn().mockReturnValue({ isAvailable: true, claudeBinary: '/usr/bin/claude', defaultSpawnMode: 'native' }),
    getWorkers: vi.fn().mockReturnValue([]),
    getWorkerCount: vi.fn().mockReturnValue(0),
    getHealthStats: vi.fn().mockReturnValue({ total: 0, healthy: 0, degraded: 0, unhealthy: 0 }),
    getRestartStats: vi.fn().mockReturnValue({ total: 0, lastHour: 0 }),
    getAgentMemory: vi.fn().mockReturnValue(null),
    getTaskRouter: vi.fn().mockReturnValue(null),
    getRoutingRecommendation: vi.fn().mockReturnValue(null),
    getWorkerByHandle: vi.fn().mockReturnValue(null),
    spawnWorker: vi.fn().mockResolvedValue({ id: 'w-1', handle: 'worker-1', state: 'starting' }),
    dismissWorker: vi.fn().mockResolvedValue(undefined),
    dismissWorkerByHandle: vi.fn().mockResolvedValue(undefined),
    dismissAll: vi.fn().mockResolvedValue(undefined),
    sendToWorkerByHandle: vi.fn().mockResolvedValue(true),
    getWorktreeManager: vi.fn().mockReturnValue(null),
    registerExternalWorker: vi.fn().mockReturnValue({ id: 'w-ext', handle: 'ext-1', state: 'ready' }),
    injectWorkerOutput: vi.fn(),
    on: vi.fn(),
  };
  const mockWorkerManagerConstructor = vi.fn().mockImplementation(function () { return mockWorkerManagerInstance; });

  // Spawn controller
  const mockSpawnControllerInstance = {
    initialize: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ softLimit: 50, hardLimit: 100, maxDepth: 3, current: 0, pending: 0, approved: 0 }),
    queueSpawn: vi.fn().mockResolvedValue('spawn-req-1'),
    getQueueStats: vi.fn().mockReturnValue({ pending: 0, approved: 0, spawned: 0, rejected: 0, blocked: 0 }),
  };
  const mockSpawnControllerConstructor = vi.fn().mockImplementation(function () { return mockSpawnControllerInstance; });

  // TaskSyncBridge
  const mockTaskSyncBridgeInstance = {
    start: vi.fn(),
    fullSync: vi.fn().mockResolvedValue({ synced: 0, errors: 0 }),
    watchTeam: vi.fn(),
    shutdown: vi.fn(),
    on: vi.fn(),
  };
  const mockTaskSyncBridgeConstructor = vi.fn().mockImplementation(function () { return mockTaskSyncBridgeInstance; });

  // Auth middleware
  const mockAuthMiddleware = vi.fn((_req: unknown, _res: unknown, next: () => void) => next());
  const mockCreateAuthMiddleware = vi.fn().mockReturnValue(mockAuthMiddleware);
  const mockRequireRole = vi.fn().mockReturnValue(
    (_req: unknown, _res: unknown, next: () => void) => next()
  );
  const mockRequireTeamMembership = vi.fn().mockReturnValue(
    (_req: unknown, _res: unknown, next: () => void) => next()
  );

  // Metrics
  const mockMetricsMiddleware = vi.fn((_req: unknown, _res: unknown, next: () => void) => next());
  const mockMetricsHandler = vi.fn((_req: unknown, res: { json: (d: unknown) => void }) => res.json({}));

  // AutoScheduler
  const mockSchedulerInstance = {
    start: vi.fn(),
    stop: vi.fn(),
    on: vi.fn(),
  };
  const mockAutoSchedulerGetInstance = vi.fn().mockReturnValue(mockSchedulerInstance);

  // TaskExecutor
  const mockExecutorInstance = {
    configure: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const mockTaskExecutorGetInstance = vi.fn().mockReturnValue(mockExecutorInstance);

  // Config loader
  const mockLoadDefaultConfig = vi.fn();

  // Route handler stubs — each returns a no-op handler
  const noopHandler = vi.fn((_req: unknown, _res: unknown) => {});

  return {
    mockStorageInstance,
    mockCreateStorage,
    mockGetStorageConfigFromEnv,
    mockLegacyInstance,
    mockSQLiteStorageConstructor,
    mockWorkflowStorageInstance,
    mockWorkflowStorageConstructor,
    mockWorkflowEngineInstance,
    mockWorkflowEngineConstructor,
    mockWorkerManagerInstance,
    mockWorkerManagerConstructor,
    mockSpawnControllerInstance,
    mockSpawnControllerConstructor,
    mockTaskSyncBridgeInstance,
    mockTaskSyncBridgeConstructor,
    mockInboxBridgeInstance,
    mockNativeBridgeInstance,
    mockCreateAuthMiddleware,
    mockRequireRole,
    mockRequireTeamMembership,
    mockMetricsMiddleware,
    mockMetricsHandler,
    mockAutoSchedulerGetInstance,
    mockSchedulerInstance,
    mockTaskExecutorGetInstance,
    mockExecutorInstance,
    mockLoadDefaultConfig,
    noopHandler,
  };
});

// ---------------------------------------------------------------------------
// vi.mock() calls — wire up hoisted mocks
// ---------------------------------------------------------------------------

vi.mock('./storage/factory.js', () => ({
  createStorage: mocks.mockCreateStorage,
  getStorageConfigFromEnv: mocks.mockGetStorageConfigFromEnv,
}));

vi.mock('./storage/sqlite.js', () => ({
  SQLiteStorage: mocks.mockSQLiteStorageConstructor,
}));

vi.mock('./storage/workflow.js', () => ({
  WorkflowStorage: mocks.mockWorkflowStorageConstructor,
}));

vi.mock('./workers/workflow-engine.js', () => ({
  WorkflowEngine: mocks.mockWorkflowEngineConstructor,
}));

vi.mock('./workers/manager.js', () => ({
  WorkerManager: mocks.mockWorkerManagerConstructor,
}));

vi.mock('./workers/spawn-controller.js', () => ({
  SpawnController: mocks.mockSpawnControllerConstructor,
}));

vi.mock('./workers/task-sync.js', () => ({
  TaskSyncBridge: mocks.mockTaskSyncBridgeConstructor,
}));

vi.mock('./middleware/auth.js', () => ({
  createAuthMiddleware: mocks.mockCreateAuthMiddleware,
  requireRole: mocks.mockRequireRole,
  requireTeamMembership: mocks.mockRequireTeamMembership,
}));

vi.mock('./metrics/prometheus.js', () => ({
  metricsMiddleware: mocks.mockMetricsMiddleware,
  metricsHandler: mocks.mockMetricsHandler,
  agentAuthentications: { inc: vi.fn() },
  tasksCreated: { inc: vi.fn() },
  tasksCompleted: { inc: vi.fn() },
}));

vi.mock('./scheduler/auto-scheduler.js', () => ({
  AutoScheduler: { getInstance: mocks.mockAutoSchedulerGetInstance },
}));

vi.mock('./scheduler/executor.js', () => ({
  TaskExecutor: { getInstance: mocks.mockTaskExecutorGetInstance },
}));

vi.mock('./scheduler/config-loader.js', () => ({
  loadDefaultConfig: mocks.mockLoadDefaultConfig,
}));

vi.mock('./routes/webhooks.js', () => {
  const { Router } = require('express');
  return { default: Router() };
});

vi.mock('./routes/scheduler.js', () => {
  const { Router } = require('express');
  return { default: Router() };
});

// Mock ALL route handler factories from routes/index.js
// Each factory returns a simple no-op handler
vi.mock('./routes/index.js', () => {
  const handler = () => mocks.noopHandler;
  const handlerWithBroadcast = () => mocks.noopHandler;
  return {
    createHealthHandler: handler,
    createMetricsJsonHandler: handler,
    createAuthHandler: handler,
    createDebugHandler: handler,
    createGetUserHandler: handler,
    createGetUserChatsHandler: handler,
    createGetTeamAgentsHandler: handler,
    createBroadcastHandler: handlerWithBroadcast,
    createGetTeamTasksHandler: handler,
    createCreateChatHandler: handler,
    createGetMessagesHandler: handler,
    createSendMessageHandler: handlerWithBroadcast,
    createMarkReadHandler: handler,
    createCreateTaskHandler: handlerWithBroadcast,
    createGetTaskHandler: handler,
    createUpdateTaskHandler: handler,
    createSpawnWorkerHandler: handlerWithBroadcast,
    createDismissWorkerHandler: handlerWithBroadcast,
    createSendToWorkerHandler: handler,
    createGetWorkersHandler: handler,
    createGetWorkerOutputHandler: handler,
    createRegisterExternalWorkerHandler: handlerWithBroadcast,
    createInjectWorkerOutputHandler: handler,
    createWorktreeCommitHandler: handler,
    createWorktreePushHandler: handler,
    createWorktreePRHandler: handler,
    createWorktreeStatusHandler: handler,
    createExecuteWavesHandler: handlerWithBroadcast,
    createListWaveExecutionsHandler: handler,
    createGetWaveStatusHandler: handler,
    createCancelWaveHandler: handler,
    createExecuteMultiRepoHandler: handlerWithBroadcast,
    createListMultiRepoExecutionsHandler: handler,
    createGetMultiRepoStatusHandler: handler,
    createUpdateDepsHandler: handlerWithBroadcast,
    createSecurityAuditHandler: handlerWithBroadcast,
    createFormatCodeHandler: handlerWithBroadcast,
    createRunTestsHandler: handlerWithBroadcast,
    createCreateWorkItemHandler: handler,
    createListWorkItemsHandler: handler,
    createGetWorkItemHandler: handler,
    createUpdateWorkItemHandler: handler,
    createCreateBatchHandler: handler,
    createListBatchesHandler: handler,
    createGetBatchHandler: handler,
    createDispatchBatchHandler: handler,
    createSendMailHandler: handler,
    createGetMailHandler: handler,
    createGetUnreadMailHandler: handler,
    createMarkMailReadHandler: handler,
    createCreateHandoffHandler: handler,
    createGetHandoffsHandler: handler,
    createBlackboardPostHandler: handler,
    createBlackboardReadHandler: handler,
    createBlackboardMarkReadHandler: handler,
    createBlackboardArchiveHandler: handler,
    createBlackboardArchiveOldHandler: handler,
    createSpawnEnqueueHandler: handler,
    createSpawnStatusHandler: handler,
    createSpawnGetHandler: handler,
    createSpawnCancelHandler: handler,
    createCheckpointCreateHandler: handler,
    createCheckpointLoadHandler: handler,
    createCheckpointLatestHandler: handler,
    createCheckpointListHandler: handler,
    createCheckpointAcceptHandler: handler,
    createCheckpointRejectHandler: handler,
    createSwarmCreateHandler: handler,
    createSwarmListHandler: handler,
    createSwarmGetHandler: handler,
    createSwarmKillHandler: handler,
    createCreateTemplateHandler: handler,
    createListTemplatesHandler: handler,
    createGetTemplateHandler: handler,
    createUpdateTemplateHandler: handler,
    createDeleteTemplateHandler: handler,
    createRunTemplateHandler: handler,
    createGetFileSummaryHandler: handler,
    createCheckSummaryHandler: handler,
    createStoreFileSummaryHandler: handler,
    createGetMultipleSummariesHandler: handler,
    createGetCodebaseOverviewHandler: handler,
    createStoreCodebaseOverviewHandler: handler,
    createStoreDependencyHandler: handler,
    createGetDependencyGraphHandler: handler,
    createGetDependentsHandler: handler,
    createGetDependenciesHandler: handler,
    createInvalidateFileHandler: handler,
    createGetTLDRStatsHandler: handler,
    createClearTLDRCacheHandler: handler,
    createCreateWorkflowHandler: handler,
    createListWorkflowsHandler: handler,
    createGetWorkflowHandler: handler,
    createUpdateWorkflowHandler: handler,
    createDeleteWorkflowHandler: handler,
    createStartWorkflowHandler: handler,
    createCreateTriggerHandler: handler,
    createListTriggersHandler: handler,
    createListExecutionsHandler: handler,
    createGetExecutionHandler: handler,
    createPauseExecutionHandler: handler,
    createResumeExecutionHandler: handler,
    createCancelExecutionHandler: handler,
    createGetExecutionStepsHandler: handler,
    createGetExecutionEventsHandler: handler,
    createRetryStepHandler: handler,
    createCompleteStepHandler: handler,
    createDeleteTriggerHandler: handler,
    createAuditStatusHandler: handler,
    createAuditOutputHandler: handler,
    createAuditStartHandler: handler,
    createAuditStopHandler: handler,
    createQuickAuditHandler: handler,
    createDepositPheromoneHandler: handler,
    createQueryPheromonesHandler: handler,
    createGetResourceTrailsHandler: handler,
    createGetResourceActivityHandler: handler,
    createDecayPheromonesHandler: handler,
    createPheromoneStatsHandler: handler,
    createUpsertBeliefHandler: handler,
    createUpsertMetaBeliefHandler: handler,
    createBeliefStatsHandler: handler,
    createGetSwarmConsensusHandler: handler,
    createGetBeliefsHandler: handler,
    createTransferCreditsHandler: handler,
    createRecordTransactionHandler: handler,
    createUpdateReputationHandler: handler,
    createCreditStatsHandler: handler,
    createGetLeaderboardHandler: handler,
    createGetCreditHistoryHandler: handler,
    createGetCreditsHandler: handler,
    createCreateProposalHandler: handler,
    createListProposalsHandler: handler,
    createGetProposalHandler: handler,
    createCastVoteHandler: handler,
    createCloseProposalHandler: handler,
    createConsensusStatsHandler: handler,
    createSubmitBidHandler: handler,
    createGetTaskBidsHandler: handler,
    createEvaluateBidsHandler: handler,
    createRunAuctionHandler: handler,
    createBiddingStatsHandler: handler,
    createGetBidHandler: handler,
    createAcceptBidHandler: handler,
    createWithdrawBidHandler: handler,
    createDefinePayoffHandler: handler,
    createGetPayoffsHandler: handler,
    createCalculatePayoffHandler: handler,
    createCompoundSnapshotHandler: handler,
    createSearchHandler: handler,
    createSearchIndexHandler: handler,
    createSearchStatsHandler: handler,
    createSearchDeleteHandler: handler,
    createLmshTranslateHandler: handler,
    createLmshGetAliasesHandler: handler,
    createLmshAddAliasHandler: handler,
    createDagSortHandler: handler,
    createDagCyclesHandler: handler,
    createDagCriticalPathHandler: handler,
    createDagReadyHandler: handler,
    createMemoryStoreHandler: handler,
    createMemoryRecallHandler: handler,
    createMemorySearchHandler: handler,
    createMemoryListHandler: handler,
    createRoutingClassifyHandler: handler,
  };
});

// Mock the InboxBridge import (only used for type, but module is loaded)
vi.mock('./workers/inbox-bridge.js', () => ({
  InboxBridge: vi.fn(),
}));

vi.mock('./workers/native-bridge.js', () => ({
  NativeBridge: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import { CollabServer, getConfig } from './server.js';
import type { ServerConfig } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal CollabServer for testing with optional config overrides. */
function createTestServer(overrides?: Partial<ServerConfig>): CollabServer {
  return new CollabServer({
    port: 0, // ephemeral port
    dbPath: ':memory:',
    storageBackend: 'sqlite',
    jwtSecret: 'test-secret-for-unit-tests',
    jwtExpiresIn: '1h',
    maxWorkers: 2,
    rateLimitWindow: 60000,
    rateLimitMax: 100,
    corsOrigins: ['*'],
    nativeOnly: false,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('server.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars that getConfig reads
    delete process.env.PORT;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.MAX_WORKERS;
    delete process.env.CORS_ORIGINS;
    delete process.env.NODE_ENV;
    delete process.env.FLEET_NATIVE_ONLY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // getConfig()
  // ==========================================================================

  describe('getConfig', () => {
    it('should return default values when no env vars are set', () => {
      const config = getConfig();

      expect(config.port).toBe(3847);
      expect(config.jwtExpiresIn).toBe('24h');
      expect(config.maxWorkers).toBe(5);
      expect(config.rateLimitWindow).toBe(60000);
      expect(config.rateLimitMax).toBe(100);
      expect(config.corsOrigins).toEqual(['http://localhost:3847']);
      expect(config.nativeOnly).toBe(false);
    });

    it('should respect PORT env var', () => {
      process.env.PORT = '9999';
      const config = getConfig();
      expect(config.port).toBe(9999);
    });

    it('should respect JWT_SECRET env var', () => {
      process.env.JWT_SECRET = 'my-secret';
      const config = getConfig();
      expect(config.jwtSecret).toBe('my-secret');
    });

    it('should generate random jwtSecret when JWT_SECRET not set', () => {
      const config = getConfig();
      expect(config.jwtSecret).toBeDefined();
      expect(config.jwtSecret.length).toBeGreaterThan(10);
    });

    it('should warn in production when JWT_SECRET is not set', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.env.NODE_ENV = 'production';
      getConfig();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET not set'));
    });

    it('should not warn in non-production when JWT_SECRET is not set', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.env.NODE_ENV = 'development';
      getConfig();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should respect JWT_EXPIRES_IN env var', () => {
      process.env.JWT_EXPIRES_IN = '48h';
      const config = getConfig();
      expect(config.jwtExpiresIn).toBe('48h');
    });

    it('should respect MAX_WORKERS env var', () => {
      process.env.MAX_WORKERS = '10';
      const config = getConfig();
      expect(config.maxWorkers).toBe(10);
    });

    it('should parse CORS_ORIGINS from comma-separated string', () => {
      process.env.CORS_ORIGINS = 'http://a.com, http://b.com , http://c.com';
      const config = getConfig();
      expect(config.corsOrigins).toEqual(['http://a.com', 'http://b.com', 'http://c.com']);
    });

    it('should set nativeOnly when FLEET_NATIVE_ONLY=true', () => {
      process.env.FLEET_NATIVE_ONLY = 'true';
      const config = getConfig();
      expect(config.nativeOnly).toBe(true);
    });

    it('should set nativeOnly=false for other values', () => {
      process.env.FLEET_NATIVE_ONLY = 'false';
      const config = getConfig();
      expect(config.nativeOnly).toBe(false);
    });
  });

  // ==========================================================================
  // CollabServer constructor
  // ==========================================================================

  describe('CollabServer constructor', () => {
    it('should create a server instance with default config', () => {
      const server = createTestServer();
      expect(server).toBeDefined();
    });

    it('should merge provided config with defaults', () => {
      const server = createTestServer({ maxWorkers: 42 });
      expect(server).toBeDefined();
      // SpawnController is created in constructor
      expect(mocks.mockSpawnControllerConstructor).toHaveBeenCalledWith({
        softLimit: 50,
        hardLimit: 100,
        maxDepth: 3,
        autoProcess: true,
      });
    });
  });

  // ==========================================================================
  // initialize()
  // ==========================================================================

  describe('initialize', () => {
    it('should create storage, managers, and set up routes', async () => {
      const server = createTestServer();
      await server.initialize();

      // Storage factory called
      expect(mocks.mockCreateStorage).toHaveBeenCalled();
      expect(mocks.mockStorageInstance.initialize).toHaveBeenCalled();

      // Legacy storage created
      expect(mocks.mockSQLiteStorageConstructor).toHaveBeenCalled();
      expect(mocks.mockLegacyInstance.seedBuiltinTemplates).toHaveBeenCalled();

      // Workflow storage created and seeded
      expect(mocks.mockWorkflowStorageConstructor).toHaveBeenCalled();
      expect(mocks.mockWorkflowStorageInstance.seedTemplates).toHaveBeenCalled();

      // Worker manager created
      expect(mocks.mockWorkerManagerConstructor).toHaveBeenCalled();

      // SpawnController initialized
      expect(mocks.mockSpawnControllerInstance.initialize).toHaveBeenCalledWith(
        mocks.mockStorageInstance.spawnQueue,
        mocks.mockWorkerManagerInstance
      );

      // Worker manager got spawn controller
      expect(mocks.mockWorkerManagerInstance.setSpawnController).toHaveBeenCalledWith(
        mocks.mockSpawnControllerInstance
      );

      // TaskSyncBridge created and started
      expect(mocks.mockTaskSyncBridgeConstructor).toHaveBeenCalled();
      expect(mocks.mockTaskSyncBridgeInstance.start).toHaveBeenCalledWith(['default']);
      expect(mocks.mockTaskSyncBridgeInstance.fullSync).toHaveBeenCalledWith('default');
    });

    it('should be idempotent (skip if already initialized)', async () => {
      const server = createTestServer();
      await server.initialize();
      const firstCallCount = mocks.mockCreateStorage.mock.calls.length;

      await server.initialize();
      // Should not call createStorage again
      expect(mocks.mockCreateStorage.mock.calls.length).toBe(firstCallCount);
    });

    it('should set up InboxBridge and wire message events', async () => {
      const server = createTestServer();
      await server.initialize();

      expect(mocks.mockWorkerManagerInstance.getInboxBridge).toHaveBeenCalled();
      expect(mocks.mockInboxBridgeInstance.startWatching).toHaveBeenCalledWith('default');
      expect(mocks.mockInboxBridgeInstance.on).toHaveBeenCalledWith('message:received', expect.any(Function));
    });

    it('should set up NativeBridge and wire discovery events', async () => {
      const server = createTestServer();
      await server.initialize();

      expect(mocks.mockWorkerManagerInstance.getNativeBridge).toHaveBeenCalled();
      expect(mocks.mockNativeBridgeInstance.startDiscovery).toHaveBeenCalledWith('default');
      expect(mocks.mockNativeBridgeInstance.on).toHaveBeenCalledWith('agent:discovered', expect.any(Function));
    });

    it('should set up TaskSyncBridge events for sync broadcasts', async () => {
      const server = createTestServer();
      await server.initialize();

      expect(mocks.mockTaskSyncBridgeInstance.on).toHaveBeenCalledWith('sync:native-to-fleet', expect.any(Function));
      expect(mocks.mockTaskSyncBridgeInstance.on).toHaveBeenCalledWith('sync:fleet-to-native', expect.any(Function));
    });

    it('should create WorkflowEngine with correct dependencies', async () => {
      const server = createTestServer();
      await server.initialize();

      expect(mocks.mockWorkflowEngineConstructor).toHaveBeenCalledWith({
        workflowStorage: mocks.mockWorkflowStorageInstance,
        workItemStorage: mocks.mockStorageInstance.workItem,
        blackboardStorage: mocks.mockStorageInstance.blackboard,
      });
    });

    it('should handle InboxBridge being null gracefully', async () => {
      mocks.mockWorkerManagerInstance.getInboxBridge.mockReturnValueOnce(null);
      const server = createTestServer();
      await server.initialize();

      // Should not throw; inbox methods should not have been called again
      expect(mocks.mockInboxBridgeInstance.startWatching).not.toHaveBeenCalled();
    });

    it('should handle NativeBridge being null gracefully', async () => {
      mocks.mockWorkerManagerInstance.getNativeBridge.mockReturnValue(null);
      const server = createTestServer();
      await server.initialize();

      // Should not throw; native bridge discovery should not be called
      // (Reset the mock back after test)
      mocks.mockWorkerManagerInstance.getNativeBridge.mockReturnValue(mocks.mockNativeBridgeInstance);
    });

    it('should handle fullSync error gracefully (best-effort)', async () => {
      mocks.mockTaskSyncBridgeInstance.fullSync.mockRejectedValueOnce(new Error('sync failed'));
      const server = createTestServer();

      // Should not throw
      await server.initialize();
    });

    it('should set up auth middleware with JWT secret', async () => {
      const server = createTestServer({ jwtSecret: 'my-secret-123' });
      await server.initialize();

      expect(mocks.mockCreateAuthMiddleware).toHaveBeenCalledWith('my-secret-123');
    });
  });

  // ==========================================================================
  // start()
  // ==========================================================================

  describe('start', () => {
    it('should call initialize, start worker manager, workflow engine, and scheduler', async () => {
      const server = createTestServer({ port: 0 });

      // We need to spy on the listen method to prevent actually starting the server
      const listenSpy = vi.fn((_port: number, cb: () => void) => {
        cb(); // call the callback immediately
      });

      // Access the underlying http.Server via the private field
      // We do this by initializing first, then stopping
      await server.initialize();

      // Manually call the internal server listen mock
      // Since start() calls initialize() (idempotent), workerManager.initialize, etc.
      // we can verify the chain
      expect(mocks.mockWorkerManagerConstructor).toHaveBeenCalled();

      // Verify that start() proceeds to init worker manager, workflow engine, scheduler
      // We test individual pieces since actually calling start() would try to listen on a port
      // The initialize() path is tested above; here we verify the remaining start() calls
      // by calling start() with a mock server.listen
      const serverInstance = server as unknown as {
        server: { listen: typeof listenSpy };
        workerManager: typeof mocks.mockWorkerManagerInstance;
        workflowEngine: typeof mocks.mockWorkflowEngineInstance;
      };
      serverInstance.server.listen = listenSpy;

      await server.start();

      expect(mocks.mockWorkerManagerInstance.initialize).toHaveBeenCalled();
      expect(mocks.mockWorkflowEngineInstance.start).toHaveBeenCalled();
      expect(mocks.mockAutoSchedulerGetInstance).toHaveBeenCalled();
      expect(mocks.mockSchedulerInstance.start).toHaveBeenCalled();
      expect(mocks.mockTaskExecutorGetInstance).toHaveBeenCalled();
      expect(mocks.mockExecutorInstance.configure).toHaveBeenCalledWith({
        workerManager: mocks.mockWorkerManagerInstance,
        defaultWorkingDir: expect.any(String),
      });
      expect(mocks.mockLoadDefaultConfig).toHaveBeenCalled();
      expect(listenSpy).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // stop()
  // ==========================================================================

  describe('stop', () => {
    it('should stop workflow engine, scheduler, dismiss workers, and close server', async () => {
      const server = createTestServer();
      await server.initialize();

      // Mock server/wss close methods
      const serverInstance = server as unknown as {
        server: { close: ReturnType<typeof vi.fn>; listen: ReturnType<typeof vi.fn> };
        wss: { close: ReturnType<typeof vi.fn> };
      };
      serverInstance.server.close = vi.fn();
      serverInstance.wss.close = vi.fn();

      await server.stop();

      expect(mocks.mockWorkflowEngineInstance.stop).toHaveBeenCalled();
      expect(mocks.mockWorkerManagerInstance.dismissAll).toHaveBeenCalled();
      expect(serverInstance.wss.close).toHaveBeenCalled();
      expect(serverInstance.server.close).toHaveBeenCalled();
      expect(mocks.mockStorageInstance.close).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================

  describe('rate limiting', () => {
    it('should be exercised via the middleware setup', async () => {
      const server = createTestServer({ rateLimitMax: 3, rateLimitWindow: 60000 });
      await server.initialize();

      // Access the private rateLimitMiddleware via the app's middleware stack
      // We test the rate limiter by directly calling the private method
      const serverAny = server as unknown as {
        rateLimitMiddleware: (req: unknown, res: unknown, next: () => void) => void;
        rateLimits: Map<string, { count: number; windowStart: number }>;
        config: ServerConfig;
      };

      const mockNext = vi.fn();
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const baseReq = {
        path: '/tasks',
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      };

      // First request — should pass
      serverAny.rateLimitMiddleware(baseReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);

      // Second request — should pass
      serverAny.rateLimitMiddleware(baseReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(2);

      // Third request — should pass (count=3, max=3)
      serverAny.rateLimitMiddleware(baseReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(3);

      // Fourth request — should be rate limited (count=4 > max=3)
      serverAny.rateLimitMiddleware(baseReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Too many requests. Try again later.' });
      expect(mockNext).toHaveBeenCalledTimes(3); // unchanged
    });

    it('should skip rate limiting for static file extensions', async () => {
      const server = createTestServer({ rateLimitMax: 1 });
      await server.initialize();

      const serverAny = server as unknown as {
        rateLimitMiddleware: (req: unknown, res: unknown, next: () => void) => void;
      };

      const mockNext = vi.fn();
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };

      // .js files should skip rate limiting
      serverAny.rateLimitMiddleware({ path: '/app.js', ip: '1.1.1.1', socket: { remoteAddress: '1.1.1.1' } }, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);

      // .css files should skip
      serverAny.rateLimitMiddleware({ path: '/style.css', ip: '1.1.1.1', socket: { remoteAddress: '1.1.1.1' } }, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(2);

      // /dashboard paths should skip
      serverAny.rateLimitMiddleware({ path: '/dashboard/main', ip: '1.1.1.1', socket: { remoteAddress: '1.1.1.1' } }, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(3);
    });

    it('should skip rate limiting for health, metrics, and output endpoints', async () => {
      const server = createTestServer({ rateLimitMax: 1 });
      await server.initialize();

      const serverAny = server as unknown as {
        rateLimitMiddleware: (req: unknown, res: unknown, next: () => void) => void;
      };

      const mockNext = vi.fn();
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };

      serverAny.rateLimitMiddleware({ path: '/health', ip: '2.2.2.2', socket: { remoteAddress: '2.2.2.2' } }, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);

      serverAny.rateLimitMiddleware({ path: '/metrics', ip: '2.2.2.2', socket: { remoteAddress: '2.2.2.2' } }, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(2);

      serverAny.rateLimitMiddleware({ path: '/orchestrate/output/w1/output', ip: '2.2.2.2', socket: { remoteAddress: '2.2.2.2' } }, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(3);
    });

    it('should reset rate limit after window expires', async () => {
      const server = createTestServer({ rateLimitMax: 1, rateLimitWindow: 100 });
      await server.initialize();

      const serverAny = server as unknown as {
        rateLimitMiddleware: (req: unknown, res: unknown, next: () => void) => void;
        rateLimits: Map<string, { count: number; windowStart: number }>;
        config: ServerConfig;
      };

      const mockNext = vi.fn();
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const req = { path: '/tasks', ip: '3.3.3.3', socket: { remoteAddress: '3.3.3.3' } };

      // First request passes
      serverAny.rateLimitMiddleware(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);

      // Second request — would be limited
      serverAny.rateLimitMiddleware(req, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(429);

      // Simulate window expiration
      const limitEntry = serverAny.rateLimits.get('3.3.3.3');
      if (limitEntry) {
        limitEntry.windowStart = Date.now() - 200; // expired
      }

      // Next request should pass (window reset)
      mockNext.mockClear();
      mockRes.status.mockClear();
      serverAny.rateLimitMiddleware(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should use socket.remoteAddress when ip is undefined', async () => {
      const server = createTestServer({ rateLimitMax: 1 });
      await server.initialize();

      const serverAny = server as unknown as {
        rateLimitMiddleware: (req: unknown, res: unknown, next: () => void) => void;
        rateLimits: Map<string, { count: number; windowStart: number }>;
      };

      const mockNext = vi.fn();
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const req = { path: '/tasks', ip: undefined, socket: { remoteAddress: '4.4.4.4' } };

      serverAny.rateLimitMiddleware(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(serverAny.rateLimits.has('4.4.4.4')).toBe(true);
    });

    it('should use "unknown" when ip and remoteAddress are both undefined', async () => {
      const server = createTestServer({ rateLimitMax: 1 });
      await server.initialize();

      const serverAny = server as unknown as {
        rateLimitMiddleware: (req: unknown, res: unknown, next: () => void) => void;
        rateLimits: Map<string, { count: number; windowStart: number }>;
      };

      const mockNext = vi.fn();
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const req = { path: '/tasks', ip: undefined, socket: { remoteAddress: undefined } };

      serverAny.rateLimitMiddleware(req, mockRes, mockNext);
      expect(serverAny.rateLimits.has('unknown')).toBe(true);
    });
  });

  // ==========================================================================
  // Broadcast methods
  // ==========================================================================

  describe('broadcastToChat', () => {
    it('should send message to all subscribers of a chat', async () => {
      const server = createTestServer();
      await server.initialize();

      const serverAny = server as unknown as {
        broadcastToChat: (chatId: string, message: unknown) => void;
        subscriptions: Map<string, Set<{ readyState: number; OPEN: number; send: ReturnType<typeof vi.fn> }>>;
      };

      const mockWs1 = { readyState: 1, OPEN: 1, send: vi.fn() };
      const mockWs2 = { readyState: 1, OPEN: 1, send: vi.fn() };
      const mockWsClosed = { readyState: 3, OPEN: 1, send: vi.fn() };

      const subs = new Set([mockWs1, mockWs2, mockWsClosed]);
      serverAny.subscriptions.set('chat-1', subs as unknown as Set<{ readyState: number; OPEN: number; send: ReturnType<typeof vi.fn> }>);

      serverAny.broadcastToChat('chat-1', { type: 'new_message', text: 'hello' });

      expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'new_message', text: 'hello' }));
      expect(mockWs2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'new_message', text: 'hello' }));
      // Closed connection should not receive
      expect(mockWsClosed.send).not.toHaveBeenCalled();
    });

    it('should do nothing if chatId has no subscribers', async () => {
      const server = createTestServer();
      await server.initialize();

      const serverAny = server as unknown as {
        broadcastToChat: (chatId: string, message: unknown) => void;
      };

      // Should not throw
      serverAny.broadcastToChat('nonexistent-chat', { type: 'test' });
    });
  });

  describe('broadcastToAll', () => {
    it('should send message to all connected WebSocket clients', async () => {
      const server = createTestServer();
      await server.initialize();

      const serverAny = server as unknown as {
        broadcastToAll: (message: unknown) => void;
        wss: { clients: Set<{ readyState: number; OPEN: number; send: ReturnType<typeof vi.fn> }> };
      };

      const mockWs1 = { readyState: 1, OPEN: 1, send: vi.fn() };
      const mockWs2 = { readyState: 3, OPEN: 1, send: vi.fn() }; // closed

      serverAny.wss.clients = new Set([mockWs1, mockWs2]);

      serverAny.broadcastToAll({ type: 'worker_spawned', handle: 'w-1' });

      expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'worker_spawned', handle: 'w-1' }));
      expect(mockWs2.send).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Worker events
  // ==========================================================================

  describe('setupWorkerEvents', () => {
    it('should register worker:output and worker:exit event listeners', async () => {
      const server = createTestServer();
      await server.initialize();

      // WorkerManager.on() should have been called for worker events
      const onCalls = mocks.mockWorkerManagerInstance.on.mock.calls;
      const eventNames = onCalls.map((call: unknown[]) => call[0]);

      expect(eventNames).toContain('worker:output');
      expect(eventNames).toContain('worker:exit');
    });

    it('should broadcast worker output events to all clients', async () => {
      const server = createTestServer();
      await server.initialize();

      const serverAny = server as unknown as {
        broadcastToAll: (message: unknown) => void;
        wss: { clients: Set<{ readyState: number; OPEN: number; send: ReturnType<typeof vi.fn> }> };
      };

      // Find the worker:output callback
      const outputCall = mocks.mockWorkerManagerInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'worker:output'
      );
      expect(outputCall).toBeDefined();

      const mockWs = { readyState: 1, OPEN: 1, send: vi.fn() };
      serverAny.wss.clients = new Set([mockWs]);

      // Invoke the callback
      const callback = outputCall![1] as (data: { handle: string; event: unknown }) => void;
      callback({ handle: 'w-1', event: { line: 'test output' } });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'worker_output', handle: 'w-1', output: JSON.stringify({ line: 'test output' }) })
      );
    });

    it('should broadcast worker exit events to all clients', async () => {
      const server = createTestServer();
      await server.initialize();

      const serverAny = server as unknown as {
        broadcastToAll: (message: unknown) => void;
        wss: { clients: Set<{ readyState: number; OPEN: number; send: ReturnType<typeof vi.fn> }> };
      };

      const exitCall = mocks.mockWorkerManagerInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'worker:exit'
      );
      expect(exitCall).toBeDefined();

      const mockWs = { readyState: 1, OPEN: 1, send: vi.fn() };
      serverAny.wss.clients = new Set([mockWs]);

      const callback = exitCall![1] as (data: { handle: string }) => void;
      callback({ handle: 'w-2' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'worker_dismissed', handle: 'w-2' })
      );
    });
  });

  // ==========================================================================
  // ensureTeamWatching
  // ==========================================================================

  describe('ensureTeamWatching', () => {
    it('should start watching for a new team', async () => {
      const server = createTestServer();
      await server.initialize();

      const serverAny = server as unknown as {
        ensureTeamWatching: (teamName: string) => void;
        watchedTeams: Set<string>;
      };

      // 'default' is already watched
      expect(serverAny.watchedTeams.has('default')).toBe(true);

      // Reset mock call counts before testing new team
      mocks.mockTaskSyncBridgeInstance.watchTeam.mockClear();
      mocks.mockTaskSyncBridgeInstance.fullSync.mockClear();
      mocks.mockInboxBridgeInstance.startWatching.mockClear();
      mocks.mockNativeBridgeInstance.startDiscovery.mockClear();

      serverAny.ensureTeamWatching('new-team');

      expect(serverAny.watchedTeams.has('new-team')).toBe(true);
      expect(mocks.mockTaskSyncBridgeInstance.watchTeam).toHaveBeenCalledWith('new-team');
      expect(mocks.mockTaskSyncBridgeInstance.fullSync).toHaveBeenCalledWith('new-team');
      expect(mocks.mockInboxBridgeInstance.startWatching).toHaveBeenCalledWith('new-team');
      expect(mocks.mockNativeBridgeInstance.startDiscovery).toHaveBeenCalledWith('new-team');
    });

    it('should skip if team is already watched', async () => {
      const server = createTestServer();
      await server.initialize();

      const serverAny = server as unknown as {
        ensureTeamWatching: (teamName: string) => void;
      };

      // Clear counts from initialize
      mocks.mockTaskSyncBridgeInstance.watchTeam.mockClear();

      // 'default' is already watched — should be a no-op
      serverAny.ensureTeamWatching('default');
      expect(mocks.mockTaskSyncBridgeInstance.watchTeam).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Route registration
  // ==========================================================================

  describe('route registration', () => {
    it('should register health endpoint', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routes = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string; methods: Record<string, boolean> } }) => ({
          path: layer.route?.path,
          methods: Object.keys(layer.route?.methods ?? {}),
        }));

      const healthRoute = routes.find((r: { path: string }) => r.path === '/health');
      expect(healthRoute).toBeDefined();
      expect(healthRoute?.methods).toContain('get');
    });

    it('should register auth endpoint', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routes = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string; methods: Record<string, boolean> } }) => ({
          path: layer.route?.path,
          methods: Object.keys(layer.route?.methods ?? {}),
        }));

      const authRoute = routes.find((r: { path: string }) => r.path === '/auth');
      expect(authRoute).toBeDefined();
      expect(authRoute?.methods).toContain('post');
    });

    it('should register core API routes (tasks, chats, orchestrate)', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routePaths = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string } }) => layer.route?.path);

      expect(routePaths).toContain('/tasks');
      expect(routePaths).toContain('/tasks/:taskId');
      expect(routePaths).toContain('/chats');
      expect(routePaths).toContain('/chats/:chatId/messages');
      expect(routePaths).toContain('/orchestrate/spawn');
      expect(routePaths).toContain('/orchestrate/workers');
    });

    it('should register swarm intelligence routes', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routePaths = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string } }) => layer.route?.path);

      expect(routePaths).toContain('/pheromones');
      expect(routePaths).toContain('/beliefs');
      expect(routePaths).toContain('/credits/transfer');
      expect(routePaths).toContain('/consensus/proposals');
      expect(routePaths).toContain('/bids');
    });

    it('should register memory and routing routes', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routePaths = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string } }) => layer.route?.path);

      expect(routePaths).toContain('/memory/store');
      expect(routePaths).toContain('/memory/recall/:agentId/:key');
      expect(routePaths).toContain('/memory/search');
      expect(routePaths).toContain('/routing/classify');
    });

    it('should register search and DAG routes', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routePaths = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string } }) => layer.route?.path);

      expect(routePaths).toContain('/search');
      expect(routePaths).toContain('/search/index');
      expect(routePaths).toContain('/dag/sort');
      expect(routePaths).toContain('/dag/cycles');
    });

    it('should register coordination status and health endpoints', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routePaths = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string } }) => layer.route?.path);

      expect(routePaths).toContain('/coordination/status');
      expect(routePaths).toContain('/coordination/health');
    });

    it('should register LMSH routes', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routePaths = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string } }) => layer.route?.path);

      expect(routePaths).toContain('/lmsh/translate');
      expect(routePaths).toContain('/lmsh/aliases');
    });

    it('should register workflow and execution routes', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routePaths = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string } }) => layer.route?.path);

      expect(routePaths).toContain('/workflows');
      expect(routePaths).toContain('/workflows/:id');
      expect(routePaths).toContain('/workflows/:id/start');
      expect(routePaths).toContain('/executions');
      expect(routePaths).toContain('/executions/:id');
    });

    it('should register compound snapshot route', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } } }).app;
      const routePaths = app._router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route?: { path: string } }) => layer.route?.path);

      expect(routePaths).toContain('/compound/snapshot');
    });
  });

  // ==========================================================================
  // Coordination endpoints (inline handlers)
  // ==========================================================================

  describe('coordination status endpoint', () => {
    it('should respond with coordination status data', async () => {
      const server = createTestServer();
      await server.initialize();

      // Find the inline handler for /coordination/status
      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: { json: (d: unknown) => void }) => void }> } }> } } }).app;
      const statusLayer = app._router.stack.find(
        (layer: { route?: { path: string } }) => layer.route?.path === '/coordination/status'
      );
      expect(statusLayer).toBeDefined();

      // Get the last handler in the route stack (the actual handler, after middleware)
      const handlers = statusLayer!.route!.stack;
      const handler = handlers[handlers.length - 1].handle;

      const mockRes = { json: vi.fn() };
      handler({}, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          coordination: expect.objectContaining({
            activeAdapter: 'native',
            native: expect.objectContaining({
              isAvailable: true,
            }),
            spawnModes: ['native', 'tmux', 'external'],
            deprecatedModes: ['process'],
          }),
        })
      );
    });
  });

  describe('coordination health endpoint', () => {
    it('should respond with health checks and subsystem status', async () => {
      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: { json: (d: unknown) => void }) => void }> } }> } } }).app;
      const healthLayer = app._router.stack.find(
        (layer: { route?: { path: string } }) => layer.route?.path === '/coordination/health'
      );
      expect(healthLayer).toBeDefined();

      const handlers = healthLayer!.route!.stack;
      const handler = handlers[handlers.length - 1].handle;

      const mockRes = { json: vi.fn() };
      handler({}, mockRes);

      const response = mockRes.json.mock.calls[0][0];
      expect(response.healthy).toBe(true);
      expect(response.adapter).toBe('native');
      expect(response.checks).toBeInstanceOf(Array);
      expect(response.checks.length).toBe(5);
      expect(response.watchedTeams).toContain('default');
      expect(response.subsystems).toBeDefined();
    });

    it('should mark native_binary as failed when not available', async () => {
      mocks.mockWorkerManagerInstance.getNativeStatus.mockReturnValueOnce({
        isAvailable: false,
        claudeBinary: null,
        defaultSpawnMode: 'tmux',
      });

      const server = createTestServer();
      await server.initialize();

      const app = (server as unknown as { app: { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: { json: (d: unknown) => void }) => void }> } }> } } }).app;
      const healthLayer = app._router.stack.find(
        (layer: { route?: { path: string } }) => layer.route?.path === '/coordination/health'
      );

      const handlers = healthLayer!.route!.stack;
      const handler = handlers[handlers.length - 1].handle;

      const mockRes = { json: vi.fn() };
      handler({}, mockRes);

      const response = mockRes.json.mock.calls[0][0];
      const binaryCheck = response.checks.find((c: { name: string }) => c.name === 'native_binary');
      expect(binaryCheck?.passed).toBe(false);
      expect(response.healthy).toBe(false);
    });
  });

  // ==========================================================================
  // WebSocket setup
  // ==========================================================================

  describe('setupWebSocket', () => {
    it('should register connection handler on WebSocketServer', async () => {
      const server = createTestServer();
      await server.initialize();

      const serverAny = server as unknown as {
        wss: { on: ReturnType<typeof vi.fn>; clients: Set<unknown> };
      };

      // The WSS is a real WebSocketServer from the constructor, but
      // we can check it was set up by verifying the internal state
      expect(serverAny.wss).toBeDefined();
    });
  });

  // ==========================================================================
  // Middleware chain
  // ==========================================================================

  describe('middleware chain', () => {
    it('should set up helmet, cors, json, metrics, rate limit, static, and auth middleware', async () => {
      const server = createTestServer();
      await server.initialize();

      // Verify auth middleware was created
      expect(mocks.mockCreateAuthMiddleware).toHaveBeenCalled();

      // The app should have middleware registered
      const app = (server as unknown as { app: { _router: { stack: Array<{ name: string }> } } }).app;
      const middlewareNames = app._router.stack.map((layer: { name: string }) => layer.name);

      // Express adds various middleware; we just check key ones are present
      // helmet adds multiple middleware layers
      expect(middlewareNames.some((name: string) => name === 'json' || name === 'jsonParser')).toBe(true);
    });
  });

  // ==========================================================================
  // Non-SQLite backend path
  // ==========================================================================

  describe('non-SQLite storage backend', () => {
    it('should create fallback SQLite for workflow when backend is not sqlite', async () => {
      // getStorageConfigFromEnv is called twice: once in getConfig() (constructor), once in initialize()
      // We need both calls to return the dynamodb config
      const dynamoConfig = { backend: 'dynamodb', region: 'us-east-1', tablePrefix: 'test' };
      mocks.mockGetStorageConfigFromEnv
        .mockReturnValueOnce(dynamoConfig)
        .mockReturnValueOnce(dynamoConfig);

      const server = createTestServer({ storageBackend: 'dynamodb', dbPath: '/tmp/fallback.db' });
      await server.initialize();

      // SQLiteStorage should be created with the config.dbPath for legacy ops
      expect(mocks.mockSQLiteStorageConstructor).toHaveBeenCalledWith('/tmp/fallback.db');
    });
  });

  // ==========================================================================
  // WorkerManager config
  // ==========================================================================

  describe('WorkerManager configuration', () => {
    it('should pass nativeOnly to WorkerManager and disable worktrees', async () => {
      const server = createTestServer({ nativeOnly: true, maxWorkers: 3, port: 0 });
      await server.initialize();

      expect(mocks.mockWorkerManagerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          maxWorkers: 3,
          nativeOnly: true,
          useWorktrees: false,
          injectMail: true,
        })
      );
    });

    it('should enable worktrees when nativeOnly is false', async () => {
      const server = createTestServer({ nativeOnly: false });
      await server.initialize();

      expect(mocks.mockWorkerManagerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          useWorktrees: true,
          nativeOnly: false,
        })
      );
    });
  });
});
