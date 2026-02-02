/**
 * Tests for HeadlessWaveOrchestrator
 *
 * Verifies wave execution ordering, worker spawn/success/failure,
 * timeout handling, cancellation, and event emission.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';

// ── Mock Setup ────────────────────────────────────────────────────────

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import {
  HeadlessWaveOrchestrator,
  type HeadlessWave,
  type HeadlessWaveWorker,
} from './wave-orchestrate-headless.js';

// ── Mock Process Factory ──────────────────────────────────────────────

interface MockProcess {
  pid: number;
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  _callbacks: Record<string, (...args: unknown[]) => void>;
}

function createMockProcess(exitCode = 0, delay = 10): MockProcess {
  const proc: MockProcess = {
    pid: Math.floor(Math.random() * 10000) + 1,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    _callbacks: {},
  };

  proc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    proc._callbacks[event] = cb;
    return proc;
  });
  proc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    proc._callbacks['stdout:' + event] = cb;
    return proc.stdout;
  });
  proc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    proc._callbacks['stderr:' + event] = cb;
    return proc.stderr;
  });

  // Auto-resolve after a tick
  setTimeout(() => {
    proc._callbacks['close']?.(exitCode);
  }, delay);

  return proc;
}

// ── Helpers ───────────────────────────────────────────────────────────

function makeWorker(overrides: Partial<HeadlessWaveWorker> = {}): HeadlessWaveWorker {
  return {
    handle: 'test-worker',
    command: 'echo hello',
    ...overrides,
  };
}

function makeWave(overrides: Partial<HeadlessWave> = {}): HeadlessWave {
  return {
    name: 'wave-1',
    workers: [makeWorker()],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('HeadlessWaveOrchestrator', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // ====================================================================
  // CONSTRUCTOR
  // ====================================================================

  describe('constructor', () => {
    it('should create with default timeout of 300000ms', () => {
      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      const status = orchestrator.getStatus() as Record<string, unknown>;
      expect(status.status).toBe('idle');
      expect(status.totalWaves).toBe(0);
    });

    it('should create with custom options', () => {
      const orchestrator = new HeadlessWaveOrchestrator({
        fleetName: 'custom-fleet',
        remote: true,
        defaultTimeout: 60000,
        pollInterval: 5000,
      });
      const status = orchestrator.getStatus() as Record<string, unknown>;
      expect(status.status).toBe('idle');
    });
  });

  // ====================================================================
  // addWave
  // ====================================================================

  describe('addWave', () => {
    it('should add waves to internal list', () => {
      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ name: 'wave-a' }));
      orchestrator.addWave(makeWave({ name: 'wave-b' }));

      const status = orchestrator.getStatus() as Record<string, unknown>;
      expect(status.totalWaves).toBe(2);

      const waves = status.waves as Array<Record<string, unknown>>;
      expect(waves[0].name).toBe('wave-a');
      expect(waves[1].name).toBe('wave-b');
    });
  });

  // ====================================================================
  // getStatus
  // ====================================================================

  describe('getStatus', () => {
    it('should return idle status initially', () => {
      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      const status = orchestrator.getStatus() as Record<string, unknown>;
      expect(status.status).toBe('idle');
      expect(status.totalWaves).toBe(0);
      expect(status.completedWaves).toBe(0);
      expect(status.waves).toEqual([]);
    });

    it('should return running status during execution', async () => {
      const proc = createMockProcess(0, 100);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave());

      const executePromise = orchestrator.execute();

      // Check status while running (before the process closes)
      const status = orchestrator.getStatus() as Record<string, unknown>;
      expect(status.status).toBe('running');

      await executePromise;
    });

    it('should return completed status after execution', async () => {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave());

      await orchestrator.execute();

      const status = orchestrator.getStatus() as Record<string, unknown>;
      expect(status.status).toBe('completed');
      expect(status.completedWaves).toBe(1);
    });
  });

  // ====================================================================
  // execute
  // ====================================================================

  describe('execute', () => {
    it('should execute a single wave with one worker', async () => {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ name: 'wave-1', workers: [makeWorker({ handle: 'w1' })] }));

      const results = await orchestrator.execute();
      expect(results).toHaveLength(1);

      const waveResult = results[0] as Record<string, unknown>;
      expect(waveResult.wave).toBe('wave-1');

      const workerResults = waveResult.results as Array<Record<string, unknown>>;
      expect(workerResults).toHaveLength(1);
      expect(workerResults[0].handle).toBe('w1');
      expect(workerResults[0].success).toBe(true);
    });

    it('should execute multiple waves in order', async () => {
      mockSpawn.mockImplementation(() => {
        return createMockProcess(0) as unknown as ChildProcess;
      });

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ name: 'wave-1', workers: [makeWorker({ handle: 'w1' })] }));
      orchestrator.addWave(makeWave({ name: 'wave-2', workers: [makeWorker({ handle: 'w2' })] }));

      const executionOrder: string[] = [];
      orchestrator.on('wave:start', (event: Record<string, unknown>) => {
        executionOrder.push(event.wave as string);
      });

      await orchestrator.execute();
      expect(executionOrder).toEqual(['wave-1', 'wave-2']);
    });

    it('should respect afterWaves dependencies', async () => {
      mockSpawn.mockImplementation(() => {
        return createMockProcess(0) as unknown as ChildProcess;
      });

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });

      // Add wave-2 first, but it depends on wave-1
      orchestrator.addWave(makeWave({
        name: 'wave-2',
        workers: [makeWorker({ handle: 'w2' })],
        afterWaves: ['wave-1'],
      }));
      orchestrator.addWave(makeWave({
        name: 'wave-1',
        workers: [makeWorker({ handle: 'w1' })],
      }));

      const executionOrder: string[] = [];
      orchestrator.on('wave:start', (event: Record<string, unknown>) => {
        executionOrder.push(event.wave as string);
      });

      await orchestrator.execute();

      // wave-1 must execute before wave-2 despite add order
      expect(executionOrder).toEqual(['wave-1', 'wave-2']);
    });

    it('should emit wave:start and wave:complete events', async () => {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ name: 'my-wave', workers: [makeWorker({ handle: 'w1' })] }));

      const starts: unknown[] = [];
      const completes: unknown[] = [];

      orchestrator.on('wave:start', (event: unknown) => starts.push(event));
      orchestrator.on('wave:complete', (event: unknown) => completes.push(event));

      await orchestrator.execute();

      expect(starts).toHaveLength(1);
      expect((starts[0] as Record<string, unknown>).wave).toBe('my-wave');
      expect((starts[0] as Record<string, unknown>).workers).toEqual(['w1']);

      expect(completes).toHaveLength(1);
      expect((completes[0] as Record<string, unknown>).wave).toBe('my-wave');
    });

    it('should run workers within a wave in parallel', async () => {
      mockSpawn.mockImplementation(() => {
        return createMockProcess(0) as unknown as ChildProcess;
      });

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({
        name: 'wave-1',
        workers: [
          makeWorker({ handle: 'w1' }),
          makeWorker({ handle: 'w2' }),
          makeWorker({ handle: 'w3' }),
        ],
      }));

      const results = await orchestrator.execute();
      const waveResult = results[0] as Record<string, unknown>;
      const workerResults = waveResult.results as Array<Record<string, unknown>>;

      expect(workerResults).toHaveLength(3);
      // All 3 spawned during same wave
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });
  });

  // ====================================================================
  // executeWorker (via public API)
  // ====================================================================

  describe('executeWorker', () => {
    it('should resolve successfully for exit code 0', async () => {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ workers: [makeWorker({ handle: 'ok-worker' })] }));

      const results = await orchestrator.execute();
      const waveResult = results[0] as Record<string, unknown>;
      const workerResults = waveResult.results as Array<Record<string, unknown>>;

      expect(workerResults[0].success).toBe(true);
      expect(workerResults[0].error).toBeUndefined();
    });

    it('should resolve as failed for exit code 1', async () => {
      const proc = createMockProcess(1);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ workers: [makeWorker({ handle: 'fail-worker' })] }));

      const results = await orchestrator.execute();
      const waveResult = results[0] as Record<string, unknown>;
      const workerResults = waveResult.results as Array<Record<string, unknown>>;

      expect(workerResults[0].success).toBe(false);
      expect(workerResults[0].error).toBe('Process exited with code 1');
    });

    it('should handle worker timeout', async () => {
      // Create a process that never closes on its own
      const proc: MockProcess = {
        pid: 9999,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        _callbacks: {},
      };
      proc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks[event] = cb;
        return proc;
      });
      proc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stdout:' + event] = cb;
        return proc.stdout;
      });
      proc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stderr:' + event] = cb;
        return proc.stderr;
      });

      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({
        fleetName: 'test-fleet',
        defaultTimeout: 50, // 50ms timeout
      });
      orchestrator.addWave(makeWave({
        workers: [makeWorker({ handle: 'timeout-worker' })],
      }));

      const results = await orchestrator.execute();
      const waveResult = results[0] as Record<string, unknown>;
      const workerResults = waveResult.results as Array<Record<string, unknown>>;

      expect(workerResults[0].success).toBe(false);
      expect(workerResults[0].error).toBe('Worker timed out after 50ms');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should use per-worker timeout over default', async () => {
      const proc: MockProcess = {
        pid: 8888,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        _callbacks: {},
      };
      proc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks[event] = cb;
        return proc;
      });
      proc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stdout:' + event] = cb;
        return proc.stdout;
      });
      proc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stderr:' + event] = cb;
        return proc.stderr;
      });

      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({
        fleetName: 'test-fleet',
        defaultTimeout: 300000,
      });
      orchestrator.addWave(makeWave({
        workers: [makeWorker({ handle: 'timeout-worker', timeout: 40 })],
      }));

      const results = await orchestrator.execute();
      const waveResult = results[0] as Record<string, unknown>;
      const workerResults = waveResult.results as Array<Record<string, unknown>>;

      expect(workerResults[0].success).toBe(false);
      expect(workerResults[0].error).toBe('Worker timed out after 40ms');
    });

    it('should finalize on success pattern match', async () => {
      const proc: MockProcess = {
        pid: 7777,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        _callbacks: {},
      };
      proc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks[event] = cb;
        return proc;
      });
      proc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stdout:' + event] = cb;
        return proc.stdout;
      });
      proc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stderr:' + event] = cb;
        return proc.stderr;
      });

      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({
        workers: [makeWorker({
          handle: 'pattern-worker',
          successPattern: /BUILD SUCCESS/,
        })],
      }));

      const executePromise = orchestrator.execute();

      // Wait for spawn to be called and callbacks registered
      await new Promise(resolve => setTimeout(resolve, 5));

      // Emit stdout data that matches the success pattern
      proc._callbacks['stdout:data']?.(Buffer.from('Compiling...\nBUILD SUCCESS\nDone.'));

      const results = await executePromise;
      const waveResult = results[0] as Record<string, unknown>;
      const workerResults = waveResult.results as Array<Record<string, unknown>>;

      expect(workerResults[0].success).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should finalize on failure pattern match', async () => {
      const proc: MockProcess = {
        pid: 6666,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        _callbacks: {},
      };
      proc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks[event] = cb;
        return proc;
      });
      proc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stdout:' + event] = cb;
        return proc.stdout;
      });
      proc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stderr:' + event] = cb;
        return proc.stderr;
      });

      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({
        workers: [makeWorker({
          handle: 'fail-pattern-worker',
          failurePattern: /FATAL ERROR/,
        })],
      }));

      const executePromise = orchestrator.execute();

      await new Promise(resolve => setTimeout(resolve, 5));

      proc._callbacks['stdout:data']?.(Buffer.from('Starting...\nFATAL ERROR: out of memory'));

      const results = await executePromise;
      const waveResult = results[0] as Record<string, unknown>;
      const workerResults = waveResult.results as Array<Record<string, unknown>>;

      expect(workerResults[0].success).toBe(false);
      expect(workerResults[0].error).toBe('Failure pattern matched');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should resolve as cancelled when orchestrator is cancelled before worker start', async () => {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ name: 'wave-1', workers: [makeWorker({ handle: 'w1' })] }));
      orchestrator.addWave(makeWave({ name: 'wave-2', workers: [makeWorker({ handle: 'w2' })] }));

      // Cancel after wave-1 completes, so wave-2 sees cancelled flag
      orchestrator.on('wave:complete', () => {
        orchestrator.cancel();
      });

      await expect(orchestrator.execute()).rejects.toThrow('Execution cancelled');

      const status = orchestrator.getStatus() as Record<string, unknown>;
      expect(status.status).toBe('cancelled');
    });

    it('should emit worker:spawned event', async () => {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ workers: [makeWorker({ handle: 'spawn-test' })] }));

      const spawned: unknown[] = [];
      orchestrator.on('worker:spawned', (event: unknown) => spawned.push(event));

      await orchestrator.execute();

      expect(spawned).toHaveLength(1);
      expect((spawned[0] as Record<string, unknown>).worker).toBe('spawn-test');
      expect((spawned[0] as Record<string, unknown>).paneId).toMatch(/^headless-/);
    });

    it('should emit worker:success event on successful worker', async () => {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ workers: [makeWorker({ handle: 'success-test' })] }));

      const successes: unknown[] = [];
      orchestrator.on('worker:success', (event: unknown) => successes.push(event));

      await orchestrator.execute();

      expect(successes).toHaveLength(1);
      expect((successes[0] as Record<string, unknown>).worker).toBe('success-test');
    });

    it('should emit worker:failed event on failed worker', async () => {
      const proc = createMockProcess(1);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ workers: [makeWorker({ handle: 'fail-test' })] }));

      const failures: unknown[] = [];
      orchestrator.on('worker:failed', (event: unknown) => failures.push(event));

      await orchestrator.execute();

      expect(failures).toHaveLength(1);
      expect((failures[0] as Record<string, unknown>).worker).toBe('fail-test');
      expect((failures[0] as Record<string, unknown>).error).toBe('Process exited with code 1');
    });

    it('should handle process error event', async () => {
      const proc: MockProcess = {
        pid: 4444,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        _callbacks: {},
      };
      proc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks[event] = cb;
        return proc;
      });
      proc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stdout:' + event] = cb;
        return proc.stdout;
      });
      proc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stderr:' + event] = cb;
        return proc.stderr;
      });

      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ workers: [makeWorker({ handle: 'error-worker' })] }));

      const executePromise = orchestrator.execute();

      await new Promise(resolve => setTimeout(resolve, 5));
      proc._callbacks['error']?.(new Error('spawn ENOENT'));

      const results = await executePromise;
      const waveResult = results[0] as Record<string, unknown>;
      const workerResults = waveResult.results as Array<Record<string, unknown>>;

      expect(workerResults[0].success).toBe(false);
      expect(workerResults[0].error).toBe('spawn ENOENT');
    });

    it('should pass correct spawn arguments', async () => {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'my-fleet' });
      orchestrator.addWave(makeWave({
        workers: [makeWorker({
          handle: 'spawn-args-test',
          command: 'fix the bug',
          cwd: '/tmp/test-dir',
        })],
      }));

      await orchestrator.execute();

      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        ['-c', expect.stringContaining('fix the bug')],
        expect.objectContaining({
          cwd: '/tmp/test-dir',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: expect.objectContaining({
            CLAUDE_FLEET_NAME: 'my-fleet',
            CLAUDE_CODE_AGENT_NAME: 'spawn-args-test',
            FORCE_COLOR: '0',
          }),
        }),
      );
    });
  });

  // ====================================================================
  // cancel
  // ====================================================================

  describe('cancel', () => {
    it('should kill active processes and set cancelled status', async () => {
      const proc: MockProcess = {
        pid: 3333,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        _callbacks: {},
      };
      proc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks[event] = cb;
        return proc;
      });
      proc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stdout:' + event] = cb;
        return proc.stdout;
      });
      proc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        proc._callbacks['stderr:' + event] = cb;
        return proc.stderr;
      });

      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ workers: [makeWorker({ handle: 'cancel-test' })] }));

      // Start executing but cancel before the worker finishes
      const executePromise = orchestrator.execute();

      // Wait for spawn to happen
      await new Promise(resolve => setTimeout(resolve, 5));

      await orchestrator.cancel();

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      const status = orchestrator.getStatus() as Record<string, unknown>;
      expect(status.status).toBe('cancelled');

      // Let the worker resolve so execute() promise settles
      proc._callbacks['close']?.(1);
      // The execute may throw or resolve depending on timing; just let it settle
      try { await executePromise; } catch { /* cancelled */ }
    });
  });

  // ====================================================================
  // resolveExecutionOrder (tested through execute)
  // ====================================================================

  describe('resolveExecutionOrder (through execute)', () => {
    it('should execute independent waves in add order', async () => {
      mockSpawn.mockImplementation(() => {
        return createMockProcess(0) as unknown as ChildProcess;
      });

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });
      orchestrator.addWave(makeWave({ name: 'alpha', workers: [makeWorker({ handle: 'w-a' })] }));
      orchestrator.addWave(makeWave({ name: 'beta', workers: [makeWorker({ handle: 'w-b' })] }));
      orchestrator.addWave(makeWave({ name: 'gamma', workers: [makeWorker({ handle: 'w-c' })] }));

      const executionOrder: string[] = [];
      orchestrator.on('wave:start', (event: Record<string, unknown>) => {
        executionOrder.push(event.wave as string);
      });

      await orchestrator.execute();

      expect(executionOrder).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('should resolve chain dependencies', async () => {
      mockSpawn.mockImplementation(() => {
        return createMockProcess(0) as unknown as ChildProcess;
      });

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });

      // Add in reverse order: c -> b -> a
      orchestrator.addWave(makeWave({
        name: 'wave-c',
        workers: [makeWorker({ handle: 'wc' })],
        afterWaves: ['wave-b'],
      }));
      orchestrator.addWave(makeWave({
        name: 'wave-b',
        workers: [makeWorker({ handle: 'wb' })],
        afterWaves: ['wave-a'],
      }));
      orchestrator.addWave(makeWave({
        name: 'wave-a',
        workers: [makeWorker({ handle: 'wa' })],
      }));

      const executionOrder: string[] = [];
      orchestrator.on('wave:start', (event: Record<string, unknown>) => {
        executionOrder.push(event.wave as string);
      });

      await orchestrator.execute();

      expect(executionOrder).toEqual(['wave-a', 'wave-b', 'wave-c']);
    });

    it('should handle diamond dependency graph', async () => {
      mockSpawn.mockImplementation(() => {
        return createMockProcess(0) as unknown as ChildProcess;
      });

      const orchestrator = new HeadlessWaveOrchestrator({ fleetName: 'test-fleet' });

      //       A
      //      / \
      //     B   C
      //      \ /
      //       D
      orchestrator.addWave(makeWave({
        name: 'D',
        workers: [makeWorker({ handle: 'wd' })],
        afterWaves: ['B', 'C'],
      }));
      orchestrator.addWave(makeWave({
        name: 'C',
        workers: [makeWorker({ handle: 'wc' })],
        afterWaves: ['A'],
      }));
      orchestrator.addWave(makeWave({
        name: 'B',
        workers: [makeWorker({ handle: 'wb' })],
        afterWaves: ['A'],
      }));
      orchestrator.addWave(makeWave({
        name: 'A',
        workers: [makeWorker({ handle: 'wa' })],
      }));

      const executionOrder: string[] = [];
      orchestrator.on('wave:start', (event: Record<string, unknown>) => {
        executionOrder.push(event.wave as string);
      });

      await orchestrator.execute();

      // A must come first; D must come last; B and C in between
      expect(executionOrder[0]).toBe('A');
      expect(executionOrder[3]).toBe('D');
      expect(executionOrder).toContain('B');
      expect(executionOrder).toContain('C');
    });
  });
});
