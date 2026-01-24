/**
 * Git Worktree Manager
 *
 * Manages git worktrees for worker isolation. Each worker gets its own
 * worktree so they can work on different branches without conflicts.
 */

import { execSync, exec } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';
import type { WorktreeInfo } from '../types.js';

const execAsync = promisify(exec);

export interface WorktreeManagerOptions {
  /** Base directory for worktrees (default: .worktrees in repo root) */
  baseDir?: string;
  /** Branch prefix for worker branches (default: 'worker/') */
  branchPrefix?: string;
  /** Remote name (default: 'origin') */
  remote?: string;
  /** Default base branch for new worktrees (default: 'main') */
  defaultBaseBranch?: string;
}

export class WorktreeManager {
  private baseDir: string;
  private branchPrefix: string;
  private remote: string;
  private defaultBaseBranch: string;
  private repoRoot: string;

  constructor(options: WorktreeManagerOptions = {}) {
    // Get the git repo root
    this.repoRoot = this.getRepoRoot();
    this.baseDir = options.baseDir ?? join(this.repoRoot, '.worktrees');
    this.branchPrefix = options.branchPrefix ?? 'worker/';
    this.remote = options.remote ?? 'origin';
    this.defaultBaseBranch = options.defaultBaseBranch ?? 'main';

    // Ensure base directory exists
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Get the git repository root directory
   */
  private getRepoRoot(): string {
    try {
      return execSync('git rev-parse --show-toplevel', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // Fall back to current working directory
      return process.cwd();
    }
  }

  /**
   * Generate a branch name for a worker
   */
  private getBranchName(workerId: string): string {
    // Use first 8 chars of worker ID for brevity
    const shortId = workerId.slice(0, 8);
    return `${this.branchPrefix}${shortId}`;
  }

  /**
   * Get the worktree path for a worker
   */
  private getWorktreePath(workerId: string): string {
    const shortId = workerId.slice(0, 8);
    return join(this.baseDir, shortId);
  }

  /**
   * Create a new worktree for a worker
   */
  async create(workerId: string, baseBranch?: string): Promise<WorktreeInfo> {
    const branch = this.getBranchName(workerId);
    const worktreePath = this.getWorktreePath(workerId);
    const base = baseBranch ?? this.defaultBaseBranch;

    // Check if worktree already exists
    if (existsSync(worktreePath)) {
      console.log(`[WORKTREE] Worktree already exists at ${worktreePath}`);
      return {
        workerId,
        path: worktreePath,
        branch,
        createdAt: Date.now(),
      };
    }

    try {
      // Fetch latest from remote
      await execAsync(`git fetch ${this.remote} ${base}`, { cwd: this.repoRoot });

      // Create new branch from remote base
      await execAsync(
        `git worktree add -b ${branch} "${worktreePath}" ${this.remote}/${base}`,
        { cwd: this.repoRoot }
      );

      console.log(`[WORKTREE] Created worktree: ${worktreePath} (branch: ${branch})`);

      return {
        workerId,
        path: worktreePath,
        branch,
        createdAt: Date.now(),
      };
    } catch (error) {
      const err = error as Error & { stderr?: string };
      // If branch already exists, try to add worktree with existing branch
      if (err.stderr?.includes('already exists')) {
        await execAsync(
          `git worktree add "${worktreePath}" ${branch}`,
          { cwd: this.repoRoot }
        );
        return {
          workerId,
          path: worktreePath,
          branch,
          createdAt: Date.now(),
        };
      }
      throw new Error(`Failed to create worktree: ${err.message}`);
    }
  }

  /**
   * Remove a worker's worktree
   */
  async remove(workerId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(workerId);
    const branch = this.getBranchName(workerId);

    try {
      // Remove the worktree
      if (existsSync(worktreePath)) {
        await execAsync(`git worktree remove "${worktreePath}" --force`, {
          cwd: this.repoRoot,
        });
        console.log(`[WORKTREE] Removed worktree: ${worktreePath}`);
      }

      // Delete the branch (optional, may fail if not merged)
      try {
        await execAsync(`git branch -D ${branch}`, { cwd: this.repoRoot });
        console.log(`[WORKTREE] Deleted branch: ${branch}`);
      } catch {
        // Branch may not exist or may have already been deleted
        console.log(`[WORKTREE] Branch ${branch} not deleted (may not exist)`);
      }
    } catch {
      // Try force cleanup if normal removal fails
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
        await execAsync('git worktree prune', { cwd: this.repoRoot });
      }
      console.log(`[WORKTREE] Force cleaned worktree: ${worktreePath}`);
    }
  }

  /**
   * Commit changes in a worker's worktree
   */
  async commit(workerId: string, message: string): Promise<string> {
    const worktreePath = this.getWorktreePath(workerId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree not found: ${worktreePath}`);
    }

    // Check for changes
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: worktreePath,
    });

    if (!status.trim()) {
      throw new Error('No changes to commit');
    }

    // Stage all changes
    await execAsync('git add -A', { cwd: worktreePath });

    // Commit
    await execAsync(
      `git commit -m "${message.replace(/"/g, '\\"')}"`,
      { cwd: worktreePath }
    );

    // Get commit hash
    const { stdout: hash } = await execAsync('git rev-parse HEAD', {
      cwd: worktreePath,
    });

    console.log(`[WORKTREE] Committed in ${basename(worktreePath)}: ${hash.trim().slice(0, 8)}`);

    return hash.trim();
  }

  /**
   * Push changes from a worker's worktree
   */
  async push(workerId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(workerId);
    const branch = this.getBranchName(workerId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree not found: ${worktreePath}`);
    }

    await execAsync(`git push -u ${this.remote} ${branch}`, {
      cwd: worktreePath,
    });

    console.log(`[WORKTREE] Pushed branch ${branch} to ${this.remote}`);
  }

  /**
   * Create a pull request from a worker's branch
   */
  async createPR(
    workerId: string,
    title: string,
    body: string,
    baseBranch?: string
  ): Promise<string> {
    const worktreePath = this.getWorktreePath(workerId);
    const base = baseBranch ?? this.defaultBaseBranch;

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree not found: ${worktreePath}`);
    }

    // Ensure changes are pushed
    await this.push(workerId);

    // Create PR using gh CLI
    const { stdout } = await execAsync(
      `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${base}`,
      { cwd: worktreePath }
    );

    const prUrl = stdout.trim();
    console.log(`[WORKTREE] Created PR: ${prUrl}`);

    return prUrl;
  }

  /**
   * Get the status of a worker's worktree
   */
  async getStatus(workerId: string): Promise<{
    exists: boolean;
    branch: string;
    hasChanges: boolean;
    aheadBehind: { ahead: number; behind: number };
  }> {
    const worktreePath = this.getWorktreePath(workerId);
    const branch = this.getBranchName(workerId);

    if (!existsSync(worktreePath)) {
      return {
        exists: false,
        branch,
        hasChanges: false,
        aheadBehind: { ahead: 0, behind: 0 },
      };
    }

    // Check for uncommitted changes
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: worktreePath,
    });
    const hasChanges = status.trim().length > 0;

    // Check ahead/behind
    let ahead = 0, behind = 0;
    try {
      const { stdout: revList } = await execAsync(
        `git rev-list --left-right --count ${this.remote}/${this.defaultBaseBranch}...HEAD`,
        { cwd: worktreePath }
      );
      const [behindStr, aheadStr] = revList.trim().split(/\s+/);
      behind = parseInt(behindStr, 10) || 0;
      ahead = parseInt(aheadStr, 10) || 0;
    } catch {
      // Ignore if comparison fails
    }

    return {
      exists: true,
      branch,
      hasChanges,
      aheadBehind: { ahead, behind },
    };
  }

  /**
   * List all worktrees
   */
  async listAll(): Promise<Array<{ path: string; branch: string; head: string }>> {
    const { stdout } = await execAsync('git worktree list --porcelain', {
      cwd: this.repoRoot,
    });

    const worktrees: Array<{ path: string; branch: string; head: string }> = [];
    const lines = stdout.split('\n');

    let current: { path?: string; branch?: string; head?: string } = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        current.path = line.slice(9);
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === '') {
        if (current.path && current.branch && current.head) {
          worktrees.push({
            path: current.path,
            branch: current.branch,
            head: current.head,
          });
        }
        current = {};
      }
    }

    // Filter to only worker worktrees
    return worktrees.filter(
      (wt) => wt.path.startsWith(this.baseDir) || wt.branch.startsWith(this.branchPrefix)
    );
  }

  /**
   * Clean up stale worktrees
   */
  async prune(): Promise<void> {
    await execAsync('git worktree prune', { cwd: this.repoRoot });
    console.log('[WORKTREE] Pruned stale worktrees');
  }

  /**
   * Clean up orphaned worktrees that don't belong to active workers
   * @param activeWorkerIds - Array of worker IDs that should be preserved
   */
  async cleanupOrphaned(activeWorkerIds: string[] = []): Promise<number> {
    const activeShortIds = new Set(activeWorkerIds.map(id => id.slice(0, 8)));
    let removed = 0;

    try {
      const worktrees = await this.listAll();

      for (const wt of worktrees) {
        // Extract the short ID from the worktree path
        const shortId = basename(wt.path);

        // Skip if this worktree belongs to an active worker
        if (activeShortIds.has(shortId)) {
          continue;
        }

        // Skip the main worktree
        if (!wt.path.includes('.worktrees')) {
          continue;
        }

        // Remove orphaned worktree
        try {
          await execAsync(`git worktree remove "${wt.path}" --force`, {
            cwd: this.repoRoot,
          });
          console.log(`[WORKTREE] Removed orphaned worktree: ${shortId}`);
          removed++;
        } catch {
          // Force cleanup if git command fails
          if (existsSync(wt.path)) {
            rmSync(wt.path, { recursive: true, force: true });
            console.log(`[WORKTREE] Force removed orphaned worktree: ${shortId}`);
            removed++;
          }
        }

        // Also try to delete the orphaned branch
        try {
          await execAsync(`git branch -D ${wt.branch}`, { cwd: this.repoRoot });
        } catch {
          // Branch may not exist
        }
      }

      // Final prune to clean up any stale references
      await this.prune();

      if (removed > 0) {
        console.log(`[WORKTREE] Cleaned up ${removed} orphaned worktree(s)`);
      }

      return removed;
    } catch (error) {
      console.error('[WORKTREE] Error cleaning up orphaned worktrees:', (error as Error).message);
      return removed;
    }
  }
}
