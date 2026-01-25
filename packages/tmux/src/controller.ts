/**
 * Tmux Controller
 *
 * Provides programmatic control over tmux panes for terminal automation.
 * Handles common LLM mistakes: auto-Enter, delays, proper escaping.
 */

import { spawn, execSync, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  TmuxPane,
  TmuxWindow,
  TmuxSession,
  CreatePaneOptions,
  SendKeysOptions,
  CaptureOptions,
  ExecuteResult,
  WaitOptions,
} from './types.js';

export class TmuxController {
  private defaultDelay = 100; // ms between text and Enter

  /**
   * Check if we're running inside tmux
   */
  isInsideTmux(): boolean {
    return !!process.env.TMUX;
  }

  /**
   * Check if tmux is installed
   */
  isTmuxInstalled(): boolean {
    try {
      execSync('which tmux', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run a tmux command and return output
   */
  private runTmux(args: string[]): string {
    try {
      const result = execSync(['tmux', ...args].join(' '), {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim();
    } catch (error) {
      const err = error as { stderr?: Buffer; message: string };
      throw new Error(`tmux command failed: ${err.stderr?.toString() || err.message}`);
    }
  }

  /**
   * Run tmux command async
   */
  private async runTmuxAsync(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('tmux', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data; });
      child.stderr?.on('data', (data) => { stderr += data; });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`tmux failed: ${stderr || `exit code ${code}`}`));
        }
      });
    });
  }

  // ============ Session Management ============

  /**
   * Get current session name
   */
  getCurrentSession(): string | undefined {
    if (!this.isInsideTmux()) return undefined;
    try {
      return this.runTmux(['display-message', '-p', '#{session_name}']);
    } catch {
      return undefined;
    }
  }

  /**
   * Get current window index
   */
  getCurrentWindow(): string | undefined {
    if (!this.isInsideTmux()) return undefined;
    try {
      return this.runTmux(['display-message', '-p', '#{window_index}']);
    } catch {
      return undefined;
    }
  }

  /**
   * Get current pane ID
   */
  getCurrentPane(): string | undefined {
    if (!this.isInsideTmux()) return undefined;
    try {
      return this.runTmux(['display-message', '-p', '#{pane_id}']);
    } catch {
      return undefined;
    }
  }

  /**
   * List all sessions
   */
  listSessions(): TmuxSession[] {
    try {
      const output = this.runTmux([
        'list-sessions',
        '-F',
        '#{session_id}|#{session_name}|#{session_created}|#{session_attached}|#{session_windows}',
      ]);

      return output.split('\n').filter(Boolean).map((line) => {
        const [id, name, created, attached, windows] = line.split('|');
        return {
          id,
          name,
          created: parseInt(created, 10) * 1000,
          attached: attached === '1',
          windowCount: parseInt(windows, 10),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * List windows in current or specified session
   */
  listWindows(session?: string): TmuxWindow[] {
    try {
      const target = session ? ['-t', session] : [];
      const output = this.runTmux([
        'list-windows',
        ...target,
        '-F',
        '#{window_id}|#{window_index}|#{window_name}|#{window_active}|#{window_panes}',
      ]);

      return output.split('\n').filter(Boolean).map((line) => {
        const [id, index, name, active, panes] = line.split('|');
        return {
          id,
          index: parseInt(index, 10),
          name,
          active: active === '1',
          paneCount: parseInt(panes, 10),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * List panes in current or specified window
   */
  listPanes(target?: string): TmuxPane[] {
    try {
      const targetArgs = target ? ['-t', target] : [];
      const output = this.runTmux([
        'list-panes',
        ...targetArgs,
        '-F',
        '#{pane_id}|#{pane_index}|#{pane_title}|#{pane_active}|#{pane_width}|#{pane_height}|#{pane_current_command}|#{pane_pid}',
      ]);

      return output.split('\n').filter(Boolean).map((line) => {
        const [id, index, title, active, width, height, command, pid] = line.split('|');
        return {
          id,
          index: parseInt(index, 10),
          title,
          active: active === '1',
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          command,
          pid: parseInt(pid, 10),
        };
      });
    } catch {
      return [];
    }
  }

  // ============ Pane Operations ============

  /**
   * Create a new pane by splitting
   */
  createPane(options: CreatePaneOptions = {}): TmuxPane | undefined {
    const {
      direction = 'vertical',
      target,
      command,
      cwd,
      size,
    } = options;

    const args = ['split-window'];

    // Direction
    if (direction === 'horizontal') {
      args.push('-h');
    } else {
      args.push('-v');
    }

    // Target
    if (target) {
      args.push('-t', this.resolveTarget(target));
    }

    // Working directory
    if (cwd) {
      args.push('-c', cwd);
    }

    // Size
    if (size !== undefined) {
      const sizeStr = typeof size === 'number' ? `${size}` : size;
      // Try -l first (tmux 3.4+), fall back to -p for percentage
      if (sizeStr.endsWith('%')) {
        args.push('-p', sizeStr.replace('%', ''));
      } else {
        args.push('-l', sizeStr);
      }
    }

    // Print pane ID
    args.push('-P', '-F', '#{pane_id}');

    // Command
    if (command) {
      args.push(command);
    }

    try {
      const paneId = this.runTmux(args);
      // Get full pane info
      const panes = this.listPanes();
      return panes.find((p) => p.id === paneId);
    } catch {
      return undefined;
    }
  }

  /**
   * Create a new window
   */
  createWindow(options: { name?: string; command?: string; cwd?: string } = {}): TmuxWindow | undefined {
    const { name, command, cwd } = options;

    const args = ['new-window', '-P', '-F', '#{window_id}'];

    if (name) {
      args.push('-n', name);
    }

    if (cwd) {
      args.push('-c', cwd);
    }

    if (command) {
      args.push(command);
    }

    try {
      const windowId = this.runTmux(args);
      const windows = this.listWindows();
      return windows.find((w) => w.id === windowId);
    } catch {
      return undefined;
    }
  }

  /**
   * Kill a pane
   */
  killPane(target: string): boolean {
    const resolved = this.resolveTarget(target);
    const currentPane = this.getCurrentPane();

    // Safety: don't kill current pane
    if (resolved === currentPane) {
      throw new Error('Cannot kill current pane');
    }

    try {
      this.runTmux(['kill-pane', '-t', resolved]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill a window
   */
  killWindow(target: string): boolean {
    try {
      this.runTmux(['kill-window', '-t', target]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill an entire session
   */
  killSession(session: string): boolean {
    try {
      this.runTmux(['kill-session', '-t', session]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new session (for remote mode)
   */
  createSession(options: { name: string; command?: string; cwd?: string; detached?: boolean } = { name: 'cct' }): string | undefined {
    const { name, command, cwd, detached = true } = options;

    const args = ['new-session', '-P', '-F', '#{session_id}'];

    if (detached) {
      args.push('-d');
    }

    args.push('-s', name);

    if (cwd) {
      args.push('-c', cwd);
    }

    if (command) {
      args.push(command);
    }

    try {
      return this.runTmux(args);
    } catch {
      return undefined;
    }
  }

  /**
   * Attach to a session (prints command for user to run)
   * Note: This can't actually attach - it returns the command to run
   */
  getAttachCommand(session?: string): string {
    const target = session || this.getCurrentSession() || 'cct';
    return `tmux attach-session -t ${target}`;
  }

  /**
   * Check if a session exists
   */
  sessionExists(name: string): boolean {
    try {
      this.runTmux(['has-session', '-t', name]);
      return true;
    } catch {
      return false;
    }
  }

  // ============ Input/Output ============

  /**
   * Send keys to a pane
   */
  async sendKeys(
    target: string,
    text: string,
    options: SendKeysOptions = {}
  ): Promise<void> {
    const { delay = this.defaultDelay, noEnter = false, literal = false, instant = false } = options;
    const resolved = this.resolveTarget(target);

    const args = ['send-keys', '-t', resolved];

    if (literal) {
      args.push('-l');
    }

    args.push(text);

    this.runTmux(args);

    // Add delay before Enter to prevent race conditions
    // Unless instant mode is enabled (--delay-enter=False equivalent)
    if (!noEnter) {
      if (!instant && delay > 0) {
        await this.sleep(delay);
      }
      this.runTmux(['send-keys', '-t', resolved, 'Enter']);
    }
  }

  /**
   * Send interrupt (Ctrl+C)
   */
  sendInterrupt(target: string): void {
    const resolved = this.resolveTarget(target);
    this.runTmux(['send-keys', '-t', resolved, 'C-c']);
  }

  /**
   * Send escape key
   */
  sendEscape(target: string): void {
    const resolved = this.resolveTarget(target);
    this.runTmux(['send-keys', '-t', resolved, 'Escape']);
  }

  /**
   * Capture pane output
   */
  capture(target: string, options: CaptureOptions = {}): string {
    const { lines, start, end, trim = true } = options;
    const resolved = this.resolveTarget(target);

    const args = ['capture-pane', '-t', resolved, '-p'];

    if (start !== undefined) {
      args.push('-S', String(start));
    }

    if (end !== undefined) {
      args.push('-E', String(end));
    }

    let output = this.runTmux(args);

    if (lines !== undefined && lines > 0) {
      const allLines = output.split('\n');
      output = allLines.slice(-lines).join('\n');
    }

    if (trim) {
      output = output.trimEnd();
    }

    return output;
  }

  // ============ Execution ============

  /**
   * Execute a command and capture output with exit code
   */
  async execute(
    target: string,
    command: string,
    options: WaitOptions = {}
  ): Promise<ExecuteResult> {
    const { timeout = 30000, interval = 100 } = options;
    const resolved = this.resolveTarget(target);

    // Generate unique markers
    const marker = this.generateMarker();
    const startMarker = `__CCT_START_${marker}__`;
    const endMarker = `__CCT_END_${marker}__`;

    // Wrap command with markers
    const wrappedCommand = `echo '${startMarker}'; ${command}; echo '${endMarker}'$?`;

    const startTime = Date.now();

    // Send the command
    await this.sendKeys(resolved, wrappedCommand);

    // Poll for completion
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await this.sleep(interval);

      const captured = this.capture(resolved, { lines: 500 });

      // Look for markers
      const startIdx = captured.indexOf(startMarker);
      const endMatch = captured.match(new RegExp(`${endMarker}(\\d+)`));

      if (startIdx !== -1 && endMatch) {
        const endIdx = captured.indexOf(endMatch[0]);
        const output = captured
          .slice(startIdx + startMarker.length, endIdx)
          .trim();

        return {
          output,
          exitCode: parseInt(endMatch[1], 10),
          completed: true,
          duration: Date.now() - startTime,
        };
      }
    }

    // Timeout
    return {
      output: this.capture(resolved, { lines: 100 }),
      exitCode: -1,
      completed: false,
      duration: Date.now() - startTime,
    };
  }

  // ============ Wait Operations ============

  /**
   * Wait for a pattern to appear in pane output
   */
  async waitForPattern(
    target: string,
    pattern: string | RegExp,
    options: WaitOptions = {}
  ): Promise<boolean> {
    const { timeout = 30000, interval = 100 } = options;
    const resolved = this.resolveTarget(target);
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const captured = this.capture(resolved);
      if (regex.test(captured)) {
        return true;
      }
      await this.sleep(interval);
    }

    return false;
  }

  /**
   * Wait for pane output to stop changing (idle detection)
   */
  async waitForIdle(
    target: string,
    options: WaitOptions & { stableTime?: number } = {}
  ): Promise<boolean> {
    const { timeout = 30000, interval = 200, stableTime = 1000 } = options;
    const resolved = this.resolveTarget(target);
    const deadline = Date.now() + timeout;

    let lastHash = '';
    let stableSince = 0;

    while (Date.now() < deadline) {
      const captured = this.capture(resolved);
      const currentHash = this.hash(captured);

      if (currentHash === lastHash) {
        if (stableSince === 0) {
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableTime) {
          return true;
        }
      } else {
        lastHash = currentHash;
        stableSince = 0;
      }

      await this.sleep(interval);
    }

    return false;
  }

  // ============ Pane Control ============

  /**
   * Focus on a pane
   */
  focusPane(target: string): void {
    const resolved = this.resolveTarget(target);
    this.runTmux(['select-pane', '-t', resolved]);
  }

  /**
   * Resize a pane
   */
  resizePane(
    target: string,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number = 5
  ): void {
    const resolved = this.resolveTarget(target);
    const dirFlag = {
      up: '-U',
      down: '-D',
      left: '-L',
      right: '-R',
    }[direction];

    this.runTmux(['resize-pane', '-t', resolved, dirFlag, String(amount)]);
  }

  /**
   * Set pane title
   */
  setPaneTitle(target: string, title: string): void {
    const resolved = this.resolveTarget(target);
    this.runTmux(['select-pane', '-t', resolved, '-T', title]);
  }

  // ============ Utilities ============

  /**
   * Resolve various target formats to tmux pane ID
   * Supports: pane ID (%0), index (0), full path (session:window.pane)
   */
  private resolveTarget(target: string): string {
    // Already a pane ID
    if (target.startsWith('%')) {
      return target;
    }

    // Full path notation
    if (target.includes(':') || target.includes('.')) {
      return target;
    }

    // Numeric index - find the pane
    const index = parseInt(target, 10);
    if (!isNaN(index)) {
      const panes = this.listPanes();
      const pane = panes.find((p) => p.index === index);
      if (pane) {
        return pane.id;
      }
    }

    // Return as-is
    return target;
  }

  private generateMarker(): string {
    return `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private hash(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
