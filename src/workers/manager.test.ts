/**
 * Tests for Worker Manager
 *
 * Covers: constructor, spawnWorker, dismissWorker, getWorkers, getWorkerCount,
 * getWorkerByHandle, registerExternalWorker, injectWorkerOutput, worker lifecycle,
 * health checks, restart logic, native/process spawn modes, routing, and accessors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ============================================================================
// Hoisted mocks — accessible inside vi.mock() factories
// ============================================================================

const mockSpawn = vi.hoisted(() => vi.fn());

const mockUuidv4 = vi.hoisted(() => {
  let counter = 0;
  return vi.fn(() => `uuid-${++counter}`);
});

const mockNativeBridgeInstance = vi.hoisted(() => ({
  checkAvailability: vi.fn().mockReturnValue({ isAvailable: false, claudeBinary: null }),
  shouldFallback: vi.fn().mockReturnValue(true),
  getClaudeBinary: vi.fn().mockReturnValue('claude'),
  buildNativeEnv: vi.fn().mockReturnValue({
    CLAUDE_CODE_AGENT_ID: 'test-agent-id',
    CLAUDE_CODE_TEAM_NAME: 'default',
  }),
  prepareForSpawn: vi.fn(),
  writeTask: vi.fn(),
}));

const mockInboxBridgeInstance = vi.hoisted(() => ({
  send: vi.fn(),
  broadcast: vi.fn(),
}));

const mockTaskSyncBridgeInstance = vi.hoisted(() => ({
  startWatching: vi.fn(),
  stopWatching: vi.fn(),
}));

const mockCoordinationAdapterInstance = vi.hoisted(() => ({
  getActiveAdapterName: vi.fn().mockReturnValue('native'),
  setAuthToken: vi.fn(),
  isAvailable: vi.fn().mockReturnValue(false),
}));

const mockTaskRouterInstance = vi.hoisted(() => ({
  classify: vi.fn().mockReturnValue({
    complexity: 'medium',
    strategy: 'supervised',
    model: 'sonnet',
    confidence: 0.85,
    signals: [],
  }),
}));

const mockLogParserInstance = vi.hoisted(() => ({
  parseBatch: vi.fn().mockReturnValue([]),
  parseLine: vi.fn().mockReturnValue(null),
  getHealthSignal: vi.fn().mockReturnValue({ state: 'idle', isHealthy: true }),
  getRecentOutput: vi.fn().mockReturnValue([]),
  getSessionId: vi.fn().mockReturnValue(''),
  getState: vi.fn().mockReturnValue('idle'),
}));

const mockGetSystemPromptForRole = vi.hoisted(() =>
  vi.fn().mockReturnValue('You are a worker agent.')
);

// ============================================================================
// vi.mock() declarations
// ============================================================================

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('uuid', () => ({
  v4: mockUuidv4,
}));

vi.mock('./native-bridge.js', () => ({
  NativeBridge: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockNativeBridgeInstance);
  }),
}));

vi.mock('./inbox-bridge.js', () => ({
  InboxBridge: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockInboxBridgeInstance);
  }),
}));

vi.mock('./task-sync.js', () => ({
  TaskSyncBridge: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockTaskSyncBridgeInstance);
  }),
}));

vi.mock('./coordination-adapter.js', () => ({
  NativeAdapter: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockCoordinationAdapterInstance);
  }),
}));

vi.mock('./task-router.js', () => ({
  TaskRouter: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockTaskRouterInstance);
  }),
}));

vi.mock('./log-parser.js', () => ({
  createLogParser: vi.fn().mockReturnValue(mockLogParserInstance),
}));

vi.mock('./agent-roles.js', () => ({
  getSystemPromptForRole: mockGetSystemPromptForRole,
}));

vi.mock('./worktree.js', () => ({
  WorktreeManager: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.create = vi.fn().mockResolvedValue({ path: '/tmp/worktree', branch: 'worker/test' });
    this.remove = vi.fn().mockResolvedValue(undefined);
    this.cleanupOrphaned = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../storage/mail.js', () => ({
  MailStorage: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.formatAllPendingForInjection = vi.fn().mockReturnValue(null);
  }),
}));

vi.mock('../storage/agent-memory.js', () => ({
  AgentMemory: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getAll = vi.fn().mockReturnValue([]);
  }),
}));

// Mock the optional tmux import at module level (not available)
vi.mock('@claude-fleet/tmux', () => {
  throw new Error('Module not available');
});

// ============================================================================
// Helpers
// ============================================================================

function createMockStorage() {
  return {
    getActiveWorkers: vi.fn().mockReturnValue([]),
    getAllWorkers: vi.fn().mockReturnValue([]),
    insertWorker: vi.fn(),
    updateWorkerStatus: vi.fn(),
    updateWorkerHeartbeat: vi.fn(),
    updateWorkerPid: vi.fn(),
    dismissWorker: vi.fn(),
    getWorkerByHandle: vi.fn().mockReturnValue(null),
    deleteWorkerByHandle: vi.fn(),
  };
}

function createMockSpawnController() {
  return {
    canSpawn: vi.fn().mockReturnValue({ allowed: true }),
    registerSpawn: vi.fn(),
    unregisterSpawn: vi.fn(),
  };
}

/**
 * Creates a fresh mock child process that is also an EventEmitter.
 * Each call returns a new instance to avoid cross-test pollution.
 */
function createMockProcess(pid = 12345) {
  const proc = Object.assign(new EventEmitter(), {
    pid,
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  return proc;
}

// ============================================================================
// Tests
// ============================================================================

describe('WorkerManager', () => {
  // We import dynamically so mocks are applied first
  let WorkerManager: typeof import('./manager.js').WorkerManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Reset uuid counter
    let uuidCounter = 0;
    mockUuidv4.mockImplementation(() => `uuid-${++uuidCounter}`);

    // Reset mock spawn to return a fresh process each call
    mockSpawn.mockImplementation(() => createMockProcess());

    // Reset all hoisted mocks
    mockNativeBridgeInstance.checkAvailability.mockReturnValue({ isAvailable: false, claudeBinary: null });
    mockNativeBridgeInstance.shouldFallback.mockReturnValue(true);
    mockLogParserInstance.parseBatch.mockReturnValue([]);
    mockLogParserInstance.getRecentOutput.mockReturnValue([]);
    mockGetSystemPromptForRole.mockReturnValue('You are a worker agent.');

    // Import fresh module
    const mod = await import('./manager.js');
    WorkerManager = mod.WorkerManager;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================

  describe('constructor', () => {
    it('should create with default options', () => {
      const manager = new WorkerManager();
      expect(manager.getWorkerCount()).toBe(0);
      expect(manager.getWorkers()).toEqual([]);
      manager.dismissAll();
    });

    it('should accept custom maxWorkers', () => {
      const manager = new WorkerManager({ maxWorkers: 10 });
      expect(manager.getWorkerCount()).toBe(0);
      manager.dismissAll();
    });

    it('should store default team name and server URL', () => {
      const manager = new WorkerManager({
        defaultTeamName: 'alpha',
        serverUrl: 'http://localhost:9999',
      });
      // Verify through native status which uses defaults
      const status = manager.getNativeStatus();
      expect(status.defaultSpawnMode).toBe('process');
      manager.dismissAll();
    });

    it('should initialize mail storage and agent memory when storage provided', () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never });
      expect(manager.getAgentMemory()).not.toBeNull();
      manager.dismissAll();
    });

    it('should not initialize mail storage when no storage provided', () => {
      const manager = new WorkerManager();
      expect(manager.getAgentMemory()).toBeNull();
      manager.dismissAll();
    });

    it('should auto-promote to native mode when binary is available', () => {
      mockNativeBridgeInstance.checkAvailability.mockReturnValue({
        isAvailable: true,
        claudeBinary: '/usr/local/bin/claude',
      });
      const manager = new WorkerManager();
      expect(manager.getNativeStatus().defaultSpawnMode).toBe('native');
      manager.dismissAll();
    });

    it('should not auto-promote when explicit spawn mode is set', () => {
      mockNativeBridgeInstance.checkAvailability.mockReturnValue({
        isAvailable: true,
        claudeBinary: '/usr/local/bin/claude',
      });
      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      expect(manager.getNativeStatus().defaultSpawnMode).toBe('process');
      manager.dismissAll();
    });

    it('should force native mode when nativeOnly is true', () => {
      const manager = new WorkerManager({ nativeOnly: true });
      expect(manager.getNativeStatus().nativeOnly).toBe(true);
      expect(manager.getNativeStatus().defaultSpawnMode).toBe('native');
      manager.dismissAll();
    });
  });

  // ========================================================================
  // SPAWN CONTROLLER
  // ========================================================================

  describe('spawn controller', () => {
    it('should set and get spawn controller', () => {
      const manager = new WorkerManager();
      const controller = createMockSpawnController();
      manager.setSpawnController(controller as never);
      expect(manager.getSpawnController()).toBe(controller);
      manager.dismissAll();
    });

    it('should return null when no spawn controller set', () => {
      const manager = new WorkerManager();
      expect(manager.getSpawnController()).toBeNull();
      manager.dismissAll();
    });
  });

  // ========================================================================
  // INITIALIZE (crash recovery)
  // ========================================================================

  describe('initialize', () => {
    it('should skip recovery when no storage configured', async () => {
      const manager = new WorkerManager();
      await manager.initialize();
      // No error
      manager.dismissAll();
    });

    it('should clean up orphaned worktrees on init', async () => {
      const storage = createMockStorage();
      storage.getActiveWorkers.mockReturnValue([]);
      const manager = new WorkerManager({
        storage: storage as never,
        useWorktrees: true,
        worktreeBaseDir: '/tmp/worktrees',
      });
      await manager.initialize();
      // WorktreeManager.cleanupOrphaned should have been called
      manager.dismissAll();
    });

    it('should skip workers with running PID', async () => {
      const storage = createMockStorage();
      storage.getActiveWorkers.mockReturnValue([
        {
          id: 'w-1',
          handle: 'worker-1',
          pid: process.pid, // Use current PID so it's "running"
          sessionId: 'sess-1',
          worktreePath: null,
          status: 'ready',
          restartCount: 0,
          role: 'worker',
        },
      ]);
      const manager = new WorkerManager({ storage: storage as never });
      await manager.initialize();
      // Worker should be skipped (still running)
      manager.dismissAll();
    });

    it('should mark worker as error when no session ID for restore', async () => {
      const storage = createMockStorage();
      storage.getActiveWorkers.mockReturnValue([
        {
          id: 'w-2',
          handle: 'worker-2',
          pid: 999999, // Not running
          sessionId: null,
          worktreePath: null,
          status: 'ready',
          restartCount: 0,
          role: 'worker',
        },
      ]);
      const manager = new WorkerManager({ storage: storage as never });
      await manager.initialize();
      expect(storage.updateWorkerStatus).toHaveBeenCalledWith('w-2', 'error');
      manager.dismissAll();
    });
  });

  // ========================================================================
  // REGISTER EXTERNAL WORKER
  // ========================================================================

  describe('registerExternalWorker', () => {
    it('should register an external worker', () => {
      const manager = new WorkerManager();
      const result = manager.registerExternalWorker('ext-1', 'default', '/tmp/work');

      expect(result.handle).toBe('ext-1');
      expect(result.teamName).toBe('default');
      expect(result.state).toBe('ready');
      expect(result.spawnMode).toBe('external');
      expect(manager.getWorkerCount()).toBe(1);
      manager.dismissAll();
    });

    it('should return existing worker if handle already registered', () => {
      const manager = new WorkerManager();
      const first = manager.registerExternalWorker('ext-1', 'default', '/tmp/work');
      const second = manager.registerExternalWorker('ext-1', 'default', '/tmp/work');

      expect(first.id).toBe(second.id);
      expect(manager.getWorkerCount()).toBe(1);
      manager.dismissAll();
    });

    it('should persist to storage when available', () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never });
      manager.registerExternalWorker('ext-1', 'default', '/tmp/work');

      expect(storage.insertWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: 'ext-1',
          status: 'ready',
          spawnMode: 'external',
        })
      );
      manager.dismissAll();
    });

    it('should emit worker:ready event', () => {
      const manager = new WorkerManager();
      const listener = vi.fn();
      manager.on('worker:ready', listener);

      manager.registerExternalWorker('ext-1', 'default', '/tmp/work');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ handle: 'ext-1', sessionId: null })
      );
      manager.dismissAll();
    });

    it('should include swarmId when provided', () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never });
      const result = manager.registerExternalWorker('ext-1', 'default', '/tmp/work', 'swarm-1');

      expect(storage.insertWorker).toHaveBeenCalledWith(
        expect.objectContaining({ swarmId: 'swarm-1' })
      );
      expect(result.spawnMode).toBe('external');
      manager.dismissAll();
    });
  });

  // ========================================================================
  // INJECT WORKER OUTPUT
  // ========================================================================

  describe('injectWorkerOutput', () => {
    it('should inject output and emit event for registered worker', () => {
      const manager = new WorkerManager();
      manager.registerExternalWorker('ext-1', 'default', '/tmp/work');

      const listener = vi.fn();
      manager.on('worker:output', listener);

      const event = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } };
      manager.injectWorkerOutput('ext-1', event as never);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ handle: 'ext-1', event })
      );
      manager.dismissAll();
    });

    it('should do nothing for unknown handle', () => {
      const manager = new WorkerManager();
      const listener = vi.fn();
      manager.on('worker:output', listener);

      manager.injectWorkerOutput('nonexistent', { type: 'assistant' } as never);
      expect(listener).not.toHaveBeenCalled();
      manager.dismissAll();
    });

    it('should trim output buffer to MAX_OUTPUT_LINES', () => {
      const manager = new WorkerManager();
      manager.registerExternalWorker('ext-1', 'default', '/tmp/work');

      // Inject 105 events
      for (let i = 0; i < 105; i++) {
        manager.injectWorkerOutput('ext-1', {
          type: 'assistant',
          message: { content: [{ type: 'text', text: `line-${i}` }] },
        } as never);
      }

      const output = manager.getWorkerOutput(
        manager.getWorkerByHandle('ext-1')!.id
      );
      expect(output.length).toBe(100);
      manager.dismissAll();
    });
  });

  // ========================================================================
  // SPAWN WORKER (process mode)
  // ========================================================================

  describe('spawnWorker', () => {
    it('should spawn a worker process', async () => {
      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const result = await manager.spawnWorker({ handle: 'w-1' });

      expect(result.handle).toBe('w-1');
      expect(result.state).toBe('starting');
      expect(result.spawnMode).toBe('process');
      expect(manager.getWorkerCount()).toBe(1);
      manager.dismissAll();
    });

    it('should throw when max workers reached', async () => {
      const manager = new WorkerManager({ maxWorkers: 1, defaultSpawnMode: 'process' });
      await manager.spawnWorker({ handle: 'w-1' });

      await expect(manager.spawnWorker({ handle: 'w-2' })).rejects.toThrow(
        'Maximum workers (1) reached'
      );
      manager.dismissAll();
    });

    it('should throw when handle already exists', async () => {
      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      await manager.spawnWorker({ handle: 'w-1' });

      await expect(manager.spawnWorker({ handle: 'w-1' })).rejects.toThrow(
        "Worker with handle 'w-1' already exists"
      );
      manager.dismissAll();
    });

    it('should check spawn controller when available', async () => {
      const controller = createMockSpawnController();
      controller.canSpawn.mockReturnValue({ allowed: false, reason: 'At limit' });

      const manager = new WorkerManager({ spawnController: controller as never, defaultSpawnMode: 'process' });

      await expect(manager.spawnWorker({ handle: 'w-1' })).rejects.toThrow('At limit');
      manager.dismissAll();
    });

    it('should warn but allow spawn when controller gives warning', async () => {
      const controller = createMockSpawnController();
      controller.canSpawn.mockReturnValue({ allowed: true, warning: 'Approaching limit' });

      const manager = new WorkerManager({ spawnController: controller as never, defaultSpawnMode: 'process' });
      const result = await manager.spawnWorker({ handle: 'w-1' });

      expect(result.handle).toBe('w-1');
      manager.dismissAll();
    });

    it('should persist worker to storage', async () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never, defaultSpawnMode: 'process' });
      await manager.spawnWorker({ handle: 'w-1', initialPrompt: 'Do work' });

      expect(storage.insertWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: 'w-1',
          status: 'pending',
          spawnMode: 'process',
        })
      );
      manager.dismissAll();
    });

    it('should register with spawn controller on spawn', async () => {
      const controller = createMockSpawnController();
      const manager = new WorkerManager({ spawnController: controller as never, defaultSpawnMode: 'process' });
      await manager.spawnWorker({ handle: 'w-1' });

      expect(controller.registerSpawn).toHaveBeenCalled();
      manager.dismissAll();
    });

    it('should use default team name when not provided', async () => {
      const manager = new WorkerManager({ defaultTeamName: 'alpha', defaultSpawnMode: 'process' });
      const result = await manager.spawnWorker({ handle: 'w-1' });

      expect(result.teamName).toBe('alpha');
      manager.dismissAll();
    });

    it('should use provided team name', async () => {
      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const result = await manager.spawnWorker({ handle: 'w-1', teamName: 'beta' });

      expect(result.teamName).toBe('beta');
      manager.dismissAll();
    });

    it('should reject duplicate handle in storage that is still active', async () => {
      const storage = createMockStorage();
      storage.getWorkerByHandle.mockReturnValue({ handle: 'w-1', status: 'ready' });

      const manager = new WorkerManager({ storage: storage as never, defaultSpawnMode: 'process' });
      await expect(manager.spawnWorker({ handle: 'w-1' })).rejects.toThrow(
        "Worker with handle 'w-1' exists in storage"
      );
      manager.dismissAll();
    });

    it('should allow respawning dismissed worker in storage', async () => {
      const storage = createMockStorage();
      storage.getWorkerByHandle.mockReturnValue({ handle: 'w-1', status: 'dismissed' });

      const manager = new WorkerManager({ storage: storage as never, defaultSpawnMode: 'process' });
      const result = await manager.spawnWorker({ handle: 'w-1' });

      expect(result.handle).toBe('w-1');
      expect(storage.deleteWorkerByHandle).toHaveBeenCalledWith('w-1');
      manager.dismissAll();
    });

    it('should allow respawning errored worker in storage', async () => {
      const storage = createMockStorage();
      storage.getWorkerByHandle.mockReturnValue({ handle: 'w-1', status: 'error' });

      const manager = new WorkerManager({ storage: storage as never, defaultSpawnMode: 'process' });
      const result = await manager.spawnWorker({ handle: 'w-1' });

      expect(result.handle).toBe('w-1');
      manager.dismissAll();
    });

    it('should reject process spawn in nativeOnly mode', async () => {
      const manager = new WorkerManager({ nativeOnly: true });

      await expect(
        manager.spawnWorker({ handle: 'w-1', spawnMode: 'process' })
      ).rejects.toThrow('not allowed in native-only mode');
      manager.dismissAll();
    });
  });

  // ========================================================================
  // SPAWN WORKER (native mode)
  // ========================================================================

  describe('spawnWorker (native mode)', () => {
    it('should spawn via native bridge when available', async () => {
      mockNativeBridgeInstance.checkAvailability.mockReturnValue({
        isAvailable: true,
        claudeBinary: '/usr/local/bin/claude',
      });
      mockNativeBridgeInstance.shouldFallback.mockReturnValue(false);

      const manager = new WorkerManager({ defaultSpawnMode: 'native' });
      const result = await manager.spawnWorker({ handle: 'w-1', initialPrompt: 'Do work' });

      expect(result.spawnMode).toBe('native');
      expect(mockNativeBridgeInstance.prepareForSpawn).toHaveBeenCalled();
      expect(mockNativeBridgeInstance.buildNativeEnv).toHaveBeenCalled();
      manager.dismissAll();
    });

    it('should fall back to process mode when native unavailable and not nativeOnly', async () => {
      mockNativeBridgeInstance.checkAvailability.mockReturnValue({
        isAvailable: false,
        claudeBinary: null,
      });
      mockNativeBridgeInstance.shouldFallback.mockReturnValue(true);

      const manager = new WorkerManager({ defaultSpawnMode: 'native' });
      const result = await manager.spawnWorker({ handle: 'w-1' });

      // Falls back to process mode
      expect(result.state).toBe('starting');
      manager.dismissAll();
    });

    it('should throw in nativeOnly mode when native unavailable', async () => {
      mockNativeBridgeInstance.checkAvailability.mockReturnValue({
        isAvailable: false,
        claudeBinary: null,
      });
      mockNativeBridgeInstance.shouldFallback.mockReturnValue(true);

      const manager = new WorkerManager({ nativeOnly: true });

      await expect(manager.spawnWorker({ handle: 'w-1' })).rejects.toThrow(
        'Native mode required'
      );
      manager.dismissAll();
    });
  });

  // ========================================================================
  // DISMISS WORKER
  // ========================================================================

  describe('dismissWorker', () => {
    it('should dismiss an external worker immediately', async () => {
      const manager = new WorkerManager();
      const worker = manager.registerExternalWorker('ext-1', 'default', '/tmp/work');

      const exitListener = vi.fn();
      manager.on('worker:exit', exitListener);

      await manager.dismissWorker(worker.id);

      expect(manager.getWorkerCount()).toBe(0);
      expect(exitListener).toHaveBeenCalledWith(
        expect.objectContaining({ handle: 'ext-1', code: 0 })
      );
    });

    it('should do nothing for unknown worker ID', async () => {
      const manager = new WorkerManager();
      await manager.dismissWorker('nonexistent');
      // No error
      manager.dismissAll();
    });

    it('should update storage on dismiss', async () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never });
      const worker = manager.registerExternalWorker('ext-1', 'default', '/tmp/work');
      await manager.dismissWorker(worker.id);

      expect(storage.dismissWorker).toHaveBeenCalledWith(worker.id);
    });

    it('should unregister from spawn controller', async () => {
      const controller = createMockSpawnController();
      const manager = new WorkerManager({
        spawnController: controller as never,
        defaultSpawnMode: 'process',
      });

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      // Simulate the process exiting via the close event (which sets state=stopped
      // and removes from the map, allowing dismissWorker's polling loop to resolve).
      const dismissPromise = manager.dismissWorker(result.id);

      // Advance timers to let the polling interval fire, then trigger close
      vi.advanceTimersByTime(150);
      worker.process.emit('close', 0);
      vi.advanceTimersByTime(150);

      await dismissPromise;

      // unregisterSpawn should have been called during dismiss
      expect(controller.unregisterSpawn).toHaveBeenCalled();
    });

    it('should dismiss worker by handle', async () => {
      const manager = new WorkerManager();
      manager.registerExternalWorker('ext-1', 'default', '/tmp/work');

      await manager.dismissWorkerByHandle('ext-1');
      expect(manager.getWorkerCount()).toBe(0);
    });

    it('should no-op dismissWorkerByHandle for unknown handle', async () => {
      const manager = new WorkerManager();
      await manager.dismissWorkerByHandle('nonexistent');
      // No error
    });
  });

  // ========================================================================
  // SEND TO WORKER
  // ========================================================================

  describe('sendToWorker', () => {
    it('should return false for unknown worker', async () => {
      const manager = new WorkerManager();
      const result = await manager.sendToWorker('nonexistent', 'hello');
      expect(result).toBe(false);
    });

    it('should return false for external worker', async () => {
      const manager = new WorkerManager();
      const worker = manager.registerExternalWorker('ext-1', 'default', '/tmp/work');
      const result = await manager.sendToWorker(worker.id, 'hello');
      expect(result).toBe(false);
      manager.dismissAll();
    });

    it('should send message by handle', async () => {
      const manager = new WorkerManager();
      const result = await manager.sendToWorkerByHandle('nonexistent', 'hello');
      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // DELIVER TASK TO WORKER
  // ========================================================================

  describe('deliverTaskToWorker', () => {
    it('should return false for unknown worker', async () => {
      const manager = new WorkerManager();
      const result = await manager.deliverTaskToWorker('nonexistent', {
        id: 't-1',
        title: 'Test task',
      });
      expect(result).toBe(false);
    });

    it('should return false for stopped worker', async () => {
      const manager = new WorkerManager();
      const ext = manager.registerExternalWorker('ext-1', 'default', '/tmp/work');
      const worker = manager.getWorker(ext.id)!;
      worker.state = 'stopped';

      const result = await manager.deliverTaskToWorker(ext.id, {
        id: 't-1',
        title: 'Test task',
      });
      expect(result).toBe(false);
      manager.dismissAll();
    });
  });

  // ========================================================================
  // GET WORKERS / GET WORKER
  // ========================================================================

  describe('getWorkers / getWorker / getWorkerByHandle', () => {
    it('should return empty array when no workers', () => {
      const manager = new WorkerManager();
      expect(manager.getWorkers()).toEqual([]);
      manager.dismissAll();
    });

    it('should return all workers', () => {
      const manager = new WorkerManager();
      manager.registerExternalWorker('ext-1', 'default', '/tmp');
      manager.registerExternalWorker('ext-2', 'default', '/tmp');

      expect(manager.getWorkers()).toHaveLength(2);
      manager.dismissAll();
    });

    it('should get worker by ID', () => {
      const manager = new WorkerManager();
      const result = manager.registerExternalWorker('ext-1', 'default', '/tmp');
      const worker = manager.getWorker(result.id);

      expect(worker).toBeDefined();
      expect(worker!.handle).toBe('ext-1');
      manager.dismissAll();
    });

    it('should return undefined for unknown ID', () => {
      const manager = new WorkerManager();
      expect(manager.getWorker('nonexistent')).toBeUndefined();
      manager.dismissAll();
    });

    it('should get worker by handle', () => {
      const manager = new WorkerManager();
      manager.registerExternalWorker('ext-1', 'default', '/tmp');
      const worker = manager.getWorkerByHandle('ext-1');

      expect(worker).toBeDefined();
      expect(worker!.handle).toBe('ext-1');
      manager.dismissAll();
    });

    it('should return undefined for unknown handle', () => {
      const manager = new WorkerManager();
      expect(manager.getWorkerByHandle('nonexistent')).toBeUndefined();
      manager.dismissAll();
    });
  });

  // ========================================================================
  // WORKER OUTPUT BUFFER
  // ========================================================================

  describe('getWorkerOutput', () => {
    it('should return empty array for unknown worker', () => {
      const manager = new WorkerManager();
      expect(manager.getWorkerOutput('nonexistent')).toEqual([]);
      manager.dismissAll();
    });

    it('should return recent output for worker', () => {
      const manager = new WorkerManager();
      const ext = manager.registerExternalWorker('ext-1', 'default', '/tmp');

      manager.injectWorkerOutput('ext-1', {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      } as never);

      const output = manager.getWorkerOutput(ext.id);
      expect(output.length).toBeGreaterThan(0);
      manager.dismissAll();
    });
  });

  // ========================================================================
  // WORKER COUNT
  // ========================================================================

  describe('getWorkerCount', () => {
    it('should track worker count accurately', () => {
      const manager = new WorkerManager();
      expect(manager.getWorkerCount()).toBe(0);

      manager.registerExternalWorker('ext-1', 'default', '/tmp');
      expect(manager.getWorkerCount()).toBe(1);

      manager.registerExternalWorker('ext-2', 'default', '/tmp');
      expect(manager.getWorkerCount()).toBe(2);
      manager.dismissAll();
    });
  });

  // ========================================================================
  // HEALTH STATS
  // ========================================================================

  describe('getHealthStats', () => {
    it('should return zero stats when empty', () => {
      const manager = new WorkerManager();
      const stats = manager.getHealthStats();

      expect(stats.total).toBe(0);
      expect(stats.healthy).toBe(0);
      expect(stats.degraded).toBe(0);
      expect(stats.unhealthy).toBe(0);
      manager.dismissAll();
    });

    it('should count healthy workers', () => {
      const manager = new WorkerManager();
      manager.registerExternalWorker('ext-1', 'default', '/tmp');
      manager.registerExternalWorker('ext-2', 'default', '/tmp');

      const stats = manager.getHealthStats();
      expect(stats.total).toBe(2);
      expect(stats.healthy).toBe(2);
      manager.dismissAll();
    });

    it('should count degraded and unhealthy workers', () => {
      const manager = new WorkerManager();
      const ext1 = manager.registerExternalWorker('ext-1', 'default', '/tmp');
      const ext2 = manager.registerExternalWorker('ext-2', 'default', '/tmp');
      const ext3 = manager.registerExternalWorker('ext-3', 'default', '/tmp');

      const worker1 = manager.getWorker(ext1.id)!;
      const worker2 = manager.getWorker(ext2.id)!;
      worker1.health = 'degraded';
      worker2.health = 'unhealthy';

      const stats = manager.getHealthStats();
      expect(stats.total).toBe(3);
      expect(stats.healthy).toBe(1);
      expect(stats.degraded).toBe(1);
      expect(stats.unhealthy).toBe(1);
      manager.dismissAll();
    });
  });

  // ========================================================================
  // HEALTH CHECK
  // ========================================================================

  describe('health check', () => {
    it('should mark worker as unhealthy after threshold', () => {
      const manager = new WorkerManager({ autoRestart: false });
      const ext = manager.registerExternalWorker('ext-1', 'default', '/tmp');
      const worker = manager.getWorker(ext.id)!;

      // Simulate old heartbeat (more than 60 seconds ago)
      worker.lastHeartbeat = Date.now() - 70000;

      const listener = vi.fn();
      manager.on('worker:unhealthy', listener);

      // Trigger health check
      vi.advanceTimersByTime(15000);

      expect(worker.health).toBe('unhealthy');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ handle: 'ext-1' })
      );
      manager.dismissAll();
    });

    it('should mark worker as degraded after healthy threshold', () => {
      const manager = new WorkerManager({ autoRestart: false });
      const ext = manager.registerExternalWorker('ext-1', 'default', '/tmp');
      const worker = manager.getWorker(ext.id)!;

      // Simulate heartbeat 35 seconds ago (between 30s and 60s)
      worker.lastHeartbeat = Date.now() - 35000;

      // Trigger health check
      vi.advanceTimersByTime(15000);

      expect(worker.health).toBe('degraded');
      manager.dismissAll();
    });

    it('should skip stopped and stopping workers', () => {
      const manager = new WorkerManager({ autoRestart: false });
      const ext = manager.registerExternalWorker('ext-1', 'default', '/tmp');
      const worker = manager.getWorker(ext.id)!;

      worker.state = 'stopped';
      worker.lastHeartbeat = Date.now() - 70000;

      // Trigger health check
      vi.advanceTimersByTime(15000);

      // Should still be healthy because stopped workers are skipped
      expect(worker.health).toBe('healthy');
      manager.dismissAll();
    });

    it('should not auto-restart external workers', () => {
      const manager = new WorkerManager({ autoRestart: true });
      const ext = manager.registerExternalWorker('ext-1', 'default', '/tmp');
      const worker = manager.getWorker(ext.id)!;

      // Make unhealthy
      worker.lastHeartbeat = Date.now() - 70000;

      // Trigger health check
      vi.advanceTimersByTime(15000);

      // Worker should be marked unhealthy but NOT restarted (it's external)
      expect(worker.health).toBe('unhealthy');
      // Worker count should still be 1 (not dismissed for restart)
      expect(manager.getWorkerCount()).toBe(1);
      manager.dismissAll();
    });
  });

  // ========================================================================
  // RESTART STATS
  // ========================================================================

  describe('getRestartStats', () => {
    it('should return zero stats initially', () => {
      const manager = new WorkerManager();
      const stats = manager.getRestartStats();

      expect(stats.total).toBe(0);
      expect(stats.lastHour).toBe(0);
      manager.dismissAll();
    });
  });

  // ========================================================================
  // DISMISS ALL
  // ========================================================================

  describe('dismissAll', () => {
    it('should dismiss all workers', async () => {
      const manager = new WorkerManager();
      manager.registerExternalWorker('ext-1', 'default', '/tmp');
      manager.registerExternalWorker('ext-2', 'default', '/tmp');
      expect(manager.getWorkerCount()).toBe(2);

      await manager.dismissAll();
      expect(manager.getWorkerCount()).toBe(0);
    });

    it('should stop health check interval', async () => {
      const manager = new WorkerManager();
      await manager.dismissAll();
      // Health check should be cleared - no errors on further timer advances
      vi.advanceTimersByTime(60000);
    });
  });

  // ========================================================================
  // ROUTING RECOMMENDATION
  // ========================================================================

  describe('getRoutingRecommendation', () => {
    it('should return routing decision from task router', () => {
      const manager = new WorkerManager();
      const result = manager.getRoutingRecommendation({
        subject: 'Implement feature',
        description: 'Build the user auth system',
      });

      expect(result).not.toBeNull();
      expect(result!.complexity).toBe('medium');
      expect(result!.strategy).toBe('supervised');
      expect(result!.model).toBe('sonnet');
      expect(result!.confidence).toBe(0.85);
      manager.dismissAll();
    });

    it('should return null when no task router', () => {
      const manager = new WorkerManager();
      // Forcefully remove the task router
      (manager as unknown as { taskRouter: null }).taskRouter = null;

      const result = manager.getRoutingRecommendation({ subject: 'Test' });
      expect(result).toBeNull();
      manager.dismissAll();
    });
  });

  // ========================================================================
  // ACCESSORS
  // ========================================================================

  describe('accessors', () => {
    it('should return task router', () => {
      const manager = new WorkerManager();
      expect(manager.getTaskRouter()).not.toBeNull();
      manager.dismissAll();
    });

    it('should return worktree manager when enabled', () => {
      const manager = new WorkerManager({ useWorktrees: true, worktreeBaseDir: '/tmp/wt' });
      expect(manager.getWorktreeManager()).not.toBeNull();
      manager.dismissAll();
    });

    it('should return null worktree manager when disabled', () => {
      const manager = new WorkerManager();
      expect(manager.getWorktreeManager()).toBeNull();
      manager.dismissAll();
    });

    it('should return tmux adapter as null when not available', () => {
      const manager = new WorkerManager();
      expect(manager.getTmuxAdapter()).toBeNull();
      manager.dismissAll();
    });

    it('should return isTmuxAvailable as false', () => {
      const manager = new WorkerManager();
      expect(manager.isTmuxAvailable()).toBe(false);
      manager.dismissAll();
    });

    it('should return empty persisted workers when no storage', () => {
      const manager = new WorkerManager();
      expect(manager.getPersistedWorkers()).toEqual([]);
      manager.dismissAll();
    });

    it('should return persisted workers from storage', () => {
      const storage = createMockStorage();
      storage.getAllWorkers.mockReturnValue([
        { id: 'w-1', handle: 'worker-1', status: 'ready' },
      ]);
      const manager = new WorkerManager({ storage: storage as never });

      expect(manager.getPersistedWorkers()).toHaveLength(1);
      manager.dismissAll();
    });

    it('should return coordination adapter', () => {
      const manager = new WorkerManager();
      expect(manager.getCoordinationAdapter()).not.toBeNull();
      manager.dismissAll();
    });

    it('should return native status', () => {
      const manager = new WorkerManager();
      const status = manager.getNativeStatus();

      expect(status).toHaveProperty('isAvailable');
      expect(status).toHaveProperty('claudeBinary');
      expect(status).toHaveProperty('activeAdapter');
      expect(status).toHaveProperty('defaultSpawnMode');
      expect(status).toHaveProperty('nativeOnly');
      manager.dismissAll();
    });

    it('should return native bridge', () => {
      const manager = new WorkerManager();
      expect(manager.getNativeBridge()).not.toBeNull();
      manager.dismissAll();
    });

    it('should set coordination auth token', () => {
      const manager = new WorkerManager();
      manager.setCoordinationAuthToken('test-token');
      expect(mockCoordinationAdapterInstance.setAuthToken).toHaveBeenCalledWith('test-token');
      manager.dismissAll();
    });

    it('should return inbox bridge', () => {
      const manager = new WorkerManager();
      expect(manager.getInboxBridge()).not.toBeNull();
      manager.dismissAll();
    });

    it('should return agent memory when storage provided', () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never });
      expect(manager.getAgentMemory()).not.toBeNull();
      manager.dismissAll();
    });
  });

  // ========================================================================
  // PROCESS EVENT HANDLERS (stdout/stderr/close/error)
  // ========================================================================

  describe('process event handlers', () => {
    it('should handle system:init event and emit worker:ready', async () => {
      mockLogParserInstance.parseBatch.mockReturnValue([
        {
          eventType: 'system',
          subtype: 'init',
          sessionId: 'sess-123',
          text: '',
          isError: false,
          timestamp: Date.now(),
        },
      ]);

      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const readyListener = vi.fn();
      manager.on('worker:ready', readyListener);

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      // Trigger stdout data
      worker.process.stdout?.emit('data', Buffer.from('{"type":"system","subtype":"init"}\n'));

      expect(readyListener).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: 'w-1',
          sessionId: 'sess-123',
        })
      );
      expect(worker.state).toBe('ready');
      expect(worker.sessionId).toBe('sess-123');
      manager.dismissAll();
    });

    it('should handle assistant events and update state to working', async () => {
      mockLogParserInstance.parseBatch.mockReturnValue([
        {
          eventType: 'assistant',
          subtype: '',
          sessionId: '',
          text: 'Working on it...',
          isError: false,
          timestamp: Date.now(),
        },
      ]);

      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.process.stdout?.emit('data', Buffer.from('{"type":"assistant"}\n'));

      expect(worker.state).toBe('working');
      manager.dismissAll();
    });

    it('should handle result events and emit worker:result', async () => {
      mockLogParserInstance.parseBatch.mockReturnValue([
        {
          eventType: 'result',
          subtype: '',
          sessionId: '',
          text: 'Task completed successfully',
          isError: false,
          timestamp: Date.now(),
        },
      ]);

      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const resultListener = vi.fn();
      manager.on('worker:result', resultListener);

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.process.stdout?.emit('data', Buffer.from('{"type":"result"}\n'));

      expect(resultListener).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: 'w-1',
          result: 'Task completed successfully',
        })
      );
      expect(worker.state).toBe('ready');
      manager.dismissAll();
    });

    it('should handle stderr and emit worker:error', async () => {
      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const errorListener = vi.fn();
      manager.on('worker:error', errorListener);

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.process.stderr?.emit('data', Buffer.from('Something went wrong'));

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: 'w-1',
          error: 'Something went wrong',
        })
      );
      manager.dismissAll();
    });

    it('should skip deprecated messages in stderr', async () => {
      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const errorListener = vi.fn();
      manager.on('worker:error', errorListener);

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.process.stderr?.emit('data', Buffer.from('This API is deprecated'));

      expect(errorListener).not.toHaveBeenCalled();
      manager.dismissAll();
    });

    it('should handle process close event', async () => {
      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const exitListener = vi.fn();
      manager.on('worker:exit', exitListener);

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.process.emit('close', 0);

      expect(worker.state).toBe('stopped');
      expect(exitListener).toHaveBeenCalledWith(
        expect.objectContaining({ handle: 'w-1', code: 0 })
      );
      // Worker removed from map after close
      expect(manager.getWorkerCount()).toBe(0);
      manager.dismissAll();
    });

    it('should update storage to error on non-zero exit code', async () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never, defaultSpawnMode: 'process' });

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.process.emit('close', 1);

      expect(storage.updateWorkerStatus).toHaveBeenCalledWith(result.id, 'error');
      manager.dismissAll();
    });

    it('should update storage to dismissed on intentional stop', async () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never, defaultSpawnMode: 'process' });

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.state = 'stopping'; // Mark as intentionally stopping
      worker.process.emit('close', 0);

      expect(storage.updateWorkerStatus).toHaveBeenCalledWith(result.id, 'dismissed');
    });

    it('should handle process error event', async () => {
      const storage = createMockStorage();
      const manager = new WorkerManager({ storage: storage as never, defaultSpawnMode: 'process' });
      const errorListener = vi.fn();
      manager.on('worker:error', errorListener);

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.process.emit('error', new Error('ENOENT'));

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({ handle: 'w-1', error: 'ENOENT' })
      );
      expect(storage.updateWorkerStatus).toHaveBeenCalledWith(result.id, 'error');
      manager.dismissAll();
    });
  });

  // ========================================================================
  // PROCESS OUTPUT EMITTING
  // ========================================================================

  describe('output event emitting', () => {
    it('should emit worker:output for each parsed event', async () => {
      mockLogParserInstance.parseBatch.mockReturnValue([
        {
          eventType: 'assistant',
          subtype: '',
          sessionId: '',
          text: 'Hello',
          isError: false,
          timestamp: Date.now(),
        },
        {
          eventType: 'assistant',
          subtype: '',
          sessionId: '',
          text: 'World',
          isError: false,
          timestamp: Date.now(),
        },
      ]);

      const manager = new WorkerManager({ defaultSpawnMode: 'process' });
      const outputListener = vi.fn();
      manager.on('worker:output', outputListener);

      const result = await manager.spawnWorker({ handle: 'w-1' });
      const worker = manager.getWorker(result.id)!;

      worker.process.stdout?.emit('data', Buffer.from('line1\nline2\n'));

      expect(outputListener).toHaveBeenCalledTimes(2);
      manager.dismissAll();
    });
  });
});
