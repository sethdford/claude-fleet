/**
 * Compound Runner - detect.ts Unit Tests
 *
 * Tests for project detection, gate generation, gate command
 * validation, and check command generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectProjectType, generateGateConfigs, validateGateCommands, getCheckCommands } from './detect.js';
import type { ProjectType, GateConfig } from './types.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: (...parts: string[]) => parts.join('/'),
}));

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// detectProjectType
// ============================================================================

describe('detectProjectType', () => {
  it('should detect node project from package.json', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
    expect(detectProjectType('/project')).toBe('node');
  });

  it('should detect rust project from Cargo.toml', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('Cargo.toml'));
    expect(detectProjectType('/project')).toBe('rust');
  });

  it('should detect go project from go.mod', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('go.mod'));
    expect(detectProjectType('/project')).toBe('go');
  });

  it('should detect python project from pyproject.toml', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('pyproject.toml'));
    expect(detectProjectType('/project')).toBe('python');
  });

  it('should detect python project from setup.py', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('setup.py'));
    expect(detectProjectType('/project')).toBe('python');
  });

  it('should detect make project from Makefile', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('Makefile'));
    expect(detectProjectType('/project')).toBe('make');
  });

  it('should return null when no project markers found', () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectProjectType('/project')).toBeNull();
  });

  it('should prioritize node over rust when both exist', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith('package.json') || path.endsWith('Cargo.toml');
    });
    expect(detectProjectType('/project')).toBe('node');
  });

  it('should prioritize rust over go when both exist', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith('Cargo.toml') || path.endsWith('go.mod');
    });
    expect(detectProjectType('/project')).toBe('rust');
  });

  it('should prioritize go over python when both exist', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith('go.mod') || path.endsWith('pyproject.toml');
    });
    expect(detectProjectType('/project')).toBe('go');
  });

  it('should prioritize python over make when both exist', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith('pyproject.toml') || path.endsWith('Makefile');
    });
    expect(detectProjectType('/project')).toBe('python');
  });
});

// ============================================================================
// generateGateConfigs
// ============================================================================

describe('generateGateConfigs', () => {
  describe('node projects', () => {
    it('should generate typecheck gate when tsconfig.json exists', () => {
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith('tsconfig.json') || path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { typescript: '^5.0.0' },
      }));

      const gates = generateGateConfigs('node', '/project');
      const typecheckGate = gates.find(g => g.name === 'typecheck');
      expect(typecheckGate).toBeDefined();
      expect(typecheckGate?.config.command).toBe('npx');
      expect(typecheckGate?.config.args).toEqual(['tsc', '--noEmit']);
    });

    it('should generate lint gate when eslint dependency exists', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { eslint: '^8.0.0' },
      }));

      const gates = generateGateConfigs('node', '/project');
      const lintGate = gates.find(g => g.name === 'lint');
      expect(lintGate).toBeDefined();
      expect(lintGate?.config.command).toBe('npx');
      expect(lintGate?.config.args).toContain('eslint');
    });

    it('should generate vitest test gate when vitest dependency exists', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      }));

      const gates = generateGateConfigs('node', '/project');
      const testGate = gates.find(g => g.name === 'tests');
      expect(testGate).toBeDefined();
      expect(testGate?.config.args).toContain('vitest');
    });

    it('should generate jest test gate when jest dependency exists and vitest is absent', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { jest: '^29.0.0' },
      }));

      const gates = generateGateConfigs('node', '/project');
      const testGate = gates.find(g => g.name === 'tests');
      expect(testGate).toBeDefined();
      expect(testGate?.config.args).toContain('jest');
    });

    it('should prefer vitest over jest when both exist', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { vitest: '^1.0.0', jest: '^29.0.0' },
      }));

      const gates = generateGateConfigs('node', '/project');
      const testGate = gates.find(g => g.name === 'tests');
      expect(testGate?.config.args).toContain('vitest');
      expect(testGate?.config.args).not.toContain('jest');
    });

    it('should generate all gates for a full node project', () => {
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('tsconfig.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: {
          typescript: '^5.0.0',
          eslint: '^8.0.0',
          vitest: '^1.0.0',
        },
      }));

      const gates = generateGateConfigs('node', '/project');
      expect(gates).toHaveLength(3);
      expect(gates[0].name).toBe('typecheck');
      expect(gates[1].name).toBe('lint');
      expect(gates[2].name).toBe('tests');
    });

    it('should return empty array for a bare node project with no tools', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({}));

      const gates = generateGateConfigs('node', '/project');
      expect(gates).toEqual([]);
    });

    it('should set correct sortOrder on gates', () => {
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('tsconfig.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: {
          typescript: '^5.0.0',
          eslint: '^8.0.0',
          vitest: '^1.0.0',
        },
      }));

      const gates = generateGateConfigs('node', '/project');
      expect(gates[0].sortOrder).toBe(0);
      expect(gates[1].sortOrder).toBe(1);
      expect(gates[2].sortOrder).toBe(2);
    });

    it('should set cwd on all gates', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      }));

      const gates = generateGateConfigs('node', '/my/project');
      for (const gate of gates) {
        expect(gate.config.cwd).toBe('/my/project');
      }
    });

    it('should fallback to raw text detection when JSON parsing fails', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      // First call: JSON.parse fails, second call returns raw text with dependency names
      mockReadFileSync.mockReturnValue('{ invalid json but has "typescript" and "eslint" and "vitest" }');

      const gates = generateGateConfigs('node', '/project');
      // Should detect via raw text fallback
      expect(gates.length).toBeGreaterThan(0);
    });

    it('should detect dependencies in both dependencies and devDependencies', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        dependencies: { typescript: '^5.0.0' },
        devDependencies: { eslint: '^8.0.0' },
      }));

      const gates = generateGateConfigs('node', '/project');
      const names = gates.map(g => g.name);
      expect(names).toContain('typecheck');
      expect(names).toContain('lint');
    });
  });

  describe('rust projects', () => {
    it('should generate check, lint, and test gates', () => {
      const gates = generateGateConfigs('rust', '/project');
      expect(gates).toHaveLength(3);
      expect(gates[0].name).toBe('check');
      expect(gates[0].config.command).toBe('cargo');
      expect(gates[1].name).toBe('lint');
      expect(gates[1].config.command).toBe('cargo');
      expect(gates[1].config.args).toContain('clippy');
      expect(gates[2].name).toBe('tests');
      expect(gates[2].config.command).toBe('cargo');
    });

    it('should set isRequired to true for all gates', () => {
      const gates = generateGateConfigs('rust', '/project');
      for (const gate of gates) {
        expect(gate.isRequired).toBe(true);
      }
    });

    it('should set cwd to the provided directory', () => {
      const gates = generateGateConfigs('rust', '/my/rust/project');
      for (const gate of gates) {
        expect(gate.config.cwd).toBe('/my/rust/project');
      }
    });
  });

  describe('go projects', () => {
    it('should generate build, vet, and test gates', () => {
      const gates = generateGateConfigs('go', '/project');
      expect(gates).toHaveLength(3);
      expect(gates[0].name).toBe('build');
      expect(gates[0].config.command).toBe('go');
      expect(gates[1].name).toBe('vet');
      expect(gates[1].config.command).toBe('go');
      expect(gates[2].name).toBe('tests');
      expect(gates[2].config.command).toBe('go');
    });
  });

  describe('python projects', () => {
    it('should generate typecheck, lint, and test gates', () => {
      const gates = generateGateConfigs('python', '/project');
      expect(gates).toHaveLength(3);
      expect(gates[0].name).toBe('typecheck');
      expect(gates[0].config.command).toBe('mypy');
      expect(gates[0].isRequired).toBe(false); // mypy is optional
      expect(gates[1].name).toBe('lint');
      expect(gates[1].config.command).toBe('ruff');
      expect(gates[2].name).toBe('tests');
      expect(gates[2].config.command).toBe('python3');
    });

    it('should mark mypy as not required', () => {
      const gates = generateGateConfigs('python', '/project');
      const mypyGate = gates.find(g => g.name === 'typecheck');
      expect(mypyGate?.isRequired).toBe(false);
    });

    it('should mark lint and test gates as required', () => {
      const gates = generateGateConfigs('python', '/project');
      const lintGate = gates.find(g => g.name === 'lint');
      const testGate = gates.find(g => g.name === 'tests');
      expect(lintGate?.isRequired).toBe(true);
      expect(testGate?.isRequired).toBe(true);
    });
  });

  describe('make projects', () => {
    it('should generate a single build gate', () => {
      const gates = generateGateConfigs('make', '/project');
      expect(gates).toHaveLength(1);
      expect(gates[0].name).toBe('build');
      expect(gates[0].config.command).toBe('make');
      expect(gates[0].config.args).toEqual([]);
    });
  });

  describe('all project types', () => {
    it('should set gateType to script for all generated gates', () => {
      const types: ProjectType[] = ['node', 'rust', 'go', 'python', 'make'];
      // For node, set up minimal mocks
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockReturnValue('{}');

      for (const projectType of types) {
        const gates = generateGateConfigs(projectType, '/project');
        for (const gate of gates) {
          expect(gate.gateType).toBe('script');
        }
      }
    });
  });
});

// ============================================================================
// validateGateCommands (additional coverage beyond compound.test.ts)
// ============================================================================

describe('validateGateCommands', () => {
  it('should skip npx commands without calling which', () => {
    const gates: GateConfig[] = [{
      gateType: 'script',
      name: 'typecheck',
      isRequired: true,
      config: { command: 'npx', args: ['tsc'], cwd: '/tmp' },
      sortOrder: 0,
    }];

    const warnings = validateGateCommands(gates);
    expect(warnings).toEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('should skip node commands without calling which', () => {
    const gates: GateConfig[] = [{
      gateType: 'script',
      name: 'run',
      isRequired: true,
      config: { command: 'node', args: ['index.js'], cwd: '/tmp' },
      sortOrder: 0,
    }];

    const warnings = validateGateCommands(gates);
    expect(warnings).toEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('should call which for non-npx/node commands', () => {
    mockExecSync.mockReturnValue('/usr/bin/cargo');

    const gates: GateConfig[] = [{
      gateType: 'script',
      name: 'check',
      isRequired: true,
      config: { command: 'cargo', args: ['check'], cwd: '/tmp' },
      sortOrder: 0,
    }];

    validateGateCommands(gates);
    expect(mockExecSync).toHaveBeenCalledWith('which cargo', expect.anything());
  });

  it('should report warnings when which throws', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const gates: GateConfig[] = [{
      gateType: 'script',
      name: 'lint',
      isRequired: true,
      config: { command: 'nonexistent-cmd', args: [], cwd: '/tmp' },
      sortOrder: 0,
    }];

    const warnings = validateGateCommands(gates);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('lint');
    expect(warnings[0]).toContain('nonexistent-cmd');
    expect(warnings[0]).toContain('not found on PATH');
  });

  it('should handle empty gates array', () => {
    expect(validateGateCommands([])).toEqual([]);
  });

  it('should validate multiple commands and report only missing ones', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('cargo')) return '/usr/bin/cargo';
      throw new Error('not found');
    });

    const gates: GateConfig[] = [
      {
        gateType: 'script',
        name: 'check',
        isRequired: true,
        config: { command: 'cargo', args: ['check'], cwd: '/tmp' },
        sortOrder: 0,
      },
      {
        gateType: 'script',
        name: 'lint',
        isRequired: true,
        config: { command: 'missing-tool', args: [], cwd: '/tmp' },
        sortOrder: 1,
      },
    ];

    const warnings = validateGateCommands(gates);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('missing-tool');
  });
});

// ============================================================================
// getCheckCommands
// ============================================================================

describe('getCheckCommands', () => {
  describe('node projects', () => {
    it('should return typescript command when tsconfig exists', () => {
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith('tsconfig.json') || path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { typescript: '^5.0.0' },
      }));

      const commands = getCheckCommands('node', '/project');
      expect(commands).toContain('npx tsc --noEmit');
    });

    it('should return eslint command when eslint exists', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { eslint: '^8.0.0' },
      }));

      const commands = getCheckCommands('node', '/project');
      expect(commands).toContain('npx eslint src/ --max-warnings 0');
    });

    it('should return vitest command when vitest exists', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      }));

      const commands = getCheckCommands('node', '/project');
      expect(commands).toContain('npx vitest run');
    });

    it('should return jest command when jest exists and vitest is absent', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { jest: '^29.0.0' },
      }));

      const commands = getCheckCommands('node', '/project');
      expect(commands).toContain('npx jest');
    });

    it('should return all commands separated by newlines', () => {
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('tsconfig.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: {
          typescript: '^5.0.0',
          eslint: '^8.0.0',
          vitest: '^1.0.0',
        },
      }));

      const commands = getCheckCommands('node', '/project');
      const lines = commands.split('\n');
      expect(lines).toHaveLength(3);
    });

    it('should return empty string for bare node project', () => {
      mockExistsSync.mockImplementation((p) => String(p).endsWith('package.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify({}));

      const commands = getCheckCommands('node', '/project');
      expect(commands).toBe('');
    });
  });

  it('should return rust check commands', () => {
    const commands = getCheckCommands('rust', '/project');
    expect(commands).toContain('cargo check');
    expect(commands).toContain('cargo clippy');
    expect(commands).toContain('cargo test');
  });

  it('should return go check commands', () => {
    const commands = getCheckCommands('go', '/project');
    expect(commands).toContain('go build ./...');
    expect(commands).toContain('go vet ./...');
    expect(commands).toContain('go test ./...');
  });

  it('should return python check commands', () => {
    const commands = getCheckCommands('python', '/project');
    expect(commands).toContain('mypy');
    expect(commands).toContain('ruff check');
    expect(commands).toContain('pytest');
  });

  it('should return make check commands', () => {
    const commands = getCheckCommands('make', '/project');
    expect(commands).toBe('make');
  });
});
