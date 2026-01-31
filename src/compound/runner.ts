/**
 * Compound Runner - Autonomous Worker Loop Orchestrator
 *
 * Manages the full compound iteration lifecycle:
 *   1. Detect project type and generate quality gates
 *   2. Set up git branch and tmux session
 *   3. Start fleet server and create mission
 *   4. Spawn autonomous workers (fixer + verifiers)
 *   5. Run compound loop: poll → commit → validate → feedback → re-dispatch
 *   6. Report results and preserve tmux session
 */

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProjectType, generateGateConfigs, validateGateCommands } from './detect.js';
import { buildFixerPrompt, buildVerifierPrompt, buildRedispatchPrompt } from './prompts.js';
import { extractFeedbackFromNamedResults } from './feedback.js';
import type {
  CompoundOptions,
  CompoundResult,
  GateConfig,
  GateResultSummary,
  ProjectType,
  StructuredFeedback,
  TmuxLayout,
  WorkerRole,
} from './types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_NAME = 'fleet-compound';
const POLL_INTERVAL_MS = 5_000;
const SERVER_STARTUP_TIMEOUT_MS = 30_000;
const WORKER_TIMEOUT_FIRST_ITER_MS = 600_000; // 10 min
const WORKER_TIMEOUT_SUBSEQUENT_MS = 300_000; // 5 min

// ============================================================================
// ANSI COLORS
// ============================================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

// ============================================================================
// COMPOUND RUNNER
// ============================================================================

export class CompoundRunner {
  private projectType: ProjectType = 'node';
  private gates: GateConfig[] = [];
  private originalBranch = '';
  private fleetBranch = '';
  private hasStashed = false;
  private layout: TmuxLayout | null = null;
  private token = '';
  private swarmId = '';
  private missionId = '';
  private projectDir: string;
  private promptDir = '';
  private signalHandlers: Array<{ signal: NodeJS.Signals; handler: () => void }> = [];

  constructor(private options: CompoundOptions) {
    // Resolve the project directory for the fleet server itself
    const currentFile = fileURLToPath(import.meta.url);
    this.projectDir = resolve(dirname(currentFile), '..', '..');
  }

  // ── Main Entry Point ────────────────────────────────────────────────────

  async run(): Promise<CompoundResult> {
    // Register signal handlers for crash cleanup
    const onSignal = (): void => {
      this.log('warn', 'Signal received, cleaning up...');
      this.cleanup();
      this.restoreGit();
      process.exit(1);
    };
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const sig of signals) {
      const handler = (): void => onSignal();
      process.on(sig, handler);
      this.signalHandlers.push({ signal: sig, handler });
    }

    try {
      // 0. Preflight validation
      this.preflight();

      // 1. Create temp directory for prompt files and DB
      this.promptDir = join(tmpdir(), `fleet-compound-${Date.now()}`);
      mkdirSync(this.promptDir, { recursive: true });
      this.log('dim', `Prompt dir: ${this.promptDir}`);

      // 2. Detect project type
      this.detectProject();

      // 3. Set up git branch
      this.setupGitBranch();

      // 4. Create tmux layout
      this.layout = this.createTmuxLayout();

      // 5. Start server
      await this.startServer();

      // 6. Authenticate and create mission
      await this.setupMission();

      // 7. Spawn workers
      this.spawnWorkers();

      // 8. Start dashboard
      this.startDashboard();

      // 9. Run compound loop
      const result = await this.compoundLoop();

      // 10. Attach to tmux session for inspection
      this.log('info', `Compound run complete. Attaching to tmux session...`);
      this.log('dim', `Fleet branch: ${this.fleetBranch}`);
      this.log('dim', `Tip: Press Ctrl+B then D to detach`);

      try {
        execSync(`tmux attach-session -t ${SESSION_NAME}`, { stdio: 'inherit' });
      } catch {
        // User detached or tmux not available for attach
      }

      // Clean up temp files on success
      this.cleanup();

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('error', `Fatal error: ${message}`);

      // On failure, preserve tmux session for debugging but clean temp files
      if (this.layout) {
        this.log('dim', `Tmux session preserved for debugging: tmux attach -t ${SESSION_NAME}`);
      }

      return {
        status: 'failed',
        iterations: 0,
        branch: this.fleetBranch || 'none',
        projectType: this.projectType,
        gateResults: [],
      };
    } finally {
      this.restoreGit();

      // Remove signal handlers
      for (const { signal, handler } of this.signalHandlers) {
        process.removeListener(signal, handler);
      }
      this.signalHandlers = [];
    }
  }

  // ── Step 0: Preflight Validation ───────────────────────────────────────

  private preflight(): void {
    // Check tmux is available
    try {
      execSync('which tmux', { encoding: 'utf-8', stdio: 'pipe' });
    } catch {
      throw new Error(
        'tmux is not installed.\n' +
        '  macOS: brew install tmux\n' +
        '  Ubuntu: sudo apt install tmux\n' +
        '  Required for compound runner multi-pane layout.',
      );
    }

    // Check git is available
    try {
      execSync('which git', { encoding: 'utf-8', stdio: 'pipe' });
    } catch {
      throw new Error(
        'git is not installed.\n' +
        '  Install from https://git-scm.com/downloads',
      );
    }

    // Check Claude Code is available (only in live mode)
    if (this.options.isLive) {
      try {
        execSync('which claude', { encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        throw new Error(
          'Claude Code CLI is not installed (required for --live mode).\n' +
          '  Install: npm install -g @anthropic-ai/claude-code\n' +
          '  Docs: https://docs.anthropic.com/en/docs/claude-code',
        );
      }
    }

    // Check target directory exists and is a git repo
    const targetDir = this.options.targetDir;
    if (!existsSync(targetDir)) {
      throw new Error(`Target directory does not exist: ${targetDir}`);
    }
    if (!existsSync(join(targetDir, '.git'))) {
      throw new Error(`Target directory is not a git repository: ${targetDir}`);
    }

    // Check port is not already in use
    try {
      execSync(
        `curl -sf http://localhost:${this.options.port}/health`,
        { encoding: 'utf-8', stdio: 'pipe', timeout: 3000 },
      );
      // If curl succeeds, something is already listening on the port
      throw new Error(
        `Port ${this.options.port} is already in use.\n` +
        '  Another fleet server may be running. Use --port to choose a different port.',
      );
    } catch (err) {
      // curl failing means the port is free — that's what we want
      if (err instanceof Error && err.message.includes('Port')) {
        throw err; // Re-throw our own error
      }
    }

    // Kill stale tmux session if it exists
    try {
      execSync(`tmux kill-session -t ${SESSION_NAME} 2>/dev/null`, { encoding: 'utf-8' });
      this.log('dim', 'Killed stale tmux session');
    } catch {
      // No existing session — good
    }

    this.log('ok', 'Preflight checks passed');
  }

  // ── Step 1: Project Detection ───────────────────────────────────────────

  private detectProject(): void {
    const detectedType = detectProjectType(this.options.targetDir);
    if (!detectedType) {
      throw new Error(
        `Cannot detect project type in: ${this.options.targetDir}\n` +
        '  Supported: package.json (node), Cargo.toml (rust), go.mod (go),\n' +
        '             pyproject.toml/setup.py (python), Makefile (make)',
      );
    }

    this.projectType = detectedType;
    this.gates = generateGateConfigs(this.projectType, this.options.targetDir);

    if (this.gates.length === 0) {
      throw new Error(
        `No quality gates detected for ${this.projectType} project.\n` +
        '  The project needs linters, type checkers, or test runners configured.',
      );
    }

    // Validate gate commands are available on PATH
    const gateWarnings = validateGateCommands(this.gates);
    if (gateWarnings.length > 0) {
      for (const warning of gateWarnings) {
        this.log('warn', warning);
      }
      // Filter out gates with missing commands
      const missingCommands = new Set(
        gateWarnings.map(w => {
          const match = /"(\w+)" not found/.exec(w);
          return match ? match[1] : '';
        }).filter(Boolean),
      );
      this.gates = this.gates.filter(g => !missingCommands.has(g.config.command));

      if (this.gates.length === 0) {
        throw new Error(
          `All quality gate commands are missing.\n` +
          '  Install the required tools and try again.',
        );
      }
    }

    this.log('ok', `Target: ${this.options.targetDir} (${this.projectType})`);
    this.log('info', `Detected ${this.gates.length} quality gates: ${this.gates.map(g => g.name).join(', ')}`);
  }

  // ── Step 2: Git Branch Setup ────────────────────────────────────────────

  private setupGitBranch(): void {
    const targetDir = this.options.targetDir;

    if (!existsSync(`${targetDir}/.git`)) {
      throw new Error(`Not a git repo: ${targetDir}`);
    }

    this.originalBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: targetDir,
      encoding: 'utf-8',
    }).trim();

    this.fleetBranch = `fleet/fix-${Math.floor(Date.now() / 1000)}`;

    // Stash uncommitted changes
    const porcelain = execSync('git status --porcelain', {
      cwd: targetDir,
      encoding: 'utf-8',
    }).trim();

    if (porcelain.length > 0) {
      this.log('info', 'Stashing uncommitted changes...');
      try {
        execSync(`git stash push -m "fleet: auto-stash before ${this.fleetBranch}"`, {
          cwd: targetDir,
          encoding: 'utf-8',
        });
        this.hasStashed = true;
      } catch {
        // Stash may fail if there are no changes to stash
      }
    }

    execSync(`git checkout -b ${this.fleetBranch}`, {
      cwd: targetDir,
      encoding: 'utf-8',
    });

    this.log('ok', `Created branch ${this.fleetBranch} from ${this.originalBranch}`);
  }

  private restoreGit(): void {
    if (!this.originalBranch || !existsSync(`${this.options.targetDir}/.git`)) return;

    try {
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.options.targetDir,
        encoding: 'utf-8',
      }).trim();

      if (currentBranch.startsWith('fleet/fix-')) {
        execSync(`git checkout ${this.originalBranch}`, {
          cwd: this.options.targetDir,
          encoding: 'utf-8',
        });
      }

      if (this.hasStashed) {
        execSync('git stash pop', { cwd: this.options.targetDir, encoding: 'utf-8' });
      }

      if (currentBranch.startsWith('fleet/fix-')) {
        this.log('info', `Fleet work preserved on branch: ${currentBranch}`);
      }
    } catch {
      this.log('warn', 'Could not restore git state. Check manually.');
    }
  }

  // ── Step 3: Tmux Layout ─────────────────────────────────────────────────

  private createTmuxLayout(): TmuxLayout {
    // Kill existing session
    try {
      execSync(`tmux kill-session -t ${SESSION_NAME} 2>/dev/null`, { encoding: 'utf-8' });
    } catch {
      // No existing session
    }

    // Create new session
    execSync(
      `tmux new-session -d -s ${SESSION_NAME} -x 220 -y 55 -c "${this.projectDir}"`,
      { encoding: 'utf-8' },
    );

    const serverPane = this.tmuxDisplayPaneId();

    // Split right for dashboard
    execSync(
      `tmux split-window -h -t ${serverPane} -l '45%' -c "${this.projectDir}"`,
      { encoding: 'utf-8' },
    );
    const dashboardPane = this.tmuxDisplayPaneId();

    // Split server pane vertically for worker-1
    execSync(
      `tmux split-window -v -t ${serverPane} -l '60%' -c "${this.projectDir}"`,
      { encoding: 'utf-8' },
    );
    const workerPanes: string[] = [this.tmuxDisplayPaneId()];

    // Split dashboard pane for worker-2
    if (this.options.numWorkers >= 2) {
      execSync(
        `tmux split-window -v -t ${dashboardPane} -l '60%' -c "${this.projectDir}"`,
        { encoding: 'utf-8' },
      );
      workerPanes.push(this.tmuxDisplayPaneId());
    }

    // Additional workers stack below existing panes
    if (this.options.numWorkers >= 3) {
      execSync(
        `tmux split-window -v -t ${workerPanes[0]} -l '50%' -c "${this.projectDir}"`,
        { encoding: 'utf-8' },
      );
      workerPanes.push(this.tmuxDisplayPaneId());
    }

    if (this.options.numWorkers >= 4) {
      execSync(
        `tmux split-window -v -t ${workerPanes[1]} -l '50%' -c "${this.projectDir}"`,
        { encoding: 'utf-8' },
      );
      workerPanes.push(this.tmuxDisplayPaneId());
    }

    if (this.options.numWorkers >= 5) {
      execSync(
        `tmux split-window -v -t ${workerPanes[2]} -l '50%' -c "${this.projectDir}"`,
        { encoding: 'utf-8' },
      );
      workerPanes.push(this.tmuxDisplayPaneId());
    }

    // Enable pane border titles
    try {
      execSync(`tmux set-option -t ${SESSION_NAME} pane-border-status top`, { encoding: 'utf-8' });
      execSync(
        `tmux set-option -t ${SESSION_NAME} pane-border-format '#[fg=green,bold] #{pane_title} #[default]'`,
        { encoding: 'utf-8' },
      );
    } catch {
      // Older tmux versions may not support border status
    }

    // Name panes
    execSync(`tmux select-pane -t ${serverPane} -T 'SERVER'`, { encoding: 'utf-8' });
    execSync(`tmux select-pane -t ${dashboardPane} -T 'DASHBOARD'`, { encoding: 'utf-8' });

    const roles: WorkerRole[] = ['fixer', 'verifier', 'verifier', 'verifier', 'verifier'];
    for (let i = 0; i < workerPanes.length; i++) {
      const role = roles[i] ?? 'verifier';
      execSync(
        `tmux select-pane -t ${workerPanes[i]} -T 'scout-${i + 1} [${role}]'`,
        { encoding: 'utf-8' },
      );
    }

    this.log('ok', `Tmux layout created (${workerPanes.length + 2} panes)`);

    return { sessionName: SESSION_NAME, serverPane, dashboardPane, workerPanes };
  }

  private tmuxDisplayPaneId(): string {
    return execSync(
      `tmux display-message -t ${SESSION_NAME} -p '#{pane_id}'`,
      { encoding: 'utf-8' },
    ).trim();
  }

  // ── Step 4: Start Server ────────────────────────────────────────────────

  private async startServer(): Promise<void> {
    if (!this.layout) throw new Error('Layout not initialized');

    this.log('info', `Starting fleet server on port ${this.options.port}...`);

    const dbPath = join(this.promptDir, 'fleet-compound.db');
    const distPath = join(this.projectDir, 'dist', 'index.js');
    const nodeBin = execSync('which node', { encoding: 'utf-8', stdio: 'pipe' }).trim();

    let serverCmd: string;
    if (existsSync(distPath)) {
      serverCmd = `DB_PATH=${this.shellQuote(dbPath)} PORT=${this.options.port} ${nodeBin} ${this.shellQuote(distPath)} 2>&1`;
    } else {
      serverCmd = `DB_PATH=${this.shellQuote(dbPath)} PORT=${this.options.port} npx tsx ${this.shellQuote(join(this.projectDir, 'src', 'index.ts'))} 2>&1`;
    }

    execSync(
      `tmux send-keys -t ${this.layout.serverPane} ${this.shellQuote(serverCmd)} Enter`,
      { encoding: 'utf-8' },
    );

    // Poll for server readiness
    const deadline = Date.now() + SERVER_STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${this.options.serverUrl}/health`);
        if (response.ok) {
          this.log('ok', 'Server ready');
          return;
        }
      } catch {
        // Server not ready yet
      }
      await sleep(1000);
    }

    // On timeout, capture server pane output for diagnostics
    let serverOutput = '';
    try {
      serverOutput = execSync(
        `tmux capture-pane -t ${this.layout.serverPane} -p -S -50`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
    } catch {
      // Capture failed
    }

    const diagnostic = serverOutput
      ? `\nServer pane output:\n${serverOutput.slice(-500)}`
      : '';

    throw new Error(
      `Server failed to start within ${SERVER_STARTUP_TIMEOUT_MS / 1000}s.${diagnostic}`,
    );
  }

  // ── Step 5: Mission Setup ───────────────────────────────────────────────

  private async setupMission(): Promise<void> {
    // Authenticate
    const authResponse = await this.apiPost('/auth', {
      handle: 'compound-lead',
      teamName: 'compound-team',
      agentType: 'team-lead',
    });
    this.token = (authResponse as { token: string }).token;

    if (!this.token) {
      throw new Error('Authentication failed');
    }

    this.log('ok', 'Authenticated as compound-lead');

    // Create swarm
    const swarmResponse = await this.apiPost('/swarms', {
      name: 'compound-swarm',
      description: `Compound loop with ${this.options.numWorkers} workers`,
      maxAgents: this.options.numWorkers,
    });
    this.swarmId = (swarmResponse as { id: string }).id;

    if (!this.swarmId) {
      throw new Error('Failed to create swarm');
    }

    this.log('ok', `Swarm created: ${this.swarmId}`);

    // Create mission with gates
    const gatesPayload = this.gates.map(g => ({
      gateType: g.gateType,
      name: g.name,
      isRequired: g.isRequired,
      config: g.config,
      sortOrder: g.sortOrder,
    }));

    const missionResponse = await this.apiPost('/missions', {
      swarmId: this.swarmId,
      name: 'Compound Quality Check',
      goal: this.options.objective,
      goalType: 'quality',
      maxIterations: this.options.maxIterations,
      gates: gatesPayload,
      quorumConfig: { autoApprove: true },
    });
    this.missionId = (missionResponse as { id: string }).id;

    if (!this.missionId) {
      throw new Error('Failed to create mission');
    }

    this.log('ok', `Mission created with ${this.gates.length} gates`);

    // Start mission
    await this.apiPost(`/missions/${this.missionId}/start`, {});
    this.log('ok', 'Mission started');
  }

  // ── Step 6: Spawn Workers ───────────────────────────────────────────────

  private spawnWorkers(): void {
    if (!this.layout) throw new Error('Layout not initialized');

    const roles: WorkerRole[] = ['fixer', 'verifier', 'verifier', 'verifier', 'verifier'];

    for (let i = 0; i < this.options.numWorkers; i++) {
      const handle = `scout-${i + 1}`;
      const role = roles[i] ?? 'verifier';
      const pane = this.layout.workerPanes[i];
      if (!pane) continue;

      const ctx = {
        handle,
        role,
        projectType: this.projectType,
        targetDir: this.options.targetDir,
        branch: this.fleetBranch,
        objective: this.options.objective,
        iteration: 1,
        serverUrl: this.options.serverUrl,
        swarmId: this.swarmId,
      };

      const prompt = role === 'fixer'
        ? buildFixerPrompt(ctx)
        : buildVerifierPrompt(ctx);

      this.spawnWorkerInPane(pane, handle, 1, prompt);
      this.log('ok', `Spawned ${handle} (${role})`);
    }
  }

  private spawnWorkerInPane(pane: string, handle: string, iteration: number, prompt: string): void {
    if (this.options.isLive) {
      // Write prompt, MCP config, and wrapper script to temp files
      const promptPath = this.writePromptFile(handle, iteration, prompt);
      const mcpConfigPath = this.writeMcpConfig(handle);
      const scriptPath = this.writeWorkerScript(handle, iteration, promptPath, mcpConfigPath);

      // The tmux command is now trivially simple — no escaping needed
      execSync(
        `tmux send-keys -t ${pane} ${this.shellQuote(`bash ${scriptPath}`)} Enter`,
        { encoding: 'utf-8' },
      );
    } else {
      // Simulated mode: write a script that echoes and marks complete
      const sentinelPath = join(this.promptDir, `${handle}-iter${iteration}.done`);
      const cmd = `echo '[${handle}] Simulated worker (use --live for real Claude Code)' && sleep 5 && echo '[${handle}] TASK COMPLETE' && touch ${this.shellQuote(sentinelPath)}`;
      execSync(
        `tmux send-keys -t ${pane} ${this.shellQuote(cmd)} Enter`,
        { encoding: 'utf-8' },
      );
    }
  }

  // ── Wrapper Script Files ───────────────────────────────────────────────

  /** Write the prompt content to a markdown file, returning its path. */
  private writePromptFile(handle: string, iteration: number, prompt: string): string {
    const filename = `${handle}-iter${iteration}.md`;
    const filepath = join(this.promptDir, filename);
    writeFileSync(filepath, prompt, 'utf-8');
    return filepath;
  }

  /** Write per-worker MCP config JSON with fleet server connection details. */
  private writeMcpConfig(handle: string): string {
    const filename = `${handle}-mcp.json`;
    const filepath = join(this.promptDir, filename);
    const config = {
      mcpServers: {
        'claude-fleet': {
          command: 'npx',
          args: ['-y', 'claude-fleet', 'mcp-server'],
          env: {
            CLAUDE_FLEET_URL: this.options.serverUrl,
            CLAUDE_CODE_AGENT_NAME: handle,
            CLAUDE_CODE_TEAM_NAME: 'compound-team',
            CLAUDE_CODE_SWARM_ID: this.swarmId,
            CLAUDE_CODE_MISSION_ID: this.missionId,
          },
        },
      },
    };
    writeFileSync(filepath, JSON.stringify(config, null, 2), 'utf-8');
    return filepath;
  }

  /** Write a wrapper shell script that pipes the prompt into Claude Code. */
  private writeWorkerScript(
    handle: string,
    iteration: number,
    promptPath: string,
    mcpConfigPath: string,
  ): string {
    const filename = `${handle}-iter${iteration}.sh`;
    const filepath = join(this.promptDir, filename);
    const sentinelPath = join(this.promptDir, `${handle}-iter${iteration}.done`);

    const script = [
      '#!/bin/bash',
      `export CLAUDE_CODE_AGENT_NAME=${this.shellQuote(handle)}`,
      'export CLAUDE_CODE_TEAM_NAME=compound-team',
      `export CLAUDE_CODE_SWARM_ID=${this.shellQuote(this.swarmId)}`,
      `export CLAUDE_CODE_MISSION_ID=${this.shellQuote(this.missionId)}`,
      `export CLAUDE_FLEET_URL=${this.shellQuote(this.options.serverUrl)}`,
      `cd ${this.shellQuote(this.options.targetDir)}`,
      `cat ${this.shellQuote(promptPath)} | \\`,
      `  claude -p --dangerously-skip-permissions \\`,
      `  --output-format stream-json \\`,
      `  --mcp-config ${this.shellQuote(mcpConfigPath)} \\`,
      `  --strict-mcp-config`,
      `touch ${this.shellQuote(sentinelPath)}`,
    ].join('\n');

    writeFileSync(filepath, script, 'utf-8');
    chmodSync(filepath, 0o755);
    return filepath;
  }

  // ── Step 7: Dashboard ───────────────────────────────────────────────────

  private startDashboard(): void {
    if (!this.layout) return;

    const scriptPath = `${this.projectDir}/scripts/demo-dashboard.sh`;
    if (!existsSync(scriptPath)) {
      this.log('warn', 'Dashboard script not found, skipping dashboard');
      return;
    }

    // Build worker info string: pane_id:handle:role
    const workerInfo = this.layout.workerPanes
      .map((pane, i) => `${pane}:scout-${i + 1}:${i === 0 ? 'fixer' : 'verifier'}`)
      .join(' ');

    const dashCmd = `bash ${this.shellQuote(scriptPath)} ${this.options.port} ${this.shellQuote(this.token)} ${this.shellQuote(this.missionId)} ${this.shellQuote(this.swarmId)} ${this.shellQuote(this.options.targetDir)} ${this.projectType} ${workerInfo}`;
    execSync(
      `tmux send-keys -t ${this.layout.dashboardPane} ${this.shellQuote(dashCmd)} Enter`,
      { encoding: 'utf-8' },
    );
  }

  // ── Step 8: Compound Loop ───────────────────────────────────────────────

  private async compoundLoop(): Promise<CompoundResult> {
    this.log('info', 'Entering compound iteration loop...');

    let lastGateResults: GateResultSummary[] = [];

    for (let iter = 1; iter <= this.options.maxIterations; iter++) {
      // Phase A: Wait for workers
      const timeout = iter === 1
        ? WORKER_TIMEOUT_FIRST_ITER_MS
        : WORKER_TIMEOUT_SUBSEQUENT_MS;

      this.log('info', `Iteration ${iter}/${this.options.maxIterations}: Waiting for ${this.options.numWorkers} workers...`);

      const allDone = await this.waitForWorkers(iter, timeout);
      if (!allDone) {
        this.log('warn', 'Not all workers completed within timeout');
      }

      // Phase A.5: Commit fixer changes
      this.commitFixerChanges(iter);

      // Phase B: Check server health before validation
      const isHealthy = await this.isServerHealthy();
      if (!isHealthy) {
        this.log('error', 'Fleet server is down — cannot run validation');
        this.printFailureBanner('failed');
        return {
          status: 'failed',
          iterations: iter,
          branch: this.fleetBranch,
          projectType: this.projectType,
          gateResults: lastGateResults,
        };
      }

      // Phase C: Trigger validation
      this.log('info', 'Triggering validation...');
      const validateResponse = await this.triggerValidation();
      await sleep(3000); // Let status settle

      // Phase C: Check mission status
      const missionStatus = await this.checkMissionStatus();

      if (missionStatus === 'succeeded') {
        this.printSuccessBanner();
        return {
          status: 'succeeded',
          iterations: iter,
          branch: this.fleetBranch,
          projectType: this.projectType,
          gateResults: lastGateResults,
        };
      }

      if (missionStatus === 'failed' || missionStatus === 'cancelled') {
        this.printFailureBanner(missionStatus);
        return {
          status: missionStatus === 'cancelled' ? 'cancelled' : 'failed',
          iterations: iter,
          branch: this.fleetBranch,
          projectType: this.projectType,
          gateResults: lastGateResults,
        };
      }

      // Phase D: Extract feedback
      const feedback = this.extractFeedbackFromValidation(validateResponse);
      lastGateResults = feedback.gates.map(g => ({
        name: g.name,
        status: g.errors.length > 0 ? 'failed' as const : 'error' as const,
        errorCount: g.errors.length,
      }));

      if (feedback.gates.length > 0) {
        this.log('warn', `Gates failed in iteration ${iter}:`);
        for (const gate of feedback.gates) {
          this.log('error', `  GATE FAILED: ${gate.name}`);
          for (const error of gate.errors.slice(0, 10)) {
            this.log('dim', `    ${error}`);
          }
          if (gate.errors.length > 10) {
            this.log('dim', `    ... and ${gate.errors.length - 10} more`);
          }
        }
      } else {
        // Gates passed but mission didn't transition — re-check
        await sleep(5000);
        const recheck = await this.checkMissionStatus();
        if (recheck === 'succeeded') {
          this.printSuccessBanner();
          return {
            status: 'succeeded',
            iterations: iter,
            branch: this.fleetBranch,
            projectType: this.projectType,
            gateResults: [],
          };
        }
      }

      // Phase E: Re-dispatch workers
      if (iter < this.options.maxIterations) {
        this.log('info', `Re-dispatching workers for iteration ${iter + 1}...`);
        this.redispatchWorkers(iter + 1, feedback);
      }
    }

    // Exhausted all iterations
    this.printFailureBanner('failed');
    return {
      status: 'failed',
      iterations: this.options.maxIterations,
      branch: this.fleetBranch,
      projectType: this.projectType,
      gateResults: lastGateResults,
    };
  }

  // ── Worker Polling ──────────────────────────────────────────────────────

  private async waitForWorkers(iteration: number, timeoutMs: number): Promise<boolean> {
    if (!this.layout) return false;

    const deadline = Date.now() + timeoutMs;
    const numWorkers = this.options.numWorkers;

    while (Date.now() < deadline) {
      // Check server health — abort early if server crashed
      const isServerUp = await this.isServerHealthy();
      if (!isServerUp) {
        this.log('error', 'Fleet server is down — aborting worker wait');
        return false;
      }

      let doneCount = 0;

      for (let i = 0; i < this.layout.workerPanes.length; i++) {
        const handle = `scout-${i + 1}`;
        const pane = this.layout.workerPanes[i];
        if (this.isWorkerDone(handle, pane, iteration)) {
          doneCount++;
        }
      }

      if (doneCount >= numWorkers) {
        this.log('ok', `All ${numWorkers} workers complete`);
        return true;
      }

      const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000);
      this.log('info', `Workers ${doneCount}/${numWorkers} complete (${elapsed}s)`);
      await sleep(POLL_INTERVAL_MS);
    }

    return false;
  }

  /**
   * Check if a worker has completed the current iteration.
   * First checks for a sentinel file (created by wrapper script on exit).
   * Falls back to checking tmux pane output for TASK COMPLETE markers.
   */
  private isWorkerDone(handle: string, pane: string, iteration: number): boolean {
    // Primary: check sentinel file (reliable — written by wrapper script)
    if (this.promptDir) {
      const sentinelPath = join(this.promptDir, `${handle}-iter${iteration}.done`);
      if (existsSync(sentinelPath)) {
        return true;
      }
    }

    // Fallback: check tmux pane output
    try {
      const output = execSync(
        `tmux capture-pane -t ${pane} -p -S -`,
        { encoding: 'utf-8', timeout: 5000 },
      );

      if (iteration <= 1) {
        return output.includes('TASK COMPLETE');
      }

      // Find text after the last RE-ENGAGED marker
      const reEngagedIndex = output.lastIndexOf('RE-ENGAGED');
      if (reEngagedIndex === -1) {
        return output.includes('TASK COMPLETE');
      }

      const afterMarker = output.slice(reEngagedIndex);
      return afterMarker.includes('TASK COMPLETE');
    } catch {
      return false;
    }
  }

  /** Check if the fleet server is still responding. */
  private async isServerHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.options.serverUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  // ── Git Operations ──────────────────────────────────────────────────────

  private commitFixerChanges(iteration: number): void {
    try {
      const porcelain = execSync('git status --porcelain', {
        cwd: this.options.targetDir,
        encoding: 'utf-8',
      }).trim();

      if (porcelain.length > 0) {
        this.log('info', 'Committing fixer changes...');
        execSync(`git add -A && git commit -m "fleet: iteration ${iteration} fixes"`, {
          cwd: this.options.targetDir,
          encoding: 'utf-8',
        });
      }
    } catch {
      // Commit may fail if nothing to commit
    }
  }

  // ── Validation ──────────────────────────────────────────────────────────

  private async triggerValidation(): Promise<unknown[]> {
    try {
      const result = await this.apiPost(`/missions/${this.missionId}/validate`, {});
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  private async checkMissionStatus(): Promise<string> {
    try {
      const result = await this.apiGet(`/missions/${this.missionId}`);
      return (result as { status: string }).status ?? 'active';
    } catch {
      return 'active';
    }
  }

  private extractFeedbackFromValidation(results: unknown[]): StructuredFeedback {
    // Parse the validation response into named results
    const namedResults: Array<{ name: string; status: string; output: string }> = [];

    // Fetch gate definitions for name mapping
    let gateNameMap: Map<string, string>;
    try {
      const gatesResponse = this.apiGetSync(`/missions/${this.missionId}/gates`);
      const gates = Array.isArray(gatesResponse) ? gatesResponse : [];
      gateNameMap = new Map(
        gates.map((g: { id: string; name: string }) => [g.id, g.name]),
      );
    } catch {
      gateNameMap = new Map();
    }

    for (const result of results) {
      const r = result as { gateId?: string; status?: string; output?: string };
      if (r.status === 'failed') {
        namedResults.push({
          name: gateNameMap.get(r.gateId ?? '') ?? (r.gateId ?? 'unknown').slice(0, 8),
          status: r.status,
          output: r.output ?? '',
        });
      }
    }

    return extractFeedbackFromNamedResults(namedResults, this.projectType);
  }

  // ── Re-dispatch ─────────────────────────────────────────────────────────

  private redispatchWorkers(nextIteration: number, feedback: StructuredFeedback): void {
    if (!this.layout) return;

    const roles: WorkerRole[] = ['fixer', 'verifier', 'verifier', 'verifier', 'verifier'];

    for (let i = 0; i < this.options.numWorkers; i++) {
      const handle = `scout-${i + 1}`;
      const role = roles[i] ?? 'verifier';
      const pane = this.layout.workerPanes[i];
      if (!pane) continue;

      const ctx = {
        handle,
        role,
        projectType: this.projectType,
        targetDir: this.options.targetDir,
        branch: this.fleetBranch,
        objective: this.options.objective,
        iteration: nextIteration,
        feedback,
        serverUrl: this.options.serverUrl,
        swarmId: this.swarmId,
      };

      const prompt = buildRedispatchPrompt(ctx, feedback);

      if (this.options.isLive) {
        // Write new prompt/script files for this iteration
        const promptPath = this.writePromptFile(handle, nextIteration, prompt);
        const mcpConfigPath = this.writeMcpConfig(handle);
        const scriptPath = this.writeWorkerScript(handle, nextIteration, promptPath, mcpConfigPath);

        // Echo the re-engaged marker then run the wrapper script
        const cmd = `echo '=== ITERATION ${nextIteration}: RE-ENGAGED ===' && bash ${this.shellQuote(scriptPath)}`;
        execSync(
          `tmux send-keys -t ${pane} ${this.shellQuote(cmd)} Enter`,
          { encoding: 'utf-8' },
        );
      } else {
        const sentinelPath = join(this.promptDir, `${handle}-iter${nextIteration}.done`);
        const cmd = `echo '=== ITERATION ${nextIteration}: RE-ENGAGED ===' && echo '[${handle}] Re-engaged (simulated)' && sleep 3 && echo '[${handle}] TASK COMPLETE' && touch ${this.shellQuote(sentinelPath)}`;
        execSync(
          `tmux send-keys -t ${pane} ${this.shellQuote(cmd)} Enter`,
          { encoding: 'utf-8' },
        );
      }

      this.log('ok', `Re-dispatched ${handle} (${role})`);
    }
  }

  // ── API Helpers ─────────────────────────────────────────────────────────

  private async apiPost(path: string, body: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.options.serverUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API POST ${path} failed: ${response.status} ${text}`);
    }

    return response.json();
  }

  private async apiGet(path: string): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.options.serverUrl}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`API GET ${path} failed: ${response.status}`);
    }

    return response.json();
  }

  /** Synchronous API GET using execSync + curl. Used for feedback extraction. */
  private apiGetSync(path: string): unknown {
    const authHeader = this.token ? `-H "Authorization: Bearer ${this.token}"` : '';
    const result = execSync(
      `curl -sf ${authHeader} "${this.options.serverUrl}${path}"`,
      { encoding: 'utf-8', timeout: 10_000 },
    );
    return JSON.parse(result);
  }

  // ── Output Formatting ──────────────────────────────────────────────────

  private printSuccessBanner(): void {
    console.log('');
    console.log(`${GREEN}${BOLD}+-------------------------------------------+${RESET}`);
    console.log(`${GREEN}${BOLD}|   MISSION SUCCEEDED                       |${RESET}`);
    console.log(`${GREEN}${BOLD}|   All quality gates passed!                |${RESET}`);
    console.log(`${GREEN}${BOLD}+-------------------------------------------+${RESET}`);
    console.log(`${DIM}  Fleet work on branch: ${this.fleetBranch}${RESET}`);
  }

  private printFailureBanner(reason: string): void {
    console.log('');
    console.log(`${RED}${BOLD}+-------------------------------------------+${RESET}`);
    console.log(`${RED}${BOLD}|   MISSION ${reason.toUpperCase().padEnd(31)}|${RESET}`);
    console.log(`${RED}${BOLD}|   Check fleet branch for partial progress  |${RESET}`);
    console.log(`${RED}${BOLD}+-------------------------------------------+${RESET}`);
    console.log(`${DIM}  Fleet work on branch: ${this.fleetBranch}${RESET}`);
  }

  private log(level: string, message: string): void {
    const prefix = `${CYAN}[compound]${RESET}`;
    switch (level) {
      case 'ok':
        console.log(`${prefix} ${GREEN}${message}${RESET}`);
        break;
      case 'warn':
        console.log(`${prefix} ${YELLOW}${message}${RESET}`);
        break;
      case 'error':
        console.log(`${prefix} ${RED}${message}${RESET}`);
        break;
      case 'dim':
        console.log(`${prefix} ${DIM}${message}${RESET}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  // ── Shell Quoting ──────────────────────────────────────────────────────

  /**
   * POSIX-safe single-quote wrapping.
   * Wraps the string in single quotes, escaping any internal single quotes
   * using the '\'' pattern (end quote, escaped quote, start quote).
   */
  private shellQuote(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  /** Remove temp prompt/script directory. Idempotent — safe to call multiple times. */
  private cleanup(): void {
    if (this.promptDir && existsSync(this.promptDir)) {
      try {
        rmSync(this.promptDir, { recursive: true, force: true });
        this.log('dim', 'Cleaned up temp files');
      } catch {
        this.log('warn', `Could not clean temp dir: ${this.promptDir}`);
      }
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
