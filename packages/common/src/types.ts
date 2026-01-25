/**
 * Core type definitions shared across all packages
 */

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  id: string;
  projectPath: string;
  createdAt: number;
  lastAccessed: number;
  messageCount: number;
  totalTokens: number;
  summary?: string;
  tags?: string[];
  lineage?: {
    parentId: string;
    depth: number;
  };
}

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export type ResumeStrategy = 'full' | 'smart-trim' | 'summary-only' | 'recent';

// ============================================================================
// Worker Types
// ============================================================================

export type WorkerStatus = 'pending' | 'ready' | 'busy' | 'error' | 'dismissed';

export type WorkerRole =
  | 'coordinator'
  | 'worker'
  | 'scout'
  | 'kraken'
  | 'oracle'
  | 'critic'
  | 'architect'
  | 'merger'
  | 'monitor'
  | 'notifier';

export interface Worker {
  id: string;
  handle: string;
  status: WorkerStatus;
  role?: WorkerRole;
  worktreePath?: string;
  worktreeBranch?: string;
  pid?: number;
  sessionId?: string;
  initialPrompt?: string;
  lastHeartbeat: number;
  restartCount: number;
  createdAt: number;
  dismissedAt?: number;
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TaskPriority = 1 | 2 | 3 | 4 | 5;

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: string;
  createdBy?: string;
  dueAt?: number;
  completedAt?: number;
  createdAt: number;
}

// ============================================================================
// Bead Types (Structured Work Tracking)
// ============================================================================

export type BeadStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Bead {
  id: string;
  title: string;
  description?: string;
  status: BeadStatus;
  assignedTo?: string;
  convoyId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
}

export interface Convoy {
  id: string;
  name: string;
  description?: string;
  status: 'open' | 'closed';
  createdAt: number;
  closedAt?: number;
}

// ============================================================================
// Blackboard Types
// ============================================================================

export interface BlackboardMessage {
  id: number;
  topic: string;
  message: string;
  from?: string;
  priority: number;
  expiresAt?: number;
  createdAt: number;
}

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface Checkpoint {
  id: string;
  workerHandle: string;
  goal: string;
  worked?: string[];
  remaining?: string[];
  context?: Record<string, unknown>;
  createdAt: number;
}

// ============================================================================
// Workflow Types
// ============================================================================

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'task' | 'spawn' | 'checkpoint' | 'gate' | 'parallel' | 'script';
  config: Record<string, unknown>;
  dependsOn?: string[];
  timeout?: number;
  retries?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  context?: Record<string, unknown>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ============================================================================
// Safety Types
// ============================================================================

export type SafetySeverity = 'warning' | 'error' | 'critical';

export interface ValidationContext {
  operation: 'bash_command' | 'file_read' | 'file_write' | 'file_delete' | 'git_commit' | 'env_access';
  command?: string;
  filePath?: string;
  content?: string;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  suggestions?: string[];
  severity?: SafetySeverity;
}

export interface SafetyHook {
  id: string;
  description: string;
  enabled: boolean;
  validator: (context: ValidationContext) => ValidationResult;
}

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  warnings: string[];
  suggestions?: string[];
  blockedBy?: string;
}

export interface SafetyStatus {
  hooks: Array<{
    id: string;
    description: string;
    enabled: boolean;
  }>;
}

// ============================================================================
// API Types
// ============================================================================

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  workers?: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
}

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}
