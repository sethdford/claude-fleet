/**
 * Compound Runner - Type Definitions
 *
 * Types for the autonomous compound iteration loop that moves
 * orchestration logic from bash scripts into TypeScript.
 */

// ============================================================================
// PROJECT DETECTION
// ============================================================================

/** Supported project types for auto-detection and gate generation */
export type ProjectType = 'node' | 'rust' | 'go' | 'python' | 'make';

// ============================================================================
// COMPOUND OPTIONS & RESULTS
// ============================================================================

export interface CompoundOptions {
  /** Target codebase directory */
  targetDir: string;
  /** Maximum compound iterations before giving up */
  maxIterations: number;
  /** Number of workers to spawn (1 fixer + N-1 verifiers) */
  numWorkers: number;
  /** Server port */
  port: number;
  /** Server URL */
  serverUrl: string;
  /** Mission objective / goal */
  objective: string;
  /** Real Claude Code workers vs dry-run */
  isLive: boolean;
}

export interface CompoundResult {
  /** Final outcome */
  status: 'succeeded' | 'failed' | 'cancelled';
  /** Number of iterations completed */
  iterations: number;
  /** Git branch created for fleet work */
  branch: string;
  /** Detected project type */
  projectType: ProjectType;
  /** Summary of final gate results */
  gateResults: GateResultSummary[];
}

export interface GateResultSummary {
  name: string;
  status: 'passed' | 'failed' | 'error';
  errorCount: number;
}

// ============================================================================
// GATE CONFIGURATION
// ============================================================================

export interface GateConfig {
  gateType: 'script';
  name: string;
  isRequired: boolean;
  config: {
    command: string;
    args: string[];
    cwd: string;
  };
  sortOrder: number;
}

// ============================================================================
// FEEDBACK
// ============================================================================

export interface StructuredFeedback {
  /** Total error count across all gates */
  totalErrors: number;
  /** Per-gate failure details */
  gates: GateFeedback[];
}

export interface GateFeedback {
  /** Gate name (e.g., "typecheck", "lint", "tests") */
  name: string;
  /** Parsed error lines in "file:line - message" format */
  errors: string[];
  /** Last 15 lines of raw output as fallback */
  rawTail: string[];
}

// ============================================================================
// WORKER PROMPT CONTEXT
// ============================================================================

export type WorkerRole = 'fixer' | 'verifier';

export interface WorkerPromptContext {
  /** Worker handle (e.g., "scout-1") */
  handle: string;
  /** Worker role */
  role: WorkerRole;
  /** Detected project type */
  projectType: ProjectType;
  /** Target codebase directory */
  targetDir: string;
  /** Git branch name */
  branch: string;
  /** Mission objective */
  objective: string;
  /** Current iteration number */
  iteration: number;
  /** Structured feedback from previous iteration (if any) */
  feedback?: StructuredFeedback;
  /** Server URL for API calls */
  serverUrl: string;
  /** Swarm ID for fleet coordination */
  swarmId: string;
}

// ============================================================================
// TMUX LAYOUT
// ============================================================================

export interface TmuxLayout {
  sessionName: string;
  serverPane: string;
  dashboardPane: string;
  workerPanes: string[];
}
