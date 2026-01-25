/**
 * File Size Limit Validator
 *
 * Blocks operations on excessively large files to prevent
 * memory issues and accidental large file operations.
 */

import type { SafetyValidator, ValidationContext, ValidationResult } from '../types.js';

// Default limits
const DEFAULT_MAX_READ_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_WRITE_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_MAX_DELETE_SIZE = 100 * 1024 * 1024; // 100MB

// File types with different limits
const BINARY_EXTENSIONS = [
  '.exe', '.dll', '.so', '.dylib',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  '.mp3', '.wav', '.ogg', '.flac',
  '.mp4', '.avi', '.mkv', '.mov', '.webm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.node', '.wasm',
];

const LARGE_TEXT_EXTENSIONS = [
  '.log', '.csv', '.json', '.xml', '.sql',
];

/**
 * Get file extension
 */
function getExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? '.' + parts.pop()!.toLowerCase() : '';
}

/**
 * Check if file is binary
 */
function isBinaryFile(filePath: string): boolean {
  const ext = getExtension(filePath);
  return BINARY_EXTENSIONS.includes(ext);
}

/**
 * Get max allowed size for operation
 */
function getMaxSize(operation: string, filePath: string): number {
  const ext = getExtension(filePath);

  if (operation === 'file_read') {
    // Binary files shouldn't be read as text
    if (isBinaryFile(filePath)) {
      return 1024 * 1024; // 1MB for binary
    }
    // Large text files get higher limit
    if (LARGE_TEXT_EXTENSIONS.includes(ext)) {
      return 50 * 1024 * 1024; // 50MB for large text
    }
    return DEFAULT_MAX_READ_SIZE;
  }

  if (operation === 'file_write') {
    return DEFAULT_MAX_WRITE_SIZE;
  }

  if (operation === 'file_delete') {
    return DEFAULT_MAX_DELETE_SIZE;
  }

  return DEFAULT_MAX_READ_SIZE;
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Validator for file size limits
 */
export const fileSizeValidator: SafetyValidator = (
  context: ValidationContext
): ValidationResult => {
  // Only check file operations
  if (!['file_read', 'file_write', 'file_delete'].includes(context.operation)) {
    return { allowed: true };
  }

  const filePath = context.filePath || '';

  // Check content size for writes
  if (context.operation === 'file_write' && context.content) {
    const size = Buffer.byteLength(context.content, 'utf8');
    const maxSize = getMaxSize(context.operation, filePath);

    if (size > maxSize) {
      return {
        allowed: false,
        reason: `File content too large: ${formatSize(size)} exceeds limit of ${formatSize(maxSize)}`,
        suggestions: [
          'Consider splitting the content into multiple files',
          'Use streaming writes for large files',
          'Compress the data before writing',
        ],
        severity: 'error',
      };
    }
  }

  // Check for potentially large operations via bash
  if (context.operation === 'bash_command' && context.command) {
    const command = context.command.trim();

    // Warn about operations that might create large files
    if (command.includes('dd ') && (command.includes('if=/dev/zero') || command.includes('if=/dev/random'))) {
      return {
        allowed: false,
        reason: 'Creating large files with dd is not allowed',
        suggestions: [
          'Specify a reasonable size limit with count=',
          'Use fallocate for creating sparse files',
        ],
        severity: 'critical',
      };
    }

    // Warn about operations that might read large files
    if (command.includes('cat ') && command.includes('*')) {
      return {
        allowed: true,
        reason: 'Concatenating multiple files may produce large output',
        severity: 'warning',
      };
    }
  }

  // Warn about reading binary files as text
  if (context.operation === 'file_read' && isBinaryFile(filePath)) {
    return {
      allowed: true,
      reason: `Reading binary file ${getExtension(filePath)} - ensure proper handling`,
      severity: 'warning',
    };
  }

  return { allowed: true };
};
