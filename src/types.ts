/**
 * Claude Fleet - Type Definitions
 *
 * Core types for fleet coordination, task management, and worker orchestration.
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
  | 'auth'
  | 'authenticated'
  | 'error'
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
  authenticated?: boolean;
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
  storageBackend?: 'sqlite' | 'dynamodb' | 's3' | 'firestore' | 'postgresql';
  jwtSecret: string;
  jwtExpiresIn: string;
  maxWorkers: number;
  rateLimitWindow: number;
  rateLimitMax: number;
  corsOrigins: string[];
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
  swarmId: string | null;
  depthLevel: number;
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
  swarmId: string | null;   // Swarm the spawned agent will belong to
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

/**
 * Swarm template for quick plan execution
 * Stores a reusable configuration of agent roles by SDLC phase
 */
export interface SwarmTemplate {
  /** Unique template ID (UUID) */
  id: string;
  /** User-defined template name (alphanumeric with dashes/underscores) */
  name: string;
  /** Optional description of the template */
  description: string | null;
  /** Built-in templates cannot be modified or deleted */
  isBuiltin: boolean;
  /** Roles organized by SDLC phase */
  phases: {
    discovery: string[];
    development: string[];
    quality: string[];
    delivery: string[];
  };
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Last update timestamp (Unix ms) */
  updatedAt: number;
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

// ============================================================================
// WORKFLOW TYPES (Phase 5)
// ============================================================================

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type WorkflowStepStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked';
export type WorkflowStepType = 'task' | 'spawn' | 'checkpoint' | 'gate' | 'parallel' | 'script';
export type WorkflowTriggerType = 'event' | 'schedule' | 'webhook' | 'blackboard';

/** Guard condition for step execution */
export interface WorkflowGuard {
  /** Expression type */
  type: 'expression' | 'script' | 'output_check';
  /** The condition to evaluate */
  condition: string;
  /** Variables available in the condition */
  variables?: string[];
}

/** Hook for workflow lifecycle events */
export interface WorkflowHook {
  type: 'blackboard' | 'mail' | 'callback';
  config: Record<string, unknown>;
}

/** Config for 'task' step - creates a work item */
export interface TaskStepConfig {
  type: 'task';
  title: string;
  description?: string;
  assignTo?: string | '@spawned' | '@requester';
}

/** Config for 'spawn' step - spawns a worker agent */
export interface SpawnStepConfig {
  type: 'spawn';
  agentRole: string;
  task: string;
  swarmId?: string | '@context';
}

/** Config for 'checkpoint' step - creates a checkpoint for handoff */
export interface CheckpointStepConfig {
  type: 'checkpoint';
  goal: string;
  toHandle: string | '@lead' | '@requester';
  waitForAcceptance?: boolean;
}

/** Config for 'gate' step - conditional branching */
export interface GateStepConfig {
  type: 'gate';
  condition: WorkflowGuard;
  onTrue?: string[];
  onFalse?: string[];
}

/** Config for 'parallel' step - references step keys to run in parallel */
export interface ParallelStepConfig {
  type: 'parallel';
  stepKeys: string[];
  strategy: 'all' | 'any' | 'race';
}

/** Config for 'script' step - run arbitrary logic */
export interface ScriptStepConfig {
  type: 'script';
  script: string;
  outputKey?: string;
}

/** Union type for step configs */
export type WorkflowStepConfig =
  | TaskStepConfig
  | SpawnStepConfig
  | CheckpointStepConfig
  | GateStepConfig
  | ParallelStepConfig
  | ScriptStepConfig;

/** Step definition within a workflow */
export interface WorkflowStepDefinition {
  /** Unique key within the workflow */
  key: string;
  /** Human-readable name */
  name: string;
  /** Step type */
  type: WorkflowStepType;
  /** Steps this depends on (keys) */
  dependsOn?: string[];
  /** Type-specific configuration */
  config: WorkflowStepConfig;
  /** Guard condition for execution */
  guard?: WorkflowGuard;
  /** On failure behavior */
  onFailure?: 'fail' | 'skip' | 'retry' | 'continue';
  /** Max retry attempts */
  maxRetries?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/** Complete workflow definition */
export interface WorkflowDefinition {
  /** Workflow steps */
  steps: WorkflowStepDefinition[];
  /** Input parameters schema */
  inputs?: Record<string, { type: string; required?: boolean; default?: unknown }>;
  /** Output mappings (key -> step.output.path) */
  outputs?: Record<string, string>;
  /** Global timeout */
  timeoutMs?: number;
  /** On complete hook */
  onComplete?: WorkflowHook;
  /** On failure hook */
  onFailure?: WorkflowHook;
}

/** Stored workflow */
export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  definition: WorkflowDefinition;
  isTemplate: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Workflow execution instance */
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  swarmId: string | null;
  status: WorkflowStatus;
  context: Record<string, unknown>;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  createdAt: number;
  createdBy: string;
}

/** Workflow step instance */
export interface WorkflowStep {
  id: string;
  executionId: string;
  stepKey: string;
  name: string | null;
  stepType: WorkflowStepType;
  status: WorkflowStepStatus;
  config: WorkflowStepConfig;
  dependsOn: string[];
  blockedByCount: number;
  output: Record<string, unknown> | null;
  assignedTo: string | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
}

/** Event trigger config */
export interface EventTriggerConfig {
  type: 'event';
  eventType: string;
  filter?: Record<string, unknown>;
}

/** Schedule trigger config */
export interface ScheduleTriggerConfig {
  type: 'schedule';
  cron?: string;
  intervalMs?: number;
}

/** Webhook trigger config */
export interface WebhookTriggerConfig {
  type: 'webhook';
  path: string;
  method?: 'GET' | 'POST';
  secret?: string;
}

/** Blackboard trigger config */
export interface BlackboardTriggerConfig {
  type: 'blackboard';
  swarmId: string;
  messageType: BlackboardMessageType;
  filter?: Record<string, unknown>;
}

/** Union type for trigger configs */
export type WorkflowTriggerConfig =
  | EventTriggerConfig
  | ScheduleTriggerConfig
  | WebhookTriggerConfig
  | BlackboardTriggerConfig;

/** Workflow trigger */
export interface WorkflowTrigger {
  id: string;
  workflowId: string;
  triggerType: WorkflowTriggerType;
  config: WorkflowTriggerConfig;
  isEnabled: boolean;
  lastFiredAt: number | null;
  fireCount: number;
  createdAt: number;
}

/** Workflow event (audit log) */
export interface WorkflowEvent {
  id: number;
  executionId: string;
  stepId: string | null;
  eventType: string;
  actor: string | null;
  details: Record<string, unknown> | null;
  createdAt: number;
}

// ============================================================================
// SWARM INTELLIGENCE TYPES (Phase 6) - 2026 Research Features
// ============================================================================

// --- Stigmergic Coordination (Pheromone Trails) ---

export type PheromoneResourceType = 'file' | 'task' | 'endpoint' | 'module' | 'custom';
export type PheromoneTrailType = 'touch' | 'modify' | 'complete' | 'error' | 'warning' | 'success';

export interface PheromoneTrail {
  id: string;
  swarmId: string;
  resourceType: PheromoneResourceType;
  resourceId: string;
  depositorHandle: string;
  trailType: PheromoneTrailType;
  intensity: number;  // 0.0 - 1.0
  metadata: Record<string, unknown>;
  createdAt: number;
  decayedAt: number | null;
}

export interface PheromoneQuery {
  resourceType?: PheromoneResourceType;
  resourceId?: string;
  trailType?: PheromoneTrailType;
  minIntensity?: number;
  depositorHandle?: string;
  activeOnly?: boolean;
  limit?: number;
}

export interface PheromoneConfig {
  decayRatePerHour: number;  // default: 0.1 (10% per hour)
  minIntensity: number;  // below this, trail is considered decayed
  aggregationMethod: 'sum' | 'max' | 'average';
}

// --- Agent Belief States (Theory of Mind) ---

export type BeliefType = 'knowledge' | 'assumption' | 'inference' | 'observation';
export type BeliefSourceType = 'direct' | 'inferred' | 'communicated' | 'observed';
export type MetaBeliefType = 'capability' | 'reliability' | 'knowledge' | 'intention' | 'workload';

export interface AgentBelief {
  id: number;
  swarmId: string;
  agentHandle: string;
  beliefType: BeliefType;
  subject: string;
  beliefValue: string;
  confidence: number;  // 0.0 - 1.0
  sourceHandle?: string;
  sourceType?: BeliefSourceType;
  validUntil?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMetaBelief {
  id: number;
  swarmId: string;
  agentHandle: string;
  aboutHandle: string;
  metaType: MetaBeliefType;
  beliefValue: string;
  confidence: number;
  evidenceCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface BeliefUpdate {
  subject: string;
  beliefType?: BeliefType;
  beliefValue: Record<string, unknown>;
  confidence?: number;
  sourceHandle?: string;
  sourceType?: BeliefSourceType;
  validUntil?: number;
}

// --- Game-Theoretic Payoffs ---

export type PayoffType = 'completion' | 'quality' | 'speed' | 'cooperation' | 'penalty';

export interface TaskPayoff {
  id: number;
  taskId: string;
  swarmId: string | null;
  payoffType: PayoffType;
  baseValue: number;
  multiplier: number;
  deadline: number | null;
  decayRate: number;
  dependencies: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PayoffCalculation {
  taskId: string;
  totalPayoff: number;
  breakdown: Array<{
    type: PayoffType;
    value: number;
    reason: string;
  }>;
  bonuses: number;
  penalties: number;
  timeDecay: number;
}

// --- Agent Credits & Reputation ---

export type CreditTransactionType = 'earn' | 'spend' | 'bonus' | 'penalty' | 'transfer' | 'adjustment';

export interface AgentCredits {
  id: number;
  swarmId: string;
  agentHandle: string;
  balance: number;
  reputationScore: number;  // 0.0 - 1.0
  totalEarned: number;
  totalSpent: number;
  taskCount: number;
  successCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreditTransaction {
  id: number;
  swarmId: string;
  agentHandle: string;
  transactionType: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdAt: number;
}

// --- Consensus Mechanisms ---

export type ConsensusProposalType = 'decision' | 'election' | 'approval' | 'ranking' | 'allocation';
export type VotingMethod = 'majority' | 'supermajority' | 'unanimous' | 'ranked' | 'weighted';
export type QuorumType = 'percentage' | 'absolute' | 'none';
export type ProposalStatus = 'open' | 'closed' | 'passed' | 'failed' | 'cancelled';

export interface ConsensusProposal {
  id: string;
  swarmId: string;
  proposerHandle: string;
  proposalType: ConsensusProposalType;
  title: string;
  description: string | null;
  options: string[];
  votingMethod: VotingMethod;
  quorumType: QuorumType;
  quorumValue: number;
  weightByReputation: boolean;
  status: ProposalStatus;
  deadline: number | null;
  result: ConsensusResult | null;
  createdAt: number;
  closedAt: number | null;
}

export interface ConsensusVote {
  id: number;
  proposalId: string;
  voterHandle: string;
  voteValue: string;  // JSON string for ranked/weighted voting
  voteWeight: number;
  rationale?: string;
  createdAt: number;
}

export interface ConsensusResult {
  winner: string | null;
  tally: Record<string, number>;
  quorumMet: boolean;
  participationRate: number;
  totalVotes: number;
  weightedVotes: number;
}

// --- Market-Based Task Bidding ---

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

export interface TaskBid {
  id: string;
  taskId: string;
  swarmId: string;
  bidderHandle: string;
  bidAmount: number;
  estimatedDuration: number | null;  // minutes
  confidence: number;
  rationale: string | null;
  status: BidStatus;
  createdAt: number;
  processedAt: number | null;
}

export interface BidEvaluation {
  bidId: string;
  score: number;
  factors: Record<string, number>;
  recommendation: 'accept' | 'reject' | 'consider';
}

export interface AuctionConfig {
  auctionType: 'first-price' | 'second-price' | 'dutch' | 'english';
  minBid: number;
  maxBid: number;
  durationMs: number;
  autoAccept: boolean;
  reputationThreshold: number;
}
