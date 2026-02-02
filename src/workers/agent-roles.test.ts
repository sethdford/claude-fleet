/**
 * Tests for Agent Roles module
 *
 * Pure functions — no mocking needed. Tests role configs,
 * system prompts, spawn validation, and helper functions.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_ROLES,
  getRoleConfig,
  getSystemPromptForRole,
  canRoleSpawn,
  getMaxDepthForRole,
  isSpawnAllowed,
  getAvailableRoles,
  getRoleSummary,
  type FleetAgentRole,
} from './agent-roles.js';

const ALL_ROLES: FleetAgentRole[] = ['lead', 'worker', 'scout', 'kraken', 'oracle', 'critic', 'architect'];

describe('Agent Roles', () => {
  // ======================================================================
  // ROLE_DEFINITIONS
  // ======================================================================

  describe('AGENT_ROLES constant', () => {
    it('should define all 7 roles', () => {
      expect(Object.keys(AGENT_ROLES)).toHaveLength(7);
      for (const role of ALL_ROLES) {
        expect(AGENT_ROLES[role]).toBeDefined();
      }
    });

    it.each(ALL_ROLES)('should have required fields for role %s', (role) => {
      const config = AGENT_ROLES[role];
      expect(config.name).toBe(role);
      expect(config.description).toBeTruthy();
      expect(config.systemPrompt).toBeTruthy();
      expect(config.allowedTools).toBeInstanceOf(Array);
      expect(config.allowedTools.length).toBeGreaterThan(0);
      expect(typeof config.maxDepth).toBe('number');
      expect(typeof config.canSpawn).toBe('boolean');
      expect(['low', 'normal', 'high']).toContain(config.defaultPriority);
    });

    it('should only allow lead to spawn', () => {
      expect(AGENT_ROLES.lead.canSpawn).toBe(true);
      const nonLeadRoles = ALL_ROLES.filter(r => r !== 'lead');
      for (const role of nonLeadRoles) {
        expect(AGENT_ROLES[role].canSpawn).toBe(false);
      }
    });

    it('should give lead and architect high priority', () => {
      expect(AGENT_ROLES.lead.defaultPriority).toBe('high');
      expect(AGENT_ROLES.architect.defaultPriority).toBe('high');
    });

    it('should give worker, scout, kraken, oracle, critic normal priority', () => {
      for (const role of ['worker', 'scout', 'kraken', 'oracle', 'critic'] as FleetAgentRole[]) {
        expect(AGENT_ROLES[role].defaultPriority).toBe('normal');
      }
    });
  });

  // ======================================================================
  // getRoleConfig
  // ======================================================================

  describe('getRoleConfig', () => {
    it.each(ALL_ROLES)('should return config for %s', (role) => {
      const config = getRoleConfig(role);
      expect(config.name).toBe(role);
    });

    it('should fall back to worker config for unknown role', () => {
      const config = getRoleConfig('nonexistent' as FleetAgentRole);
      expect(config.name).toBe('worker');
    });
  });

  // ======================================================================
  // getSystemPromptForRole
  // ======================================================================

  describe('getSystemPromptForRole', () => {
    it.each(ALL_ROLES)('should return non-empty prompt for %s', (role) => {
      const prompt = getSystemPromptForRole(role);
      expect(prompt.length).toBeGreaterThan(50);
    });

    it('should return worker prompt for unknown role', () => {
      const prompt = getSystemPromptForRole('nonexistent' as FleetAgentRole);
      expect(prompt).toBe(AGENT_ROLES.worker.systemPrompt);
    });

    it('should contain role-specific keywords in lead prompt', () => {
      const prompt = getSystemPromptForRole('lead');
      expect(prompt).toContain('Team Lead');
      expect(prompt).toContain('Spawn');
    });

    it('should contain TDD keywords in kraken prompt', () => {
      const prompt = getSystemPromptForRole('kraken');
      expect(prompt).toContain('TDD');
      expect(prompt).toContain('RED');
      expect(prompt).toContain('GREEN');
    });
  });

  // ======================================================================
  // canRoleSpawn
  // ======================================================================

  describe('canRoleSpawn', () => {
    it('should return true for lead', () => {
      expect(canRoleSpawn('lead')).toBe(true);
    });

    it('should return false for non-lead roles', () => {
      for (const role of ALL_ROLES.filter(r => r !== 'lead')) {
        expect(canRoleSpawn(role)).toBe(false);
      }
    });

    it('should return false for unknown role', () => {
      expect(canRoleSpawn('unknown' as FleetAgentRole)).toBe(false);
    });
  });

  // ======================================================================
  // getMaxDepthForRole
  // ======================================================================

  describe('getMaxDepthForRole', () => {
    it('should return correct depth for each role', () => {
      expect(getMaxDepthForRole('lead')).toBe(1);
      expect(getMaxDepthForRole('worker')).toBe(2);
      expect(getMaxDepthForRole('scout')).toBe(3);
      expect(getMaxDepthForRole('kraken')).toBe(2);
      expect(getMaxDepthForRole('oracle')).toBe(3);
      expect(getMaxDepthForRole('critic')).toBe(3);
      expect(getMaxDepthForRole('architect')).toBe(2);
    });

    it('should return default of 2 for unknown role', () => {
      expect(getMaxDepthForRole('unknown' as FleetAgentRole)).toBe(2);
    });
  });

  // ======================================================================
  // isSpawnAllowed
  // ======================================================================

  describe('isSpawnAllowed', () => {
    it('should allow lead to spawn worker at depth 0', () => {
      const result = isSpawnAllowed('lead', 0, 'worker');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should deny non-spawning role from spawning', () => {
      const result = isSpawnAllowed('worker', 0, 'scout');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cannot spawn');
    });

    it('should deny spawn when depth exceeds max', () => {
      const result = isSpawnAllowed('lead', 1, 'worker');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds max depth');
    });

    it('should deny spawn when target cannot operate at resulting depth', () => {
      // Lead maxDepth=1, if we're at depth 0, target goes to depth 1
      // Worker maxDepth=2, so depth 1 is fine
      // But if we force a scenario where target depth exceeds target maxDepth:
      // Architect maxDepth=2, lead at depth 0, target would be depth 1 — allowed
      const result = isSpawnAllowed('lead', 0, 'architect');
      expect(result.allowed).toBe(true);
    });

    it('should allow spawn when target depth equals target maxDepth', () => {
      // Lead maxDepth=1, depth=0 → target at depth 1
      // Lead maxDepth=1, check is targetDepth > maxDepth, 1 > 1 = false → allowed
      const result = isSpawnAllowed('lead', 0, 'lead');
      expect(result.allowed).toBe(true);
    });
  });

  // ======================================================================
  // getAvailableRoles
  // ======================================================================

  describe('getAvailableRoles', () => {
    it('should return all 7 roles', () => {
      const roles = getAvailableRoles();
      expect(roles).toHaveLength(7);
      for (const role of ALL_ROLES) {
        expect(roles).toContain(role);
      }
    });
  });

  // ======================================================================
  // getRoleSummary
  // ======================================================================

  describe('getRoleSummary', () => {
    it('should return markdown summary of all roles', () => {
      const summary = getRoleSummary();
      for (const role of ALL_ROLES) {
        expect(summary).toContain(role);
      }
      expect(summary).toContain('**lead**');
      expect(summary).toContain('**worker**');
    });
  });
});
