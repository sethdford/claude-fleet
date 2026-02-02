/**
 * Tests for Git Worktree Manager
 *
 * Mocks child_process and node:fs to test worktree operations
 * without touching the actual git repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted creates variables available in hoisted vi.mock scope
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('/mock/repo\n'),
  exec: vi.fn(),
}));

// Mock fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
}));

// Mock util.promisify — always returns the same shared mock
vi.mock('node:util', () => ({
  promisify: vi.fn().mockReturnValue(mockExecAsync),
}));

import { WorktreeManager } from './worktree.js';
import { existsSync } from 'node:fs';

describe('WorktreeManager', () => {
  let manager: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    manager = new WorktreeManager({
      baseDir: '/mock/repo/.worktrees',
      branchPrefix: 'worker/',
      remote: 'origin',
      defaultBaseBranch: 'main',
    });
  });

  // ======================================================================
  // CONSTRUCTOR
  // ======================================================================

  describe('constructor', () => {
    it('should create with default options', () => {
      expect(manager).toBeDefined();
    });

    it('should create base dir if not exists', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const m = new WorktreeManager({ baseDir: '/new/worktrees' });
      expect(m).toBeDefined();
    });
  });

  // ======================================================================
  // create
  // ======================================================================

  describe('create', () => {
    it('should create a new worktree', async () => {
      // worktree path doesn't exist yet
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      const result = await manager.create('worker-abcd1234');

      expect(result.workerId).toBe('worker-abcd1234');
      expect(result.branch).toBe('worker/worker-a');
      expect(result.path).toContain('worker-a');
      expect(mockExecAsync).toHaveBeenCalledTimes(2); // fetch + worktree add
    });

    it('should return existing worktree if path exists', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = await manager.create('worker-abcd1234');
      expect(result.workerId).toBe('worker-abcd1234');
      // Should not call execAsync for fetch/worktree add since it already exists
    });

    it('should handle branch-already-exists error', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false); // worktree path

      // First execAsync (fetch) succeeds, second (worktree add -b) fails with "already exists"
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockRejectedValueOnce(Object.assign(new Error('fatal'), { stderr: 'branch already exists' }))
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // retry without -b

      const result = await manager.create('worker-abcd1234');
      expect(result.workerId).toBe('worker-abcd1234');
    });

    it('should throw on unexpected error', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false); // worktree path

      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { stderr: 'permission denied' }));

      await expect(manager.create('worker-abcd1234'))
        .rejects.toThrow('Failed to create worktree');
    });
  });

  // ======================================================================
  // remove
  // ======================================================================

  describe('remove', () => {
    it('should remove worktree and branch', async () => {
      await manager.remove('worker-abcd1234');
      // worktree remove + branch -D
      expect(mockExecAsync).toHaveBeenCalledTimes(2);
    });

    it('should skip worktree remove when path does not exist', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      await manager.remove('worker-abcd1234');
      // Only branch delete attempted
      expect(mockExecAsync).toHaveBeenCalledTimes(1);
    });

    it('should force cleanup on removal failure', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('locked'));
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      await manager.remove('worker-abcd1234');
      // Should not throw — falls back to rmSync + prune
    });
  });

  // ======================================================================
  // commit
  // ======================================================================

  describe('commit', () => {
    it('should commit changes in worktree', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: ' M file.ts\n', stderr: '' }) // git status
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git add
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git commit
        .mockResolvedValueOnce({ stdout: 'abc12345\n', stderr: '' }); // git rev-parse

      const hash = await manager.commit('worker-abcd1234', 'Fix bug');
      expect(hash).toBe('abc12345');
    });

    it('should throw when worktree not found', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      await expect(manager.commit('worker-abcd1234', 'msg'))
        .rejects.toThrow('Worktree not found');
    });

    it('should throw when no changes', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' }); // empty status
      await expect(manager.commit('worker-abcd1234', 'msg'))
        .rejects.toThrow('No changes to commit');
    });
  });

  // ======================================================================
  // push
  // ======================================================================

  describe('push', () => {
    it('should push branch to remote', async () => {
      await manager.push('worker-abcd1234');
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git push -u origin worker/worker-a'),
        expect.any(Object),
      );
    });

    it('should throw when worktree not found', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      await expect(manager.push('worker-abcd1234'))
        .rejects.toThrow('Worktree not found');
    });
  });

  // ======================================================================
  // createPR
  // ======================================================================

  describe('createPR', () => {
    it('should push and create PR', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // push
        .mockResolvedValueOnce({ stdout: 'https://github.com/org/repo/pull/1\n', stderr: '' }); // gh pr create

      const url = await manager.createPR('worker-abcd1234', 'Fix bug', 'Fixes #123');
      expect(url).toBe('https://github.com/org/repo/pull/1');
    });

    it('should throw when worktree not found', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      await expect(manager.createPR('worker-abcd1234', 'Title', 'Body'))
        .rejects.toThrow('Worktree not found');
    });
  });

  // ======================================================================
  // getStatus
  // ======================================================================

  describe('getStatus', () => {
    it('should return status of existing worktree', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: ' M src/file.ts\n', stderr: '' }) // git status
        .mockResolvedValueOnce({ stdout: '2\t5\n', stderr: '' }); // git rev-list

      const status = await manager.getStatus('worker-abcd1234');
      expect(status.exists).toBe(true);
      expect(status.hasChanges).toBe(true);
      expect(status.aheadBehind.behind).toBe(2);
      expect(status.aheadBehind.ahead).toBe(5);
    });

    it('should return not-exists for missing worktree', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const status = await manager.getStatus('worker-abcd1234');
      expect(status.exists).toBe(false);
      expect(status.hasChanges).toBe(false);
    });

    it('should handle rev-list failure gracefully', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockRejectedValueOnce(new Error('no upstream'));

      const status = await manager.getStatus('worker-abcd1234');
      expect(status.aheadBehind.ahead).toBe(0);
      expect(status.aheadBehind.behind).toBe(0);
    });
  });

  // ======================================================================
  // listAll
  // ======================================================================

  describe('listAll', () => {
    it('should parse porcelain output', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: [
          'worktree /mock/repo/.worktrees/abc12345',
          'HEAD deadbeef',
          'branch refs/heads/worker/abc12345',
          '',
          'worktree /mock/repo',
          'HEAD cafebabe',
          'branch refs/heads/main',
          '',
        ].join('\n'),
        stderr: '',
      });

      const worktrees = await manager.listAll();
      // Should include only worker-prefixed or baseDir worktrees
      expect(worktrees.length).toBeGreaterThanOrEqual(1);
      expect(worktrees[0].branch).toBe('worker/abc12345');
    });
  });

  // ======================================================================
  // prune
  // ======================================================================

  describe('prune', () => {
    it('should call git worktree prune', async () => {
      await manager.prune();
      expect(mockExecAsync).toHaveBeenCalledWith(
        'git worktree prune',
        expect.any(Object),
      );
    });
  });

  // ======================================================================
  // cleanupOrphaned
  // ======================================================================

  describe('cleanupOrphaned', () => {
    it('should remove worktrees not in active list', async () => {
      // listAll returns one worktree
      mockExecAsync
        .mockResolvedValueOnce({
          stdout: [
            'worktree /mock/repo/.worktrees/orphaned1',
            'HEAD deadbeef',
            'branch refs/heads/worker/orphaned1',
            '',
          ].join('\n'),
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree remove
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // branch -D
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // prune

      const removed = await manager.cleanupOrphaned([]);
      expect(removed).toBe(1);
    });

    it('should preserve active worker worktrees', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: [
          'worktree /mock/repo/.worktrees/active12',
          'HEAD deadbeef',
          'branch refs/heads/worker/active12',
          '',
        ].join('\n'),
        stderr: '',
      }).mockResolvedValueOnce({ stdout: '', stderr: '' }); // prune

      const removed = await manager.cleanupOrphaned(['active1234567890']);
      expect(removed).toBe(0);
    });
  });
});
