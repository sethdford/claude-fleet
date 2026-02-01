/**
 * Tmux Controller
 *
 * Provides programmatic control over tmux panes for terminal automation.
 * Handles common LLM mistakes: auto-Enter, delays, proper escaping.
 */

import { execSync, spawnSync } from 'node:child_process';
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
  WaitIdleResult,
  CaptureProgressiveOptions,
} from './types.js';

export class TmuxController {
  // Default delay between text and Enter (1.5s for reliability, per claude-code-tools)
  private defaultDelay = 1500;

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
      // Use spawnSync with array args to avoid shell interpretation of special chars like |
      const result = spawnSync('tmux', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.status !== 0) {
        throw new Error(result.stderr || 'tmux command failed');
      }
      return (result.stdout || '').trim();
    } catch (error) {
      const err = error as { stderr?: string; message: string };
      throw new Error(`tmux command failed: ${err.stderr || err.message}`);
    }
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
   * Get the active pane ID (works even when not inside tmux)
   * Queries tmux directly to find the currently active pane in the active window
   */
  getActivePaneId(): string | undefined {
    try {
      // Get the active pane from ALL windows, preferring the first window
      // This ensures we target the main window where the user is working
      const output = this.runTmux([
        'list-panes', '-a', '-F', '#{pane_id}|#{pane_active}|#{window_index}'
      ]);
      // Sort by window_index to prefer earlier windows
      const panes = output.split('\n')
        .filter(Boolean)
        .map(line => {
          const [paneId, active, windowIndex] = line.split('|');
          return { paneId, active: active === '1', windowIndex: parseInt(windowIndex ?? '0', 10) };
        })
        .sort((a, b) => a.windowIndex - b.windowIndex);

      // Find the first active pane in the lowest-indexed window
      for (const pane of panes) {
        if (pane.active && pane.paneId) {
          return pane.paneId;
        }
      }
      // Fallback: return the first pane
      return panes[0]?.paneId;
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
        const parts = line.split('|');
        return {
          id: parts[0] ?? '',
          name: parts[1] ?? '',
          created: parseInt(parts[2] ?? '0', 10) * 1000,
          attached: parts[3] === '1',
          windowCount: parseInt(parts[4] ?? '0', 10),
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
        const parts = line.split('|');
        return {
          id: parts[0] ?? '',
          index: parseInt(parts[1] ?? '0', 10),
          name: parts[2] ?? '',
          active: parts[3] === '1',
          paneCount: parseInt(parts[4] ?? '0', 10),
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
        const parts = line.split('|');
        return {
          id: parts[0] ?? '',
          index: parseInt(parts[1] ?? '0', 10),
          title: parts[2] ?? '',
          active: parts[3] === '1',
          width: parseInt(parts[4] ?? '0', 10),
          height: parseInt(parts[5] ?? '0', 10),
          command: parts[6] ?? '',
          pid: parseInt(parts[7] ?? '0', 10),
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
   * Supports creating in a specific session (for remote mode)
   */
  createWindow(options: { session?: string; name?: string; command?: string; cwd?: string } = {}): string | undefined {
    const { session, name, command, cwd } = options;

    const args = ['new-window', '-P', '-F', '#{window_id}'];

    // Target a specific session (important for remote/detached mode)
    if (session) {
      args.push('-t', session);
    }

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
      return this.runTmux(args);
    } catch {
      return undefined;
    }
  }

  /**
   * Kill a pane
   *
   * Safety (learned from claude-code-tools):
   * - Never kill the current pane (would terminate session)
   * - Never kill the active pane (even when running outside tmux)
   */
  killPane(target: string): boolean {
    const resolved = this.resolveTarget(target);

    // Safety check 1: don't kill current pane (when inside tmux)
    const currentPane = this.getCurrentPane();
    if (currentPane && resolved === currentPane) {
      throw new Error('Cannot kill current pane');
    }

    // Safety check 2: don't kill active pane (works even outside tmux)
    const activePane = this.getActivePaneId();
    if (activePane && resolved === activePane) {
      throw new Error('Cannot kill active pane');
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
   * Send keys to a pane with optional Enter key verification
   *
   * Pattern from claude-code-tools:
   * - Delay between text and Enter prevents race conditions
   * - Verify Enter was received by checking if content changed
   * - Retry with exponential backoff if verification fails
   */
  async sendKeys(
    target: string,
    text: string,
    options: SendKeysOptions = {}
  ): Promise<void> {
    const {
      delay = this.defaultDelay,
      noEnter = false,
      literal = false,
      instant = false,
      verifyEnter = true,
      maxRetries = 3,
    } = options;
    const resolved = this.resolveTarget(target);

    const args = ['send-keys', '-t', resolved];

    if (literal) {
      args.push('-l');
    }

    args.push(text);

    // Send the text (without Enter)
    this.runTmux(args);

    if (noEnter) {
      return;
    }

    // Apply delay before Enter to prevent race conditions
    // Unless instant mode is enabled
    if (!instant && delay > 0) {
      await this.sleep(delay);
    }

    // Capture pane state BEFORE sending Enter (for verification)
    const contentBeforeEnter = verifyEnter ? this.capture(resolved, { lines: 20 }) : null;

    // Send Enter with verification and retry logic
    await this.sendEnterWithRetry(resolved, contentBeforeEnter, verifyEnter, maxRetries);
  }

  /**
   * Send Enter key with optional verification and retry
   *
   * Verifies that Enter was received by checking if pane content changed
   * (indicating command was submitted). Retries if content hasn't changed.
   */
  private async sendEnterWithRetry(
    target: string,
    contentBeforeEnter: string | null,
    verify: boolean,
    maxRetries: number
  ): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Send Enter
      this.runTmux(['send-keys', '-t', target, 'Enter']);

      if (!verify || contentBeforeEnter === null) {
        return; // No verification needed
      }

      // Wait a bit for the command to process
      await this.sleep(300);

      // Check if pane content changed (indicating Enter was received)
      const contentAfter = this.capture(target, { lines: 20 });

      if (contentAfter !== contentBeforeEnter) {
        // Content changed - Enter was successful
        return;
      }

      // Content unchanged - Enter may not have been received
      if (attempt < maxRetries - 1) {
        // Wait before retry (exponential backoff: 300ms, 600ms, 1200ms, ...)
        await this.sleep(300 * Math.pow(2, attempt));
      }
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
   * Clear the pane screen (Ctrl+L)
   */
  clearPane(target: string): void {
    const resolved = this.resolveTarget(target);
    this.runTmux(['send-keys', '-t', resolved, 'C-l']);
  }

  /**
   * Format pane ID to session:window.pane format
   *
   * Pattern from claude-code-tools: Provides human-readable pane identifiers
   */
  formatPaneId(paneId: string): string {
    try {
      const session = this.runTmux(['display-message', '-t', paneId, '-p', '#{session_name}']);
      const windowIndex = this.runTmux(['display-message', '-t', paneId, '-p', '#{window_index}']);
      const paneIndex = this.runTmux(['display-message', '-t', paneId, '-p', '#{pane_index}']);

      if (session && windowIndex && paneIndex) {
        return `${session}:${windowIndex}.${paneIndex}`;
      }
      return paneId;
    } catch {
      return paneId;
    }
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

  // Progressive expansion levels for capture (pattern from claude-code-tools)
  // Start small, expand if end marker found but start marker scrolled off
  private static EXPANSION_LEVELS: (number | undefined)[] = [100, 500, 2000, undefined];

  /**
   * Execute a command and capture output with exit code
   *
   * Pattern from claude-code-tools:
   * - Uses unique markers with PID + nanoseconds for concurrency safety
   * - Progressive expansion: tries small capture first, expands if needed
   * - Distinguishes echoed markers from typed command text
   */
  async execute(
    target: string,
    command: string,
    options: WaitOptions = {}
  ): Promise<ExecuteResult> {
    const { timeout = 30000, interval = 500 } = options;
    const resolved = this.resolveTarget(target);

    // Generate unique markers (PID + nanoseconds for uniqueness)
    const marker = this.generateMarker();
    const startMarker = `__CCT_START_${marker}__`;
    const endMarker = `__CCT_END_${marker}__`;

    // Wrap command with markers (captures both stdout and stderr)
    const wrappedCommand = `echo ${startMarker}; { ${command}; } 2>&1; echo ${endMarker}:$?`;

    const startTime = Date.now();

    // Send the command (with Enter verification for reliability)
    await this.sendKeys(resolved, wrappedCommand);

    // Poll for completion with progressive expansion
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await this.sleep(interval);

      // Try progressive expansion to find both markers
      for (const lines of TmuxController.EXPANSION_LEVELS) {
        const captured = this.capture(resolved, { lines });
        const result = this.parseMarkedOutput(captured, startMarker, endMarker);

        if (result.hasEnd) {
          if (result.hasStart) {
            // Both markers found - return result
            return {
              output: result.output,
              exitCode: result.exitCode,
              completed: true,
              duration: Date.now() - startTime,
            };
          }
          // End found but start missing - try more lines
          continue;
        } else {
          // End marker not found yet - command still running
          break;
        }
      }
    }

    // Timeout - capture with full expansion and return what we have
    let captured = '';
    for (const lines of TmuxController.EXPANSION_LEVELS) {
      captured = this.capture(resolved, { lines });
      if (captured.includes(startMarker) || lines === undefined) {
        break;
      }
    }

    const result = this.parseMarkedOutput(captured, startMarker, endMarker);
    return {
      output: result.output,
      exitCode: result.exitCode,
      completed: result.hasStart && result.hasEnd,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Parse marked output to extract command output and exit code
   *
   * Pattern from claude-code-tools:
   * - Look for ECHOED marker (after newline) not the typed command
   * - Distinguish __END__:$? (typed) from __END__:0 (echoed)
   */
  private parseMarkedOutput(
    captured: string,
    startMarker: string,
    endMarker: string
  ): { output: string; exitCode: number; hasStart: boolean; hasEnd: boolean } {
    const hasStart = captured.includes(startMarker);
    const hasEnd = captured.includes(`${endMarker}:`);

    if (!hasStart || !hasEnd) {
      return { output: captured, exitCode: -1, hasStart, hasEnd };
    }

    // Find the ECHOED start marker (on its own line, not in the typed command)
    const newlineStartMarker = '\n' + startMarker;
    let startIdx = captured.indexOf(newlineStartMarker);
    if (startIdx !== -1) {
      startIdx += 1; // Skip the newline
    } else if (captured.startsWith(startMarker)) {
      startIdx = 0;
    } else {
      startIdx = captured.indexOf(startMarker);
    }

    // Find the ECHOED end marker with numeric exit code (e.g., "__END__:0")
    const endPattern = new RegExp(endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)');
    const endMatch = captured.match(endPattern);

    if (startIdx === -1 || !endMatch) {
      return { output: captured, exitCode: -1, hasStart, hasEnd };
    }

    const endIdx = captured.indexOf(endMatch[0]);
    const exitCode = parseInt(endMatch[1] ?? '-1', 10);

    // Extract output between markers
    let outputStart = startIdx + startMarker.length;
    if (outputStart < captured.length && captured[outputStart] === '\n') {
      outputStart += 1;
    }

    const output = captured.slice(outputStart, endIdx).replace(/\n+$/, '');

    return { output, exitCode, hasStart, hasEnd };
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
   *
   * Returns a WaitIdleResult with the idle state, final captured content,
   * and duration spent waiting.
   */
  async waitForIdle(
    target: string,
    options: WaitOptions & { stableTime?: number } = {}
  ): Promise<WaitIdleResult> {
    const { timeout = 30000, interval = 200, stableTime = 1000 } = options;
    const resolved = this.resolveTarget(target);
    const startTime = Date.now();
    const deadline = startTime + timeout;

    let lastHash = '';
    let stableSince = 0;
    let lastContent = '';

    while (Date.now() < deadline) {
      lastContent = this.capture(resolved);
      const currentHash = this.hash(lastContent);

      if (currentHash === lastHash) {
        if (stableSince === 0) {
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableTime) {
          return { idle: true, content: lastContent, duration: Date.now() - startTime };
        }
      } else {
        lastHash = currentHash;
        stableSince = 0;
      }

      await this.sleep(interval);
    }

    return { idle: false, content: lastContent, duration: Date.now() - startTime };
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

  // ============ Progressive Capture ============

  /**
   * Capture pane content with progressive buffer expansion.
   *
   * Starts with a small capture and expands if the optional search string
   * isn't found. Useful for finding output that may have scrolled off the
   * visible buffer.
   *
   * If no searchString is provided, returns the first (smallest) capture.
   * If searchString is provided, returns the smallest capture that contains it,
   * or the largest capture if it's never found (within timeout).
   */
  async captureProgressive(options: CaptureProgressiveOptions): Promise<{ content: string; found: boolean; lines: number | undefined }> {
    const { target, searchString, timeout = 30000, interval = 500 } = options;
    const resolved = this.resolveTarget(target);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      for (const lines of TmuxController.EXPANSION_LEVELS) {
        const content = this.capture(resolved, { lines });

        if (!searchString) {
          // No search needed — return smallest capture
          return { content, found: true, lines };
        }

        if (content.includes(searchString)) {
          return { content, found: true, lines };
        }
      }

      // Search string not found at any expansion level — wait and retry
      if (searchString && Date.now() < deadline) {
        await this.sleep(interval);
      } else {
        break;
      }
    }

    // Final attempt with full capture
    const content = this.capture(resolved, { lines: undefined });
    const found = searchString ? content.includes(searchString) : true;
    return { content, found, lines: undefined };
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
