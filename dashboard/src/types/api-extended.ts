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

export interface Trigger {
  id: string;
  workflowId: string;
  triggerType: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  createdAt?: string;
}

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

export interface Wave {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  phases?: unknown[];
  currentPhase?: number;
  createdAt?: string;
  completedAt?: string;
  error?: string;
}

export interface MultiRepoOp {
  id: string;
  operation: string;
  repos?: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  results?: Record<string, unknown>;
  createdAt?: string;
}

export interface Batch {
  id: string;
  name?: string;
  status?: 'pending' | 'dispatched' | 'completed' | 'failed';
  workItems?: WorkItem[];
  itemCount?: number;
  createdAt?: string;
}

export interface WorkItem {
  id: string;
  batchId?: string;
  subject?: string;
  description?: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  assignee?: string;
  createdAt?: string;
}

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

export interface SearchResult {
  sessionId: string;
  score: number;
  title?: string;
  snippet?: string;
}

export interface SearchStats {
  totalDocuments?: number;
  indexSize?: string;
}

export interface DAGSortResult {
  sorted?: string[];
  hasCycles?: boolean;
  cycles?: string[][];
}

export interface LMSHTranslation {
  command: string;
  explanation?: string;
}

export interface LMSHAlias {
  name: string;
  command: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

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

export interface Chat {
  id: string;
  participants: string[];
  unreadCount?: number;
  lastMessageAt?: string;
  createdAt?: string;
}

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

export interface CoordinationStatus {
  taskSync?: { running: boolean };
  inbox?: { running: boolean };
  discovery?: { running: boolean };
}

export interface CoordinationHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  subsystems?: Record<string, { healthy: boolean; message?: string }>;
}

// ---------------------------------------------------------------------------
// Webhook types
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  id: string;
  source: string;
  eventType: string;
  payload?: Record<string, unknown>;
  processedAt?: string;
}

export interface WebhookStatus {
  configured: boolean;
  secret?: boolean;
  recentEvents?: number;
}
