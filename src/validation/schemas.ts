/**
 * Zod validation schemas for all API endpoints
 *
 * Provides runtime type validation and sanitization for request bodies.
 */

import { z } from 'zod';

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

/** Reusable handle schema (1-50 chars, alphanumeric with dashes/underscores) */
export const handleSchema = z
  .string()
  .min(1, 'Handle is required')
  .max(50, 'Handle must be at most 50 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Handle must be alphanumeric with dashes/underscores only');

/** Reusable team name schema */
export const teamNameSchema = z
  .string()
  .min(1, 'Team name is required')
  .max(50, 'Team name must be at most 50 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Team name must be alphanumeric with dashes/underscores only');

/** Reusable UID schema (24 char hex) */
export const uidSchema = z
  .string()
  .min(24, 'UID must be 24 characters')
  .max(24, 'UID must be 24 characters')
  .regex(/^[a-f0-9]+$/, 'UID must be hexadecimal');

/** Reusable UUID schema */
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid UUID format');

// ============================================================================
// AUTH SCHEMAS
// ============================================================================

export const agentRegistrationSchema = z.object({
  handle: handleSchema,
  teamName: teamNameSchema,
  agentType: z.enum(['team-lead', 'worker']).optional().default('worker'),
});

export type AgentRegistrationInput = z.infer<typeof agentRegistrationSchema>;

// ============================================================================
// TASK SCHEMAS
// ============================================================================

export const taskStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'blocked']);

export const createTaskSchema = z.object({
  fromUid: uidSchema,
  toHandle: handleSchema,
  teamName: teamNameSchema,
  subject: z
    .string()
    .min(3, 'Subject must be at least 3 characters')
    .max(200, 'Subject must be at most 200 characters'),
  description: z
    .string()
    .max(10000, 'Description must be at most 10000 characters')
    .optional()
    .nullable(),
  blockedBy: z.array(uuidSchema).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  status: taskStatusSchema,
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// ============================================================================
// CHAT & MESSAGE SCHEMAS
// ============================================================================

export const createChatSchema = z.object({
  uid1: uidSchema,
  uid2: uidSchema,
}).refine(data => data.uid1 !== data.uid2, {
  message: 'Cannot create chat with yourself',
  path: ['uid2'],
});

export type CreateChatInput = z.infer<typeof createChatSchema>;

export const sendMessageSchema = z.object({
  from: uidSchema,
  text: z
    .string()
    .min(1, 'Message text is required')
    .max(50000, 'Message must be at most 50000 characters'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const broadcastSchema = z.object({
  from: uidSchema,
  text: z
    .string()
    .min(1, 'Broadcast text is required')
    .max(50000, 'Broadcast must be at most 50000 characters'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type BroadcastInput = z.infer<typeof broadcastSchema>;

export const markReadSchema = z.object({
  uid: uidSchema,
});

export type MarkReadInput = z.infer<typeof markReadSchema>;

// ============================================================================
// WORKER SCHEMAS
// ============================================================================

export const registerExternalWorkerSchema = z.object({
  handle: handleSchema,
  teamName: teamNameSchema.optional(),
  workingDir: z.string().max(500).optional(),
  swarmId: z.string().max(100).optional(),
});

export type RegisterExternalWorkerInput = z.infer<typeof registerExternalWorkerSchema>;

export const spawnWorkerSchema = z.object({
  handle: handleSchema,
  teamName: teamNameSchema.optional(),
  workingDir: z.string().max(500).optional(),
  initialPrompt: z.string().max(10000).optional(),
  sessionId: z.string().max(100).optional(),
  swarmId: z.string().max(100).optional(),
  depthLevel: z.number().int().min(0).max(10).optional(),
  spawnMode: z.enum(['process', 'tmux', 'native']).optional(),
  model: z.string().max(50).optional(),
});

export type SpawnWorkerInput = z.infer<typeof spawnWorkerSchema>;

export const sendToWorkerSchema = z.object({
  message: z
    .string()
    .min(1, 'Message is required')
    .max(50000, 'Message must be at most 50000 characters'),
});

export type SendToWorkerInput = z.infer<typeof sendToWorkerSchema>;

// ============================================================================
// WORKTREE SCHEMAS
// ============================================================================

export const worktreeCommitSchema = z.object({
  message: z
    .string()
    .min(1, 'Commit message is required')
    .max(1000, 'Commit message must be at most 1000 characters'),
});

export type WorktreeCommitInput = z.infer<typeof worktreeCommitSchema>;

export const worktreePRSchema = z.object({
  title: z
    .string()
    .min(1, 'PR title is required')
    .max(200, 'PR title must be at most 200 characters'),
  body: z
    .string()
    .min(1, 'PR body is required')
    .max(10000, 'PR body must be at most 10000 characters'),
  base: z.string().max(100).optional(),
});

export type WorktreePRInput = z.infer<typeof worktreePRSchema>;

// ============================================================================
// WORK ITEM SCHEMAS (Phase 2)
// ============================================================================

export const workItemStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'blocked', 'cancelled']);

export const createWorkItemSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be at most 200 characters'),
  description: z.string().max(10000).optional().nullable(),
  assignedTo: handleSchema.optional(),
  batchId: z.string().uuid().optional(),
});

export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;

export const updateWorkItemSchema = z.object({
  status: workItemStatusSchema,
  reason: z.string().max(1000).optional(),
  actor: handleSchema.optional(),
});

export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;

// ============================================================================
// BATCH SCHEMAS (Phase 2)
// ============================================================================

export const createBatchSchema = z.object({
  name: z
    .string()
    .min(1, 'Batch name is required')
    .max(100, 'Batch name must be at most 100 characters'),
  workItemIds: z.array(z.string().max(20)).optional(),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;

export const dispatchBatchSchema = z.object({
  workerHandle: handleSchema,
});

export type DispatchBatchInput = z.infer<typeof dispatchBatchSchema>;

// ============================================================================
// MAIL SCHEMAS (Phase 3)
// ============================================================================

export const sendMailSchema = z.object({
  from: handleSchema,
  to: handleSchema,
  body: z
    .string()
    .min(1, 'Mail body is required')
    .max(50000, 'Mail body must be at most 50000 characters'),
  subject: z.string().max(200).optional(),
});

export type SendMailInput = z.infer<typeof sendMailSchema>;

// ============================================================================
// HANDOFF SCHEMAS (Phase 3)
// ============================================================================

export const createHandoffSchema = z.object({
  from: handleSchema,
  to: handleSchema,
  context: z.record(z.string(), z.unknown()),
});

export type CreateHandoffInput = z.infer<typeof createHandoffSchema>;

// ============================================================================
// FLEET COORDINATION SCHEMAS (Phase 4)
// ============================================================================

// Blackboard message types and priorities
export const messageTypeSchema = z.enum(['request', 'response', 'status', 'directive', 'checkpoint']);
export const messagePrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);
export const fleetAgentRoleSchema = z.enum(['lead', 'worker', 'scout', 'kraken', 'oracle', 'critic', 'architect']);

export const blackboardPostSchema = z.object({
  swarmId: z.string().min(1).max(100),
  senderHandle: handleSchema,
  messageType: messageTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  targetHandle: handleSchema.optional(),
  priority: messagePrioritySchema.optional().default('normal'),
});

export type BlackboardPostInput = z.infer<typeof blackboardPostSchema>;

export const blackboardMarkReadSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(100),
  readerHandle: handleSchema,
});

export type BlackboardMarkReadInput = z.infer<typeof blackboardMarkReadSchema>;

export const blackboardArchiveSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(1000),
});

export type BlackboardArchiveInput = z.infer<typeof blackboardArchiveSchema>;

export const blackboardArchiveOldSchema = z.object({
  maxAgeMs: z.number().int().positive().optional(),
});

export type BlackboardArchiveOldInput = z.infer<typeof blackboardArchiveOldSchema>;

// Spawn queue schemas
export const spawnEnqueueSchema = z.object({
  requesterHandle: handleSchema,
  targetAgentType: fleetAgentRoleSchema,
  task: z.string().min(1).max(10000),
  swarmId: z.string().max(100).optional(),
  priority: messagePrioritySchema.optional(),
  dependsOn: z.array(z.string().uuid()).max(20).optional(),
});

export type SpawnEnqueueInput = z.infer<typeof spawnEnqueueSchema>;

// Checkpoint schemas
export const checkpointCreateSchema = z.object({
  fromHandle: handleSchema,
  toHandle: handleSchema,
  goal: z.string().min(1).max(1000),
  now: z.string().min(1).max(1000),
  test: z.string().max(500).optional(),
  doneThisSession: z.array(z.object({
    task: z.string().max(500),
    files: z.array(z.string().max(500)).max(50),
  })).max(50).optional(),
  blockers: z.array(z.string().max(500)).max(20).optional(),
  questions: z.array(z.string().max(500)).max(20).optional(),
  next: z.array(z.string().max(500)).max(20).optional(),
});

export type CheckpointCreateInput = z.infer<typeof checkpointCreateSchema>;

// Swarm management schemas
export const swarmCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  maxAgents: z.number().int().min(1).max(100).optional().default(10),
});

export type SwarmCreateInput = z.infer<typeof swarmCreateSchema>;

export const swarmKillSchema = z.object({
  graceful: z.boolean().optional().default(true),
});

export type SwarmKillInput = z.infer<typeof swarmKillSchema>;

// ============================================================================
// PATH PARAMETER SCHEMAS
// ============================================================================

/** Swarm ID path parameter (alphanumeric with dashes) */
export const swarmIdParamSchema = z.object({
  swarmId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid swarm ID format'),
});

export type SwarmIdParam = z.infer<typeof swarmIdParamSchema>;

/** Handle path parameter */
export const handleParamSchema = z.object({
  handle: handleSchema,
});

export type HandleParam = z.infer<typeof handleParamSchema>;

/** Numeric ID path parameter */
export const numericIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type NumericIdParam = z.infer<typeof numericIdParamSchema>;

/** UUID ID path parameter */
export const uuidIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type UuidIdParam = z.infer<typeof uuidIdParamSchema>;

// ============================================================================
// QUERY PARAM SCHEMAS
// ============================================================================

export const getMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  after: z.string().optional(),
});

export type GetMessagesQuery = z.infer<typeof getMessagesQuerySchema>;

/** Blackboard read query parameters */
export const blackboardReadQuerySchema = z.object({
  messageType: messageTypeSchema.optional(),
  unreadOnly: z.enum(['true', 'false']).optional(),
  readerHandle: handleSchema.optional(),
  priority: messagePrioritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type BlackboardReadQuery = z.infer<typeof blackboardReadQuerySchema>;

/** Checkpoint list query parameters */
export const checkpointListQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type CheckpointListQuery = z.infer<typeof checkpointListQuerySchema>;

/** Swarm list query parameters */
export const swarmListQuerySchema = z.object({
  includeAgents: z.enum(['true', 'false']).optional(),
});

export type SwarmListQuery = z.infer<typeof swarmListQuerySchema>;

export const listWorkItemsQuerySchema = z.object({
  status: workItemStatusSchema.optional(),
  assignee: handleSchema.optional(),
  batch: z.string().max(20).optional(),
});

export type ListWorkItemsQuery = z.infer<typeof listWorkItemsQuerySchema>;

// ============================================================================
// WORKFLOW SCHEMAS (Phase 5)
// ============================================================================

export const workflowStatusSchema = z.enum(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']);
export const workflowStepStatusSchema = z.enum(['pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'blocked']);
export const workflowStepTypeSchema = z.enum(['task', 'spawn', 'checkpoint', 'gate', 'parallel', 'script']);
export const workflowTriggerTypeSchema = z.enum(['event', 'schedule', 'webhook', 'blackboard']);

/** Guard condition for step execution */
export const workflowGuardSchema = z.object({
  type: z.enum(['expression', 'script', 'output_check']),
  condition: z.string().min(1).max(1000),
  variables: z.array(z.string()).optional(),
});

/** Hook for workflow lifecycle events */
export const workflowHookSchema = z.object({
  type: z.enum(['blackboard', 'mail', 'callback']),
  config: z.record(z.string(), z.unknown()),
});

/** Task step config */
export const taskStepConfigSchema = z.object({
  type: z.literal('task'),
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  assignTo: z.string().max(50).optional(),
});

/** Spawn step config */
export const spawnStepConfigSchema = z.object({
  type: z.literal('spawn'),
  agentRole: z.string().min(1).max(50),
  task: z.string().min(1).max(10000),
  swarmId: z.string().max(100).optional(),
});

/** Checkpoint step config */
export const checkpointStepConfigSchema = z.object({
  type: z.literal('checkpoint'),
  goal: z.string().min(1).max(1000),
  toHandle: z.string().max(50),
  waitForAcceptance: z.boolean().optional(),
});

/** Gate step config */
export const gateStepConfigSchema = z.object({
  type: z.literal('gate'),
  condition: workflowGuardSchema,
  onTrue: z.array(z.string().max(50)).optional(),
  onFalse: z.array(z.string().max(50)).optional(),
});

/** Parallel step config - references step keys to run in parallel */
export const parallelStepConfigSchema = z.object({
  type: z.literal('parallel'),
  stepKeys: z.array(z.string().max(50)).max(20),
  strategy: z.enum(['all', 'any', 'race']),
});

/** Script step config */
export const scriptStepConfigSchema = z.object({
  type: z.literal('script'),
  script: z.string().min(1).max(10000),
  outputKey: z.string().max(50).optional(),
});

/** Union of all step configs */
export const workflowStepConfigSchema = z.union([
  taskStepConfigSchema,
  spawnStepConfigSchema,
  checkpointStepConfigSchema,
  gateStepConfigSchema,
  parallelStepConfigSchema,
  scriptStepConfigSchema,
]);

/** Step definition */
export const workflowStepDefinitionSchema = z.object({
  key: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Key must be alphanumeric with dashes/underscores'),
  name: z.string().min(1).max(100),
  type: workflowStepTypeSchema,
  dependsOn: z.array(z.string().max(50)).max(20).optional(),
  config: workflowStepConfigSchema,
  guard: workflowGuardSchema.optional(),
  onFailure: z.enum(['fail', 'skip', 'retry', 'continue']).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

/** Complete workflow definition */
export const workflowDefinitionSchema = z.object({
  steps: z.array(workflowStepDefinitionSchema).min(1).max(100),
  inputs: z.record(z.string(), z.object({
    type: z.string(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
  })).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  onComplete: workflowHookSchema.optional(),
  onFailure: workflowHookSchema.optional(),
});

export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;

/** Create workflow request */
export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric with dashes/underscores'),
  description: z.string().max(500).optional(),
  definition: workflowDefinitionSchema,
  isTemplate: z.boolean().optional(),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

/** Update workflow request */
export const updateWorkflowSchema = z.object({
  definition: workflowDefinitionSchema.optional(),
  description: z.string().max(500).optional(),
}).refine(data => data.definition || data.description, {
  message: 'At least one of definition or description must be provided',
});

export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

/** Start workflow request */
export const startWorkflowSchema = z.object({
  inputs: z.record(z.string(), z.unknown()).optional(),
  swarmId: z.string().max(100).optional(),
});

export type StartWorkflowInput = z.infer<typeof startWorkflowSchema>;

/** Trigger config schemas */
export const eventTriggerConfigSchema = z.object({
  type: z.literal('event'),
  eventType: z.string().min(1).max(100),
  filter: z.record(z.string(), z.unknown()).optional(),
});

export const scheduleTriggerConfigSchema = z.object({
  type: z.literal('schedule'),
  cron: z.string().max(100).optional(),
  intervalMs: z.number().int().positive().optional(),
}).refine(data => data.cron || data.intervalMs, {
  message: 'Either cron or intervalMs must be provided',
});

export const webhookTriggerConfigSchema = z.object({
  type: z.literal('webhook'),
  path: z.string().min(1).max(200),
  method: z.enum(['GET', 'POST']).optional(),
  secret: z.string().max(100).optional(),
});

export const blackboardTriggerConfigSchema = z.object({
  type: z.literal('blackboard'),
  swarmId: z.string().min(1).max(100),
  messageType: messageTypeSchema,
  filter: z.record(z.string(), z.unknown()).optional(),
});

export const workflowTriggerConfigSchema = z.union([
  eventTriggerConfigSchema,
  scheduleTriggerConfigSchema,
  webhookTriggerConfigSchema,
  blackboardTriggerConfigSchema,
]);

/** Create trigger request */
export const createTriggerSchema = z.object({
  triggerType: workflowTriggerTypeSchema,
  config: workflowTriggerConfigSchema,
  isEnabled: z.boolean().optional(),
});

export type CreateTriggerInput = z.infer<typeof createTriggerSchema>;

/** Update trigger request */
export const updateTriggerSchema = z.object({
  isEnabled: z.boolean().optional(),
  config: workflowTriggerConfigSchema.optional(),
});

export type UpdateTriggerInput = z.infer<typeof updateTriggerSchema>;

/** Complete step manually */
export const completeStepSchema = z.object({
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(1000).optional(),
});

export type CompleteStepInput = z.infer<typeof completeStepSchema>;

/** List workflows query */
export const listWorkflowsQuerySchema = z.object({
  isTemplate: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;

/** List executions query */
export const listExecutionsQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  status: workflowStatusSchema.optional(),
  swarmId: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;

// ============================================================================
// SWARM TEMPLATE SCHEMAS
// ============================================================================

/** Template name schema (alphanumeric with dashes/underscores) */
export const templateNameSchema = z
  .string()
  .min(1, 'Template name is required')
  .max(100, 'Template name must be at most 100 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Template name must be alphanumeric with dashes/underscores');

/** Phase roles schema - validates FleetAgentRole array */
export const phaseRolesSchema = z
  .array(z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid role ID'))
  .max(20, 'Maximum 20 roles per phase');

/** Template phases schema */
export const templatePhasesSchema = z.object({
  discovery: phaseRolesSchema.optional().default([]),
  development: phaseRolesSchema.optional().default([]),
  quality: phaseRolesSchema.optional().default([]),
  delivery: phaseRolesSchema.optional().default([]),
});

/** Create template request */
export const createSwarmTemplateSchema = z
  .object({
    name: templateNameSchema,
    description: z.string().max(500).optional(),
    phases: templatePhasesSchema,
  })
  .refine(
    data => {
      const total = Object.values(data.phases).flat().length;
      return total > 0 && total <= 50;
    },
    { message: 'Template must have between 1 and 50 total roles across all phases' }
  );

export type CreateSwarmTemplateInput = z.infer<typeof createSwarmTemplateSchema>;

/** Update template request */
export const updateSwarmTemplateSchema = z
  .object({
    name: templateNameSchema.optional(),
    description: z.string().max(500).optional().nullable(),
    phases: templatePhasesSchema.optional(),
  })
  .refine(data => data.name || data.description !== undefined || data.phases, {
    message: 'At least one field must be provided for update',
  });

export type UpdateSwarmTemplateInput = z.infer<typeof updateSwarmTemplateSchema>;

/** List templates query */
export const listTemplatesQuerySchema = z.object({
  builtin: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

/** Run template request */
export const runTemplateSchema = z.object({
  swarmName: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});

export type RunTemplateInput = z.infer<typeof runTemplateSchema>;

// ============================================================================
// AUDIT SCHEMAS
// ============================================================================

/**
 * Schema for starting an audit loop
 */
export const startAuditSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  maxIterations: z.number().int().min(1).max(100).optional().default(20),
}).strict();

export type StartAuditInput = z.infer<typeof startAuditSchema>;

/**
 * Schema for audit output query params
 */
export const auditOutputQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});

export type AuditOutputQuery = z.infer<typeof auditOutputQuerySchema>;

// ============================================================================
// SWARM INTELLIGENCE SCHEMAS (Phase 6 - Advanced Coordination)
// ============================================================================

// --- Pheromone Trail Schemas ---

export const pheromoneResourceTypeSchema = z.enum(['file', 'task', 'endpoint', 'module', 'custom']);
export const pheromoneTrailTypeSchema = z.enum(['touch', 'modify', 'complete', 'error', 'warning', 'success']);

export const depositPheromoneSchema = z.object({
  swarmId: z.string().min(1).max(100),
  resourceType: pheromoneResourceTypeSchema,
  resourceId: z.string().min(1).max(500),
  depositorHandle: handleSchema,
  trailType: pheromoneTrailTypeSchema,
  intensity: z.number().min(0).max(10).optional().default(1.0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type DepositPheromoneInput = z.infer<typeof depositPheromoneSchema>;

export const queryPheromonesSchema = z.object({
  resourceType: pheromoneResourceTypeSchema.optional(),
  resourceId: z.string().max(500).optional(),
  trailType: pheromoneTrailTypeSchema.optional(),
  depositorHandle: handleSchema.optional(),
  minIntensity: z.number().min(0).max(10).optional(),
  activeOnly: z.boolean().optional().default(true),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});

export type QueryPheromonesInput = z.infer<typeof queryPheromonesSchema>;

export const decayPheromonesSchema = z.object({
  swarmId: z.string().min(1).max(100).optional(),
  decayRate: z.number().min(0).max(1).optional().default(0.1),
  minIntensity: z.number().min(0).max(1).optional().default(0.01),
});

export type DecayPheromonesInput = z.infer<typeof decayPheromonesSchema>;

// --- Agent Belief Schemas ---

export const beliefTypeSchema = z.enum(['knowledge', 'assumption', 'inference', 'observation']);
export const beliefSourceTypeSchema = z.enum(['direct', 'inferred', 'communicated', 'observed']);
export const metaBeliefTypeSchema = z.enum(['capability', 'reliability', 'knowledge', 'intention', 'workload']);

export const upsertBeliefSchema = z.object({
  swarmId: z.string().min(1).max(100),
  agentHandle: handleSchema,
  beliefType: beliefTypeSchema,
  subject: z.string().min(1).max(200),
  beliefValue: z.string().min(1).max(10000),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  sourceHandle: handleSchema.optional(),
  sourceType: beliefSourceTypeSchema.optional().default('direct'),
  validUntilMs: z.number().int().positive().optional(),
});

export type UpsertBeliefInput = z.infer<typeof upsertBeliefSchema>;

export const queryBeliefsSchema = z.object({
  beliefType: beliefTypeSchema.optional(),
  subject: z.string().max(200).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  includeExpired: z.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});

export type QueryBeliefsInput = z.infer<typeof queryBeliefsSchema>;

export const upsertMetaBeliefSchema = z.object({
  swarmId: z.string().min(1).max(100),
  agentHandle: handleSchema,
  aboutHandle: handleSchema,
  metaType: metaBeliefTypeSchema,
  beliefValue: z.string().min(1).max(10000),
  confidence: z.number().min(0).max(1).optional().default(0.5),
});

export type UpsertMetaBeliefInput = z.infer<typeof upsertMetaBeliefSchema>;

export const getSwarmConsensusSchema = z.object({
  subject: z.string().min(1).max(200),
  minConfidence: z.number().min(0).max(1).optional().default(0.5),
});

export type GetSwarmConsensusInput = z.infer<typeof getSwarmConsensusSchema>;

// --- Agent Credits & Reputation Schemas ---

export const creditTransactionTypeSchema = z.enum(['earn', 'spend', 'bonus', 'penalty', 'transfer', 'adjustment']);

export const transferCreditsSchema = z.object({
  swarmId: z.string().min(1).max(100),
  fromHandle: handleSchema,
  toHandle: handleSchema,
  amount: z.number().positive().max(10000),
  reason: z.string().max(500).optional(),
});

export type TransferCreditsInput = z.infer<typeof transferCreditsSchema>;

export const recordCreditTransactionSchema = z.object({
  swarmId: z.string().min(1).max(100),
  agentHandle: handleSchema,
  transactionType: creditTransactionTypeSchema,
  amount: z.number().max(10000),
  referenceType: z.string().max(50).optional(),
  referenceId: z.string().max(100).optional(),
  reason: z.string().max(500).optional(),
});

export type RecordCreditTransactionInput = z.infer<typeof recordCreditTransactionSchema>;

export const creditHistoryQuerySchema = z.object({
  transactionType: creditTransactionTypeSchema.optional(),
  sinceMs: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});

export type CreditHistoryQuery = z.infer<typeof creditHistoryQuerySchema>;

export const leaderboardQuerySchema = z.object({
  orderBy: z.enum(['balance', 'reputation', 'earned', 'tasks']).optional().default('reputation'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// --- Game-Theoretic Payoff Schemas ---

export const payoffTypeSchema = z.enum(['completion', 'quality', 'speed', 'cooperation', 'penalty']);

export const definePayoffSchema = z.object({
  taskId: z.string().min(1).max(100),
  swarmId: z.string().max(100).optional(),
  payoffType: payoffTypeSchema,
  baseValue: z.number().min(-10000).max(10000),
  multiplier: z.number().min(0).max(100).optional().default(1.0),
  deadline: z.number().int().positive().optional(),
  decayRate: z.number().min(0).max(1).optional().default(0),
  dependencies: z.array(z.string().max(100)).max(20).optional(),
});

export type DefinePayoffInput = z.infer<typeof definePayoffSchema>;

export const calculatePayoffQuerySchema = z.object({
  includeBreakdown: z.enum(['true', 'false']).optional().default('false'),
});

export type CalculatePayoffQuery = z.infer<typeof calculatePayoffQuerySchema>;

// --- Consensus Mechanism Schemas ---

export const consensusProposalTypeSchema = z.enum(['decision', 'election', 'approval', 'ranking', 'allocation']);
export const votingMethodSchema = z.enum(['majority', 'supermajority', 'unanimous', 'ranked', 'weighted']);
export const proposalStatusSchema = z.enum(['open', 'closed', 'passed', 'failed', 'cancelled']);
export const quorumTypeSchema = z.enum(['percentage', 'absolute', 'none']);

export const createProposalSchema = z.object({
  swarmId: z.string().min(1).max(100),
  proposerHandle: handleSchema,
  proposalType: consensusProposalTypeSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  options: z.array(z.string().min(1).max(200)).min(2).max(20),
  votingMethod: votingMethodSchema.optional().default('majority'),
  quorumType: quorumTypeSchema.optional().default('percentage'),
  quorumValue: z.number().min(0).max(1).optional().default(0.5),
  weightByReputation: z.boolean().optional().default(false),
  deadlineMs: z.number().int().positive().optional(),
});

export type CreateProposalInput = z.infer<typeof createProposalSchema>;

export const castVoteSchema = z.object({
  voterHandle: handleSchema,
  voteValue: z.string().min(1).max(500), // Can be option text or JSON for ranked
  rationale: z.string().max(1000).optional(),
});

export type CastVoteInput = z.infer<typeof castVoteSchema>;

export const listProposalsQuerySchema = z.object({
  status: proposalStatusSchema.optional(),
  proposalType: consensusProposalTypeSchema.optional(),
  proposerHandle: handleSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;

// --- Market-Based Task Bidding Schemas ---

export const bidStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'withdrawn', 'expired']);
export const auctionTypeSchema = z.enum(['first_price', 'second_price', 'dutch', 'vickrey']);

export const submitBidSchema = z.object({
  taskId: z.string().min(1).max(100),
  swarmId: z.string().min(1).max(100),
  bidderHandle: handleSchema,
  bidAmount: z.number().min(0).max(10000),
  estimatedDuration: z.number().int().positive().max(86400000).optional(), // ms, max 24h
  confidence: z.number().min(0).max(1).optional().default(0.5),
  rationale: z.string().max(2000).optional(),
});

export type SubmitBidInput = z.infer<typeof submitBidSchema>;

export const listBidsQuerySchema = z.object({
  status: bidStatusSchema.optional(),
  bidderHandle: handleSchema.optional(),
  minBid: z.coerce.number().min(0).optional(),
  maxBid: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type ListBidsQuery = z.infer<typeof listBidsQuerySchema>;

export const configureAuctionSchema = z.object({
  taskId: z.string().min(1).max(100),
  swarmId: z.string().min(1).max(100),
  auctionType: auctionTypeSchema.optional().default('first_price'),
  minBid: z.number().min(0).optional().default(0),
  maxBid: z.number().min(0).optional(),
  durationMs: z.number().int().positive().max(86400000).optional(), // max 24h
  autoAccept: z.boolean().optional().default(false),
  reputationThreshold: z.number().min(0).max(1).optional(),
});

export type ConfigureAuctionInput = z.infer<typeof configureAuctionSchema>;

export const acceptBidSchema = z.object({
  settleCredits: z.boolean().optional().default(true),
});

export type AcceptBidInput = z.infer<typeof acceptBidSchema>;

// ============================================================================
// POLICY / SAFETY HOOKS SCHEMAS (Phase 8)
// ============================================================================

export const policyTargetSchema = z.enum(['command', 'file_read', 'file_write', 'network', 'eval', 'custom']);
export const policyDecisionSchema = z.enum(['allow', 'block', 'ask']);

export const createPolicyRuleSchema = z.object({
  swarmId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  target: policyTargetSchema,
  pattern: z.string().min(1).max(500),
  decision: policyDecisionSchema,
  reason: z.string().min(1).max(500),
  priority: z.number().int().min(0).max(10000).optional().default(100),
  isEnabled: z.boolean().optional().default(true),
});

export type CreatePolicyRuleInput = z.infer<typeof createPolicyRuleSchema>;

export const updatePolicyRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  target: policyTargetSchema.optional(),
  pattern: z.string().min(1).max(500).optional(),
  decision: policyDecisionSchema.optional(),
  reason: z.string().min(1).max(500).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  isEnabled: z.boolean().optional(),
});

export type UpdatePolicyRuleInput = z.infer<typeof updatePolicyRuleSchema>;

export const evaluatePolicySchema = z.object({
  swarmId: z.string().min(1).max(100),
  agentHandle: handleSchema,
  target: policyTargetSchema,
  operation: z.string().min(1).max(10000),
});

export type EvaluatePolicyInput = z.infer<typeof evaluatePolicySchema>;

export const listPolicyRulesQuerySchema = z.object({
  swarmId: z.string().max(100).optional(),
  target: policyTargetSchema.optional(),
  isEnabled: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type ListPolicyRulesQuery = z.infer<typeof listPolicyRulesQuerySchema>;

export const listPolicyViolationsQuerySchema = z.object({
  swarmId: z.string().max(100).optional(),
  ruleId: z.string().uuid().optional(),
  agentHandle: handleSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type ListPolicyViolationsQuery = z.infer<typeof listPolicyViolationsQuerySchema>;

// ============================================================================
// SESSION LINEAGE SCHEMAS (Phase 8)
// ============================================================================

export const sessionStatusSchema = z.enum(['active', 'trimmed', 'completed']);
export const sessionDerivationTypeSchema = z.enum(['root', 'trimmed', 'continued']);

export const createSessionSchema = z.object({
  workerId: z.string().min(1).max(100),
  parentSessionId: z.string().uuid().optional(),
  derivationType: sessionDerivationTypeSchema.optional().default('root'),
  tokenCount: z.number().int().min(0).optional().default(0),
  summaryText: z.string().max(50000).optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const listWorkerSessionsQuerySchema = z.object({
  status: sessionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type ListWorkerSessionsQuery = z.infer<typeof listWorkerSessionsQuerySchema>;

export const searchSessionsSchema = z.object({
  query: z.string().min(1).max(1000),
  workerHandle: handleSchema.optional(),
  swarmId: z.string().max(100).optional(),
  maxResults: z.number().int().min(1).max(100).optional().default(10),
  afterTimestamp: z.number().int().positive().optional(),
  beforeTimestamp: z.number().int().positive().optional(),
  recencyHalfLifeHours: z.number().positive().optional(),
});

export type SearchSessionsInput = z.infer<typeof searchSessionsSchema>;

export const indexSessionSchema = z.object({
  content: z.string().min(1).max(500000),
  workerHandle: handleSchema.optional(),
  swarmId: z.string().max(100).optional(),
});

export type IndexSessionInput = z.infer<typeof indexSessionSchema>;

// ============================================================================
// PHASE 9: SWARM INTELLIGENCE V2 SCHEMAS
// ============================================================================

// --- File Reservations ---

export const reserveSchema = z.object({
  swarmId: z.string().min(1).max(100),
  agentHandle: handleSchema,
  pathPattern: z.string().min(1).max(500),
  isExclusive: z.boolean().optional().default(true),
  expiryMs: z.number().int().positive().max(86400000).optional(), // max 24h
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ReserveInput = z.infer<typeof reserveSchema>;

export const checkReservationSchema = z.object({
  swarmId: z.string().min(1).max(100),
  pathPattern: z.string().min(1).max(500),
  excludeAgent: handleSchema.optional(),
});

export type CheckReservationInput = z.infer<typeof checkReservationSchema>;

// --- Event Sourcing ---

export const emitEventSchema = z.object({
  eventType: z.string().min(1).max(100),
  actor: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EmitEventInput = z.infer<typeof emitEventSchema>;

export const queryEventsSchema = z.object({
  eventType: z.string().max(100).optional(),
  actor: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(200).optional(),
  afterTimestamp: z.coerce.number().int().positive().optional(),
  beforeTimestamp: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type QueryEventsInput = z.infer<typeof queryEventsSchema>;

export const pruneEventsSchema = z.object({
  beforeTimestamp: z.number().int().positive(),
});

export type PruneEventsInput = z.infer<typeof pruneEventsSchema>;

// --- Outcome Learning ---

export const recordOutcomeSchema = z.object({
  swarmId: z.string().min(1).max(100),
  agentHandle: handleSchema,
  taskType: z.string().min(1).max(100),
  strategy: z.string().min(1).max(200),
  isSuccess: z.boolean(),
  durationMs: z.number().int().min(0).optional(),
  filesTouched: z.array(z.string().max(500)).max(100).optional(),
  errorSummary: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RecordOutcomeInput = z.infer<typeof recordOutcomeSchema>;

export const listOutcomesQuerySchema = z.object({
  swarmId: z.string().max(100).optional(),
  agentHandle: handleSchema.optional(),
  taskType: z.string().max(100).optional(),
  isSuccess: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type ListOutcomesQuery = z.infer<typeof listOutcomesQuerySchema>;

// --- Topology ---

export const topologyTypeSchema = z.enum(['pipeline', 'mesh', 'hierarchical', 'ring', 'star']);

export const topologyConfigSchema = z.object({
  type: topologyTypeSchema,
  agents: z.array(z.string().min(1).max(50)).min(1).max(100),
  leader: z.string().max(50).optional(),
  rings: z.array(z.array(z.string().max(50))).optional(),
  stars: z.array(z.object({
    center: z.string().min(1).max(50),
    satellites: z.array(z.string().min(1).max(50)).min(1),
  })).optional(),
});

export type TopologyConfigInput = z.infer<typeof topologyConfigSchema>;

// --- Cost-Tier Routing ---

export const modelTierSchema = z.enum(['fast', 'balanced', 'powerful']);

export const suggestTierSchema = z.object({
  taskDescription: z.string().min(1).max(5000),
  swarmId: z.string().max(100).optional(),
});

export type SuggestTierInput = z.infer<typeof suggestTierSchema>;

export const routingRuleSchema = z.object({
  swarmId: z.string().min(1).max(100),
  taskPattern: z.string().min(1).max(200),
  recommendedTier: modelTierSchema,
  minTier: modelTierSchema.optional(),
  maxCost: z.number().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RoutingRuleInput = z.infer<typeof routingRuleSchema>;

export const recordRoutingSchema = z.object({
  swarmId: z.string().min(1).max(100),
  taskId: z.string().min(1).max(200),
  agentHandle: handleSchema,
  tierUsed: modelTierSchema,
  tokensUsed: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
  isSuccess: z.boolean().optional(),
});

export type RecordRoutingInput = z.infer<typeof recordRoutingSchema>;

export const routingHistoryQuerySchema = z.object({
  swarmId: z.string().max(100).optional(),
  taskId: z.string().max(200).optional(),
  agentHandle: handleSchema.optional(),
  tierUsed: modelTierSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type RoutingHistoryQuery = z.infer<typeof routingHistoryQuerySchema>;

// ============================================================================
// MISSION SCHEMAS (Phase 10 - Goal-Oriented Mission Loop)
// ============================================================================

export const missionStatusSchema = z.enum(['pending', 'active', 'paused', 'succeeded', 'failed', 'cancelled']);
export const iterationStatusSchema = z.enum(['running', 'validating', 'voting', 'passed', 'failed']);
export const gateTypeSchema = z.enum(['script', 'typecheck', 'lint', 'test', 'build', 'coverage', 'eval', 'custom']);

export const gateDefinitionSchema = z.object({
  gateType: gateTypeSchema,
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()).optional(),
  isRequired: z.boolean().optional().default(true),
  weight: z.number().min(0).max(100).optional().default(1.0),
  sortOrder: z.number().int().min(0).max(1000).optional().default(0),
});

export const missionQuorumConfigSchema = z.object({
  autoApprove: z.boolean().optional().default(true),
  minVoters: z.number().int().min(1).max(100).optional(),
  votingMethod: votingMethodSchema.optional(),
  deadlineMs: z.number().int().positive().optional(),
});

export const createMissionSchema = z.object({
  swarmId: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  goal: z.string().min(1).max(10000),
  goalType: z.string().min(1).max(100).optional().default('custom'),
  maxIterations: z.number().int().min(1).max(1000).optional().default(50),
  gates: z.array(gateDefinitionSchema).max(50).optional(),
  strategy: z.record(z.string(), z.unknown()).optional(),
  quorumConfig: missionQuorumConfigSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateMissionInput = z.infer<typeof createMissionSchema>;

export const addGateSchema = z.object({
  gateType: gateTypeSchema,
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()).optional(),
  isRequired: z.boolean().optional().default(true),
  weight: z.number().min(0).max(100).optional().default(1.0),
  sortOrder: z.number().int().min(0).max(1000).optional().default(0),
});

export type AddGateInput = z.infer<typeof addGateSchema>;

export const castMissionVoteSchema = z.object({
  agentHandle: handleSchema,
  vote: z.enum(['approve', 'reject']),
  rationale: z.string().max(2000).optional(),
});

export type CastMissionVoteInput = z.infer<typeof castMissionVoteSchema>;

export const listMissionsQuerySchema = z.object({
  swarmId: z.string().max(100).optional(),
  status: missionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListMissionsQuery = z.infer<typeof listMissionsQuerySchema>;

// ============================================================================
// VALIDATION HELPER
// ============================================================================

/**
 * Validates request body against a Zod schema and returns typed result or error
 */
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format error message from Zod issues
  const errorMessage = result.error.issues
    .map(issue => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  return { success: false, error: errorMessage };
}

/**
 * Validates query parameters against a Zod schema
 */
export function validateQuery<T>(
  schema: z.ZodType<T>,
  query: unknown
): { success: true; data: T } | { success: false; error: string } {
  return validateBody(schema, query);
}
