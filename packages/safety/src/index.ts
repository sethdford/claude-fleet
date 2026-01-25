/**
 * @cct/safety - Safety hooks to prevent dangerous operations
 *
 * Provides protection against:
 * - Destructive file operations (rm -rf, etc.)
 * - Unreviewed git commits
 * - Exposure of sensitive files (.env)
 * - Excessively large file operations
 */

export * from './hooks.js';
export * from './validators/index.js';
export * from './types.js';
