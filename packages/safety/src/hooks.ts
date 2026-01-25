/**
 * Safety hook management and execution
 */

import type {
  SafetyHook,
  SafetyConfig,
  ValidationContext,
  SafetyCheckResult,
} from './types.js';
import { SafetyError } from '@claude-fleet/common';

// Default hooks
import { rmRfValidator } from './validators/rm-rf.js';
import { gitCommitValidator } from './validators/git-commit.js';
import { envFileValidator } from './validators/env-file.js';
import { fileSizeValidator } from './validators/file-size.js';
import { dangerousCommandValidator } from './validators/dangerous-commands.js';

/**
 * Default safety hooks configuration
 */
const DEFAULT_HOOKS: SafetyHook[] = [
  {
    id: 'rm-rf',
    name: 'rm -rf Protection',
    description: 'Blocks destructive recursive deletion commands',
    enabled: true,
    priority: 100,
    validator: rmRfValidator,
  },
  {
    id: 'git-commit',
    name: 'Git Commit Review',
    description: 'Requires review before committing changes',
    enabled: true,
    priority: 90,
    validator: gitCommitValidator,
  },
  {
    id: 'env-file',
    name: 'Environment File Protection',
    description: 'Prevents exposure of .env and credential files',
    enabled: true,
    priority: 95,
    validator: envFileValidator,
  },
  {
    id: 'file-size',
    name: 'File Size Limit',
    description: 'Blocks operations on excessively large files',
    enabled: true,
    priority: 80,
    validator: fileSizeValidator,
  },
  {
    id: 'dangerous-commands',
    name: 'Dangerous Command Blocker',
    description: 'Blocks known dangerous shell commands',
    enabled: true,
    priority: 100,
    validator: dangerousCommandValidator,
  },
];

/**
 * Safety hook manager
 */
export class SafetyManager {
  private config: SafetyConfig;
  private hooks: Map<string, SafetyHook>;

  constructor(config?: Partial<SafetyConfig>) {
    this.config = {
      enabled: true,
      hooks: DEFAULT_HOOKS,
      maxFileSize: 10 * 1024 * 1024, // 10MB default
      protectedPaths: ['.env', '.env.local', '.env.production', 'credentials.json'],
      ...config,
    };

    this.hooks = new Map();
    for (const hook of this.config.hooks) {
      this.hooks.set(hook.id, hook);
    }
  }

  /**
   * Check if an operation is allowed
   */
  check(context: ValidationContext): SafetyCheckResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        warnings: [],
        checksPerformed: [],
      };
    }

    const checksPerformed: string[] = [];
    const warnings: string[] = [];
    const sortedHooks = Array.from(this.hooks.values())
      .filter(h => h.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const hook of sortedHooks) {
      checksPerformed.push(hook.id);

      try {
        const result = hook.validator(context);

        if (!result.allowed) {
          return {
            allowed: false,
            blockedBy: hook.id,
            reason: result.reason ?? `Blocked by ${hook.name}`,
            ...(result.suggestions && { suggestions: result.suggestions }),
            warnings,
            checksPerformed,
          };
        }

        // Collect warnings from validators that allow but warn
        if (result.severity === 'warning' && result.reason) {
          warnings.push(result.reason);
        }
      } catch (error) {
        // If a validator throws, treat it as a block for safety
        console.error(`[SAFETY] Hook ${hook.id} threw error:`, error);
        return {
          allowed: false,
          blockedBy: hook.id,
          reason: `Safety check failed: ${(error as Error).message}`,
          warnings,
          checksPerformed,
        };
      }
    }

    return {
      allowed: true,
      warnings,
      checksPerformed,
    };
  }

  /**
   * Check and throw if not allowed
   */
  enforce(context: ValidationContext): void {
    const result = this.check(context);
    if (!result.allowed) {
      throw new SafetyError(result.reason ?? 'Operation blocked', {
        ...(result.blockedBy && { hookId: result.blockedBy }),
        ...(context.command && { command: context.command }),
        details: {
          suggestions: result.suggestions,
          checksPerformed: result.checksPerformed,
        },
      });
    }
  }

  /**
   * Enable a specific hook
   */
  enableHook(hookId: string): boolean {
    const hook = this.hooks.get(hookId);
    if (hook) {
      hook.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * Disable a specific hook
   */
  disableHook(hookId: string): boolean {
    const hook = this.hooks.get(hookId);
    if (hook) {
      hook.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Add a custom hook
   */
  addHook(hook: SafetyHook): void {
    this.hooks.set(hook.id, hook);
  }

  /**
   * Remove a hook
   */
  removeHook(hookId: string): boolean {
    return this.hooks.delete(hookId);
  }

  /**
   * Get all hooks
   */
  getHooks(): SafetyHook[] {
    return Array.from(this.hooks.values());
  }

  /**
   * Get hook by ID
   */
  getHook(hookId: string): SafetyHook | undefined {
    return this.hooks.get(hookId);
  }

  /**
   * Get hook status
   */
  getStatus(): {
    enabled: boolean;
    activeHooks: number;
    totalHooks: number;
    hooks: { id: string; name: string; description: string; enabled: boolean }[];
  } {
    const hooks = Array.from(this.hooks.values());
    return {
      enabled: this.config.enabled,
      activeHooks: hooks.filter(h => h.enabled).length,
      totalHooks: hooks.length,
      hooks: hooks.map(h => ({
        id: h.id,
        name: h.name,
        description: h.description,
        enabled: h.enabled,
      })),
    };
  }

  /**
   * Enable all safety checks
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable all safety checks (use with caution!)
   */
  disable(): void {
    this.config.enabled = false;
    console.warn('[SAFETY] All safety checks have been disabled!');
  }
}

// Default singleton instance
let defaultManager: SafetyManager | undefined;

/**
 * Get the default safety manager
 */
export function getSafetyManager(): SafetyManager {
  if (!defaultManager) {
    defaultManager = new SafetyManager();
  }
  return defaultManager;
}

/**
 * Quick check function
 */
export function checkSafety(context: ValidationContext): SafetyCheckResult {
  return getSafetyManager().check(context);
}

/**
 * Quick enforce function
 */
export function enforceSafety(context: ValidationContext): void {
  getSafetyManager().enforce(context);
}
