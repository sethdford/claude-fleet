/**
 * Safety Hooks Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SafetyManager, checkSafety, enforceSafety } from './hooks.js';
import { SafetyError } from '@claude-fleet/common';

describe('SafetyManager', () => {
  let manager: SafetyManager;

  beforeEach(() => {
    manager = new SafetyManager();
  });

  describe('check()', () => {
    it('allows safe commands', () => {
      const result = manager.check({
        operation: 'bash_command',
        command: 'ls -la',
      });
      expect(result.allowed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('allows git status', () => {
      const result = manager.check({
        operation: 'bash_command',
        command: 'git status',
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks rm -rf /', () => {
      const result = manager.check({
        operation: 'bash_command',
        command: 'rm -rf /',
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('rm-rf');
      expect(result.reason).toBeDefined();
    });

    it('blocks rm -rf with home directory', () => {
      const result = manager.check({
        operation: 'bash_command',
        command: 'rm -rf ~',
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('rm-rf');
    });

    it('blocks fork bombs', () => {
      const result = manager.check({
        operation: 'bash_command',
        command: ':(){ :|:& };:',
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('dangerous-commands');
    });

    it('blocks /dev/sda writes', () => {
      const result = manager.check({
        operation: 'bash_command',
        command: 'dd if=/dev/zero of=/dev/sda',
      });
      expect(result.allowed).toBe(false);
    });

    it('blocks mkfs commands', () => {
      const result = manager.check({
        operation: 'bash_command',
        command: 'mkfs.ext4 /dev/sdb',
      });
      expect(result.allowed).toBe(false);
    });

    it('blocks .env file access', () => {
      const result = manager.check({
        operation: 'file_read',
        filePath: '/project/.env',
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('env-file');
    });

    it('blocks credentials.json access', () => {
      const result = manager.check({
        operation: 'file_read',
        filePath: '/home/user/credentials.json',
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('env-file');
    });

    it('returns checksPerformed list', () => {
      const result = manager.check({
        operation: 'bash_command',
        command: 'echo hello',
      });
      expect(result.checksPerformed).toContain('rm-rf');
      expect(result.checksPerformed).toContain('dangerous-commands');
      expect(result.checksPerformed.length).toBeGreaterThan(0);
    });

    it('bypasses checks when disabled', () => {
      manager.disable();
      const result = manager.check({
        operation: 'bash_command',
        command: 'rm -rf /',
      });
      expect(result.allowed).toBe(true);
      expect(result.checksPerformed).toEqual([]);
    });
  });

  describe('enforce()', () => {
    it('does not throw for safe commands', () => {
      expect(() => {
        manager.enforce({
          operation: 'bash_command',
          command: 'ls -la',
        });
      }).not.toThrow();
    });

    it('throws SafetyError for dangerous commands', () => {
      expect(() => {
        manager.enforce({
          operation: 'bash_command',
          command: 'rm -rf /',
        });
      }).toThrow(SafetyError);
    });

    it('includes hook ID in error', () => {
      try {
        manager.enforce({
          operation: 'bash_command',
          command: 'rm -rf /',
        });
      } catch (e) {
        expect(e).toBeInstanceOf(SafetyError);
        const err = e as SafetyError;
        expect(err.hookId).toBe('rm-rf');
      }
    });
  });

  describe('hook management', () => {
    it('can disable a hook', () => {
      const success = manager.disableHook('rm-rf');
      expect(success).toBe(true);

      const result = manager.check({
        operation: 'bash_command',
        command: 'rm -rf /',
      });
      // Should still be blocked by dangerous-commands
      expect(result.allowed).toBe(false);
    });

    it('can enable a hook', () => {
      manager.disableHook('rm-rf');
      const success = manager.enableHook('rm-rf');
      expect(success).toBe(true);

      const hook = manager.getHook('rm-rf');
      expect(hook?.enabled).toBe(true);
    });

    it('returns false for non-existent hook', () => {
      expect(manager.disableHook('nonexistent')).toBe(false);
      expect(manager.enableHook('nonexistent')).toBe(false);
    });

    it('can list all hooks', () => {
      const hooks = manager.getHooks();
      expect(hooks.length).toBeGreaterThan(0);
      expect(hooks.some(h => h.id === 'rm-rf')).toBe(true);
      expect(hooks.some(h => h.id === 'dangerous-commands')).toBe(true);
    });

    it('can get status', () => {
      const status = manager.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.totalHooks).toBeGreaterThan(0);
      expect(status.activeHooks).toBe(status.totalHooks);
    });

    it('can add custom hook', () => {
      manager.addHook({
        id: 'custom-hook',
        name: 'Custom Hook',
        description: 'Test hook',
        enabled: true,
        priority: 50,
        validator: (ctx) => ({
          allowed: ctx.command !== 'custom-blocked',
          reason: 'Custom blocked',
        }),
      });

      const result = manager.check({
        operation: 'bash_command',
        command: 'custom-blocked',
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('custom-hook');
    });

    it('can remove hook', () => {
      manager.addHook({
        id: 'temp-hook',
        name: 'Temp',
        description: 'Temp',
        enabled: true,
        priority: 1,
        validator: () => ({ allowed: true }),
      });

      expect(manager.removeHook('temp-hook')).toBe(true);
      expect(manager.getHook('temp-hook')).toBeUndefined();
    });
  });
});

describe('checkSafety helper', () => {
  it('uses default manager', () => {
    const result = checkSafety({
      operation: 'bash_command',
      command: 'ls',
    });
    expect(result.allowed).toBe(true);
  });
});

describe('enforceSafety helper', () => {
  it('uses default manager', () => {
    expect(() => {
      enforceSafety({
        operation: 'bash_command',
        command: 'echo hello',
      });
    }).not.toThrow();
  });
});
