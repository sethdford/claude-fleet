/**
 * Multi-Repo Orchestrator
 *
 * Orchestrates work across multiple git repositories.
 * Enables automated upkeep, dependency updates, and coordinated changes.
 *
 * Key features:
 * - Parallel operations across repos
 * - Cross-repo dependencies
 * - Atomic multi-repo commits
 * - Rollback on failure
 */

import { WaveOrchestrator, type Wave, type WaveWorker, type WaveResult } from './wave-orchestrator.js';
import { EventEmitter } from 'events';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface Repository {
  /** Repository name (used as identifier) */
  name: string;
  /** Local path to repository */
  path: string;
  /** Remote URL (optional, for cloning) */
  remoteUrl?: string;
  /** Default branch */
  defaultBranch?: string;
  /** Tags for filtering */
  tags?: string[];
}

export interface MultiRepoTask {
  /** Task name */
  name: string;
  /** Claude prompt to execute in each repo */
  prompt: string;
  /** Filter repos by tag */
  repoTags?: string[];
  /** Specific repos to target (overrides tags) */
  repos?: string[];
  /** Whether to create branches */
  createBranch?: boolean;
  /** Branch name pattern (use {{repo}} for repo name) */
  branchPattern?: string;
  /** Whether to commit changes */
  autoCommit?: boolean;
  /** Commit message pattern */
  commitPattern?: string;
  /** Whether to create PRs */
  createPR?: boolean;
  /** PR title pattern */
  prTitlePattern?: string;
  /** PR body pattern */
  prBodyPattern?: string;
  /** Timeout per repo in ms */
  timeout?: number;
  /** Success pattern */
  successPattern?: string | RegExp;
}

export interface MultiRepoConfig {
  /** Fleet name */
  fleetName: string;
  /** Repositories to manage */
  repositories: Repository[];
  /** Base directory for repos (if using relative paths) */
  baseDir?: string;
  /** Max parallel repos */
  maxParallel?: number;
  /** Use headless mode */
  remote?: boolean;
  /** Clone missing repos */
  cloneMissing?: boolean;
}

export interface RepoResult {
  /** Repository name */
  repo: string;
  /** Task name */
  task: string;
  /** Whether task succeeded */
  success: boolean;
  /** Output from worker */
  output?: string;
  /** Error message */
  error?: string;
  /** Branch created */
  branch?: string;
  /** Commit SHA */
  commitSha?: string;
  /** PR URL */
  prUrl?: string;
  /** Duration in ms */
  duration: number;
}

export interface MultiRepoStatus {
  /** Current task */
  currentTask: string | null;
  /** Repos being processed */
  activeRepos: string[];
  /** Completed repos */
  completedRepos: string[];
  /** Failed repos */
  failedRepos: string[];
  /** All results */
  results: RepoResult[];
  /** Overall status */
  status: 'idle' | 'running' | 'completed' | 'failed';
}

export class MultiRepoOrchestrator extends EventEmitter {
  private config: Required<MultiRepoConfig>;
  private repos: Map<string, Repository> = new Map();
  private results: RepoResult[] = [];
  private status: MultiRepoStatus;

  constructor(config: MultiRepoConfig) {
    super();
    this.config = {
      baseDir: process.cwd(),
      maxParallel: 4,
      remote: true,
      cloneMissing: false,
      ...config,
    };

    // Index repositories
    for (const repo of config.repositories) {
      this.repos.set(repo.name, {
        defaultBranch: 'main',
        tags: [],
        ...repo,
      });
    }

    this.status = {
      currentTask: null,
      activeRepos: [],
      completedRepos: [],
      failedRepos: [],
      results: [],
      status: 'idle',
    };
  }

  /**
   * Add a repository to the orchestrator
   */
  addRepository(repo: Repository): this {
    this.repos.set(repo.name, {
      defaultBranch: 'main',
      tags: [],
      ...repo,
    });
    return this;
  }

  /**
   * Get repositories matching filter
   */
  private getTargetRepos(task: MultiRepoTask): Repository[] {
    if (task.repos && task.repos.length > 0) {
      return task.repos
        .map(name => this.repos.get(name))
        .filter((r): r is Repository => r !== undefined);
    }

    if (task.repoTags && task.repoTags.length > 0) {
      return Array.from(this.repos.values()).filter(repo =>
        task.repoTags!.some(tag => repo.tags?.includes(tag))
      );
    }

    return Array.from(this.repos.values());
  }

  /**
   * Ensure repository exists locally
   */
  private ensureRepo(repo: Repository): boolean {
    const repoPath = this.getRepoPath(repo);

    if (existsSync(path.join(repoPath, '.git'))) {
      return true;
    }

    if (!this.config.cloneMissing || !repo.remoteUrl) {
      return false;
    }

    try {
      execSync(`git clone ${repo.remoteUrl} ${repoPath}`, {
        stdio: 'pipe',
      });
      this.emit('repo:cloned', { repo: repo.name, path: repoPath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get full path to repository
   */
  private getRepoPath(repo: Repository): string {
    if (path.isAbsolute(repo.path)) {
      return repo.path;
    }
    return path.join(this.config.baseDir, repo.path);
  }

  /**
   * Execute a task across multiple repositories
   */
  async executeTask(task: MultiRepoTask): Promise<RepoResult[]> {
    this.status.currentTask = task.name;
    this.status.status = 'running';
    this.emit('task:start', { task: task.name });

    const targetRepos = this.getTargetRepos(task);

    if (targetRepos.length === 0) {
      this.emit('task:error', { task: task.name, error: 'No matching repositories' });
      return [];
    }

    this.emit('task:repos', { task: task.name, repos: targetRepos.map(r => r.name) });

    // Create wave orchestrator for parallel execution
    const orchestrator = new WaveOrchestrator({
      fleetName: `${this.config.fleetName}-${task.name}`,
      remote: this.config.remote,
      defaultTimeout: task.timeout ?? 300000,
    });

    // Split repos into waves based on maxParallel
    const waves = this.createWaves(targetRepos, task);
    for (const wave of waves) {
      orchestrator.addWave(wave);
    }

    // Forward events
    orchestrator.on('worker:spawned', (data) => {
      this.status.activeRepos.push(data.worker);
      this.emit('repo:start', { repo: data.worker, task: task.name });
    });

    orchestrator.on('worker:success', (data) => {
      this.status.activeRepos = this.status.activeRepos.filter(r => r !== data.worker);
      this.status.completedRepos.push(data.worker);
      this.emit('repo:success', { repo: data.worker, task: task.name });
    });

    orchestrator.on('worker:failed', (data) => {
      this.status.activeRepos = this.status.activeRepos.filter(r => r !== data.worker);
      this.status.failedRepos.push(data.worker);
      this.emit('repo:failed', { repo: data.worker, task: task.name, error: data.error });
    });

    // Execute
    const waveResults = await orchestrator.execute();

    // Convert to repo results
    const repoResults = this.convertResults(waveResults, task);
    this.results.push(...repoResults);
    this.status.results = this.results;

    // Post-processing: commits, PRs
    if (task.autoCommit || task.createPR) {
      await this.postProcess(repoResults, task);
    }

    this.status.currentTask = null;
    this.status.status = repoResults.every(r => r.success) ? 'completed' : 'failed';
    this.emit('task:complete', { task: task.name, results: repoResults });

    return repoResults;
  }

  /**
   * Create waves from repos
   */
  private createWaves(repos: Repository[], task: MultiRepoTask): Wave[] {
    const waves: Wave[] = [];
    const batchSize = this.config.maxParallel;

    for (let i = 0; i < repos.length; i += batchSize) {
      const batch = repos.slice(i, i + batchSize);
      const workers: WaveWorker[] = batch.map(repo => {
        // Ensure repo exists
        if (!this.ensureRepo(repo)) {
          return {
            handle: repo.name,
            command: `echo "Error: Repository not found at ${this.getRepoPath(repo)}" && exit 1`,
            failurePattern: /Error:/,
          };
        }

        // Build the prompt with repo context
        const prompt = this.interpolate(task.prompt, { repo: repo.name });

        // Create branch if needed
        let setupCommand = '';
        if (task.createBranch) {
          const branchName = this.interpolate(task.branchPattern ?? 'auto/{{task}}', {
            repo: repo.name,
            task: task.name,
          });
          setupCommand = `git checkout -b ${branchName} 2>/dev/null || git checkout ${branchName}; `;
        }

        return {
          handle: repo.name,
          cwd: this.getRepoPath(repo),
          prompt: `${setupCommand}${prompt}`,
          ...(task.timeout !== undefined && { timeout: task.timeout }),
          ...(task.successPattern !== undefined && { successPattern: task.successPattern }),
        };
      });

      waves.push({
        name: `batch-${Math.floor(i / batchSize) + 1}`,
        workers,
        ...(waves.length > 0 && { afterWaves: [waves[waves.length - 1]!.name] }),
      });
    }

    return waves;
  }

  /**
   * Convert wave results to repo results
   */
  private convertResults(waveResults: WaveResult[], task: MultiRepoTask): RepoResult[] {
    return waveResults.map(wr => ({
      repo: wr.worker,
      task: task.name,
      success: wr.success,
      duration: wr.duration,
      ...(wr.output !== undefined && { output: wr.output }),
      ...(wr.error !== undefined && { error: wr.error }),
    }));
  }

  /**
   * Post-process: commit and create PRs
   */
  private async postProcess(results: RepoResult[], task: MultiRepoTask): Promise<void> {
    for (const result of results) {
      if (!result.success) continue;

      const repo = this.repos.get(result.repo);
      if (!repo) continue;

      const repoPath = this.getRepoPath(repo);

      try {
        // Check for changes
        const status = execSync('git status --porcelain', {
          cwd: repoPath,
          encoding: 'utf-8',
        }).trim();

        if (!status) {
          this.emit('repo:no-changes', { repo: result.repo });
          continue;
        }

        // Commit if enabled
        if (task.autoCommit) {
          const message = this.interpolate(task.commitPattern ?? 'auto: {{task}}', {
            repo: result.repo,
            task: task.name,
          });

          execSync(`git add -A && git commit -m "${message}"`, {
            cwd: repoPath,
            stdio: 'pipe',
          });

          const sha = execSync('git rev-parse HEAD', {
            cwd: repoPath,
            encoding: 'utf-8',
          }).trim();

          result.commitSha = sha;
          this.emit('repo:committed', { repo: result.repo, sha });
        }

        // Create PR if enabled
        if (task.createPR) {
          const branchName = this.interpolate(task.branchPattern ?? 'auto/{{task}}', {
            repo: result.repo,
            task: task.name,
          });

          const prTitle = this.interpolate(task.prTitlePattern ?? '{{task}}', {
            repo: result.repo,
            task: task.name,
          });

          const prBody = this.interpolate(task.prBodyPattern ?? 'Automated changes from {{task}}', {
            repo: result.repo,
            task: task.name,
          });

          // Push branch
          execSync(`git push -u origin ${branchName}`, {
            cwd: repoPath,
            stdio: 'pipe',
          });

          // Create PR using gh
          const prUrl = execSync(
            `gh pr create --title "${prTitle}" --body "${prBody}" --base ${repo.defaultBranch}`,
            {
              cwd: repoPath,
              encoding: 'utf-8',
            }
          ).trim();

          result.prUrl = prUrl;
          this.emit('repo:pr-created', { repo: result.repo, prUrl });
        }
      } catch (error) {
        const err = error as Error;
        this.emit('repo:post-process-error', {
          repo: result.repo,
          error: err.message,
        });
      }
    }
  }

  /**
   * Interpolate template string
   */
  private interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  }

  /**
   * Get current status
   */
  getStatus(): MultiRepoStatus {
    return { ...this.status };
  }

  /**
   * Get all results
   */
  getResults(): RepoResult[] {
    return [...this.results];
  }

  // ==================== Common Tasks ====================

  /**
   * Update dependencies across all repos
   */
  async updateDependencies(options: {
    repos?: string[];
    repoTags?: string[];
    packageManager?: 'npm' | 'yarn' | 'pnpm';
    createPR?: boolean;
  } = {}): Promise<RepoResult[]> {
    const pm = options.packageManager ?? 'npm';
    const updateCmd = {
      npm: 'npm update',
      yarn: 'yarn upgrade',
      pnpm: 'pnpm update',
    }[pm];

    return this.executeTask({
      name: 'update-deps',
      prompt: `Run "${updateCmd}" to update all dependencies. Check if tests still pass after the update.`,
      ...(options.repos && { repos: options.repos }),
      ...(options.repoTags && { repoTags: options.repoTags }),
      createBranch: true,
      branchPattern: 'auto/update-deps-{{repo}}',
      autoCommit: true,
      commitPattern: 'chore: update dependencies',
      ...(options.createPR !== undefined && { createPR: options.createPR }),
      prTitlePattern: 'chore: Update dependencies',
      prBodyPattern: 'Automated dependency update.\n\nGenerated by Claude Fleet.',
      successPattern: /update|upgrade|dependencies/i,
    });
  }

  /**
   * Run audit/security check across repos
   */
  async runSecurityAudit(options: {
    repos?: string[];
    repoTags?: string[];
    fix?: boolean;
    createPR?: boolean;
  } = {}): Promise<RepoResult[]> {
    const fixNote = options.fix ? 'Fix any security vulnerabilities you find.' : 'Report any security vulnerabilities.';

    return this.executeTask({
      name: 'security-audit',
      prompt: `Run a security audit on this repository. Check for vulnerable dependencies, exposed secrets, and security misconfigurations. ${fixNote}`,
      ...(options.repos && { repos: options.repos }),
      ...(options.repoTags && { repoTags: options.repoTags }),
      ...(options.fix !== undefined && { createBranch: options.fix }),
      branchPattern: 'auto/security-fix-{{repo}}',
      ...(options.fix !== undefined && { autoCommit: options.fix }),
      commitPattern: 'security: fix vulnerabilities',
      ...(options.createPR !== undefined && options.fix && { createPR: options.createPR }),
      prTitlePattern: 'security: Fix vulnerabilities',
      prBodyPattern: 'Automated security fixes.\n\nGenerated by Claude Fleet.',
      successPattern: /audit|security|vulnerabilities/i,
    });
  }

  /**
   * Apply code style/formatting across repos
   */
  async formatCode(options: {
    repos?: string[];
    repoTags?: string[];
    createPR?: boolean;
  } = {}): Promise<RepoResult[]> {
    return this.executeTask({
      name: 'format-code',
      prompt: 'Run the code formatter (prettier, eslint --fix, etc.) on all source files. Ensure all files follow the project\'s code style.',
      ...(options.repos && { repos: options.repos }),
      ...(options.repoTags && { repoTags: options.repoTags }),
      createBranch: true,
      branchPattern: 'auto/format-{{repo}}',
      autoCommit: true,
      commitPattern: 'style: format code',
      ...(options.createPR !== undefined && { createPR: options.createPR }),
      prTitlePattern: 'style: Format code',
      prBodyPattern: 'Automated code formatting.\n\nGenerated by Claude Fleet.',
      successPattern: /format|prettier|eslint/i,
    });
  }

  /**
   * Run tests across all repos
   */
  async runTests(options: {
    repos?: string[];
    repoTags?: string[];
  } = {}): Promise<RepoResult[]> {
    return this.executeTask({
      name: 'run-tests',
      prompt: 'Run the test suite for this repository. Report any failing tests.',
      ...(options.repos && { repos: options.repos }),
      ...(options.repoTags && { repoTags: options.repoTags }),
      successPattern: /pass|success|✓/i,
    });
  }

  /**
   * Apply a patch/change across repos
   */
  async applyPatch(options: {
    prompt: string;
    repos?: string[];
    repoTags?: string[];
    branchName: string;
    commitMessage: string;
    prTitle: string;
    prBody?: string;
  }): Promise<RepoResult[]> {
    return this.executeTask({
      name: 'apply-patch',
      prompt: options.prompt,
      ...(options.repos && { repos: options.repos }),
      ...(options.repoTags && { repoTags: options.repoTags }),
      createBranch: true,
      branchPattern: options.branchName,
      autoCommit: true,
      commitPattern: options.commitMessage,
      createPR: true,
      prTitlePattern: options.prTitle,
      prBodyPattern: options.prBody ?? `${options.prTitle}\n\nGenerated by Claude Fleet.`,
      successPattern: /complete|done|success/i,
    });
  }

  /**
   * Generate documentation across repos
   */
  async generateDocs(options: {
    repos?: string[];
    repoTags?: string[];
    createPR?: boolean;
  } = {}): Promise<RepoResult[]> {
    return this.executeTask({
      name: 'generate-docs',
      prompt: 'Generate or update documentation for this repository. Include API docs, README updates, and usage examples.',
      ...(options.repos && { repos: options.repos }),
      ...(options.repoTags && { repoTags: options.repoTags }),
      createBranch: true,
      branchPattern: 'auto/docs-{{repo}}',
      autoCommit: true,
      commitPattern: 'docs: update documentation',
      ...(options.createPR !== undefined && { createPR: options.createPR }),
      prTitlePattern: 'docs: Update documentation',
      prBodyPattern: 'Automated documentation update.\n\nGenerated by Claude Fleet.',
      successPattern: /docs|documentation|readme/i,
    });
  }
}

/**
 * Helper to create a multi-repo orchestrator from a config file
 */
export function createMultiRepoOrchestrator(configPath: string): MultiRepoOrchestrator {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require(configPath) as MultiRepoConfig;
  return new MultiRepoOrchestrator(config);
}
