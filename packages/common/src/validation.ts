/**
 * Zod validation schemas for all input data
 */

import { z } from 'zod';

// ============================================================================
// Session Schemas
// ============================================================================

export const sessionIdSchema = z.string().min(1).max(100);

export const resumeStrategySchema = z.enum(['full', 'smart-trim', 'summary-only', 'recent']);

export const sessionSearchSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(100).optional().default(20),
  projectPath: z.string().optional(),
});

export const sessionExportSchema = z.object({
  sessionId: sessionIdSchema,
  format: z.enum(['json', 'markdown', 'html', 'txt']).optional().default('markdown'),
  includeMetadata: z.boolean().optional().default(true),
  includeTimestamps: z.boolean().optional().default(false),
});

export const sessionResumeSchema = z.object({
  id: sessionIdSchema,
  strategy: resumeStrategySchema.optional().default('smart-trim'),
  maxMessages: z.number().int().min(1).max(1000).optional().default(50),
  maxTokens: z.number().int().min(1000).optional().default(100000),
  includeSystemPrompt: z.boolean().optional().default(true),
});

// ============================================================================
// Fleet Schemas
// ============================================================================

export const handleSchema = z.string()
  .min(1)
  .max(50)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Handle must start with a letter and contain only alphanumeric, underscore, or hyphen');

export const workerStatusSchema = z.enum(['pending', 'ready', 'busy', 'error', 'dismissed']);

export const workerRoleSchema = z.enum([
  'coordinator',
  'worker',
  'scout',
  'kraken',
  'oracle',
  'critic',
  'architect',
  'merger',
  'monitor',
  'notifier',
]);

export const spawnWorkerSchema = z.object({
  handle: handleSchema,
  role: workerRoleSchema.optional().default('worker'),
  prompt: z.string().max(10000).optional(),
  worktree: z.boolean().optional().default(true),
  repoPath: z.string().optional(),
});

export const sendToWorkerSchema = z.object({
  to: handleSchema,
  from: handleSchema,
  message: z.string().min(1).max(100000),
  subject: z.string().max(200).optional(),
});

// ============================================================================
// Task Schemas
// ============================================================================

export const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);

export const taskPrioritySchema = z.number().int().min(1).max(5);

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: taskPrioritySchema.optional().default(3),
  assignedTo: handleSchema.optional(),
  dueAt: z.number().optional(),
});

export const updateTaskSchema = z.object({
  status: taskStatusSchema.optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  priority: taskPrioritySchema.optional(),
  assignedTo: handleSchema.optional(),
  dueAt: z.number().optional(),
});

// ============================================================================
// Bead Schemas
// ============================================================================

export const beadStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);

export const createBeadSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  convoyId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateBeadSchema = z.object({
  id: z.string().min(1),
  status: beadStatusSchema,
  actor: z.string().optional(),
});

export const createConvoySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const dispatchConvoySchema = z.object({
  convoyId: z.string().min(1),
  handle: handleSchema,
});

// ============================================================================
// Blackboard Schemas
// ============================================================================

export const blackboardPostSchema = z.object({
  topic: z.string().min(1).max(100),
  message: z.string().min(1).max(100000),
  from: handleSchema.optional(),
  priority: z.number().int().min(0).max(100).optional().default(0),
  expiresIn: z.number().int().min(1000).optional(),
});

export const blackboardReadSchema = z.object({
  topic: z.string().optional(),
  since: z.number().optional(),
  limit: z.number().int().min(1).max(1000).optional().default(50),
  minPriority: z.number().int().optional(),
});

// ============================================================================
// Checkpoint Schemas
// ============================================================================

export const checkpointCreateSchema = z.object({
  workerHandle: handleSchema,
  goal: z.string().min(1).max(5000),
  worked: z.array(z.string().max(500)).optional(),
  remaining: z.array(z.string().max(500)).optional(),
  context: z.record(z.unknown()).optional(),
});

// ============================================================================
// Mail Schemas
// ============================================================================

export const mailSendSchema = z.object({
  from: handleSchema,
  to: handleSchema,
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(100000),
});

export const mailReadSchema = z.object({
  handle: handleSchema,
  unreadOnly: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const handoffSchema = z.object({
  from: handleSchema,
  to: handleSchema,
  context: z.record(z.unknown()),
});

// ============================================================================
// Safety Schemas
// ============================================================================

export const operationTypeSchema = z.enum([
  'bash_command',
  'file_read',
  'file_write',
  'file_delete',
  'git_commit',
  'env_access',
]);

export const safetyCheckSchema = z.object({
  operation: operationTypeSchema,
  command: z.string().optional(),
  filePath: z.string().optional(),
  content: z.string().optional(),
});

// ============================================================================
// Workflow Schemas
// ============================================================================

export const workflowStepTypeSchema = z.enum([
  'task',
  'spawn',
  'checkpoint',
  'gate',
  'parallel',
  'script',
]);

export const workflowStepSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: workflowStepTypeSchema,
  config: z.record(z.unknown()),
  dependsOn: z.array(z.string()).optional(),
  timeout: z.number().int().min(1000).optional(),
  retries: z.number().int().min(0).max(10).optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  steps: z.array(workflowStepSchema).min(1),
  context: z.record(z.unknown()).optional(),
});

// ============================================================================
// Utility Functions
// ============================================================================

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function validateBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
  };
}

export function validateQuery<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  return validateBody(schema, data);
}
