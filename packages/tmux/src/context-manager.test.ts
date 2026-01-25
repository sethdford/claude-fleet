/**
 * ContextManager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager } from './context-manager.js';

// Create mock capture function that can be configured per test
let mockCaptureOutput = '';

// Mock TmuxController
vi.mock('./controller.js', () => {
  return {
    TmuxController: class MockTmuxController {
      capture = vi.fn(() => mockCaptureOutput);
      createPane = vi.fn().mockReturnValue({ id: '%1' });
      sendKeys = vi.fn().mockResolvedValue(undefined);
    },
  };
});

describe('ContextManager', () => {
  let manager: ContextManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureOutput = '';
    manager = new ContextManager();
  });

  describe('analyzeContext', () => {
    it('analyzes empty pane', () => {
      mockCaptureOutput = '';
      const metrics = manager.analyzeContext('%0');
      expect(metrics.totalLines).toBe(1); // Empty string splits to ['']
      expect(metrics.usageRatio).toBeLessThan(0.1);
      expect(metrics.toolCallCount).toBe(0);
      expect(metrics.errorCount).toBe(0);
    });

    it('detects tool calls', () => {
      mockCaptureOutput = 'Line 1\n$ npm test\nTool: Read\n>>> print("hello")\nLine 5';
      manager = new ContextManager();
      const metrics = manager.analyzeContext('%0');
      expect(metrics.toolCallCount).toBe(3); // $, Tool:, >>>
    });

    it('detects errors', () => {
      mockCaptureOutput = 'Starting...\nError: Something failed\nTraceback:\nException raised\nDone';
      manager = new ContextManager();
      const metrics = manager.analyzeContext('%0');
      expect(metrics.errorCount).toBe(3); // Error:, Traceback, Exception
    });

    it('calculates context usage ratio', () => {
      // 15000 lines * 10 tokens/line = 150000 tokens = 100% usage
      mockCaptureOutput = Array(15000).fill('test line').join('\n');
      manager = new ContextManager();
      const metrics = manager.analyzeContext('%0');
      expect(metrics.usageRatio).toBe(1);
    });
  });

  describe('needsTrim', () => {
    it('returns false for low context usage', () => {
      mockCaptureOutput = 'Short output';
      manager = new ContextManager();
      expect(manager.needsTrim('%0')).toBe(false);
    });

    it('returns true for high context usage', () => {
      mockCaptureOutput = Array(12000).fill('test line').join('\n');
      manager = new ContextManager();
      expect(manager.needsTrim('%0', 0.7)).toBe(true);
    });
  });

  describe('smartTrim', () => {
    it('returns unchanged for small output', () => {
      mockCaptureOutput = 'Line 1\nLine 2\nLine 3';
      manager = new ContextManager();
      const result = manager.smartTrim('%0', { maxLines: 500 });
      expect(result.linesBefore).toBe(3);
      expect(result.linesAfter).toBe(3);
      expect(result.success).toBe(true);
    });

    it('preserves error lines', () => {
      mockCaptureOutput = [
        ...Array(400).fill('normal line'),
        'Error: Important error message',
        ...Array(200).fill('more lines'),
      ].join('\n');
      manager = new ContextManager();
      const result = manager.smartTrim('%0', { maxLines: 300, preserveRecent: 100 });
      expect(result.preservedSections.some(s => s.includes('Error:'))).toBe(true);
    });
  });

  describe('generateContinueSummary', () => {
    it('generates summary with modified files', () => {
      mockCaptureOutput = 'Working on task\nEdit file: "src/index.ts"\nWrite: "test.js"\nCompleted';
      manager = new ContextManager();
      const summary = manager.generateContinueSummary('%0');
      expect(summary.modifiedFiles).toContain('src/index.ts');
      expect(summary.taskStatus).toBe('completed');
    });

    it('extracts errors', () => {
      mockCaptureOutput = 'Running tests\nError: Test failed\nException in module\nBlocked on issue';
      manager = new ContextManager();
      const summary = manager.generateContinueSummary('%0');
      expect(summary.errors.length).toBeGreaterThan(0);
      expect(summary.taskStatus).toBe('blocked');
    });

    it('extracts pending actions', () => {
      mockCaptureOutput = 'Working...\nTODO: Fix the bug\nNEXT: Run tests\nIn progress';
      manager = new ContextManager();
      const summary = manager.generateContinueSummary('%0');
      expect(summary.pendingActions).toContain('Fix the bug');
      expect(summary.taskStatus).toBe('in_progress');
    });
  });

  describe('rolloverToNewPane', () => {
    it('creates new pane and sends summary', async () => {
      mockCaptureOutput = 'Task output\nDone';
      manager = new ContextManager();
      const result = await manager.rolloverToNewPane('%0');

      expect(result.paneId).toBe('%1');
      expect(result.summary).toBeDefined();
    });
  });
});
