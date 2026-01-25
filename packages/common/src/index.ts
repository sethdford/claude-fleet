/**
 * @cct/common - Shared types, utilities, and validation
 */

export * from './types.js';
// Export validation schemas but rename ValidationResult to avoid conflict with types.ts
export {
  // Session schemas
  sessionIdSchema,
  resumeStrategySchema,
  sessionSearchSchema,
  sessionExportSchema,
  sessionResumeSchema,
  // Fleet schemas
  handleSchema,
  workerStatusSchema,
  workerRoleSchema,
  spawnWorkerSchema,
  sendToWorkerSchema,
  // Task schemas
  taskStatusSchema,
  taskPrioritySchema,
  createTaskSchema,
  updateTaskSchema,
  // Bead schemas
  beadStatusSchema,
  createBeadSchema,
  updateBeadSchema,
  createConvoySchema,
  dispatchConvoySchema,
  // Blackboard schemas
  blackboardPostSchema,
  blackboardReadSchema,
  // Checkpoint schemas
  checkpointCreateSchema,
  // Mail schemas
  mailSendSchema,
  mailReadSchema,
  handoffSchema,
  // Safety schemas
  operationTypeSchema,
  safetyCheckSchema,
  // Workflow schemas
  workflowStepTypeSchema,
  workflowStepSchema,
  createWorkflowSchema,
  // Utility functions - rename to avoid conflict
  validateBody,
  validateQuery,
  type ValidationResult as ZodValidationResult,
} from './validation.js';
export * from './utils.js';
export * from './errors.js';
