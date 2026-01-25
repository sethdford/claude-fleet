/**
 * Audit Route Handlers
 *
 * Endpoints for launching and monitoring the audit loop from the dashboard.
 */

import type { Request, Response } from 'express';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';
import {
  validateBody,
  validateQuery,
  startAuditSchema,
  auditOutputQuerySchema,
} from '../validation/schemas.js';

// Get project root directory (where scripts/ folder is)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ============================================================================
// AUDIT STATE
// ============================================================================

interface AuditState {
  isRunning: boolean;
  process: ChildProcess | null;
  output: string[];
  startedAt: number | null;
  exitCode: number | null;
  pid: number | null;
}

// Global audit state (only one audit can run at a time)
const auditState: AuditState = {
  isRunning: false,
  process: null,
  output: [],
  startedAt: null,
  exitCode: null,
  pid: null,
};

// Max output lines to keep in memory
const MAX_OUTPUT_LINES = 1000;

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * GET /audit/status
 * Get current audit loop status
 */
export function createAuditStatusHandler(_deps: RouteDependencies) {
  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.json({
      isRunning: auditState.isRunning,
      startedAt: auditState.startedAt,
      exitCode: auditState.exitCode,
      pid: auditState.pid,
      outputLines: auditState.output.length,
    });
  });
}

/**
 * GET /audit/output
 * Get audit loop output
 * Query params:
 *   - since: line number to start from (0-indexed)
 *   - limit: max lines to return (default: 100)
 */
export function createAuditOutputHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateQuery(auditOutputQuerySchema, req.query);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { since, limit } = validation.data;
    const lines = auditState.output.slice(since, since + limit);

    res.json({
      lines,
      totalLines: auditState.output.length,
      since,
      isRunning: auditState.isRunning,
    });
  });
}

/**
 * POST /audit/start
 * Start the audit loop
 * Body params:
 *   - dryRun: boolean (optional, default: false)
 *   - maxIterations: number (optional, default: 20, max: 100)
 */
export function createAuditStartHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // Validate input
    const validation = validateBody(startAuditSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { dryRun, maxIterations } = validation.data;

    // Check if already running
    if (auditState.isRunning) {
      res.status(409).json({
        error: 'Audit loop already running',
        pid: auditState.pid,
        startedAt: auditState.startedAt,
      });
      return;
    }

    // Verify script exists
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'audit-loop.sh');
    if (!existsSync(scriptPath)) {
      res.status(500).json({
        error: 'Audit script not found',
        hint: 'Ensure scripts/audit-loop.sh exists in project root',
      });
      return;
    }

    // Build command args
    const args: string[] = [];
    if (dryRun) args.push('--dry-run');
    if (maxIterations !== 20) args.push('--max-iterations', String(maxIterations));

    // Reset state
    auditState.output = [];
    auditState.exitCode = null;
    auditState.startedAt = Date.now();
    auditState.isRunning = true;

    // Spawn the audit loop process
    const child = spawn('bash', [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '1',
      },
    });

    auditState.process = child;
    auditState.pid = child.pid ?? null;

    // Capture stdout
    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      auditState.output.push(...lines);

      // Trim old output to prevent memory growth
      if (auditState.output.length > MAX_OUTPUT_LINES) {
        auditState.output = auditState.output.slice(-MAX_OUTPUT_LINES);
      }

      // Broadcast to WebSocket if available
      if (deps.broadcastToAll) {
        deps.broadcastToAll({
          type: 'audit:output',
          lines,
        });
      }
    });

    // Capture stderr (merge with stdout for display)
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      auditState.output.push(...lines.map(l => `[stderr] ${l}`));

      if (auditState.output.length > MAX_OUTPUT_LINES) {
        auditState.output = auditState.output.slice(-MAX_OUTPUT_LINES);
      }
    });

    // Handle process exit
    child.on('close', (code) => {
      auditState.isRunning = false;
      auditState.exitCode = code;
      auditState.process = null;

      const status = code === 0 ? 'completed' : 'failed';
      console.log(`[AUDIT] Audit loop ${status} with exit code ${code}`);

      // Broadcast completion
      if (deps.broadcastToAll) {
        deps.broadcastToAll({
          type: 'audit:complete',
          exitCode: code,
          status,
        });
      }
    });

    child.on('error', (error) => {
      auditState.isRunning = false;
      auditState.exitCode = -1;
      auditState.process = null;
      auditState.output.push(`[error] Failed to start: ${error.message}`);

      console.error('[AUDIT] Failed to start audit loop:', error);
    });

    console.log(`[AUDIT] Started audit loop (pid: ${child.pid}, dryRun: ${dryRun}, maxIterations: ${maxIterations})`);

    res.json({
      success: true,
      pid: child.pid,
      startedAt: auditState.startedAt,
      dryRun,
      maxIterations,
    });
  });
}

/**
 * POST /audit/stop
 * Stop the running audit loop
 */
export function createAuditStopHandler(_deps: RouteDependencies) {
  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    if (!auditState.isRunning || !auditState.process) {
      res.status(400).json({ error: 'No audit loop is running' });
      return;
    }

    const pid = auditState.pid;

    // Send SIGTERM for graceful shutdown
    auditState.process.kill('SIGTERM');

    // Give it 5 seconds before SIGKILL
    setTimeout(() => {
      if (auditState.isRunning && auditState.process) {
        auditState.process.kill('SIGKILL');
      }
    }, 5000);

    console.log(`[AUDIT] Stopping audit loop (pid: ${pid})`);

    res.json({
      success: true,
      message: 'Audit loop stop requested',
      pid,
    });
  });
}

/**
 * POST /audit/quick
 * Run a quick audit (typecheck, lint, tests, build) without the loop
 */
export function createQuickAuditHandler(deps: RouteDependencies) {
  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    // Check if already running
    if (auditState.isRunning) {
      res.status(409).json({ error: 'Audit already running' });
      return;
    }

    // Run fleet audit command
    auditState.output = [];
    auditState.exitCode = null;
    auditState.startedAt = Date.now();
    auditState.isRunning = true;

    const child = spawn('npx', ['tsx', 'src/cli.ts', 'audit'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    auditState.process = child;
    auditState.pid = child.pid ?? null;

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      auditState.output.push(...lines);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      auditState.output.push(...lines);
    });

    child.on('close', (code) => {
      auditState.isRunning = false;
      auditState.exitCode = code;
      auditState.process = null;

      if (deps.broadcastToAll) {
        deps.broadcastToAll({
          type: 'audit:complete',
          exitCode: code,
          status: code === 0 ? 'passed' : 'failed',
        });
      }
    });

    child.on('error', (error) => {
      auditState.isRunning = false;
      auditState.exitCode = -1;
      auditState.process = null;
      auditState.output.push(`[error] ${error.message}`);
    });

    console.log(`[AUDIT] Started quick audit (pid: ${child.pid})`);

    res.json({
      success: true,
      pid: child.pid,
      startedAt: auditState.startedAt,
    });
  });
}
