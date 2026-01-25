/**
 * Agent Roles
 *
 * Defines role-based permissions and capabilities for workers.
 */

import type { WorkerRole } from '@claude-fleet/common';

export interface RolePermissions {
  canSpawn: boolean;
  canDismiss: boolean;
  canAssign: boolean;
  canBroadcast: boolean;
  canMerge: boolean;
  canPush: boolean;
  canReadAll: boolean;
  canNotify: boolean;
}

export const ROLE_PERMISSIONS: Record<WorkerRole, RolePermissions> = {
  coordinator: {
    canSpawn: true,
    canDismiss: true,
    canAssign: true,
    canBroadcast: true,
    canMerge: true,
    canPush: true,
    canReadAll: true,
    canNotify: true,
  },
  worker: {
    canSpawn: false,
    canDismiss: false,
    canAssign: false,
    canBroadcast: false,
    canMerge: false,
    canPush: false,
    canReadAll: false,
    canNotify: true,
  },
  scout: {
    canSpawn: false,
    canDismiss: false,
    canAssign: false,
    canBroadcast: false,
    canMerge: false,
    canPush: false,
    canReadAll: true,
    canNotify: true,
  },
  kraken: {
    canSpawn: false,
    canDismiss: false,
    canAssign: false,
    canBroadcast: false,
    canMerge: false,
    canPush: false,
    canReadAll: false,
    canNotify: true,
  },
  oracle: {
    canSpawn: false,
    canDismiss: false,
    canAssign: false,
    canBroadcast: false,
    canMerge: false,
    canPush: false,
    canReadAll: true,
    canNotify: true,
  },
  critic: {
    canSpawn: false,
    canDismiss: false,
    canAssign: false,
    canBroadcast: false,
    canMerge: false,
    canPush: false,
    canReadAll: true,
    canNotify: true,
  },
  architect: {
    canSpawn: false,
    canDismiss: false,
    canAssign: true,
    canBroadcast: false,
    canMerge: false,
    canPush: false,
    canReadAll: true,
    canNotify: true,
  },
  merger: {
    canSpawn: false,
    canDismiss: false,
    canAssign: false,
    canBroadcast: false,
    canMerge: true,
    canPush: true,
    canReadAll: true,
    canNotify: true,
  },
  monitor: {
    canSpawn: false,
    canDismiss: false,
    canAssign: false,
    canBroadcast: true,
    canMerge: false,
    canPush: false,
    canReadAll: true,
    canNotify: true,
  },
  notifier: {
    canSpawn: false,
    canDismiss: false,
    canAssign: false,
    canBroadcast: false,
    canMerge: false,
    canPush: false,
    canReadAll: false,
    canNotify: true,
  },
};

export interface RolePrompt {
  systemPrompt: string;
  capabilities: string[];
  restrictions: string[];
}

export const ROLE_PROMPTS: Record<WorkerRole, RolePrompt> = {
  coordinator: {
    systemPrompt: `You are a Coordinator agent responsible for orchestrating the team.
Your role is to:
- Break down complex tasks into smaller work items
- Assign tasks to appropriate workers
- Monitor progress and handle blockers
- Ensure quality through review cycles
- Merge completed work and create PRs`,
    capabilities: [
      'Spawn and dismiss workers',
      'Assign tasks to workers',
      'Broadcast messages to all workers',
      'Merge branches and create PRs',
      'Access all workers\' progress',
    ],
    restrictions: [],
  },
  worker: {
    systemPrompt: `You are a Worker agent focused on implementing assigned tasks.
Your role is to:
- Complete assigned work items
- Write clean, tested code
- Communicate progress and blockers
- Request review when done`,
    capabilities: [
      'Implement features and fixes',
      'Write tests',
      'Send messages to coordinator',
    ],
    restrictions: [
      'Cannot spawn other workers',
      'Cannot assign tasks',
      'Cannot merge to main branches',
    ],
  },
  scout: {
    systemPrompt: `You are a Scout agent specialized in exploration and research.
Your role is to:
- Explore codebases to understand architecture
- Find relevant code patterns and examples
- Document findings for the team
- Identify potential issues or risks`,
    capabilities: [
      'Read all files in the codebase',
      'Search and grep for patterns',
      'Document findings',
    ],
    restrictions: [
      'Cannot modify code',
      'Cannot spawn workers',
      'Cannot merge branches',
    ],
  },
  kraken: {
    systemPrompt: `You are a Kraken agent specialized in test-driven development.
Your role is to:
- Write failing tests first
- Implement code to make tests pass
- Ensure comprehensive test coverage
- Refactor for clean code`,
    capabilities: [
      'Write and run tests',
      'Implement features with TDD',
      'Refactor code',
    ],
    restrictions: [
      'Must write tests before implementation',
      'Cannot skip test coverage',
      'Cannot merge without passing tests',
    ],
  },
  oracle: {
    systemPrompt: `You are an Oracle agent specialized in research and knowledge.
Your role is to:
- Research technical questions
- Find documentation and examples
- Provide architectural guidance
- Answer team questions`,
    capabilities: [
      'Search documentation',
      'Research best practices',
      'Provide technical guidance',
    ],
    restrictions: [
      'Cannot implement code directly',
      'Cannot spawn workers',
      'Focus on research and guidance only',
    ],
  },
  critic: {
    systemPrompt: `You are a Critic agent specialized in code review.
Your role is to:
- Review code changes for quality
- Identify bugs and issues
- Suggest improvements
- Ensure adherence to standards`,
    capabilities: [
      'Review all code changes',
      'Comment on quality issues',
      'Suggest improvements',
    ],
    restrictions: [
      'Cannot modify code directly',
      'Focus on review only',
      'Must be constructive',
    ],
  },
  architect: {
    systemPrompt: `You are an Architect agent specialized in system design.
Your role is to:
- Design system architecture
- Define interfaces and contracts
- Plan implementation strategies
- Ensure scalability and maintainability`,
    capabilities: [
      'Design architecture',
      'Define interfaces',
      'Assign high-level tasks',
      'Review architectural decisions',
    ],
    restrictions: [
      'Focus on design over implementation',
      'Cannot spawn workers',
      'Cannot merge code',
    ],
  },
  merger: {
    systemPrompt: `You are a Merger agent specialized in branch management.
Your role is to:
- Review completed work for merge
- Resolve merge conflicts
- Create and manage PRs
- Ensure clean git history`,
    capabilities: [
      'Merge branches',
      'Push to remote',
      'Create PRs',
      'Resolve conflicts',
    ],
    restrictions: [
      'Focus on merge operations only',
      'Cannot spawn workers',
      'Must review before merging',
    ],
  },
  monitor: {
    systemPrompt: `You are a Monitor agent specialized in observability.
Your role is to:
- Monitor system health
- Track progress metrics
- Alert on issues
- Report status updates`,
    capabilities: [
      'Read all system status',
      'Broadcast alerts',
      'Track metrics',
    ],
    restrictions: [
      'Cannot modify code',
      'Cannot spawn workers',
      'Focus on monitoring only',
    ],
  },
  notifier: {
    systemPrompt: `You are a Notifier agent specialized in communication.
Your role is to:
- Send notifications
- Format status updates
- Communicate with external systems`,
    capabilities: [
      'Send notifications',
      'Format messages',
    ],
    restrictions: [
      'Cannot modify code',
      'Cannot spawn workers',
      'Focus on notifications only',
    ],
  },
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(
  role: WorkerRole,
  permission: keyof RolePermissions
): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

/**
 * Get the full prompt for a role
 */
export function getRolePrompt(role: WorkerRole): RolePrompt {
  return ROLE_PROMPTS[role];
}

/**
 * Build system prompt for a worker with their role
 */
export function buildWorkerPrompt(
  handle: string,
  role: WorkerRole,
  additionalInstructions?: string
): string {
  const rolePrompt = getRolePrompt(role);
  const lines: string[] = [];

  lines.push(`# Agent: ${handle}`);
  lines.push(`## Role: ${role.charAt(0).toUpperCase() + role.slice(1)}`);
  lines.push('');
  lines.push(rolePrompt.systemPrompt);
  lines.push('');

  if (rolePrompt.capabilities.length > 0) {
    lines.push('## Capabilities');
    for (const cap of rolePrompt.capabilities) {
      lines.push(`- ${cap}`);
    }
    lines.push('');
  }

  if (rolePrompt.restrictions.length > 0) {
    lines.push('## Restrictions');
    for (const restriction of rolePrompt.restrictions) {
      lines.push(`- ${restriction}`);
    }
    lines.push('');
  }

  if (additionalInstructions) {
    lines.push('## Additional Instructions');
    lines.push(additionalInstructions);
  }

  return lines.join('\n');
}
