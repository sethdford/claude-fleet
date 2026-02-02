/** Authentication response from POST /auth */
export interface AuthResponse {
  token: string;
  uid: string;
  handle: string;
  teamName: string;
  agentType: string;
}

/** Stored user info */
export interface UserInfo {
  uid: string;
  handle: string;
  teamName: string;
  agentType: string;
}

/** Worker info from GET /orchestrate/workers */
export interface WorkerInfo {
  handle: string;
  teamName: string;
  state: 'starting' | 'ready' | 'working' | 'stopping' | 'stopped';
  health: 'healthy' | 'degraded' | 'unhealthy';
  spawnedAt: number;
  restartCount: number;
  spawnMode?: 'process' | 'tmux' | 'external' | 'native';
  swarmId?: string;
  currentTaskId?: string;
  depthLevel?: number;
  workingDir?: string;
}

/** Swarm info from GET /swarms */
export interface SwarmInfo {
  id: string;
  name: string;
  description?: string;
  maxAgents: number;
  agents?: { handle: string }[];
  createdAt?: string;
}

/** Team task from GET /teams/:name/tasks */
export interface TeamTask {
  id: string;
  subject: string;
  description?: string;
  status: 'open' | 'in_progress' | 'blocked' | 'resolved';
  ownerHandle?: string;
  createdByHandle?: string;
  createdAt?: string;
  updatedAt?: string;
  blockedBy?: string[];
}

/** Server metrics from GET /metrics/json */
export interface ServerMetrics {
  uptime: number;
  workers: {
    total: number;
    healthy: number;
    unhealthy: number;
    byState: Record<string, number>;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
  };
  restarts: {
    lastHour: number;
  };
  agents?: number;
}

/** Blackboard message from GET /blackboard/:swarmId */
export interface BlackboardMessage {
  id: string;
  swarmId: string;
  senderHandle: string;
  targetHandle: string | null;
  messageType: 'request' | 'response' | 'status' | 'directive' | 'checkpoint';
  priority: 'low' | 'normal' | 'high' | 'critical';
  payload: Record<string, unknown>;
  readBy: string[];
  createdAt: number;
  archivedAt: number | null;
}

/** Pheromone trail */
export interface PheromoneTrail {
  id: string;
  swarmId: string;
  depositorHandle: string;
  resourceId: string;
  resourceType: string;
  trailType: string;
  intensity: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

/** Hot resource from activity endpoint */
export interface HotResource {
  resourceId: string;
  resourceType?: string;
  trailCount: number;
}

/** Agent belief */
export interface Belief {
  id: string;
  swarmId: string;
  agentHandle: string;
  subject: string;
  beliefType: 'knowledge' | 'assumption' | 'inference' | 'observation';
  beliefValue: string;
  confidence: number;
  evidence?: string[];
  createdAt?: string;
}

/** Credit/reputation account (matches backend LeaderboardEntry) */
export interface CreditAccount {
  agentHandle: string;
  balance: number;
  reputationScore: number;
  totalEarned: number;
  taskCount: number;
  successCount: number;
  successRate: number;
}

/** Consensus result (matches backend ConsensusResult) */
export interface Consensus {
  winner: string | null;
  tally: Record<string, number>;
  quorumMet: boolean;
  participationRate: number;
  totalVotes: number;
  weightedVotes: number;
}

/** Proposal (matches backend ConsensusProposal + votes) */
export interface Proposal {
  id: string;
  swarmId: string;
  proposerHandle: string;
  proposalType: string;
  title: string;
  description: string | null;
  options: string[];
  votingMethod: string;
  status: 'open' | 'closed' | 'passed' | 'failed' | 'cancelled';
  result: Consensus | null;
  votes?: { voteValue: string; voterHandle: string; voteWeight: number; rationale?: string }[];
  createdAt: number;
  closedAt: number | null;
  deadline: number | null;
}

/** Bid on a task (matches backend TaskBid) */
export interface Bid {
  id: string;
  swarmId: string;
  taskId: string;
  bidderHandle: string;
  bidAmount: number;
  confidence: number;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
  rationale: string | null;
  estimatedDuration: number | null;
  createdAt: number;
  processedAt: number | null;
}

/** Spawn queue status */
export interface SpawnQueueStatus {
  pending: number;
  active: number;
  completed: number;
  failed: number;
}

/** Scheduler status */
export interface SchedulerStatus {
  running?: boolean;
  isRunning?: boolean;
}

/** Schedule definition */
export interface Schedule {
  id: string;
  name: string;
  cron: string;
  enabled?: boolean;
  repository?: string;
  tasks?: unknown[];
}

/** Scheduler queue task */
export interface QueueTask {
  id: string;
  name: string;
  status: 'queued' | 'running';
  trigger?: string;
  repository?: string;
  priority?: string;
  startedAt?: string;
}

/** Task template */
export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  estimatedMinutes?: number;
  role?: string;
}

/** Workflow template */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  steps?: unknown[];
  triggers?: unknown[];
  createdAt?: string;
}

/** Workflow execution */
export interface WorkflowExecution {
  id: string;
  workflowId?: string;
  workflowName?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  steps?: { status: string }[];
  stepCount?: number;
  startedAt?: string;
}

/** Mail message */
export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject?: string;
  body: string;
  readAt?: string;
  createdAt?: string;
}

/** TLDR stats */
export interface TLDRStats {
  summaries?: number;
  dependencies?: number;
  overviews?: number;
  coverage?: string;
}

/** Dependency graph data */
export interface GraphData {
  nodes: GraphNode[];
  edges?: GraphEdge[];
  links?: GraphEdge[];
  nodeCount?: number;
  edgeCount?: number;
  error?: string;
}

export interface GraphNode {
  id: string;
  path: string;
  summary?: string;
}

export interface GraphEdge {
  source: string;
  from?: string;
  target: string;
  to?: string;
  type?: string;
}

/** Pheromone stats */
export interface PheromoneStats {
  totalTrails?: number;
  activeTrails?: number;
}

/** Belief stats */
export interface BeliefStats {
  totalBeliefs?: number;
  uniqueSubjects?: number;
}

/** Credit stats */
export interface CreditStats {
  totalCredits?: number;
  agentCount?: number;
}

/** Consensus stats */
export interface ConsensusStats {
  totalProposals?: number;
  openProposals?: number;
}

/** Bidding stats */
export interface BiddingStats {
  totalBids?: number;
  pendingBids?: number;
}

/** Agent memory entry from GET /memory/:agentId */
export interface MemoryEntry {
  id: string;
  agentId: string;
  key: string;
  value: string;
  tags: string[];
  memoryType: 'fact' | 'decision' | 'pattern' | 'error';
  relevance: number;
  accessCount: number;
  createdAt: string;
  lastAccessed: string;
}

/** Routing recommendation from POST /routing/classify */
export interface RoutingRecommendation {
  complexity: 'simple' | 'medium' | 'complex';
  strategy: 'direct' | 'supervised' | 'swarm';
  model: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Workflow types
// ---------------------------------------------------------------------------

/** Workflow trigger */
export interface Trigger {
  id: string;
  workflowId: string;
  triggerType: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  createdAt?: string;
}

/** Workflow execution detail */
export interface ExecutionDetail {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  steps?: ExecutionStep[];
  stepCount?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Workflow execution step */
export interface ExecutionStep {
  id: string;
  executionId: string;
  name?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  error?: string;
  output?: unknown;
}

/** Workflow execution event */
export interface ExecutionEvent {
  id: string;
  executionId: string;
  eventType: string;
  data?: Record<string, unknown>;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Checkpoint types
// ---------------------------------------------------------------------------

/** Worker checkpoint */
export interface Checkpoint {
  id: string;
  handle: string;
  status: 'pending' | 'accepted' | 'rejected';
  summary?: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  processedAt?: string;
}

// ---------------------------------------------------------------------------
// Handoff types
// ---------------------------------------------------------------------------

/** Worker handoff */
export interface Handoff {
  id: string;
  fromHandle: string;
  toHandle: string;
  status: 'pending' | 'accepted' | 'completed';
  reason?: string;
  context?: Record<string, unknown>;
  data?: Record<string, unknown>;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Operations types
// ---------------------------------------------------------------------------

/** Wave execution */
export interface Wave {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  phases?: unknown[];
  currentPhase?: number;
  createdAt?: string;
  completedAt?: string;
  error?: string;
}

/** Multi-repo operation */
export interface MultiRepoOp {
  id: string;
  operation: string;
  repos?: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  results?: Record<string, unknown>;
  createdAt?: string;
}

/** Batch of work items */
export interface Batch {
  id: string;
  name?: string;
  status?: 'pending' | 'dispatched' | 'completed' | 'failed';
  workItems?: WorkItem[];
  itemCount?: number;
  createdAt?: string;
}

/** Individual work item */
export interface WorkItem {
  id: string;
  batchId?: string;
  subject?: string;
  description?: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  assignee?: string;
  createdAt?: string;
}

/** Worktree status for a worker */
export interface WorktreeStatus {
  handle: string;
  branch?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  files?: { path: string; status: string }[];
}

// ---------------------------------------------------------------------------
// Search & Analysis types
// ---------------------------------------------------------------------------

/** Search result */
export interface SearchResult {
  sessionId: string;
  score: number;
  title?: string;
  snippet?: string;
}

/** Search index stats */
export interface SearchStats {
  totalDocuments?: number;
  indexSize?: string;
}

/** DAG topological sort result */
export interface DAGSortResult {
  sorted?: string[];
  hasCycles?: boolean;
  cycles?: string[][];
}

/** LMSH translation result */
export interface LMSHTranslation {
  command: string;
  explanation?: string;
}

/** LMSH alias */
export interface LMSHAlias {
  name: string;
  command: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

/** Reusable task template */
export interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  estimatedMinutes?: number;
  role?: string;
  tasks?: unknown[];
}

// ---------------------------------------------------------------------------
// Chat types
// ---------------------------------------------------------------------------

/** Chat session */
export interface Chat {
  id: string;
  participants: string[];
  unreadCount?: number;
  lastMessageAt?: string;
  createdAt?: string;
}

/** Chat message */
export interface ChatMessage {
  id: string;
  chatId: string;
  senderUid: string;
  body: string;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Audit types
// ---------------------------------------------------------------------------

/** Audit loop status */
export interface AuditStatus {
  isRunning: boolean;
  iteration?: number;
  maxIterations?: number;
  startedAt?: string;
  lastCheck?: string;
}

// ---------------------------------------------------------------------------
// Coordination types
// ---------------------------------------------------------------------------

/** Coordination subsystem status */
export interface CoordinationStatus {
  taskSync?: { running: boolean };
  inbox?: { running: boolean };
  discovery?: { running: boolean };
}

/** System health check */
export interface CoordinationHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  subsystems?: Record<string, { healthy: boolean; message?: string }>;
}

// ---------------------------------------------------------------------------
// Webhook types
// ---------------------------------------------------------------------------

/** Webhook event history entry */
export interface WebhookEvent {
  id: string;
  source: string;
  eventType: string;
  payload?: Record<string, unknown>;
  processedAt?: string;
}

/** Webhook configuration status */
export interface WebhookStatus {
  configured: boolean;
  secret?: boolean;
  recentEvents?: number;
}
