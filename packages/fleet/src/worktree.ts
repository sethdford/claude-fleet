/**
 * Git Worktree Manager
 *
 * Manages git worktrees for worker isolation.
 */

import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit?: string;
}

export class WorktreeManager {
  private basePath: string;
  private repoPath: string;

  constructor(repoPath: string, basePath?: string) {
    this.repoPath = resolve(repoPath);
    this.basePath = basePath || join(homedir(), '.cct', 'worktrees');

    // Ensure base path exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Create a new worktree for a worker
   */
  async create(workerId: string, branch?: string): Promise<WorktreeInfo> {
    const worktreePath = join(this.basePath, workerId);
    const branchName = branch || `worker/${workerId}`;

    // Create branch if it doesn't exist
    const branchExists = await this.branchExists(branchName);
    if (!branchExists) {
      await this.exec(['branch', branchName], this.repoPath);
    }

    // Create worktree
    await this.exec(
      ['worktree', 'add', worktreePath, branchName],
      this.repoPath
    );

    return {
      path: worktreePath,
      branch: branchName,
      commit: await this.getCurrentCommit(worktreePath),
    };
  }

  /**
   * Remove a worktree
   */
  async remove(workerId: string): Promise<void> {
    const worktreePath = join(this.basePath, workerId);

    if (!existsSync(worktreePath)) {
      return;
    }

    // Remove worktree from git
    await this.exec(['worktree', 'remove', worktreePath, '--force'], this.repoPath);

    // Clean up directory if it still exists
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  /**
   * List all worktrees
   */
  async list(): Promise<WorktreeInfo[]> {
    const output = await this.exec(['worktree', 'list', '--porcelain'], this.repoPath);
    const worktrees: WorktreeInfo[] = [];

    let current: Partial<WorktreeInfo> = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        current.path = line.slice(9);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line.startsWith('HEAD ')) {
        current.commit = line.slice(5);
      } else if (line === '') {
        if (current.path && current.branch) {
          worktrees.push(current as WorktreeInfo);
        }
        current = {};
      }
    }

    return worktrees;
  }

  /**
   * Commit changes in a worktree
   */
  async commit(workerId: string, message: string): Promise<string> {
    const worktreePath = join(this.basePath, workerId);

    // Stage all changes
    await this.exec(['add', '-A'], worktreePath);

    // Check if there are changes to commit
    const status = await this.exec(['status', '--porcelain'], worktreePath);
    if (!status.trim()) {
      throw new Error('No changes to commit');
    }

    // Commit
    await this.exec(['commit', '-m', message], worktreePath);

    return this.getCurrentCommit(worktreePath);
  }

  /**
   * Push worktree branch to remote
   */
  async push(workerId: string, remote: string = 'origin'): Promise<void> {
    const worktreePath = join(this.basePath, workerId);
    const branch = await this.getCurrentBranch(worktreePath);

    await this.exec(['push', '-u', remote, branch], worktreePath);
  }

  /**
   * Create a pull request for a worktree
   */
  async createPR(
    workerId: string,
    title: string,
    body: string,
    baseBranch: string = 'main'
  ): Promise<string> {
    const worktreePath = join(this.basePath, workerId);

    // Push first
    await this.push(workerId);

    // Create PR using gh CLI
    const output = await this.exec(
      [
        'pr', 'create',
        '--title', title,
        '--body', body,
        '--base', baseBranch,
      ],
      worktreePath,
      'gh'
    );

    return output.trim();
  }

  /**
   * Sync worktree with main branch
   */
  async sync(workerId: string, baseBranch: string = 'main'): Promise<void> {
    const worktreePath = join(this.basePath, workerId);

    // Fetch latest
    await this.exec(['fetch', 'origin', baseBranch], worktreePath);

    // Rebase on base branch
    await this.exec(['rebase', `origin/${baseBranch}`], worktreePath);
  }

  /**
   * Get current commit hash
   */
  private async getCurrentCommit(worktreePath: string): Promise<string> {
    const output = await this.exec(['rev-parse', 'HEAD'], worktreePath);
    return output.trim();
  }

  /**
   * Get current branch name
   */
  private async getCurrentBranch(worktreePath: string): Promise<string> {
    const output = await this.exec(['branch', '--show-current'], worktreePath);
    return output.trim();
  }

  /**
   * Check if a branch exists
   */
  private async branchExists(branch: string): Promise<boolean> {
    try {
      await this.exec(['rev-parse', '--verify', branch], this.repoPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a git command
   */
  private exec(args: string[], cwd: string, cmd: string = 'git'): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd,
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || stdout}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Prune worktrees that no longer exist
   */
  async prune(): Promise<void> {
    await this.exec(['worktree', 'prune'], this.repoPath);
  }

  /**
   * Check if a worktree exists
   */
  exists(workerId: string): boolean {
    const worktreePath = join(this.basePath, workerId);
    return existsSync(worktreePath);
  }

  /**
   * Get the path for a worker's worktree
   */
  getPath(workerId: string): string {
    return join(this.basePath, workerId);
  }
}
