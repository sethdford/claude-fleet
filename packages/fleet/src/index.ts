/**
 * @cct/fleet - Multi-Agent Orchestration
 *
 * Provides fleet management, worker spawning, and coordination.
 */

export { FleetManager } from './manager.js';
export { WorktreeManager } from './worktree.js';
export { Blackboard } from './blackboard.js';
export { WorkflowEngine } from './workflow.js';
export * from './roles.js';
export type { SpawnOptions, FleetConfig } from './manager.js';
