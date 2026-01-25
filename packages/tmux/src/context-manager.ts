/**
 * Context Manager
 *
 * Manages context for long-running Claude workers:
 * 1. Smart Trim - Intelligent context trimming when sessions get long
 * 2. Claude Continue - Context transfer to fresh sessions via summary
 *
 * Inspired by claude-code-tools/smart_trim.py and claude_continue.py
 */

import { TmuxController } from './controller.js';

export interface ContextMetrics {
  /** Total lines in session output */
  totalLines: number;
  /** Estimated token count (rough: lines * 10) */
  estimatedTokens: number;
  /** Context usage ratio (0-1, where 1 = full context) */
  usageRatio: number;
  /** Number of tool calls detected */
  toolCallCount: number;
  /** Number of errors detected */
  errorCount: number;
  /** Last activity timestamp */
  lastActivity: number;
}

export interface TrimResult {
  /** Lines before trim */
  linesBefore: number;
  /** Lines after trim */
  linesAfter: number;
  /** Key information preserved */
  preservedSections: string[];
  /** Whether trim was successful */
  success: boolean;
}

export interface ContinueSummary {
  /** Summarized context for handoff */
  summary: string;
  /** Key files that were modified */
  modifiedFiles: string[];
  /** Current task status */
  taskStatus: 'in_progress' | 'blocked' | 'completed';
  /** Pending actions to complete */
  pendingActions: string[];
  /** Errors encountered */
  errors: string[];
}

export interface SmartTrimOptions {
  /** Maximum lines to keep (default: 500) */
  maxLines?: number;
  /** Preserve recent N lines unconditionally (default: 100) */
  preserveRecent?: number;
  /** Patterns to always preserve (errors, important markers) */
  preservePatterns?: RegExp[];
}

export interface ContinueOptions {
  /** Maximum summary length in lines */
  maxSummaryLines?: number;
  /** Include file modification history */
  includeFileHistory?: boolean;
  /** Include error context */
  includeErrors?: boolean;
}

// Default patterns to preserve during trim
const DEFAULT_PRESERVE_PATTERNS = [
  /error:/i,
  /failed:/i,
  /warning:/i,
  /exception/i,
  /TODO:/i,
  /FIXME:/i,
  /IMPORTANT:/i,
  /^\s*def\s+\w+/,      // Function definitions
  /^\s*class\s+\w+/,    // Class definitions
  /^\s*export\s+/,      // Exports
  /^#+\s+/,             // Markdown headers
  /^\*\*\w+\*\*/,       // Bold markers (often important)
  /file:.+:\d+/i,       // File references
];

export class ContextManager {
  private controller: TmuxController;

  // Rough estimate: Claude context is ~200k tokens, leave buffer
  private static MAX_CONTEXT_TOKENS = 150000;
  private static TOKENS_PER_LINE = 10; // Rough estimate

  constructor(controller?: TmuxController) {
    this.controller = controller ?? new TmuxController();
  }

  /**
   * Analyze context metrics for a pane
   */
  analyzeContext(paneId: string): ContextMetrics {
    const output = this.controller.capture(paneId);
    const lines = output.split('\n');
    const totalLines = lines.length;
    const estimatedTokens = totalLines * ContextManager.TOKENS_PER_LINE;
    const usageRatio = Math.min(1, estimatedTokens / ContextManager.MAX_CONTEXT_TOKENS);

    // Count tool calls (look for common patterns)
    const toolCallCount = lines.filter(line =>
      line.includes('Tool:') ||
      line.includes('Function:') ||
      line.includes('>>> ') ||  // Python REPL
      line.includes('$ ')       // Shell commands
    ).length;

    // Count errors
    const errorCount = lines.filter(line =>
      /error:|failed:|exception|traceback/i.test(line)
    ).length;

    return {
      totalLines,
      estimatedTokens,
      usageRatio,
      toolCallCount,
      errorCount,
      lastActivity: Date.now(),
    };
  }

  /**
   * Check if context needs trimming
   */
  needsTrim(paneId: string, threshold = 0.7): boolean {
    const metrics = this.analyzeContext(paneId);
    return metrics.usageRatio >= threshold;
  }

  /**
   * Smart trim - preserve important content while reducing context
   *
   * Strategy:
   * 1. Always keep recent N lines (most relevant context)
   * 2. Scan older content for important patterns
   * 3. Keep section headers and key definitions
   * 4. Summarize/compress repetitive content
   */
  smartTrim(paneId: string, options: SmartTrimOptions = {}): TrimResult {
    const {
      maxLines = 500,
      preserveRecent = 100,
      preservePatterns = DEFAULT_PRESERVE_PATTERNS,
    } = options;

    const output = this.controller.capture(paneId);
    const lines = output.split('\n');
    const linesBefore = lines.length;

    if (linesBefore <= maxLines) {
      return {
        linesBefore,
        linesAfter: linesBefore,
        preservedSections: [],
        success: true,
      };
    }

    // Split into recent (always keep) and older (filter)
    const recentLines = lines.slice(-preserveRecent);
    const olderLines = lines.slice(0, -preserveRecent);

    // Filter older lines - keep only important ones
    const preservedSections: string[] = [];
    const keptOlderLines: string[] = [];

    for (let i = 0; i < olderLines.length; i++) {
      const line = olderLines[i] ?? '';
      const shouldKeep = preservePatterns.some(pattern => pattern.test(line));

      if (shouldKeep) {
        // Keep this line and a few lines of context
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(olderLines.length, i + 3);

        for (let j = contextStart; j < contextEnd; j++) {
          const contextLine = olderLines[j];
          if (contextLine && !keptOlderLines.includes(contextLine)) {
            keptOlderLines.push(contextLine);
          }
        }

        // Track what we preserved
        const sectionPreview = line.slice(0, 50);
        if (!preservedSections.includes(sectionPreview)) {
          preservedSections.push(sectionPreview);
        }
      }
    }

    // Limit kept older lines to fit within budget
    const olderBudget = maxLines - preserveRecent;
    const finalOlderLines = keptOlderLines.slice(-olderBudget);

    // Combine: kept older + marker + recent
    const trimmedLines = [
      ...finalOlderLines,
      '',
      '--- [Context trimmed for efficiency] ---',
      '',
      ...recentLines,
    ];

    const linesAfter = trimmedLines.length;

    // Note: We can't actually modify the pane content, but we return
    // the analysis. The caller can use this to decide on context rollover.
    return {
      linesBefore,
      linesAfter,
      preservedSections: preservedSections.slice(0, 10), // Top 10
      success: true,
    };
  }

  /**
   * Generate a continue summary for context handoff
   *
   * Creates a structured summary that can be passed to a fresh Claude session
   * to continue the work without losing critical context.
   */
  generateContinueSummary(paneId: string, options: ContinueOptions = {}): ContinueSummary {
    const includeErrors = options.includeErrors ?? true;

    const output = this.controller.capture(paneId);
    const lines = output.split('\n');

    // Extract modified files
    const modifiedFiles: string[] = [];
    const filePatterns = [
      /(?:created|modified|wrote|saved|updated).*?['"]([^'"]+)['"]/gi,
      /(?:Edit|Write|Read).*?['"]([^'"]+\.(?:ts|js|py|go|rs|rb|java|tsx|jsx))['"]/gi,
      /file:\s*([^\s]+\.\w+)/gi,
    ];

    for (const pattern of filePatterns) {
      let match;
      for (const line of lines) {
        while ((match = pattern.exec(line)) !== null) {
          const file = match[1];
          if (file && !modifiedFiles.includes(file)) {
            modifiedFiles.push(file);
          }
        }
      }
    }

    // Extract errors
    const errors: string[] = [];
    if (includeErrors) {
      for (const line of lines) {
        if (/error:|failed:|exception|traceback/i.test(line)) {
          const errorPreview = line.slice(0, 200);
          if (!errors.includes(errorPreview)) {
            errors.push(errorPreview);
          }
        }
      }
    }

    // Detect task status
    let taskStatus: 'in_progress' | 'blocked' | 'completed' = 'in_progress';
    const lastLines = lines.slice(-50).join('\n').toLowerCase();

    if (lastLines.includes('complete') || lastLines.includes('done') || lastLines.includes('finished')) {
      taskStatus = 'completed';
    } else if (lastLines.includes('blocked') || lastLines.includes('waiting') || lastLines.includes('need help')) {
      taskStatus = 'blocked';
    }

    // Extract pending actions (look for TODO, NEXT, etc.)
    const pendingActions: string[] = [];
    const actionPatterns = [
      /TODO:\s*(.+)/i,
      /NEXT:\s*(.+)/i,
      /PENDING:\s*(.+)/i,
      /need to:\s*(.+)/i,
    ];

    for (const line of lines.slice(-100)) {
      for (const pattern of actionPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const action = match[1].slice(0, 100);
          if (!pendingActions.includes(action)) {
            pendingActions.push(action);
          }
        }
      }
    }

    // Generate summary
    const summaryParts: string[] = [
      '## Context Summary for Continuation',
      '',
    ];

    if (modifiedFiles.length > 0) {
      summaryParts.push('### Files Modified');
      modifiedFiles.slice(0, 20).forEach(f => summaryParts.push(`- ${f}`));
      summaryParts.push('');
    }

    if (errors.length > 0) {
      summaryParts.push('### Errors Encountered');
      errors.slice(0, 5).forEach(e => summaryParts.push(`- ${e}`));
      summaryParts.push('');
    }

    if (pendingActions.length > 0) {
      summaryParts.push('### Pending Actions');
      pendingActions.slice(0, 10).forEach(a => summaryParts.push(`- ${a}`));
      summaryParts.push('');
    }

    summaryParts.push(`### Status: ${taskStatus}`);

    return {
      summary: summaryParts.join('\n'),
      modifiedFiles: modifiedFiles.slice(0, 20),
      taskStatus,
      pendingActions: pendingActions.slice(0, 10),
      errors: errors.slice(0, 5),
    };
  }

  /**
   * Execute context rollover to a new pane
   *
   * 1. Generate summary from current pane
   * 2. Create new pane with fresh context
   * 3. Send summary to new pane
   * 4. Return new pane ID
   */
  async rolloverToNewPane(
    sourcePaneId: string,
    options: {
      targetPaneId?: string;
      initialPrompt?: string;
    } = {}
  ): Promise<{ paneId: string; summary: ContinueSummary }> {
    // Generate summary from source
    const summary = this.generateContinueSummary(sourcePaneId);

    // Create or use target pane
    let targetPaneId = options.targetPaneId;
    if (!targetPaneId) {
      const pane = this.controller.createPane({
        direction: 'vertical',
        target: sourcePaneId,
        command: 'zsh',
      });
      if (!pane) {
        throw new Error('Failed to create rollover pane');
      }
      targetPaneId = pane.id;
    }

    // Build continuation prompt
    const continuationPrompt = [
      summary.summary,
      '',
      '---',
      '',
      options.initialPrompt ?? 'Please continue working on the task above.',
    ].join('\n');

    // Send to new pane
    await this.controller.sendKeys(targetPaneId, continuationPrompt);

    return {
      paneId: targetPaneId,
      summary,
    };
  }
}
