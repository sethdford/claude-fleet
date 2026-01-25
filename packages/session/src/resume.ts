/**
 * Session Resume Strategies
 *
 * Different strategies for resuming sessions with token optimization.
 */

import type { Session, SessionMessage } from '@claude-fleet/common';
import { SessionStore } from '@claude-fleet/storage';

export type ResumeStrategy = 'full' | 'smart-trim' | 'summary-only' | 'recent';

export interface ResumeOptions {
  strategy?: ResumeStrategy;
  maxMessages?: number;
  maxTokens?: number;
  includeSystemPrompt?: boolean;
}

export interface ResumeResult {
  session: Session;
  messages: SessionMessage[];
  strategy: ResumeStrategy;
  truncated: boolean;
  originalCount: number;
}

/**
 * Resume a session with the specified strategy
 */
export function resumeSession(
  sessionId: string,
  options: ResumeOptions = {}
): ResumeResult | undefined {
  const store = new SessionStore();
  const session = store.get(sessionId);

  if (!session) return undefined;

  const {
    strategy = 'smart-trim',
    maxMessages = 50,
    maxTokens = 100000,
    includeSystemPrompt = true,
  } = options;

  // Get all messages
  const allMessages = store.getMessages(sessionId, { limit: 1000 });
  const originalCount = allMessages.length;

  // Apply strategy
  let messages: SessionMessage[];
  let truncated = false;

  switch (strategy) {
    case 'full':
      messages = allMessages;
      break;

    case 'summary-only':
      messages = getSummaryMessages(allMessages, session, includeSystemPrompt);
      truncated = allMessages.length > messages.length;
      break;

    case 'recent':
      messages = getRecentMessages(allMessages, maxMessages, includeSystemPrompt);
      truncated = allMessages.length > messages.length;
      break;

    case 'smart-trim':
    default:
      messages = smartTrimMessages(allMessages, maxMessages, maxTokens, includeSystemPrompt);
      truncated = allMessages.length > messages.length;
      break;
  }

  // Update access time
  store.touch(sessionId);

  return {
    session,
    messages,
    strategy,
    truncated,
    originalCount,
  };
}

/**
 * Get only summary/system messages
 */
function getSummaryMessages(
  messages: SessionMessage[],
  session: Session,
  includeSystemPrompt: boolean
): SessionMessage[] {
  const result: SessionMessage[] = [];

  // Include system messages
  if (includeSystemPrompt) {
    const systemMessages = messages.filter((m) => m.role === 'system');
    result.push(...systemMessages);
  }

  // Add a summary message if available
  if (session.summary) {
    result.push({
      id: 'summary',
      role: 'system',
      content: `Previous session summary:\n${session.summary}`,
      timestamp: Date.now(),
    });
  }

  return result;
}

/**
 * Get the most recent messages
 */
function getRecentMessages(
  messages: SessionMessage[],
  maxMessages: number,
  includeSystemPrompt: boolean
): SessionMessage[] {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  // Take most recent non-system messages
  const recentNonSystem = nonSystemMessages.slice(-maxMessages);

  // Combine, keeping system messages at the start
  if (includeSystemPrompt) {
    return [...systemMessages, ...recentNonSystem];
  }

  return recentNonSystem;
}

/**
 * Smart trim: prioritize important messages while staying under limits
 */
function smartTrimMessages(
  messages: SessionMessage[],
  maxMessages: number,
  maxTokens: number,
  includeSystemPrompt: boolean
): SessionMessage[] {
  // Simple token estimation (rough approximation)
  const estimateTokens = (content: string): number => {
    return Math.ceil(content.length / 4);
  };

  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  // Calculate token budget
  let tokenBudget = maxTokens;
  if (includeSystemPrompt) {
    tokenBudget -= systemMessages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0
    );
  }

  // Score messages by importance
  const scoredMessages = nonSystemMessages.map((msg, index) => {
    let score = 0;

    // More recent messages are more important
    score += (index / nonSystemMessages.length) * 50;

    // User messages are important for context
    if (msg.role === 'user') {
      score += 20;
    }

    // Long assistant messages might contain important info
    if (msg.role === 'assistant' && msg.content.length > 500) {
      score += 10;
    }

    // Messages with code blocks are often important
    if (msg.content.includes('```')) {
      score += 15;
    }

    // Messages mentioning errors/fixes
    if (msg.content.toLowerCase().match(/error|fix|bug|issue|problem/)) {
      score += 10;
    }

    return { msg, score, tokens: estimateTokens(msg.content) };
  });

  // Sort by score (highest first)
  scoredMessages.sort((a, b) => b.score - a.score);

  // Select messages within budget
  const selected: SessionMessage[] = [];
  let usedTokens = 0;

  for (const { msg, tokens } of scoredMessages) {
    if (selected.length >= maxMessages) break;
    if (usedTokens + tokens > tokenBudget) continue;

    selected.push(msg);
    usedTokens += tokens;
  }

  // Re-sort selected by timestamp
  selected.sort((a, b) => a.timestamp - b.timestamp);

  // Add system messages at the start
  if (includeSystemPrompt) {
    return [...systemMessages, ...selected];
  }

  return selected;
}

/**
 * Generate a summary for a session
 */
export async function generateSummary(
  sessionId: string,
  summarizer?: (messages: SessionMessage[]) => Promise<string>
): Promise<string> {
  const store = new SessionStore();
  const messages = store.getMessages(sessionId, { limit: 500 });

  if (summarizer) {
    return summarizer(messages);
  }

  // Default: create a simple summary from recent messages
  const recentMessages = messages.slice(-20);
  const userMessages = recentMessages
    .filter((m) => m.role === 'user')
    .map((m) => m.content);

  const topics = extractTopics(userMessages.join(' '));

  return `Session covered: ${topics.join(', ')}. ${messages.length} total messages exchanged.`;
}

/**
 * Extract key topics from text (simple implementation)
 */
function extractTopics(text: string): string[] {
  // Simple keyword extraction
  const words = text.toLowerCase().split(/\s+/);
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'can',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'under', 'again', 'further', 'then', 'once',
    'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'what', 'which', 'who', 'whom', 'please', 'thanks',
  ]);

  const wordCounts = new Map<string, number>();

  for (const word of words) {
    const cleaned = word.replace(/[^a-z0-9]/g, '');
    if (cleaned.length < 3 || stopWords.has(cleaned)) continue;

    wordCounts.set(cleaned, (wordCounts.get(cleaned) || 0) + 1);
  }

  // Get top 5 words
  const sorted = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return sorted.map(([word]) => word);
}
