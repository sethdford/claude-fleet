/**
 * Tests for Inbox Bridge
 *
 * Mocks node:fs and node:os to test file-based messaging
 * without touching the actual filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  watch: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

// Mock os module
vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/mock-home'),
}));

// Mock message-bus module
vi.mock('./message-bus.js', () => ({
  createMessageBus: vi.fn().mockReturnValue({
    publish: vi.fn().mockReturnValue('msg_1'),
    subscribe: vi.fn(),
    read: vi.fn().mockReturnValue([]),
    stats: vi.fn().mockReturnValue({ totalMessages: 0, topicCount: 0, subscriberCount: 0, messagesPerTopic: [] }),
  }),
}));

import { InboxBridge } from './inbox-bridge.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, watch } from 'node:fs';

describe('InboxBridge', () => {
  let bridge: InboxBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
    bridge = new InboxBridge({ teamsDir: '/mock-home/.claude/teams' });
  });

  afterEach(() => {
    bridge.stopWatching();
  });

  // ======================================================================
  // CONSTRUCTOR
  // ======================================================================

  describe('constructor', () => {
    it('should create with default config', () => {
      expect(bridge).toBeDefined();
    });

    it('should create with custom config', () => {
      const custom = new InboxBridge({
        teamsDir: '/custom/teams',
        enabled: false,
        debounceMs: 200,
      });
      expect(custom).toBeDefined();
    });
  });

  // ======================================================================
  // startWatching
  // ======================================================================

  describe('startWatching', () => {
    it('should start watching a team messages directory', () => {
      bridge.startWatching('test-team');
      expect(watch).toHaveBeenCalled();
    });

    it('should create messages dir if not exists', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      bridge.startWatching('test-team');
      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-team/messages'),
        { recursive: true },
      );
    });

    it('should not watch same team twice', () => {
      bridge.startWatching('test-team');
      const callCount = (watch as ReturnType<typeof vi.fn>).mock.calls.length;
      bridge.startWatching('test-team');
      expect((watch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    });

    it('should watch existing session directories', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'session-1', isDirectory: () => true },
        { name: 'session-2', isDirectory: () => true },
      ]);
      bridge.startWatching('test-team');
      // Watch was called for team dir + each session
      expect((watch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('should do nothing when disabled', () => {
      const disabled = new InboxBridge({ enabled: false });
      disabled.startWatching('test-team');
      expect(watch).not.toHaveBeenCalled();
    });
  });

  // ======================================================================
  // stopWatching
  // ======================================================================

  describe('stopWatching', () => {
    it('should close all watchers', () => {
      const mockClose = vi.fn();
      (watch as ReturnType<typeof vi.fn>).mockReturnValue({ close: mockClose });

      bridge.startWatching('test-team');
      bridge.stopWatching();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ======================================================================
  // send
  // ======================================================================

  describe('send', () => {
    it('should write message to file', () => {
      bridge.send('test-team', 'session-1', 'agent-1', 'Hello world');

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('session-1'),
        expect.stringContaining('Hello world'),
        'utf-8',
      );
    });

    it('should include color when provided', () => {
      bridge.send('test-team', 'session-1', 'agent-1', 'Alert', 'red');

      const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.color).toBe('red');
    });

    it('should create inbox directory if not exists', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      bridge.send('test-team', 'session-1', 'agent-1', 'Hello');

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('session-1'),
        { recursive: true },
      );
    });

    it('should do nothing when disabled', () => {
      const disabled = new InboxBridge({ enabled: false });
      disabled.send('test-team', 'session-1', 'agent-1', 'Hello');
      expect(writeFileSync).not.toHaveBeenCalled();
    });
  });

  // ======================================================================
  // broadcast
  // ======================================================================

  describe('broadcast', () => {
    it('should send to all session directories', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'session-1', isDirectory: () => true },
        { name: 'session-2', isDirectory: () => true },
      ]);

      bridge.broadcast('test-team', 'lead', 'Team update');
      expect(writeFileSync).toHaveBeenCalledTimes(2);
    });

    it('should do nothing when disabled', () => {
      const disabled = new InboxBridge({ enabled: false });
      disabled.broadcast('test-team', 'lead', 'Hello');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle non-existent messages dir', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      bridge.broadcast('test-team', 'lead', 'Hello');
      // Should not throw
    });
  });

  // ======================================================================
  // poll
  // ======================================================================

  describe('poll', () => {
    it('should return messages from session inbox', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(['msg1.json', 'msg2.json']);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        from: 'agent-1',
        text: 'Hello',
        timestamp: new Date().toISOString(),
      }));

      const messages = bridge.poll('test-team', 'session-1');
      expect(messages).toHaveLength(2);
      expect(messages[0].from).toBe('agent-1');
    });

    it('should return empty array when disabled', () => {
      const disabled = new InboxBridge({ enabled: false });
      const messages = disabled.poll('test-team', 'session-1');
      expect(messages).toEqual([]);
    });

    it('should return empty array when inbox dir not exists', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const messages = bridge.poll('test-team', 'session-1');
      expect(messages).toEqual([]);
    });

    it('should skip malformed files', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(['good.json', 'bad.json']);
      (readFileSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(JSON.stringify({ from: 'a', text: 'ok', timestamp: '2024-01-01' }))
        .mockReturnValueOnce('not json');

      const messages = bridge.poll('test-team', 'session-1');
      expect(messages).toHaveLength(1);
    });
  });

  // ======================================================================
  // pollAll
  // ======================================================================

  describe('pollAll', () => {
    it('should aggregate messages from all sessions sorted by timestamp', () => {
      (readdirSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([
          { name: 'session-1', isDirectory: () => true },
          { name: 'session-2', isDirectory: () => true },
        ])
        .mockReturnValueOnce(['msg1.json'])
        .mockReturnValueOnce(['msg2.json']);

      (readFileSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(JSON.stringify({ from: 'a', text: '2nd', timestamp: '2024-01-02' }))
        .mockReturnValueOnce(JSON.stringify({ from: 'b', text: '1st', timestamp: '2024-01-01' }));

      const messages = bridge.pollAll('test-team');
      expect(messages).toHaveLength(2);
      expect(messages[0].text).toBe('1st');
      expect(messages[1].text).toBe('2nd');
    });

    it('should return empty when disabled', () => {
      const disabled = new InboxBridge({ enabled: false });
      expect(disabled.pollAll('test-team')).toEqual([]);
    });
  });

  // ======================================================================
  // formatForInjection
  // ======================================================================

  describe('formatForInjection', () => {
    it('should format messages as markdown', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(['msg1.json']);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        from: 'scout-1',
        text: 'Found the bug',
        timestamp: '2024-01-01',
      }));

      const result = bridge.formatForInjection('test-team', 'session-1');
      expect(result).toContain('## Native Inbox Messages (1)');
      expect(result).toContain('### From scout-1');
      expect(result).toContain('Found the bug');
    });

    it('should return empty string when no messages', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const result = bridge.formatForInjection('test-team', 'session-1');
      expect(result).toBe('');
    });
  });

  // ======================================================================
  // ensureTeamInbox
  // ======================================================================

  describe('ensureTeamInbox', () => {
    it('should create messages directory when missing', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      bridge.ensureTeamInbox('test-team');
      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-team/messages'),
        { recursive: true },
      );
    });

    it('should not create when already exists', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      bridge.ensureTeamInbox('test-team');
      expect(mkdirSync).not.toHaveBeenCalled();
    });
  });
});
