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
  PheromoneTrail,
  HotResource,
  PheromoneStats,
  Belief,
  BeliefStats,
  CreditAccount,
  CreditStats,
  Consensus,
  ConsensusStats,
  Proposal,
  Bid,
  BiddingStats,
} from '@/types';

/** Valid blackboard message types (from schema) */
export const MESSAGE_TYPES = ['request', 'response', 'status', 'directive', 'checkpoint'] as const;
export const MESSAGE_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;

const TOKEN_KEY = 'fleet_token';
const USER_KEY = 'fleet_user';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Generic request helper
// ---------------------------------------------------------------------------

async function request<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
    response = await fetch(endpoint, { ...options, headers });
  } catch (err) {
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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Health & Metrics
// ---------------------------------------------------------------------------

export async function getHealth(): Promise<unknown> {
  return request('/health');
}

export async function getMetrics(): Promise<ServerMetrics> {
  return request<ServerMetrics>('/metrics/json');
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Swarms
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Blackboard
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Spawn Queue
// ---------------------------------------------------------------------------

export async function getSpawnQueue(): Promise<SpawnQueueStatus> {
  return request<SpawnQueueStatus>('/spawn-queue/status');
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// TLDR / Dependency Graph
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pheromones
// ---------------------------------------------------------------------------

export interface PheromoneQueryOptions {
  resourceType?: string;
  trailType?: string;
  limit?: number;
}

export async function getPheromones(swarmId: string, options: PheromoneQueryOptions = {}): Promise<PheromoneTrail[]> {
  const params = new URLSearchParams();
  if (options.resourceType) params.set('resourceType', options.resourceType);
  if (options.trailType) params.set('trailType', options.trailType);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString() ? `?${params}` : '';
  return request<PheromoneTrail[]>(`/pheromones/${encodeURIComponent(swarmId)}${query}`);
}

export async function depositPheromone(
  swarmId: string,
  resourceId: string,
  resourceType: string,
  trailType: string,
  intensity = 1.0,
  metadata: Record<string, unknown> = {},
): Promise<PheromoneTrail> {
  const user = getUser();
  return request<PheromoneTrail>('/pheromones', {
    method: 'POST',
    body: JSON.stringify({
      swarmId,
      depositorHandle: user?.handle ?? 'dashboard',
      resourceId,
      resourceType,
      trailType,
      intensity,
      metadata,
    }),
  });
}

export async function getHotResources(swarmId: string, limit = 10): Promise<HotResource[]> {
  return request<HotResource[]>(`/pheromones/${encodeURIComponent(swarmId)}/activity?limit=${limit}`);
}

export async function getPheromoneStats(swarmId: string): Promise<PheromoneStats> {
  return request<PheromoneStats>(`/pheromones/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Beliefs
// ---------------------------------------------------------------------------

export interface BeliefQueryOptions {
  subject?: string;
  beliefType?: string;
}

export async function getBeliefs(swarmId: string, handle: string, options: BeliefQueryOptions = {}): Promise<Belief[]> {
  const params = new URLSearchParams();
  if (options.subject) params.set('subject', options.subject);
  if (options.beliefType) params.set('beliefType', options.beliefType);
  const query = params.toString() ? `?${params}` : '';
  return request<Belief[]>(`/beliefs/${encodeURIComponent(swarmId)}/${encodeURIComponent(handle)}${query}`);
}

export async function upsertBelief(
  swarmId: string,
  subject: string,
  beliefType: string,
  beliefValue: string,
  confidence = 0.8,
  evidence: string[] = [],
): Promise<Belief> {
  const user = getUser();
  return request<Belief>('/beliefs', {
    method: 'POST',
    body: JSON.stringify({
      swarmId,
      agentHandle: user?.handle ?? 'dashboard',
      subject,
      beliefType,
      beliefValue,
      confidence,
      evidence,
    }),
  });
}

export async function getConsensus(swarmId: string, subject: string): Promise<Consensus> {
  return request<Consensus>(`/beliefs/${encodeURIComponent(swarmId)}/consensus/${encodeURIComponent(subject)}`);
}

export async function getBeliefStats(swarmId: string): Promise<BeliefStats> {
  return request<BeliefStats>(`/beliefs/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Credits & Reputation
// ---------------------------------------------------------------------------

export async function getCredits(swarmId: string, handle: string): Promise<CreditAccount> {
  return request<CreditAccount>(`/credits/${encodeURIComponent(swarmId)}/${encodeURIComponent(handle)}`);
}

export async function getLeaderboard(swarmId: string, limit = 10): Promise<CreditAccount[]> {
  return request<CreditAccount[]>(`/credits/${encodeURIComponent(swarmId)}/leaderboard?limit=${limit}`);
}

export async function transferCredits(
  swarmId: string,
  toHandle: string,
  amount: number,
  description = '',
): Promise<unknown> {
  const user = getUser();
  return request('/credits/transfer', {
    method: 'POST',
    body: JSON.stringify({
      swarmId,
      fromHandle: user?.handle ?? 'dashboard',
      toHandle,
      amount,
      description,
    }),
  });
}

export async function getCreditStats(swarmId: string): Promise<CreditStats> {
  return request<CreditStats>(`/credits/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Consensus Proposals
// ---------------------------------------------------------------------------

export interface ProposalQueryOptions {
  status?: string;
  limit?: number;
}

export async function getProposals(swarmId: string, options: ProposalQueryOptions = {}): Promise<Proposal[]> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString() ? `?${params}` : '';
  return request<Proposal[]>(`/consensus/${encodeURIComponent(swarmId)}/proposals${query}`);
}

export async function createProposal(
  swarmId: string,
  title: string,
  description: string,
  options: string[],
  proposalType: 'decision' | 'election' | 'approval' | 'ranking' | 'allocation' = 'decision',
  deadlineMs: number | null = null,
): Promise<Proposal> {
  const user = getUser();
  const body: Record<string, unknown> = {
    swarmId,
    proposerHandle: user?.handle ?? 'dashboard',
    proposalType,
    title,
    description,
    options,
  };
  if (deadlineMs) body.deadlineMs = deadlineMs;
  return request<Proposal>('/consensus/proposals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getProposal(proposalId: string): Promise<Proposal> {
  return request<Proposal>(`/consensus/proposals/${encodeURIComponent(proposalId)}`);
}

export async function voteOnProposal(
  proposalId: string,
  voteValue: string,
  rationale = '',
): Promise<unknown> {
  const user = getUser();
  return request(`/consensus/proposals/${encodeURIComponent(proposalId)}/vote`, {
    method: 'POST',
    body: JSON.stringify({
      voterHandle: user?.handle ?? 'dashboard',
      voteValue,
      rationale: rationale || undefined,
    }),
  });
}

export async function closeProposal(proposalId: string): Promise<unknown> {
  return request(`/consensus/proposals/${encodeURIComponent(proposalId)}/close`, { method: 'POST' });
}

export async function getConsensusStats(swarmId: string): Promise<ConsensusStats> {
  return request<ConsensusStats>(`/consensus/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

export interface BidQueryOptions {
  status?: string;
}

export async function getBids(taskId: string, options: BidQueryOptions = {}): Promise<Bid[]> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  const query = params.toString() ? `?${params}` : '';
  return request<Bid[]>(`/bids/task/${encodeURIComponent(taskId)}${query}`);
}

export async function submitBid(
  swarmId: string,
  taskId: string,
  amount: number,
  estimatedDuration: number | null = null,
  rationale = '',
): Promise<Bid> {
  const user = getUser();
  const body: Record<string, unknown> = {
    swarmId,
    taskId,
    bidderHandle: user?.handle ?? 'dashboard',
    bidAmount: amount,
    rationale,
  };
  if (estimatedDuration) body.estimatedDuration = estimatedDuration;
  return request<Bid>('/bids', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function acceptBid(bidId: string): Promise<unknown> {
  return request(`/bids/${encodeURIComponent(bidId)}/accept`, { method: 'POST' });
}

export async function withdrawBid(bidId: string): Promise<unknown> {
  return request(`/bids/${encodeURIComponent(bidId)}`, { method: 'DELETE' });
}

export async function runAuction(taskId: string, auctionType = 'first_price'): Promise<unknown> {
  return request(`/bids/task/${encodeURIComponent(taskId)}/auction`, {
    method: 'POST',
    body: JSON.stringify({ auctionType }),
  });
}

export async function getBiddingStats(swarmId: string): Promise<BiddingStats> {
  return request<BiddingStats>(`/bids/${encodeURIComponent(swarmId)}/stats`);
}

// ---------------------------------------------------------------------------
// Payoffs
// ---------------------------------------------------------------------------

export async function getPayoffs(taskId: string): Promise<unknown> {
  return request(`/payoffs/${encodeURIComponent(taskId)}`);
}

export async function definePayoff(
  swarmId: string,
  taskId: string,
  payoffType: string,
  baseValue: number,
  decayRate = 0.0,
  bonusConditions: Record<string, unknown> = {},
): Promise<unknown> {
  return request('/payoffs', {
    method: 'POST',
    body: JSON.stringify({ swarmId, taskId, payoffType, baseValue, decayRate, bonusConditions }),
  });
}

export async function calculatePayoff(taskId: string): Promise<unknown> {
  return request(`/payoffs/${encodeURIComponent(taskId)}/calculate`);
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

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

export async function markMailRead(mailId: string): Promise<unknown> {
  return request(`/mail/${encodeURIComponent(mailId)}/read`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------

export async function getDebugInfo(): Promise<unknown> {
  return request('/debug');
}
