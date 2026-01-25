/**
 * Environment File Protection Validator
 *
 * Prevents exposure of .env files and other credential files
 * through reading, writing, or displaying their contents.
 */

import type { SafetyValidator, ValidationContext, ValidationResult } from '../types.js';

// Patterns for sensitive environment/credential files
const SENSITIVE_FILE_PATTERNS = [
  /\.env$/,
  /\.env\.[a-zA-Z]+$/,
  /\.env\.local$/,
  /\.env\.development$/,
  /\.env\.production$/,
  /\.env\.staging$/,
  /\.env\.test$/,
  /credentials\.json$/,
  /credentials\.yml$/,
  /credentials\.yaml$/,
  /secrets\.json$/,
  /secrets\.yml$/,
  /secrets\.yaml$/,
  /\.netrc$/,
  /\.npmrc$/,
  /\.pypirc$/,
  /aws\/credentials$/,
  /\.aws\/config$/,
  /gcloud\/credentials$/,
  /\.kube\/config$/,
  /serviceAccountKey.*\.json$/,
  /firebase.*\.json$/,
  /google-services\.json$/,
  /GoogleService-Info\.plist$/,
];

// Commands that could expose file contents
const CONTENT_EXPOSING_COMMANDS = [
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'grep',
  'awk',
  'sed',
  'echo',
  'printf',
  'type', // Windows
  'Get-Content', // PowerShell
];

/**
 * Check if a path matches sensitive patterns
 */
function isSensitivePath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(normalizedPath));
}

/**
 * Extract file paths from a command
 */
function extractFilePaths(command: string): string[] {
  const paths: string[] = [];

  // Split by common separators
  const parts = command.split(/\s+/);

  for (const part of parts) {
    // Skip flags and command names
    if (part.startsWith('-') || CONTENT_EXPOSING_COMMANDS.includes(part)) {
      continue;
    }

    // Check if it looks like a file path
    if (part.includes('.') || part.includes('/') || part.includes('\\')) {
      paths.push(part.replace(/^["']|["']$/g, '')); // Remove quotes
    }
  }

  return paths;
}

/**
 * Validator for environment file protection
 */
export const envFileValidator: SafetyValidator = (
  context: ValidationContext
): ValidationResult => {
  // Check file read operations
  if (context.operation === 'file_read' && context.filePath) {
    if (isSensitivePath(context.filePath)) {
      return {
        allowed: false,
        reason: `Cannot read sensitive file: ${context.filePath}`,
        suggestions: [
          'Use environment variables to access secrets at runtime',
          'Use @cct/vault to securely manage environment files',
          'Never expose credential file contents in logs or output',
        ],
        severity: 'critical',
      };
    }
  }

  // Check file write operations
  if (context.operation === 'file_write' && context.filePath) {
    if (isSensitivePath(context.filePath)) {
      // Writing to env files is allowed but with warnings
      return {
        allowed: true,
        reason: 'Writing to sensitive file - ensure no secrets are logged',
        severity: 'warning',
      };
    }
  }

  // Check env access operations
  if (context.operation === 'env_access') {
    // Allow but don't expose values
    return {
      allowed: true,
      reason: 'Environment variable access - values should not be logged',
      severity: 'warning',
    };
  }

  // Check bash commands that might expose env files
  if (context.operation === 'bash_command' && context.command) {
    const command = context.command.trim();

    // Check if command might expose file contents
    const isContentExposing = CONTENT_EXPOSING_COMMANDS.some(cmd =>
      command.startsWith(cmd + ' ') ||
      command.includes(' ' + cmd + ' ') ||
      command.includes('| ' + cmd) ||
      command.includes('|' + cmd)
    );

    if (isContentExposing) {
      const paths = extractFilePaths(command);

      for (const path of paths) {
        if (isSensitivePath(path)) {
          return {
            allowed: false,
            reason: `Cannot expose contents of sensitive file: ${path}`,
            suggestions: [
              'Use @cct/vault env-safe to check environment variables without exposing values',
              'Load secrets programmatically instead of displaying them',
              'Use secret managers with proper access controls',
            ],
            severity: 'critical',
          };
        }
      }
    }

    // Check for printenv or env commands that might expose secrets
    if (command.startsWith('printenv') || command === 'env' || command.startsWith('env ')) {
      return {
        allowed: false,
        reason: 'Displaying all environment variables may expose secrets',
        suggestions: [
          'Query specific non-sensitive variables instead',
          'Use @cct/vault env-safe for safe environment inspection',
        ],
        severity: 'critical',
      };
    }

    // Check for echo $VAR patterns that might expose secrets
    if (command.includes('echo $') || command.includes('echo "$')) {
      const sensitiveVars = [
        'PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'API_KEY', 'PRIVATE',
        'CREDENTIAL', 'AUTH', 'AWS_', 'GITHUB_TOKEN', 'NPM_TOKEN',
      ];

      for (const sensitiveVar of sensitiveVars) {
        if (command.toUpperCase().includes(sensitiveVar)) {
          return {
            allowed: false,
            reason: 'Cannot echo potentially sensitive environment variable',
            suggestions: [
              'Sensitive values should not be printed to console',
              'Use the value programmatically without displaying it',
            ],
            severity: 'critical',
          };
        }
      }
    }
  }

  return { allowed: true };
};
