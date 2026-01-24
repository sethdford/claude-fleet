/**
 * Claude Code Collab Server v2.0 (TypeScript)
 *
 * Main server with Express HTTP API, WebSocket real-time updates,
 * and worker orchestration for spawning Claude Code instances.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { WebSocketServer, type WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { SQLiteStorage } from './storage/sqlite.js';
import { WorkerManager } from './workers/manager.js';
import { WorkItemStorage } from './storage/workitems.js';
import { MailStorage } from './storage/mail.js';
import { BlackboardStorage } from './storage/blackboard.js';
import { SpawnQueueStorage } from './storage/spawn-queue.js';
import { CheckpointStorage } from './storage/checkpoint.js';
import { SpawnController } from './workers/spawn-controller.js';
import { createAuthMiddleware, requireRole, type AuthenticatedRequest } from './middleware/auth.js';
import {
  validateBody,
  agentRegistrationSchema,
  createTaskSchema,
  updateTaskSchema,
  createChatSchema,
  sendMessageSchema,
  broadcastSchema,
  markReadSchema,
  spawnWorkerSchema,
  sendToWorkerSchema,
  worktreeCommitSchema,
  worktreePRSchema,
  createWorkItemSchema,
  updateWorkItemSchema,
  createBatchSchema,
  dispatchBatchSchema,
  sendMailSchema,
  createHandoffSchema,
  // Fleet coordination schemas
  blackboardPostSchema,
  blackboardMarkReadSchema,
  blackboardArchiveSchema,
  blackboardArchiveOldSchema,
  spawnEnqueueSchema,
  checkpointCreateSchema,
  swarmCreateSchema,
  swarmKillSchema,
} from './validation/schemas.js';
import {
  metricsMiddleware,
  metricsHandler,
  updateGauges,
  agentAuthentications,
  tasksCreated,
  tasksCompleted,
  messagesSent,
  broadcastsSent,
  workerSpawns,
  workerDismissals,
} from './metrics/prometheus.js';
import type {
  ServerConfig,
  ServerMetrics,
  TeamAgent,
  TeamTask,
  Chat,
  Message,
  ExtendedWebSocket,
  WebSocketMessage,
  HealthResponse,
  ErrorResponse,
  AuthResponse,
  TaskStatus,
  WorkerState,
  WorkItemStatus,
  CreateWorkItemOptions,
  CreateBatchOptions,
  SendMailOptions,
  BlackboardMessageType,
  MessagePriority,
} from './types.js';
import type { FleetAgentRole } from './workers/agent-roles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

export function getConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT ?? '3847', 10),
    dbPath: process.env.DB_PATH ?? path.join(__dirname, '..', 'collab.db'),
    jwtSecret: process.env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
    maxWorkers: parseInt(process.env.MAX_WORKERS ?? '5', 10),
    rateLimitWindow: 60000, // 1 minute
    rateLimitMax: 100, // 100 requests per minute per IP
  };
}

// Validation helpers moved to src/validation/schemas.ts (using Zod)

// ============================================================================
// HASH HELPERS
// ============================================================================

function generateChatId(uid1: string, uid2: string): string {
  const sorted = [uid1, uid2].sort();
  return crypto.createHash('sha256').update(sorted.join(':')).digest('hex').slice(0, 16);
}

function generateTeamChatId(teamName: string): string {
  return crypto.createHash('sha256').update('team:' + teamName).digest('hex').slice(0, 16);
}

function generateUid(teamName: string, handle: string): string {
  return crypto.createHash('sha256').update(teamName + ':' + handle).digest('hex').slice(0, 24);
}

// ============================================================================
// SERVER CLASS
// ============================================================================

export class CollabServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private storage: SQLiteStorage;
  private workItemStorage: WorkItemStorage;
  private mailStorage: MailStorage;
  private blackboardStorage: BlackboardStorage;
  private spawnQueueStorage: SpawnQueueStorage;
  private checkpointStorage: CheckpointStorage;
  private spawnController: SpawnController;
  private workerManager: WorkerManager;
  private config: ServerConfig;
  private subscriptions = new Map<string, Set<ExtendedWebSocket>>();
  private rateLimits = new Map<string, { count: number; windowStart: number }>();
  private startTime = Date.now();
  private swarms = new Map<string, { id: string; name: string; description?: string; maxAgents: number; createdAt: number }>();

  constructor(config?: Partial<ServerConfig>) {
    this.config = { ...getConfig(), ...config };
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.storage = new SQLiteStorage(this.config.dbPath);
    this.workItemStorage = new WorkItemStorage(this.storage);
    this.mailStorage = new MailStorage(this.storage);
    this.blackboardStorage = new BlackboardStorage(this.storage);
    this.spawnQueueStorage = new SpawnQueueStorage(this.storage);
    this.checkpointStorage = new CheckpointStorage(this.storage);
    this.spawnController = new SpawnController({
      softLimit: 50,
      hardLimit: 100,
      maxDepth: 3,
      autoProcess: true,
    });
    this.workerManager = new WorkerManager({
      maxWorkers: this.config.maxWorkers,
      serverUrl: `http://localhost:${this.config.port}`,
      storage: this.storage,
      injectMail: true,
      useWorktrees: true,
    });

    // Connect SpawnController to WorkerManager
    this.spawnController.initialize(this.spawnQueueStorage, this.workerManager);
    this.workerManager.setSpawnController(this.spawnController);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupWorkerEvents();
    this.setupCleanup();
  }

  // ============================================================================
  // MIDDLEWARE
  // ============================================================================

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: '1mb' })); // Limit body size
    this.app.use(metricsMiddleware); // Prometheus metrics
    this.app.use(this.rateLimitMiddleware.bind(this));

    // JWT authentication for protected routes
    this.app.use(createAuthMiddleware(this.config.jwtSecret));

    // Serve static files (dashboard)
    this.app.use(express.static(path.join(__dirname, '..', 'public')));
  }

  private rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
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
    // Health check
    this.app.get('/health', this.handleHealth.bind(this));

    // Metrics endpoints
    this.app.get('/metrics', metricsHandler); // Prometheus format
    this.app.get('/metrics/json', this.handleMetrics.bind(this)); // JSON format

    // Authentication
    this.app.post('/auth', this.handleAuth.bind(this));

    // Users
    this.app.get('/users/:uid', this.handleGetUser.bind(this));
    this.app.get('/users/:uid/chats', this.handleGetUserChats.bind(this));

    // Teams - broadcast requires team-lead role
    this.app.get('/teams/:teamName/agents', this.handleGetTeamAgents.bind(this));
    this.app.post('/teams/:teamName/broadcast', requireRole('team-lead'), this.handleBroadcast.bind(this));
    this.app.get('/teams/:teamName/tasks', this.handleGetTeamTasks.bind(this));

    // Chats
    this.app.post('/chats', this.handleCreateChat.bind(this));
    this.app.get('/chats/:chatId/messages', this.handleGetMessages.bind(this));
    this.app.post('/chats/:chatId/messages', this.handleSendMessage.bind(this));
    this.app.post('/chats/:chatId/read', this.handleMarkRead.bind(this));

    // Tasks
    this.app.post('/tasks', this.handleCreateTask.bind(this));
    this.app.get('/tasks/:taskId', this.handleGetTask.bind(this));
    this.app.patch('/tasks/:taskId', this.handleUpdateTask.bind(this));

    // Orchestration (NEW) - spawn/dismiss require team-lead role
    this.app.post('/orchestrate/spawn', requireRole('team-lead'), this.handleSpawnWorker.bind(this));
    this.app.post('/orchestrate/dismiss/:handle', requireRole('team-lead'), this.handleDismissWorker.bind(this));
    this.app.post('/orchestrate/send/:handle', this.handleSendToWorker.bind(this));
    this.app.get('/orchestrate/workers', this.handleGetWorkers.bind(this));
    this.app.get('/orchestrate/output/:handle', this.handleGetWorkerOutput.bind(this));

    // Worktree operations (Phase 1) - push/pr require team-lead role
    this.app.post('/orchestrate/worktree/:handle/commit', this.handleWorktreeCommit.bind(this));
    this.app.post('/orchestrate/worktree/:handle/push', requireRole('team-lead'), this.handleWorktreePush.bind(this));
    this.app.post('/orchestrate/worktree/:handle/pr', requireRole('team-lead'), this.handleWorktreePR.bind(this));
    this.app.get('/orchestrate/worktree/:handle/status', this.handleWorktreeStatus.bind(this));

    // Work Items (Phase 2)
    this.app.post('/workitems', this.handleCreateWorkItem.bind(this));
    this.app.get('/workitems', this.handleListWorkItems.bind(this));
    this.app.get('/workitems/:id', this.handleGetWorkItem.bind(this));
    this.app.patch('/workitems/:id', this.handleUpdateWorkItem.bind(this));

    // Batches (Phase 2) - dispatch requires team-lead role (assign permission)
    this.app.post('/batches', this.handleCreateBatch.bind(this));
    this.app.get('/batches', this.handleListBatches.bind(this));
    this.app.get('/batches/:id', this.handleGetBatch.bind(this));
    this.app.post('/batches/:id/dispatch', requireRole('team-lead'), this.handleDispatchBatch.bind(this));

    // Mail (Phase 3)
    this.app.post('/mail', this.handleSendMail.bind(this));
    this.app.get('/mail/:handle', this.handleGetMail.bind(this));
    this.app.get('/mail/:handle/unread', this.handleGetUnreadMail.bind(this));
    this.app.post('/mail/:id/read', this.handleMarkMailRead.bind(this));

    // Handoffs (Phase 3)
    this.app.post('/handoffs', this.handleCreateHandoff.bind(this));
    this.app.get('/handoffs/:handle', this.handleGetHandoffs.bind(this));

    // ============================================================================
    // Fleet Coordination Routes (Phase 4)
    // ============================================================================

    // Blackboard messaging - all ops require authentication (both roles allowed for read ops)
    this.app.post('/blackboard', requireRole('team-lead'), this.handleBlackboardPost.bind(this));
    this.app.get('/blackboard/:swarmId', requireRole('team-lead', 'worker'), this.handleBlackboardRead.bind(this));
    this.app.post('/blackboard/mark-read', requireRole('team-lead', 'worker'), this.handleBlackboardMarkRead.bind(this));
    this.app.post('/blackboard/archive', requireRole('team-lead'), this.handleBlackboardArchive.bind(this));
    this.app.post('/blackboard/:swarmId/archive-old', requireRole('team-lead'), this.handleBlackboardArchiveOld.bind(this));

    // Spawn queue - spawning requires team-lead, status requires auth (both roles)
    this.app.post('/spawn-queue', requireRole('team-lead'), this.handleSpawnEnqueue.bind(this));
    this.app.get('/spawn-queue/status', requireRole('team-lead', 'worker'), this.handleSpawnStatus.bind(this));
    this.app.get('/spawn-queue/:id', requireRole('team-lead', 'worker'), this.handleSpawnGet.bind(this));
    this.app.delete('/spawn-queue/:id', requireRole('team-lead'), this.handleSpawnCancel.bind(this));

    // Checkpoints
    this.app.post('/checkpoints', this.handleCheckpointCreate.bind(this));
    this.app.get('/checkpoints/:id', this.handleCheckpointLoad.bind(this));
    this.app.get('/checkpoints/latest/:handle', this.handleCheckpointLatest.bind(this));
    this.app.get('/checkpoints/list/:handle', this.handleCheckpointList.bind(this));
    this.app.post('/checkpoints/:id/accept', this.handleCheckpointAccept.bind(this));
    this.app.post('/checkpoints/:id/reject', this.handleCheckpointReject.bind(this));

    // Swarm management
    this.app.post('/swarms', requireRole('team-lead'), this.handleSwarmCreate.bind(this));
    this.app.get('/swarms', this.handleSwarmList.bind(this));
    this.app.get('/swarms/:id', this.handleSwarmGet.bind(this));
    this.app.post('/swarms/:id/kill', requireRole('team-lead'), this.handleSwarmKill.bind(this));

    // Debug
    this.app.get('/debug', this.handleDebug.bind(this));
  }

  // ============================================================================
  // ROUTE HANDLERS
  // ============================================================================

  private handleHealth(_req: Request, res: Response): void {
    const debug = this.storage.getDebugInfo();
    const response: HealthResponse = {
      status: 'ok',
      version: '2.0.0',
      persistence: 'sqlite',
      dbPath: this.config.dbPath,
      agents: debug.users.length,
      chats: debug.chats.length,
      messages: debug.messageCount,
      workers: this.workerManager.getWorkerCount(),
    };
    res.json(response);
  }

  private handleMetrics(_req: Request, res: Response): void {
    const debug = this.storage.getDebugInfo();
    const healthStats = this.workerManager.getHealthStats();
    const restartStats = this.workerManager.getRestartStats();
    const workers = this.workerManager.getWorkers();

    // Count workers by state
    const byState: Record<WorkerState, number> = {
      starting: 0,
      ready: 0,
      working: 0,
      stopping: 0,
      stopped: 0,
    };
    for (const worker of workers) {
      byState[worker.state]++;
    }

    // Count tasks by status
    const byStatus: Record<TaskStatus, number> = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      blocked: 0,
    };
    for (const task of debug.tasks) {
      byStatus[task.status]++;
    }

    const metrics: ServerMetrics = {
      uptime: Date.now() - this.startTime,
      workers: {
        total: healthStats.total,
        healthy: healthStats.healthy,
        degraded: healthStats.degraded,
        unhealthy: healthStats.unhealthy,
        byState,
      },
      tasks: {
        total: debug.tasks.length,
        byStatus,
      },
      agents: debug.users.length,
      chats: debug.chats.length,
      messages: debug.messageCount,
      restarts: restartStats,
    };

    res.json(metrics);
  }

  private handleAuth(req: Request, res: Response): void {
    // Validate request body with Zod schema
    const validation = validateBody(agentRegistrationSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { handle, teamName, agentType } = validation.data;
    const uid = generateUid(teamName, handle);
    const now = new Date().toISOString();
    const agent: TeamAgent = {
      uid,
      handle,
      teamName,
      agentType: agentType ?? 'worker',
      createdAt: now,
      lastSeen: now,
    };

    this.storage.insertUser(agent);

    const token = jwt.sign(
      { uid, handle, teamName, agentType: agent.agentType },
      this.config.jwtSecret,
      { expiresIn: this.config.jwtExpiresIn } as jwt.SignOptions
    );

    console.log(`[AUTH] ${handle} (${agent.agentType}) joined team "${teamName}"`);

    agentAuthentications.inc(); // Prometheus metric

    const response: AuthResponse = {
      uid,
      handle,
      teamName,
      agentType: agent.agentType,
      token,
    };
    res.json(response);
  }

  private handleGetUser(req: Request, res: Response): void {
    const user = this.storage.getUser(req.params.uid);
    if (!user) {
      res.status(404).json({ error: 'User not found' } as ErrorResponse);
      return;
    }
    res.json(user);
  }

  private handleGetUserChats(req: Request, res: Response): void {
    const { uid } = req.params;
    const chats = this.storage.getChatsByUser(uid);
    const result = chats.map(chat => {
      const unread = this.storage.getUnread(chat.id, uid);
      const messages = this.storage.getMessages(chat.id, 1);
      const lastMessage = messages[messages.length - 1];
      return {
        id: chat.id,
        participants: chat.participants,
        unread,
        lastMessage,
        updatedAt: chat.updatedAt,
      };
    });
    res.json(result);
  }

  private handleGetTeamAgents(req: Request, res: Response): void {
    res.json(this.storage.getUsersByTeam(req.params.teamName));
  }

  private handleBroadcast(req: Request, res: Response): void {
    const { teamName } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(broadcastSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { from, text, metadata } = validation.data;
    const fromUser = this.storage.getUser(from);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const teamChatId = generateTeamChatId(teamName);
    const agents = this.storage.getUsersByTeam(teamName);
    const participants = agents.map(a => a.uid);

    let chat = this.storage.getChat(teamChatId);
    if (!chat) {
      const now = new Date().toISOString();
      chat = {
        id: teamChatId,
        participants,
        isTeamChat: true,
        teamName,
        createdAt: now,
        updatedAt: now,
      };
      this.storage.insertChat(chat);
      participants.forEach(uid => this.storage.setUnread(teamChatId, uid, 0));
    }

    const messageId = uuidv4();
    const now = new Date().toISOString();
    const message: Message = {
      id: messageId,
      chatId: teamChatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid: from,
      text,
      timestamp: now,
      status: 'pending',
      metadata: { ...metadata, isBroadcast: true },
    };

    this.storage.insertMessage(message);
    this.storage.updateChatTime(teamChatId, now);
    participants.forEach(uid => {
      if (uid !== from) this.storage.incrementUnread(teamChatId, uid);
    });

    broadcastsSent.inc(); // Prometheus metric
    console.log(`[BROADCAST] ${fromUser.handle} -> ${teamName}: ${text.slice(0, 50)}...`);
    this.broadcastToChat(teamChatId, { type: 'broadcast', message, handle: fromUser.handle });
    res.json(message);
  }

  private handleGetTeamTasks(req: Request, res: Response): void {
    const tasks = this.storage.getTasksByTeam(req.params.teamName);
    res.json(tasks);
  }

  private handleCreateChat(req: Request, res: Response): void {
    // Validate request body with Zod schema (includes uid1 !== uid2 check)
    const validation = validateBody(createChatSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { uid1, uid2 } = validation.data;

    const user1 = this.storage.getUser(uid1);
    const user2 = this.storage.getUser(uid2);
    if (!user1) {
      res.status(404).json({ error: 'User uid1 not found' } as ErrorResponse);
      return;
    }
    if (!user2) {
      res.status(404).json({ error: 'User uid2 not found' } as ErrorResponse);
      return;
    }

    const chatId = generateChatId(uid1, uid2);
    const existing = this.storage.getChat(chatId);
    if (!existing) {
      const now = new Date().toISOString();
      const chat: Chat = {
        id: chatId,
        participants: [uid1, uid2],
        isTeamChat: false,
        teamName: null,
        createdAt: now,
        updatedAt: now,
      };
      this.storage.insertChat(chat);
      this.storage.setUnread(chatId, uid1, 0);
      this.storage.setUnread(chatId, uid2, 0);
      console.log(`[CHAT] Created ${chatId}`);
    }
    res.json({ chatId });
  }

  private handleGetMessages(req: Request, res: Response): void {
    const { chatId } = req.params;
    const { limit = '50', after } = req.query;

    const chat = this.storage.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    let messages: Message[];
    if (after && typeof after === 'string') {
      const afterMessages = this.storage.getMessages(chatId, 1);
      const afterMsg = afterMessages.find(m => m.id === after);
      messages = afterMsg
        ? this.storage.getMessagesAfter(chatId, afterMsg.timestamp, parseInt(limit as string, 10))
        : this.storage.getMessages(chatId, parseInt(limit as string, 10));
    } else {
      messages = this.storage.getMessages(chatId, parseInt(limit as string, 10));
    }

    res.json(messages);
  }

  private handleSendMessage(req: Request, res: Response): void {
    const { chatId } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(sendMessageSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { from, text, metadata } = validation.data;

    const chat = this.storage.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    const fromUser = this.storage.getUser(from);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const messageId = uuidv4();
    const now = new Date().toISOString();
    const message: Message = {
      id: messageId,
      chatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid: from,
      text,
      timestamp: now,
      status: 'pending',
      metadata: metadata ?? {},
    };

    this.storage.insertMessage(message);
    this.storage.updateChatTime(chatId, now);
    chat.participants.forEach(uid => {
      if (uid !== from) this.storage.incrementUnread(chatId, uid);
    });

    messagesSent.inc(); // Prometheus metric
    console.log(`[MSG] ${fromUser.handle}: ${text.slice(0, 50)}...`);
    this.broadcastToChat(chatId, { type: 'new_message', message, handle: fromUser.handle });
    res.json(message);
  }

  private handleMarkRead(req: Request, res: Response): void {
    const { chatId } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(markReadSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { uid } = validation.data;
    const chat = this.storage.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    this.storage.clearUnread(chatId, uid);
    res.json({ success: true });
  }

  private handleCreateTask(req: Request, res: Response): void {
    // Validate request body with Zod schema
    const validation = validateBody(createTaskSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fromUid, toHandle, teamName, subject, description, blockedBy } = validation.data;

    const fromUser = this.storage.getUser(fromUid);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const agents = this.storage.getUsersByTeam(teamName);
    const toUser = agents.find(a => a.handle === toHandle);
    if (!toUser) {
      res.status(404).json({ error: `Agent ${toHandle} not found` } as ErrorResponse);
      return;
    }

    const taskId = uuidv4();
    const now = new Date().toISOString();
    const task: TeamTask = {
      id: taskId,
      teamName,
      subject,
      description: description ?? null,
      ownerHandle: toHandle,
      ownerUid: toUser.uid,
      createdByHandle: fromUser.handle,
      createdByUid: fromUid,
      status: 'open',
      blockedBy: blockedBy ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.storage.insertTask(task);

    // Create chat and send task assignment message
    const chatId = generateChatId(fromUid, toUser.uid);
    let chat = this.storage.getChat(chatId);
    if (!chat) {
      chat = {
        id: chatId,
        participants: [fromUid, toUser.uid],
        isTeamChat: false,
        teamName: null,
        createdAt: now,
        updatedAt: now,
      };
      this.storage.insertChat(chat);
      this.storage.setUnread(chatId, fromUid, 0);
      this.storage.setUnread(chatId, toUser.uid, 0);
    }

    const messageId = uuidv4();
    const message: Message = {
      id: messageId,
      chatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid,
      text: `[TASK] ${subject}\n\n${description ?? ''}`,
      timestamp: now,
      status: 'pending',
      metadata: { taskId, type: 'task_assignment' },
    };
    this.storage.insertMessage(message);
    this.storage.incrementUnread(chatId, toUser.uid);

    tasksCreated.inc(); // Prometheus metric
    console.log(`[TASK] ${fromUser.handle} -> ${toHandle}: ${subject}`);
    this.broadcastToChat(chatId, { type: 'task_assigned', task, handle: fromUser.handle });
    res.json(task);
  }

  private handleGetTask(req: Request, res: Response): void {
    const task = this.storage.getTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' } as ErrorResponse);
      return;
    }
    res.json(task);
  }

  private handleUpdateTask(req: Request, res: Response): void {
    const { taskId } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(updateTaskSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { status } = validation.data;
    const task = this.storage.getTask(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' } as ErrorResponse);
      return;
    }

    // Enforce task dependencies
    if (status === 'resolved' && task.blockedBy.length > 0) {
      const unresolvedBlockers = task.blockedBy.filter(blockerId => {
        const blocker = this.storage.getTask(blockerId);
        return blocker && blocker.status !== 'resolved';
      });
      if (unresolvedBlockers.length > 0) {
        res.status(400).json({
          error: 'Cannot resolve task: blocked by unresolved tasks',
          blockedBy: unresolvedBlockers,
        } as ErrorResponse);
        return;
      }
    }

    const now = new Date().toISOString();
    this.storage.updateTaskStatus(taskId, status as TaskStatus, now);
    if (status === 'resolved') {
      tasksCompleted.inc(); // Prometheus metric
    }
    console.log(`[TASK] ${taskId.slice(0, 8)}... status -> ${status}`);
    res.json({ ...task, status, updatedAt: now });
  }

  // ============================================================================
  // ORCHESTRATION HANDLERS (NEW)
  // ============================================================================

  private async handleSpawnWorker(req: Request, res: Response): Promise<void> {
    // Validate request body with Zod schema
    const validation = validateBody(spawnWorkerSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    try {
      const worker = await this.workerManager.spawnWorker(validation.data);
      workerSpawns.inc(); // Prometheus metric
      this.broadcastToAll({ type: 'worker_spawned', worker });
      res.json(worker);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message } as ErrorResponse);
    }
  }

  private async handleDismissWorker(req: Request, res: Response): Promise<void> {
    const { handle } = req.params;

    const worker = this.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    await this.workerManager.dismissWorkerByHandle(handle);
    workerDismissals.inc(); // Prometheus metric
    this.broadcastToAll({ type: 'worker_dismissed', handle });
    res.json({ success: true, handle });
  }

  private handleSendToWorker(req: Request, res: Response): void {
    const { handle } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(sendToWorkerSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const success = this.workerManager.sendToWorkerByHandle(handle, validation.data.message);
    if (!success) {
      res.status(404).json({ error: `Worker '${handle}' not found or stopped` } as ErrorResponse);
      return;
    }

    res.json({ success: true, handle });
  }

  private handleGetWorkers(_req: Request, res: Response): void {
    const workers = this.workerManager.getWorkers().map(w => ({
      id: w.id,
      handle: w.handle,
      teamName: w.teamName,
      state: w.state,
      workingDir: w.workingDir,
      sessionId: w.sessionId,
      spawnedAt: w.spawnedAt,
      currentTaskId: w.currentTaskId,
    }));
    res.json(workers);
  }

  private handleGetWorkerOutput(req: Request, res: Response): void {
    const { handle } = req.params;

    const worker = this.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    res.json({
      handle,
      state: worker.state,
      output: worker.recentOutput,
    });
  }

  // ============================================================================
  // WORKTREE HANDLERS
  // ============================================================================

  private async handleWorktreeCommit(req: Request, res: Response): Promise<void> {
    const { handle } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(worktreeCommitSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { message } = validation.data;
    const worker = this.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    const worktreeManager = this.workerManager.getWorktreeManager();
    if (!worktreeManager) {
      res.status(400).json({ error: 'Worktrees are not enabled' } as ErrorResponse);
      return;
    }

    try {
      const commitHash = await worktreeManager.commit(worker.id, message);
      res.json({ success: true, commitHash, handle });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message } as ErrorResponse);
    }
  }

  private async handleWorktreePush(req: Request, res: Response): Promise<void> {
    const { handle } = req.params;

    const worker = this.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    const worktreeManager = this.workerManager.getWorktreeManager();
    if (!worktreeManager) {
      res.status(400).json({ error: 'Worktrees are not enabled' } as ErrorResponse);
      return;
    }

    try {
      await worktreeManager.push(worker.id);
      res.json({ success: true, handle });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message } as ErrorResponse);
    }
  }

  private async handleWorktreePR(req: Request, res: Response): Promise<void> {
    const { handle } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(worktreePRSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { title, body, base } = validation.data;
    const worker = this.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    const worktreeManager = this.workerManager.getWorktreeManager();
    if (!worktreeManager) {
      res.status(400).json({ error: 'Worktrees are not enabled' } as ErrorResponse);
      return;
    }

    try {
      const prUrl = await worktreeManager.createPR(worker.id, title, body, base);
      res.json({ success: true, prUrl, handle });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message } as ErrorResponse);
    }
  }

  private async handleWorktreeStatus(req: Request, res: Response): Promise<void> {
    const { handle } = req.params;

    const worker = this.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    const worktreeManager = this.workerManager.getWorktreeManager();
    if (!worktreeManager) {
      res.status(400).json({ error: 'Worktrees are not enabled' } as ErrorResponse);
      return;
    }

    try {
      const status = await worktreeManager.getStatus(worker.id);
      res.json({ ...status, handle });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message } as ErrorResponse);
    }
  }

  // ============================================================================
  // WORK ITEM HANDLERS (Phase 2)
  // ============================================================================

  private handleCreateWorkItem(req: Request, res: Response): void {
    // Validate request body with Zod schema
    const validation = validateBody(createWorkItemSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { title, description, assignedTo, batchId } = validation.data;
    const options: CreateWorkItemOptions = {};
    if (description) options.description = description;
    if (assignedTo) options.assignedTo = assignedTo;
    if (batchId) options.batchId = batchId;

    const workItem = this.workItemStorage.create(title, options);
    console.log(`[WORKITEM] Created ${workItem.id}: ${title}`);
    res.json(workItem);
  }

  private handleListWorkItems(req: Request, res: Response): void {
    const { status, assignee, batch } = req.query as {
      status?: string;
      assignee?: string;
      batch?: string;
    };

    let workItems = this.workItemStorage.getAll();

    if (status) {
      workItems = workItems.filter(w => w.status === status);
    }
    if (assignee) {
      workItems = workItems.filter(w => w.assignedTo === assignee);
    }
    if (batch) {
      workItems = workItems.filter(w => w.batchId === batch);
    }

    res.json(workItems);
  }

  private handleGetWorkItem(req: Request, res: Response): void {
    const { id } = req.params;
    const workItem = this.workItemStorage.get(id);

    if (!workItem) {
      res.status(404).json({ error: 'Work item not found' } as ErrorResponse);
      return;
    }

    res.json(workItem);
  }

  private handleUpdateWorkItem(req: Request, res: Response): void {
    const { id } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(updateWorkItemSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { status, reason, actor } = validation.data;
    let result;
    switch (status as WorkItemStatus) {
      case 'blocked':
        result = this.workItemStorage.block(id, reason ?? 'No reason provided', actor);
        break;
      case 'cancelled':
        result = this.workItemStorage.cancel(id, reason ?? 'No reason provided', actor);
        break;
      case 'completed':
        result = this.workItemStorage.complete(id, actor);
        break;
      default:
        result = this.workItemStorage.updateStatus(id, status as WorkItemStatus, actor);
    }

    if (!result) {
      res.status(404).json({ error: 'Work item not found' } as ErrorResponse);
      return;
    }

    console.log(`[WORKITEM] ${id} -> ${status}`);
    res.json(result);
  }

  // ============================================================================
  // BATCH HANDLERS (Phase 2)
  // ============================================================================

  private handleCreateBatch(req: Request, res: Response): void {
    // Validate request body with Zod schema
    const validation = validateBody(createBatchSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { name, workItemIds } = validation.data;
    const options: CreateBatchOptions = {};
    if (workItemIds) options.workItemIds = workItemIds;

    const batch = this.workItemStorage.createBatch(name, options);
    console.log(`[BATCH] Created ${batch.id}: ${name}`);
    res.json(batch);
  }

  private handleListBatches(_req: Request, res: Response): void {
    const batches = this.workItemStorage.getAllBatches();
    res.json(batches);
  }

  private handleGetBatch(req: Request, res: Response): void {
    const { id } = req.params;
    const batch = this.workItemStorage.getBatch(id);

    if (!batch) {
      res.status(404).json({ error: 'Batch not found' } as ErrorResponse);
      return;
    }

    const workItems = this.workItemStorage.getByBatch(id);
    res.json({ ...batch, workItems });
  }

  private handleDispatchBatch(req: Request, res: Response): void {
    const { id } = req.params;

    // Validate request body with Zod schema
    const validation = validateBody(dispatchBatchSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const result = this.workItemStorage.dispatch(id, validation.data.workerHandle);
    if (!result) {
      res.status(404).json({ error: 'Batch not found' } as ErrorResponse);
      return;
    }

    console.log(`[BATCH] Dispatched ${id} to ${validation.data.workerHandle} (${result.workItems.length} items)`);
    res.json(result);
  }

  // ============================================================================
  // MAIL HANDLERS (Phase 3)
  // ============================================================================

  private handleSendMail(req: Request, res: Response): void {
    // Validate request body with Zod schema
    const validation = validateBody(sendMailSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { from, to, body, subject } = validation.data;
    const options: SendMailOptions = {};
    if (subject) options.subject = subject;

    const mailId = this.mailStorage.send(from, to, body, options);
    console.log(`[MAIL] ${from} -> ${to}: ${(subject ?? body).slice(0, 50)}...`);
    res.json({ id: mailId, from, to, subject, body, createdAt: Math.floor(Date.now() / 1000) });
  }

  private handleGetMail(req: Request, res: Response): void {
    const { handle } = req.params;
    const messages = this.mailStorage.getAll(handle);
    res.json(messages);
  }

  private handleGetUnreadMail(req: Request, res: Response): void {
    const { handle } = req.params;
    const messages = this.mailStorage.getUnread(handle);
    res.json(messages);
  }

  private handleMarkMailRead(req: Request, res: Response): void {
    const { id } = req.params;
    const mailId = parseInt(id, 10);

    if (isNaN(mailId)) {
      res.status(400).json({ error: 'Invalid mail ID' } as ErrorResponse);
      return;
    }

    this.mailStorage.markRead(mailId);
    res.json({ success: true, id: mailId });
  }

  // ============================================================================
  // HANDOFF HANDLERS (Phase 3)
  // ============================================================================

  private handleCreateHandoff(req: Request, res: Response): void {
    // Validate request body with Zod schema
    const validation = validateBody(createHandoffSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { from, to, context } = validation.data;
    const handoffId = this.mailStorage.createHandoff(from, to, context);
    console.log(`[HANDOFF] ${from} -> ${to}`);
    res.json({ id: handoffId, from, to, context, createdAt: Math.floor(Date.now() / 1000) });
  }

  private handleGetHandoffs(req: Request, res: Response): void {
    const { handle } = req.params;
    const handoffs = this.mailStorage.getPendingHandoffs(handle);
    res.json(handoffs);
  }

  // ============================================================================
  // BLACKBOARD HANDLERS (Fleet Coordination)
  // ============================================================================

  /**
   * Verify the authenticated user has access to the specified swarm.
   * - Team leads can access all swarms
   * - Workers can only access their assigned swarm
   */
  private verifySwarmAccess(req: Request, swarmId: string): { allowed: boolean; reason?: string } {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;

    if (!user) {
      return { allowed: false, reason: 'Authentication required' };
    }

    // Team leads can access all swarms
    if (user.agentType === 'team-lead') {
      return { allowed: true };
    }

    // Workers can only access their assigned swarm
    const worker = this.workerManager.getWorkerByHandle(user.handle);
    if (!worker) {
      // User is authenticated but not an active worker - allow read-only access to any swarm
      // This handles the case where a worker authenticates but hasn't been spawned yet
      return { allowed: true };
    }

    if (!worker.swarmId) {
      // Worker not assigned to any swarm - deny access
      return { allowed: false, reason: 'Worker not assigned to any swarm' };
    }

    if (worker.swarmId !== swarmId) {
      return {
        allowed: false,
        reason: `Access denied: worker belongs to swarm '${worker.swarmId}', not '${swarmId}'`,
      };
    }

    return { allowed: true };
  }

  private handleBlackboardPost(req: Request, res: Response): void {
    const validation = validateBody(blackboardPostSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { swarmId, senderHandle, messageType, payload, targetHandle, priority } = validation.data;

    // Verify swarm access
    const access = this.verifySwarmAccess(req, swarmId);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    const message = this.blackboardStorage.postMessage(
      swarmId,
      senderHandle,
      messageType,
      payload as Record<string, unknown>,
      { targetHandle, priority }
    );

    console.log(`[BLACKBOARD] ${senderHandle} -> ${targetHandle ?? 'all'} (${messageType})`);
    res.json(message);
  }

  private handleBlackboardRead(req: Request, res: Response): void {
    const { swarmId } = req.params;

    // Verify swarm access
    const access = this.verifySwarmAccess(req, swarmId);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    const { messageType, unreadOnly, readerHandle, priority, limit } = req.query as {
      messageType?: string;
      unreadOnly?: string;
      readerHandle?: string;
      priority?: string;
      limit?: string;
    };

    const options: {
      messageType?: BlackboardMessageType;
      unreadOnly?: boolean;
      readerHandle?: string;
      priority?: MessagePriority;
      limit?: number;
    } = {};

    if (messageType) options.messageType = messageType as BlackboardMessageType;
    if (unreadOnly === 'true' && readerHandle) {
      options.unreadOnly = true;
      options.readerHandle = readerHandle;
    }
    if (priority) options.priority = priority as MessagePriority;
    if (limit) options.limit = parseInt(limit, 10);

    const messages = this.blackboardStorage.readMessages(swarmId, options);
    res.json(messages);
  }

  private handleBlackboardMarkRead(req: Request, res: Response): void {
    const validation = validateBody(blackboardMarkReadSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { messageIds, readerHandle } = validation.data;
    const count = this.blackboardStorage.markRead(messageIds, readerHandle);
    res.json({ success: true, marked: count });
  }

  private handleBlackboardArchive(req: Request, res: Response): void {
    const validation = validateBody(blackboardArchiveSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { messageIds } = validation.data;
    const count = this.blackboardStorage.archiveMessages(messageIds);
    res.json({ success: true, archived: count });
  }

  private handleBlackboardArchiveOld(req: Request, res: Response): void {
    const { swarmId } = req.params;

    // Verify swarm access (already requires team-lead via route middleware)
    const access = this.verifySwarmAccess(req, swarmId);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    const validation = validateBody(blackboardArchiveOldSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { maxAgeMs } = validation.data;
    const ageThreshold = maxAgeMs ?? 24 * 60 * 60 * 1000; // Default 24 hours
    const cutoff = Date.now() - ageThreshold;

    // Get old messages and archive them
    const messages = this.blackboardStorage.readMessages(swarmId, { limit: 1000 });
    const oldMessageIds = messages
      .filter(m => m.createdAt < cutoff)
      .map(m => m.id);

    const count = this.blackboardStorage.archiveMessages(oldMessageIds);
    res.json({ success: true, archived: count, swarmId });
  }

  // ============================================================================
  // SPAWN QUEUE HANDLERS (Fleet Coordination)
  // ============================================================================

  private handleSpawnEnqueue(req: Request, res: Response): void {
    const validation = validateBody(spawnEnqueueSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { requesterHandle, targetAgentType, task, swarmId, priority, dependsOn } = validation.data;

    // Get requester info from worker manager or auth context
    const requester = this.workerManager.getWorkerByHandle(requesterHandle);
    const depthLevel = requester?.depthLevel ?? 1;

    // Determine requester's role for permission checking
    // If requester is an active worker, they're a 'worker' fleet role
    // If they're the team-lead making the request, treat as 'lead'
    const authReq = req as AuthenticatedRequest;
    const requesterRole = authReq.user?.agentType === 'team-lead' ? 'lead' : 'worker';

    const requestId = this.spawnController.queueSpawn(
      requesterHandle,
      targetAgentType,
      depthLevel,
      task,
      { priority, dependsOn, context: { swarmId, requesterRole } }
    );

    if (!requestId) {
      res.status(400).json({ error: 'Failed to queue spawn request' } as ErrorResponse);
      return;
    }

    console.log(`[SPAWN] Queued ${targetAgentType} by ${requesterHandle} (depth: ${depthLevel})`);
    res.json({ requestId, status: 'pending', targetAgentType, task });
  }

  private handleSpawnStatus(_req: Request, res: Response): void {
    const stats = this.spawnController.getQueueStats();
    res.json(stats);
  }

  private handleSpawnGet(req: Request, res: Response): void {
    const { id } = req.params;
    const item = this.spawnQueueStorage.get(id);

    if (!item) {
      res.status(404).json({ error: 'Spawn request not found' } as ErrorResponse);
      return;
    }

    res.json(item);
  }

  private handleSpawnCancel(req: Request, res: Response): void {
    const { id } = req.params;
    const success = this.spawnQueueStorage.reject(id);

    if (!success) {
      res.status(404).json({ error: 'Spawn request not found or already processed' } as ErrorResponse);
      return;
    }

    console.log(`[SPAWN] Cancelled ${id}`);
    res.json({ success: true, id });
  }

  // ============================================================================
  // CHECKPOINT HANDLERS (Fleet Coordination)
  // ============================================================================

  /**
   * Verify the authenticated user has access to a checkpoint.
   * - Team leads can access all checkpoints
   * - Users can access checkpoints where they are fromHandle or toHandle
   */
  private verifyCheckpointAccess(
    req: Request,
    checkpoint: { fromHandle: string; toHandle: string }
  ): { allowed: boolean; reason?: string } {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;

    if (!user) {
      return { allowed: false, reason: 'Authentication required' };
    }

    // Team leads can access all checkpoints
    if (user.agentType === 'team-lead') {
      return { allowed: true };
    }

    // Users can access checkpoints they're involved in
    if (user.handle === checkpoint.fromHandle || user.handle === checkpoint.toHandle) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Access denied: checkpoint belongs to ${checkpoint.fromHandle} -> ${checkpoint.toHandle}`,
    };
  }

  /**
   * Verify the authenticated user can access checkpoints for a given handle.
   * - Team leads can access any handle's checkpoints
   * - Users can only access their own checkpoints
   */
  private verifyCheckpointHandleAccess(req: Request, handle: string): { allowed: boolean; reason?: string } {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;

    if (!user) {
      return { allowed: false, reason: 'Authentication required' };
    }

    // Team leads can access all checkpoints
    if (user.agentType === 'team-lead') {
      return { allowed: true };
    }

    // Users can only access their own checkpoints
    if (user.handle === handle) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Access denied: cannot access checkpoints for handle '${handle}'`,
    };
  }

  private handleCheckpointCreate(req: Request, res: Response): void {
    const validation = validateBody(checkpointCreateSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fromHandle, toHandle, goal, now, test, doneThisSession, blockers, questions, next } = validation.data;

    const checkpoint = this.checkpointStorage.createCheckpoint(fromHandle, toHandle, {
      goal,
      now,
      test,
      doneThisSession,
      blockers,
      questions,
      next,
    });

    console.log(`[CHECKPOINT] ${fromHandle} -> ${toHandle}: ${goal.slice(0, 50)}...`);
    res.json(checkpoint);
  }

  private handleCheckpointLoad(req: Request, res: Response): void {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid checkpoint ID' } as ErrorResponse);
      return;
    }

    const checkpoint = this.checkpointStorage.loadCheckpoint(id);

    if (!checkpoint) {
      res.status(404).json({ error: 'Checkpoint not found' } as ErrorResponse);
      return;
    }

    // Verify access to this checkpoint
    const access = this.verifyCheckpointAccess(req, checkpoint);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    res.json(checkpoint);
  }

  private handleCheckpointLatest(req: Request, res: Response): void {
    const { handle } = req.params;

    // Verify access to this handle's checkpoints
    const access = this.verifyCheckpointHandleAccess(req, handle);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    const checkpoint = this.checkpointStorage.loadLatestCheckpoint(handle);

    if (!checkpoint) {
      res.status(404).json({ error: 'No checkpoint found for this handle' } as ErrorResponse);
      return;
    }

    res.json(checkpoint);
  }

  private handleCheckpointList(req: Request, res: Response): void {
    const { handle } = req.params;

    // Verify access to this handle's checkpoints
    const access = this.verifyCheckpointHandleAccess(req, handle);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason } as ErrorResponse);
      return;
    }

    const { status, limit } = req.query as { status?: string; limit?: string };

    const options: { status?: 'pending' | 'accepted' | 'rejected'; limit?: number } = {};
    if (status) options.status = status as 'pending' | 'accepted' | 'rejected';
    if (limit) options.limit = parseInt(limit, 10);

    const checkpoints = this.checkpointStorage.listCheckpoints(handle, options);
    res.json(checkpoints);
  }

  private handleCheckpointAccept(req: Request, res: Response): void {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid checkpoint ID' } as ErrorResponse);
      return;
    }

    // Load checkpoint to verify ownership
    const checkpoint = this.checkpointStorage.loadCheckpoint(id);
    if (!checkpoint) {
      res.status(404).json({ error: 'Checkpoint not found' } as ErrorResponse);
      return;
    }

    // Only the recipient (toHandle) or team-lead can accept
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' } as ErrorResponse);
      return;
    }

    if (user.agentType !== 'team-lead' && user.handle !== checkpoint.toHandle) {
      res.status(403).json({
        error: `Only the recipient '${checkpoint.toHandle}' can accept this checkpoint`,
      } as ErrorResponse);
      return;
    }

    const success = this.checkpointStorage.acceptCheckpoint(id);

    if (!success) {
      res.status(400).json({ error: 'Checkpoint already processed' } as ErrorResponse);
      return;
    }

    console.log(`[CHECKPOINT] Accepted ${id}`);
    res.json({ success: true, id });
  }

  private handleCheckpointReject(req: Request, res: Response): void {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid checkpoint ID' } as ErrorResponse);
      return;
    }

    // Load checkpoint to verify ownership
    const checkpoint = this.checkpointStorage.loadCheckpoint(id);
    if (!checkpoint) {
      res.status(404).json({ error: 'Checkpoint not found' } as ErrorResponse);
      return;
    }

    // Only the recipient (toHandle) or team-lead can reject
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' } as ErrorResponse);
      return;
    }

    if (user.agentType !== 'team-lead' && user.handle !== checkpoint.toHandle) {
      res.status(403).json({
        error: `Only the recipient '${checkpoint.toHandle}' can reject this checkpoint`,
      } as ErrorResponse);
      return;
    }

    const success = this.checkpointStorage.rejectCheckpoint(id);

    if (!success) {
      res.status(400).json({ error: 'Checkpoint already processed' } as ErrorResponse);
      return;
    }

    console.log(`[CHECKPOINT] Rejected ${id}`);
    res.json({ success: true, id });
  }

  // ============================================================================
  // SWARM MANAGEMENT HANDLERS (Fleet Coordination)
  // ============================================================================

  private handleSwarmCreate(req: Request, res: Response): void {
    const validation = validateBody(swarmCreateSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { name, description, maxAgents } = validation.data;

    const id = `swarm-${crypto.randomBytes(4).toString('hex')}`;
    const swarm = {
      id,
      name,
      description,
      maxAgents,
      createdAt: Date.now(),
    };

    this.swarms.set(id, swarm);
    console.log(`[SWARM] Created ${id}: ${name}`);
    res.json(swarm);
  }

  private handleSwarmList(req: Request, res: Response): void {
    const { includeAgents } = req.query as { includeAgents?: string };
    const swarms = Array.from(this.swarms.values());

    if (includeAgents === 'true') {
      const workers = this.workerManager.getWorkers();
      const result = swarms.map(swarm => ({
        ...swarm,
        agents: workers.filter(w => w.swarmId === swarm.id).map(w => ({
          id: w.id,
          handle: w.handle,
          state: w.state,
        })),
      }));
      res.json(result);
    } else {
      res.json(swarms);
    }
  }

  private handleSwarmGet(req: Request, res: Response): void {
    const { id } = req.params;
    const swarm = this.swarms.get(id);

    if (!swarm) {
      res.status(404).json({ error: 'Swarm not found' } as ErrorResponse);
      return;
    }

    const workers = this.workerManager.getWorkers().filter(w => w.swarmId === id);
    res.json({
      ...swarm,
      agents: workers.map(w => ({
        id: w.id,
        handle: w.handle,
        state: w.state,
        depthLevel: w.depthLevel,
      })),
    });
  }

  private async handleSwarmKill(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const validation = validateBody(swarmKillSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { graceful } = validation.data;
    const swarm = this.swarms.get(id);
    if (!swarm) {
      res.status(404).json({ error: 'Swarm not found' } as ErrorResponse);
      return;
    }

    const workers = this.workerManager.getWorkers().filter(w => w.swarmId === id);
    const dismissed: string[] = [];

    for (const worker of workers) {
      try {
        await this.workerManager.dismissWorker(worker.id, true);
        dismissed.push(worker.handle);
      } catch (error) {
        console.error(`[SWARM] Failed to dismiss ${worker.handle}:`, (error as Error).message);
      }
    }

    // Optionally remove the swarm
    if (!graceful) {
      this.swarms.delete(id);
    }

    console.log(`[SWARM] Killed ${id}: dismissed ${dismissed.length} agents`);
    res.json({ success: true, swarmId: id, dismissed });
  }

  private handleDebug(_req: Request, res: Response): void {
    const debug = this.storage.getDebugInfo();
    const workers = this.workerManager.getWorkers().map(w => ({
      id: w.id,
      handle: w.handle,
      state: w.state,
    }));
    res.json({ ...debug, workers });
  }

  // ============================================================================
  // WEBSOCKET
  // ============================================================================

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WS] New connection');
      const extWs = ws as ExtendedWebSocket;
      extWs.isAlive = true;
      extWs.subscribedChats = new Set();

      extWs.on('pong', () => {
        extWs.isAlive = true;
      });

      extWs.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as WebSocketMessage;
          if (msg.type === 'subscribe' && msg.chatId) {
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

  private broadcastToChat(chatId: string, message: WebSocketMessage): void {
    const subs = this.subscriptions.get(chatId);
    if (!subs) return;
    const payload = JSON.stringify(message);
    subs.forEach(ws => {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    });
  }

  private broadcastToAll(message: WebSocketMessage): void {
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
  // START
  // ============================================================================

  async start(): Promise<void> {
    // Initialize worker manager (crash recovery)
    await this.workerManager.initialize();

    this.server.listen(this.config.port, () => {
      console.log('\n' +
        '==============================================================\n' +
        '     Claude Code Collab Server v2.0 (TypeScript)\n' +
        '          with Worker Orchestration\n' +
        '==============================================================\n' +
        `  HTTP API:    http://localhost:${this.config.port}\n` +
        `  WebSocket:   ws://localhost:${this.config.port}/ws\n` +
        `  Database:    ${this.config.dbPath}\n` +
        `  Max Workers: ${this.config.maxWorkers}\n` +
        '==============================================================\n' +
        '  Usage:\n' +
        '    export CLAUDE_CODE_TEAM_NAME="my-team"\n' +
        `    export CLAUDE_CODE_COLLAB_URL="http://localhost:${this.config.port}"\n` +
        '==============================================================\n'
      );
    });
  }

  async stop(): Promise<void> {
    console.log('[SERVER] Stopping...');
    await this.workerManager.dismissAll();
    this.wss.close();
    this.server.close();
    this.storage.close();
    console.log('[SERVER] Stopped');
  }
}
