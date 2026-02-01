/**
 * HTML escaping utilities — single canonical source.
 * Replaces 13+ duplicate copies scattered across the old JS dashboard.
 */

const div = document.createElement('div');

/** Escape text for safe insertion into innerHTML contexts. */
export function escapeHtml(text: unknown): string {
  if (!text) return '';
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Escape text for safe insertion into HTML attribute values.
 * Handles quotes and angle brackets that escapeHtml does not cover
 * when the value is placed inside an attribute string.
 */
export function escapeAttr(text: unknown): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
