/**
 * LMSH Route Handlers (Natural Language → Shell)
 *
 * Exposes natural language to shell command translation via the
 * Rust NAPI module or a pure-JS regex fallback.
 */

import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';

// --- Shared Types ---

interface TranslationResult {
  command: string;
  confidence: number;
  alternatives: string[];
  explanation: string;
}

interface Translator {
  translate(input: string): TranslationResult;
  addAlias(alias: string, command: string): void;
  getAliases(): Record<string, string>;
}

// --- JS Fallback ---

interface FallbackPattern {
  triggers: string[];
  command: string;
  explanation: string;
  confidence: number;
}

class JSTranslator implements Translator {
  private patterns: FallbackPattern[];
  private aliases = new Map<string, string>();

  constructor() {
    this.patterns = [
      { triggers: ['list files', 'show files', 'ls', 'dir'], command: 'ls -la', explanation: 'List files with details', confidence: 0.95 },
      { triggers: ['go home', 'home directory'], command: 'cd ~', explanation: 'Go to home directory', confidence: 0.95 },
      { triggers: ['go back', 'go up', 'parent'], command: 'cd ..', explanation: 'Go to parent directory', confidence: 0.95 },
      { triggers: ['current directory', 'where am i', 'pwd'], command: 'pwd', explanation: 'Print current directory', confidence: 0.95 },
      { triggers: ['git status', 'check git', 'what changed'], command: 'git status', explanation: 'Show repository status', confidence: 0.95 },
      { triggers: ['git log', 'commit history', 'show commits'], command: 'git log --oneline -20', explanation: 'Show recent commits', confidence: 0.9 },
      { triggers: ['git diff', 'show changes'], command: 'git diff', explanation: 'Show uncommitted changes', confidence: 0.9 },
      { triggers: ['git push', 'push changes'], command: 'git push', explanation: 'Push to remote', confidence: 0.9 },
      { triggers: ['git pull', 'pull changes', 'get latest'], command: 'git pull', explanation: 'Pull from remote', confidence: 0.9 },
      { triggers: ['git branch', 'list branches'], command: 'git branch -a', explanation: 'List all branches', confidence: 0.9 },
      { triggers: ['disk space', 'disk usage', 'df'], command: 'df -h', explanation: 'Show disk usage', confidence: 0.95 },
      { triggers: ['running processes', 'show processes', 'ps'], command: 'ps aux', explanation: 'List all processes', confidence: 0.9 },
      { triggers: ['system info', 'uname'], command: 'uname -a', explanation: 'Show system info', confidence: 0.9 },
      { triggers: ['clear screen', 'clear', 'cls'], command: 'clear', explanation: 'Clear terminal', confidence: 0.95 },
      { triggers: ['search in files', 'grep', 'find text'], command: 'grep -r "{query}" .', explanation: 'Search text in files', confidence: 0.85 },
      { triggers: ['find file', 'search for file'], command: 'find . -name "{query}"', explanation: 'Find files by name', confidence: 0.85 },
    ];
  }

  translate(input: string): TranslationResult {
    const lower = input.toLowerCase();

    // Check aliases first
    for (const [alias, command] of this.aliases) {
      if (lower.includes(alias)) {
        return { command, confidence: 1.0, alternatives: [], explanation: `Custom alias: ${alias}` };
      }
    }

    // Pattern match
    let bestMatch: { pattern: FallbackPattern; score: number } | null = null;
    const alternatives: string[] = [];

    for (const pattern of this.patterns) {
      for (const trigger of pattern.triggers) {
        if (lower.includes(trigger)) {
          const coverage = trigger.length / lower.length;
          const score = pattern.confidence + coverage * 0.2;

          if (!bestMatch || score > bestMatch.score) {
            if (bestMatch) alternatives.push(bestMatch.pattern.command);
            bestMatch = { pattern, score };
          } else {
            alternatives.push(pattern.command);
          }
          break;
        }
      }
    }

    if (bestMatch) {
      return {
        command: bestMatch.pattern.command,
        confidence: Math.min(bestMatch.score, 1.0),
        alternatives: alternatives.slice(0, 3),
        explanation: bestMatch.pattern.explanation,
      };
    }

    return { command: '', confidence: 0, alternatives: [], explanation: 'No matching pattern found' };
  }

  addAlias(alias: string, command: string): void {
    this.aliases.set(alias.toLowerCase(), command);
  }

  getAliases(): Record<string, string> {
    return Object.fromEntries(this.aliases);
  }
}

// --- Engine Initialization ---

function createTranslator(): Translator {
  try {
    const esmRequire = createRequire(import.meta.url);
    const native = esmRequire('@claude-fleet/lmsh');
    const inst = new native.LmshTranslator();
    console.log('[lmsh] Using native Rust translator');

    return {
      translate(input: string): TranslationResult {
        const r = inst.translateWithAliases(input);
        return {
          command: r.command,
          confidence: r.confidence,
          alternatives: r.alternatives,
          explanation: r.explanation,
        };
      },
      addAlias(alias: string, command: string): void {
        inst.addAlias(alias, command);
      },
      getAliases(): Record<string, string> {
        return inst.getAliases();
      },
    };
  } catch {
    console.log('[lmsh] Rust translator not available, using JS fallback');
    return new JSTranslator();
  }
}

const translator = createTranslator();

// --- Route Handlers ---

/**
 * POST /lmsh/translate
 *
 * Translate natural language to a shell command.
 * Body: { input: string }
 */
export function createLmshTranslateHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { input } = req.body as { input?: string };

    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: 'Missing required field: input' });
      return;
    }

    const result = translator.translate(input);
    res.json(result);
  });
}

/**
 * GET /lmsh/aliases
 *
 * Get all registered aliases.
 */
export function createLmshGetAliasesHandler(_deps: RouteDependencies) {
  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const aliases = translator.getAliases();
    res.json({ aliases });
  });
}

/**
 * POST /lmsh/aliases
 *
 * Register a custom alias.
 * Body: { alias: string, command: string }
 */
export function createLmshAddAliasHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { alias, command } = req.body as { alias?: string; command?: string };

    if (!alias || !command) {
      res.status(400).json({ error: 'Missing required fields: alias, command' });
      return;
    }

    translator.addAlias(alias, command);
    res.json({ added: true, alias, command });
  });
}
