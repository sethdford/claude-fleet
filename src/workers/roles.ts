/**
 * Agent Roles System
 *
 * Defines agent roles and their permissions for the collaboration system.
 * Roles control what actions agents can perform.
 */

import type { AgentRole, RolePermissions } from '../types.js';
import { ROLE_PERMISSIONS } from '../types.js';

export type Permission = keyof RolePermissions;

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: AgentRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions?.[permission] ?? false;
}

/**
 * Check if a role has ALL of the specified permissions
 */
export function hasAllPermissions(role: AgentRole, permissions: Permission[]): boolean {
  return permissions.every(p => hasPermission(role, p));
}

/**
 * Check if a role has ANY of the specified permissions
 */
export function hasAnyPermission(role: AgentRole, permissions: Permission[]): boolean {
  return permissions.some(p => hasPermission(role, p));
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: AgentRole): RolePermissions {
  return ROLE_PERMISSIONS[role];
}

/**
 * Get the list of enabled permissions for a role
 */
export function getEnabledPermissions(role: AgentRole): Permission[] {
  const permissions = ROLE_PERMISSIONS[role];
  return (Object.keys(permissions) as Permission[]).filter(p => permissions[p]);
}

/**
 * Check if a role can spawn workers
 */
export function canSpawn(role: AgentRole): boolean {
  return hasPermission(role, 'spawn');
}

/**
 * Check if a role can dismiss workers
 */
export function canDismiss(role: AgentRole): boolean {
  return hasPermission(role, 'dismiss');
}

/**
 * Check if a role can assign tasks/beads
 */
export function canAssign(role: AgentRole): boolean {
  return hasPermission(role, 'assign');
}

/**
 * Check if a role can broadcast messages
 */
export function canBroadcast(role: AgentRole): boolean {
  return hasPermission(role, 'broadcast');
}

/**
 * Check if a role can merge work
 */
export function canMerge(role: AgentRole): boolean {
  return hasPermission(role, 'merge');
}

/**
 * Check if a role can claim tasks/beads
 */
export function canClaim(role: AgentRole): boolean {
  return hasPermission(role, 'claim');
}

/**
 * Check if a role can complete tasks/beads
 */
export function canComplete(role: AgentRole): boolean {
  return hasPermission(role, 'complete');
}

/**
 * Check if a role can send direct messages
 */
export function canSend(role: AgentRole): boolean {
  return hasPermission(role, 'send');
}

/**
 * Check if a role can push changes
 */
export function canPush(role: AgentRole): boolean {
  return hasPermission(role, 'push');
}

/**
 * Validate that a role is valid
 */
export function isValidRole(role: string): role is AgentRole {
  return role in ROLE_PERMISSIONS;
}

/**
 * Get all available roles
 */
export function getAllRoles(): AgentRole[] {
  return Object.keys(ROLE_PERMISSIONS) as AgentRole[];
}

/**
 * Get role description
 */
export function getRoleDescription(role: AgentRole): string {
  const descriptions: Record<AgentRole, string> = {
    coordinator: 'Can spawn workers, dismiss workers, assign tasks, broadcast, and merge work',
    worker: 'Can claim tasks, complete tasks, and send messages to coordinator',
    monitor: 'Can read all activity and send alerts',
    notifier: 'Can send notifications and read status',
    merger: 'Can merge branches, resolve conflicts, and push changes',
    'team-lead': 'Full permissions - can spawn, dismiss, assign, broadcast, merge, and coordinate the team',
  };
  return descriptions[role];
}

/**
 * Create a permission check error message
 */
export function permissionError(role: AgentRole, permission: Permission): string {
  return `Role '${role}' does not have permission '${permission}'`;
}

/**
 * Create a permission check middleware for API endpoints
 */
export function requirePermission(permission: Permission) {
  return (role: AgentRole): { allowed: boolean; error?: string } => {
    if (hasPermission(role, permission)) {
      return { allowed: true };
    }
    return { allowed: false, error: permissionError(role, permission) };
  };
}
