/**
 * @cct/lmsh - TypeScript type definitions
 */

/**
 * A translation result containing the command and confidence
 */
export interface TranslationResult {
  /** The translated shell command */
  command: string;
  /** Confidence score (0.0 to 1.0) */
  confidence: number;
  /** Alternative commands if available */
  alternatives: string[];
  /** Explanation of what the command does */
  explanation: string;
}

/**
 * Natural language to shell translator
 */
export declare class LmshTranslator {
  /**
   * Create a new translator instance
   */
  constructor();

  /**
   * Translate natural language to a shell command
   */
  translate(input: string): TranslationResult;

  /**
   * Translate using aliases first, then patterns
   */
  translateWithAliases(input: string): TranslationResult;

  /**
   * Add a custom alias
   */
  addAlias(alias: string, command: string): void;

  /**
   * Get all aliases
   */
  getAliases(): Record<string, string>;
}

/**
 * Create a new translator instance
 */
export declare function createTranslator(): LmshTranslator;
