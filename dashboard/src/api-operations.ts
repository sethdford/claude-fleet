/**
 * Operations API Client
 * Endpoints for workflows, checkpoints, handoffs, waves, multi-repo,
 * batches, worktrees, audit, search, DAG, LMSH, templates, chats,
 * coordination, and webhooks.
 */

import { request } from './api';
import type {
  Trigger,
  ExecutionDetail,
  ExecutionStep,
  ExecutionEvent,
  Checkpoint,
  Handoff,
  Wave,
  MultiRepoOp,
  Batch,
  WorkItem,
  WorktreeStatus,
  SearchResult,
  SearchStats,
  DAGSortResult,
  LMSHTranslation,
  LMSHAlias,
  Template,
  Chat,
  ChatMessage,
  AuditStatus,
  CoordinationStatus,
  CoordinationHealth,
  WebhookEvent,
  WebhookStatus,
} from './types';

// ---------------------------------------------------------------------------
// Workflows CRUD
// ---------------------------------------------------------------------------

export function createWorkflow(data: { name: string; description?: string; steps?: unknown[] }): Promise<unknown> {
  return request('/workflows', { method: 'POST', body: JSON.stringify(data) });
}

export function getWorkflow(id: string): Promise<unknown> {
  return request(`/workflows/${id}`);
}

export function updateWorkflow(id: string, data: Record<string, unknown>): Promise<unknown> {
  return request(`/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteWorkflow(id: string): Promise<unknown> {
  return request(`/workflows/${id}`, { method: 'DELETE' });
}

export function startWorkflow(id: string): Promise<unknown> {
  return request(`/workflows/${id}/start`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Workflow Triggers
// ---------------------------------------------------------------------------

export function createTrigger(workflowId: string, data: { triggerType: string; config?: Record<string, unknown> }): Promise<unknown> {
  return request(`/workflows/${workflowId}/triggers`, { method: 'POST', body: JSON.stringify(data) });
}

export function getTriggers(workflowId: string): Promise<Trigger[]> {
  return request(`/workflows/${workflowId}/triggers`);
}

export function deleteTrigger(triggerId: string): Promise<unknown> {
  return request(`/triggers/${triggerId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Workflow Executions
// ---------------------------------------------------------------------------

export function getExecutions(params?: { workflowId?: string; status?: string; limit?: number }): Promise<ExecutionDetail[]> {
  const qp = new URLSearchParams();
  if (params?.workflowId) qp.set('workflowId', params.workflowId);
  if (params?.status) qp.set('status', params.status);
  if (params?.limit) qp.set('limit', String(params.limit));
  const qs = qp.toString();
  return request(`/executions${qs ? `?${qs}` : ''}`);
}

export function getExecution(id: string): Promise<ExecutionDetail> {
  return request(`/executions/${id}`);
}

export function pauseExecution(id: string): Promise<unknown> {
  return request(`/executions/${id}/pause`, { method: 'POST' });
}

export function resumeExecution(id: string): Promise<unknown> {
  return request(`/executions/${id}/resume`, { method: 'POST' });
}

export function cancelExecution(id: string): Promise<unknown> {
  return request(`/executions/${id}/cancel`, { method: 'POST' });
}

export function getExecutionSteps(executionId: string): Promise<ExecutionStep[]> {
  return request(`/executions/${executionId}/steps`);
}

export function getExecutionEvents(executionId: string): Promise<ExecutionEvent[]> {
  return request(`/executions/${executionId}/events`);
}

// ---------------------------------------------------------------------------
// Workflow Steps
// ---------------------------------------------------------------------------

export function retryStep(stepId: string): Promise<unknown> {
  return request(`/steps/${stepId}/retry`, { method: 'POST' });
}

export function completeStep(stepId: string): Promise<unknown> {
  return request(`/steps/${stepId}/complete`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export function createCheckpoint(handle: string, data?: Record<string, unknown>): Promise<Checkpoint> {
  return request('/checkpoints', { method: 'POST', body: JSON.stringify({ handle, ...data }) });
}

export function getCheckpoint(id: string): Promise<Checkpoint> {
  return request(`/checkpoints/${id}`);
}

export function getLatestCheckpoint(handle: string): Promise<Checkpoint> {
  return request(`/checkpoints/latest/${handle}`);
}

export function listCheckpoints(handle: string): Promise<Checkpoint[]> {
  return request(`/checkpoints/list/${handle}`);
}

export function acceptCheckpoint(id: string): Promise<unknown> {
  return request(`/checkpoints/${id}/accept`, { method: 'POST' });
}

export function rejectCheckpoint(id: string): Promise<unknown> {
  return request(`/checkpoints/${id}/reject`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------

export function createHandoff(data: { fromHandle: string; toHandle: string; reason?: string; data?: Record<string, unknown> }): Promise<Handoff> {
  return request('/handoffs', { method: 'POST', body: JSON.stringify(data) });
}

export function getHandoffs(handle: string): Promise<Handoff[]> {
  return request(`/handoffs/${handle}`);
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

export function createWave(data: { phases: unknown[] }): Promise<Wave> {
  return request('/orchestrate/waves', { method: 'POST', body: JSON.stringify(data) });
}

export function getWaves(): Promise<Wave[]> {
  return request('/orchestrate/waves');
}

export function getWave(id: string): Promise<Wave> {
  return request(`/orchestrate/waves/${id}`);
}

export function cancelWave(id: string): Promise<unknown> {
  return request(`/orchestrate/waves/${id}/cancel`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Multi-Repo Operations
// ---------------------------------------------------------------------------

export function startMultiRepo(data: { operation: string; repos: string[] }): Promise<MultiRepoOp> {
  return request('/orchestrate/multi-repo', { method: 'POST', body: JSON.stringify(data) });
}

export function getMultiRepoOps(): Promise<MultiRepoOp[]> {
  return request('/orchestrate/multi-repo');
}

export function getMultiRepoOp(id: string): Promise<MultiRepoOp> {
  return request(`/orchestrate/multi-repo/${id}`);
}

export function multiRepoUpdateDeps(repos: string[]): Promise<MultiRepoOp> {
  return request('/orchestrate/multi-repo/update-deps', { method: 'POST', body: JSON.stringify({ repos }) });
}

export function multiRepoSecurityAudit(repos: string[]): Promise<MultiRepoOp> {
  return request('/orchestrate/multi-repo/security-audit', { method: 'POST', body: JSON.stringify({ repos }) });
}

export function multiRepoFormatCode(repos: string[]): Promise<MultiRepoOp> {
  return request('/orchestrate/multi-repo/format-code', { method: 'POST', body: JSON.stringify({ repos }) });
}

export function multiRepoRunTests(repos: string[]): Promise<MultiRepoOp> {
  return request('/orchestrate/multi-repo/run-tests', { method: 'POST', body: JSON.stringify({ repos }) });
}

// ---------------------------------------------------------------------------
// Batches & Work Items
// ---------------------------------------------------------------------------

export function createBatch(data: { name?: string }): Promise<Batch> {
  return request('/batches', { method: 'POST', body: JSON.stringify(data) });
}

export function getBatches(): Promise<Batch[]> {
  return request('/batches');
}

export function getBatch(id: string): Promise<Batch> {
  return request(`/batches/${id}`);
}

export function dispatchBatch(id: string): Promise<unknown> {
  return request(`/batches/${id}/dispatch`, { method: 'POST' });
}

export function createWorkItem(data: { batchId?: string; subject?: string; description?: string }): Promise<WorkItem> {
  return request('/workitems', { method: 'POST', body: JSON.stringify(data) });
}

export function getWorkItems(params?: { status?: string; assignee?: string; batch?: string }): Promise<WorkItem[]> {
  const qp = new URLSearchParams();
  if (params?.status) qp.set('status', params.status);
  if (params?.assignee) qp.set('assignee', params.assignee);
  if (params?.batch) qp.set('batch', params.batch);
  const qs = qp.toString();
  return request(`/workitems${qs ? `?${qs}` : ''}`);
}

export function getWorkItem(id: string): Promise<WorkItem> {
  return request(`/workitems/${id}`);
}

export function updateWorkItem(id: string, data: { status?: string }): Promise<WorkItem> {
  return request(`/workitems/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ---------------------------------------------------------------------------
// Worktree
// ---------------------------------------------------------------------------

export function getWorktreeStatus(handle: string): Promise<WorktreeStatus> {
  return request(`/orchestrate/worktree/${handle}/status`);
}

export function worktreeCommit(handle: string, message: string): Promise<unknown> {
  return request(`/orchestrate/worktree/${handle}/commit`, { method: 'POST', body: JSON.stringify({ message }) });
}

export function worktreePush(handle: string): Promise<unknown> {
  return request(`/orchestrate/worktree/${handle}/push`, { method: 'POST' });
}

export function worktreeCreatePR(handle: string, data: { title: string; body?: string }): Promise<unknown> {
  return request(`/orchestrate/worktree/${handle}/pr`, { method: 'POST', body: JSON.stringify(data) });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function getAuditStatus(): Promise<AuditStatus> {
  return request('/audit/status');
}

export function getAuditOutput(params?: { offset?: number; limit?: number }): Promise<unknown> {
  const qp = new URLSearchParams();
  if (params?.offset !== undefined) qp.set('offset', String(params.offset));
  if (params?.limit !== undefined) qp.set('limit', String(params.limit));
  const qs = qp.toString();
  return request(`/audit/output${qs ? `?${qs}` : ''}`);
}

export function startAudit(options?: { dryRun?: boolean; maxIterations?: number }): Promise<unknown> {
  return request('/audit/start', { method: 'POST', body: JSON.stringify(options ?? {}) });
}

export function stopAudit(): Promise<unknown> {
  return request('/audit/stop', { method: 'POST' });
}

export function quickAudit(): Promise<unknown> {
  return request('/audit/quick', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function search(query: string): Promise<SearchResult[]> {
  return request('/search', { method: 'POST', body: JSON.stringify({ query }) });
}

export function indexSession(sessionId: string, data: Record<string, unknown>): Promise<unknown> {
  return request('/search/index', { method: 'POST', body: JSON.stringify({ sessionId, ...data }) });
}

export function getSearchStats(): Promise<SearchStats> {
  return request('/search/stats');
}

export function deleteSearchSession(sessionId: string): Promise<unknown> {
  return request(`/search/${sessionId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export function dagSort(tasks: { id: string; dependencies?: string[] }[]): Promise<DAGSortResult> {
  return request('/dag/sort', { method: 'POST', body: JSON.stringify({ tasks }) });
}

export function dagCycles(tasks: { id: string; dependencies?: string[] }[]): Promise<{ cycles: string[][] }> {
  return request('/dag/cycles', { method: 'POST', body: JSON.stringify({ tasks }) });
}

export function dagCriticalPath(tasks: { id: string; dependencies?: string[]; duration?: number }[]): Promise<unknown> {
  return request('/dag/critical-path', { method: 'POST', body: JSON.stringify({ tasks }) });
}

export function dagReady(tasks: { id: string; dependencies?: string[]; status?: string }[]): Promise<{ ready: string[] }> {
  return request('/dag/ready', { method: 'POST', body: JSON.stringify({ tasks }) });
}

// ---------------------------------------------------------------------------
// LMSH
// ---------------------------------------------------------------------------

export function lmshTranslate(input: string): Promise<LMSHTranslation> {
  return request('/lmsh/translate', { method: 'POST', body: JSON.stringify({ input }) });
}

export function lmshGetAliases(): Promise<LMSHAlias[]> {
  return request('/lmsh/aliases');
}

export function lmshCreateAlias(data: { name: string; command: string; description?: string }): Promise<LMSHAlias> {
  return request('/lmsh/aliases', { method: 'POST', body: JSON.stringify(data) });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function getTemplates(params?: { category?: string }): Promise<Template[]> {
  const qp = new URLSearchParams();
  if (params?.category) qp.set('category', params.category);
  const qs = qp.toString();
  return request(`/workflows?isTemplate=true${qs ? `&${qs}` : ''}`);
}

export function getTemplate(id: string): Promise<Template> {
  return request(`/workflows/${id}`);
}

export function createTemplate(data: { name: string; description?: string; category?: string; tasks?: unknown[] }): Promise<Template> {
  return request('/workflows', { method: 'POST', body: JSON.stringify({ ...data, isTemplate: true }) });
}

export function updateTemplate(id: string, data: Record<string, unknown>): Promise<Template> {
  return request(`/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteTemplate(id: string): Promise<unknown> {
  return request(`/workflows/${id}`, { method: 'DELETE' });
}

export function executeTemplate(id: string): Promise<unknown> {
  return request(`/workflows/${id}/start`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export function createChat(participants: string[]): Promise<Chat> {
  return request('/chats', { method: 'POST', body: JSON.stringify({ participants }) });
}

export function getChatMessages(chatId: string, params?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
  const qp = new URLSearchParams();
  if (params?.limit) qp.set('limit', String(params.limit));
  if (params?.before) qp.set('before', params.before);
  const qs = qp.toString();
  return request(`/chats/${chatId}/messages${qs ? `?${qs}` : ''}`);
}

export function sendChatMessage(chatId: string, body: string): Promise<ChatMessage> {
  return request(`/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
}

export function markChatRead(chatId: string): Promise<unknown> {
  return request(`/chats/${chatId}/read`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function getUserDetail(uid: string): Promise<unknown> {
  return request(`/users/${uid}`);
}

export function getUserChats(uid: string): Promise<Chat[]> {
  return request(`/users/${uid}/chats`);
}

export function getTeamAgents(teamName: string): Promise<unknown[]> {
  return request(`/teams/${teamName}/agents`);
}

// ---------------------------------------------------------------------------
// Coordination
// ---------------------------------------------------------------------------

export function getCoordinationStatus(): Promise<CoordinationStatus> {
  return request('/coordination/status');
}

export function getCoordinationHealth(): Promise<CoordinationHealth> {
  return request('/coordination/health');
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export function getWebhookStatus(): Promise<WebhookStatus> {
  return request('/webhooks/status');
}

export function getWebhookHistory(): Promise<WebhookEvent[]> {
  return request('/webhooks/history');
}

// ---------------------------------------------------------------------------
// Compound
// ---------------------------------------------------------------------------

export function getCompoundSnapshot(): Promise<unknown> {
  return request('/compound/snapshot');
}

// ---------------------------------------------------------------------------
// Worker extras
// ---------------------------------------------------------------------------

export function injectWorkerOutput(handle: string, output: unknown): Promise<unknown> {
  return request(`/orchestrate/workers/${handle}/output`, { method: 'POST', body: JSON.stringify({ output }) });
}

// ---------------------------------------------------------------------------
// Scheduler (extended)
// ---------------------------------------------------------------------------

export function createSchedule(data: { name: string; cron: string; repository?: string; tasks?: unknown[] }): Promise<unknown> {
  return request('/scheduler/schedules', { method: 'POST', body: JSON.stringify(data) });
}

export function enqueueTask(data: { name: string; repository?: string; priority?: string }): Promise<unknown> {
  return request('/scheduler/queue', { method: 'POST', body: JSON.stringify(data) });
}

export function configureNotifications(config: Record<string, unknown>): Promise<unknown> {
  return request('/scheduler/notifications', { method: 'POST', body: JSON.stringify(config) });
}

export function testNotification(): Promise<unknown> {
  return request('/scheduler/notifications/test', { method: 'POST' });
}

export function enableNotifications(): Promise<unknown> {
  return request('/scheduler/notifications/enable', { method: 'POST' });
}

export function disableNotifications(): Promise<unknown> {
  return request('/scheduler/notifications/disable', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Blackboard archive
// ---------------------------------------------------------------------------

export function archiveBlackboard(swarmId: string): Promise<unknown> {
  return request(`/swarm-intelligence/${swarmId}/blackboard/archive`, { method: 'POST' });
}

export function archiveOldMessages(swarmId: string, olderThanMs?: number): Promise<unknown> {
  const body = olderThanMs !== undefined ? JSON.stringify({ olderThanMs }) : undefined;
  return request(`/swarm-intelligence/${swarmId}/blackboard/archive-old`, { method: 'POST', body });
}
