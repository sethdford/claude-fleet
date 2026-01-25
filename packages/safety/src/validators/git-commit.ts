/**
 * Git Commit Review Validator
 *
 * Ensures commits are reviewed before being created,
 * and prevents committing sensitive files.
 */

import type { SafetyValidator, ValidationContext, ValidationResult } from '../types.js';

// Files that should never be committed
const SENSITIVE_FILE_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /credentials\.json$/,
  /secrets\.json$/,
  /\.pem$/,
  /\.key$/,
  /id_rsa$/,
  /id_ed25519$/,
  /\.p12$/,
  /\.pfx$/,
  /serviceAccountKey\.json$/,
  /firebase-adminsdk.*\.json$/,
];

// Patterns in commit messages that might indicate problematic commits
const PROBLEMATIC_MESSAGE_PATTERNS = [
  /wip/i,
  /work in progress/i,
  /todo/i,
  /fixme/i,
  /hack/i,
  /temp/i,
  /temporary/i,
  /debug/i,
  /test commit/i,
  /asdf/i,
  /xxx/i,
];

/**
 * Extract files from git add or commit command
 */
function extractGitFiles(command: string): string[] {
  const files: string[] = [];

  // Handle git add
  if (command.includes('git add')) {
    const match = command.match(/git\s+add\s+(.+)/);
    if (match && match[1]) {
      const parts = match[1].trim().split(/\s+/);
      for (const part of parts) {
        if (!part.startsWith('-') && part !== '.') {
          files.push(part);
        }
      }
      // git add . or git add -A stages everything
      if (match[1].includes(' . ') || match[1].endsWith(' .') ||
          match[1].includes('-A') || match[1].includes('--all')) {
        files.push('*'); // Marker for "all files"
      }
    }
  }

  return files;
}

/**
 * Extract commit message
 */
function extractCommitMessage(command: string): string | undefined {
  const messageMatch = command.match(/-m\s+["']([^"']+)["']/);
  if (messageMatch) {
    return messageMatch[1];
  }
  return undefined;
}

/**
 * Check if a file matches sensitive patterns
 */
function isSensitiveFile(filePath: string): boolean {
  const filename = filePath.split('/').pop() || filePath;
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(filename));
}

/**
 * Validator for git commit commands
 */
export const gitCommitValidator: SafetyValidator = (
  context: ValidationContext
): ValidationResult => {
  // Only check bash commands and git operations
  if (context.operation !== 'bash_command' && context.operation !== 'git_commit') {
    return { allowed: true };
  }

  const command = context.command?.trim() || '';

  // Check git add for sensitive files
  if (command.includes('git add')) {
    const files = extractGitFiles(command);

    // Check for staging all files
    if (files.includes('*')) {
      return {
        allowed: false,
        reason: 'Staging all files may include sensitive files. Stage specific files instead.',
        suggestions: [
          'Use `git add <specific-file>` instead of `git add .` or `git add -A`',
          'Review which files have changed with `git status` first',
          'Add sensitive files to .gitignore',
        ],
        severity: 'warning',
      };
    }

    // Check for specific sensitive files
    for (const file of files) {
      if (isSensitiveFile(file)) {
        return {
          allowed: false,
          reason: `Cannot stage sensitive file: ${file}`,
          suggestions: [
            'Add this file to .gitignore',
            'Use environment variables instead of committing credentials',
            'Use a secrets manager for sensitive data',
          ],
          severity: 'critical',
        };
      }
    }
  }

  // Check git commit
  if (command.includes('git commit')) {
    const message = extractCommitMessage(command);

    // Check for empty or very short messages
    if (message && message.length < 5) {
      return {
        allowed: false,
        reason: 'Commit message is too short. Please provide a meaningful description.',
        suggestions: [
          'Describe what changes were made and why',
          'Follow conventional commit format: type(scope): description',
          'Reference related issues if applicable',
        ],
        severity: 'warning',
      };
    }

    // Check for problematic message patterns
    if (message) {
      for (const pattern of PROBLEMATIC_MESSAGE_PATTERNS) {
        if (pattern.test(message)) {
          return {
            allowed: true, // Allow but warn
            reason: `Commit message contains '${message.match(pattern)?.[0]}' - consider reviewing`,
            severity: 'warning',
          };
        }
      }
    }

    // Check for --no-verify flag (bypassing hooks)
    if (command.includes('--no-verify') || command.includes('-n')) {
      return {
        allowed: false,
        reason: 'Bypassing git hooks is not allowed',
        suggestions: [
          'Fix the issues that caused the pre-commit hooks to fail',
          'If hooks are incorrectly failing, fix the hook configuration',
        ],
        severity: 'error',
      };
    }

    // Check for force push
    if (command.includes('--force') || command.includes('-f')) {
      return {
        allowed: false,
        reason: 'Force pushing can overwrite remote history',
        suggestions: [
          'Use `git push --force-with-lease` for safer force pushing',
          'Coordinate with team members before force pushing',
          'Consider if a force push is really necessary',
        ],
        severity: 'critical',
      };
    }
  }

  // Check git push
  if (command.includes('git push')) {
    // Check for force push
    if (command.includes('--force') || command.includes('-f')) {
      if (!command.includes('--force-with-lease')) {
        return {
          allowed: false,
          reason: 'Force pushing without --force-with-lease is dangerous',
          suggestions: [
            'Use `git push --force-with-lease` instead',
            'This prevents overwriting changes others may have pushed',
          ],
          severity: 'critical',
        };
      }
    }

    // Check for pushing to protected branches
    if (command.includes('main') || command.includes('master') || command.includes('production')) {
      return {
        allowed: true,
        reason: 'Pushing to a protected branch - ensure this is intentional',
        severity: 'warning',
      };
    }
  }

  return { allowed: true };
};
