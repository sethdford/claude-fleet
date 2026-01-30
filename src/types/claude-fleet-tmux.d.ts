/**
 * Ambient type declarations for @claude-fleet/tmux
 *
 * This workspace package provides tmux-based worker spawning, wave orchestration,
 * multi-repo operations, and context management. It may not be installed in all
 * environments (e.g., npm-only installs), so these declarations decouple the
 * TypeScript build from the package's physical presence.
 */

declare module '@claude-fleet/tmux' {
  import type { EventEmitter } from 'node:events';

  // ── Wave Orchestration ──────────────────────────────────────────────

  export interface WaveWorker {
    handle: string;
    command?: string;
    prompt?: string;
    cwd?: string;
    timeout?: number;
    successPattern?: RegExp;
    failurePattern?: RegExp;
  }

  export interface Wave {
    name: string;
    workers: WaveWorker[];
    afterWaves?: string[];
  }

  export interface WaveOrchestratorOptions {
    fleetName: string;
    remote?: boolean;
    defaultTimeout?: number;
    pollInterval?: number;
  }

  export class WaveOrchestrator extends EventEmitter {
    constructor(options: WaveOrchestratorOptions);
    addWave(wave: Wave): void;
    execute(): Promise<unknown[]>;
    cancel(): Promise<void>;
    getStatus(): unknown;
  }

  // ── Multi-Repo Orchestration ────────────────────────────────────────

  export interface Repository {
    name: string;
    path: string;
    remoteUrl?: string;
    defaultBranch?: string;
    tags?: string[];
  }

  export interface MultiRepoTask {
    name: string;
    prompt: string;
    repoTags?: string[];
    repos?: string[];
    createBranch?: boolean;
    branchPattern?: string;
    autoCommit?: boolean;
    commitPattern?: string;
    createPR?: boolean;
    prTitlePattern?: string;
    prBodyPattern?: string;
    timeout?: number;
    successPattern?: RegExp;
  }

  export interface MultiRepoOrchestratorOptions {
    fleetName: string;
    repositories: Repository[];
    baseDir?: string;
    maxParallel?: number;
    remote?: boolean;
  }

  export class MultiRepoOrchestrator extends EventEmitter {
    constructor(options: MultiRepoOrchestratorOptions);
    executeTask(task: MultiRepoTask): Promise<unknown[]>;
    updateDependencies(options: {
      repos?: string[];
      repoTags?: string[];
      createPR?: boolean;
      packageManager?: 'npm' | 'yarn' | 'pnpm';
    }): Promise<unknown[]>;
    runSecurityAudit(options: {
      repos?: string[];
      repoTags?: string[];
      fix?: boolean;
      createPR?: boolean;
    }): Promise<unknown[]>;
    formatCode(options: {
      repos?: string[];
      repoTags?: string[];
      createPR?: boolean;
    }): Promise<unknown[]>;
    runTests(options: {
      repos?: string[];
      repoTags?: string[];
    }): Promise<unknown[]>;
    getStatus(): unknown;
  }

  // ── Tmux Worker Adapter ─────────────────────────────────────────────

  export class TmuxWorkerAdapter extends EventEmitter {
    constructor();
    isAvailable(): boolean;
    spawnWorker(options: {
      handle: string;
      teamName: string;
      workingDir: string;
      initialPrompt?: string;
      role: string;
      model?: string;
    }): Promise<{ id: string; paneId: string }>;
    sendToWorker(handle: string, message: string): Promise<boolean>;
    deliverTask(handle: string, task: {
      id: string;
      title: string;
      description?: string;
    }): Promise<boolean>;
  }

  // ── Context Manager ─────────────────────────────────────────────────

  export interface ContextMetrics {
    usageRatio: number;
    estimatedTokens: number;
  }

  export interface ContextSummary {
    summary: string;
  }

  export interface RolloverResult {
    paneId: string;
    summary: string;
  }

  export class ContextManager {
    constructor();
    needsTrim(paneId: string, threshold: number): boolean;
    analyzeContext(paneId: string): ContextMetrics;
    generateContinueSummary(paneId: string): ContextSummary;
    rolloverToNewPane(
      paneId: string,
      options: { initialPrompt: string }
    ): Promise<RolloverResult>;
  }
}
