/**
 * Session Export
 *
 * Export sessions to various formats for sharing or archiving.
 */

import type { Session, SessionMessage } from '@claude-fleet/common';
import { SessionStore } from '@claude-fleet/storage';

export type ExportFormat = 'markdown' | 'json' | 'html' | 'txt';

export interface ExportOptions {
  format?: ExportFormat;
  includeMetadata?: boolean;
  includeTimestamps?: boolean;
}

export interface ExportResult {
  content: string;
  format: ExportFormat;
  filename: string;
}

export class SessionExporter {
  private store: SessionStore;

  constructor() {
    this.store = new SessionStore();
  }

  /**
   * Export a session to the specified format
   */
  export(sessionId: string, options: ExportOptions = {}): ExportResult | undefined {
    const { format = 'markdown', includeMetadata = true, includeTimestamps = false } = options;

    const session = this.store.get(sessionId);
    if (!session) return undefined;

    const messages = this.store.getMessages(sessionId, { limit: 10000 });

    let content: string;
    let extension: string;

    switch (format) {
      case 'json':
        content = this.toJson(session, messages, includeMetadata);
        extension = 'json';
        break;

      case 'html':
        content = this.toHtml(session, messages, includeMetadata, includeTimestamps);
        extension = 'html';
        break;

      case 'txt':
        content = this.toTxt(session, messages, includeTimestamps);
        extension = 'txt';
        break;

      case 'markdown':
      default:
        content = this.toMarkdown(session, messages, includeMetadata, includeTimestamps);
        extension = 'md';
        break;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `session-${session.id.slice(0, 8)}-${timestamp}.${extension}`;

    return { content, format, filename };
  }

  /**
   * Export to JSON
   */
  private toJson(
    session: Session,
    messages: SessionMessage[],
    includeMetadata: boolean
  ): string {
    const data: Record<string, unknown> = {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    };

    if (includeMetadata) {
      data.metadata = {
        id: session.id,
        projectPath: session.projectPath,
        createdAt: session.createdAt,
        lastAccessed: session.lastAccessed,
        messageCount: session.messageCount,
        summary: session.summary,
        tags: session.tags,
        lineage: session.lineage,
      };
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * Export to Markdown
   */
  private toMarkdown(
    session: Session,
    messages: SessionMessage[],
    includeMetadata: boolean,
    includeTimestamps: boolean
  ): string {
    const lines: string[] = [];

    lines.push(`# Session Export`);
    lines.push('');

    if (includeMetadata) {
      lines.push('## Metadata');
      lines.push('');
      lines.push(`- **Session ID:** ${session.id}`);
      lines.push(`- **Project:** ${session.projectPath}`);
      lines.push(`- **Created:** ${new Date(session.createdAt).toISOString()}`);
      lines.push(`- **Last Accessed:** ${new Date(session.lastAccessed).toISOString()}`);
      lines.push(`- **Messages:** ${session.messageCount}`);

      if (session.tags && session.tags.length > 0) {
        lines.push(`- **Tags:** ${session.tags.join(', ')}`);
      }

      if (session.summary) {
        lines.push('');
        lines.push('### Summary');
        lines.push(session.summary);
      }

      lines.push('');
    }

    lines.push('## Conversation');
    lines.push('');

    for (const msg of messages) {
      const roleLabel = msg.role === 'user' ? '**User**' : msg.role === 'assistant' ? '**Assistant**' : '**System**';

      if (includeTimestamps) {
        lines.push(`### ${roleLabel} (${new Date(msg.timestamp).toISOString()})`);
      } else {
        lines.push(`### ${roleLabel}`);
      }

      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Export to HTML
   */
  private toHtml(
    session: Session,
    messages: SessionMessage[],
    includeMetadata: boolean,
    includeTimestamps: boolean
  ): string {
    const escapeHtml = (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    const lines: string[] = [];

    lines.push('<!DOCTYPE html>');
    lines.push('<html lang="en">');
    lines.push('<head>');
    lines.push('  <meta charset="UTF-8">');
    lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
    lines.push(`  <title>Session ${session.id}</title>`);
    lines.push('  <style>');
    lines.push('    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }');
    lines.push('    .message { margin: 20px 0; padding: 15px; border-radius: 8px; }');
    lines.push('    .user { background: #e3f2fd; }');
    lines.push('    .assistant { background: #f5f5f5; }');
    lines.push('    .system { background: #fff3e0; }');
    lines.push('    .role { font-weight: bold; margin-bottom: 10px; }');
    lines.push('    .timestamp { color: #666; font-size: 0.8em; }');
    lines.push('    pre { background: #263238; color: #fff; padding: 15px; border-radius: 4px; overflow-x: auto; }');
    lines.push('    code { background: #e0e0e0; padding: 2px 6px; border-radius: 3px; }');
    lines.push('    .metadata { background: #fafafa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }');
    lines.push('  </style>');
    lines.push('</head>');
    lines.push('<body>');

    lines.push(`<h1>Session Export</h1>`);

    if (includeMetadata) {
      lines.push('<div class="metadata">');
      lines.push('<h2>Metadata</h2>');
      lines.push(`<p><strong>Session ID:</strong> ${escapeHtml(session.id)}</p>`);
      lines.push(`<p><strong>Project:</strong> ${escapeHtml(session.projectPath)}</p>`);
      lines.push(`<p><strong>Created:</strong> ${new Date(session.createdAt).toISOString()}</p>`);
      lines.push(`<p><strong>Messages:</strong> ${session.messageCount}</p>`);

      if (session.tags && session.tags.length > 0) {
        lines.push(`<p><strong>Tags:</strong> ${session.tags.map(escapeHtml).join(', ')}</p>`);
      }

      if (session.summary) {
        lines.push(`<h3>Summary</h3>`);
        lines.push(`<p>${escapeHtml(session.summary)}</p>`);
      }

      lines.push('</div>');
    }

    lines.push('<h2>Conversation</h2>');

    for (const msg of messages) {
      lines.push(`<div class="message ${msg.role}">`);
      lines.push(`<div class="role">${msg.role.charAt(0).toUpperCase() + msg.role.slice(1)}</div>`);

      if (includeTimestamps) {
        lines.push(`<div class="timestamp">${new Date(msg.timestamp).toISOString()}</div>`);
      }

      // Simple markdown-like processing for code blocks
      let content = escapeHtml(msg.content);
      content = content.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
      content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
      content = content.replace(/\n/g, '<br>');

      lines.push(`<div class="content">${content}</div>`);
      lines.push('</div>');
    }

    lines.push('</body>');
    lines.push('</html>');

    return lines.join('\n');
  }

  /**
   * Export to plain text
   */
  private toTxt(
    session: Session,
    messages: SessionMessage[],
    includeTimestamps: boolean
  ): string {
    const lines: string[] = [];

    lines.push(`Session: ${session.id}`);
    lines.push(`Project: ${session.projectPath}`);
    lines.push(`Created: ${new Date(session.createdAt).toISOString()}`);
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('');

    for (const msg of messages) {
      const roleLabel = msg.role.toUpperCase();

      if (includeTimestamps) {
        lines.push(`[${new Date(msg.timestamp).toISOString()}] ${roleLabel}:`);
      } else {
        lines.push(`${roleLabel}:`);
      }

      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('-'.repeat(40));
      lines.push('');
    }

    return lines.join('\n');
  }
}
