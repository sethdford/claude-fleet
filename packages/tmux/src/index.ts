/**
 * @cct/tmux - Terminal Automation
 *
 * Provides tmux-based terminal automation for fleet management.
 * Spawn workers in separate panes, send commands, capture output.
 *
 * Key modules:
 * - TmuxController: Low-level tmux command wrapper
 * - FleetTmuxManager: Manage workers in visible panes (inside tmux)
 * - RemoteFleetManager: Headless fleet management (CI/CD, APIs)
 * - ContextManager: Smart trim and context rollover
 * - WaveOrchestrator: Phased worker spawning with dependencies
 * - MultiRepoOrchestrator: Orchestrate work across multiple git repositories
 */

// Core tmux control
export { TmuxController } from './controller.js';

// Local fleet management (inside tmux)
export { FleetTmuxManager } from './fleet-manager.js';
export type { FleetWorkerOptions, FleetStatus } from './fleet-manager.js';

// Worker adapter for integration
export { TmuxWorkerAdapter } from './worker-adapter.js';
export type {
  TmuxWorkerProcess,
  TmuxSpawnRequest,
  TmuxSpawnResponse,
} from './worker-adapter.js';

// Remote/headless fleet management
export { RemoteFleetManager } from './remote-fleet-manager.js';
export type {
  RemoteFleetConfig,
  RemoteWorkerOptions,
  RemoteWorkerInfo,
  SessionLineage,
  FleetSnapshot,
} from './remote-fleet-manager.js';

// Context management (smart trim, continue)
export { ContextManager } from './context-manager.js';
export type {
  ContextMetrics,
  TrimResult,
  ContinueSummary,
  SmartTrimOptions,
  ContinueOptions,
} from './context-manager.js';

// Wave orchestration (phased spawning)
export { WaveOrchestrator, createPipeline, createParallelWave } from './wave-orchestrator.js';
export type {
  WaveWorker,
  Wave,
  WaveResult,
  OrchestratorConfig,
  OrchestratorStatus,
} from './wave-orchestrator.js';

// Multi-repo orchestration
export { MultiRepoOrchestrator, createMultiRepoOrchestrator } from './multi-repo-orchestrator.js';
export type {
  Repository,
  MultiRepoTask,
  MultiRepoConfig,
  RepoResult,
  MultiRepoStatus,
} from './multi-repo-orchestrator.js';

// Core types
export * from './types.js';
