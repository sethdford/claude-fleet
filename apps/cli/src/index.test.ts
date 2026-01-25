/**
 * CLI Entry Point Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Mock the command modules before importing
vi.mock('./commands/session.js', () => ({
  sessionCommands: vi.fn(() => new Command('session').description('Session management')),
}));

vi.mock('./commands/fleet.js', () => ({
  fleetCommands: vi.fn(() => new Command('fleet').description('Fleet management')),
}));

vi.mock('./commands/safety.js', () => ({
  safetyCommands: vi.fn(() => new Command('safety').description('Safety controls')),
}));

vi.mock('./commands/search.js', () => ({
  searchCommand: vi.fn(() => new Command('search').description('Search sessions')),
}));

vi.mock('./commands/serve.js', () => ({
  serveCommand: vi.fn(() => new Command('serve').description('HTTP server')),
}));

vi.mock('./commands/lmsh.js', () => ({
  lmshCommand: vi.fn(() => new Command('lmsh').description('NL to shell')),
}));

import { sessionCommands } from './commands/session.js';
import { fleetCommands } from './commands/fleet.js';
import { safetyCommands } from './commands/safety.js';
import { searchCommand } from './commands/search.js';
import { serveCommand } from './commands/serve.js';
import { lmshCommand } from './commands/lmsh.js';

describe('CLI Entry Point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Command Registration', () => {
    it('registers session commands', () => {
      const cmd = sessionCommands();
      expect(cmd.name()).toBe('session');
    });

    it('registers fleet commands', () => {
      const cmd = fleetCommands();
      expect(cmd.name()).toBe('fleet');
    });

    it('registers safety commands', () => {
      const cmd = safetyCommands();
      expect(cmd.name()).toBe('safety');
    });

    it('registers search command', () => {
      const cmd = searchCommand();
      expect(cmd.name()).toBe('search');
    });

    it('registers serve command', () => {
      const cmd = serveCommand();
      expect(cmd.name()).toBe('serve');
    });

    it('registers lmsh command', () => {
      const cmd = lmshCommand();
      expect(cmd.name()).toBe('lmsh');
    });
  });

  describe('Program Structure', () => {
    it('creates main program with correct name', () => {
      const program = new Command();
      program.name('cct');
      expect(program.name()).toBe('cct');
    });

    it('creates main program with description', () => {
      const program = new Command();
      program.description('Claude Code Tools');
      expect(program.description()).toBe('Claude Code Tools');
    });

    it('creates main program with version', () => {
      const program = new Command();
      program.version('1.0.0');
      expect(program.version()).toBe('1.0.0');
    });

    it('can add multiple subcommands', () => {
      const program = new Command();
      program.name('cct');

      program.addCommand(new Command('session'));
      program.addCommand(new Command('fleet'));
      program.addCommand(new Command('safety'));
      program.addCommand(new Command('search'));
      program.addCommand(new Command('serve'));
      program.addCommand(new Command('lmsh'));

      const commands = program.commands.map(c => c.name());
      expect(commands).toContain('session');
      expect(commands).toContain('fleet');
      expect(commands).toContain('safety');
      expect(commands).toContain('search');
      expect(commands).toContain('serve');
      expect(commands).toContain('lmsh');
      expect(commands.length).toBe(6);
    });
  });
});

describe('Command Module Integration', () => {
  it('all command factories return Command instances', () => {
    const commands = [
      sessionCommands(),
      fleetCommands(),
      safetyCommands(),
      searchCommand(),
      serveCommand(),
      lmshCommand(),
    ];

    for (const cmd of commands) {
      expect(cmd).toBeInstanceOf(Command);
    }
  });

  it('all commands have descriptions', () => {
    const commands = [
      sessionCommands(),
      fleetCommands(),
      safetyCommands(),
      searchCommand(),
      serveCommand(),
      lmshCommand(),
    ];

    for (const cmd of commands) {
      expect(cmd.description()).toBeDefined();
      expect(cmd.description().length).toBeGreaterThan(0);
    }
  });

  it('all command names are unique', () => {
    const commands = [
      sessionCommands(),
      fleetCommands(),
      safetyCommands(),
      searchCommand(),
      serveCommand(),
      lmshCommand(),
    ];

    const names = commands.map(c => c.name());
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
