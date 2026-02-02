/**
 * API Client for Claude Fleet Server
 * Handles authentication and all HTTP requests.
 * All URLs are relative — no window.location.origin prefix needed.
 */

import type {
  AuthResponse,
  UserInfo,
  WorkerInfo,
  SwarmInfo,
  TeamTask,
  ServerMetrics,
  BlackboardMessage,
  SpawnQueueStatus,
  GraphData,
  TLDRStats,
  MailMessage,
  MemoryEntry,
  RoutingRecommendation,
} from '@/types';

/** Valid blackboard message types (from schema) */
export const MESSAGE_TYPES = ['request', 'response', 'status', 'directive', 'checkpoint'] as const;
export const MESSAGE_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;

const TOKEN_KEY = 'fleet_token';
const USER_KEY = 'fleet_user';

// Auth helpers

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): UserInfo | null {
  const raw = localStorage.getItem(USER_KEY);
  try {
    return raw ? (JSON.parse(raw) as UserInfo) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Generic request helper

const DEFAULT_TIMEOUT_MS = 30_000;

export async function request<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    response = await fetch(endpoint, { ...options, headers, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('Request timed out');
    }
    throw new Error(`Network error: ${(err as Error).message}`);
  }

  if (response.status === 401) {
    logout();
    window.dispatchEvent(new CustomEvent('auth:logout'));
    throw new Error('Session expired');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${response.status}`);
  }

  const text = await response.text();
  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return { raw: text } as T;
  }
}

// Auth

export async function login(handle: string, teamName: string, agentType = 'team-lead'): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/auth', {
    method: 'POST',
    body: JSON.stringify({ handle, teamName, agentType }),
  });

  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, JSON.stringify({
    uid: data.uid,
    handle: data.handle,
    teamName: data.teamName,
    agentType: data.agentType,
  } satisfies UserInfo));

  return data;
}

// Health & Metrics

export async function getHealth(): Promise<unknown> {
  return request('/health');
}

export async function getMetrics(): Promise<ServerMetrics> {
  return request<ServerMetrics>('/metrics/json');
}

// Workers

export async function getWorkers(): Promise<WorkerInfo[]> {
  return request<WorkerInfo[]>('/orchestrate/workers');
}

export async function getWorkerOutput(handle: string, since = 0): Promise<unknown> {
  return request(`/orchestrate/output/${encodeURIComponent(handle)}?since=${since}`);
}

export async function sendToWorker(handle: string, message: string): Promise<unknown> {
  return request(`/orchestrate/send/${encodeURIComponent(handle)}`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function dismissWorker(handle: string): Promise<unknown> {
  return request(`/orchestrate/dismiss/${encodeURIComponent(handle)}`, { method: 'POST' });
}

export interface SpawnWorkerOptions {
  teamName?: string;
  workingDir?: string;
  sessionId?: string;
  swarmId?: string;
}

export async function spawnWorker(
  handle: string,
  initialPrompt?: string,
  options: SpawnWorkerOptions = {},
): Promise<unknown> {
  const body: Record<string, unknown> = { handle, ...options };
  if (initialPrompt) body.initialPrompt = initialPrompt;
  return request('/orchestrate/spawn', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// External Workers (Connections)

export async function generateConnectionToken(
  handle: string,
  teamName: string,
): Promise<AuthResponse> {
  return request<AuthResponse>('/auth', {
    method: 'POST',
    body: JSON.stringify({ handle, teamName, agentType: 'worker' }),
  });
}

export interface RegisterExternalWorkerPayload {
  handle: string;
  teamName?: string;
  workingDir?: string;
  swarmId?: string;
}

export async function registerExternalWorker(
  payload: RegisterExternalWorkerPayload,
): Promise<unknown> {
  return request('/orchestrate/workers/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Swarms

export async function getSwarms(includeAgents = true): Promise<SwarmInfo[]> {
  const query = includeAgents ? '?includeAgents=true' : '';
  return request<SwarmInfo[]>(`/swarms${query}`);
}

export async function getSwarm(swarmId: string): Promise<SwarmInfo> {
  return request<SwarmInfo>(`/swarms/${encodeURIComponent(swarmId)}`);
}

export async function createSwarm(name: string, description?: string, maxAgents = 50): Promise<SwarmInfo> {
  return request<SwarmInfo>('/swarms', {
    method: 'POST',
    body: JSON.stringify({ name, description, maxAgents }),
  });
}

export async function killSwarm(swarmId: string): Promise<unknown> {
  return request(`/swarms/${encodeURIComponent(swarmId)}/kill`, { method: 'POST' });
}

// Blackboard

export interface BlackboardQueryOptions {
  limit?: number;
  messageType?: string;
  priority?: string;
  unreadOnly?: boolean;
  readerHandle?: string;
}

export async function getBlackboard(swarmId: string, options: BlackboardQueryOptions = {}): Promise<BlackboardMessage[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.messageType) params.set('messageType', options.messageType);
  if (options.priority) params.set('priority', options.priority);
  if (options.unreadOnly) params.set('unreadOnly', 'true');
  if (options.readerHandle) params.set('readerHandle', options.readerHandle);
  const query = params.toString() ? `?${params}` : '';
  return request<BlackboardMessage[]>(`/blackboard/${encodeURIComponent(swarmId)}${query}`);
}

export async function postBlackboard(
  swarmId: string,
  payload: unknown,
  messageType = 'status',
  targetHandle: string | null = null,
  priority = 'normal',
): Promise<BlackboardMessage> {
  const user = getUser();
  const body: Record<string, unknown> = {
    swarmId,
    senderHandle: user?.handle ?? 'dashboard',
    messageType,
    payload: typeof payload === 'string' ? { message: payload } : payload,
    priority,
  };
  if (targetHandle) body.targetHandle = targetHandle;
  return request<BlackboardMessage>('/blackboard', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function markBlackboardRead(messageIds: string[], readerHandle: string): Promise<unknown> {
  return request('/blackboard/mark-read', {
    method: 'POST',
    body: JSON.stringify({ messageIds, readerHandle }),
  });
}

// Spawn Queue

export async function getSpawnQueue(): Promise<SpawnQueueStatus> {
  return request<SpawnQueueStatus>('/spawn-queue/status');
}

// Tasks

export async function getTasks(teamName: string): Promise<TeamTask[]> {
  return request<TeamTask[]>(`/teams/${encodeURIComponent(teamName)}/tasks`);
}

export async function getTask(taskId: string): Promise<TeamTask> {
  return request<TeamTask>(`/tasks/${encodeURIComponent(taskId)}`);
}

export async function updateTask(taskId: string, status: string): Promise<TeamTask> {
  return request<TeamTask>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export interface CreateTaskPayload {
  fromUid: string;
  toHandle: string;
  teamName: string;
  subject: string;
  description?: string;
}

export async function createTask(payload: CreateTaskPayload): Promise<TeamTask> {
  return request<TeamTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// TLDR / Dependency Graph

export async function getDependencyGraph(rootFiles: string[] = [], depth = 3): Promise<GraphData> {
  if (!rootFiles || rootFiles.length === 0) {
    const stats = await getTLDRStats();
    if (!stats.summaries || stats.summaries === 0) {
      return { nodes: [], edges: [], nodeCount: 0, edgeCount: 0 };
    }
    return { nodes: [], edges: [], nodeCount: 0, edgeCount: 0, error: 'No rootFiles provided' };
  }

  return request<GraphData>('/tldr/dependency/graph', {
    method: 'POST',
    body: JSON.stringify({ rootFiles, depth }),
  });
}

export async function getTLDRStats(): Promise<TLDRStats> {
  return request<TLDRStats>('/tldr/stats');
}

export async function getFileSummary(filePath: string): Promise<unknown> {
  return request('/tldr/summary/get', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  });
}

export async function getFileSummaries(filePaths: string[]): Promise<unknown> {
  return request('/tldr/summary/batch', {
    method: 'POST',
    body: JSON.stringify({ filePaths }),
  });
}

export async function getDependencies(filePath: string): Promise<unknown> {
  return request('/tldr/dependency/dependencies', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  });
}

export async function getDependents(filePath: string): Promise<unknown> {
  return request('/tldr/dependency/dependents', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  });
}

// Scheduler

export async function getSchedulerStatus(): Promise<unknown> {
  return request('/scheduler/status');
}

export async function startScheduler(): Promise<unknown> {
  return request('/scheduler/start', { method: 'POST' });
}

export async function stopScheduler(): Promise<unknown> {
  return request('/scheduler/stop', { method: 'POST' });
}

export async function getSchedules(): Promise<unknown[]> {
  return request<unknown[]>('/scheduler/schedules');
}

export async function loadDefaultSchedules(): Promise<unknown> {
  return request('/scheduler/schedules/load-defaults', { method: 'POST' });
}

export async function toggleSchedule(scheduleId: string, enabled: boolean): Promise<unknown> {
  const action = enabled ? 'enable' : 'disable';
  return request(`/scheduler/schedules/${encodeURIComponent(scheduleId)}/${action}`, {
    method: 'PATCH',
  });
}

export async function deleteSchedule(scheduleId: string): Promise<unknown> {
  return request(`/scheduler/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' });
}

export async function getQueue(): Promise<unknown> {
  return request<unknown>('/scheduler/queue');
}

export async function cancelQueueTask(taskId: string): Promise<unknown> {
  return request(`/scheduler/queue/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export async function getTemplates(): Promise<unknown[]> {
  return request<unknown[]>('/scheduler/templates');
}

// Mail

export async function getMail(handle: string): Promise<unknown[]> {
  return request<unknown[]>(`/mail/${encodeURIComponent(handle)}`);
}

export async function sendMail(to: string, subject: string, body: string): Promise<unknown> {
  const user = getUser();
  return request('/mail', {
    method: 'POST',
    body: JSON.stringify({
      from: user?.handle ?? 'dashboard',
      to,
      subject,
      body,
    }),
  });
}

export async function getMailUnread(handle: string): Promise<MailMessage[]> {
  return request<MailMessage[]>(`/mail/${encodeURIComponent(handle)}/unread`);
}

export async function markMailRead(mailId: string): Promise<unknown> {
  return request(`/mail/${encodeURIComponent(mailId)}/read`, { method: 'POST' });
}

// Workflows

export async function getWorkflows(): Promise<unknown[]> {
  return request<unknown[]>('/workflows');
}

export async function getExecutions(): Promise<unknown[]> {
  return request<unknown[]>('/executions');
}

export async function startWorkflow(workflowId: string): Promise<unknown> {
  return request(`/workflows/${encodeURIComponent(workflowId)}/start`, { method: 'POST' });
}

export async function pauseExecution(executionId: string): Promise<unknown> {
  return request(`/executions/${encodeURIComponent(executionId)}/pause`, { method: 'POST' });
}

export async function resumeExecution(executionId: string): Promise<unknown> {
  return request(`/executions/${encodeURIComponent(executionId)}/resume`, { method: 'POST' });
}

export async function cancelExecution(executionId: string): Promise<unknown> {
  return request(`/executions/${encodeURIComponent(executionId)}/cancel`, { method: 'POST' });
}

// Memory

export async function listMemories(agentId: string, limit = 50): Promise<{ memories: MemoryEntry[] }> {
  return request<{ memories: MemoryEntry[] }>(`/memory/${encodeURIComponent(agentId)}?limit=${limit}`);
}

export async function recallMemory(agentId: string, key: string): Promise<MemoryEntry> {
  return request<MemoryEntry>(`/memory/recall/${encodeURIComponent(agentId)}/${encodeURIComponent(key)}`);
}

export async function storeMemory(agentId: string, key: string, value: string, memoryType?: string, tags?: string[]): Promise<MemoryEntry> {
  return request<MemoryEntry>('/memory/store', {
    method: 'POST',
    body: JSON.stringify({ agentId, key, value, memoryType, tags }),
  });
}

export async function searchMemories(agentId: string, query: string, limit?: number): Promise<{ results: MemoryEntry[] }> {
  return request<{ results: MemoryEntry[] }>('/memory/search', {
    method: 'POST',
    body: JSON.stringify({ agentId, query, limit }),
  });
}

// Routing

export async function classifyTask(subject: string, description?: string): Promise<RoutingRecommendation> {
  return request<RoutingRecommendation>('/routing/classify', {
    method: 'POST',
    body: JSON.stringify({ subject, description }),
  });
}

// Debug

export async function getDebugInfo(): Promise<unknown> {
  return request('/debug');
}
