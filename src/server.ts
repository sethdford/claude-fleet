/**
 * Claude Fleet Server v2.0
 *
 * Multi-agent orchestration server with Express HTTP API, WebSocket real-time
 * updates, and fleet coordination for spawning Claude Code worker agents.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

import { SQLiteStorage } from './storage/sqlite.js';
import { WorkerManager } from './workers/manager.js';
import { SpawnController } from './workers/spawn-controller.js';
import { WorkflowStorage } from './storage/workflow.js';
import { WorkflowEngine } from './workers/workflow-engine.js';
import { createStorage, getStorageConfigFromEnv } from './storage/factory.js';
import type { IStorage } from './storage/interfaces.js';
import { createAuthMiddleware, requireRole, requireTeamMembership } from './middleware/auth.js';
import { metricsMiddleware, metricsHandler } from './metrics/prometheus.js';
import { AutoScheduler } from './scheduler/auto-scheduler.js';
import { TaskExecutor } from './scheduler/executor.js';
import { loadDefaultConfig } from './scheduler/config-loader.js';
import webhooksRouter from './routes/webhooks.js';
import schedulerRouter from './routes/scheduler.js';
import type {
  ServerConfig,
  ExtendedWebSocket,
  WebSocketMessage,
} from './types.js';
import type { RouteDependencies, BroadcastToChat, BroadcastToAll } from './routes/types.js';
import * as routes from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

export function getConfig(): ServerConfig {
  const storageConfig = getStorageConfigFromEnv();

  // Warn if JWT_SECRET not set in production
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret && process.env.NODE_ENV === 'production') {
    console.error('[SECURITY] WARNING: JWT_SECRET not set in production! Tokens will be invalid after restart.');
  }

  return {
    port: parseInt(process.env.PORT ?? '3847', 10),
    dbPath: storageConfig.backend === 'sqlite' ? storageConfig.path : path.join(__dirname, '..', 'fleet.db'),
    storageBackend: storageConfig.backend,
    jwtSecret: jwtSecret ?? crypto.randomBytes(32).toString('hex'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
    maxWorkers: parseInt(process.env.MAX_WORKERS ?? '5', 10),
    rateLimitWindow: 60000,
    rateLimitMax: 100,
    corsOrigins: process.env.CORS_ORIGINS?.split(',').map(s => s.trim()) ?? ['http://localhost:3847'],
  };
}

// ============================================================================
// SERVER CLASS
// ============================================================================

export class CollabServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private storage!: IStorage;
  private legacyStorage!: SQLiteStorage;
  private workflowStorage!: WorkflowStorage;
  private workflowEngine!: WorkflowEngine;
  private spawnController: SpawnController;
  private workerManager!: WorkerManager;
  private config: ServerConfig;
  private subscriptions = new Map<string, Set<ExtendedWebSocket>>();
  private rateLimits = new Map<string, { count: number; windowStart: number }>();
  private startTime = Date.now();
  private swarms = new Map<string, { id: string; name: string; description?: string; maxAgents: number; createdAt: number }>();
  private deps!: RouteDependencies;
  private initialized = false;

  constructor(config?: Partial<ServerConfig>) {
    this.config = { ...getConfig(), ...config };
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.spawnController = new SpawnController({
      softLimit: 50,
      hardLimit: 100,
      maxDepth: 3,
      autoProcess: true,
    });
  }

  /**
   * Initialize the server asynchronously.
   * Must be called before start().
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create storage using factory pattern
    const storageConfig = getStorageConfigFromEnv();
    this.storage = await createStorage(storageConfig);
    await this.storage.initialize();

    // Keep legacy storage for operations not yet in IStorage (workflow)
    // For SQLite, we can access the underlying storage; for other backends, create a new instance
    if (storageConfig.backend === 'sqlite') {
      this.legacyStorage = new SQLiteStorage(storageConfig.path);
    } else {
      // For non-SQLite backends, create SQLite as fallback for workflow
      this.legacyStorage = new SQLiteStorage(this.config.dbPath);
    }

    // Seed builtin swarm templates
    this.legacyStorage.seedBuiltinTemplates();

    // Workflow storage still uses legacy storage (not yet abstracted)
    this.workflowStorage = new WorkflowStorage(this.legacyStorage);
    this.workflowStorage.seedTemplates();

    // Initialize worker manager with legacy storage (needs direct SQLite access)
    this.workerManager = new WorkerManager({
      maxWorkers: this.config.maxWorkers,
      serverUrl: `http://localhost:${this.config.port}`,
      storage: this.legacyStorage,
      injectMail: true,
      useWorktrees: true,
    });

    // Connect SpawnController to WorkerManager
    // Use the abstracted storage interface for spawn queue
    this.spawnController.initialize(this.storage.spawnQueue, this.workerManager);
    this.workerManager.setSpawnController(this.spawnController);

    // Initialize workflow engine with abstracted storage interfaces
    this.workflowEngine = new WorkflowEngine({
      workflowStorage: this.workflowStorage,
      workItemStorage: this.storage.workItem,
      blackboardStorage: this.storage.blackboard,
    });

    // Create route dependencies using IStorage
    this.deps = {
      config: this.config,
      storage: this.storage,
      legacyStorage: this.legacyStorage,
      workerManager: this.workerManager,
      workflowStorage: this.workflowStorage,
      workflowEngine: this.workflowEngine,
      spawnController: this.spawnController,
      swarms: this.swarms,
      startTime: this.startTime,
      broadcastToAll: this.broadcastToAll.bind(this),
    };

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupWorkerEvents();
    this.setupCleanup();

    this.initialized = true;
  }

  // ============================================================================
  // MIDDLEWARE
  // ============================================================================

  private setupMiddleware(): void {
    // Security headers (XSS, clickjacking, MIME sniffing protection)
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ['\'self\''],
          // Allow jsdelivr CDN for dashboard libraries (d3, chart.js, xterm)
          scriptSrc: ['\'self\'', '\'unsafe-inline\'', 'https://cdn.jsdelivr.net'],
          styleSrc: ['\'self\'', '\'unsafe-inline\'', 'https://cdn.jsdelivr.net'],
          imgSrc: ['\'self\'', 'data:'],
          connectSrc: ['\'self\'', 'ws:', 'wss:'],
          fontSrc: ['\'self\'', 'https://cdn.jsdelivr.net'],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow loading resources
    }));

    // CORS with configured origins
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        // Always allow same-origin requests (dashboard served from this server)
        const serverOrigin = `http://localhost:${this.config.port}`;
        if (origin === serverOrigin) return callback(null, true);
        if (this.config.corsOrigins.includes(origin) || this.config.corsOrigins.includes('*')) {
          return callback(null, true);
        }
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    }));

    // Capture raw body for webhook signature verification
    this.app.use('/webhooks', express.json({
      limit: '1mb',
      verify: (req: Request, _res, buf) => {
        // Store raw body for signature verification
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      }
    }));

    // Regular JSON parsing for other routes
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(metricsMiddleware);
    this.app.use(this.rateLimitMiddleware.bind(this));
    // Serve static files BEFORE auth middleware
    this.app.use(express.static(path.join(__dirname, '..', 'public')));
    this.app.use(createAuthMiddleware(this.config.jwtSecret));
  }

  private rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Skip rate limiting for static files, health checks, and internal worker output
    const staticExtensions = ['.js', '.css', '.html', '.png', '.jpg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.map', '.json'];
    if (staticExtensions.some(ext => req.path.endsWith(ext)) || req.path.startsWith('/dashboard')) {
      return next();
    }
    if (req.path === '/health' || req.path === '/metrics' || req.path.endsWith('/output')) {
      return next();
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();

    if (!this.rateLimits.has(ip)) {
      this.rateLimits.set(ip, { count: 1, windowStart: now });
      return next();
    }

    const limit = this.rateLimits.get(ip)!;
    if (now - limit.windowStart > this.config.rateLimitWindow) {
      limit.count = 1;
      limit.windowStart = now;
      return next();
    }

    limit.count++;
    if (limit.count > this.config.rateLimitMax) {
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }

    next();
  }

  // ============================================================================
  // ROUTES
  // ============================================================================

  private setupRoutes(): void {
    const broadcastToChat: BroadcastToChat = this.broadcastToChat.bind(this);
    const broadcastToAll: BroadcastToAll = this.broadcastToAll.bind(this);

    // Core routes
    this.app.get('/health', routes.createHealthHandler(this.deps));
    this.app.get('/metrics', metricsHandler);
    this.app.get('/metrics/json', routes.createMetricsJsonHandler(this.deps));
    this.app.post('/auth', routes.createAuthHandler(this.deps));
    this.app.get('/debug', requireRole('team-lead'), routes.createDebugHandler(this.deps));

    // User routes
    this.app.get('/users/:uid', routes.createGetUserHandler(this.deps));
    this.app.get('/users/:uid/chats', routes.createGetUserChatsHandler(this.deps));

    // Team routes (require team membership)
    this.app.get('/teams/:teamName/agents', requireTeamMembership(), routes.createGetTeamAgentsHandler(this.deps));
    this.app.post('/teams/:teamName/broadcast', requireRole('team-lead'), requireTeamMembership(), routes.createBroadcastHandler(this.deps, broadcastToChat));
    this.app.get('/teams/:teamName/tasks', requireTeamMembership(), routes.createGetTeamTasksHandler(this.deps));

    // Chat routes
    this.app.post('/chats', routes.createCreateChatHandler(this.deps));
    this.app.get('/chats/:chatId/messages', routes.createGetMessagesHandler(this.deps));
    this.app.post('/chats/:chatId/messages', routes.createSendMessageHandler(this.deps, broadcastToChat));
    this.app.post('/chats/:chatId/read', routes.createMarkReadHandler(this.deps));

    // Task routes
    this.app.post('/tasks', routes.createCreateTaskHandler(this.deps, broadcastToChat));
    this.app.get('/tasks/:taskId', routes.createGetTaskHandler(this.deps));
    this.app.patch('/tasks/:taskId', routes.createUpdateTaskHandler(this.deps));

    // Orchestration routes
    this.app.post('/orchestrate/spawn', requireRole('team-lead'), routes.createSpawnWorkerHandler(this.deps, broadcastToAll));
    this.app.post('/orchestrate/dismiss/:handle', requireRole('team-lead'), routes.createDismissWorkerHandler(this.deps, broadcastToAll));
    this.app.post('/orchestrate/send/:handle', routes.createSendToWorkerHandler(this.deps));
    this.app.get('/orchestrate/workers', routes.createGetWorkersHandler(this.deps));
    this.app.get('/orchestrate/output/:handle', routes.createGetWorkerOutputHandler(this.deps));
    this.app.post('/orchestrate/workers/register', requireRole('team-lead'), routes.createRegisterExternalWorkerHandler(this.deps, broadcastToAll));
    this.app.post('/orchestrate/workers/:handle/output', routes.createInjectWorkerOutputHandler(this.deps));

    // Worktree routes
    this.app.post('/orchestrate/worktree/:handle/commit', routes.createWorktreeCommitHandler(this.deps));
    this.app.post('/orchestrate/worktree/:handle/push', requireRole('team-lead'), routes.createWorktreePushHandler(this.deps));
    this.app.post('/orchestrate/worktree/:handle/pr', requireRole('team-lead'), routes.createWorktreePRHandler(this.deps));
    this.app.get('/orchestrate/worktree/:handle/status', routes.createWorktreeStatusHandler(this.deps));

    // Wave orchestration routes
    this.app.post('/orchestrate/waves', requireRole('team-lead'), routes.createExecuteWavesHandler(this.deps, broadcastToAll));
    this.app.get('/orchestrate/waves', requireRole('team-lead', 'worker'), routes.createListWaveExecutionsHandler(this.deps));
    this.app.get('/orchestrate/waves/:id', requireRole('team-lead', 'worker'), routes.createGetWaveStatusHandler(this.deps));
    this.app.post('/orchestrate/waves/:id/cancel', requireRole('team-lead'), routes.createCancelWaveHandler(this.deps));

    // Multi-repo orchestration routes
    this.app.post('/orchestrate/multi-repo', requireRole('team-lead'), routes.createExecuteMultiRepoHandler(this.deps, broadcastToAll));
    this.app.get('/orchestrate/multi-repo', requireRole('team-lead', 'worker'), routes.createListMultiRepoExecutionsHandler(this.deps));
    this.app.get('/orchestrate/multi-repo/:id', requireRole('team-lead', 'worker'), routes.createGetMultiRepoStatusHandler(this.deps));

    // Multi-repo common task shortcuts
    this.app.post('/orchestrate/multi-repo/update-deps', requireRole('team-lead'), routes.createUpdateDepsHandler(this.deps, broadcastToAll));
    this.app.post('/orchestrate/multi-repo/security-audit', requireRole('team-lead'), routes.createSecurityAuditHandler(this.deps, broadcastToAll));
    this.app.post('/orchestrate/multi-repo/format-code', requireRole('team-lead'), routes.createFormatCodeHandler(this.deps, broadcastToAll));
    this.app.post('/orchestrate/multi-repo/run-tests', requireRole('team-lead'), routes.createRunTestsHandler(this.deps, broadcastToAll));

    // Work item routes (require authentication)
    this.app.post('/workitems', requireRole('team-lead', 'worker'), routes.createCreateWorkItemHandler(this.deps));
    this.app.get('/workitems', requireRole('team-lead', 'worker'), routes.createListWorkItemsHandler(this.deps));
    this.app.get('/workitems/:id', requireRole('team-lead', 'worker'), routes.createGetWorkItemHandler(this.deps));
    this.app.patch('/workitems/:id', requireRole('team-lead', 'worker'), routes.createUpdateWorkItemHandler(this.deps));

    // Batch routes (require authentication)
    this.app.post('/batches', requireRole('team-lead'), routes.createCreateBatchHandler(this.deps));
    this.app.get('/batches', requireRole('team-lead', 'worker'), routes.createListBatchesHandler(this.deps));
    this.app.get('/batches/:id', requireRole('team-lead', 'worker'), routes.createGetBatchHandler(this.deps));
    this.app.post('/batches/:id/dispatch', requireRole('team-lead'), routes.createDispatchBatchHandler(this.deps));

    // Mail routes (require authentication)
    this.app.post('/mail', requireRole('team-lead', 'worker'), routes.createSendMailHandler(this.deps));
    this.app.get('/mail/:handle', requireRole('team-lead', 'worker'), routes.createGetMailHandler(this.deps));
    this.app.get('/mail/:handle/unread', requireRole('team-lead', 'worker'), routes.createGetUnreadMailHandler(this.deps));
    this.app.post('/mail/:id/read', requireRole('team-lead', 'worker'), routes.createMarkMailReadHandler(this.deps));

    // Handoff routes (require authentication)
    this.app.post('/handoffs', requireRole('team-lead', 'worker'), routes.createCreateHandoffHandler(this.deps));
    this.app.get('/handoffs/:handle', requireRole('team-lead', 'worker'), routes.createGetHandoffsHandler(this.deps));

    // Blackboard routes
    this.app.post('/blackboard', requireRole('team-lead'), routes.createBlackboardPostHandler(this.deps));
    this.app.get('/blackboard/:swarmId', requireRole('team-lead', 'worker'), routes.createBlackboardReadHandler(this.deps));
    this.app.post('/blackboard/mark-read', requireRole('team-lead', 'worker'), routes.createBlackboardMarkReadHandler(this.deps));
    this.app.post('/blackboard/archive', requireRole('team-lead'), routes.createBlackboardArchiveHandler(this.deps));
    this.app.post('/blackboard/:swarmId/archive-old', requireRole('team-lead'), routes.createBlackboardArchiveOldHandler(this.deps));

    // Spawn queue routes
    this.app.post('/spawn-queue', requireRole('team-lead'), routes.createSpawnEnqueueHandler(this.deps));
    this.app.get('/spawn-queue/status', requireRole('team-lead', 'worker'), routes.createSpawnStatusHandler(this.deps));
    this.app.get('/spawn-queue/:id', requireRole('team-lead', 'worker'), routes.createSpawnGetHandler(this.deps));
    this.app.delete('/spawn-queue/:id', requireRole('team-lead'), routes.createSpawnCancelHandler(this.deps));

    // Checkpoint routes (require authentication)
    this.app.post('/checkpoints', requireRole('team-lead', 'worker'), routes.createCheckpointCreateHandler(this.deps));
    this.app.get('/checkpoints/:id', requireRole('team-lead', 'worker'), routes.createCheckpointLoadHandler(this.deps));
    this.app.get('/checkpoints/latest/:handle', requireRole('team-lead', 'worker'), routes.createCheckpointLatestHandler(this.deps));
    this.app.get('/checkpoints/list/:handle', requireRole('team-lead', 'worker'), routes.createCheckpointListHandler(this.deps));
    this.app.post('/checkpoints/:id/accept', requireRole('team-lead', 'worker'), routes.createCheckpointAcceptHandler(this.deps));
    this.app.post('/checkpoints/:id/reject', requireRole('team-lead', 'worker'), routes.createCheckpointRejectHandler(this.deps));

    // Swarm routes (require authentication for list/get)
    this.app.post('/swarms', requireRole('team-lead'), routes.createSwarmCreateHandler(this.deps));
    this.app.get('/swarms', requireRole('team-lead', 'worker'), routes.createSwarmListHandler(this.deps));
    this.app.get('/swarms/:id', requireRole('team-lead', 'worker'), routes.createSwarmGetHandler(this.deps));
    this.app.post('/swarms/:id/kill', requireRole('team-lead'), routes.createSwarmKillHandler(this.deps));

    // Template routes (swarm templates)
    this.app.post('/templates', requireRole('team-lead'), routes.createCreateTemplateHandler(this.deps));
    this.app.get('/templates', requireRole('team-lead', 'worker'), routes.createListTemplatesHandler(this.deps));
    this.app.get('/templates/:id', requireRole('team-lead', 'worker'), routes.createGetTemplateHandler(this.deps));
    this.app.patch('/templates/:id', requireRole('team-lead'), routes.createUpdateTemplateHandler(this.deps));
    this.app.delete('/templates/:id', requireRole('team-lead'), routes.createDeleteTemplateHandler(this.deps));
    this.app.post('/templates/:id/run', requireRole('team-lead'), routes.createRunTemplateHandler(this.deps));

    // TLDR routes (token-efficient code analysis)
    // Use POST with body for file paths to avoid URL encoding issues
    this.app.post('/tldr/summary/get', requireRole('team-lead', 'worker'), routes.createGetFileSummaryHandler(this.deps));
    this.app.post('/tldr/summary/check', requireRole('team-lead', 'worker'), routes.createCheckSummaryHandler(this.deps));
    this.app.post('/tldr/summary/store', requireRole('team-lead', 'worker'), routes.createStoreFileSummaryHandler(this.deps));
    this.app.post('/tldr/summary/batch', requireRole('team-lead', 'worker'), routes.createGetMultipleSummariesHandler(this.deps));
    this.app.post('/tldr/codebase/get', requireRole('team-lead', 'worker'), routes.createGetCodebaseOverviewHandler(this.deps));
    this.app.post('/tldr/codebase/store', requireRole('team-lead', 'worker'), routes.createStoreCodebaseOverviewHandler(this.deps));
    this.app.post('/tldr/dependency/store', requireRole('team-lead', 'worker'), routes.createStoreDependencyHandler(this.deps));
    this.app.post('/tldr/dependency/graph', requireRole('team-lead', 'worker'), routes.createGetDependencyGraphHandler(this.deps));
    this.app.post('/tldr/dependency/dependents', requireRole('team-lead', 'worker'), routes.createGetDependentsHandler(this.deps));
    this.app.post('/tldr/dependency/dependencies', requireRole('team-lead', 'worker'), routes.createGetDependenciesHandler(this.deps));
    this.app.post('/tldr/invalidate', requireRole('team-lead'), routes.createInvalidateFileHandler(this.deps));
    this.app.get('/tldr/stats', requireRole('team-lead', 'worker'), routes.createGetTLDRStatsHandler(this.deps));
    this.app.delete('/tldr/cache', requireRole('team-lead'), routes.createClearTLDRCacheHandler(this.deps));

    // Workflow routes
    this.app.post('/workflows', requireRole('team-lead'), routes.createCreateWorkflowHandler(this.deps));
    this.app.get('/workflows', requireRole('team-lead', 'worker'), routes.createListWorkflowsHandler(this.deps));
    this.app.get('/workflows/:id', requireRole('team-lead', 'worker'), routes.createGetWorkflowHandler(this.deps));
    this.app.patch('/workflows/:id', requireRole('team-lead'), routes.createUpdateWorkflowHandler(this.deps));
    this.app.delete('/workflows/:id', requireRole('team-lead'), routes.createDeleteWorkflowHandler(this.deps));
    this.app.post('/workflows/:id/start', requireRole('team-lead'), routes.createStartWorkflowHandler(this.deps));
    this.app.post('/workflows/:id/triggers', requireRole('team-lead'), routes.createCreateTriggerHandler(this.deps));
    this.app.get('/workflows/:id/triggers', requireRole('team-lead', 'worker'), routes.createListTriggersHandler(this.deps));

    // Workflow execution routes
    this.app.get('/executions', requireRole('team-lead', 'worker'), routes.createListExecutionsHandler(this.deps));
    this.app.get('/executions/:id', requireRole('team-lead', 'worker'), routes.createGetExecutionHandler(this.deps));
    this.app.post('/executions/:id/pause', requireRole('team-lead'), routes.createPauseExecutionHandler(this.deps));
    this.app.post('/executions/:id/resume', requireRole('team-lead'), routes.createResumeExecutionHandler(this.deps));
    this.app.post('/executions/:id/cancel', requireRole('team-lead'), routes.createCancelExecutionHandler(this.deps));
    this.app.get('/executions/:id/steps', requireRole('team-lead', 'worker'), routes.createGetExecutionStepsHandler(this.deps));
    this.app.get('/executions/:id/events', requireRole('team-lead', 'worker'), routes.createGetExecutionEventsHandler(this.deps));

    // Workflow step routes
    this.app.post('/steps/:id/retry', requireRole('team-lead'), routes.createRetryStepHandler(this.deps));
    this.app.post('/steps/:id/complete', requireRole('team-lead', 'worker'), routes.createCompleteStepHandler(this.deps));

    // Workflow trigger routes
    this.app.delete('/triggers/:id', requireRole('team-lead'), routes.createDeleteTriggerHandler(this.deps));

    // Audit routes (codebase health checks)
    this.app.get('/audit/status', routes.createAuditStatusHandler(this.deps));
    this.app.get('/audit/output', routes.createAuditOutputHandler(this.deps));
    this.app.post('/audit/start', requireRole('team-lead'), routes.createAuditStartHandler(this.deps));
    this.app.post('/audit/stop', requireRole('team-lead'), routes.createAuditStopHandler(this.deps));
    this.app.post('/audit/quick', requireRole('team-lead'), routes.createQuickAuditHandler(this.deps));

    // Autonomous Operations routes (webhooks, scheduler, templates)
    this.app.use('/webhooks', webhooksRouter);
    this.app.use('/scheduler', schedulerRouter);

    // Swarm Intelligence routes (stigmergic coordination, beliefs, credits, consensus, bidding)
    // Pheromone trails
    this.app.post('/pheromones', requireRole('team-lead', 'worker'), routes.createDepositPheromoneHandler(this.deps));
    this.app.get('/pheromones/:swarmId', requireRole('team-lead', 'worker'), routes.createQueryPheromonesHandler(this.deps));
    this.app.get('/pheromones/:swarmId/resource/:resourceId', requireRole('team-lead', 'worker'), routes.createGetResourceTrailsHandler(this.deps));
    this.app.get('/pheromones/:swarmId/activity', requireRole('team-lead', 'worker'), routes.createGetResourceActivityHandler(this.deps));
    this.app.post('/pheromones/decay', requireRole('team-lead'), routes.createDecayPheromonesHandler(this.deps));
    this.app.get('/pheromones/:swarmId/stats', requireRole('team-lead', 'worker'), routes.createPheromoneStatsHandler(this.deps));

    // Agent beliefs (Theory of Mind)
    // IMPORTANT: Specific routes must come before generic /:swarmId/:handle pattern
    this.app.post('/beliefs', requireRole('team-lead', 'worker'), routes.createUpsertBeliefHandler(this.deps));
    this.app.post('/beliefs/meta', requireRole('team-lead', 'worker'), routes.createUpsertMetaBeliefHandler(this.deps));
    this.app.get('/beliefs/:swarmId/stats', requireRole('team-lead', 'worker'), routes.createBeliefStatsHandler(this.deps));
    this.app.get('/beliefs/:swarmId/consensus/:subject', requireRole('team-lead', 'worker'), routes.createGetSwarmConsensusHandler(this.deps));
    this.app.get('/beliefs/:swarmId/:handle', requireRole('team-lead', 'worker'), routes.createGetBeliefsHandler(this.deps));

    // Credits & reputation
    // IMPORTANT: Specific routes (stats, leaderboard) must come before generic /:handle pattern
    this.app.post('/credits/transfer', requireRole('team-lead', 'worker'), routes.createTransferCreditsHandler(this.deps));
    this.app.post('/credits/transaction', requireRole('team-lead'), routes.createRecordTransactionHandler(this.deps));
    this.app.post('/credits/reputation', requireRole('team-lead'), routes.createUpdateReputationHandler(this.deps));
    this.app.get('/credits/:swarmId/stats', requireRole('team-lead', 'worker'), routes.createCreditStatsHandler(this.deps));
    this.app.get('/credits/:swarmId/leaderboard', requireRole('team-lead', 'worker'), routes.createGetLeaderboardHandler(this.deps));
    this.app.get('/credits/:swarmId/:handle/history', requireRole('team-lead', 'worker'), routes.createGetCreditHistoryHandler(this.deps));
    this.app.get('/credits/:swarmId/:handle', requireRole('team-lead', 'worker'), routes.createGetCreditsHandler(this.deps));

    // Consensus voting
    this.app.post('/consensus/proposals', requireRole('team-lead', 'worker'), routes.createCreateProposalHandler(this.deps));
    this.app.get('/consensus/:swarmId/proposals', requireRole('team-lead', 'worker'), routes.createListProposalsHandler(this.deps));
    this.app.get('/consensus/proposals/:id', requireRole('team-lead', 'worker'), routes.createGetProposalHandler(this.deps));
    this.app.post('/consensus/proposals/:id/vote', requireRole('team-lead', 'worker'), routes.createCastVoteHandler(this.deps));
    this.app.post('/consensus/proposals/:id/close', requireRole('team-lead'), routes.createCloseProposalHandler(this.deps));
    this.app.get('/consensus/:swarmId/stats', requireRole('team-lead', 'worker'), routes.createConsensusStatsHandler(this.deps));

    // Task bidding
    // IMPORTANT: Specific routes (task/:taskId/*, stats) must come before generic /:id pattern
    this.app.post('/bids', requireRole('team-lead', 'worker'), routes.createSubmitBidHandler(this.deps));
    this.app.get('/bids/task/:taskId', requireRole('team-lead', 'worker'), routes.createGetTaskBidsHandler(this.deps));
    this.app.post('/bids/task/:taskId/evaluate', requireRole('team-lead'), routes.createEvaluateBidsHandler(this.deps));
    this.app.post('/bids/task/:taskId/auction', requireRole('team-lead'), routes.createRunAuctionHandler(this.deps));
    this.app.get('/bids/:swarmId/stats', requireRole('team-lead', 'worker'), routes.createBiddingStatsHandler(this.deps));
    this.app.get('/bids/:id', requireRole('team-lead', 'worker'), routes.createGetBidHandler(this.deps));
    this.app.post('/bids/:id/accept', requireRole('team-lead'), routes.createAcceptBidHandler(this.deps));
    this.app.delete('/bids/:id', requireRole('team-lead', 'worker'), routes.createWithdrawBidHandler(this.deps));

    // Game-theoretic payoffs
    this.app.post('/payoffs', requireRole('team-lead'), routes.createDefinePayoffHandler(this.deps));
    this.app.get('/payoffs/:taskId', requireRole('team-lead', 'worker'), routes.createGetPayoffsHandler(this.deps));
    this.app.get('/payoffs/:taskId/calculate', requireRole('team-lead', 'worker'), routes.createCalculatePayoffHandler(this.deps));

    // Compound Machine routes (aggregated fleet visualization)
    this.app.get('/compound/snapshot', requireRole('team-lead', 'worker'), routes.createCompoundSnapshotHandler(this.deps));
  }

  // ============================================================================
  // WEBSOCKET
  // ============================================================================

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, _req) => {
      console.log('[WS] New connection');
      const extWs = ws as ExtendedWebSocket;
      extWs.isAlive = true;
      extWs.subscribedChats = new Set();
      extWs.authenticated = false;

      extWs.on('pong', () => {
        extWs.isAlive = true;
      });

      extWs.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as WebSocketMessage & { token?: string };

          // Handle authentication
          if (msg.type === 'auth' && msg.token) {
            try {
              const decoded = jwt.verify(msg.token, this.config.jwtSecret) as { uid: string; handle: string };
              extWs.authenticated = true;
              extWs.uid = decoded.uid;
              extWs.send(JSON.stringify({ type: 'authenticated', uid: decoded.uid }));
              console.log(`[WS] Authenticated: ${decoded.handle}`);
            } catch {
              extWs.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
            }
            return;
          }

          // Require authentication for subscriptions
          if (msg.type === 'subscribe' && msg.chatId) {
            if (!extWs.authenticated) {
              extWs.send(JSON.stringify({ type: 'error', message: 'Authentication required. Send { type: "auth", token: "..." } first.' }));
              return;
            }
            extWs.subscribedChats.add(msg.chatId);
            extWs.uid = msg.uid;
            if (!this.subscriptions.has(msg.chatId)) {
              this.subscriptions.set(msg.chatId, new Set());
            }
            this.subscriptions.get(msg.chatId)!.add(extWs);
            console.log(`[WS] Subscribed to ${msg.chatId}`);
            extWs.send(JSON.stringify({ type: 'subscribed', chatId: msg.chatId }));
          } else if (msg.type === 'unsubscribe' && msg.chatId) {
            extWs.subscribedChats.delete(msg.chatId);
            this.subscriptions.get(msg.chatId)?.delete(extWs);
          } else if (msg.type === 'ping') {
            extWs.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (e) {
          console.error('[WS] Error:', (e as Error).message);
        }
      });

      extWs.on('close', () => {
        extWs.subscribedChats.forEach(chatId => {
          this.subscriptions.get(chatId)?.delete(extWs);
        });
        console.log('[WS] Connection closed');
      });
    });

    // Heartbeat interval
    setInterval(() => {
      this.wss.clients.forEach(ws => {
        const extWs = ws as ExtendedWebSocket;
        if (!extWs.isAlive) {
          extWs.subscribedChats?.forEach(chatId => {
            this.subscriptions.get(chatId)?.delete(extWs);
          });
          return extWs.terminate();
        }
        extWs.isAlive = false;
        extWs.ping();
      });
    }, 30000);
  }

  private broadcastToChat(chatId: string, message: unknown): void {
    const subs = this.subscriptions.get(chatId);
    if (!subs) return;
    const payload = JSON.stringify(message);
    subs.forEach(ws => {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    });
  }

  private broadcastToAll(message: unknown): void {
    const payload = JSON.stringify(message);
    this.wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    });
  }

  // ============================================================================
  // WORKER EVENTS
  // ============================================================================

  private setupWorkerEvents(): void {
    this.workerManager.on('worker:output', ({ handle, event }) => {
      this.broadcastToAll({ type: 'worker_output', handle, output: JSON.stringify(event) });
    });

    this.workerManager.on('worker:exit', ({ handle }) => {
      this.broadcastToAll({ type: 'worker_dismissed', handle });
    });
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  private setupCleanup(): void {
    // Cleanup rate limits every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [ip, limit] of this.rateLimits) {
        if (now - limit.windowStart > this.config.rateLimitWindow * 2) {
          this.rateLimits.delete(ip);
        }
      }
    }, 300000);

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      this.workerManager.dismissAll().then(() => {
        this.storage.close();
        process.exit(0);
      });
    });
  }

  // ============================================================================
  // START / STOP
  // ============================================================================

  async start(): Promise<void> {
    // Initialize storage, managers, routes if not already done
    await this.initialize();

    // Initialize worker manager (restores workers from DB)
    await this.workerManager.initialize();

    // Start workflow engine processing
    this.workflowEngine.start();

    // Start autonomous scheduler (cron jobs and task queue)
    const scheduler = AutoScheduler.getInstance();
    scheduler.start();

    // Configure task executor with WorkerManager
    const executor = TaskExecutor.getInstance();
    executor.configure({
      workerManager: this.workerManager,
      defaultWorkingDir: process.cwd()
    });

    // Connect scheduler to executor
    scheduler.on('executeTask', async (task) => {
      try {
        await executor.execute(task);
      } catch (error) {
        console.error('[SERVER] Task execution error:', error);
      }
    });

    // Load configuration from file (if exists)
    loadDefaultConfig();

    console.log('[SERVER] Autonomous scheduler started');

    this.server.listen(this.config.port, () => {
      const storageInfo = this.config.storageBackend === 'sqlite'
        ? `SQLite: ${this.config.dbPath}`
        : `${this.config.storageBackend?.toUpperCase() ?? 'SQLite'}`;
      console.log('\n' +
        '==============================================================\n' +
        '         Claude Fleet Server v2.0\n' +
        '       Multi-Agent Fleet Coordination\n' +
        '==============================================================\n' +
        `  HTTP API:    http://localhost:${this.config.port}\n` +
        `  WebSocket:   ws://localhost:${this.config.port}/ws\n` +
        `  Storage:     ${storageInfo}\n` +
        `  Max Workers: ${this.config.maxWorkers}\n` +
        '==============================================================\n' +
        '  Usage:\n' +
        '    export CLAUDE_FLEET_TEAM="my-team"\n' +
        `    export CLAUDE_FLEET_URL="http://localhost:${this.config.port}"\n` +
        '==============================================================\n'
      );
    });
  }

  async stop(): Promise<void> {
    console.log('[SERVER] Stopping...');
    this.workflowEngine.stop();
    AutoScheduler.getInstance().stop();
    await this.workerManager.dismissAll();
    this.wss.close();
    this.server.close();
    this.storage.close();
    console.log('[SERVER] Stopped');
  }
}
