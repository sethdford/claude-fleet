/**
 * Tests for Roles module (permission system)
 *
 * Tests hasPermission, hasAllPermissions, hasAnyPermission, getPermissions,
 * getEnabledPermissions, convenience helpers, and role validation.
 */

import { describe, it, expect } from 'vitest';
import type { AgentRole } from '../types.js';
import { ROLE_PERMISSIONS } from '../types.js';
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getPermissions,
  getEnabledPermissions,
  canSpawn,
  canDismiss,
  canAssign,
  canBroadcast,
  canMerge,
  canClaim,
  canComplete,
  canSend,
  canPush,
  isValidRole,
  getAllRoles,
  getRoleDescription,
  permissionError,
  requirePermission,
  type Permission,
} from './roles.js';

const ALL_ROLES: AgentRole[] = ['coordinator', 'worker', 'monitor', 'notifier', 'merger', 'team-lead'];

describe('Roles Permission System', () => {
  // ======================================================================
  // hasPermission
  // ======================================================================

  describe('hasPermission', () => {
    it('should return true for coordinator spawn', () => {
      expect(hasPermission('coordinator', 'spawn')).toBe(true);
    });

    it('should return false for worker spawn', () => {
      expect(hasPermission('worker', 'spawn')).toBe(false);
    });

    it('should return true for worker claim', () => {
      expect(hasPermission('worker', 'claim')).toBe(true);
    });

    it('should return true for monitor readAll', () => {
      expect(hasPermission('monitor', 'readAll')).toBe(true);
    });

    it('should return false for unknown permission on valid role', () => {
      expect(hasPermission('worker', 'broadcast')).toBe(false);
    });
  });

  // ======================================================================
  // hasAllPermissions / hasAnyPermission
  // ======================================================================

  describe('hasAllPermissions', () => {
    it('should return true when role has all specified permissions', () => {
      expect(hasAllPermissions('coordinator', ['spawn', 'dismiss', 'assign'])).toBe(true);
    });

    it('should return false when role lacks one permission', () => {
      expect(hasAllPermissions('worker', ['claim', 'spawn'])).toBe(false);
    });

    it('should return true for empty permission list', () => {
      expect(hasAllPermissions('worker', [])).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true when role has at least one permission', () => {
      expect(hasAnyPermission('worker', ['spawn', 'claim'])).toBe(true);
    });

    it('should return false when role has none of the permissions', () => {
      expect(hasAnyPermission('worker', ['spawn', 'dismiss', 'broadcast'])).toBe(false);
    });

    it('should return false for empty permission list', () => {
      expect(hasAnyPermission('worker', [])).toBe(false);
    });
  });

  // ======================================================================
  // getPermissions / getEnabledPermissions
  // ======================================================================

  describe('getPermissions', () => {
    it('should return the full permissions object for a role', () => {
      const perms = getPermissions('coordinator');
      expect(perms).toEqual(ROLE_PERMISSIONS.coordinator);
    });

    it.each(ALL_ROLES)('should return defined permissions for %s', (role) => {
      const perms = getPermissions(role);
      expect(perms).toBeDefined();
      expect(typeof perms.spawn).toBe('boolean');
    });
  });

  describe('getEnabledPermissions', () => {
    it('should return enabled permissions for coordinator', () => {
      const enabled = getEnabledPermissions('coordinator');
      expect(enabled).toContain('spawn');
      expect(enabled).toContain('dismiss');
      expect(enabled).not.toContain('alert');
      expect(enabled).not.toContain('notify');
    });

    it('should return only claim/complete/send for worker', () => {
      const enabled = getEnabledPermissions('worker');
      expect(enabled).toEqual(expect.arrayContaining(['claim', 'complete', 'send']));
      expect(enabled).not.toContain('spawn');
      expect(enabled).not.toContain('merge');
    });

    it('should return readAll and alert for monitor', () => {
      const enabled = getEnabledPermissions('monitor');
      expect(enabled).toContain('readAll');
      expect(enabled).toContain('alert');
    });
  });

  // ======================================================================
  // Convenience Permission Helpers
  // ======================================================================

  describe('Convenience helpers', () => {
    it('should check canSpawn correctly', () => {
      expect(canSpawn('coordinator')).toBe(true);
      expect(canSpawn('worker')).toBe(false);
      expect(canSpawn('team-lead')).toBe(true);
    });

    it('should check canDismiss correctly', () => {
      expect(canDismiss('coordinator')).toBe(true);
      expect(canDismiss('worker')).toBe(false);
    });

    it('should check canAssign correctly', () => {
      expect(canAssign('coordinator')).toBe(true);
      expect(canAssign('monitor')).toBe(false);
    });

    it('should check canBroadcast correctly', () => {
      expect(canBroadcast('coordinator')).toBe(true);
      expect(canBroadcast('notifier')).toBe(false);
    });

    it('should check canMerge correctly', () => {
      expect(canMerge('merger')).toBe(true);
      expect(canMerge('worker')).toBe(false);
    });

    it('should check canClaim correctly', () => {
      expect(canClaim('worker')).toBe(true);
      expect(canClaim('monitor')).toBe(false);
    });

    it('should check canComplete correctly', () => {
      expect(canComplete('worker')).toBe(true);
      expect(canComplete('notifier')).toBe(false);
    });

    it('should check canSend correctly', () => {
      expect(canSend('worker')).toBe(true);
      expect(canSend('monitor')).toBe(false);
    });

    it('should check canPush correctly', () => {
      expect(canPush('merger')).toBe(true);
      expect(canPush('worker')).toBe(false);
    });
  });

  // ======================================================================
  // isValidRole / getAllRoles
  // ======================================================================

  describe('isValidRole', () => {
    it.each(ALL_ROLES)('should validate %s as a valid role', (role) => {
      expect(isValidRole(role)).toBe(true);
    });

    it('should reject invalid role names', () => {
      expect(isValidRole('admin')).toBe(false);
      expect(isValidRole('')).toBe(false);
      expect(isValidRole('superuser')).toBe(false);
    });
  });

  describe('getAllRoles', () => {
    it('should return all 6 roles', () => {
      const roles = getAllRoles();
      expect(roles).toHaveLength(6);
      for (const role of ALL_ROLES) {
        expect(roles).toContain(role);
      }
    });
  });

  // ======================================================================
  // getRoleDescription / permissionError / requirePermission
  // ======================================================================

  describe('getRoleDescription', () => {
    it.each(ALL_ROLES)('should return a description for %s', (role) => {
      const desc = getRoleDescription(role);
      expect(desc).toBeTruthy();
      expect(desc.length).toBeGreaterThan(10);
    });
  });

  describe('permissionError', () => {
    it('should return formatted error message', () => {
      const error = permissionError('worker', 'spawn');
      expect(error).toContain('worker');
      expect(error).toContain('spawn');
    });
  });

  describe('requirePermission', () => {
    it('should return allowed=true when role has permission', () => {
      const check = requirePermission('spawn');
      expect(check('coordinator')).toEqual({ allowed: true });
    });

    it('should return allowed=false with error when role lacks permission', () => {
      const check = requirePermission('spawn');
      const result = check('worker');
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('worker');
      expect(result.error).toContain('spawn');
    });

    it('should be reusable across roles', () => {
      const check = requirePermission('merge' as Permission);
      expect(check('merger').allowed).toBe(true);
      expect(check('worker').allowed).toBe(false);
    });
  });
});
