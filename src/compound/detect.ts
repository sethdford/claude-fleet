/**
 * Compound Runner - Project Detection & Gate Generation
 *
 * Detects project type from filesystem markers and generates
 * appropriate quality gate configurations for each language.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectType, GateConfig } from './types.js';

// ============================================================================
// PROJECT DETECTION
// ============================================================================

/**
 * Detect project type by checking for language-specific manifest files.
 * Checks in priority order: node > rust > go > python > make.
 */
export function detectProjectType(dir: string): ProjectType | null {
  if (existsSync(join(dir, 'package.json'))) return 'node';
  if (existsSync(join(dir, 'Cargo.toml'))) return 'rust';
  if (existsSync(join(dir, 'go.mod'))) return 'go';
  if (existsSync(join(dir, 'pyproject.toml')) || existsSync(join(dir, 'setup.py'))) return 'python';
  if (existsSync(join(dir, 'Makefile'))) return 'make';
  return null;
}

// ============================================================================
// NODE PROJECT DETECTION
// ============================================================================

interface NodeProjectInfo {
  hasTypeScript: boolean;
  hasEslint: boolean;
  hasVitest: boolean;
  hasJest: boolean;
}

function detectNodeProject(dir: string): NodeProjectInfo {
  const info: NodeProjectInfo = {
    hasTypeScript: false,
    hasEslint: false,
    hasVitest: false,
    hasJest: false,
  };

  // Check tsconfig.json existence
  if (existsSync(join(dir, 'tsconfig.json'))) {
    info.hasTypeScript = true;
  }

  // Parse package.json for dependencies
  const packageJsonPath = join(dir, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const raw = readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (allDeps['typescript'] !== undefined) info.hasTypeScript = true;
      if (allDeps['eslint'] !== undefined) info.hasEslint = true;
      if (allDeps['vitest'] !== undefined) info.hasVitest = true;
      if (allDeps['jest'] !== undefined) info.hasJest = true;
    } catch {
      // Fallback: grep-style detection from raw text
      try {
        const raw = readFileSync(packageJsonPath, 'utf-8');
        if (raw.includes('"typescript"')) info.hasTypeScript = true;
        if (raw.includes('"eslint"')) info.hasEslint = true;
        if (raw.includes('"vitest"')) info.hasVitest = true;
        if (raw.includes('"jest"')) info.hasJest = true;
      } catch {
        // Cannot read package.json at all
      }
    }
  }

  return info;
}

// ============================================================================
// GATE GENERATION
// ============================================================================

/**
 * Generate quality gate configurations for the detected project type.
 * Each gate is a script-type gate with command, args, and cwd.
 */
export function generateGateConfigs(projectType: ProjectType, dir: string): GateConfig[] {
  switch (projectType) {
    case 'node':
      return generateNodeGates(dir);
    case 'rust':
      return generateRustGates(dir);
    case 'go':
      return generateGoGates(dir);
    case 'python':
      return generatePythonGates(dir);
    case 'make':
      return generateMakeGates(dir);
  }
}

function generateNodeGates(dir: string): GateConfig[] {
  const info = detectNodeProject(dir);
  const gates: GateConfig[] = [];
  let sortOrder = 0;

  if (info.hasTypeScript) {
    gates.push({
      gateType: 'script',
      name: 'typecheck',
      isRequired: true,
      config: { command: 'npx', args: ['tsc', '--noEmit'], cwd: dir },
      sortOrder: sortOrder++,
    });
  }

  if (info.hasEslint) {
    gates.push({
      gateType: 'script',
      name: 'lint',
      isRequired: true,
      config: { command: 'npx', args: ['eslint', 'src/', '--max-warnings', '0'], cwd: dir },
      sortOrder: sortOrder++,
    });
  }

  if (info.hasVitest) {
    gates.push({
      gateType: 'script',
      name: 'tests',
      isRequired: true,
      config: { command: 'npx', args: ['vitest', 'run', '--reporter=verbose'], cwd: dir },
      sortOrder: sortOrder++,
    });
  } else if (info.hasJest) {
    gates.push({
      gateType: 'script',
      name: 'tests',
      isRequired: true,
      config: { command: 'npx', args: ['jest', '--verbose'], cwd: dir },
      sortOrder: sortOrder++,
    });
  }

  return gates;
}

function generateRustGates(dir: string): GateConfig[] {
  return [
    {
      gateType: 'script',
      name: 'check',
      isRequired: true,
      config: { command: 'cargo', args: ['check'], cwd: dir },
      sortOrder: 0,
    },
    {
      gateType: 'script',
      name: 'lint',
      isRequired: true,
      config: { command: 'cargo', args: ['clippy', '--', '-D', 'warnings'], cwd: dir },
      sortOrder: 1,
    },
    {
      gateType: 'script',
      name: 'tests',
      isRequired: true,
      config: { command: 'cargo', args: ['test'], cwd: dir },
      sortOrder: 2,
    },
  ];
}

function generateGoGates(dir: string): GateConfig[] {
  return [
    {
      gateType: 'script',
      name: 'build',
      isRequired: true,
      config: { command: 'go', args: ['build', './...'], cwd: dir },
      sortOrder: 0,
    },
    {
      gateType: 'script',
      name: 'vet',
      isRequired: true,
      config: { command: 'go', args: ['vet', './...'], cwd: dir },
      sortOrder: 1,
    },
    {
      gateType: 'script',
      name: 'tests',
      isRequired: true,
      config: { command: 'go', args: ['test', './...'], cwd: dir },
      sortOrder: 2,
    },
  ];
}

function generatePythonGates(dir: string): GateConfig[] {
  const gates: GateConfig[] = [];
  let sortOrder = 0;

  // mypy is optional for Python projects
  gates.push({
    gateType: 'script',
    name: 'typecheck',
    isRequired: false,
    config: { command: 'mypy', args: ['.'], cwd: dir },
    sortOrder: sortOrder++,
  });

  gates.push({
    gateType: 'script',
    name: 'lint',
    isRequired: true,
    config: { command: 'ruff', args: ['check', '.'], cwd: dir },
    sortOrder: sortOrder++,
  });

  gates.push({
    gateType: 'script',
    name: 'tests',
    isRequired: true,
    config: { command: 'python3', args: ['-m', 'pytest', '-v'], cwd: dir },
    sortOrder: sortOrder++,
  });

  return gates;
}

function generateMakeGates(dir: string): GateConfig[] {
  return [
    {
      gateType: 'script',
      name: 'build',
      isRequired: true,
      config: { command: 'make', args: [], cwd: dir },
      sortOrder: 0,
    },
  ];
}

// ============================================================================
// GATE COMMAND VALIDATION
// ============================================================================

/**
 * Validate that the commands required by each gate are available on PATH.
 * Returns a list of warning messages for gates whose commands are missing.
 */
export function validateGateCommands(gates: GateConfig[]): string[] {
  const warnings: string[] = [];

  for (const gate of gates) {
    const command = gate.config.command;
    // npx/node are always available in a Node environment
    if (command === 'npx' || command === 'node') continue;

    try {
      execSync(`which ${command}`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch {
      warnings.push(
        `Gate "${gate.name}": command "${command}" not found on PATH`,
      );
    }
  }

  return warnings;
}

// ============================================================================
// CHECK COMMANDS
// ============================================================================

/**
 * Build project-specific check commands as a string for embedding in prompts.
 * Used by the fixer/verifier to know what commands to run locally.
 */
export function getCheckCommands(projectType: ProjectType, dir: string): string {
  switch (projectType) {
    case 'node': {
      const info = detectNodeProject(dir);
      const commands: string[] = [];
      if (info.hasTypeScript) commands.push('npx tsc --noEmit');
      if (info.hasEslint) commands.push('npx eslint src/ --max-warnings 0');
      if (info.hasVitest) commands.push('npx vitest run');
      else if (info.hasJest) commands.push('npx jest');
      return commands.join('\n');
    }
    case 'rust':
      return 'cargo check\ncargo clippy -- -D warnings\ncargo test';
    case 'go':
      return 'go build ./...\ngo vet ./...\ngo test ./...';
    case 'python':
      return 'mypy . (optional)\nruff check .\npython3 -m pytest -v';
    case 'make':
      return 'make';
  }
}
