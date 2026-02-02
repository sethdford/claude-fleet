/**
 * Worker Terminal Formatting Helpers
 * Pure functions for formatting Claude Code events into xterm.js output.
 * Extracted from worker.ts to keep files under 500 lines.
 */

import type { Terminal } from '@xterm/xterm';

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ClaudeEvent {
  type?: string;
  message?: { content: ContentBlock[] };
  result?: {
    cost_usd?: number;
    duration_ms?: number;
    duration_api_ms?: number;
    model?: string;
    num_turns?: number;
  };
  error?: string;
  subtype?: string;
}

/**
 * Format a timestamp prefix for terminal lines
 */
function termTimestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `\x1b[90m${hh}:${mm}:${ss}\x1b[0m`;
}

/**
 * Word-wrap text to a given width, returning an array of lines
 */
function wordWrap(text: string, width: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.length <= width) {
      lines.push(rawLine);
      continue;
    }
    let remaining = rawLine;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(' ', width);
      if (breakAt <= 0) breakAt = width;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

/**
 * Format a tool_use input object into a compact parameter summary
 */
function formatToolParams(input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return '';
  if (input.file_path) return ` ${input.file_path}`;
  if (input.command) return ` $ ${String(input.command).slice(0, 80)}`;
  if (input.pattern) return ` ${input.pattern}`;
  if (input.query) return ` "${String(input.query).slice(0, 60)}"`;
  if (input.url) return ` ${String(input.url).slice(0, 80)}`;
  const firstStr = Object.values(input).find(v => typeof v === 'string');
  return firstStr ? ` ${String(firstStr).slice(0, 60)}` : '';
}

/**
 * Format Claude Code event to terminal
 */
function formatEventToTerminal(term: Terminal, event: ClaudeEvent): void {
  if (!event || typeof event !== 'object') {
    term.writeln(String(event));
    return;
  }

  const ts = termTimestamp();
  const type = event.type || 'unknown';
  const WRAP_WIDTH = 100;

  switch (type) {
    case 'assistant':
      if (event.message?.content) {
        event.message.content.forEach((block: ContentBlock) => {
          if (block.type === 'text') {
            const wrapped = wordWrap(block.text || '', WRAP_WIDTH);
            wrapped.forEach((line: string, i: number) => {
              const prefix = i === 0 ? `${ts} \x1b[36m` : '         \x1b[36m';
              term.writeln(`${prefix}${line}\x1b[0m`);
            });
          } else if (block.type === 'tool_use') {
            const params = formatToolParams(block.input);
            term.writeln(`${ts} \x1b[33m[Tool: ${block.name}${params}]\x1b[0m`);
          }
        });
      }
      break;

    case 'result': {
      const r = event.result || {};
      const parts: string[] = [];
      if (r.cost_usd !== null && r.cost_usd !== undefined) parts.push(`cost: $${r.cost_usd.toFixed(4)}`);
      if (r.duration_ms !== null && r.duration_ms !== undefined) parts.push(`duration: ${(r.duration_ms / 1000).toFixed(1)}s`);
      if (r.duration_api_ms !== null && r.duration_api_ms !== undefined) parts.push(`api: ${(r.duration_api_ms / 1000).toFixed(1)}s`);
      if (r.model) parts.push(`model: ${r.model}`);
      if (r.num_turns !== null && r.num_turns !== undefined) parts.push(`turns: ${r.num_turns}`);
      const summary = parts.length ? parts.join(' | ') : JSON.stringify(r).slice(0, 150);
      term.writeln(`${ts} \x1b[32m✓ Completed — ${summary}\x1b[0m`);
      break;
    }

    case 'user':
      if (event.message?.content) {
        event.message.content.forEach((block: ContentBlock) => {
          if (block.type === 'text') {
            const wrapped = wordWrap(block.text || '', WRAP_WIDTH - 2);
            wrapped.forEach((line: string, i: number) => {
              const prefix = i === 0 ? `${ts} \x1b[34m> ` : '         \x1b[34m  ';
              term.writeln(`${prefix}${line}\x1b[0m`);
            });
          }
        });
      }
      break;

    case 'error':
      term.writeln(`${ts} \x1b[31m✗ Error: ${event.error || JSON.stringify(event)}\x1b[0m`);
      break;

    case 'system':
      term.writeln(`${ts} \x1b[90m● ${event.subtype || 'system event'}\x1b[0m`);
      break;

    default: {
      const preview = JSON.stringify(event).slice(0, 120);
      term.writeln(`${ts} \x1b[90m[${type}] ${preview}${preview.length >= 120 ? '...' : ''}\x1b[0m`);
    }
  }
}

/**
 * Write content to terminal, handling JSON and plain text
 */
export function writeToTerminal(term: Terminal, content: unknown): void {
  try {
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content) as ClaudeEvent;
        formatEventToTerminal(term, parsed);
      } catch {
        term.writeln(content);
      }
    } else if (typeof content === 'object') {
      formatEventToTerminal(term, content as ClaudeEvent);
    }
  } catch {
    term.writeln(String(content));
  }
}
