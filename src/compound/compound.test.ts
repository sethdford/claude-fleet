/**
 * Compound Runner - Unit Tests
 *
 * Tests for shell quoting, gate command validation, and
 * other pure functions in the compound module.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { shellQuote } from './runner.js';
import { validateGateCommands } from './detect.js';
import type { GateConfig } from './types.js';

// ============================================================================
// shellQuote
// ============================================================================

describe('shellQuote', () => {
  it('should wrap simple strings in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('should handle empty strings', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('should escape internal single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('should handle strings with multiple single quotes', () => {
    expect(shellQuote("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
  });

  it('should preserve double quotes without escaping', () => {
    expect(shellQuote('say "hello"')).toBe("'say \"hello\"'");
  });

  it('should preserve spaces', () => {
    expect(shellQuote('/path/to/my project')).toBe("'/path/to/my project'");
  });

  it('should preserve shell metacharacters safely inside single quotes', () => {
    expect(shellQuote('$HOME && rm -rf /')).toBe("'$HOME && rm -rf /'");
  });

  it('should handle backslashes', () => {
    expect(shellQuote('path\\to\\file')).toBe("'path\\to\\file'");
  });

  it('should handle newlines', () => {
    expect(shellQuote('line1\nline2')).toBe("'line1\nline2'");
  });

  it('should handle backticks', () => {
    expect(shellQuote('`whoami`')).toBe("'`whoami`'");
  });

  it('should produce valid shell when evaluated', () => {
    // Verify round-trip: shellQuote should produce a value that bash
    // evaluates back to the original string
    const testCases = [
      'simple',
      "it's got quotes",
      'has spaces and $vars',
      '/path/to/some file.txt',
      'back\\slash',
    ];

    for (const input of testCases) {
      const quoted = shellQuote(input);
      const result = execSync(`printf '%s' ${quoted}`, { encoding: 'utf-8' });
      expect(result).toBe(input);
    }
  });
});

// ============================================================================
// validateGateCommands
// ============================================================================

describe('validateGateCommands', () => {
  it('should return empty array when all commands exist', () => {
    // 'node' and 'npx' are always available and skipped
    const gates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'typecheck',
        isRequired: true,
        config: { command: 'npx', args: ['tsc', '--noEmit'], cwd: '/tmp' },
        sortOrder: 0,
      },
    ];

    const warnings = validateGateCommands(gates);
    expect(warnings).toEqual([]);
  });

  it('should skip npx and node commands', () => {
    const gates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'typecheck',
        isRequired: true,
        config: { command: 'npx', args: ['tsc'], cwd: '/tmp' },
        sortOrder: 0,
      },
      {
        gateType: 'script',
        name: 'run',
        isRequired: true,
        config: { command: 'node', args: ['index.js'], cwd: '/tmp' },
        sortOrder: 1,
      },
    ];

    const warnings = validateGateCommands(gates);
    expect(warnings).toEqual([]);
  });

  it('should warn about missing commands', () => {
    const gates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'lint',
        isRequired: true,
        config: { command: 'nonexistent-tool-abc123', args: ['check'], cwd: '/tmp' },
        sortOrder: 0,
      },
    ];

    const warnings = validateGateCommands(gates);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('nonexistent-tool-abc123');
    expect(warnings[0]).toContain('not found on PATH');
  });

  it('should validate git is available', () => {
    // git should exist on any dev machine running these tests
    const gates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'version-check',
        isRequired: true,
        config: { command: 'git', args: ['--version'], cwd: '/tmp' },
        sortOrder: 0,
      },
    ];

    const warnings = validateGateCommands(gates);
    expect(warnings).toEqual([]);
  });

  it('should return warnings for each missing command', () => {
    const gates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'gate-a',
        isRequired: true,
        config: { command: 'fake-tool-aaa', args: [], cwd: '/tmp' },
        sortOrder: 0,
      },
      {
        gateType: 'script',
        name: 'gate-b',
        isRequired: true,
        config: { command: 'fake-tool-bbb', args: [], cwd: '/tmp' },
        sortOrder: 1,
      },
      {
        gateType: 'script',
        name: 'gate-c',
        isRequired: true,
        config: { command: 'npx', args: ['vitest'], cwd: '/tmp' },
        sortOrder: 2,
      },
    ];

    const warnings = validateGateCommands(gates);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('gate-a');
    expect(warnings[1]).toContain('gate-b');
  });

  it('should handle empty gates array', () => {
    expect(validateGateCommands([])).toEqual([]);
  });
});
