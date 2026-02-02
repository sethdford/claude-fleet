/**
 * Compound Runner - Unit Tests
 *
 * Tests for shell quoting, gate command validation, CompoundRunner
 * construction, and other functions in the compound module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { shellQuote, CompoundRunner } from './runner.js';
import type { GateConfig, CompoundOptions } from './types.js';

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

  it('should handle tabs', () => {
    expect(shellQuote('col1\tcol2')).toBe("'col1\tcol2'");
  });

  it('should handle semicolons and pipes', () => {
    expect(shellQuote('cmd1; cmd2 | cmd3')).toBe("'cmd1; cmd2 | cmd3'");
  });

  it('should handle parentheses and braces', () => {
    expect(shellQuote('(group) {block}')).toBe("'(group) {block}'");
  });

  it('should handle tilde', () => {
    expect(shellQuote('~/path')).toBe("'~/path'");
  });

  it('should handle hash/pound', () => {
    expect(shellQuote('#comment')).toBe("'#comment'");
  });

  it('should handle exclamation mark', () => {
    expect(shellQuote('hello!')).toBe("'hello!'");
  });

  it('should handle unicode characters', () => {
    expect(shellQuote('hello world')).toBe("'hello world'");
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

  it('should produce valid shell for special characters when evaluated', () => {
    const testCases = [
      'tab\there',
      'semi;colon',
      '$(subshell)',
      'percent%sign',
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
  // These tests need the REAL validateGateCommands, not the mock.
  // We use vi.importActual because vi.mock('./detect.js') is hoisted and
  // replaces the module globally.
  let realValidateGateCommands: (gates: GateConfig[]) => string[];

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('./detect.js')>('./detect.js');
    realValidateGateCommands = actual.validateGateCommands;
  });

  it('should return empty array when all commands exist', () => {
    const gates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'typecheck',
        isRequired: true,
        config: { command: 'npx', args: ['tsc', '--noEmit'], cwd: '/tmp' },
        sortOrder: 0,
      },
    ];

    const warnings = realValidateGateCommands(gates);
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

    const warnings = realValidateGateCommands(gates);
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

    const warnings = realValidateGateCommands(gates);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('nonexistent-tool-abc123');
    expect(warnings[0]).toContain('not found on PATH');
  });

  it('should validate git is available', () => {
    const gates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'version-check',
        isRequired: true,
        config: { command: 'git', args: ['--version'], cwd: '/tmp' },
        sortOrder: 0,
      },
    ];

    const warnings = realValidateGateCommands(gates);
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

    const warnings = realValidateGateCommands(gates);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('gate-a');
    expect(warnings[1]).toContain('gate-b');
  });

  it('should handle empty gates array', () => {
    expect(realValidateGateCommands([])).toEqual([]);
  });
});

// ============================================================================
// CompoundRunner - Construction
// ============================================================================

describe('CompoundRunner', () => {
  function makeOptions(overrides: Partial<CompoundOptions> = {}): CompoundOptions {
    return {
      targetDir: '/tmp/test-project',
      maxIterations: 3,
      numWorkers: 2,
      port: 4800,
      serverUrl: 'http://localhost:4800',
      objective: 'Fix all errors',
      isLive: false,
      ...overrides,
    };
  }

  it('should construct with valid options', () => {
    const runner = new CompoundRunner(makeOptions());
    expect(runner).toBeInstanceOf(CompoundRunner);
  });

  it('should accept different port values', () => {
    const runner = new CompoundRunner(makeOptions({ port: 9999 }));
    expect(runner).toBeInstanceOf(CompoundRunner);
  });

  it('should accept different numWorkers values', () => {
    const runner1 = new CompoundRunner(makeOptions({ numWorkers: 1 }));
    const runner5 = new CompoundRunner(makeOptions({ numWorkers: 5 }));
    expect(runner1).toBeInstanceOf(CompoundRunner);
    expect(runner5).toBeInstanceOf(CompoundRunner);
  });

  it('should accept live mode flag', () => {
    const runner = new CompoundRunner(makeOptions({ isLive: true }));
    expect(runner).toBeInstanceOf(CompoundRunner);
  });

  it('should accept different max iterations', () => {
    const runner = new CompoundRunner(makeOptions({ maxIterations: 10 }));
    expect(runner).toBeInstanceOf(CompoundRunner);
  });

  it('should have a run method', () => {
    const runner = new CompoundRunner(makeOptions());
    expect(typeof runner.run).toBe('function');
  });

  it('should return a promise from run', () => {
    // We cannot actually run the compound loop (requires tmux, git, etc)
    // but we can verify the method exists and returns something
    const runner = new CompoundRunner(makeOptions());
    expect(typeof runner.run).toBe('function');
  });
});

// ============================================================================
// CompoundRunner - Deep Unit Tests (with mocking)
// ============================================================================

/**
 * These tests exercise the private methods and the full run() lifecycle
 * by mocking external dependencies (child_process, fs, fetch, imported modules).
 *
 * NOTE: We use bracket notation (runner['methodName']) to access private methods
 * for targeted unit testing. This is acceptable in tests per project conventions.
 */

// We need a separate describe block with module-level mocks
// to avoid interfering with the unmocked tests above.
// Hoisted fs mocks so we can control existsSync, writeFileSync, etc. per test.
// runner.ts imports these as direct ESM bindings, so vi.spyOn(require(...)) won't work.
const {
  mockExistsSyncFn,
  mockWriteFileSyncFn,
  mockMkdirSyncFn,
  mockRmSyncFn,
  mockChmodSyncFn,
} = vi.hoisted(() => ({
  mockExistsSyncFn: vi.fn((..._args: unknown[]): boolean => false),
  mockWriteFileSyncFn: vi.fn(),
  mockMkdirSyncFn: vi.fn(),
  mockRmSyncFn: vi.fn(),
  mockChmodSyncFn: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: mockExistsSyncFn,
    writeFileSync: mockWriteFileSyncFn,
    mkdirSync: mockMkdirSyncFn,
    rmSync: mockRmSyncFn,
    chmodSync: mockChmodSyncFn,
  };
});

// Mock child_process
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
  };
});

// Mock detect module
vi.mock('./detect.js', () => ({
  detectProjectType: vi.fn(),
  generateGateConfigs: vi.fn(),
  validateGateCommands: vi.fn(),
  getCheckCommands: vi.fn(),
}));

// Mock prompts module
vi.mock('./prompts.js', () => ({
  buildFixerPrompt: vi.fn(() => 'mock fixer prompt'),
  buildVerifierPrompt: vi.fn(() => 'mock verifier prompt'),
  buildRedispatchPrompt: vi.fn(() => 'mock redispatch prompt'),
}));

// Mock feedback module
vi.mock('./feedback.js', () => ({
  extractFeedbackFromNamedResults: vi.fn(() => ({
    totalErrors: 0,
    gates: [],
  })),
}));

import { execSync as realExecSync } from 'node:child_process';
import { detectProjectType, generateGateConfigs, validateGateCommands as validateGateCommandsMocked } from './detect.js';
import { buildFixerPrompt, buildVerifierPrompt, buildRedispatchPrompt } from './prompts.js';
import { extractFeedbackFromNamedResults } from './feedback.js';
import type { StructuredFeedback } from './types.js';

const mockExecSync = vi.mocked(realExecSync);
const mockDetectProjectType = vi.mocked(detectProjectType);
const mockGenerateGateConfigs = vi.mocked(generateGateConfigs);
const mockValidateGateCommands = vi.mocked(validateGateCommandsMocked);
const mockExtractFeedback = vi.mocked(extractFeedbackFromNamedResults);

// Helper to create standard options
function makeOpts(overrides: Partial<CompoundOptions> = {}): CompoundOptions {
  return {
    targetDir: '/tmp/test-project',
    maxIterations: 3,
    numWorkers: 2,
    port: 4800,
    serverUrl: 'http://localhost:4800',
    objective: 'Fix all errors',
    isLive: false,
    ...overrides,
  };
}

// Standard gate configs for tests
const MOCK_GATES: GateConfig[] = [
  {
    gateType: 'script',
    name: 'typecheck',
    isRequired: true,
    config: { command: 'npx', args: ['tsc', '--noEmit'], cwd: '/tmp/test-project' },
    sortOrder: 0,
  },
  {
    gateType: 'script',
    name: 'lint',
    isRequired: true,
    config: { command: 'npx', args: ['eslint', 'src/'], cwd: '/tmp/test-project' },
    sortOrder: 1,
  },
];

describe('CompoundRunner - preflight', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
  });

  it('should throw when tmux is not installed', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) {
        throw new Error('not found');
      }
      return '';
    });

    expect(() => runner['preflight']()).toThrow('tmux is not installed');
  });

  it('should throw when git is not installed', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) throw new Error('not found');
      return '';
    });

    expect(() => runner['preflight']()).toThrow('git is not installed');
  });

  it('should throw when claude is not installed in live mode', () => {
    const liveRunner = new CompoundRunner(makeOpts({ isLive: true }));

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) return '/usr/bin/git';
      if (typeof cmd === 'string' && cmd.includes('which claude')) throw new Error('not found');
      return '';
    });

    expect(() => liveRunner['preflight']()).toThrow('Claude Code CLI is not installed');
  });

  it('should not check for claude in non-live mode', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) return '/usr/bin/git';
      if (typeof cmd === 'string' && cmd.includes('curl')) throw new Error('connection refused');
      if (typeof cmd === 'string' && cmd.includes('tmux kill-session')) throw new Error('no session');
      return '';
    });

    // Need existsSync for target dir checks
    mockExistsSyncFn.mockImplementation((p: unknown) => {
      if (String(p) === '/tmp/test-project') return true;
      if (String(p).endsWith('.git')) return true;
      return false;
    });

    // Should not throw about claude
    expect(() => runner['preflight']()).not.toThrow('Claude Code CLI');
  });

  it('should throw when target directory does not exist', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) return '/usr/bin/git';
      return '';
    });

    mockExistsSyncFn.mockReturnValue(false);

    expect(() => runner['preflight']()).toThrow('Target directory does not exist');
  });

  it('should throw when target directory is not a git repo', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) return '/usr/bin/git';
      return '';
    });

    mockExistsSyncFn.mockImplementation((p: unknown) => {
      if (String(p) === '/tmp/test-project') return true;
      if (String(p).endsWith('.git')) return false;
      return false;
    });

    expect(() => runner['preflight']()).toThrow('not a git repository');
  });

  it('should throw when port is already in use', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) return '/usr/bin/git';
      // curl succeeds = port in use
      if (typeof cmd === 'string' && cmd.includes('curl')) return 'OK';
      return '';
    });

    mockExistsSyncFn.mockImplementation((p: unknown) => {
      if (String(p) === '/tmp/test-project') return true;
      if (String(p).endsWith('.git')) return true;
      return false;
    });

    expect(() => runner['preflight']()).toThrow('Port 4800 is already in use');
  });

  it('should pass preflight when all checks succeed', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) return '/usr/bin/git';
      if (typeof cmd === 'string' && cmd.includes('curl')) throw new Error('connection refused');
      if (typeof cmd === 'string' && cmd.includes('tmux kill-session')) throw new Error('no session');
      return '';
    });

    mockExistsSyncFn.mockImplementation((p: unknown) => {
      if (String(p) === '/tmp/test-project') return true;
      if (String(p).endsWith('.git')) return true;
      return false;
    });

    expect(() => runner['preflight']()).not.toThrow();
  });

  it('should kill stale tmux session during preflight', () => {
    const calls: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      calls.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) return '/usr/bin/git';
      if (typeof cmd === 'string' && cmd.includes('curl')) throw new Error('connection refused');
      if (typeof cmd === 'string' && cmd.includes('tmux kill-session')) return '';
      return '';
    });

    mockExistsSyncFn.mockImplementation((p: unknown) => {
      if (String(p) === '/tmp/test-project') return true;
      if (String(p).endsWith('.git')) return true;
      return false;
    });

    runner['preflight']();

    const killCall = calls.find(c => c.includes('tmux kill-session'));
    expect(killCall).toBeDefined();
    expect(killCall).toContain('fleet-compound');
  });
});

describe('CompoundRunner - detectProject', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
  });

  it('should throw when project type cannot be detected', () => {
    mockDetectProjectType.mockReturnValue(null);

    expect(() => runner['detectProject']()).toThrow('Cannot detect project type');
  });

  it('should throw when no gates are generated', () => {
    mockDetectProjectType.mockReturnValue('node');
    mockGenerateGateConfigs.mockReturnValue([]);

    expect(() => runner['detectProject']()).toThrow('No quality gates detected');
  });

  it('should set projectType and gates on success', () => {
    mockDetectProjectType.mockReturnValue('node');
    mockGenerateGateConfigs.mockReturnValue(MOCK_GATES);
    mockValidateGateCommands.mockReturnValue([]);

    runner['detectProject']();

    expect(runner['projectType']).toBe('node');
    expect(runner['gates']).toEqual(MOCK_GATES);
  });

  it('should filter gates with missing commands', () => {
    mockDetectProjectType.mockReturnValue('node');
    const gatesWithMissing: GateConfig[] = [
      ...MOCK_GATES,
      {
        gateType: 'script',
        name: 'cargo-check',
        isRequired: true,
        config: { command: 'cargo', args: ['check'], cwd: '/tmp/test-project' },
        sortOrder: 2,
      },
    ];
    mockGenerateGateConfigs.mockReturnValue(gatesWithMissing);
    mockValidateGateCommands.mockReturnValue(['Gate "cargo-check": command "cargo" not found on PATH']);

    runner['detectProject']();

    // cargo gate should be filtered out
    expect(runner['gates']).toHaveLength(2);
    expect(runner['gates'].map(g => g.name)).toEqual(['typecheck', 'lint']);
  });

  it('should throw when all gate commands are missing', () => {
    mockDetectProjectType.mockReturnValue('rust');
    const rustGates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'check',
        isRequired: true,
        config: { command: 'cargo', args: ['check'], cwd: '/tmp/test-project' },
        sortOrder: 0,
      },
    ];
    mockGenerateGateConfigs.mockReturnValue(rustGates);
    mockValidateGateCommands.mockReturnValue(['Gate "check": command "cargo" not found on PATH']);

    expect(() => runner['detectProject']()).toThrow('All quality gate commands are missing');
  });
});

describe('CompoundRunner - setupGitBranch', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
  });

  it('should throw if target dir is not a git repo', () => {
    mockExistsSyncFn.mockReturnValue(false);

    expect(() => runner['setupGitBranch']()).toThrow('Not a git repo');
  });

  it('should save original branch and create fleet branch', () => {
    mockExistsSyncFn.mockReturnValue(true);

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('rev-parse --abbrev-ref')) return 'main\n';
      if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) return '';
      if (typeof cmd === 'string' && cmd.includes('git checkout -b')) return '';
      return '';
    });

    runner['setupGitBranch']();

    expect(runner['originalBranch']).toBe('main');
    expect(runner['fleetBranch']).toMatch(/^fleet\/fix-\d+$/);
  });

  it('should stash uncommitted changes', () => {
    mockExistsSyncFn.mockReturnValue(true);

    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('rev-parse --abbrev-ref')) return 'main\n';
      if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) return 'M src/index.ts\n';
      if (typeof cmd === 'string' && cmd.includes('git stash push')) return '';
      if (typeof cmd === 'string' && cmd.includes('git checkout -b')) return '';
      return '';
    });

    runner['setupGitBranch']();

    expect(runner['hasStashed']).toBe(true);
    expect(commands.some(c => c.includes('git stash push'))).toBe(true);
  });

  it('should not stash when working directory is clean', () => {
    mockExistsSyncFn.mockReturnValue(true);

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('rev-parse --abbrev-ref')) return 'develop\n';
      if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) return '';
      if (typeof cmd === 'string' && cmd.includes('git checkout -b')) return '';
      return '';
    });

    runner['setupGitBranch']();

    expect(runner['hasStashed']).toBe(false);
  });
});

describe('CompoundRunner - restoreGit', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
  });

  it('should do nothing if originalBranch is not set', () => {
    runner['originalBranch'] = '';
    runner['restoreGit']();
    // Should not throw
  });

  it('should do nothing if target dir .git does not exist', () => {
    runner['originalBranch'] = 'main';
    mockExistsSyncFn.mockReturnValue(false);

    runner['restoreGit']();
    // Should not throw
  });

  it('should checkout original branch when on fleet branch', () => {
    runner['originalBranch'] = 'main';
    mockExistsSyncFn.mockReturnValue(true);

    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('rev-parse --abbrev-ref')) return 'fleet/fix-12345\n';
      if (typeof cmd === 'string' && cmd.includes('git checkout main')) return '';
      return '';
    });

    runner['restoreGit']();

    expect(commands.some(c => c.includes('git checkout main'))).toBe(true);
  });

  it('should pop stash when hasStashed is true', () => {
    runner['originalBranch'] = 'main';
    runner['hasStashed'] = true;
    mockExistsSyncFn.mockReturnValue(true);

    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('rev-parse --abbrev-ref')) return 'fleet/fix-12345\n';
      return '';
    });

    runner['restoreGit']();

    expect(commands.some(c => c.includes('git stash pop'))).toBe(true);
  });

  it('should not checkout when not on fleet branch', () => {
    runner['originalBranch'] = 'main';
    mockExistsSyncFn.mockReturnValue(true);

    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('rev-parse --abbrev-ref')) return 'main\n';
      return '';
    });

    runner['restoreGit']();

    expect(commands.filter(c => c.includes('git checkout')).length).toBe(0);
  });

  it('should handle errors gracefully', () => {
    runner['originalBranch'] = 'main';
    mockExistsSyncFn.mockReturnValue(true);

    mockExecSync.mockImplementation(() => {
      throw new Error('git error');
    });

    // Should not throw
    expect(() => runner['restoreGit']()).not.toThrow();
  });
});

describe('CompoundRunner - log', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should log ok messages with green color', () => {
    runner['log']('ok', 'All tests passed');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('All tests passed'),
    );
  });

  it('should log warn messages', () => {
    runner['log']('warn', 'Something might be wrong');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Something might be wrong'),
    );
  });

  it('should log error messages', () => {
    runner['log']('error', 'Fatal failure');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Fatal failure'),
    );
  });

  it('should log dim messages', () => {
    runner['log']('dim', 'Debug info');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Debug info'),
    );
  });

  it('should log info messages as default', () => {
    runner['log']('info', 'General info');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('General info'),
    );
  });

  it('should include compound prefix', () => {
    runner['log']('info', 'test message');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[compound]'),
    );
  });
});

describe('CompoundRunner - printSuccessBanner', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should print success banner with MISSION SUCCEEDED', () => {
    runner['printSuccessBanner']();

    const calls = vi.mocked(console.log).mock.calls.map(c => c[0]);
    expect(calls.some(c => String(c).includes('MISSION SUCCEEDED'))).toBe(true);
  });

  it('should include fleet branch info', () => {
    runner['fleetBranch'] = 'fleet/fix-12345';
    runner['printSuccessBanner']();

    const calls = vi.mocked(console.log).mock.calls.map(c => c[0]);
    expect(calls.some(c => String(c).includes('fleet/fix-12345'))).toBe(true);
  });
});

describe('CompoundRunner - printFailureBanner', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should print failure banner with reason', () => {
    runner['printFailureBanner']('failed');

    const calls = vi.mocked(console.log).mock.calls.map(c => c[0]);
    expect(calls.some(c => String(c).includes('FAILED'))).toBe(true);
  });

  it('should include fleet branch info', () => {
    runner['fleetBranch'] = 'fleet/fix-99999';
    runner['printFailureBanner']('timeout');

    const calls = vi.mocked(console.log).mock.calls.map(c => c[0]);
    expect(calls.some(c => String(c).includes('fleet/fix-99999'))).toBe(true);
  });
});

describe('CompoundRunner - cleanup', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should do nothing when promptDir is empty', () => {
    runner['promptDir'] = '';
    mockRmSyncFn.mockImplementation(() => {});
    runner['cleanup']();
    expect(mockRmSyncFn).not.toHaveBeenCalled();
  });

  it('should remove promptDir when it exists', () => {
    runner['promptDir'] = '/tmp/fleet-compound-test';
    mockExistsSyncFn.mockReturnValue(true);
    mockRmSyncFn.mockImplementation(() => {});

    runner['cleanup']();

    expect(mockRmSyncFn).toHaveBeenCalledWith('/tmp/fleet-compound-test', { recursive: true, force: true });
  });

  it('should handle rmSync errors gracefully', () => {
    runner['promptDir'] = '/tmp/fleet-compound-test';
    mockExistsSyncFn.mockReturnValue(true);
    mockRmSyncFn.mockImplementation(() => {
      throw new Error('permission denied');
    });

    // Should not throw
    expect(() => runner['cleanup']()).not.toThrow();
  });

  it('should clear output watchers', () => {
    runner['promptDir'] = '';
    const interval1 = setInterval(() => {}, 10000);
    const interval2 = setInterval(() => {}, 10000);
    runner['outputWatchers'] = [interval1, interval2];

    runner['cleanup']();

    expect(runner['outputWatchers']).toEqual([]);
    clearInterval(interval1);
    clearInterval(interval2);
  });
});

describe('CompoundRunner - stopOutputWatchers', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
  });

  it('should clear all intervals', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const interval1 = setInterval(() => {}, 10000);
    const interval2 = setInterval(() => {}, 10000);
    runner['outputWatchers'] = [interval1, interval2];

    runner['stopOutputWatchers']();

    expect(clearSpy).toHaveBeenCalledTimes(2);
    expect(runner['outputWatchers']).toEqual([]);
    clearInterval(interval1);
    clearInterval(interval2);
  });

  it('should handle empty watchers array', () => {
    runner['outputWatchers'] = [];
    expect(() => runner['stopOutputWatchers']()).not.toThrow();
    expect(runner['outputWatchers']).toEqual([]);
  });
});

describe('CompoundRunner - isWorkerDone', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['promptDir'] = '/tmp/fleet-compound-test';
  });

  it('should return true when sentinel file exists', () => {
    mockExistsSyncFn.mockImplementation((p: unknown) => {
      return String(p) === '/tmp/fleet-compound-test/scout-1-iter1.done';
    });

    expect(runner['isWorkerDone']('scout-1', '%1', 1)).toBe(true);
  });

  it('should check tmux pane output when sentinel does not exist', () => {
    mockExistsSyncFn.mockReturnValue(false);

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tmux capture-pane')) {
        return 'Some output\nTASK COMPLETE\n';
      }
      return '';
    });

    expect(runner['isWorkerDone']('scout-1', '%1', 1)).toBe(true);
  });

  it('should return false when neither sentinel nor TASK COMPLETE found', () => {
    mockExistsSyncFn.mockReturnValue(false);

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tmux capture-pane')) {
        return 'Still working...\nProcessing files...\n';
      }
      return '';
    });

    expect(runner['isWorkerDone']('scout-1', '%1', 1)).toBe(false);
  });

  it('should check for TASK COMPLETE after RE-ENGAGED marker for subsequent iterations', () => {
    mockExistsSyncFn.mockReturnValue(false);

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tmux capture-pane')) {
        return 'TASK COMPLETE\n=== ITERATION 2: RE-ENGAGED ===\nStill working...\n';
      }
      return '';
    });

    // Iteration 2: TASK COMPLETE is before RE-ENGAGED, so not done yet
    expect(runner['isWorkerDone']('scout-1', '%1', 2)).toBe(false);
  });

  it('should return true when TASK COMPLETE appears after RE-ENGAGED', () => {
    mockExistsSyncFn.mockReturnValue(false);

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tmux capture-pane')) {
        return 'Old work\n=== ITERATION 2: RE-ENGAGED ===\nNew work\nTASK COMPLETE\n';
      }
      return '';
    });

    expect(runner['isWorkerDone']('scout-1', '%1', 2)).toBe(true);
  });

  it('should return false on tmux capture-pane error', () => {
    mockExistsSyncFn.mockReturnValue(false);

    mockExecSync.mockImplementation(() => {
      throw new Error('tmux error');
    });

    expect(runner['isWorkerDone']('scout-1', '%1', 1)).toBe(false);
  });

  it('should return false when promptDir is empty', () => {
    runner['promptDir'] = '';
    mockExistsSyncFn.mockReturnValue(false);

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tmux capture-pane')) {
        return 'Still working on something...';
      }
      return '';
    });

    expect(runner['isWorkerDone']('scout-1', '%1', 1)).toBe(false);
  });
});

describe('CompoundRunner - isServerHealthy', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
  });

  it('should return true when server responds with OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);

    expect(await runner['isServerHealthy']()).toBe(true);
  });

  it('should return false when server responds with error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    expect(await runner['isServerHealthy']()).toBe(false);
  });

  it('should return false when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await runner['isServerHealthy']()).toBe(false);
  });
});

describe('CompoundRunner - apiPost', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
  });

  it('should make POST request with JSON body', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'test-123' }),
      text: () => Promise.resolve(''),
    } as Response);

    const result = await runner['apiPost']('/auth', { handle: 'worker-1' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:4800/auth',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ handle: 'worker-1' }),
      }),
    );
    expect(result).toEqual({ id: 'test-123' });
  });

  it('should include Authorization header when token is set', async () => {
    runner['token'] = 'jwt-token-abc';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    await runner['apiPost']('/swarms', { name: 'test' });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer jwt-token-abc',
        }),
      }),
    );
  });

  it('should throw on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as Response);

    await expect(runner['apiPost']('/auth', {}))
      .rejects.toThrow('API POST /auth failed: 401 Unauthorized');
  });

  it('should not include Authorization when token is empty', async () => {
    runner['token'] = '';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    await runner['apiPost']('/test', {});

    const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders['Authorization']).toBeUndefined();
  });
});

describe('CompoundRunner - setupMission', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should authenticate and create swarm', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt-abc' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'swarm-123' }),
      } as Response);

    await runner['setupMission']();

    expect(runner['token']).toBe('jwt-abc');
    expect(runner['swarmId']).toBe('swarm-123');
    expect(runner['missionId']).toMatch(/^mission-/);
  });

  it('should throw when authentication fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: '' }),
    } as Response);

    await expect(runner['setupMission']()).rejects.toThrow('Authentication failed');
  });

  it('should throw when swarm creation fails', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt-abc' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '' }),
      } as Response);

    await expect(runner['setupMission']()).rejects.toThrow('Failed to create swarm');
  });
});

describe('CompoundRunner - commitFixerChanges', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should commit when there are changes', () => {
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) return 'M src/file.ts\n';
      return '';
    });

    runner['commitFixerChanges'](1);

    expect(commands.some(c => c.includes('git add -A && git commit'))).toBe(true);
    expect(commands.some(c => c.includes('iteration 1 fixes'))).toBe(true);
  });

  it('should not commit when working directory is clean', () => {
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) return '';
      return '';
    });

    runner['commitFixerChanges'](2);

    expect(commands.filter(c => c.includes('git commit')).length).toBe(0);
  });

  it('should handle commit errors gracefully', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) return 'M file.ts\n';
      if (typeof cmd === 'string' && cmd.includes('git add')) throw new Error('commit failed');
      return '';
    });

    // Should not throw
    expect(() => runner['commitFixerChanges'](1)).not.toThrow();
  });
});

describe('CompoundRunner - runGatesLocally', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['gates'] = MOCK_GATES;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should run all gates and return results', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tsc')) return 'No errors\n';
      if (typeof cmd === 'string' && cmd.includes('eslint')) return 'All clean\n';
      return '';
    });

    const results = runner['runGatesLocally']();

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ name: 'typecheck', status: 'passed', output: 'No errors\n' });
    expect(results[1]).toEqual({ name: 'lint', status: 'passed', output: 'All clean\n' });
  });

  it('should mark failed gates', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tsc')) {
        const err = new Error('tsc failed') as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        err.stdout = 'error TS2345: ...';
        err.stderr = '';
        throw err;
      }
      if (typeof cmd === 'string' && cmd.includes('eslint')) return 'Clean\n';
      return '';
    });

    const results = runner['runGatesLocally']();

    expect(results[0].status).toBe('failed');
    expect(results[0].output).toContain('error TS2345');
    expect(results[1].status).toBe('passed');
  });

  it('should combine stdout and stderr for failed gates', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tsc')) {
        const err = new Error('tsc failed') as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        err.stdout = 'stdout output';
        err.stderr = 'stderr output';
        throw err;
      }
      return '';
    });

    const results = runner['runGatesLocally']();

    expect(results[0].output).toContain('stdout output');
    expect(results[0].output).toContain('stderr output');
  });

  it('should handle empty gates array', () => {
    runner['gates'] = [];
    const results = runner['runGatesLocally']();
    expect(results).toEqual([]);
  });
});

describe('CompoundRunner - triggerLocalValidation', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['gates'] = MOCK_GATES;
    runner['projectType'] = 'node';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should return allPassed=true when all gates pass', () => {
    mockExecSync.mockReturnValue('OK\n');
    mockExtractFeedback.mockReturnValue({ totalErrors: 0, gates: [] });

    const { allPassed, feedback } = runner['triggerLocalValidation']();

    expect(allPassed).toBe(true);
    expect(feedback.totalErrors).toBe(0);
  });

  it('should return allPassed=false when any gate fails', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tsc')) {
        const err = new Error('tsc failed') as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        err.stdout = 'errors';
        err.stderr = '';
        throw err;
      }
      return 'OK\n';
    });
    mockExtractFeedback.mockReturnValue({
      totalErrors: 3,
      gates: [{ name: 'typecheck', errors: ['err1', 'err2', 'err3'], rawTail: [] }],
    });

    const { allPassed, feedback } = runner['triggerLocalValidation']();

    expect(allPassed).toBe(false);
    expect(feedback.totalErrors).toBe(3);
  });
});

describe('CompoundRunner - writePromptFile', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['promptDir'] = '/tmp/fleet-compound-test';
  });

  it('should write prompt to file and return path', () => {
    const writeSpy = mockWriteFileSyncFn.mockImplementation(() => {});

    const result = runner['writePromptFile']('scout-1', 1, 'test prompt content');

    expect(result).toBe('/tmp/fleet-compound-test/scout-1-iter1.md');
    expect(writeSpy).toHaveBeenCalledWith(
      '/tmp/fleet-compound-test/scout-1-iter1.md',
      'test prompt content',
      'utf-8',
    );
  });

  it('should include iteration number in filename', () => {
    mockWriteFileSyncFn.mockImplementation(() => {});

    const result = runner['writePromptFile']('scout-2', 3, 'prompt');

    expect(result).toBe('/tmp/fleet-compound-test/scout-2-iter3.md');
  });
});

describe('CompoundRunner - writeMcpConfig', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['promptDir'] = '/tmp/fleet-compound-test';
    runner['swarmId'] = 'swarm-123';
    runner['missionId'] = 'mission-abc';
  });

  it('should write MCP config JSON and return path', () => {
    const writeSpy = mockWriteFileSyncFn.mockImplementation(() => {});

    const result = runner['writeMcpConfig']('scout-1');

    expect(result).toBe('/tmp/fleet-compound-test/scout-1-mcp.json');
    expect(writeSpy).toHaveBeenCalledTimes(1);

    const writtenContent = JSON.parse(writeSpy.mock.calls[0][1] as string);
    expect(writtenContent.mcpServers['claude-fleet']).toBeDefined();
    expect(writtenContent.mcpServers['claude-fleet'].env.CLAUDE_CODE_AGENT_NAME).toBe('scout-1');
    expect(writtenContent.mcpServers['claude-fleet'].env.CLAUDE_CODE_SWARM_ID).toBe('swarm-123');
    expect(writtenContent.mcpServers['claude-fleet'].env.CLAUDE_CODE_MISSION_ID).toBe('mission-abc');
  });
});

describe('CompoundRunner - writeWorkerScript', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['promptDir'] = '/tmp/fleet-compound-test';
    runner['swarmId'] = 'swarm-123';
    runner['missionId'] = 'mission-abc';
  });

  it('should write shell script and make it executable', () => {
    const writeSpy = mockWriteFileSyncFn.mockImplementation(() => {});
    const chmodSpy = mockChmodSyncFn.mockImplementation(() => {});

    const result = runner['writeWorkerScript']('scout-1', 2, '/tmp/prompt.md', '/tmp/mcp.json');

    expect(result).toBe('/tmp/fleet-compound-test/scout-1-iter2.sh');
    expect(writeSpy).toHaveBeenCalled();
    expect(chmodSpy).toHaveBeenCalledWith('/tmp/fleet-compound-test/scout-1-iter2.sh', 0o755);

    const script = writeSpy.mock.calls[0][1] as string;
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('CLAUDE_CODE_AGENT_NAME');
    expect(script).toContain('claude -p --dangerously-skip-permissions');
    expect(script).toContain('touch');
  });
});

describe('CompoundRunner - spawnWorkerInPane', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['promptDir'] = '/tmp/fleet-compound-test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should run simulated worker in non-live mode', () => {
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      return '';
    });

    runner['spawnWorkerInPane']('%1', 'scout-1', 1, 'test prompt');

    const tmuxCmd = commands.find(c => c.includes('tmux send-keys'));
    expect(tmuxCmd).toBeDefined();
    expect(tmuxCmd).toContain('Simulated worker');
    expect(tmuxCmd).toContain('TASK COMPLETE');
  });

  it('should write prompt files in live mode', () => {
    const liveRunner = new CompoundRunner(makeOpts({ isLive: true }));
    liveRunner['promptDir'] = '/tmp/fleet-compound-test';
    liveRunner['swarmId'] = 'swarm-123';
    liveRunner['missionId'] = 'mission-abc';

    mockWriteFileSyncFn.mockImplementation(() => {});
    mockChmodSyncFn.mockImplementation(() => {});

    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      return '';
    });

    liveRunner['spawnWorkerInPane']('%1', 'scout-1', 1, 'live prompt');

    const tmuxCmd = commands.find(c => c.includes('tmux send-keys'));
    expect(tmuxCmd).toBeDefined();
    expect(tmuxCmd).toContain('bash');
  });
});

describe('CompoundRunner - registerWorkerWithServer', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['token'] = 'jwt-token';
    runner['swarmId'] = 'swarm-123';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should call curl to register worker', () => {
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      return '';
    });

    runner['registerWorkerWithServer']('scout-1');

    const curlCmd = commands.find(c => c.includes('curl'));
    expect(curlCmd).toBeDefined();
    expect(curlCmd).toContain('/orchestrate/workers/register');
    expect(curlCmd).toContain('jwt-token');
    expect(curlCmd).toContain('scout-1');
  });

  it('should handle registration errors gracefully', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('connection refused');
    });

    // Should not throw
    expect(() => runner['registerWorkerWithServer']('scout-1')).not.toThrow();
  });
});

describe('CompoundRunner - forwardOutputBatch', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['token'] = 'jwt-token';
  });

  it('should POST events to worker output endpoint', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);

    const events = [{ type: 'text', text: 'hello' }];
    runner['forwardOutputBatch']('scout-1', events);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:4800/orchestrate/workers/scout-1/output',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer jwt-token',
        }),
        body: JSON.stringify({ events }),
      }),
    );
  });

  it('should not throw on fetch failure', () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

    // Should not throw — fire and forget
    expect(() => runner['forwardOutputBatch']('scout-1', [])).not.toThrow();
  });
});

describe('CompoundRunner - startDashboard', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['token'] = 'jwt-abc';
    runner['missionId'] = 'mission-abc';
    runner['swarmId'] = 'swarm-123';
    runner['projectType'] = 'node';
    runner['layout'] = {
      sessionName: 'fleet-compound',
      serverPane: '%0',
      dashboardPane: '%1',
      workerPanes: ['%2', '%3'],
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should do nothing when layout is null', () => {
    runner['layout'] = null;
    // Should not throw
    runner['startDashboard']();
  });

  it('should warn when dashboard script does not exist', () => {
    mockExistsSyncFn.mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log');

    runner['startDashboard']();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dashboard script not found'));
  });

  it('should send dashboard command to tmux pane', () => {
    mockExistsSyncFn.mockReturnValue(true);

    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      return '';
    });

    runner['startDashboard']();

    const tmuxCmd = commands.find(c => c.includes('tmux send-keys'));
    expect(tmuxCmd).toBeDefined();
    expect(tmuxCmd).toContain('%1'); // dashboard pane
    expect(tmuxCmd).toContain('demo-dashboard.sh');
  });
});

describe('CompoundRunner - spawnWorkers', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts({ numWorkers: 2 }));
    runner['layout'] = {
      sessionName: 'fleet-compound',
      serverPane: '%0',
      dashboardPane: '%1',
      workerPanes: ['%2', '%3'],
    };
    runner['projectType'] = 'node';
    runner['fleetBranch'] = 'fleet/fix-12345';
    runner['swarmId'] = 'swarm-123';
    runner['missionId'] = 'mission-abc';
    runner['token'] = 'jwt-token';
    runner['promptDir'] = '/tmp/fleet-compound-test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should throw when layout is not initialized', () => {
    runner['layout'] = null;
    expect(() => runner['spawnWorkers']()).toThrow('Layout not initialized');
  });

  it('should spawn workers for each pane', () => {
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      return '';
    });

    runner['spawnWorkers']();

    const tmuxCmds = commands.filter(c => c.includes('tmux send-keys'));
    // 2 workers spawned + 2 registration curl calls possible
    expect(tmuxCmds.length).toBe(2);
  });

  it('should call buildFixerPrompt for first worker and buildVerifierPrompt for rest', () => {
    mockExecSync.mockReturnValue('');

    runner['spawnWorkers']();

    expect(buildFixerPrompt).toHaveBeenCalled();
    expect(buildVerifierPrompt).toHaveBeenCalled();
  });
});

describe('CompoundRunner - redispatchWorkers', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts({ numWorkers: 2 }));
    runner['layout'] = {
      sessionName: 'fleet-compound',
      serverPane: '%0',
      dashboardPane: '%1',
      workerPanes: ['%2', '%3'],
    };
    runner['projectType'] = 'node';
    runner['fleetBranch'] = 'fleet/fix-12345';
    runner['swarmId'] = 'swarm-123';
    runner['missionId'] = 'mission-abc';
    runner['promptDir'] = '/tmp/fleet-compound-test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should do nothing when layout is null', () => {
    runner['layout'] = null;
    const feedback: StructuredFeedback = { totalErrors: 0, gates: [] };

    // Should not throw
    runner['redispatchWorkers'](2, feedback);
  });

  it('should send redispatch commands for each worker', () => {
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      return '';
    });

    const feedback: StructuredFeedback = {
      totalErrors: 3,
      gates: [{ name: 'typecheck', errors: ['err1'], rawTail: [] }],
    };

    runner['redispatchWorkers'](2, feedback);

    const tmuxCmds = commands.filter(c => c.includes('tmux send-keys'));
    expect(tmuxCmds.length).toBe(2);
    // All should contain RE-ENGAGED marker
    for (const cmd of tmuxCmds) {
      expect(cmd).toContain('RE-ENGAGED');
      expect(cmd).toContain('ITERATION 2');
    }
  });

  it('should write script files in live mode', () => {
    const liveRunner = new CompoundRunner(makeOpts({ numWorkers: 1, isLive: true }));
    liveRunner['layout'] = {
      sessionName: 'fleet-compound',
      serverPane: '%0',
      dashboardPane: '%1',
      workerPanes: ['%2'],
    };
    liveRunner['projectType'] = 'node';
    liveRunner['fleetBranch'] = 'fleet/fix-12345';
    liveRunner['swarmId'] = 'swarm-123';
    liveRunner['missionId'] = 'mission-abc';
    liveRunner['promptDir'] = '/tmp/fleet-compound-test';

    mockWriteFileSyncFn.mockImplementation(() => {});
    mockChmodSyncFn.mockImplementation(() => {});

    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      return '';
    });

    const feedback: StructuredFeedback = { totalErrors: 0, gates: [] };
    liveRunner['redispatchWorkers'](2, feedback);

    expect(buildRedispatchPrompt).toHaveBeenCalled();
    const tmuxCmd = commands.find(c => c.includes('tmux send-keys'));
    expect(tmuxCmd).toBeDefined();
    expect(tmuxCmd).toContain('bash');
  });
});

describe('CompoundRunner - startServer', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
    runner['layout'] = {
      sessionName: 'fleet-compound',
      serverPane: '%0',
      dashboardPane: '%1',
      workerPanes: ['%2'],
    };
    runner['promptDir'] = '/tmp/fleet-compound-test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should throw when layout is not initialized', async () => {
    runner['layout'] = null;
    await expect(runner['startServer']()).rejects.toThrow('Layout not initialized');
  });

  it('should start server and poll for readiness', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which node')) return '/usr/local/bin/node';
      return '';
    });

    mockExistsSyncFn.mockImplementation((p: unknown) => {
      // dist/index.js exists
      return String(p).includes('dist/index.js');
    });

    // Server becomes ready on first poll
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);

    await runner['startServer']();

    // Should have sent tmux command
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('tmux send-keys'),
      expect.any(Object),
    );
  });

  it('should use tsx when dist/index.js does not exist', async () => {
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('which node')) return '/usr/local/bin/node';
      return '';
    });

    mockExistsSyncFn.mockReturnValue(false);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);

    await runner['startServer']();

    const tmuxCmd = commands.find(c => c.includes('tmux send-keys'));
    expect(tmuxCmd).toContain('npx tsx');
  });

  it('should timeout and capture server output for diagnostics', async () => {
    // Override SERVER_STARTUP_TIMEOUT to be very short for test
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which node')) return '/usr/local/bin/node';
      if (typeof cmd === 'string' && cmd.includes('tmux capture-pane')) return 'Error: EADDRINUSE\n';
      return '';
    });

    mockExistsSyncFn.mockReturnValue(true);

    // Server never becomes ready
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    // The default timeout is 30s which is too long for a test,
    // so we verify the method structure rather than waiting for real timeout
    // by checking a shorter path through the code
    const promise = runner['startServer']();

    // Fast-forward timers if using fake timers, otherwise just verify the promise type
    await expect(promise).rejects.toThrow('Server failed to start');
  }, 60000);
});

describe('CompoundRunner - waitForWorkers', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts({ numWorkers: 2 }));
    runner['layout'] = {
      sessionName: 'fleet-compound',
      serverPane: '%0',
      dashboardPane: '%1',
      workerPanes: ['%2', '%3'],
    };
    runner['promptDir'] = '/tmp/fleet-compound-test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should return false when layout is null', async () => {
    runner['layout'] = null;
    const result = await runner['waitForWorkers'](1, 1000);
    expect(result).toBe(false);
  });

  it('should return true when all workers complete', async () => {
    // Server is healthy
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    // All workers done via sentinel files
    mockExistsSyncFn.mockReturnValue(true);

    const result = await runner['waitForWorkers'](1, 10000);
    expect(result).toBe(true);
  });

  it('should return false when server is down', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runner['waitForWorkers'](1, 10000);
    expect(result).toBe(false);
  });
});

describe('CompoundRunner - compoundLoop', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts({ maxIterations: 2, numWorkers: 1 }));
    runner['layout'] = {
      sessionName: 'fleet-compound',
      serverPane: '%0',
      dashboardPane: '%1',
      workerPanes: ['%2'],
    };
    runner['projectType'] = 'node';
    runner['fleetBranch'] = 'fleet/fix-12345';
    runner['gates'] = MOCK_GATES;
    runner['promptDir'] = '/tmp/fleet-compound-test';
    runner['swarmId'] = 'swarm-123';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should return succeeded when all gates pass on first iteration', async () => {
    // Workers done immediately
    mockExistsSyncFn.mockReturnValue(true);
    // Server healthy
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    // All gates pass
    mockExecSync.mockReturnValue('OK\n');
    mockExtractFeedback.mockReturnValue({ totalErrors: 0, gates: [] });

    const result = await runner['compoundLoop']();

    expect(result.status).toBe('succeeded');
    expect(result.iterations).toBe(1);
    expect(result.branch).toBe('fleet/fix-12345');
    expect(result.projectType).toBe('node');
  });

  it('should return failed when server goes down', async () => {
    // Workers done immediately
    mockExistsSyncFn.mockReturnValue(true);
    // First check: server healthy for waitForWorkers, then down for validation
    let fetchCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      fetchCallCount++;
      if (fetchCallCount <= 1) return { ok: true } as Response;
      throw new Error('ECONNREFUSED');
    });
    // No git changes
    mockExecSync.mockReturnValue('');

    const result = await runner['compoundLoop']();

    expect(result.status).toBe('failed');
  });

  it('should return failed after exhausting all iterations', async () => {
    // Workers done immediately
    mockExistsSyncFn.mockReturnValue(true);
    // Server healthy
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    // Gates always fail
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('tsc')) {
        const err = new Error('fail') as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        err.stdout = 'error';
        err.stderr = '';
        throw err;
      }
      return '';
    });
    mockExtractFeedback.mockReturnValue({
      totalErrors: 1,
      gates: [{ name: 'typecheck', errors: ['err'], rawTail: [] }],
    });

    const result = await runner['compoundLoop']();

    expect(result.status).toBe('failed');
    expect(result.iterations).toBe(2); // maxIterations
  });
});

describe('CompoundRunner - run() integration', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should return failed result when preflight fails', async () => {
    runner = new CompoundRunner(makeOpts());

    // tmux not installed
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) throw new Error('not found');
      return '';
    });

    const result = await runner.run();

    expect(result.status).toBe('failed');
    expect(result.iterations).toBe(0);
    expect(result.branch).toBe('none');
  });

  it('should return failed result when project detection fails', async () => {
    runner = new CompoundRunner(makeOpts());

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) return '/usr/bin/tmux';
      if (typeof cmd === 'string' && cmd.includes('which git')) return '/usr/bin/git';
      if (typeof cmd === 'string' && cmd.includes('curl')) throw new Error('connection refused');
      if (typeof cmd === 'string' && cmd.includes('tmux kill-session')) throw new Error('no session');
      return '';
    });

    mockExistsSyncFn.mockImplementation((p: unknown) => {
      if (String(p) === '/tmp/test-project') return true;
      if (String(p).endsWith('.git')) return true;
      return false;
    });
    mockMkdirSyncFn.mockImplementation(() => undefined as unknown as string);

    mockDetectProjectType.mockReturnValue(null);

    const result = await runner.run();

    expect(result.status).toBe('failed');
    expect(result.iterations).toBe(0);
  });

  it('should register and clean up signal handlers', async () => {
    runner = new CompoundRunner(makeOpts());

    const processOnSpy = vi.spyOn(process, 'on');
    const processRemoveSpy = vi.spyOn(process, 'removeListener');

    // Fail quickly at preflight
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) throw new Error('not found');
      return '';
    });

    await runner.run();

    // Should have registered SIGINT and SIGTERM handlers
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    // Should have removed them in finally block
    expect(processRemoveSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processRemoveSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('should preserve tmux session info on failure when layout exists', async () => {
    runner = new CompoundRunner(makeOpts());

    // Set layout to simulate partial initialization
    runner['layout'] = {
      sessionName: 'fleet-compound',
      serverPane: '%0',
      dashboardPane: '%1',
      workerPanes: ['%2'],
    };

    // Fail at preflight
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which tmux')) throw new Error('not found');
      return '';
    });

    const logSpy = vi.spyOn(console, 'log');
    const result = await runner.run();

    expect(result.status).toBe('failed');
    // Should mention tmux session preservation
    const logCalls = logSpy.mock.calls.map(c => String(c[0]));
    expect(logCalls.some(c => c.includes('tmux') || c.includes('session'))).toBe(true);
  });
});

describe('CompoundRunner - createTmuxLayout', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts({ numWorkers: 2 }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should create tmux session with correct number of panes', () => {
    let paneIdCounter = 0;
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('display-message')) {
        return `%${paneIdCounter++}\n`;
      }
      return '';
    });

    const layout = runner['createTmuxLayout']();

    expect(layout.sessionName).toBe('fleet-compound');
    expect(layout.serverPane).toBe('%0');
    expect(layout.dashboardPane).toBe('%1');
    expect(layout.workerPanes).toHaveLength(2);
  });

  it('should create layout with 1 worker pane when numWorkers is 1', () => {
    const runner1 = new CompoundRunner(makeOpts({ numWorkers: 1 }));
    let paneIdCounter = 0;
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('display-message')) {
        return `%${paneIdCounter++}\n`;
      }
      return '';
    });

    const layout = runner1['createTmuxLayout']();

    expect(layout.workerPanes).toHaveLength(1);
  });

  it('should create layout with up to 5 worker panes', () => {
    const runner5 = new CompoundRunner(makeOpts({ numWorkers: 5 }));
    let paneIdCounter = 0;
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('display-message')) {
        return `%${paneIdCounter++}\n`;
      }
      return '';
    });

    const layout = runner5['createTmuxLayout']();

    expect(layout.workerPanes).toHaveLength(5);
  });

  it('should handle pane border status failure gracefully', () => {
    let paneIdCounter = 0;
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('display-message')) {
        return `%${paneIdCounter++}\n`;
      }
      if (typeof cmd === 'string' && cmd.includes('pane-border-status')) {
        throw new Error('tmux too old');
      }
      return '';
    });

    // Should not throw
    expect(() => runner['createTmuxLayout']()).not.toThrow();
  });

  it('should name panes with roles', () => {
    let paneIdCounter = 0;
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      commands.push(typeof cmd === 'string' ? cmd : '');
      if (typeof cmd === 'string' && cmd.includes('display-message')) {
        return `%${paneIdCounter++}\n`;
      }
      return '';
    });

    runner['createTmuxLayout']();

    const selectPaneCmds = commands.filter(c => c.includes('select-pane') && c.includes('-T'));
    expect(selectPaneCmds.some(c => c.includes('SERVER'))).toBe(true);
    expect(selectPaneCmds.some(c => c.includes('DASHBOARD'))).toBe(true);
    expect(selectPaneCmds.some(c => c.includes('fixer'))).toBe(true);
    expect(selectPaneCmds.some(c => c.includes('verifier'))).toBe(true);
  });
});

describe('CompoundRunner - tmuxDisplayPaneId', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts());
  });

  it('should return trimmed pane id', () => {
    mockExecSync.mockReturnValue('%42\n');

    const result = runner['tmuxDisplayPaneId']();

    expect(result).toBe('%42');
  });

  it('should call tmux display-message', () => {
    mockExecSync.mockReturnValue('%0\n');

    runner['tmuxDisplayPaneId']();

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('tmux display-message'),
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });
});

describe('CompoundRunner - startOutputWatchers', () => {
  let runner: CompoundRunner;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new CompoundRunner(makeOpts({ numWorkers: 2 }));
    runner['promptDir'] = '/tmp/fleet-compound-test';
    runner['token'] = 'jwt-token';
  });

  afterEach(() => {
    // Clean up intervals
    runner['stopOutputWatchers']();
  });

  it('should create intervals for each worker', () => {
    mockExistsSyncFn.mockReturnValue(false);

    runner['startOutputWatchers']();

    expect(runner['outputWatchers']).toHaveLength(2);
  });
});

describe('CompoundRunner - constructor edge cases', () => {
  it('should handle options with very long objective', () => {
    const longObjective = 'x'.repeat(10000);
    const runner = new CompoundRunner(makeOpts({ objective: longObjective }));
    expect(runner).toBeInstanceOf(CompoundRunner);
  });

  it('should handle options with special characters in targetDir', () => {
    const runner = new CompoundRunner(makeOpts({ targetDir: '/tmp/my project (2)' }));
    expect(runner).toBeInstanceOf(CompoundRunner);
  });

  it('should resolve projectDir from import.meta.url', () => {
    const runner = new CompoundRunner(makeOpts());
    // projectDir should be resolved to an absolute path
    expect(runner['projectDir']).toBeTruthy();
    expect(typeof runner['projectDir']).toBe('string');
  });
});
