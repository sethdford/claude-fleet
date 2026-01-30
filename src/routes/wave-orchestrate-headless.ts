/**
 * Headless Wave Orchestration
 *
 * Fallback implementation when @claude-fleet/tmux is unavailable.
 * Runs wave workers as headless child_process.spawn Claude processes,
 * providing the same interface as the tmux-based WaveOrchestrator.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ============================================================================
// TYPES
// ============================================================================

export interface HeadlessWaveWorker {
  handle: string;
  command?: string;
  prompt?: string;
  cwd?: string;
  timeout?: number;
  successPattern?: RegExp;
  failurePattern?: RegExp;
}

export interface HeadlessWave {
  name: string;
  workers: HeadlessWaveWorker[];
  afterWaves?: string[];
}

export interface HeadlessWaveOrchestratorOptions {
  fleetName: string;
  remote?: boolean;
  defaultTimeout?: number;
  pollInterval?: number;
}

interface WorkerResult {
  handle: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

interface WaveResult {
  wave: string;
  results: WorkerResult[];
}

// ============================================================================
// HEADLESS WAVE ORCHESTRATOR
// ============================================================================

export class HeadlessWaveOrchestrator extends EventEmitter {
  private waves: HeadlessWave[] = [];
  private readonly fleetName: string;
  private readonly defaultTimeout: number;
  private cancelled = false;
  private activeProcesses: ChildProcess[] = [];
  private completedWaves: string[] = [];
  private status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' = 'idle';

  constructor(options: HeadlessWaveOrchestratorOptions) {
    super();
    this.fleetName = options.fleetName;
    this.defaultTimeout = options.defaultTimeout ?? 300000;
  }

  addWave(wave: HeadlessWave): void {
    this.waves.push(wave);
  }

  async execute(): Promise<unknown[]> {
    this.status = 'running';
    const allResults: WaveResult[] = [];

    // Build execution order respecting afterWaves dependencies
    const executionOrder = this.resolveExecutionOrder();

    for (const wave of executionOrder) {
      if (this.cancelled) {
        this.status = 'cancelled';
        throw new Error('Execution cancelled');
      }

      this.emit('wave:start', {
        wave: wave.name,
        workers: wave.workers.map(w => w.handle),
      });

      const waveResults = await this.executeWave(wave);
      allResults.push({ wave: wave.name, results: waveResults });
      this.completedWaves.push(wave.name);

      this.emit('wave:complete', {
        wave: wave.name,
        results: waveResults,
      });
    }

    this.status = 'completed';
    return allResults;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    for (const proc of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses = [];
    this.status = 'cancelled';
  }

  getStatus(): unknown {
    return {
      status: this.status,
      totalWaves: this.waves.length,
      completedWaves: this.completedWaves.length,
      waves: this.waves.map(w => ({
        name: w.name,
        workerCount: w.workers.length,
        completed: this.completedWaves.includes(w.name),
      })),
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────

  private resolveExecutionOrder(): HeadlessWave[] {
    const ordered: HeadlessWave[] = [];
    const resolved = new Set<string>();
    const waveMap = new Map(this.waves.map(w => [w.name, w]));

    const resolve = (wave: HeadlessWave): void => {
      if (resolved.has(wave.name)) return;

      // Resolve dependencies first
      if (wave.afterWaves) {
        for (const depName of wave.afterWaves) {
          const dep = waveMap.get(depName);
          if (dep && !resolved.has(depName)) {
            resolve(dep);
          }
        }
      }

      resolved.add(wave.name);
      ordered.push(wave);
    };

    for (const wave of this.waves) {
      resolve(wave);
    }

    return ordered;
  }

  private async executeWave(wave: HeadlessWave): Promise<WorkerResult[]> {
    const results = await Promise.all(
      wave.workers.map(worker => this.executeWorker(worker))
    );
    return results;
  }

  private async executeWorker(worker: HeadlessWaveWorker): Promise<WorkerResult> {
    const startTime = Date.now();
    const timeout = worker.timeout ?? this.defaultTimeout;

    return new Promise<WorkerResult>((resolve) => {
      if (this.cancelled) {
        resolve({
          handle: worker.handle,
          success: false,
          output: '',
          error: 'Execution cancelled',
          durationMs: 0,
        });
        return;
      }

      let output = '';
      let resolved = false;

      const finalize = (success: boolean, error?: string): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        const idx = this.activeProcesses.indexOf(proc);
        if (idx >= 0) this.activeProcesses.splice(idx, 1);

        const result: WorkerResult = {
          handle: worker.handle,
          success,
          output,
          error,
          durationMs: Date.now() - startTime,
        };

        if (success) {
          this.emit('worker:success', { worker: worker.handle });
        } else {
          this.emit('worker:failed', { worker: worker.handle, error: error ?? 'Unknown error' });
        }

        resolve(result);
      };

      // Build Claude args
      const claudeArgs = [
        '--print',
        '--output-format', 'text',
        '--dangerously-skip-permissions',
      ];

      const prompt = worker.prompt ?? worker.command ?? `Execute task for ${worker.handle}`;
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      const shellCmd = `echo '${escapedPrompt}' | claude ${claudeArgs.join(' ')}`;

      const proc = spawn('sh', ['-c', shellCmd], {
        cwd: worker.cwd ?? process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          CLAUDE_FLEET_NAME: this.fleetName,
          CLAUDE_CODE_AGENT_NAME: worker.handle,
        },
      });

      this.activeProcesses.push(proc);
      this.emit('worker:spawned', { worker: worker.handle, paneId: `headless-${proc.pid}` });

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;

        // Check success/failure patterns
        if (worker.successPattern?.test(output)) {
          proc.kill('SIGTERM');
          finalize(true);
        }
        if (worker.failurePattern?.test(output)) {
          proc.kill('SIGTERM');
          finalize(false, 'Failure pattern matched');
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        finalize(code === 0, code !== 0 ? `Process exited with code ${code}` : undefined);
      });

      proc.on('error', (err) => {
        finalize(false, err.message);
      });

      // Timeout
      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        finalize(false, `Worker timed out after ${timeout}ms`);
      }, timeout);
    });
  }
}
