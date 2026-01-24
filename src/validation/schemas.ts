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

export const spawnWorkerSchema = z.object({
  handle: handleSchema,
  teamName: teamNameSchema.optional(),
  workingDir: z.string().max(500).optional(),
  initialPrompt: z.string().max(10000).optional(),
  sessionId: z.string().max(100).optional(),
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
  batchId: z.string().max(20).optional(),
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
  context: z.looseObject({}),
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
  payload: z.looseObject({}),
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
