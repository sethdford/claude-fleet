#!/usr/bin/env node
/**
 * Claude Fleet CLI
 *
 * Administrative and testing CLI for the fleet orchestration server.
 */

import { parseArgs } from 'node:util';
import { execSync, spawn } from 'node:child_process';
import {
  handleSchema,
  teamNameSchema,
  workItemStatusSchema,
  taskStatusSchema,
  messageTypeSchema,
} from './validation/schemas.js';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const DEFAULT_URL = process.env.CLAUDE_FLEET_URL ?? 'http://localhost:3847';
const VERSION = pkg.version;

// ============================================================================
// JWT HELPER
// ============================================================================

interface JwtPayload {
  uid: string;
  handle: string;
  teamName: string;
  agentType: string;
}

/**
 * Decode JWT payload without verification (for extracting user info).
 * The server still verifies the token signature on each request.
 */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface CliOptions {
  url: string;
  token?: string;
  verbose?: boolean;
  table?: boolean;
}

interface TableColumn {
  header: string;
  key: string;
  width?: number;
}

// ============================================================================
// OUTPUT HELPERS
// ============================================================================

function formatTable<T extends Record<string, unknown>>(
  data: T[],
  columns: TableColumn[]
): string {
  if (data.length === 0) return '(no data)';

  // Calculate column widths
  const widths = columns.map(col => {
    const headerLen = col.header.length;
    const maxDataLen = Math.max(
      ...data.map(row => String(row[col.key] ?? '').length)
    );
    return col.width ?? Math.max(headerLen, maxDataLen, 8);
  });

  // Build header
  const header = columns.map((col, i) => col.header.padEnd(widths[i])).join(' | ');
  const separator = widths.map(w => '-'.repeat(w)).join('-+-');

  // Build rows
  const rows = data.map(row =>
    columns.map((col, i) => String(row[col.key] ?? '').padEnd(widths[i])).join(' | ')
  );

  return [header, separator, ...rows].join('\n');
}

function outputResult(data: unknown, _options: CliOptions): void {
  console.log(JSON.stringify(data, null, 2));
}

function outputList<T extends Record<string, unknown>>(
  data: T[],
  columns: TableColumn[],
  options: CliOptions
): void {
  if (options.table) {
    console.log(formatTable(data, columns));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validateHandle(value: string, fieldName = 'handle'): void {
  const result = handleSchema.safeParse(value);
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'Invalid format';
    console.error(`Invalid ${fieldName}: ${msg}`);
    console.error('  Expected: 1-50 alphanumeric characters with dashes/underscores');
    process.exit(1);
  }
}

function validateTeamName(value: string): void {
  const result = teamNameSchema.safeParse(value);
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'Invalid format';
    console.error(`Invalid team name: ${msg}`);
    console.error('  Expected: 1-50 alphanumeric characters with dashes/underscores');
    process.exit(1);
  }
}

function validateWorkItemStatus(value: string): void {
  const result = workItemStatusSchema.safeParse(value);
  if (!result.success) {
    console.error(`Invalid status: ${value}`);
    console.error('  Valid statuses: pending, in_progress, completed, blocked, cancelled');
    process.exit(1);
  }
}

function validateTaskStatus(value: string): void {
  const result = taskStatusSchema.safeParse(value);
  if (!result.success) {
    console.error(`Invalid task status: ${value}`);
    console.error('  Valid statuses: open, in_progress, resolved, blocked');
    process.exit(1);
  }
}

function validateMessageType(value: string): void {
  const result = messageTypeSchema.safeParse(value);
  if (!result.success) {
    console.error(`Invalid message type: ${value}`);
    console.error('  Valid types: request, response, status, directive, checkpoint');
    process.exit(1);
  }
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

async function request(
  method: string,
  path: string,
  options: CliOptions,
  body?: unknown
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const url = `${options.url}${path}`;

  if (options.verbose) {
    console.error(`[verbose] ${method} ${url}`);
    if (body) {
      console.error(`[verbose] Body: ${JSON.stringify(body)}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      throw new Error(
        'Cannot connect to server at ' + options.url + '\n' +
        '  Is the server running? Try: npm run start'
      );
    }
    throw new Error(`Network error: ${err.message}`);
  }

  if (options.verbose) {
    console.error(`[verbose] Status: ${response.status} ${response.statusText}`);
  }

  let data: unknown;
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      throw new Error(
        'Server returned invalid JSON (status ' + response.status + ')\n' +
        '  This may indicate a server error. Check server logs.'
      );
    }
  } else {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Server returned non-JSON response (status ${response.status})\n` +
        `  Response: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`
      );
    }
    data = { text };
  }

  if (!response.ok) {
    const errorMsg = (data as { error?: string }).error ?? `HTTP ${response.status}`;
    throw new Error(errorMsg);
  }

  return data;
}

// ============================================================================
// COMMANDS: MCP
// ============================================================================

async function cmdMcpInstall(options: CliOptions): Promise<void> {
  console.log('Installing Claude Fleet MCP server...\n');

  // Build the MCP config JSON
  const mcpConfig = {
    command: 'npx',
    args: ['-y', 'claude-fleet', 'mcp-server'],
    env: {
      CLAUDE_FLEET_URL: options.url,
    },
  };

  const configJson = JSON.stringify(mcpConfig);

  try {
    // Use claude CLI to add the MCP server
    execSync(`claude mcp add-json "claude-fleet" '${configJson}'`, {
      stdio: 'inherit',
    });

    console.log('\n✓ Claude Fleet MCP server installed successfully!');
    console.log('\nThe MCP server provides 82 tools for fleet coordination:');
    console.log('  • Team management (status, broadcast, spawn, dismiss)');
    console.log('  • Task/work item management');
    console.log('  • Mail and handoffs between agents');
    console.log('  • Swarm intelligence (pheromones, beliefs, credits)');
    console.log('  • Workflow orchestration');
    console.log('  • And more...');
    console.log('\nRestart Claude Code to activate the MCP tools.');
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('command not found') || err.message.includes('ENOENT')) {
      console.error('Error: Claude CLI not found.');
      console.error('\nManual installation:');
      console.error('  1. Open Claude Code settings');
      console.error('  2. Add to MCP servers:');
      console.error(`     ${JSON.stringify({ 'claude-fleet': mcpConfig }, null, 2)}`);
    } else {
      throw err;
    }
  }
}

async function cmdMcpUninstall(_options: CliOptions): Promise<void> {
  console.log('Removing Claude Fleet MCP server...');

  try {
    execSync('claude mcp remove claude-fleet', { stdio: 'inherit' });
    console.log('\n✓ Claude Fleet MCP server removed.');
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('command not found') || err.message.includes('ENOENT')) {
      console.error('Error: Claude CLI not found. Remove manually from settings.');
    } else {
      throw err;
    }
  }
}

async function cmdMcpServer(_options: CliOptions): Promise<void> {
  // This runs the MCP server - imported and executed
  console.error('[MCP] Starting Claude Fleet MCP server...');

  // Dynamic import of the MCP server
  const serverPath = new URL('./mcp/server.js', import.meta.url).pathname;
  const child = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (err) => {
    console.error('[MCP] Failed to start:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

// ============================================================================
// COMMANDS: CORE
// ============================================================================

async function cmdHealth(options: CliOptions): Promise<void> {
  const data = await request('GET', '/health', options);
  outputResult(data, options);
}

async function cmdMetrics(options: CliOptions): Promise<void> {
  const data = await request('GET', '/metrics/json', options);
  outputResult(data, options);
}

async function cmdDebug(options: CliOptions): Promise<void> {
  const data = await request('GET', '/debug', options);
  outputResult(data, options);
}

async function cmdAuth(
  options: CliOptions,
  handle: string,
  teamName: string,
  agentType: string
): Promise<void> {
  validateHandle(handle);
  validateTeamName(teamName);
  const data = await request('POST', '/auth', options, { handle, teamName, agentType });
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: TEAMS
// ============================================================================

async function cmdTeams(options: CliOptions, teamName: string): Promise<void> {
  validateTeamName(teamName);
  const data = await request('GET', `/teams/${teamName}/agents`, options);
  const agents = data as Array<Record<string, unknown>>;
  outputList(agents, [
    { header: 'HANDLE', key: 'handle' },
    { header: 'UID', key: 'uid', width: 26 },
    { header: 'TYPE', key: 'agentType' },
  ], options);
}

async function cmdTasks(options: CliOptions, teamName: string): Promise<void> {
  validateTeamName(teamName);
  const data = await request('GET', `/teams/${teamName}/tasks`, options);
  const tasks = data as Array<Record<string, unknown>>;
  outputList(tasks, [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'TO', key: 'toHandle' },
    { header: 'STATUS', key: 'status' },
    { header: 'SUBJECT', key: 'subject', width: 40 },
  ], options);
}

// ============================================================================
// COMMANDS: WORKERS
// ============================================================================

async function cmdWorkers(options: CliOptions): Promise<void> {
  const data = await request('GET', '/orchestrate/workers', options);
  const workers = (data as { workers: Array<Record<string, unknown>> }).workers ?? data;
  if (Array.isArray(workers)) {
    outputList(workers, [
      { header: 'HANDLE', key: 'handle' },
      { header: 'STATE', key: 'state' },
      { header: 'PID', key: 'pid' },
      { header: 'SPAWNED', key: 'spawnedAt' },
    ], options);
  } else {
    outputResult(data, options);
  }
}

async function cmdSpawn(
  options: CliOptions,
  handle: string,
  prompt: string
): Promise<void> {
  validateHandle(handle);
  const data = await request('POST', '/orchestrate/spawn', options, {
    handle,
    initialPrompt: prompt,
    role: 'worker',
  });
  outputResult(data, options);
}

async function cmdDismiss(options: CliOptions, handle: string): Promise<void> {
  validateHandle(handle);
  const data = await request('POST', `/orchestrate/dismiss/${handle}`, options);
  outputResult(data, options);
}

async function cmdSend(options: CliOptions, handle: string, message: string): Promise<void> {
  validateHandle(handle);
  const data = await request('POST', `/orchestrate/send/${handle}`, options, { message });
  outputResult(data, options);
}

async function cmdOutput(options: CliOptions, handle: string): Promise<void> {
  validateHandle(handle);
  const data = await request('GET', `/orchestrate/output/${handle}`, options);
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: WORKTREES
// ============================================================================

async function cmdWorktreeStatus(options: CliOptions, handle: string): Promise<void> {
  validateHandle(handle);
  const data = await request('GET', `/orchestrate/worktree/${handle}/status`, options);
  outputResult(data, options);
}

async function cmdWorktreeCommit(
  options: CliOptions,
  handle: string,
  message: string
): Promise<void> {
  validateHandle(handle);
  if (!message || message.length < 1) {
    console.error('Error: Commit message is required');
    process.exit(1);
  }
  const data = await request('POST', `/orchestrate/worktree/${handle}/commit`, options, { message });
  outputResult(data, options);
}

async function cmdWorktreePush(options: CliOptions, handle: string): Promise<void> {
  validateHandle(handle);
  const data = await request('POST', `/orchestrate/worktree/${handle}/push`, options);
  outputResult(data, options);
}

async function cmdWorktreePR(
  options: CliOptions,
  handle: string,
  title: string,
  body: string
): Promise<void> {
  validateHandle(handle);
  if (!title || title.length < 1) {
    console.error('Error: PR title is required');
    process.exit(1);
  }
  if (!body || body.length < 1) {
    console.error('Error: PR body is required');
    process.exit(1);
  }
  const data = await request('POST', `/orchestrate/worktree/${handle}/pr`, options, { title, body });
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: TASKS
// ============================================================================

async function cmdTask(options: CliOptions, taskId: string): Promise<void> {
  const data = await request('GET', `/tasks/${taskId}`, options);
  outputResult(data, options);
}

async function cmdTaskCreate(
  options: CliOptions,
  toHandle: string,
  subject: string,
  description?: string
): Promise<void> {
  validateHandle(toHandle, 'toHandle');
  if (!subject || subject.length < 3) {
    console.error('Error: Subject must be at least 3 characters');
    process.exit(1);
  }
  if (!options.token) {
    console.error('Error: Authentication required (FLEET_TOKEN or --token)');
    process.exit(1);
  }
  const payload = decodeJwtPayload(options.token);
  if (!payload) {
    console.error('Error: Invalid token format');
    process.exit(1);
  }
  const data = await request('POST', '/tasks', options, {
    fromUid: payload.uid,
    teamName: payload.teamName,
    toHandle,
    subject,
    description,
  });
  outputResult(data, options);
}

async function cmdTaskUpdate(
  options: CliOptions,
  taskId: string,
  status: string
): Promise<void> {
  validateTaskStatus(status);
  const data = await request('PATCH', `/tasks/${taskId}`, options, { status });
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: WORK ITEMS
// ============================================================================

async function cmdWorkitems(options: CliOptions, status?: string): Promise<void> {
  if (status) validateWorkItemStatus(status);
  const path = status ? `/workitems?status=${status}` : '/workitems';
  const data = await request('GET', path, options);
  const items = data as Array<Record<string, unknown>>;
  outputList(items, [
    { header: 'ID', key: 'id', width: 14 },
    { header: 'STATUS', key: 'status' },
    { header: 'ASSIGNEE', key: 'assignedTo' },
    { header: 'TITLE', key: 'title', width: 40 },
  ], options);
}

async function cmdWorkitemCreate(
  options: CliOptions,
  title: string,
  description?: string,
  assignedTo?: string
): Promise<void> {
  if (assignedTo) validateHandle(assignedTo, 'assignedTo');
  const data = await request('POST', '/workitems', options, {
    title,
    description,
    assignedTo,
  });
  outputResult(data, options);
}

async function cmdWorkitemUpdate(
  options: CliOptions,
  id: string,
  status: string,
  reason?: string
): Promise<void> {
  validateWorkItemStatus(status);
  const data = await request('PATCH', `/workitems/${id}`, options, {
    status,
    reason,
  });
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: BATCHES
// ============================================================================

async function cmdBatches(options: CliOptions): Promise<void> {
  const data = await request('GET', '/batches', options);
  const batches = data as Array<Record<string, unknown>>;
  outputList(batches, [
    { header: 'ID', key: 'id', width: 14 },
    { header: 'NAME', key: 'name' },
    { header: 'STATUS', key: 'status' },
    { header: 'ITEMS', key: 'itemCount' },
  ], options);
}

async function cmdBatchCreate(
  options: CliOptions,
  name: string,
  workitemIds?: string[]
): Promise<void> {
  const data = await request('POST', '/batches', options, {
    name,
    workItemIds: workitemIds,
  });
  outputResult(data, options);
}

async function cmdBatchDispatch(
  options: CliOptions,
  batchId: string,
  workerHandle: string
): Promise<void> {
  validateHandle(workerHandle, 'workerHandle');
  const data = await request('POST', `/batches/${batchId}/dispatch`, options, {
    workerHandle,
  });
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: MAIL
// ============================================================================

async function cmdMail(options: CliOptions, handle: string): Promise<void> {
  validateHandle(handle);
  const data = await request('GET', `/mail/${handle}/unread`, options);
  const mail = data as Array<Record<string, unknown>>;
  outputList(mail, [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'FROM', key: 'from' },
    { header: 'SUBJECT', key: 'subject', width: 30 },
  ], options);
}

async function cmdMailSend(
  options: CliOptions,
  from: string,
  to: string,
  body: string,
  subject?: string
): Promise<void> {
  validateHandle(from, 'from');
  validateHandle(to, 'to');
  const data = await request('POST', '/mail', options, { from, to, body, subject });
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: HANDOFFS
// ============================================================================

async function cmdHandoffs(options: CliOptions, handle: string): Promise<void> {
  validateHandle(handle);
  const data = await request('GET', `/handoffs/${handle}`, options);
  const handoffs = data as Array<Record<string, unknown>>;
  outputList(handoffs, [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'FROM', key: 'from' },
    { header: 'TO', key: 'to' },
    { header: 'CREATED', key: 'createdAt' },
  ], options);
}

async function cmdHandoffCreate(
  options: CliOptions,
  from: string,
  to: string,
  contextJson: string
): Promise<void> {
  validateHandle(from, 'from');
  validateHandle(to, 'to');
  let context: unknown;
  try {
    context = JSON.parse(contextJson);
  } catch {
    console.error('Error: Context must be valid JSON');
    console.error('  Example: \'{"task": "complete", "files": ["a.ts"]}\'');
    process.exit(1);
  }
  const data = await request('POST', '/handoffs', options, { from, to, context });
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: CHECKPOINTS
// ============================================================================

async function cmdCheckpoints(options: CliOptions, handle: string): Promise<void> {
  validateHandle(handle);
  const data = await request('GET', `/checkpoints/list/${handle}`, options);
  const checkpoints = data as Array<Record<string, unknown>>;
  outputList(checkpoints, [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'FROM', key: 'fromHandle' },
    { header: 'STATUS', key: 'status' },
    { header: 'GOAL', key: 'goal', width: 30 },
  ], options);
}

async function cmdCheckpoint(options: CliOptions, id: string): Promise<void> {
  const data = await request('GET', `/checkpoints/${id}`, options);
  outputResult(data, options);
}

async function cmdCheckpointCreate(
  options: CliOptions,
  fromHandle: string,
  goal: string,
  now: string,
  toHandle?: string
): Promise<void> {
  validateHandle(fromHandle, 'fromHandle');
  if (toHandle) validateHandle(toHandle, 'toHandle');
  const data = await request('POST', '/checkpoints', options, {
    fromHandle,
    toHandle: toHandle ?? fromHandle,
    goal,
    now,
  });
  outputResult(data, options);
}

async function cmdCheckpointLatest(options: CliOptions, handle: string): Promise<void> {
  validateHandle(handle);
  const data = await request('GET', `/checkpoints/latest/${handle}`, options);
  outputResult(data, options);
}

async function cmdCheckpointAccept(options: CliOptions, id: string): Promise<void> {
  const data = await request('POST', `/checkpoints/${id}/accept`, options);
  outputResult(data, options);
}

async function cmdCheckpointReject(options: CliOptions, id: string): Promise<void> {
  const data = await request('POST', `/checkpoints/${id}/reject`, options);
  outputResult(data, options);
}

// ============================================================================
// COMMANDS: FLEET (SWARMS, BLACKBOARD, SPAWN-QUEUE)
// ============================================================================

async function cmdSwarms(options: CliOptions): Promise<void> {
  const data = await request('GET', '/swarms?includeAgents=true', options);
  const swarms = data as Array<Record<string, unknown>>;
  outputList(swarms, [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'NAME', key: 'name' },
    { header: 'STATUS', key: 'status' },
    { header: 'AGENTS', key: 'agentCount' },
  ], options);
}

async function cmdSwarmCreate(
  options: CliOptions,
  name: string,
  maxAgents: number
): Promise<void> {
  const data = await request('POST', '/swarms', options, { name, maxAgents });
  outputResult(data, options);
}

async function cmdSwarmKill(options: CliOptions, id: string): Promise<void> {
  const data = await request('POST', `/swarms/${id}/kill`, options, { graceful: true });
  outputResult(data, options);
}

async function cmdSpawnQueue(options: CliOptions): Promise<void> {
  const data = await request('GET', '/spawn-queue/status', options);
  outputResult(data, options);
}

async function cmdBlackboard(options: CliOptions, swarmId: string): Promise<void> {
  const data = await request('GET', `/blackboard/${swarmId}`, options);
  const messages = data as Array<Record<string, unknown>>;
  outputList(messages, [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'SENDER', key: 'senderHandle' },
    { header: 'TYPE', key: 'messageType' },
    { header: 'PRIORITY', key: 'priority' },
  ], options);
}

async function cmdBlackboardPost(
  options: CliOptions,
  swarmId: string,
  senderHandle: string,
  messageType: string,
  payload: string
): Promise<void> {
  validateHandle(senderHandle, 'senderHandle');
  validateMessageType(messageType);

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    parsedPayload = { message: payload };
  }

  const data = await request('POST', '/blackboard', options, {
    swarmId,
    senderHandle,
    messageType,
    payload: parsedPayload,
  });
  outputResult(data, options);
}

// ============================================================================
// SWARM INTELLIGENCE COMMANDS
// ============================================================================

// --- Pheromones ---

async function cmdPheromones(options: CliOptions, swarmId: string): Promise<void> {
  const data = await request('GET', `/pheromones/${swarmId}`, options);
  const trails = (data as { trails: Array<Record<string, unknown>> }).trails ?? data;
  if (Array.isArray(trails)) {
    outputList(trails, [
      { header: 'RESOURCE', key: 'resourceId', width: 30 },
      { header: 'TYPE', key: 'trailType' },
      { header: 'DEPOSITOR', key: 'depositorHandle' },
      { header: 'STRENGTH', key: 'strength' },
    ], options);
  } else {
    outputResult(data, options);
  }
}

async function cmdPheromoneDeposit(
  options: CliOptions,
  swarmId: string,
  resourceId: string,
  trailType: string
): Promise<void> {
  if (!options.token) {
    console.error('Error: Authentication required (FLEET_TOKEN or --token)');
    process.exit(1);
  }
  const payload = decodeJwtPayload(options.token);
  if (!payload) {
    console.error('Error: Invalid token format');
    process.exit(1);
  }
  const data = await request('POST', '/pheromones', options, {
    swarmId,
    depositorHandle: payload.handle,
    resourceId,
    resourceType: 'file',
    trailType,
  });
  outputResult(data, options);
}

async function cmdPheromoneHot(options: CliOptions, swarmId: string): Promise<void> {
  const data = await request('GET', `/pheromones/${swarmId}/activity`, options);
  outputResult(data, options);
}

// --- Beliefs ---

async function cmdBeliefs(options: CliOptions, swarmId: string, handle: string): Promise<void> {
  const data = await request('GET', `/beliefs/${swarmId}/${handle}`, options);
  const beliefs = (data as { beliefs: Array<Record<string, unknown>> }).beliefs ?? data;
  if (Array.isArray(beliefs)) {
    outputList(beliefs, [
      { header: 'SUBJECT', key: 'subject', width: 25 },
      { header: 'TYPE', key: 'beliefType' },
      { header: 'VALUE', key: 'beliefValue', width: 30 },
      { header: 'CONFIDENCE', key: 'confidence' },
    ], options);
  } else {
    outputResult(data, options);
  }
}

async function cmdBeliefSet(
  options: CliOptions,
  swarmId: string,
  subject: string,
  beliefType: string,
  beliefValue: string,
  confidence?: string
): Promise<void> {
  if (!options.token) {
    console.error('Error: Authentication required (FLEET_TOKEN or --token)');
    process.exit(1);
  }
  const payload = decodeJwtPayload(options.token);
  if (!payload) {
    console.error('Error: Invalid token format');
    process.exit(1);
  }
  const data = await request('POST', '/beliefs', options, {
    swarmId,
    agentHandle: payload.handle,
    subject,
    beliefType,
    beliefValue,
    confidence: confidence ? parseFloat(confidence) : 0.5,
  });
  outputResult(data, options);
}

async function cmdBeliefConsensus(options: CliOptions, swarmId: string, subject: string): Promise<void> {
  const data = await request('GET', `/beliefs/${swarmId}/consensus/${encodeURIComponent(subject)}`, options);
  outputResult(data, options);
}

// --- Credits ---

async function cmdCredits(options: CliOptions, swarmId: string, handle: string): Promise<void> {
  const data = await request('GET', `/credits/${swarmId}/${handle}`, options);
  outputResult(data, options);
}

async function cmdCreditsLeaderboard(options: CliOptions, swarmId: string): Promise<void> {
  const data = await request('GET', `/credits/${swarmId}/leaderboard`, options);
  const agents = (data as { leaderboard: Array<Record<string, unknown>> }).leaderboard ?? data;
  if (Array.isArray(agents)) {
    outputList(agents, [
      { header: 'RANK', key: 'rank' },
      { header: 'HANDLE', key: 'agentHandle' },
      { header: 'BALANCE', key: 'balance' },
      { header: 'REPUTATION', key: 'reputationScore' },
    ], options);
  } else {
    outputResult(data, options);
  }
}

async function cmdCreditsTransfer(
  options: CliOptions,
  swarmId: string,
  toHandle: string,
  amount: string,
  description?: string
): Promise<void> {
  if (!options.token) {
    console.error('Error: Authentication required (FLEET_TOKEN or --token)');
    process.exit(1);
  }
  const payload = decodeJwtPayload(options.token);
  if (!payload) {
    console.error('Error: Invalid token format');
    process.exit(1);
  }
  validateHandle(toHandle, 'toHandle');
  const data = await request('POST', '/credits/transfer', options, {
    swarmId,
    fromHandle: payload.handle,
    toHandle,
    amount: parseFloat(amount),
    description,
  });
  outputResult(data, options);
}

// --- Proposals/Consensus ---

async function cmdProposals(options: CliOptions, swarmId: string): Promise<void> {
  const data = await request('GET', `/consensus/${swarmId}/proposals`, options);
  const proposals = (data as { proposals: Array<Record<string, unknown>> }).proposals ?? data;
  if (Array.isArray(proposals)) {
    outputList(proposals, [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'SUBJECT', key: 'subject', width: 25 },
      { header: 'STATUS', key: 'status' },
      { header: 'PROPOSER', key: 'proposerHandle' },
    ], options);
  } else {
    outputResult(data, options);
  }
}

async function cmdProposalCreate(
  options: CliOptions,
  swarmId: string,
  subject: string,
  description: string,
  optionsStr: string
): Promise<void> {
  if (!options.token) {
    console.error('Error: Authentication required (FLEET_TOKEN or --token)');
    process.exit(1);
  }
  const payload = decodeJwtPayload(options.token);
  if (!payload) {
    console.error('Error: Invalid token format');
    process.exit(1);
  }
  const proposalOptions = optionsStr.split(',').map(s => s.trim());
  if (proposalOptions.length < 2) {
    console.error('Error: At least 2 options required (comma-separated)');
    process.exit(1);
  }
  const data = await request('POST', '/consensus/proposals', options, {
    swarmId,
    proposerHandle: payload.handle,
    subject,
    description,
    options: proposalOptions,
  });
  outputResult(data, options);
}

async function cmdProposalVote(
  options: CliOptions,
  proposalId: string,
  voteValue: string
): Promise<void> {
  if (!options.token) {
    console.error('Error: Authentication required (FLEET_TOKEN or --token)');
    process.exit(1);
  }
  const payload = decodeJwtPayload(options.token);
  if (!payload) {
    console.error('Error: Invalid token format');
    process.exit(1);
  }
  const data = await request('POST', `/consensus/proposals/${proposalId}/vote`, options, {
    voterHandle: payload.handle,
    voteValue,
  });
  outputResult(data, options);
}

async function cmdProposalClose(options: CliOptions, proposalId: string): Promise<void> {
  const data = await request('POST', `/consensus/proposals/${proposalId}/close`, options);
  outputResult(data, options);
}

// --- Bidding ---

async function cmdBids(options: CliOptions, taskId: string): Promise<void> {
  const data = await request('GET', `/bids/task/${taskId}`, options);
  const bids = (data as { bids: Array<Record<string, unknown>> }).bids ?? data;
  if (Array.isArray(bids)) {
    outputList(bids, [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'BIDDER', key: 'bidderHandle' },
      { header: 'AMOUNT', key: 'bidAmount' },
      { header: 'STATUS', key: 'status' },
    ], options);
  } else {
    outputResult(data, options);
  }
}

async function cmdBidSubmit(
  options: CliOptions,
  swarmId: string,
  taskId: string,
  amount: string,
  rationale?: string
): Promise<void> {
  if (!options.token) {
    console.error('Error: Authentication required (FLEET_TOKEN or --token)');
    process.exit(1);
  }
  const payload = decodeJwtPayload(options.token);
  if (!payload) {
    console.error('Error: Invalid token format');
    process.exit(1);
  }
  const data = await request('POST', '/bids', options, {
    swarmId,
    taskId,
    bidderHandle: payload.handle,
    bidAmount: parseFloat(amount),
    rationale,
  });
  outputResult(data, options);
}

async function cmdBidAccept(options: CliOptions, bidId: string): Promise<void> {
  const data = await request('POST', `/bids/${bidId}/accept`, options);
  outputResult(data, options);
}

async function cmdAuction(options: CliOptions, taskId: string): Promise<void> {
  const data = await request('POST', `/bids/task/${taskId}/auction`, options);
  outputResult(data, options);
}

// --- Payoffs ---

async function cmdPayoffs(options: CliOptions, taskId: string): Promise<void> {
  const data = await request('GET', `/payoffs/${taskId}`, options);
  outputResult(data, options);
}

async function cmdPayoffDefine(
  options: CliOptions,
  taskId: string,
  payoffType: string,
  baseValue: string
): Promise<void> {
  const data = await request('POST', '/payoffs', options, {
    taskId,
    payoffType,
    baseValue: parseFloat(baseValue),
  });
  outputResult(data, options);
}

async function cmdPayoffCalculate(options: CliOptions, taskId: string): Promise<void> {
  const data = await request('GET', `/payoffs/${taskId}/calculate`, options);
  outputResult(data, options);
}

// ============================================================================
// WORKFLOW COMMANDS
// ============================================================================

async function cmdWorkflows(options: CliOptions, isTemplate?: boolean): Promise<void> {
  const query = isTemplate !== undefined ? `?isTemplate=${isTemplate}` : '';
  const data = await request('GET', `/workflows${query}`, options);
  const workflows = data as Array<Record<string, unknown>>;
  outputList(workflows, [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'NAME', key: 'name' },
    { header: 'TEMPLATE', key: 'isTemplate' },
    { header: 'VERSION', key: 'version' },
  ], options);
}

async function cmdWorkflow(options: CliOptions, id: string): Promise<void> {
  const data = await request('GET', `/workflows/${id}`, options);
  outputResult(data, options);
}

async function cmdWorkflowStart(
  options: CliOptions,
  workflowId: string,
  inputsJson?: string,
  swarmId?: string
): Promise<void> {
  const inputs = inputsJson ? JSON.parse(inputsJson) : undefined;
  const body: Record<string, unknown> = {};
  if (inputs) body.inputs = inputs;
  if (swarmId) body.swarmId = swarmId;
  const data = await request('POST', `/workflows/${workflowId}/start`, options, body);
  outputResult(data, options);
}

async function cmdExecutions(options: CliOptions, status?: string): Promise<void> {
  const query = status ? `?status=${status}` : '';
  const data = await request('GET', `/executions${query}`, options);
  const executions = data as Array<Record<string, unknown>>;
  outputList(executions, [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'WORKFLOW', key: 'workflowId', width: 38 },
    { header: 'STATUS', key: 'status' },
    { header: 'STARTED', key: 'startedAt' },
  ], options);
}

async function cmdExecution(options: CliOptions, id: string): Promise<void> {
  const data = await request('GET', `/executions/${id}`, options);
  outputResult(data, options);
}

async function cmdExecutionSteps(options: CliOptions, id: string): Promise<void> {
  const data = await request('GET', `/executions/${id}/steps`, options);
  const steps = data as Array<Record<string, unknown>>;
  outputList(steps, [
    { header: 'KEY', key: 'stepKey' },
    { header: 'NAME', key: 'name' },
    { header: 'TYPE', key: 'stepType' },
    { header: 'STATUS', key: 'status' },
    { header: 'BLOCKED', key: 'blockedByCount' },
  ], options);
}

async function cmdExecutionPause(options: CliOptions, id: string): Promise<void> {
  const data = await request('POST', `/executions/${id}/pause`, options);
  outputResult(data, options);
}

async function cmdExecutionResume(options: CliOptions, id: string): Promise<void> {
  const data = await request('POST', `/executions/${id}/resume`, options);
  outputResult(data, options);
}

async function cmdExecutionCancel(options: CliOptions, id: string): Promise<void> {
  const data = await request('POST', `/executions/${id}/cancel`, options);
  outputResult(data, options);
}

async function cmdStepRetry(options: CliOptions, id: string): Promise<void> {
  const data = await request('POST', `/steps/${id}/retry`, options);
  outputResult(data, options);
}

async function cmdStepComplete(
  options: CliOptions,
  id: string,
  outputJson?: string
): Promise<void> {
  const output = outputJson ? JSON.parse(outputJson) : undefined;
  const data = await request('POST', `/steps/${id}/complete`, options, { output });
  outputResult(data, options);
}

// ============================================================================
// HELP
// ============================================================================

function printHelp(): void {
  console.log(`
Claude Fleet CLI v${VERSION}

Usage: fleet <command> [options] [arguments]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CORE COMMANDS
  health                              Check server health
  metrics                             Get server metrics (JSON)
  debug                               Get debug information
  auth <handle> <team> [type]         Authenticate (type: team-lead|worker)

TEAM COMMANDS
  teams <teamName>                    List team agents
  tasks <teamName>                    List team tasks

WORKER COMMANDS
  workers                             List all workers
  spawn <handle> <prompt>             Spawn a new worker [team-lead]
  dismiss <handle>                    Dismiss a worker [team-lead]
  send <handle> <message>             Send message to worker
  output <handle>                     Get worker output

WORKTREE COMMANDS
  worktree-status <handle>            Get worktree git status
  worktree-commit <handle> <message>  Commit changes in worktree
  worktree-push <handle>              Push worktree branch
  worktree-pr <handle> <title> <body> Create PR from worktree

TASK COMMANDS
  task <id>                           Get task details
  task-create <to> <subject> [desc]   Create a new task
  task-update <id> <status>           Update task status

WORK ITEM COMMANDS
  workitems [status]                  List work items (optional filter)
  workitem-create <title> [desc] [to] Create a work item
  workitem-update <id> <status> [why] Update work item status

BATCH COMMANDS
  batches                             List all batches
  batch-create <name> [ids...]        Create a batch
  batch-dispatch <batchId> <worker>   Dispatch batch to worker

MAIL COMMANDS
  mail <handle>                       Get unread mail
  mail-send <from> <to> <body> [subj] Send mail

HANDOFF COMMANDS
  handoffs <handle>                   List handoffs for handle
  handoff-create <from> <to> <json>   Create handoff with context

CHECKPOINT COMMANDS
  checkpoints <handle>                List checkpoints for handle
  checkpoint <id>                     Get checkpoint details
  checkpoint-create <h> <goal> <now>  Create checkpoint
  checkpoint-latest <handle>          Get latest checkpoint
  checkpoint-accept <id>              Accept a checkpoint [team-lead]
  checkpoint-reject <id>              Reject a checkpoint [team-lead]

FLEET COMMANDS
  swarms                              List all swarms
  swarm-create <name> <maxAgents>     Create a new swarm
  swarm-kill <id>                     Kill a swarm (graceful)
  spawn-queue                         Get spawn queue status
  blackboard <swarmId>                Read blackboard messages
  blackboard-post <swarm> <sender> <type> <payload>
                                      Post to blackboard

SWARM INTELLIGENCE COMMANDS
  pheromones <swarmId>                List pheromone trails
  pheromone-deposit <swarm> <resource> <type>
                                      Deposit trail (type: touch,modify,complete,error)
  pheromone-hot <swarmId>             Get most active resources

  beliefs <swarmId> <handle>          List agent beliefs
  belief-set <swarm> <subject> <type> <value> [confidence]
                                      Set a belief (type: knowledge,assumption,inference)
  belief-consensus <swarm> <subject>  Get swarm consensus on subject

  credits <swarmId> <handle>          Get agent credits/reputation
  credits-leaderboard <swarmId>       Get credits leaderboard
  credits-transfer <swarm> <to> <amount> [desc]
                                      Transfer credits to another agent

  proposals <swarmId>                 List proposals
  proposal-create <swarm> <subject> <desc> <options>
                                      Create proposal (options: comma-separated)
  proposal-vote <proposalId> <vote>   Cast vote on proposal
  proposal-close <proposalId>         Close voting [team-lead]

  bids <taskId>                       List bids for task
  bid-submit <swarm> <task> <amount> [rationale]
                                      Submit bid for task
  bid-accept <bidId>                  Accept bid [team-lead]
  auction <taskId>                    Run auction [team-lead]

  payoffs <taskId>                    Get task payoffs
  payoff-define <task> <type> <value> Define payoff (type: completion,quality,speed)
  payoff-calculate <taskId>           Calculate current payoff value

WORKFLOW COMMANDS
  workflows [--template]              List workflows (--template for templates only)
  workflow <id>                       Get workflow details
  workflow-start <id> [inputs] [swarm]
                                      Start workflow execution [team-lead]
  executions [status]                 List executions (optional status filter)
  execution <id>                      Get execution details
  execution-steps <id>                Get execution steps
  execution-pause <id>                Pause execution [team-lead]
  execution-resume <id>               Resume execution [team-lead]
  execution-cancel <id>               Cancel execution [team-lead]
  step-retry <id>                     Retry failed step [team-lead]
  step-complete <id> [output]         Manually complete step

MCP SERVER COMMANDS
  mcp-install                         Install MCP server in Claude Code
  mcp-uninstall                       Remove MCP server from Claude Code
  mcp-server                          Run MCP server (used by Claude Code)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OPTIONS
  --url <url>       Server URL (default: $CLAUDE_FLEET_URL or localhost:3847)
  --token <token>   JWT auth token (or $FLEET_TOKEN)
  --table           Output lists as formatted tables
  --verbose         Show request/response details
  --help            Show this help
  --version         Show version

EXAMPLES
  fleet mcp-install                   # Add MCP server to Claude Code
  fleet health
  fleet auth my-agent my-team team-lead
  fleet --token "eyJ..." workers --table
  fleet spawn worker-1 "Fix the bug in auth.ts"
  fleet worktree-status worker-1
  fleet worktree-commit worker-1 "Fix auth validation"
  fleet task-create alice "Review PR" "Please review PR #42"
  fleet workitem-create "Fix login bug" "JWT validation failing"
  fleet mail-send alice bob "Task complete!" "Re: Login fix"
  fleet handoff-create alice bob '{"task":"done","files":["a.ts"]}'
  fleet checkpoint-create alice "Fixed auth" "Deploy to staging"
  fleet blackboard-post swarm-1 alice status '{"progress":50}'

NOTES
  [team-lead] = Requires team-lead role for authentication
`);
}

function printVersion(): void {
  console.log(`fleet v${VERSION}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      url: { type: 'string', default: DEFAULT_URL },
      token: { type: 'string', default: process.env.FLEET_TOKEN },
      help: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      table: { type: 'boolean', default: false },
      template: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.version) {
    printVersion();
    process.exit(0);
  }

  if (values.help || positionals.length === 0) {
    printHelp();
    process.exit(0);
  }

  const options: CliOptions = {
    url: values.url ?? DEFAULT_URL,
    token: values.token,
    verbose: values.verbose,
    table: values.table,
  };

  const [command, ...args] = positionals;

  try {
    switch (command) {
      // Core Commands
      case 'health':
        await cmdHealth(options);
        break;
      case 'metrics':
        await cmdMetrics(options);
        break;
      case 'debug':
        await cmdDebug(options);
        break;
      case 'auth':
        if (args.length < 2) {
          console.error('Usage: fleet auth <handle> <teamName> [agentType]');
          process.exit(1);
        }
        await cmdAuth(options, args[0], args[1], args[2] ?? 'worker');
        break;

      // Team Commands
      case 'teams':
        if (args.length < 1) {
          console.error('Usage: fleet teams <teamName>');
          process.exit(1);
        }
        await cmdTeams(options, args[0]);
        break;
      case 'tasks':
        if (args.length < 1) {
          console.error('Usage: fleet tasks <teamName>');
          process.exit(1);
        }
        await cmdTasks(options, args[0]);
        break;

      // Worker Commands
      case 'workers':
        await cmdWorkers(options);
        break;
      case 'spawn':
        if (args.length < 2) {
          console.error('Usage: fleet spawn <handle> <prompt>');
          process.exit(1);
        }
        await cmdSpawn(options, args[0], args.slice(1).join(' '));
        break;
      case 'dismiss':
        if (args.length < 1) {
          console.error('Usage: fleet dismiss <handle>');
          process.exit(1);
        }
        await cmdDismiss(options, args[0]);
        break;
      case 'send':
        if (args.length < 2) {
          console.error('Usage: fleet send <handle> <message>');
          process.exit(1);
        }
        await cmdSend(options, args[0], args.slice(1).join(' '));
        break;
      case 'output':
        if (args.length < 1) {
          console.error('Usage: fleet output <handle>');
          process.exit(1);
        }
        await cmdOutput(options, args[0]);
        break;

      // Worktree Commands
      case 'worktree-status':
        if (args.length < 1) {
          console.error('Usage: fleet worktree-status <handle>');
          process.exit(1);
        }
        await cmdWorktreeStatus(options, args[0]);
        break;
      case 'worktree-commit':
        if (args.length < 2) {
          console.error('Usage: fleet worktree-commit <handle> <message>');
          process.exit(1);
        }
        await cmdWorktreeCommit(options, args[0], args.slice(1).join(' '));
        break;
      case 'worktree-push':
        if (args.length < 1) {
          console.error('Usage: fleet worktree-push <handle>');
          process.exit(1);
        }
        await cmdWorktreePush(options, args[0]);
        break;
      case 'worktree-pr':
        if (args.length < 3) {
          console.error('Usage: fleet worktree-pr <handle> <title> <body>');
          process.exit(1);
        }
        await cmdWorktreePR(options, args[0], args[1], args.slice(2).join(' '));
        break;

      // Task Commands
      case 'task':
        if (args.length < 1) {
          console.error('Usage: fleet task <taskId>');
          process.exit(1);
        }
        await cmdTask(options, args[0]);
        break;
      case 'task-create':
        if (args.length < 2) {
          console.error('Usage: fleet task-create <toHandle> <subject> [description]');
          process.exit(1);
        }
        await cmdTaskCreate(options, args[0], args[1], args[2]);
        break;
      case 'task-update':
        if (args.length < 2) {
          console.error('Usage: fleet task-update <taskId> <status>');
          console.error('  Status: open, in_progress, resolved, blocked');
          process.exit(1);
        }
        await cmdTaskUpdate(options, args[0], args[1]);
        break;

      // Work Item Commands
      case 'workitems':
        await cmdWorkitems(options, args[0]);
        break;
      case 'workitem-create':
        if (args.length < 1) {
          console.error('Usage: fleet workitem-create <title> [description] [assignedTo]');
          process.exit(1);
        }
        await cmdWorkitemCreate(options, args[0], args[1], args[2]);
        break;
      case 'workitem-update':
        if (args.length < 2) {
          console.error('Usage: fleet workitem-update <id> <status> [reason]');
          console.error('  Status: pending, in_progress, completed, blocked, cancelled');
          process.exit(1);
        }
        await cmdWorkitemUpdate(options, args[0], args[1], args[2]);
        break;

      // Batch Commands
      case 'batches':
        await cmdBatches(options);
        break;
      case 'batch-create':
        if (args.length < 1) {
          console.error('Usage: fleet batch-create <name> [workitem-ids...]');
          process.exit(1);
        }
        await cmdBatchCreate(options, args[0], args.slice(1).length > 0 ? args.slice(1) : undefined);
        break;
      case 'batch-dispatch':
        if (args.length < 2) {
          console.error('Usage: fleet batch-dispatch <batchId> <workerHandle>');
          process.exit(1);
        }
        await cmdBatchDispatch(options, args[0], args[1]);
        break;

      // Mail Commands
      case 'mail':
        if (args.length < 1) {
          console.error('Usage: fleet mail <handle>');
          process.exit(1);
        }
        await cmdMail(options, args[0]);
        break;
      case 'mail-send':
        if (args.length < 3) {
          console.error('Usage: fleet mail-send <from> <to> <body> [subject]');
          process.exit(1);
        }
        await cmdMailSend(options, args[0], args[1], args[2], args[3]);
        break;

      // Handoff Commands
      case 'handoffs':
        if (args.length < 1) {
          console.error('Usage: fleet handoffs <handle>');
          process.exit(1);
        }
        await cmdHandoffs(options, args[0]);
        break;
      case 'handoff-create':
        if (args.length < 3) {
          console.error('Usage: fleet handoff-create <from> <to> <contextJson>');
          console.error('  Example: fleet handoff-create alice bob \'{"task":"done"}\'');
          process.exit(1);
        }
        await cmdHandoffCreate(options, args[0], args[1], args[2]);
        break;

      // Checkpoint Commands
      case 'checkpoints':
        if (args.length < 1) {
          console.error('Usage: fleet checkpoints <handle>');
          process.exit(1);
        }
        await cmdCheckpoints(options, args[0]);
        break;
      case 'checkpoint':
        if (args.length < 1) {
          console.error('Usage: fleet checkpoint <id>');
          process.exit(1);
        }
        await cmdCheckpoint(options, args[0]);
        break;
      case 'checkpoint-create':
        if (args.length < 3) {
          console.error('Usage: fleet checkpoint-create <handle> <goal> <now> [toHandle]');
          process.exit(1);
        }
        await cmdCheckpointCreate(options, args[0], args[1], args[2], args[3]);
        break;
      case 'checkpoint-latest':
        if (args.length < 1) {
          console.error('Usage: fleet checkpoint-latest <handle>');
          process.exit(1);
        }
        await cmdCheckpointLatest(options, args[0]);
        break;
      case 'checkpoint-accept':
        if (args.length < 1) {
          console.error('Usage: fleet checkpoint-accept <id>');
          process.exit(1);
        }
        await cmdCheckpointAccept(options, args[0]);
        break;
      case 'checkpoint-reject':
        if (args.length < 1) {
          console.error('Usage: fleet checkpoint-reject <id>');
          process.exit(1);
        }
        await cmdCheckpointReject(options, args[0]);
        break;

      // Fleet Commands
      case 'swarms':
        await cmdSwarms(options);
        break;
      case 'swarm-create':
        if (args.length < 2) {
          console.error('Usage: fleet swarm-create <name> <maxAgents>');
          process.exit(1);
        }
        await cmdSwarmCreate(options, args[0], parseInt(args[1], 10));
        break;
      case 'swarm-kill':
        if (args.length < 1) {
          console.error('Usage: fleet swarm-kill <id>');
          process.exit(1);
        }
        await cmdSwarmKill(options, args[0]);
        break;
      case 'spawn-queue':
        await cmdSpawnQueue(options);
        break;
      case 'blackboard':
        if (args.length < 1) {
          console.error('Usage: fleet blackboard <swarmId>');
          process.exit(1);
        }
        await cmdBlackboard(options, args[0]);
        break;
      case 'blackboard-post':
        if (args.length < 4) {
          console.error('Usage: fleet blackboard-post <swarmId> <senderHandle> <messageType> <payload>');
          console.error('  Types: request, response, status, directive, checkpoint');
          console.error('  Payload: JSON string or plain text');
          process.exit(1);
        }
        await cmdBlackboardPost(options, args[0], args[1], args[2], args[3]);
        break;

      // Swarm Intelligence Commands
      case 'pheromones':
        if (args.length < 1) {
          console.error('Usage: fleet pheromones <swarmId>');
          process.exit(1);
        }
        await cmdPheromones(options, args[0]);
        break;
      case 'pheromone-deposit':
        if (args.length < 3) {
          console.error('Usage: fleet pheromone-deposit <swarmId> <resourceId> <trailType>');
          console.error('  Trail types: touch, modify, complete, error, warning, success');
          process.exit(1);
        }
        await cmdPheromoneDeposit(options, args[0], args[1], args[2]);
        break;
      case 'pheromone-hot':
        if (args.length < 1) {
          console.error('Usage: fleet pheromone-hot <swarmId>');
          process.exit(1);
        }
        await cmdPheromoneHot(options, args[0]);
        break;

      case 'beliefs':
        if (args.length < 2) {
          console.error('Usage: fleet beliefs <swarmId> <handle>');
          process.exit(1);
        }
        await cmdBeliefs(options, args[0], args[1]);
        break;
      case 'belief-set':
        if (args.length < 4) {
          console.error('Usage: fleet belief-set <swarmId> <subject> <beliefType> <beliefValue> [confidence]');
          console.error('  Belief types: knowledge, assumption, inference, observation');
          process.exit(1);
        }
        await cmdBeliefSet(options, args[0], args[1], args[2], args[3], args[4]);
        break;
      case 'belief-consensus':
        if (args.length < 2) {
          console.error('Usage: fleet belief-consensus <swarmId> <subject>');
          process.exit(1);
        }
        await cmdBeliefConsensus(options, args[0], args[1]);
        break;

      case 'credits':
        if (args.length < 2) {
          console.error('Usage: fleet credits <swarmId> <handle>');
          process.exit(1);
        }
        await cmdCredits(options, args[0], args[1]);
        break;
      case 'credits-leaderboard':
        if (args.length < 1) {
          console.error('Usage: fleet credits-leaderboard <swarmId>');
          process.exit(1);
        }
        await cmdCreditsLeaderboard(options, args[0]);
        break;
      case 'credits-transfer':
        if (args.length < 3) {
          console.error('Usage: fleet credits-transfer <swarmId> <toHandle> <amount> [description]');
          process.exit(1);
        }
        await cmdCreditsTransfer(options, args[0], args[1], args[2], args[3]);
        break;

      case 'proposals':
        if (args.length < 1) {
          console.error('Usage: fleet proposals <swarmId>');
          process.exit(1);
        }
        await cmdProposals(options, args[0]);
        break;
      case 'proposal-create':
        if (args.length < 4) {
          console.error('Usage: fleet proposal-create <swarmId> <subject> <description> <options>');
          console.error('  Options: comma-separated list of choices, e.g. "option1,option2,option3"');
          process.exit(1);
        }
        await cmdProposalCreate(options, args[0], args[1], args[2], args[3]);
        break;
      case 'proposal-vote':
        if (args.length < 2) {
          console.error('Usage: fleet proposal-vote <proposalId> <voteValue>');
          process.exit(1);
        }
        await cmdProposalVote(options, args[0], args[1]);
        break;
      case 'proposal-close':
        if (args.length < 1) {
          console.error('Usage: fleet proposal-close <proposalId>');
          process.exit(1);
        }
        await cmdProposalClose(options, args[0]);
        break;

      case 'bids':
        if (args.length < 1) {
          console.error('Usage: fleet bids <taskId>');
          process.exit(1);
        }
        await cmdBids(options, args[0]);
        break;
      case 'bid-submit':
        if (args.length < 3) {
          console.error('Usage: fleet bid-submit <swarmId> <taskId> <amount> [rationale]');
          process.exit(1);
        }
        await cmdBidSubmit(options, args[0], args[1], args[2], args[3]);
        break;
      case 'bid-accept':
        if (args.length < 1) {
          console.error('Usage: fleet bid-accept <bidId>');
          process.exit(1);
        }
        await cmdBidAccept(options, args[0]);
        break;
      case 'auction':
        if (args.length < 1) {
          console.error('Usage: fleet auction <taskId>');
          process.exit(1);
        }
        await cmdAuction(options, args[0]);
        break;

      case 'payoffs':
        if (args.length < 1) {
          console.error('Usage: fleet payoffs <taskId>');
          process.exit(1);
        }
        await cmdPayoffs(options, args[0]);
        break;
      case 'payoff-define':
        if (args.length < 3) {
          console.error('Usage: fleet payoff-define <taskId> <payoffType> <baseValue>');
          console.error('  Payoff types: completion, quality, speed, cooperation, penalty, bonus');
          process.exit(1);
        }
        await cmdPayoffDefine(options, args[0], args[1], args[2]);
        break;
      case 'payoff-calculate':
        if (args.length < 1) {
          console.error('Usage: fleet payoff-calculate <taskId>');
          process.exit(1);
        }
        await cmdPayoffCalculate(options, args[0]);
        break;

      // Workflow commands
      case 'workflows':
        await cmdWorkflows(options, (values as Record<string, unknown>).template ? true : undefined);
        break;
      case 'workflow':
        if (!args[0]) {
          console.error('Usage: fleet workflow <id>');
          process.exit(1);
        }
        await cmdWorkflow(options, args[0]);
        break;
      case 'workflow-start':
        if (!args[0]) {
          console.error('Usage: fleet workflow-start <workflowId> [inputsJson] [swarmId]');
          console.error('  inputsJson: JSON object with input values, e.g. \'{"feature":"login"}\'');
          process.exit(1);
        }
        await cmdWorkflowStart(options, args[0], args[1], args[2]);
        break;
      case 'executions':
        await cmdExecutions(options, args[0]);
        break;
      case 'execution':
        if (!args[0]) {
          console.error('Usage: fleet execution <id>');
          process.exit(1);
        }
        await cmdExecution(options, args[0]);
        break;
      case 'execution-steps':
        if (!args[0]) {
          console.error('Usage: fleet execution-steps <executionId>');
          process.exit(1);
        }
        await cmdExecutionSteps(options, args[0]);
        break;
      case 'execution-pause':
        if (!args[0]) {
          console.error('Usage: fleet execution-pause <id>');
          process.exit(1);
        }
        await cmdExecutionPause(options, args[0]);
        break;
      case 'execution-resume':
        if (!args[0]) {
          console.error('Usage: fleet execution-resume <id>');
          process.exit(1);
        }
        await cmdExecutionResume(options, args[0]);
        break;
      case 'execution-cancel':
        if (!args[0]) {
          console.error('Usage: fleet execution-cancel <id>');
          process.exit(1);
        }
        await cmdExecutionCancel(options, args[0]);
        break;
      case 'step-retry':
        if (!args[0]) {
          console.error('Usage: fleet step-retry <stepId>');
          process.exit(1);
        }
        await cmdStepRetry(options, args[0]);
        break;
      case 'step-complete':
        if (!args[0]) {
          console.error('Usage: fleet step-complete <stepId> [outputJson]');
          process.exit(1);
        }
        await cmdStepComplete(options, args[0], args[1]);
        break;

      // MCP Server Commands
      case 'mcp-install':
        await cmdMcpInstall(options);
        break;
      case 'mcp-uninstall':
        await cmdMcpUninstall(options);
        break;
      case 'mcp-server':
        await cmdMcpServer(options);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "fleet --help" for available commands.');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    if (options.verbose && error instanceof Error && error.stack) {
      console.error('\n[verbose] Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
