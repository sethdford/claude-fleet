/**
 * Fleet Commands Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('@cct/fleet', () => ({
  FleetManager: vi.fn().mockImplementation(() => ({
    spawn: vi.fn().mockResolvedValue({
      id: 'test-id',
      handle: 'test-handle',
      role: 'worker',
      status: 'pending',
    }),
    dismiss: vi.fn().mockResolvedValue(true),
    listWorkers: vi.fn().mockReturnValue([]),
    getStatus: vi.fn().mockReturnValue({
      totalWorkers: 0,
      byStatus: {},
      byRole: {},
    }),
    broadcast: vi.fn(),
    createCheckpoint: vi.fn(),
    getCheckpoint: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    cyan: (s: string) => s,
    gray: (s: string) => s,
    white: (s: string) => s,
    yellow: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    blue: (s: string) => s,
  },
}));

vi.mock('ora', () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  }),
}));

import { fleetCommands } from './fleet.js';

describe('Fleet Commands', () => {
  let fleet: Command;

  beforeEach(() => {
    fleet = fleetCommands();
  });

  describe('Command Structure', () => {
    it('creates fleet parent command', () => {
      expect(fleet.name()).toBe('fleet');
      expect(fleet.description()).toBe('Multi-agent fleet management');
    });

    it('has spawn subcommand', () => {
      const spawn = fleet.commands.find(c => c.name() === 'spawn');
      expect(spawn).toBeDefined();
      expect(spawn?.description()).toBe('Spawn a new worker');
    });

    it('has dismiss subcommand', () => {
      const dismiss = fleet.commands.find(c => c.name() === 'dismiss');
      expect(dismiss).toBeDefined();
      expect(dismiss?.description()).toBe('Dismiss a worker');
    });

    it('has workers subcommand with alias', () => {
      const workers = fleet.commands.find(c => c.name() === 'workers');
      expect(workers).toBeDefined();
      expect(workers?.description()).toBe('List all workers');
      expect(workers?.aliases()).toContain('ls');
    });

    it('has status subcommand', () => {
      const status = fleet.commands.find(c => c.name() === 'status');
      expect(status).toBeDefined();
      expect(status?.description()).toBe('Fleet status overview');
    });

    it('has broadcast subcommand', () => {
      const broadcast = fleet.commands.find(c => c.name() === 'broadcast');
      expect(broadcast).toBeDefined();
      expect(broadcast?.description()).toBe('Broadcast message to all workers');
    });

    it('has checkpoint subcommand group', () => {
      const checkpointCreate = fleet.commands.find(c => c.name() === 'checkpoint create');
      const checkpointLoad = fleet.commands.find(c => c.name() === 'checkpoint load');
      expect(checkpointCreate).toBeDefined();
      expect(checkpointLoad).toBeDefined();
    });
  });

  describe('Spawn Command Options', () => {
    it('requires handle argument', () => {
      const spawn = fleet.commands.find(c => c.name() === 'spawn')!;
      expect(spawn.registeredArguments.length).toBeGreaterThan(0);
    });

    it('has role option with default', () => {
      const spawn = fleet.commands.find(c => c.name() === 'spawn')!;
      const roleOpt = spawn.options.find(o => o.long === '--role');
      expect(roleOpt).toBeDefined();
      expect(roleOpt?.defaultValue).toBe('worker');
    });

    it('has prompt option', () => {
      const spawn = fleet.commands.find(c => c.name() === 'spawn')!;
      const options = spawn.options.map(o => o.long);
      expect(options).toContain('--prompt');
    });

    it('has worktree toggle option', () => {
      const spawn = fleet.commands.find(c => c.name() === 'spawn')!;
      const options = spawn.options.map(o => o.long);
      expect(options).toContain('--no-worktree');
    });
  });

  describe('Dismiss Command Options', () => {
    it('requires handle argument', () => {
      const dismiss = fleet.commands.find(c => c.name() === 'dismiss')!;
      expect(dismiss.registeredArguments.length).toBeGreaterThan(0);
    });
  });

  describe('Workers Command Options', () => {
    it('has status filter option', () => {
      const workers = fleet.commands.find(c => c.name() === 'workers')!;
      const options = workers.options.map(o => o.long);
      expect(options).toContain('--status');
    });

    it('has role filter option', () => {
      const workers = fleet.commands.find(c => c.name() === 'workers')!;
      const options = workers.options.map(o => o.long);
      expect(options).toContain('--role');
    });

    it('has json output option', () => {
      const workers = fleet.commands.find(c => c.name() === 'workers')!;
      const options = workers.options.map(o => o.long);
      expect(options).toContain('--json');
    });
  });

  describe('Status Command Options', () => {
    it('has json output option', () => {
      const status = fleet.commands.find(c => c.name() === 'status')!;
      const options = status.options.map(o => o.long);
      expect(options).toContain('--json');
    });
  });

  describe('Broadcast Command Options', () => {
    it('requires message argument', () => {
      const broadcast = fleet.commands.find(c => c.name() === 'broadcast')!;
      expect(broadcast.registeredArguments.length).toBeGreaterThan(0);
    });

    it('has from option', () => {
      const broadcast = fleet.commands.find(c => c.name() === 'broadcast')!;
      const options = broadcast.options.map(o => o.long);
      expect(options).toContain('--from');
    });
  });

  describe('Checkpoint Commands Options', () => {
    it('checkpoint create has required handle option', () => {
      const create = fleet.commands.find(c => c.name() === 'checkpoint create')!;
      const handleOpt = create.options.find(o => o.long === '--handle');
      expect(handleOpt).toBeDefined();
      expect(handleOpt?.required).toBe(true);
    });

    it('checkpoint create has required goal option', () => {
      const create = fleet.commands.find(c => c.name() === 'checkpoint create')!;
      const goalOpt = create.options.find(o => o.long === '--goal');
      expect(goalOpt).toBeDefined();
      expect(goalOpt?.required).toBe(true);
    });

    it('checkpoint create has worked option', () => {
      const create = fleet.commands.find(c => c.name() === 'checkpoint create')!;
      const options = create.options.map(o => o.long);
      expect(options).toContain('--worked');
    });

    it('checkpoint create has remaining option', () => {
      const create = fleet.commands.find(c => c.name() === 'checkpoint create')!;
      const options = create.options.map(o => o.long);
      expect(options).toContain('--remaining');
    });

    it('checkpoint load requires handle argument', () => {
      const load = fleet.commands.find(c => c.name() === 'checkpoint load')!;
      expect(load.registeredArguments.length).toBeGreaterThan(0);
    });

    it('checkpoint load has json option', () => {
      const load = fleet.commands.find(c => c.name() === 'checkpoint load')!;
      const options = load.options.map(o => o.long);
      expect(options).toContain('--json');
    });
  });
});
