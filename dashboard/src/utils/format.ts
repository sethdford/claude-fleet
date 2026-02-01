/**
 * Shared formatting utilities.
 * Consolidates duplicated formatUptime / formatTime / formatDate helpers.
 */

import dayjs from 'dayjs';

/** Format a millisecond duration into a compact human-readable string. */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** Format a timestamp or date string as a relative time (e.g. "3 minutes ago"). */
export function formatTime(timestamp: string | number | undefined | null): string {
  if (!timestamp) return 'N/A';
  return dayjs(timestamp).fromNow();
}
