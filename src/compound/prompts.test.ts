/**
 * Compound Runner - prompts.ts Unit Tests
 *
 * Tests for fixer prompt, verifier prompt, redispatch prompt,
 * and feedback formatting helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFixerPrompt, buildVerifierPrompt, buildRedispatchPrompt } from './prompts.js';
import type { WorkerPromptContext, StructuredFeedback } from './types.js';

// ============================================================================
// Mock detect.ts getCheckCommands
// ============================================================================

vi.mock('./detect.js', () => ({
  getCheckCommands: vi.fn(
    (projectType: string, _dir: string) => {
      switch (projectType) {
        case 'node':
          return 'npx tsc --noEmit\nnpx eslint src/ --max-warnings 0\nnpx vitest run';
        case 'rust':
          return 'cargo check\ncargo clippy -- -D warnings\ncargo test';
        case 'go':
          return 'go build ./...\ngo vet ./...\ngo test ./...';
        case 'python':
          return 'mypy . (optional)\nruff check .\npython3 -m pytest -v';
        case 'make':
          return 'make';
        default:
          return '';
      }
    },
  ),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides: Partial<WorkerPromptContext> = {}): WorkerPromptContext {
  return {
    handle: 'scout-1',
    role: 'fixer',
    projectType: 'node',
    targetDir: '/project',
    branch: 'fleet/fix-12345',
    objective: 'Fix all TypeScript errors',
    iteration: 1,
    serverUrl: 'http://localhost:4800',
    swarmId: 'swarm-abc',
    ...overrides,
  };
}

function makeFeedback(overrides: Partial<StructuredFeedback> = {}): StructuredFeedback {
  return {
    totalErrors: 3,
    gates: [
      {
        name: 'typecheck',
        errors: [
          'src/index.ts:10 - TS2304: Cannot find name "foo"',
          'src/utils.ts:25 - TS2345: Argument type mismatch',
        ],
        rawTail: [],
      },
      {
        name: 'lint',
        errors: ['src/foo.ts:5 - no-var: Unexpected var'],
        rawTail: [],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// buildFixerPrompt
// ============================================================================

describe('buildFixerPrompt', () => {
  it('should include the worker handle in the prompt', () => {
    const prompt = buildFixerPrompt(makeContext({ handle: 'scout-1' }));
    expect(prompt).toContain('scout-1');
  });

  it('should identify the agent as FIXER', () => {
    const prompt = buildFixerPrompt(makeContext());
    expect(prompt).toContain('FIXER');
  });

  it('should include the target directory', () => {
    const prompt = buildFixerPrompt(makeContext({ targetDir: '/my/project' }));
    expect(prompt).toContain('/my/project');
  });

  it('should include the project type', () => {
    const prompt = buildFixerPrompt(makeContext({ projectType: 'rust' }));
    expect(prompt).toContain('rust');
  });

  it('should include the branch name', () => {
    const prompt = buildFixerPrompt(makeContext({ branch: 'fleet/fix-99999' }));
    expect(prompt).toContain('fleet/fix-99999');
  });

  it('should include the objective', () => {
    const prompt = buildFixerPrompt(makeContext({ objective: 'Fix all errors' }));
    expect(prompt).toContain('Fix all errors');
  });

  it('should include the swarmId for blackboard operations', () => {
    const prompt = buildFixerPrompt(makeContext({ swarmId: 'swarm-xyz' }));
    expect(prompt).toContain('swarm-xyz');
  });

  it('should include iteration number', () => {
    const prompt = buildFixerPrompt(makeContext({ iteration: 3 }));
    expect(prompt).toContain('3');
  });

  it('should include check commands for the project type', () => {
    const prompt = buildFixerPrompt(makeContext({ projectType: 'node' }));
    expect(prompt).toContain('npx tsc --noEmit');
    expect(prompt).toContain('npx eslint');
    expect(prompt).toContain('npx vitest run');
  });

  it('should include check commands for rust projects', () => {
    const prompt = buildFixerPrompt(makeContext({ projectType: 'rust' }));
    expect(prompt).toContain('cargo check');
    expect(prompt).toContain('cargo clippy');
    expect(prompt).toContain('cargo test');
  });

  it('should include PHASE sections for the autonomous protocol', () => {
    const prompt = buildFixerPrompt(makeContext());
    expect(prompt).toContain('PHASE 1: PLAN');
    expect(prompt).toContain('PHASE 2: EXECUTE');
    expect(prompt).toContain('PHASE 3: VALIDATE');
    expect(prompt).toContain('PHASE 4: RETROSPECT');
    expect(prompt).toContain('PHASE 5: COMMIT + REPORT');
  });

  it('should include fleet MCP tool references', () => {
    const prompt = buildFixerPrompt(makeContext());
    expect(prompt).toContain('blackboard_post');
    expect(prompt).toContain('blackboard_read');
    expect(prompt).toContain('workitem_create');
    expect(prompt).toContain('pheromone_deposit');
    expect(prompt).toContain('mission_status');
    expect(prompt).toContain('mission_gates');
    expect(prompt).toContain('gate_results');
    expect(prompt).toContain('mission_iterations');
  });

  it('should include rules section', () => {
    const prompt = buildFixerPrompt(makeContext());
    expect(prompt).toContain('RULES');
    expect(prompt).toContain('Only edit files that need fixing');
    expect(prompt).toContain('minimal fixes');
  });

  it('should include retrospective questions', () => {
    const prompt = buildFixerPrompt(makeContext());
    expect(prompt).toContain('Which fixes didn');
    expect(prompt).toContain('root causes');
  });

  it('should include commit instructions', () => {
    const prompt = buildFixerPrompt(makeContext({ iteration: 2 }));
    expect(prompt).toContain('git add -A && git commit');
    expect(prompt).toContain('TASK COMPLETE');
  });

  describe('iteration context', () => {
    it('should analyze codebase for iteration 1', () => {
      const prompt = buildFixerPrompt(makeContext({ iteration: 1 }));
      expect(prompt).toContain('Analyze the codebase');
    });

    it('should reference previous iteration feedback for iteration > 1', () => {
      const feedback = makeFeedback();
      const prompt = buildFixerPrompt(makeContext({ iteration: 2, feedback }));
      expect(prompt).toContain('iteration 2');
      expect(prompt).toContain('feedback from the previous iteration');
    });

    it('should include structured feedback content when provided', () => {
      const feedback = makeFeedback();
      const prompt = buildFixerPrompt(makeContext({ iteration: 2, feedback }));
      expect(prompt).toContain('GATE FAILED: typecheck');
      expect(prompt).toContain('TS2304');
    });

    it('should not include feedback section for iteration 1 without feedback', () => {
      const prompt = buildFixerPrompt(makeContext({ iteration: 1 }));
      expect(prompt).not.toContain('GATE FAILED');
    });
  });
});

// ============================================================================
// buildVerifierPrompt
// ============================================================================

describe('buildVerifierPrompt', () => {
  it('should include the worker handle', () => {
    const prompt = buildVerifierPrompt(makeContext({ handle: 'scout-2', role: 'verifier' }));
    expect(prompt).toContain('scout-2');
  });

  it('should identify the agent as VERIFIER', () => {
    const prompt = buildVerifierPrompt(makeContext({ role: 'verifier' }));
    expect(prompt).toContain('VERIFIER');
  });

  it('should explicitly state read-only restriction', () => {
    const prompt = buildVerifierPrompt(makeContext({ role: 'verifier' }));
    expect(prompt).toContain('DO NOT edit any files');
    expect(prompt).toContain('read-only');
  });

  it('should include the target directory', () => {
    const prompt = buildVerifierPrompt(makeContext({ targetDir: '/my/project', role: 'verifier' }));
    expect(prompt).toContain('/my/project');
  });

  it('should include the project type', () => {
    const prompt = buildVerifierPrompt(makeContext({ projectType: 'go', role: 'verifier' }));
    expect(prompt).toContain('go');
  });

  it('should include the branch name', () => {
    const prompt = buildVerifierPrompt(makeContext({ branch: 'fleet/fix-42', role: 'verifier' }));
    expect(prompt).toContain('fleet/fix-42');
  });

  it('should include swarmId for blackboard operations', () => {
    const prompt = buildVerifierPrompt(makeContext({ swarmId: 'swarm-123', role: 'verifier' }));
    expect(prompt).toContain('swarm-123');
  });

  it('should include check commands for the project type', () => {
    const prompt = buildVerifierPrompt(makeContext({ projectType: 'node', role: 'verifier' }));
    expect(prompt).toContain('npx tsc --noEmit');
    expect(prompt).toContain('npx vitest run');
  });

  it('should include PHASE sections for the verifier protocol', () => {
    const prompt = buildVerifierPrompt(makeContext({ role: 'verifier' }));
    expect(prompt).toContain('PHASE 1: PLAN');
    expect(prompt).toContain('PHASE 2: VERIFY');
    expect(prompt).toContain('PHASE 3: RETROSPECT');
    expect(prompt).toContain('PHASE 4: REPORT');
  });

  it('should include fleet MCP tool references', () => {
    const prompt = buildVerifierPrompt(makeContext({ role: 'verifier' }));
    expect(prompt).toContain('blackboard_post');
    expect(prompt).toContain('blackboard_read');
    expect(prompt).toContain('pheromone_deposit');
    expect(prompt).toContain('belief_set');
    expect(prompt).toContain('mission_status');
    expect(prompt).toContain('gate_results');
  });

  it('should include rules section prohibiting file edits', () => {
    const prompt = buildVerifierPrompt(makeContext({ role: 'verifier' }));
    expect(prompt).toContain('RULES');
    expect(prompt).toContain('DO NOT edit, create, or delete any files');
  });

  it('should include TASK COMPLETE instruction', () => {
    const prompt = buildVerifierPrompt(makeContext({ role: 'verifier' }));
    expect(prompt).toContain('TASK COMPLETE');
  });

  describe('iteration context', () => {
    it('should review current state for iteration 1', () => {
      const prompt = buildVerifierPrompt(makeContext({ iteration: 1, role: 'verifier' }));
      expect(prompt).toContain('Review the current state');
    });

    it('should reference git diff and blackboard for iteration > 1', () => {
      const prompt = buildVerifierPrompt(makeContext({ iteration: 2, role: 'verifier' }));
      expect(prompt).toContain('git diff HEAD~1');
      expect(prompt).toContain('blackboard_read');
    });

    it('should include iteration number in belief recording', () => {
      const prompt = buildVerifierPrompt(makeContext({ iteration: 3, role: 'verifier' }));
      expect(prompt).toContain('"iteration":3');
    });
  });
});

// ============================================================================
// buildRedispatchPrompt
// ============================================================================

describe('buildRedispatchPrompt', () => {
  it('should include the base fixer prompt for fixer role', () => {
    const feedback = makeFeedback();
    const ctx = makeContext({ role: 'fixer', iteration: 2 });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('FIXER');
    expect(prompt).toContain('PHASE 1: PLAN');
  });

  it('should include the base verifier prompt for verifier role', () => {
    const feedback = makeFeedback();
    const ctx = makeContext({ role: 'verifier', iteration: 2 });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('VERIFIER');
    expect(prompt).toContain('PHASE 2: VERIFY');
  });

  it('should include iteration context header', () => {
    const feedback = makeFeedback();
    const ctx = makeContext({ iteration: 3 });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('ITERATION 3: CONTEXT');
  });

  it('should include structured feedback in the prompt', () => {
    const feedback = makeFeedback();
    const ctx = makeContext({ iteration: 2 });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('GATE FAILED: typecheck');
    expect(prompt).toContain('GATE FAILED: lint');
    expect(prompt).toContain('Total errors: 3');
  });

  it('should include instruction to check blackboard', () => {
    const feedback = makeFeedback();
    const ctx = makeContext({ swarmId: 'swarm-redispatch' });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('blackboard_read');
    expect(prompt).toContain('swarm-redispatch');
  });

  it('should include instruction not to repeat failed fixes', () => {
    const feedback = makeFeedback();
    const ctx = makeContext({ iteration: 2 });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('Do not repeat fixes');
  });

  it('should include Previous gates FAILED message', () => {
    const feedback = makeFeedback();
    const ctx = makeContext();

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('Previous gates FAILED');
  });

  it('should handle empty feedback gates', () => {
    const feedback: StructuredFeedback = { totalErrors: 0, gates: [] };
    const ctx = makeContext({ iteration: 2 });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('No structured feedback available');
  });

  it('should include error details from feedback', () => {
    const feedback = makeFeedback({
      gates: [
        {
          name: 'tests',
          errors: ['FAIL src/foo.test.ts - expected 1 to be 2'],
          rawTail: [],
        },
      ],
    });
    const ctx = makeContext({ iteration: 2 });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('FAIL src/foo.test.ts');
  });

  it('should include rawTail when no structured errors exist', () => {
    const feedback: StructuredFeedback = {
      totalErrors: 1,
      gates: [
        {
          name: 'build',
          errors: [],
          rawTail: ['make: *** [all] Error 2', 'Leaving directory'],
        },
      ],
    };
    const ctx = makeContext({ iteration: 2 });

    const prompt = buildRedispatchPrompt(ctx, feedback);
    expect(prompt).toContain('Raw output');
    expect(prompt).toContain('make: *** [all] Error 2');
  });
});

// ============================================================================
// Feedback formatting edge cases
// ============================================================================

describe('feedback formatting', () => {
  it('should handle feedback with only rawTail and no structured errors', () => {
    const feedback: StructuredFeedback = {
      totalErrors: 1,
      gates: [
        {
          name: 'build',
          errors: [],
          rawTail: ['line 1', 'line 2'],
        },
      ],
    };

    const prompt = buildRedispatchPrompt(makeContext({ iteration: 2 }), feedback);
    expect(prompt).toContain('GATE FAILED: build');
    expect(prompt).toContain('line 1');
    expect(prompt).toContain('line 2');
  });

  it('should handle feedback with mixed gate results', () => {
    const feedback: StructuredFeedback = {
      totalErrors: 5,
      gates: [
        {
          name: 'typecheck',
          errors: ['error 1', 'error 2', 'error 3'],
          rawTail: [],
        },
        {
          name: 'build',
          errors: [],
          rawTail: ['raw line 1', 'raw line 2'],
        },
      ],
    };

    const prompt = buildRedispatchPrompt(makeContext({ iteration: 2 }), feedback);
    expect(prompt).toContain('Total errors: 5');
    expect(prompt).toContain('GATE FAILED: typecheck');
    expect(prompt).toContain('GATE FAILED: build');
    expect(prompt).toContain('error 1');
    expect(prompt).toContain('raw line 1');
  });
});
