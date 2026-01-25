/**
 * @cct/tmux - Terminal Automation
 *
 * Provides tmux-based terminal automation for fleet management.
 * Spawn workers in separate panes, send commands, capture output.
 */

export { TmuxController } from './controller.js';
export { FleetTmuxManager } from './fleet-manager.js';
export type { FleetWorkerOptions, FleetStatus } from './fleet-manager.js';
export * from './types.js';
