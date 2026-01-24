/**
 * Claude Code Collab - Type Definitions
 *
 * Core types for team coordination, task management, and worker orchestration.
 */

import type { ChildProcess } from 'child_process';
import type { WebSocket } from 'ws';

// ============================================================================
// AGENT TYPES
// ============================================================================

export type AgentType = 'team-lead' | 'worker';
export type AgentStatus = 'online' | 'busy' | 'offline';

export interface TeamAgent {
  /** Unique agent ID (hash of teamName:handle) */
  uid: string;
  /** Human-readable handle */
  handle: string;
  /** Team this agent belongs to */
  teamName: string;
  /** Role in the team */
  agentType: AgentType;
  /** When the agent registered */
  createdAt: string;
  /** Last activity timestamp */
  lastSeen: string | null;
}

export interface AgentRegistration {
  handle: string;
  teamName: string;
  agentType?: AgentType;
}

export interface AuthResponse {
  uid: string;
  handle: string;
  teamName: string;
  agentType: AgentType;
  token: string;
}

// ============================================================================
// TASK TYPES
// ============================================================================

export type TaskStatus = 'open' | 'in_progress' | 'resolved' | 'blocked';

export interface TeamTask {
  /** Unique task ID */
  id: string;
  /** Team this task belongs to */
  teamName: string;
  /** Task subject/title */
  subject: string;
  /** Detailed description */
  description: string | null;
  /** Assigned agent handle */
  ownerHandle: string | null;
  /** Assigned agent UID */
  ownerUid: string | null;
  /** Who created the task (handle) */
  createdByHandle: string;
  /** Who created the task (UID) */
  createdByUid: string;
  /** Current status */
  status: TaskStatus;
  /** Task IDs that block this task */
  blockedBy: string[];
  /** When created */
  createdAt: string;
  /** When last updated */
  updatedAt: string;
}

export interface CreateTaskRequest {
  fromUid: string;
  toHandle: string;
  teamName: string;
  subject: string;
  description?: string;
  blockedBy?: string[];
}

export interface UpdateTaskRequest {
  status: TaskStatus;
}

// ============================================================================
// CHAT & MESSAGE TYPES
// ============================================================================

export type MessageStatus = 'pending' | 'processed';

export interface Chat {
  /** Chat ID (hash of participants or team) */
  id: string;
  /** Participant UIDs */
  participants: string[];
  /** Is this a team-wide chat? */
  isTeamChat: boolean;
  /** Team name (if team chat) */
  teamName: string | null;
  /** When created */
  createdAt: string;
  /** When last message was sent */
  updatedAt: string;
}

export interface Message {
  /** Unique message ID */
  id: string;
  /** Chat this message belongs to */
  chatId: string;
  /** Sender handle (prefixed with 'collab:') */
  fromHandle: string;
  /** Sender UID */
  fromUid: string;
  /** Message text */
  text: string;
  /** When sent */
  timestamp: string;
  /** Message status */
  status: MessageStatus;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

export interface SendMessageRequest {
  from: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface BroadcastRequest {
  from: string;
  text: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// WORKER PROCESS TYPES (NEW - Orchestration)
// ============================================================================

export type WorkerState = 'starting' | 'ready' | 'working' | 'stopping' | 'stopped';

export interface WorkerProcess {
  /** Unique worker ID */
  id: string;
  /** Agent handle */
  handle: string;
  /** Team name */
  teamName: string;
  /** Node.js child process */
  process: ChildProcess;
  /** Claude Code session ID for resumption */
  sessionId: string | null;
  /** Working directory */
  workingDir: string;
  /** Current state */
  state: WorkerState;
  /** Recent output lines */
  recentOutput: string[];
  /** When spawned */
  spawnedAt: number;
  /** Current task ID (if any) */
  currentTaskId: string | null;
  /** Last heartbeat timestamp */
  lastHeartbeat: number;
  /** Number of auto-restarts */
  restartCount: number;
  /** Health status */
  health: 'healthy' | 'degraded' | 'unhealthy';
  /** Swarm ID for fleet coordination */
  swarmId?: string;
  /** Depth level in agent hierarchy (1 = spawned by lead) */
  depthLevel?: number;
}

// ============================================================================
// METRICS TYPES
// ============================================================================

export interface ServerMetrics {
  uptime: number;
  workers: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    byState: Record<WorkerState, number>;
  };
  tasks: {
    total: number;
    byStatus: Record<TaskStatus, number>;
  };
  agents: number;
  chats: number;
  messages: number;
  restarts: {
    total: number;
    lastHour: number;
  };
}

export interface SpawnWorkerRequest {
  handle: string;
  teamName?: string;
  workingDir?: string;
  initialPrompt?: string;
  sessionId?: string;
}

export interface SpawnWorkerResponse {
  id: string;
  handle: string;
  teamName: string;
  workingDir: string;
  state: WorkerState;
  spawnedAt: number;
}

export interface SendToWorkerRequest {
  message: string;
}

// ============================================================================
// CLAUDE CODE NDJSON EVENT TYPES
// ============================================================================

export type ClaudeEventType = 'system' | 'assistant' | 'user' | 'result';
export type ClaudeEventSubtype = 'init' | 'tool_use' | 'tool_result' | 'text';

export interface ClaudeEvent {
  type: ClaudeEventType;
  subtype?: ClaudeEventSubtype;
  session_id?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
    }>;
  };
  result?: string;
  duration_ms?: number;
  total_cost_usd?: number;
  is_error?: boolean;
}

// ============================================================================
// WEBSOCKET TYPES
// ============================================================================

export type WebSocketMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'ping'
  | 'pong'
  | 'subscribed'
  | 'new_message'
  | 'broadcast'
  | 'task_assigned'
  | 'worker_spawned'
  | 'worker_output'
  | 'worker_dismissed';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  chatId?: string;
  uid?: string;
  message?: Message;
  handle?: string;
  task?: TeamTask;
  worker?: SpawnWorkerResponse;
  output?: string;
}

export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  subscribedChats: Set<string>;
  uid?: string;
}

// ============================================================================
// STORAGE INTERFACE
// ============================================================================

export interface TeamStorage {
  // Users/Agents
  insertUser(user: TeamAgent): void;
  getUser(uid: string): TeamAgent | null;
  getUsersByTeam(teamName: string): TeamAgent[];

  // Chats
  insertChat(chat: Chat): void;
  getChat(chatId: string): Chat | null;
  getChatsByUser(uid: string): Chat[];
  updateChatTime(chatId: string, timestamp: string): void;

  // Messages
  insertMessage(message: Message): void;
  getMessages(chatId: string, limit: number): Message[];
  getMessagesAfter(chatId: string, afterTimestamp: string, limit: number): Message[];

  // Unread counts
  getUnread(chatId: string, uid: string): number;
  setUnread(chatId: string, uid: string, count: number): void;
  incrementUnread(chatId: string, uid: string): void;
  clearUnread(chatId: string, uid: string): void;

  // Tasks
  insertTask(task: TeamTask): void;
  getTask(taskId: string): TeamTask | null;
  getTasksByTeam(teamName: string): TeamTask[];
  updateTaskStatus(taskId: string, status: TaskStatus, updatedAt: string): void;

  // Debug
  getDebugInfo(): {
    users: TeamAgent[];
    chats: Chat[];
    messageCount: number;
    tasks: TeamTask[];
  };
}

// ============================================================================
// SERVER CONFIGURATION
// ============================================================================

export interface ServerConfig {
  port: number;
  dbPath: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  maxWorkers: number;
  rateLimitWindow: number;
  rateLimitMax: number;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface HealthResponse {
  status: 'ok';
  version: string;
  persistence: 'sqlite';
  dbPath: string;
  agents: number;
  chats: number;
  messages: number;
  workers: number;
}

export interface ErrorResponse {
  error: string;
  blockedBy?: string[];
}

// ============================================================================
// MCP TYPES
// ============================================================================

export interface MCPToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

// ============================================================================
// AGENT ROLES (Phase 3)
// ============================================================================

export type AgentRole = 'coordinator' | 'worker' | 'monitor' | 'notifier' | 'merger';

export interface RolePermissions {
  spawn: boolean;
  dismiss: boolean;
  assign: boolean;
  broadcast: boolean;
  merge: boolean;
  claim: boolean;
  complete: boolean;
  send: boolean;
  readAll: boolean;
  alert: boolean;
  notify: boolean;
  readStatus: boolean;
  resolve: boolean;
  push: boolean;
}

export const ROLE_PERMISSIONS: Record<AgentRole, RolePermissions> = {
  coordinator: {
    spawn: true, dismiss: true, assign: true, broadcast: true, merge: true,
    claim: true, complete: true, send: true, readAll: true, alert: false,
    notify: false, readStatus: true, resolve: true, push: true,
  },
  worker: {
    spawn: false, dismiss: false, assign: false, broadcast: false, merge: false,
    claim: true, complete: true, send: true, readAll: false, alert: false,
    notify: false, readStatus: false, resolve: false, push: false,
  },
  monitor: {
    spawn: false, dismiss: false, assign: false, broadcast: false, merge: false,
    claim: false, complete: false, send: false, readAll: true, alert: true,
    notify: false, readStatus: true, resolve: false, push: false,
  },
  notifier: {
    spawn: false, dismiss: false, assign: false, broadcast: false, merge: false,
    claim: false, complete: false, send: false, readAll: false, alert: false,
    notify: true, readStatus: true, resolve: false, push: false,
  },
  merger: {
    spawn: false, dismiss: false, assign: false, broadcast: false, merge: true,
    claim: false, complete: false, send: false, readAll: false, alert: false,
    notify: false, readStatus: false, resolve: true, push: true,
  },
};

// ============================================================================
// PERSISTENT WORKER TYPES (Phase 1)
// ============================================================================

export type WorkerStatus = 'pending' | 'ready' | 'busy' | 'error' | 'dismissed';

export interface PersistentWorker {
  id: string;
  handle: string;
  status: WorkerStatus;
  worktreePath: string | null;
  worktreeBranch: string | null;
  pid: number | null;
  sessionId: string | null;
  initialPrompt: string | null;
  lastHeartbeat: number | null;
  restartCount: number;
  role: AgentRole;
  createdAt: number;
  dismissedAt: number | null;
}

// ============================================================================
// WORK ITEM TYPES (Phase 2)
// ============================================================================

export type WorkItemStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
export type BatchStatus = 'open' | 'dispatched' | 'completed' | 'cancelled';
export type WorkItemEventType = 'created' | 'assigned' | 'started' | 'completed' | 'blocked' | 'unblocked' | 'cancelled' | 'comment';

export interface WorkItem {
  id: string;           // e.g., 'wi-x7k2m'
  title: string;
  description: string | null;
  status: WorkItemStatus;
  assignedTo: string | null;  // worker handle
  batchId: string | null;
  createdAt: number;
}

export interface Batch {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: number;
}

export interface WorkItemEvent {
  id: number;
  workItemId: string;
  eventType: WorkItemEventType;
  actor: string | null;
  details: string | null;
  createdAt: number;
}

export interface CreateWorkItemOptions {
  description?: string;
  batchId?: string;
  assignedTo?: string;
}

export interface CreateBatchOptions {
  workItemIds?: string[];
}

// ============================================================================
// MAIL TYPES (Phase 3)
// ============================================================================

export interface MailMessage {
  id: number;
  fromHandle: string;
  toHandle: string;
  subject: string | null;
  body: string;
  readAt: number | null;
  createdAt: number;
}

export interface Handoff {
  id: number;
  fromHandle: string;
  toHandle: string;
  context: Record<string, unknown>;
  acceptedAt: number | null;
  createdAt: number;
}

export interface SendMailOptions {
  subject?: string;
}

// ============================================================================
// WORKTREE TYPES (Phase 1)
// ============================================================================

export interface WorktreeInfo {
  workerId: string;
  path: string;
  branch: string;
  createdAt: number;
}

// ============================================================================
// FLEET COORDINATION TYPES (Phase 4)
// ============================================================================

export type BlackboardMessageType = 'request' | 'response' | 'status' | 'directive' | 'checkpoint';
export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';
export type SpawnQueueStatus = 'pending' | 'approved' | 'rejected' | 'spawned';
export type CheckpointOutcome = 'SUCCEEDED' | 'PARTIAL_PLUS' | 'PARTIAL_MINUS' | 'FAILED';

export interface BlackboardMessage {
  id: string;
  swarmId: string;
  senderHandle: string;
  messageType: BlackboardMessageType;
  targetHandle: string | null;  // null = broadcast to swarm
  priority: MessagePriority;
  payload: Record<string, unknown>;
  readBy: string[];  // Array of handles that have read this
  createdAt: number;
  archivedAt: number | null;
}

export interface SpawnQueueItem {
  id: string;
  requesterHandle: string;
  targetAgentType: string;  // FleetAgentRole
  depthLevel: number;
  priority: MessagePriority;
  status: SpawnQueueStatus;
  payload: {
    task: string;
    context?: Record<string, unknown>;
    checkpoint?: Record<string, unknown>;
  };
  dependsOn: string[];  // IDs of other spawn queue items
  blockedByCount: number;
  createdAt: number;
  processedAt: number | null;
  spawnedWorkerId: string | null;
}

export interface Checkpoint {
  goal: string;
  now: string;
  test?: string;
  doneThisSession: Array<{
    task: string;
    files: string[];
  }>;
  blockers: string[];
  questions: string[];
  worked: string[];
  failed: string[];
  next: string[];
  files: {
    created: string[];
    modified: string[];
  };
}

export interface SwarmInfo {
  id: string;
  name?: string;
  workers: Array<{
    handle: string;
    role: string;
    status: string;
    depthLevel: number;
  }>;
  createdAt: number;
}

// Extend PersistentWorker with fleet fields
export interface FleetWorker extends PersistentWorker {
  swarmId: string | null;
  depthLevel: number;
}

// Extend Handoff with checkpoint fields
export interface FleetHandoff extends Handoff {
  checkpoint: Checkpoint | null;
  status: 'pending' | 'accepted' | 'rejected';
  outcome: CheckpointOutcome | null;
}
