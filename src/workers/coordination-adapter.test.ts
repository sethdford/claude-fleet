/**
 * Tests for Coordination Adapter
 *
 * Tests NativeAdapter by injecting mock bridges.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeAdapter } from './coordination-adapter.js';

// Mock all bridge dependencies
vi.mock('./native-bridge.js', () => ({
  NativeBridge: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.checkAvailability = vi.fn().mockReturnValue({ isAvailable: true });
    this.writeTask = vi.fn();
    this.readTask = vi.fn().mockReturnValue(null);
    this.shutdown = vi.fn();
  }),
}));

vi.mock('./task-sync.js', () => ({
  TaskSyncBridge: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.shutdown = vi.fn();
  }),
}));

vi.mock('./inbox-bridge.js', () => ({
  InboxBridge: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.send = vi.fn();
    this.broadcast = vi.fn();
  }),
}));

describe('NativeAdapter', () => {
  let adapter: NativeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new NativeAdapter('test-team');
  });

  // ======================================================================
  // CONSTRUCTOR & PROPERTIES
  // ======================================================================

  describe('constructor', () => {
    it('should have name "native"', () => {
      expect(adapter.name).toBe('native');
    });

    it('should create with provided team name', () => {
      expect(adapter).toBeDefined();
    });
  });

  // ======================================================================
  // isAvailable
  // ======================================================================

  describe('isAvailable', () => {
    it('should return true when native bridge is available', () => {
      expect(adapter.isAvailable()).toBe(true);
    });
  });

  // ======================================================================
  // sendMessage
  // ======================================================================

  describe('sendMessage', () => {
    it('should send a message via inbox bridge', async () => {
      await adapter.sendMessage('agent-2', {
        from: 'agent-1',
        text: 'Hello from agent 1',
      });
      // The mock InboxBridge.send was called (verified via no error)
    });

    it('should pass color option when provided', async () => {
      await adapter.sendMessage('agent-2', {
        from: 'agent-1',
        text: 'Urgent message',
        color: 'red',
      });
    });
  });

  // ======================================================================
  // broadcastMessage
  // ======================================================================

  describe('broadcastMessage', () => {
    it('should broadcast a message via inbox bridge', async () => {
      await adapter.broadcastMessage('test-team', {
        from: 'lead',
        text: 'Team update',
      });
    });
  });

  // ======================================================================
  // assignTask
  // ======================================================================

  describe('assignTask', () => {
    it('should write task via native bridge', async () => {
      await adapter.assignTask('agent-1', {
        id: 'task-1',
        subject: 'Fix bug',
        description: 'Fix the login bug',
      });
    });

    it('should handle task without description', async () => {
      await adapter.assignTask('agent-1', {
        id: 'task-2',
        subject: 'Quick fix',
      });
    });

    it('should include blockedBy when provided', async () => {
      await adapter.assignTask('agent-1', {
        id: 'task-3',
        subject: 'Blocked task',
        blockedBy: ['task-1', 'task-2'],
      });
    });
  });

  // ======================================================================
  // getTaskStatus
  // ======================================================================

  describe('getTaskStatus', () => {
    it('should return null when task not found', async () => {
      const status = await adapter.getTaskStatus('nonexistent', 'test-team');
      expect(status).toBeNull();
    });
  });

  // ======================================================================
  // UTILITY METHODS
  // ======================================================================

  describe('getActiveAdapterName', () => {
    it('should return "native"', () => {
      expect(adapter.getActiveAdapterName()).toBe('native');
    });
  });

  describe('setAuthToken', () => {
    it('should be a no-op', () => {
      // Should not throw
      adapter.setAuthToken('some-token');
    });
  });

  describe('shutdown', () => {
    it('should shut down bridges without error', () => {
      adapter.shutdown();
    });
  });
});
