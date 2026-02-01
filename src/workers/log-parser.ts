/**
 * Worker Log Parser
 *
 * Wraps the native Rust LogStreamParser (cct-logstream) with a JS fallback.
 * Provides NDJSON parsing with ring buffer output history and health signal extraction.
 */

import { createRequire } from 'node:module';

// --- Shared Types ---

export interface ParsedEvent {
  eventType: string;
  subtype: string;
  sessionId: string;
  text: string;
  isError: boolean;
  timestamp: number;
}

export interface HealthSignal {
  state: string;
  msSinceLastEvent: number;
  errorCount: number;
  totalEvents: number;
  isHealthy: boolean;
}

export interface LogParser {
  parseLine(line: string): ParsedEvent | null;
  parseBatch(chunk: string): ParsedEvent[];
  getHealthSignal(): HealthSignal;
  getRecentOutput(limit?: number): string[];
  getSessionId(): string;
  getState(): string;
}

// --- JS Fallback ---

const MAX_OUTPUT_LINES = 1000;

interface RawClaudeEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
}

class JSLogParser implements LogParser {
  private outputHead = 0;
  private outputCount = 0;
  private readonly outputBuffer: (string | undefined)[] = new Array(MAX_OUTPUT_LINES);
  private lineBuffer = '';
  private sessionId = '';
  private state = 'idle';
  private lastEventAt = 0;
  private errorCount = 0;
  private totalEvents = 0;

  parseLine(line: string): ParsedEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    this.lastEventAt = Date.now();

    try {
      const raw = JSON.parse(trimmed) as RawClaudeEvent;
      return this.processRawEvent(raw);
    } catch {
      // Not JSON — plain text output
      this.pushOutput(trimmed);
      return null;
    }
  }

  parseBatch(chunk: string): ParsedEvent[] {
    const results: ParsedEvent[] = [];
    const data = this.lineBuffer ? this.lineBuffer + chunk : chunk;
    this.lineBuffer = '';

    const lines = data.split('\n');
    const lastLine = lines.pop();
    if (lastLine && lastLine.length > 0) {
      this.lineBuffer = lastLine;
    }

    for (const line of lines) {
      const event = this.parseLine(line);
      if (event) results.push(event);
    }

    return results;
  }

  getHealthSignal(): HealthSignal {
    const now = Date.now();
    const msSince = this.lastEventAt > 0 ? now - this.lastEventAt : 0;
    const isHealthy = msSince < 60_000 || this.state !== 'working';

    return {
      state: this.state,
      msSinceLastEvent: msSince,
      errorCount: this.errorCount,
      totalEvents: this.totalEvents,
      isHealthy,
    };
  }

  getRecentOutput(limit = 100): string[] {
    const result: string[] = [];
    const start = this.outputCount > limit ? this.outputCount - limit : 0;
    const count = this.outputCount - start;
    for (let i = 0; i < count; i++) {
      const idx = (this.outputHead + start + i) % MAX_OUTPUT_LINES;
      const line = this.outputBuffer[idx];
      if (line !== undefined) result.push(line);
    }
    return result;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getState(): string {
    return this.state;
  }

  private processRawEvent(raw: RawClaudeEvent): ParsedEvent {
    const eventType = raw.type ?? '';
    const subtype = raw.subtype ?? '';
    const sessionId = raw.session_id ?? '';
    let text = '';
    let isError = false;

    if (eventType === 'system' && subtype === 'init' && sessionId) {
      this.sessionId = sessionId;
      this.state = 'ready';
    }

    if (eventType === 'assistant') {
      this.state = 'working';
      if (raw.message?.content) {
        for (const c of raw.message.content) {
          if (c.type === 'text' && c.text) {
            text += c.text;
            this.pushOutput(c.text);
          }
        }
      }
    }

    if (eventType === 'result' || subtype === 'error') {
      isError = subtype === 'error';
      if (isError) this.errorCount++;
    }

    this.totalEvents++;

    return {
      eventType,
      subtype,
      sessionId,
      text,
      isError,
      timestamp: Date.now(),
    };
  }

  private pushOutput(line: string): void {
    if (this.outputCount < MAX_OUTPUT_LINES) {
      this.outputBuffer[this.outputCount] = line;
      this.outputCount++;
    } else {
      this.outputBuffer[this.outputHead] = line;
      this.outputHead = (this.outputHead + 1) % MAX_OUTPUT_LINES;
    }
  }
}

// --- Factory ---

let isNativeAvailable: boolean | null = null;

export function createLogParser(): LogParser {
  if (isNativeAvailable === false) {
    return new JSLogParser();
  }

  try {
    const esmRequire = createRequire(import.meta.url);
    const native = esmRequire('@claude-fleet/logstream');
    const inst = new native.LogStreamParser();

    if (isNativeAvailable === null) {
      console.log('[logstream] Using native Rust log parser');
      isNativeAvailable = true;
    }

    return {
      parseLine(line: string): ParsedEvent | null {
        const r = inst.parseLine(line);
        if (!r) return null;
        return {
          eventType: r.event_type,
          subtype: r.subtype,
          sessionId: r.session_id,
          text: r.text,
          isError: r.is_error,
          timestamp: r.timestamp,
        };
      },
      parseBatch(chunk: string): ParsedEvent[] {
        const results = inst.parseBatch(chunk);
        return results.map((r: { event_type: string; subtype: string; session_id: string; text: string; is_error: boolean; timestamp: number }) => ({
          eventType: r.event_type,
          subtype: r.subtype,
          sessionId: r.session_id,
          text: r.text,
          isError: r.is_error,
          timestamp: r.timestamp,
        }));
      },
      getHealthSignal(): HealthSignal {
        const h = inst.getHealthSignal();
        return {
          state: h.state,
          msSinceLastEvent: h.ms_since_last_event,
          errorCount: h.error_count,
          totalEvents: h.total_events,
          isHealthy: h.is_healthy,
        };
      },
      getRecentOutput(limit?: number): string[] {
        return inst.getRecentOutput(limit ?? 100);
      },
      getSessionId(): string {
        return inst.getSessionId();
      },
      getState(): string {
        return inst.getState();
      },
    };
  } catch {
    if (isNativeAvailable === null) {
      console.log('[logstream] Rust log parser not available, using JS fallback');
      isNativeAvailable = false;
    }
    return new JSLogParser();
  }
}
