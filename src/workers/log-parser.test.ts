/**
 * Tests for Worker Log Parser
 *
 * Tests the JS fallback LogParser (native Rust not available in tests).
 * Covers: NDJSON parsing, ring buffer, health signals, batch parsing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createLogParser, type LogParser } from './log-parser.js';

describe('Log Parser (JS Fallback)', () => {
  let parser: LogParser;

  beforeEach(() => {
    parser = createLogParser();
  });

  // ======================================================================
  // FACTORY
  // ======================================================================

  describe('createLogParser', () => {
    it('should return a LogParser with all required methods', () => {
      expect(parser.parseLine).toBeDefined();
      expect(parser.parseBatch).toBeDefined();
      expect(parser.getHealthSignal).toBeDefined();
      expect(parser.getRecentOutput).toBeDefined();
      expect(parser.getSessionId).toBeDefined();
      expect(parser.getState).toBeDefined();
    });

    it('should start in idle state with empty session', () => {
      expect(parser.getState()).toBe('idle');
      expect(parser.getSessionId()).toBe('');
    });
  });

  // ======================================================================
  // parseLine
  // ======================================================================

  describe('parseLine', () => {
    it('should return null for empty lines', () => {
      expect(parser.parseLine('')).toBeNull();
      expect(parser.parseLine('   ')).toBeNull();
    });

    it('should return null for non-JSON text (but store in output)', () => {
      expect(parser.parseLine('plain text output')).toBeNull();
      const output = parser.getRecentOutput();
      expect(output).toContain('plain text output');
    });

    it('should parse a system init event', () => {
      const event = parser.parseLine(JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-abc',
      }));
      expect(event).not.toBeNull();
      expect(event!.eventType).toBe('system');
      expect(event!.subtype).toBe('init');
      expect(event!.sessionId).toBe('sess-abc');
      expect(parser.getSessionId()).toBe('sess-abc');
      expect(parser.getState()).toBe('ready');
    });

    it('should parse an assistant event with text content', () => {
      const event = parser.parseLine(JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello world' },
          ],
        },
      }));
      expect(event).not.toBeNull();
      expect(event!.eventType).toBe('assistant');
      expect(event!.text).toBe('Hello world');
      expect(parser.getState()).toBe('working');
    });

    it('should detect error events', () => {
      const event = parser.parseLine(JSON.stringify({
        type: 'result',
        subtype: 'error',
      }));
      expect(event).not.toBeNull();
      expect(event!.isError).toBe(true);
    });

    it('should not mark non-error result events as errors', () => {
      const event = parser.parseLine(JSON.stringify({
        type: 'result',
        subtype: 'success',
      }));
      expect(event!.isError).toBe(false);
    });

    it('should track total events', () => {
      parser.parseLine(JSON.stringify({ type: 'system' }));
      parser.parseLine(JSON.stringify({ type: 'assistant' }));
      parser.parseLine(JSON.stringify({ type: 'result' }));
      const health = parser.getHealthSignal();
      expect(health.totalEvents).toBe(3);
    });

    it('should track error count', () => {
      parser.parseLine(JSON.stringify({ type: 'result', subtype: 'error' }));
      parser.parseLine(JSON.stringify({ type: 'result', subtype: 'error' }));
      parser.parseLine(JSON.stringify({ type: 'result', subtype: 'success' }));
      const health = parser.getHealthSignal();
      expect(health.errorCount).toBe(2);
    });

    it('should handle JSON with missing fields gracefully', () => {
      const event = parser.parseLine('{}');
      expect(event).not.toBeNull();
      expect(event!.eventType).toBe('');
      expect(event!.subtype).toBe('');
      expect(event!.text).toBe('');
    });
  });

  // ======================================================================
  // parseBatch
  // ======================================================================

  describe('parseBatch', () => {
    it('should parse multiple newline-delimited events', () => {
      const chunk = [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
        '', // trailing newline
      ].join('\n');

      const events = parser.parseBatch(chunk);
      expect(events).toHaveLength(2);
      expect(events[0].eventType).toBe('system');
      expect(events[1].eventType).toBe('assistant');
    });

    it('should buffer incomplete last line across calls', () => {
      const part1 = '{"type":"sys';
      const part2 = 'tem","subtype":"init"}\n';

      const events1 = parser.parseBatch(part1);
      expect(events1).toHaveLength(0);

      const events2 = parser.parseBatch(part2);
      expect(events2).toHaveLength(1);
      expect(events2[0].eventType).toBe('system');
    });

    it('should skip non-JSON lines in batch', () => {
      const chunk = 'plain text\n{"type":"result"}\n';
      const events = parser.parseBatch(chunk);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('result');
    });
  });

  // ======================================================================
  // getHealthSignal
  // ======================================================================

  describe('getHealthSignal', () => {
    it('should return healthy when idle with no events', () => {
      const health = parser.getHealthSignal();
      expect(health.state).toBe('idle');
      expect(health.isHealthy).toBe(true);
      expect(health.errorCount).toBe(0);
      expect(health.totalEvents).toBe(0);
      expect(health.msSinceLastEvent).toBe(0);
    });

    it('should show msSinceLastEvent after parsing', () => {
      parser.parseLine(JSON.stringify({ type: 'system' }));
      const health = parser.getHealthSignal();
      // Should be very small since we just parsed
      expect(health.msSinceLastEvent).toBeLessThan(100);
    });
  });

  // ======================================================================
  // getRecentOutput (ring buffer)
  // ======================================================================

  describe('getRecentOutput', () => {
    it('should return empty array initially', () => {
      expect(parser.getRecentOutput()).toEqual([]);
    });

    it('should store plain text output', () => {
      parser.parseLine('line 1');
      parser.parseLine('line 2');
      parser.parseLine('line 3');
      const output = parser.getRecentOutput();
      expect(output).toEqual(['line 1', 'line 2', 'line 3']);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        parser.parseLine(`line ${i}`);
      }
      const output = parser.getRecentOutput(3);
      expect(output).toHaveLength(3);
      expect(output[0]).toBe('line 7');
      expect(output[2]).toBe('line 9');
    });

    it('should store assistant text output', () => {
      parser.parseLine(JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'generated text' }] },
      }));
      const output = parser.getRecentOutput();
      expect(output).toContain('generated text');
    });
  });
});
