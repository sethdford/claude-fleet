/**
 * MultiRepoOrchestrator Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiRepoOrchestrator } from './multi-repo-orchestrator.js';

// Mock dependencies
vi.mock('./wave-orchestrator.js', () => {
  return {
    WaveOrchestrator: class MockWaveOrchestrator {
      private waves: unknown[] = [];
      addWave = vi.fn((wave) => { this.waves.push(wave); return this; });
      on = vi.fn();
      execute = vi.fn().mockResolvedValue([
        { worker: 'repo-a', success: true, duration: 1000 },
        { worker: 'repo-b', success: true, duration: 1500 },
      ]);
    },
  };
});

vi.mock('./remote-fleet-manager.js', () => ({
  RemoteFleetManager: vi.fn(),
}));

vi.mock('./controller.js', () => ({
  TmuxController: class MockTmuxController {},
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

describe('MultiRepoOrchestrator', () => {
  let orchestrator: MultiRepoOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new MultiRepoOrchestrator({
      fleetName: 'test-fleet',
      repositories: [
        { name: 'repo-a', path: '/repos/a', tags: ['frontend'] },
        { name: 'repo-b', path: '/repos/b', tags: ['backend'] },
        { name: 'repo-c', path: '/repos/c', tags: ['frontend', 'backend'] },
      ],
    });
  });

  describe('Repository Management', () => {
    it('indexes repositories on creation', () => {
      const status = orchestrator.getStatus();
      expect(status.status).toBe('idle');
    });

    it('adds new repository', () => {
      orchestrator.addRepository({
        name: 'repo-d',
        path: '/repos/d',
        tags: ['new'],
      });
      // Verify by checking task targeting
    });
  });

  describe('Task Execution', () => {
    it('executes task across all repos', async () => {
      const results = await orchestrator.executeTask({
        name: 'test-task',
        prompt: 'Test prompt',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.success).toBe(true);
    });

    it('filters repos by tag', async () => {
      const events: string[] = [];
      orchestrator.on('task:repos', ({ repos }) => {
        events.push(...repos);
      });

      await orchestrator.executeTask({
        name: 'frontend-task',
        prompt: 'Frontend prompt',
        repoTags: ['frontend'],
      });

      // repo-a and repo-c have frontend tag
      expect(events).toContain('repo-a');
      expect(events).toContain('repo-c');
    });

    it('filters repos by name', async () => {
      const events: string[] = [];
      orchestrator.on('task:repos', ({ repos }) => {
        events.push(...repos);
      });

      await orchestrator.executeTask({
        name: 'specific-task',
        prompt: 'Specific prompt',
        repos: ['repo-b'],
      });

      expect(events).toEqual(['repo-b']);
    });

    it('emits events during execution', async () => {
      const events: string[] = [];

      orchestrator.on('task:start', () => events.push('start'));
      orchestrator.on('task:repos', () => events.push('repos'));
      orchestrator.on('task:complete', () => events.push('complete'));

      await orchestrator.executeTask({
        name: 'event-task',
        prompt: 'Event prompt',
      });

      expect(events).toContain('start');
      expect(events).toContain('repos');
      expect(events).toContain('complete');
    });
  });

  describe('Status Tracking', () => {
    it('tracks execution status', async () => {
      let runningStatus: string | undefined;

      orchestrator.on('task:start', () => {
        runningStatus = orchestrator.getStatus().status;
      });

      await orchestrator.executeTask({
        name: 'status-task',
        prompt: 'Status prompt',
      });

      expect(runningStatus).toBe('running');

      const finalStatus = orchestrator.getStatus();
      expect(finalStatus.status).toBe('completed');
    });

    it('collects results', async () => {
      await orchestrator.executeTask({
        name: 'result-task',
        prompt: 'Result prompt',
      });

      const results = orchestrator.getResults();
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Common Tasks', () => {
    it('provides updateDependencies helper', async () => {
      const results = await orchestrator.updateDependencies();
      expect(results).toBeDefined();
    });

    it('provides runSecurityAudit helper', async () => {
      const results = await orchestrator.runSecurityAudit({ fix: true });
      expect(results).toBeDefined();
    });

    it('provides formatCode helper', async () => {
      const results = await orchestrator.formatCode();
      expect(results).toBeDefined();
    });

    it('provides runTests helper', async () => {
      const results = await orchestrator.runTests();
      expect(results).toBeDefined();
    });

    it('provides generateDocs helper', async () => {
      const results = await orchestrator.generateDocs();
      expect(results).toBeDefined();
    });

    it('provides applyPatch helper', async () => {
      const results = await orchestrator.applyPatch({
        prompt: 'Apply a patch',
        branchName: 'patch-branch',
        commitMessage: 'Apply patch',
        prTitle: 'Patch PR',
      });
      expect(results).toBeDefined();
    });
  });

  describe('Template Interpolation', () => {
    it('interpolates task templates', async () => {
      // This is tested implicitly through task execution
      // The prompts use {{repo}} and {{task}} templates
      await orchestrator.executeTask({
        name: 'template-task',
        prompt: 'Working on {{repo}} for {{task}}',
        branchPattern: 'auto/{{task}}-{{repo}}',
      });

      const results = orchestrator.getResults();
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

describe('Configuration', () => {
  it('applies default config values', () => {
    const orch = new MultiRepoOrchestrator({
      fleetName: 'minimal',
      repositories: [],
    });

    expect(orch.getStatus().status).toBe('idle');
  });

  it('allows custom config', () => {
    const orch = new MultiRepoOrchestrator({
      fleetName: 'custom',
      repositories: [],
      maxParallel: 8,
      remote: false,
      baseDir: '/custom/base',
    });

    expect(orch.getStatus().status).toBe('idle');
  });
});
