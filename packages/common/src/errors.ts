/**
 * Custom error classes for consistent error handling
 */

/**
 * Base error class for all CCT errors
 */
export class CCTError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'CCTError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

/**
 * Validation error for invalid input data
 */
export class ValidationError extends CCTError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error for missing resources
 */
export class NotFoundError extends CCTError {
  constructor(resource: string, id?: string) {
    const message = id
      ? `${resource} '${id}' not found`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', { resource, id });
    this.name = 'NotFoundError';
  }
}

/**
 * Conflict error for duplicate resources
 */
export class ConflictError extends CCTError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFLICT', details);
    this.name = 'ConflictError';
  }
}

/**
 * Authorization error for permission issues
 */
export class AuthorizationError extends CCTError {
  constructor(message: string, details?: unknown) {
    super(message, 'UNAUTHORIZED', details);
    this.name = 'AuthorizationError';
  }
}

/**
 * Worker error for fleet orchestration issues
 */
export class WorkerError extends CCTError {
  public readonly handle?: string;
  public readonly workerId?: string;

  constructor(message: string, options?: { handle?: string; workerId?: string; details?: unknown }) {
    super(message, 'WORKER_ERROR', options?.details);
    this.name = 'WorkerError';
    this.handle = options?.handle;
    this.workerId = options?.workerId;
  }
}

/**
 * Spawn error for worker spawning issues
 */
export class SpawnError extends CCTError {
  constructor(message: string, details?: unknown) {
    super(message, 'SPAWN_ERROR', details);
    this.name = 'SpawnError';
  }
}

/**
 * Workflow error for execution issues
 */
export class WorkflowError extends CCTError {
  public readonly workflowId?: string;
  public readonly executionId?: string;
  public readonly stepId?: string;

  constructor(message: string, options?: {
    workflowId?: string;
    executionId?: string;
    stepId?: string;
    details?: unknown;
  }) {
    super(message, 'WORKFLOW_ERROR', options?.details);
    this.name = 'WorkflowError';
    this.workflowId = options?.workflowId;
    this.executionId = options?.executionId;
    this.stepId = options?.stepId;
  }
}

/**
 * Safety error for blocked operations
 */
export class SafetyError extends CCTError {
  public readonly hookId?: string;
  public readonly command?: string;

  constructor(message: string, options?: { hookId?: string; command?: string; details?: unknown }) {
    super(message, 'SAFETY_BLOCKED', options?.details);
    this.name = 'SafetyError';
    this.hookId = options?.hookId;
    this.command = options?.command;
  }
}

/**
 * Storage error for database issues
 */
export class StorageError extends CCTError {
  constructor(message: string, details?: unknown) {
    super(message, 'STORAGE_ERROR', details);
    this.name = 'StorageError';
  }
}

/**
 * Session error for session management issues
 */
export class SessionError extends CCTError {
  public readonly sessionId?: string;

  constructor(message: string, options?: { sessionId?: string; details?: unknown }) {
    super(message, 'SESSION_ERROR', options?.details);
    this.name = 'SessionError';
    this.sessionId = options?.sessionId;
  }
}

/**
 * Timeout error for operations that exceed time limits
 */
export class TimeoutError extends CCTError {
  public readonly timeoutMs?: number;

  constructor(message: string, timeoutMs?: number, details?: unknown) {
    super(message, 'TIMEOUT', details);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Check if an error is a CCTError
 */
export function isCCTError(error: unknown): error is CCTError {
  return error instanceof CCTError;
}

/**
 * Wrap an unknown error as a CCTError
 */
export function wrapError(error: unknown, defaultMessage = 'An error occurred'): CCTError {
  if (error instanceof CCTError) return error;
  if (error instanceof Error) {
    return new CCTError(error.message, 'UNKNOWN_ERROR', {
      originalName: error.name,
      stack: error.stack
    });
  }
  return new CCTError(defaultMessage, 'UNKNOWN_ERROR', { originalError: error });
}
