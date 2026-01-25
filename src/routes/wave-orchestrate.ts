/**
 * Wave & Multi-Repo Orchestration Route Handlers
 *
 * Endpoints for orchestrating waves of workers and multi-repo operations.
 * Requires @claude-fleet/tmux package for full functionality.
 */

import type { Request, Response } from 'express';
import type { ErrorResponse } from '../types.js';
import type { RouteDependencies, BroadcastToAll } from './types.js';

// Check if tmux package is available
let tmuxAvailable = false;
let waveModule: typeof import('./wave-orchestrate-impl.js') | null = null;

try {
  // Check if @claude-fleet/tmux is available
  await import('@claude-fleet/tmux');
  // If available, load the implementation
  waveModule = await import('./wave-orchestrate-impl.js');
  tmuxAvailable = true;
} catch {
  // @claude-fleet/tmux not available - wave orchestration disabled
}

function notAvailable(_req: Request, res: Response): void {
  res.status(501).json({
    error: 'Wave orchestration requires @claude-fleet/tmux package. This feature is not available in the npm package.',
    hint: 'For full functionality, install from source with workspace packages.'
  } as ErrorResponse);
}

// Export handlers - use real implementation if available, otherwise stub
export function createExecuteWavesHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createExecuteWavesHandler(deps, broadcastToAll)
    : notAvailable;
}

export function createGetWaveStatusHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createGetWaveStatusHandler(deps)
    : notAvailable;
}

export function createCancelWaveHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createCancelWaveHandler(deps)
    : notAvailable;
}

export function createListWaveExecutionsHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createListWaveExecutionsHandler(deps)
    : notAvailable;
}

export function createExecuteMultiRepoHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createExecuteMultiRepoHandler(deps, broadcastToAll)
    : notAvailable;
}

export function createGetMultiRepoStatusHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createGetMultiRepoStatusHandler(deps)
    : notAvailable;
}

export function createListMultiRepoExecutionsHandler(deps: RouteDependencies) {
  return tmuxAvailable && waveModule
    ? waveModule.createListMultiRepoExecutionsHandler(deps)
    : notAvailable;
}

export function createUpdateDepsHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createUpdateDepsHandler(deps, broadcastToAll)
    : notAvailable;
}

export function createSecurityAuditHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createSecurityAuditHandler(deps, broadcastToAll)
    : notAvailable;
}

export function createFormatCodeHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createFormatCodeHandler(deps, broadcastToAll)
    : notAvailable;
}

export function createRunTestsHandler(deps: RouteDependencies, broadcastToAll: BroadcastToAll) {
  return tmuxAvailable && waveModule
    ? waveModule.createRunTestsHandler(deps, broadcastToAll)
    : notAvailable;
}
