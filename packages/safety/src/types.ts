/**
 * Safety hook types
 */

export interface SafetyHook {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  validator: SafetyValidator;
}

export type SafetyValidator = (context: ValidationContext) => ValidationResult;

export interface ValidationContext {
  command?: string;
  args?: string[];
  filePath?: string;
  content?: string;
  operation: OperationType;
  metadata?: Record<string, unknown>;
}

export type OperationType =
  | 'bash_command'
  | 'file_write'
  | 'file_delete'
  | 'git_commit'
  | 'git_push'
  | 'file_read'
  | 'env_access';

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  suggestions?: string[];
  severity?: 'warning' | 'error' | 'critical';
}

export interface SafetyConfig {
  enabled: boolean;
  hooks: SafetyHook[];
  allowList?: string[];
  denyList?: string[];
  maxFileSize?: number;
  protectedPaths?: string[];
}

export interface SafetyCheckResult {
  allowed: boolean;
  blockedBy?: string;
  reason?: string;
  suggestions?: string[];
  warnings: string[];
  checksPerformed: string[];
}
