/**
 * Safety Commands Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('@cct/safety', () => ({
  SafetyManager: vi.fn().mockImplementation(() => ({
    getStatus: vi.fn().mockReturnValue({
      hooks: [],
    }),
    enableHook: vi.fn().mockReturnValue(true),
    disableHook: vi.fn().mockReturnValue(true),
    check: vi.fn().mockReturnValue({
      allowed: true,
      warnings: [],
    }),
  })),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    cyan: (s: string) => s,
    gray: (s: string) => s,
    yellow: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
  },
}));

import { safetyCommands } from './safety.js';

describe('Safety Commands', () => {
  let safety: Command;

  beforeEach(() => {
    safety = safetyCommands();
  });

  describe('Command Structure', () => {
    it('creates safety parent command', () => {
      expect(safety.name()).toBe('safety');
      expect(safety.description()).toBe('Safety hook management');
    });

    it('has status subcommand', () => {
      const status = safety.commands.find(c => c.name() === 'status');
      expect(status).toBeDefined();
      expect(status?.description()).toBe('Show safety hook status');
    });

    it('has enable subcommand', () => {
      const enable = safety.commands.find(c => c.name() === 'enable');
      expect(enable).toBeDefined();
      expect(enable?.description()).toBe('Enable a safety hook');
    });

    it('has disable subcommand', () => {
      const disable = safety.commands.find(c => c.name() === 'disable');
      expect(disable).toBeDefined();
      expect(disable?.description()).toBe('Disable a safety hook');
    });

    it('has test subcommand', () => {
      const test = safety.commands.find(c => c.name() === 'test');
      expect(test).toBeDefined();
      expect(test?.description()).toBe('Test if a command is safe');
    });

    it('has check-file subcommand', () => {
      const checkFile = safety.commands.find(c => c.name() === 'check-file');
      expect(checkFile).toBeDefined();
      expect(checkFile?.description()).toBe('Check if a file operation is safe');
    });

    it('has 5 subcommands', () => {
      expect(safety.commands.length).toBe(5);
    });
  });

  describe('Status Command Options', () => {
    it('has json output option', () => {
      const status = safety.commands.find(c => c.name() === 'status')!;
      const options = status.options.map(o => o.long);
      expect(options).toContain('--json');
    });
  });

  describe('Enable Command Options', () => {
    it('requires hookId argument', () => {
      const enable = safety.commands.find(c => c.name() === 'enable')!;
      expect(enable.registeredArguments.length).toBeGreaterThan(0);
    });
  });

  describe('Disable Command Options', () => {
    it('requires hookId argument', () => {
      const disable = safety.commands.find(c => c.name() === 'disable')!;
      expect(disable.registeredArguments.length).toBeGreaterThan(0);
    });
  });

  describe('Test Command Options', () => {
    it('requires command argument', () => {
      const test = safety.commands.find(c => c.name() === 'test')!;
      expect(test.registeredArguments.length).toBeGreaterThan(0);
    });

    it('has json output option', () => {
      const test = safety.commands.find(c => c.name() === 'test')!;
      const options = test.options.map(o => o.long);
      expect(options).toContain('--json');
    });
  });

  describe('Check-File Command Options', () => {
    it('requires path argument', () => {
      const checkFile = safety.commands.find(c => c.name() === 'check-file')!;
      expect(checkFile.registeredArguments.length).toBeGreaterThan(0);
    });

    it('has operation option with default', () => {
      const checkFile = safety.commands.find(c => c.name() === 'check-file')!;
      const opOpt = checkFile.options.find(o => o.long === '--operation');
      expect(opOpt).toBeDefined();
      expect(opOpt?.defaultValue).toBe('file_read');
    });

    it('has json output option', () => {
      const checkFile = safety.commands.find(c => c.name() === 'check-file')!;
      const options = checkFile.options.map(o => o.long);
      expect(options).toContain('--json');
    });
  });
});
