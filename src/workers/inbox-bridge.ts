/**
 * Inbox Bridge
 *
 * File-based messaging for Claude Code's native TeammateTool protocol.
 * Watches ~/.claude/teams/{name}/messages/ for new messages in real-time
 * and emits events for WebSocket broadcast.
 *
 * Architecture:
 *   - Two-tier fs.watch: watches messages/ dir for new session subdirs,
 *     and each session subdir for new message JSON files.
 *   - Debounced event emission to avoid thrashing on burst writes.
 *   - Tracks seen files to avoid re-emitting on directory re-scans.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import { createMessageBus } from './message-bus.js';
import type { MessageBus } from './message-bus.js';

// ============================================================================
// Types
// ============================================================================

/** File-based message format (matches native TeammateTool) */
export interface InboxMessage {
  from: string;
  text: string;
  timestamp: string;
  color?: string;
}

/** Event emitted when a new message is detected */
export interface MessageReceivedEvent {
  teamName: string;
  sessionId: string;
  message: InboxMessage;
  filePath: string;
}

/** Configuration for the inbox bridge */
export interface InboxBridgeConfig {
  /** Base directory for teams (default: ~/.claude/teams) */
  teamsDir?: string;
  /** Whether native inbox is enabled (default: true) */
  enabled?: boolean;
  /** Debounce interval for file watch events in ms (default: 50) */
  debounceMs?: number;
}

// ============================================================================
// InboxBridge
// ============================================================================

export class InboxBridge extends EventEmitter {
  private readonly teamsDir: string;
  private readonly enabled: boolean;
  private readonly debounceMs: number;

  /** Watchers for team-level messages/ directories */
  private teamWatchers = new Map<string, ReturnType<typeof watch>>();
  /** Watchers for individual session directories within messages/ */
  private sessionWatchers = new Map<string, ReturnType<typeof watch>>();
  /** Debounce timers for file events */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Set of already-seen file paths to avoid duplicate events */
  private seenFiles = new Set<string>();
  /** Native ring buffer for in-memory message caching */
  private bus: MessageBus;

  constructor(config: InboxBridgeConfig = {}) {
    super();
    this.teamsDir = config.teamsDir ?? join(homedir(), '.claude', 'teams');
    this.enabled = config.enabled ?? true;
    this.debounceMs = config.debounceMs ?? 50;
    this.bus = createMessageBus();
  }

  // ============================================================================
  // Live Watching
  // ============================================================================

  /**
   * Start watching a team's messages directory for new messages.
   * Uses two-tier watching:
   *   1. Watches messages/ for new session subdirectories
   *   2. Watches each session subdir for new message files
   */
  startWatching(teamName: string): void {
    if (!this.enabled) return;

    const messagesDir = join(this.teamsDir, teamName, 'messages');
    if (!existsSync(messagesDir)) {
      mkdirSync(messagesDir, { recursive: true });
    }

    // Skip if already watching this team
    if (this.teamWatchers.has(teamName)) return;

    // Tier 1: Watch messages/ dir for new session directories
    const teamWatcher = watch(messagesDir, (_eventType, filename) => {
      if (!filename) return;

      // When a new directory appears, start watching it
      const sessionDir = join(messagesDir, filename);
      if (existsSync(sessionDir)) {
        this.watchSession(teamName, filename);
      }
    });

    this.teamWatchers.set(teamName, teamWatcher);

    // Tier 2: Watch all existing session directories
    try {
      const entries = readdirSync(messagesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          this.watchSession(teamName, entry.name);
        }
      }
    } catch {
      // Directory may not be readable yet
    }

    // Scan existing files to populate seenFiles (avoids re-emitting old messages)
    this.scanExistingMessages(teamName);

    console.log(`[INBOX] Watching ${messagesDir} for messages`);
  }

  /**
   * Start watching a specific session directory for new message files.
   */
  private watchSession(teamName: string, sessionId: string): void {
    const watchKey = `${teamName}:${sessionId}`;
    if (this.sessionWatchers.has(watchKey)) return;

    const sessionDir = join(this.teamsDir, teamName, 'messages', sessionId);
    if (!existsSync(sessionDir)) return;

    const watcher = watch(sessionDir, (_eventType, filename) => {
      if (!filename?.endsWith('.json')) return;

      const filePath = join(sessionDir, filename);
      const timerKey = `msg:${teamName}:${sessionId}:${filename}`;

      // Debounce to avoid double-fires
      const existing = this.debounceTimers.get(timerKey);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(timerKey, setTimeout(() => {
        this.debounceTimers.delete(timerKey);
        this.handleNewMessage(teamName, sessionId, filePath);
      }, this.debounceMs));
    });

    this.sessionWatchers.set(watchKey, watcher);
  }

  /**
   * Handle a detected new message file.
   * Also publishes to the in-memory ring bus for fast reads.
   */
  private handleNewMessage(teamName: string, sessionId: string, filePath: string): void {
    // Avoid re-emitting already-seen files
    if (this.seenFiles.has(filePath)) return;
    if (!existsSync(filePath)) return;

    try {
      const content = readFileSync(filePath, 'utf-8');
      const message = JSON.parse(content) as InboxMessage;

      this.seenFiles.add(filePath);

      // Publish to in-memory ring bus for fast subscriber reads
      const topic = `inbox:${teamName}:${sessionId}`;
      this.bus.publish(topic, message.from, 1, content);

      const event: MessageReceivedEvent = {
        teamName,
        sessionId,
        message,
        filePath,
      };

      this.emit('message:received', event);
    } catch {
      // File may be partially written — will retry on next change event
    }
  }

  /**
   * Scan existing messages and add them to seenFiles to avoid re-emitting.
   */
  private scanExistingMessages(teamName: string): void {
    const messagesDir = join(this.teamsDir, teamName, 'messages');
    if (!existsSync(messagesDir)) return;

    try {
      const sessions = readdirSync(messagesDir, { withFileTypes: true });
      for (const session of sessions) {
        if (!session.isDirectory()) continue;
        const sessionDir = join(messagesDir, session.name);
        try {
          const files = readdirSync(sessionDir);
          for (const file of files) {
            if (file.endsWith('.json')) {
              this.seenFiles.add(join(sessionDir, file));
            }
          }
        } catch {
          // Skip unreadable directories
        }
      }
    } catch {
      // Directory may not exist
    }
  }

  /**
   * Stop all file watchers and clean up.
   */
  stopWatching(): void {
    for (const [, watcher] of this.teamWatchers) {
      watcher.close();
    }
    this.teamWatchers.clear();

    for (const [, watcher] of this.sessionWatchers) {
      watcher.close();
    }
    this.sessionWatchers.clear();

    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    console.log('[INBOX] Stopped watching');
  }

  // ============================================================================
  // Send / Broadcast
  // ============================================================================

  /**
   * Send a message to an agent's file-based inbox.
   * Also publishes to the in-memory ring bus.
   */
  send(
    teamName: string,
    sessionId: string,
    from: string,
    text: string,
    color?: string
  ): void {
    if (!this.enabled) return;

    const message: InboxMessage = {
      from,
      text,
      timestamp: new Date().toISOString(),
      color,
    };

    const inboxDir = join(this.teamsDir, teamName, 'messages', sessionId);
    if (!existsSync(inboxDir)) {
      mkdirSync(inboxDir, { recursive: true });
    }

    // Filename uses timestamp + sender for uniqueness and ordering
    const fileName = `${Date.now()}-${from.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    const filePath = join(inboxDir, fileName);
    const content = JSON.stringify(message, null, 2);
    writeFileSync(filePath, content, 'utf-8');

    // Publish to in-memory ring bus
    const topic = `inbox:${teamName}:${sessionId}`;
    this.bus.publish(topic, from, 1, content);

    // Mark as seen so our own watcher doesn't re-emit it
    this.seenFiles.add(filePath);
  }

  /**
   * Broadcast a message to all sessions in a team's inbox directory.
   */
  broadcast(teamName: string, from: string, text: string, color?: string): void {
    if (!this.enabled) return;

    const messagesDir = join(this.teamsDir, teamName, 'messages');
    if (!existsSync(messagesDir)) return;

    try {
      const sessions = readdirSync(messagesDir, { withFileTypes: true });
      for (const entry of sessions) {
        if (entry.isDirectory()) {
          this.send(teamName, entry.name, from, text, color);
        }
      }
    } catch {
      // Directory may not exist or be readable
    }
  }

  // ============================================================================
  // Polling (batch read)
  // ============================================================================

  /**
   * Poll for messages from a specific agent's inbox.
   * Returns messages sorted by timestamp (oldest first).
   */
  poll(teamName: string, sessionId: string): InboxMessage[] {
    if (!this.enabled) return [];

    const inboxDir = join(this.teamsDir, teamName, 'messages', sessionId);
    if (!existsSync(inboxDir)) return [];

    const messages: InboxMessage[] = [];

    try {
      const files = readdirSync(inboxDir).filter((f) => f.endsWith('.json')).sort();
      for (const file of files) {
        try {
          const content = readFileSync(join(inboxDir, file), 'utf-8');
          const message = JSON.parse(content) as InboxMessage;
          messages.push(message);
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Directory may not exist
    }

    return messages;
  }

  /**
   * Poll all sessions in a team for messages.
   */
  pollAll(teamName: string): InboxMessage[] {
    if (!this.enabled) return [];

    const messagesDir = join(this.teamsDir, teamName, 'messages');
    if (!existsSync(messagesDir)) return [];

    const allMessages: InboxMessage[] = [];

    try {
      const sessions = readdirSync(messagesDir, { withFileTypes: true });
      for (const entry of sessions) {
        if (entry.isDirectory()) {
          const sessionMessages = this.poll(teamName, entry.name);
          allMessages.push(...sessionMessages);
        }
      }
    } catch {
      // Directory may not exist
    }

    allMessages.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return allMessages;
  }

  /**
   * Format inbox messages for injection into a worker's prompt.
   */
  formatForInjection(teamName: string, sessionId: string): string {
    const messages = this.poll(teamName, sessionId);
    if (messages.length === 0) return '';

    const formatted = messages.map((m) =>
      `### From ${m.from}\n${m.text}`
    );

    return `## Native Inbox Messages (${messages.length})\n\n${formatted.join('\n\n---\n\n')}`;
  }

  /**
   * Ensure the team's message directory structure exists.
   */
  ensureTeamInbox(teamName: string): void {
    const messagesDir = join(this.teamsDir, teamName, 'messages');
    if (!existsSync(messagesDir)) {
      mkdirSync(messagesDir, { recursive: true });
    }
  }
}
