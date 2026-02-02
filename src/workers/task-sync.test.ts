/**
 * Tests for Task Sync Bridge
 *
 * Mocks node:fs, node:fs/promises, and node:os to test
 * bidirectional sync without touching the filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  watch: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/mock-home'),
}));

import { TaskSyncBridge } from './task-sync.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';

// Mock storage
function createMockStorage() {
  return {
    getTask: vi.fn().mockReturnValue(null),
    insertTask: vi.fn(),
    updateTaskAssignment: vi.fn(),
  };
}

describe('TaskSyncBridge', () => {
  let bridge: TaskSyncBridge;
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockStorage = createMockStorage();
    bridge = new TaskSyncBridge(mockStorage as never, {
      tasksDir: '/mock-home/.claude/tasks',
      debounceMs: 10,
    });
  });

  afterEach(() => {
    bridge.shutdown();
  });

  // ======================================================================
  // CONSTRUCTOR
  // ======================================================================

  describe('constructor', () => {
    it('should create with null storage', () => {
      const b = new TaskSyncBridge(null);
      expect(b).toBeDefined();
      b.shutdown();
    });

    it('should create with custom config', () => {
      const b = new TaskSyncBridge(null, {
        tasksDir: '/custom/tasks',
        debounceMs: 500,
        enabled: false,
      });
      expect(b).toBeDefined();
      b.shutdown();
    });
  });

  // ======================================================================
  // start / watchTeam
  // ======================================================================

  describe('start', () => {
    it('should start watching team directories', () => {
      bridge.start(['team-a', 'team-b']);
      expect(watch).toHaveBeenCalledTimes(2);
    });

    it('should create tasks dir if missing', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      bridge.start(['team-a']);
      expect(mkdirSync).toHaveBeenCalled();
    });

    it('should do nothing when disabled', () => {
      const disabled = new TaskSyncBridge(null, { enabled: false });
      disabled.start(['team-a']);
      expect(watch).not.toHaveBeenCalled();
      disabled.shutdown();
    });

    it('should not watch same team twice', () => {
      bridge.watchTeam('team-a');
      const callCount = (watch as ReturnType<typeof vi.fn>).mock.calls.length;
      bridge.watchTeam('team-a');
      expect((watch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    });
  });

  // ======================================================================
  // shutdown
  // ======================================================================

  describe('shutdown', () => {
    it('should close all watchers', () => {
      const mockClose = vi.fn();
      (watch as ReturnType<typeof vi.fn>).mockReturnValue({ close: mockClose });

      bridge.start(['team-a']);
      bridge.shutdown();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ======================================================================
  // syncFleetToNative
  // ======================================================================

  describe('syncFleetToNative', () => {
    it('should write task file from fleet data', () => {
      mockStorage.getTask.mockReturnValue({
        id: 'task-1',
        subject: 'Fix bug',
        description: 'Fix the login bug',
        status: 'in_progress',
        ownerHandle: 'worker-1',
        blockedBy: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      bridge.syncFleetToNative('team-a', 'task-1');

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('task-1.json'),
        expect.stringContaining('Fix bug'),
        'utf-8',
      );
    });

    it('should emit sync:fleet-to-native event', () => {
      mockStorage.getTask.mockReturnValue({
        id: 'task-1',
        subject: 'Task',
        status: 'open',
        createdAt: '2024-01-01T00:00:00Z',
      });

      const listener = vi.fn();
      bridge.on('sync:fleet-to-native', listener);

      bridge.syncFleetToNative('team-a', 'task-1');
      expect(listener).toHaveBeenCalledWith({ taskId: 'task-1', teamName: 'team-a' });
    });

    it('should skip when task not found', () => {
      mockStorage.getTask.mockReturnValue(null);
      bridge.syncFleetToNative('team-a', 'nonexistent');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('should skip when disabled', () => {
      const disabled = new TaskSyncBridge(mockStorage as never, { enabled: false });
      disabled.syncFleetToNative('team-a', 'task-1');
      expect(writeFileSync).not.toHaveBeenCalled();
      disabled.shutdown();
    });

    it('should skip when storage is null', () => {
      const noStorage = new TaskSyncBridge(null);
      noStorage.syncFleetToNative('team-a', 'task-1');
      expect(writeFileSync).not.toHaveBeenCalled();
      noStorage.shutdown();
    });

    it('should map fleet status to native status', () => {
      mockStorage.getTask.mockReturnValue({
        id: 'task-1',
        subject: 'Resolved task',
        status: 'resolved',
        createdAt: '2024-01-01T00:00:00Z',
      });

      bridge.syncFleetToNative('team-a', 'task-1');

      const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.status).toBe('completed');
    });

    it('should emit sync:error on failure', () => {
      mockStorage.getTask.mockImplementation(() => {
        throw new Error('DB error');
      });

      const listener = vi.fn();
      bridge.on('sync:error', listener);

      bridge.syncFleetToNative('team-a', 'task-1');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-1',
        error: 'DB error',
      }));
    });
  });

  // ======================================================================
  // fullSync
  // ======================================================================

  describe('fullSync', () => {
    it('should return { synced: 0, errors: 0 } when dir not exists', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const result = await bridge.fullSync('team-a');
      expect(result).toEqual({ synced: 0, errors: 0 });
    });

    it('should sync all JSON files in team directory', async () => {
      (readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['task-1.json', 'task-2.json', 'readme.txt']);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        id: 'task-1',
        subject: 'Task',
        status: 'pending',
        updatedAt: '2099-01-01T00:00:00Z',
      }));

      const result = await bridge.fullSync('team-a');
      // Two JSON files attempted (readme.txt skipped)
      expect(result.synced + result.errors).toBe(2);
    });
  });
});
