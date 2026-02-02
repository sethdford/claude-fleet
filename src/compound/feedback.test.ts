/**
 * Compound Runner - feedback.ts Unit Tests
 *
 * Tests for structured feedback extraction from gate results,
 * including all project-type-specific parsers.
 */

import { describe, it, expect } from 'vitest';
import { extractStructuredFeedback, extractFeedbackFromNamedResults } from './feedback.js';
import type { GateResult, GateConfig, ProjectType } from './types.js';

// ============================================================================
// Helper: build GateConfig
// ============================================================================

function makeGate(name: string, sortOrder: number): GateConfig {
  return {
    gateType: 'script',
    name,
    isRequired: true,
    config: { command: 'npx', args: [], cwd: '/tmp' },
    sortOrder,
  };
}

// ============================================================================
// extractStructuredFeedback
// ============================================================================

describe('extractStructuredFeedback', () => {
  it('should return empty feedback when no results are failed', () => {
    const results: GateResult[] = [
      { gateId: 'gate-1', status: 'passed', output: 'all good' },
    ];
    const gates = [makeGate('typecheck', 0)];

    const feedback = extractStructuredFeedback(results, gates, 'node');
    expect(feedback.totalErrors).toBe(0);
    expect(feedback.gates).toHaveLength(0);
  });

  it('should extract feedback from failed results', () => {
    const results: GateResult[] = [
      {
        gateId: 'gate-abc123',
        status: 'failed',
        output: 'src/index.ts(10,5): error TS2304: Cannot find name "foo"',
      },
    ];
    const gates = [makeGate('typecheck', 0)];

    const feedback = extractStructuredFeedback(results, gates, 'node');
    expect(feedback.totalErrors).toBeGreaterThanOrEqual(1);
    expect(feedback.gates).toHaveLength(1);
  });

  it('should skip passed and error results', () => {
    const results: GateResult[] = [
      { gateId: 'g1', status: 'passed', output: 'ok' },
      { gateId: 'g2', status: 'error', output: 'timeout' },
      { gateId: 'g3', status: 'failed', output: 'FAIL tests\nError: bad' },
    ];
    const gates = [
      makeGate('typecheck', 0),
      makeGate('lint', 1),
      makeGate('tests', 2),
    ];

    const feedback = extractStructuredFeedback(results, gates, 'node');
    // Only the failed result should be processed
    expect(feedback.gates).toHaveLength(1);
  });

  it('should handle empty results array', () => {
    const feedback = extractStructuredFeedback([], [], 'node');
    expect(feedback.totalErrors).toBe(0);
    expect(feedback.gates).toEqual([]);
  });

  it('should truncate gateId for display when gate name not found', () => {
    const results: GateResult[] = [
      { gateId: 'abcdef1234567890', status: 'failed', output: 'some error' },
    ];
    const gates: GateConfig[] = [];

    const feedback = extractStructuredFeedback(results, gates, 'node');
    expect(feedback.gates).toHaveLength(1);
    // findGateName returns null, so it should use truncated gateId
    expect(feedback.gates[0].name).toBe('abcdef12');
  });

  it('should handle result with empty output', () => {
    const results: GateResult[] = [
      { gateId: 'gate-1', status: 'failed', output: '' },
    ];
    const gates = [makeGate('tests', 0)];

    const feedback = extractStructuredFeedback(results, gates, 'node');
    expect(feedback.gates).toHaveLength(1);
    // totalErrors should be at least 1 (the fallback)
    expect(feedback.totalErrors).toBeGreaterThanOrEqual(1);
  });

  it('should handle result with undefined output', () => {
    const results: GateResult[] = [
      { gateId: 'gate-1', status: 'failed', output: undefined as unknown as string },
    ];
    const gates = [makeGate('tests', 0)];

    const feedback = extractStructuredFeedback(results, gates, 'node');
    expect(feedback.gates).toHaveLength(1);
  });
});

// ============================================================================
// extractFeedbackFromNamedResults
// ============================================================================

describe('extractFeedbackFromNamedResults', () => {
  it('should return empty feedback for all-passed results', () => {
    const results = [
      { name: 'typecheck', status: 'passed', output: '' },
      { name: 'lint', status: 'passed', output: '' },
    ];

    const feedback = extractFeedbackFromNamedResults(results, 'node');
    expect(feedback.totalErrors).toBe(0);
    expect(feedback.gates).toHaveLength(0);
  });

  it('should extract feedback from failed results only', () => {
    const results = [
      { name: 'typecheck', status: 'passed', output: '' },
      { name: 'lint', status: 'failed', output: 'src/foo.ts:10:5: error message  rule-name' },
      { name: 'tests', status: 'failed', output: 'FAIL src/foo.test.ts' },
    ];

    const feedback = extractFeedbackFromNamedResults(results, 'node');
    expect(feedback.gates).toHaveLength(2);
    expect(feedback.gates[0].name).toBe('lint');
    expect(feedback.gates[1].name).toBe('tests');
  });

  it('should handle empty results array', () => {
    const feedback = extractFeedbackFromNamedResults([], 'rust');
    expect(feedback.totalErrors).toBe(0);
    expect(feedback.gates).toEqual([]);
  });

  // ── Node TypeScript Error Parsing ──────────────────────────────────────

  describe('node typecheck errors', () => {
    it('should parse TypeScript compiler errors', () => {
      const output = [
        'src/index.ts(10,5): error TS2304: Cannot find name "foo"',
        'src/utils.ts(25,10): error TS2345: Argument of type "string" is not assignable',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'typecheck', status: 'failed', output }],
        'node',
      );

      expect(feedback.gates).toHaveLength(1);
      expect(feedback.gates[0].errors).toHaveLength(2);
      expect(feedback.gates[0].errors[0]).toContain('src/index.ts:10');
      expect(feedback.gates[0].errors[0]).toContain('TS2304');
      expect(feedback.gates[0].errors[1]).toContain('src/utils.ts:25');
      expect(feedback.gates[0].errors[1]).toContain('TS2345');
    });

    it('should handle non-matching lines in typecheck output', () => {
      const output = [
        'Compiling...',
        'src/index.ts(10,5): error TS2304: Cannot find name "foo"',
        'Found 1 error.',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'typecheck', status: 'failed', output }],
        'node',
      );

      expect(feedback.gates[0].errors).toHaveLength(1);
    });
  });

  // ── Node ESLint Error Parsing ──────────────────────────────────────────

  describe('node lint errors', () => {
    it('should parse eslint stylish format errors', () => {
      const output = [
        '/project/src/foo.ts:10:5: unexpected var  no-var',
        '/project/src/bar.ts:20:1: missing return type  @typescript-eslint/explicit-function-return-type',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'lint', status: 'failed', output }],
        'node',
      );

      expect(feedback.gates[0].errors).toHaveLength(2);
      expect(feedback.gates[0].errors[0]).toContain('/project/src/foo.ts:10');
      expect(feedback.gates[0].errors[1]).toContain('/project/src/bar.ts:20');
    });

    it('should parse eslint compact format errors', () => {
      const output = 'src/foo.ts: line 10, col 5 - no-var: Unexpected var';

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'lint', status: 'failed', output }],
        'node',
      );

      expect(feedback.gates[0].errors).toHaveLength(1);
      expect(feedback.gates[0].errors[0]).toContain('src/foo.ts:10');
    });
  });

  // ── Node Test Error Parsing ────────────────────────────────────────────

  describe('node test errors', () => {
    it('should parse FAIL lines from test output', () => {
      const output = [
        'PASS src/utils.test.ts',
        'FAIL src/index.test.ts',
        '  Error: expected 1 to be 2',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'tests', status: 'failed', output }],
        'node',
      );

      expect(feedback.gates[0].errors.length).toBeGreaterThanOrEqual(1);
      const hasFailLine = feedback.gates[0].errors.some(e => e.includes('FAIL'));
      expect(hasFailLine).toBe(true);
    });

    it('should parse Error: lines from test output', () => {
      const output = 'Error: expected value to be truthy';

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'tests', status: 'failed', output }],
        'node',
      );

      expect(feedback.gates[0].errors.length).toBeGreaterThanOrEqual(1);
    });

    it('should not treat ENOENT errors as test failures', () => {
      const output = 'Error: ENOENT: no such file or directory';

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'tests', status: 'failed', output }],
        'node',
      );

      // ENOENT errors are filtered out
      expect(feedback.gates[0].errors).toHaveLength(0);
    });
  });

  // ── Node Unknown Gate Name ─────────────────────────────────────────────

  describe('node unknown gate', () => {
    it('should return empty errors for unknown gate names', () => {
      const output = 'some random output';

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'unknown-gate', status: 'failed', output }],
        'node',
      );

      expect(feedback.gates[0].errors).toHaveLength(0);
      // Should fallback to rawTail
      expect(feedback.gates[0].rawTail.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Rust Error Parsing ─────────────────────────────────────────────────

  describe('rust errors', () => {
    it('should parse rust compiler errors with error codes', () => {
      const output = [
        'error[E0308]: mismatched types',
        '  --> src/main.rs:10:5',
        '   |',
        '10 |     let x: u32 = "hello";',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'check', status: 'failed', output }],
        'rust',
      );

      expect(feedback.gates[0].errors).toHaveLength(1);
      expect(feedback.gates[0].errors[0]).toContain('E0308');
      expect(feedback.gates[0].errors[0]).toContain('mismatched types');
      expect(feedback.gates[0].errors[0]).toContain('src/main.rs:10');
    });

    it('should parse multiple rust errors', () => {
      const output = [
        'error[E0308]: mismatched types',
        '  --> src/main.rs:10:5',
        '',
        'error[E0425]: cannot find value',
        '  --> src/lib.rs:20:10',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'check', status: 'failed', output }],
        'rust',
      );

      expect(feedback.gates[0].errors).toHaveLength(2);
    });

    it('should handle rust errors without location info', () => {
      const output = [
        'error[E0308]: mismatched types',
        'some other line without location',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'check', status: 'failed', output }],
        'rust',
      );

      expect(feedback.gates[0].errors).toHaveLength(1);
      expect(feedback.gates[0].errors[0]).toContain('E0308');
      expect(feedback.gates[0].errors[0]).not.toContain(' at ');
    });
  });

  // ── Go Error Parsing ───────────────────────────────────────────────────

  describe('go errors', () => {
    it('should parse go compiler errors', () => {
      const output = [
        'main.go:10:5: undefined: foo',
        'utils.go:25:1: syntax error: unexpected }',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'build', status: 'failed', output }],
        'go',
      );

      expect(feedback.gates[0].errors).toHaveLength(2);
      expect(feedback.gates[0].errors[0]).toContain('main.go:10');
      expect(feedback.gates[0].errors[0]).toContain('undefined: foo');
      expect(feedback.gates[0].errors[1]).toContain('utils.go:25');
    });

    it('should handle non-matching lines in go output', () => {
      const output = [
        '# mypackage',
        'main.go:10:5: undefined: foo',
        'FAIL mypackage [build failed]',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'build', status: 'failed', output }],
        'go',
      );

      expect(feedback.gates[0].errors).toHaveLength(1);
    });
  });

  // ── Python Error Parsing ───────────────────────────────────────────────

  describe('python errors', () => {
    it('should parse FAILED lines from pytest output', () => {
      const output = [
        'tests/test_main.py::test_add PASSED',
        'tests/test_main.py::test_sub FAILED',
        'tests/test_main.py::test_mul FAILED',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'tests', status: 'failed', output }],
        'python',
      );

      expect(feedback.gates[0].errors).toHaveLength(2);
    });

    it('should parse ERROR lines from python output', () => {
      const output = [
        'ERROR collecting tests/test_bad.py',
        'ImportError: cannot import name "foo"',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'tests', status: 'failed', output }],
        'python',
      );

      expect(feedback.gates[0].errors.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse AssertionError lines', () => {
      const output = 'AssertionError: assert 1 == 2';

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'tests', status: 'failed', output }],
        'python',
      );

      expect(feedback.gates[0].errors).toHaveLength(1);
    });
  });

  // ── Make Error Parsing ─────────────────────────────────────────────────

  describe('make errors', () => {
    it('should parse make/gcc error format', () => {
      const output = [
        'gcc -c main.c -o main.o',
        'main.c:10: error: expected declaration',
        'utils.c:5: error: undeclared identifier',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'build', status: 'failed', output }],
        'make',
      );

      expect(feedback.gates[0].errors).toHaveLength(2);
      expect(feedback.gates[0].errors[0]).toContain('main.c:10');
      expect(feedback.gates[0].errors[1]).toContain('utils.c:5');
    });

    it('should handle make output with no parseable errors', () => {
      const output = [
        'make: *** [Makefile:10: all] Error 2',
        'make: Leaving directory',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'build', status: 'failed', output }],
        'make',
      );

      // No structured errors extracted
      expect(feedback.gates[0].errors).toHaveLength(0);
      // Should fall back to rawTail
      expect(feedback.gates[0].rawTail.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Error Capping ──────────────────────────────────────────────────────

  describe('error capping', () => {
    it('should cap errors at 20 per gate', () => {
      // Generate 30 TypeScript errors
      const lines: string[] = [];
      for (let i = 1; i <= 30; i++) {
        lines.push(`src/file.ts(${i},1): error TS2304: Cannot find name "x${i}"`);
      }

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'typecheck', status: 'failed', output: lines.join('\n') }],
        'node',
      );

      expect(feedback.gates[0].errors).toHaveLength(20);
    });
  });

  // ── Raw Tail Fallback ──────────────────────────────────────────────────

  describe('rawTail fallback', () => {
    it('should include rawTail when no structured errors are found', () => {
      const lines = Array.from({ length: 20 }, (_, i) => `output line ${i + 1}`);

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'unknown-gate', status: 'failed', output: lines.join('\n') }],
        'node',
      );

      expect(feedback.gates[0].errors).toHaveLength(0);
      expect(feedback.gates[0].rawTail.length).toBeLessThanOrEqual(15);
      expect(feedback.gates[0].rawTail.length).toBeGreaterThan(0);
    });

    it('should not include rawTail when structured errors exist', () => {
      const output = 'src/index.ts(10,5): error TS2304: Cannot find name "foo"';

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'typecheck', status: 'failed', output }],
        'node',
      );

      expect(feedback.gates[0].errors.length).toBeGreaterThan(0);
      expect(feedback.gates[0].rawTail).toEqual([]);
    });

    it('should filter empty lines from rawTail', () => {
      const output = [
        '',
        'some output',
        '',
        'another line',
        '',
      ].join('\n');

      const feedback = extractFeedbackFromNamedResults(
        [{ name: 'unknown-gate', status: 'failed', output }],
        'node',
      );

      // Only non-empty lines should be in rawTail
      for (const line of feedback.gates[0].rawTail) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    });
  });

  // ── Total Error Counting ───────────────────────────────────────────────

  describe('totalErrors counting', () => {
    it('should sum errors across multiple failed gates', () => {
      const results = [
        {
          name: 'typecheck',
          status: 'failed',
          output: [
            'src/a.ts(1,1): error TS2304: foo',
            'src/b.ts(2,1): error TS2304: bar',
          ].join('\n'),
        },
        {
          name: 'lint',
          status: 'failed',
          output: 'src/c.ts:3:1: some lint error  rule-name',
        },
      ];

      const feedback = extractFeedbackFromNamedResults(results, 'node');
      expect(feedback.totalErrors).toBe(3);
    });

    it('should count at least 1 error for failed gate with no parsed errors', () => {
      const results = [
        { name: 'unknown-gate', status: 'failed', output: 'something bad happened' },
      ];

      const feedback = extractFeedbackFromNamedResults(results, 'node');
      // errors.length is 0, so fallback: totalErrors += 1
      expect(feedback.totalErrors).toBe(1);
    });
  });
});
