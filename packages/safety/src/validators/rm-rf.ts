/**
 * rm -rf Protection Validator
 *
 * Blocks destructive recursive deletion commands that could
 * accidentally wipe important directories.
 */

import type { SafetyValidator, ValidationContext, ValidationResult } from '../types.js';

// Patterns that indicate dangerous rm commands
const DANGEROUS_RM_PATTERNS = [
  // rm -rf / or rm -rf /*
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+\/(\s|$|\*)/,
  // rm -rf ~
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+~(\s|$|\/)/,
  // rm -rf $HOME
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+\$HOME(\s|$|\/)/,
  // rm -rf . or rm -rf ..
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+\.\.?(\s|$)/,
  // rm -rf * (in any directory)
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+\*(\s|$)/,
];

// Protected directories that should never be deleted
const PROTECTED_PATHS = [
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/home',
  '/lib',
  '/lib64',
  '/opt',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/srv',
  '/sys',
  '/tmp',
  '/usr',
  '/var',
  '/Applications',
  '/Library',
  '/System',
  '/Users',
  '/Volumes',
];

/**
 * Check if a path is protected
 */
function isProtectedPath(path: string): boolean {
  const normalizedPath = path.replace(/\/+$/, ''); // Remove trailing slashes

  for (const protectedPath of PROTECTED_PATHS) {
    if (normalizedPath === protectedPath) return true;
    if (normalizedPath.startsWith(protectedPath + '/') &&
        normalizedPath.split('/').length <= 3) {
      return true; // Protect top-level subdirectories
    }
  }

  return false;
}

/**
 * Extract paths from rm command
 */
function extractPaths(command: string): string[] {
  const paths: string[] = [];

  // Remove the rm command and flags
  const match = command.match(/rm\s+(-[a-zA-Z]*\s+)*(.+)/);
  if (match && match[2]) {
    // Split by spaces, handling quoted strings
    const parts = match[2].match(/("[^"]*"|'[^']*'|\S+)/g) || [];
    for (const part of parts) {
      // Remove quotes
      const path = part.replace(/^["']|["']$/g, '');
      if (!path.startsWith('-')) {
        paths.push(path);
      }
    }
  }

  return paths;
}

/**
 * Validator for rm -rf commands
 */
export const rmRfValidator: SafetyValidator = (
  context: ValidationContext
): ValidationResult => {
  // Only check bash commands
  if (context.operation !== 'bash_command' || !context.command) {
    return { allowed: true };
  }

  const command = context.command.trim();

  // Check if this is an rm command
  if (!command.startsWith('rm ') && !command.includes('| rm ') && !command.includes('&& rm ')) {
    return { allowed: true };
  }

  // Check against dangerous patterns
  for (const pattern of DANGEROUS_RM_PATTERNS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: 'Dangerous rm command detected that could delete critical system files',
        suggestions: [
          'Review the paths you are trying to delete',
          'Use more specific paths instead of wildcards',
          'Consider using trash/recycling instead of permanent deletion',
        ],
        severity: 'critical',
      };
    }
  }

  // Check if any paths are protected
  const paths = extractPaths(command);
  for (const path of paths) {
    if (isProtectedPath(path)) {
      return {
        allowed: false,
        reason: `Cannot delete protected path: ${path}`,
        suggestions: [
          'This path is protected to prevent accidental data loss',
          'If you really need to delete this, do it manually with extreme caution',
        ],
        severity: 'critical',
      };
    }
  }

  // Check for recursive flag without explicit confirmation
  if (command.includes('-r') || command.includes('-R')) {
    const hasForce = command.includes('-f');

    if (hasForce) {
      // Allow but warn if paths seem safe
      return {
        allowed: true,
        reason: 'Recursive force deletion - proceed with caution',
        severity: 'warning',
      };
    }
  }

  return { allowed: true };
};
