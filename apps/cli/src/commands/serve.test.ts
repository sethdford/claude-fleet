/**
 * Serve Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('@cct/mcp', () => ({
  createServer: vi.fn().mockReturnValue({
    start: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../server/http.js', () => ({
  createHttpServer: vi.fn().mockReturnValue({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
}));

vi.mock('ora', () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  }),
}));

import { serveCommand } from './serve.js';

describe('Serve Command', () => {
  let serve: Command;

  beforeEach(() => {
    serve = serveCommand();
  });

  describe('Command Structure', () => {
    it('creates serve command', () => {
      expect(serve.name()).toBe('serve');
      expect(serve.description()).toBe('Start server');
    });

    it('has no subcommands', () => {
      expect(serve.commands.length).toBe(0);
    });
  });

  describe('Command Options', () => {
    it('has port option with default', () => {
      const portOpt = serve.options.find(o => o.long === '--port');
      expect(portOpt).toBeDefined();
      expect(portOpt?.defaultValue).toBe('3847');
    });

    it('has host option with default', () => {
      const hostOpt = serve.options.find(o => o.long === '--host');
      expect(hostOpt).toBeDefined();
      expect(hostOpt?.defaultValue).toBe('0.0.0.0');
    });

    it('has mcp option', () => {
      const options = serve.options.map(o => o.long);
      expect(options).toContain('--mcp');
    });

    it('has http option', () => {
      const options = serve.options.map(o => o.long);
      expect(options).toContain('--http');
    });

    it('has 4 options', () => {
      expect(serve.options.length).toBe(4);
    });
  });
});
