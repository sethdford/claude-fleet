/**
 * Search Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('@cct/session', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    search: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@cct/search', () => ({
  SearchIndex: vi.fn().mockImplementation(() => ({
    launchTui: vi.fn(),
  })),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    cyan: (s: string) => s,
    gray: (s: string) => s,
    white: (s: string) => s,
    dim: (s: string) => s,
    yellow: Object.assign((s: string) => s, { bold: (s: string) => s }),
    red: (s: string) => s,
  },
}));

import { searchCommand } from './search.js';

describe('Search Command', () => {
  let search: Command;

  beforeEach(() => {
    search = searchCommand();
  });

  describe('Command Structure', () => {
    it('creates search command', () => {
      expect(search.name()).toBe('search');
      expect(search.description()).toBe('Search sessions');
    });

    it('has optional query argument', () => {
      // Optional arguments are stored with []
      expect(search.registeredArguments.length).toBe(1);
      expect(search.registeredArguments[0].required).toBe(false);
    });
  });

  describe('Command Options', () => {
    it('has project filter option', () => {
      const options = search.options.map(o => o.long);
      expect(options).toContain('--project');
    });

    it('has limit option with default', () => {
      const limitOpt = search.options.find(o => o.long === '--limit');
      expect(limitOpt).toBeDefined();
      expect(limitOpt?.defaultValue).toBe('20');
    });

    it('has tui option', () => {
      const options = search.options.map(o => o.long);
      expect(options).toContain('--tui');
    });

    it('has json output option', () => {
      const options = search.options.map(o => o.long);
      expect(options).toContain('--json');
    });

    it('has 4 options', () => {
      expect(search.options.length).toBe(4);
    });
  });
});
