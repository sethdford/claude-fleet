/**
 * Tests for Native Bridge
 *
 * Mocks child_process, node:fs, and node:os to test native
 * file-based operations without touching the filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn().mockReturnValue({ error: null, status: 0 }),
}));

// Mock fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  watch: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/mock-home'),
}));

import { NativeBridge } from './native-bridge.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';

describe('NativeBridge', () => {
  let bridge: NativeBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ error: null, status: 0 });
    bridge = new NativeBridge({
      teamsDir: '/mock-home/.claude/teams',
      tasksDir: '/mock-home/.claude/tasks',
      claudeBinary: 'claude',
    });
  });

  afterEach(() => {
    bridge.shutdown();
  });

  // ======================================================================
  // CONSTRUCTOR
  // ======================================================================

  describe('constructor', () => {
    it('should create with default config', () => {
      const b = new NativeBridge();
      expect(b).toBeDefined();
      b.shutdown();
    });

    it('should create with custom config', () => {
      expect(bridge).toBeDefined();
    });
  });

  // ======================================================================
  // checkAvailability
  // ======================================================================

  describe('checkAvailability', () => {
    it('should return available when binary found', () => {
      const result = bridge.checkAvailability();
      expect(result.isAvailable).toBe(true);
      expect(result.claudeBinary).toBe('claude');
    });

    it('should return unavailable when no binary found', () => {
      (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ error: new Error('ENOENT') });
      const b = new NativeBridge({ claudeBinary: undefined });
      const result = b.checkAvailability();
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toContain('No Claude Code binary');
      b.shutdown();
    });

    it('should try multiple binary candidates', () => {
      // First two candidates fail, third succeeds
      (spawnSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ error: new Error('ENOENT') })
        .mockReturnValueOnce({ error: new Error('ENOENT') })
        .mockReturnValueOnce({ error: null, status: 0 });

      const b = new NativeBridge({ claudeBinary: undefined });
      const result = b.checkAvailability();
      expect(result.isAvailable).toBe(true);
      b.shutdown();
    });
  });

  // ======================================================================
  // assertAvailable
  // ======================================================================

  describe('assertAvailable', () => {
    it('should throw when not available', () => {
      const b = new NativeBridge();
      expect(() => b.assertAvailable()).toThrow('Native features not available');
      b.shutdown();
    });

    it('should not throw after successful availability check', () => {
      bridge.checkAvailability();
      expect(() => bridge.assertAvailable()).not.toThrow();
    });
  });

  // ======================================================================
  // buildNativeEnv
  // ======================================================================

  describe('buildNativeEnv', () => {
    it('should return environment variables', () => {
      const env = bridge.buildNativeEnv('worker-1', 'team-a', 'worker');
      expect(env.CLAUDE_CODE_TEAM_NAME).toBe('team-a');
      expect(env.CLAUDE_CODE_AGENT_ID).toBe('team-a-worker-1');
      expect(env.CLAUDE_CODE_AGENT_TYPE).toBe('worker');
      expect(env.CLAUDE_CODE_AGENT_NAME).toBe('worker-1');
      expect(env.CLAUDE_CODE_TEAM_MODE).toBe('true');
      expect(env.CLAUDE_CODE_AGENT_COLOR).toBeDefined();
    });
  });

  // ======================================================================
  // getClaudeBinary
  // ======================================================================

  describe('getClaudeBinary', () => {
    it('should return binary after availability check', () => {
      bridge.checkAvailability();
      expect(bridge.getClaudeBinary()).toBe('claude');
    });

    it('should throw when not available', () => {
      expect(() => bridge.getClaudeBinary()).toThrow();
    });
  });

  // ======================================================================
  // writeTask / readTask / listTasks
  // ======================================================================

  describe('task operations', () => {
    const sampleTask = {
      id: 'task-1',
      subject: 'Fix bug',
      description: 'Fix the login bug',
      status: 'pending' as const,
      owner: 'worker-1',
      blockedBy: [],
      blocks: [],
      activeForm: null,
      metadata: {},
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('should write task to file', () => {
      bridge.writeTask('team-a', sampleTask);
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('task-1.json'),
        expect.stringContaining('Fix bug'),
        'utf-8',
      );
    });

    it('should create team dir when writing if missing', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      bridge.writeTask('team-a', sampleTask);
      expect(mkdirSync).toHaveBeenCalled();
    });

    it('should read task from file', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(sampleTask));
      const task = bridge.readTask('team-a', 'task-1');
      expect(task).not.toBeNull();
      expect(task!.subject).toBe('Fix bug');
    });

    it('should return null when task file not found', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const task = bridge.readTask('team-a', 'nonexistent');
      expect(task).toBeNull();
    });

    it('should return null on malformed JSON', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('not json');
      const task = bridge.readTask('team-a', 'task-1');
      expect(task).toBeNull();
    });

    it('should normalize missing fields when reading', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        id: 'task-1',
        subject: 'Old task',
        status: 'pending',
      }));

      const task = bridge.readTask('team-a', 'task-1');
      expect(task!.blocks).toEqual([]);
      expect(task!.activeForm).toBeNull();
      expect(task!.metadata).toEqual({});
    });

    it('should list all tasks for a team', async () => {
      (readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['task-1.json', 'task-2.json', 'readme.txt']);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(sampleTask));

      const tasks = await bridge.listTasks('team-a');
      expect(tasks).toHaveLength(2); // readme.txt skipped
    });

    it('should return empty array when team dir not exists', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const tasks = await bridge.listTasks('team-a');
      expect(tasks).toEqual([]);
    });
  });

  // ======================================================================
  // writeMessage / readMessages
  // ======================================================================

  describe('message operations', () => {
    it('should write message to file', () => {
      bridge.writeMessage('team-a', 'session-1', {
        from: 'agent-1',
        text: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
      });
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('agent-1.json'),
        expect.stringContaining('Hello'),
        'utf-8',
      );
    });

    it('should read messages from inbox sorted by timestamp', async () => {
      (readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['msg1.json', 'msg2.json']);
      (readFileSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(JSON.stringify({ from: 'a', text: '2nd', timestamp: '2024-01-02' }))
        .mockReturnValueOnce(JSON.stringify({ from: 'b', text: '1st', timestamp: '2024-01-01' }));

      const messages = await bridge.readMessages('team-a', 'session-1');
      expect(messages).toHaveLength(2);
      expect(messages[0].text).toBe('1st');
    });

    it('should return empty array when inbox dir not exists', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const messages = await bridge.readMessages('team-a', 'session-1');
      expect(messages).toEqual([]);
    });
  });

  // ======================================================================
  // shouldFallback / getters
  // ======================================================================

  describe('utility methods', () => {
    it('should return shouldFallback true when not available', () => {
      const b = new NativeBridge({ fallbackToProcess: true });
      expect(b.shouldFallback()).toBe(true);
      b.shutdown();
    });

    it('should return shouldFallback false when available', () => {
      bridge.checkAvailability();
      expect(bridge.shouldFallback()).toBe(false);
    });

    it('should return shouldFallback false when fallback disabled', () => {
      const b = new NativeBridge({ fallbackToProcess: false });
      expect(b.shouldFallback()).toBe(false);
      b.shutdown();
    });

    it('should return teamsDir and tasksDir', () => {
      expect(bridge.getTeamsDir()).toBe('/mock-home/.claude/teams');
      expect(bridge.getTasksDir()).toBe('/mock-home/.claude/tasks');
    });
  });

  // ======================================================================
  // Agent Discovery
  // ======================================================================

  describe('agent discovery', () => {
    it('should start watching team directory', () => {
      bridge.checkAvailability();
      bridge.startDiscovery('team-a');
      expect(watch).toHaveBeenCalled();
    });

    it('should scan existing agents', () => {
      (readdirSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([
          { name: 'agent-1', isDirectory: () => true },
          { name: 'messages', isDirectory: () => true },
        ])
        .mockReturnValueOnce([
          { name: 'session-1', isDirectory: () => true },
        ]);

      bridge.startDiscovery('team-a');

      const agents = bridge.getKnownAgents('team-a');
      expect(agents).toContain('agent-1');
      expect(agents).toContain('session-1');
    });

    it('should not start watching same team twice', () => {
      bridge.startDiscovery('team-a');
      const callCount = (watch as ReturnType<typeof vi.fn>).mock.calls.length;
      bridge.startDiscovery('team-a');
      expect((watch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    });

    it('should stop discovery', () => {
      const mockClose = vi.fn();
      (watch as ReturnType<typeof vi.fn>).mockReturnValue({ close: mockClose });

      bridge.startDiscovery('team-a');
      bridge.stopDiscovery();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should return empty known agents for unknown team', () => {
      expect(bridge.getKnownAgents('unknown')).toEqual([]);
    });
  });

  // ======================================================================
  // prepareForSpawn
  // ======================================================================

  describe('prepareForSpawn', () => {
    it('should create task and team directories', () => {
      bridge.checkAvailability();
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      bridge.prepareForSpawn('team-a');
      expect(mkdirSync).toHaveBeenCalledTimes(2);
    });

    it('should throw when not available', () => {
      expect(() => bridge.prepareForSpawn('team-a')).toThrow();
    });
  });

  // ======================================================================
  // shutdown
  // ======================================================================

  describe('shutdown', () => {
    it('should clean up all resources', () => {
      const mockClose = vi.fn();
      (watch as ReturnType<typeof vi.fn>).mockReturnValue({ close: mockClose });

      bridge.startDiscovery('team-a');
      bridge.shutdown();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
