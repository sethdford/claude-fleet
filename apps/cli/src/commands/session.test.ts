/**
 * Session Commands Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('@cct/session', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    list: vi.fn().mockReturnValue([]),
    search: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({
      totalSessions: 0,
      totalMessages: 0,
      recentActivity: 0,
    }),
  })),
  SessionExporter: vi.fn().mockImplementation(() => ({
    export: vi.fn().mockReturnValue(null),
  })),
  resumeSession: vi.fn().mockReturnValue(null),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    cyan: (s: string) => s,
    gray: (s: string) => s,
    white: (s: string) => s,
    dim: (s: string) => s,
    yellow: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
  },
}));

import { sessionCommands } from './session.js';

describe('Session Commands', () => {
  let session: Command;

  beforeEach(() => {
    session = sessionCommands();
  });

  describe('Command Structure', () => {
    it('creates session parent command', () => {
      expect(session.name()).toBe('session');
      expect(session.description()).toBe('Session management commands');
    });

    it('has list subcommand', () => {
      const list = session.commands.find(c => c.name() === 'list');
      expect(list).toBeDefined();
      expect(list?.description()).toBe('List all sessions');
    });

    it('has resume subcommand', () => {
      const resume = session.commands.find(c => c.name() === 'resume');
      expect(resume).toBeDefined();
      expect(resume?.description()).toBe('Resume a session');
    });

    it('has search subcommand', () => {
      const search = session.commands.find(c => c.name() === 'search');
      expect(search).toBeDefined();
      expect(search?.description()).toBe('Search sessions by content');
    });

    it('has export subcommand', () => {
      const exportCmd = session.commands.find(c => c.name() === 'export');
      expect(exportCmd).toBeDefined();
      expect(exportCmd?.description()).toBe('Export a session');
    });

    it('has stats subcommand', () => {
      const stats = session.commands.find(c => c.name() === 'stats');
      expect(stats).toBeDefined();
      expect(stats?.description()).toBe('Show session statistics');
    });

    it('has 5 subcommands', () => {
      expect(session.commands.length).toBe(5);
    });
  });

  describe('List Command Options', () => {
    it('has project filter option', () => {
      const list = session.commands.find(c => c.name() === 'list')!;
      const options = list.options.map(o => o.long);
      expect(options).toContain('--project');
    });

    it('has limit option with default', () => {
      const list = session.commands.find(c => c.name() === 'list')!;
      const limitOpt = list.options.find(o => o.long === '--limit');
      expect(limitOpt).toBeDefined();
      expect(limitOpt?.defaultValue).toBe('20');
    });

    it('has json output option', () => {
      const list = session.commands.find(c => c.name() === 'list')!;
      const options = list.options.map(o => o.long);
      expect(options).toContain('--json');
    });
  });

  describe('Resume Command Options', () => {
    it('has strategy option with default', () => {
      const resume = session.commands.find(c => c.name() === 'resume')!;
      const strategyOpt = resume.options.find(o => o.long === '--strategy');
      expect(strategyOpt).toBeDefined();
      expect(strategyOpt?.defaultValue).toBe('smart-trim');
    });

    it('has max-messages option', () => {
      const resume = session.commands.find(c => c.name() === 'resume')!;
      const options = resume.options.map(o => o.long);
      expect(options).toContain('--max-messages');
    });

    it('requires id argument', () => {
      const resume = session.commands.find(c => c.name() === 'resume')!;
      // Commander stores required args with <>
      expect(resume.registeredArguments.length).toBeGreaterThan(0);
    });
  });

  describe('Search Command Options', () => {
    it('has project filter option', () => {
      const search = session.commands.find(c => c.name() === 'search')!;
      const options = search.options.map(o => o.long);
      expect(options).toContain('--project');
    });

    it('has limit option', () => {
      const search = session.commands.find(c => c.name() === 'search')!;
      const limitOpt = search.options.find(o => o.long === '--limit');
      expect(limitOpt).toBeDefined();
      expect(limitOpt?.defaultValue).toBe('10');
    });

    it('requires query argument', () => {
      const search = session.commands.find(c => c.name() === 'search')!;
      expect(search.registeredArguments.length).toBeGreaterThan(0);
    });
  });

  describe('Export Command Options', () => {
    it('has format option with default', () => {
      const exportCmd = session.commands.find(c => c.name() === 'export')!;
      const formatOpt = exportCmd.options.find(o => o.long === '--format');
      expect(formatOpt).toBeDefined();
      expect(formatOpt?.defaultValue).toBe('markdown');
    });

    it('has output file option', () => {
      const exportCmd = session.commands.find(c => c.name() === 'export')!;
      const options = exportCmd.options.map(o => o.long);
      expect(options).toContain('--output');
    });

    it('has metadata toggle option', () => {
      const exportCmd = session.commands.find(c => c.name() === 'export')!;
      const options = exportCmd.options.map(o => o.long);
      expect(options).toContain('--no-metadata');
    });

    it('has timestamps option', () => {
      const exportCmd = session.commands.find(c => c.name() === 'export')!;
      const options = exportCmd.options.map(o => o.long);
      expect(options).toContain('--timestamps');
    });
  });

  describe('Stats Command Options', () => {
    it('has project filter option', () => {
      const stats = session.commands.find(c => c.name() === 'stats')!;
      const options = stats.options.map(o => o.long);
      expect(options).toContain('--project');
    });
  });
});
