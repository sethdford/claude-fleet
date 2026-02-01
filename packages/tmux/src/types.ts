/**
 * Tmux Types
 */

export interface TmuxPane {
  id: string;           // e.g., %0, %1
  index: number;        // 0, 1, 2...
  title: string;
  active: boolean;
  width: number;
  height: number;
  command: string;      // Current running command
  pid: number;
}

export interface TmuxWindow {
  id: string;           // e.g., @0, @1
  index: number;
  name: string;
  active: boolean;
  paneCount: number;
}

export interface TmuxSession {
  id: string;           // e.g., $0, $1
  name: string;
  created: number;
  attached: boolean;
  windowCount: number;
}

export interface CreatePaneOptions {
  /** Split direction: 'horizontal' or 'vertical' */
  direction?: 'horizontal' | 'vertical';
  /** Target pane to split from */
  target?: string;
  /** Initial command to run */
  command?: string;
  /** Working directory */
  cwd?: string;
  /** Size in lines/columns or percentage */
  size?: number | string;
}

export interface SendKeysOptions {
  /** Delay in ms before sending Enter (default: 1500ms for reliability) */
  delay?: number;
  /** Don't send Enter after text */
  noEnter?: boolean;
  /** Literal mode - don't interpret special keys */
  literal?: boolean;
  /** Send immediately without any delay (overrides delay) */
  instant?: boolean;
  /** Verify Enter was received by checking if pane content changed */
  verifyEnter?: boolean;
  /** Maximum number of Enter key retries (default: 3) */
  maxRetries?: number;
}

export interface CaptureOptions {
  /** Number of lines to capture (default: all). Use undefined for all lines. */
  lines?: number | undefined;
  /** Start line (negative for scrollback) */
  start?: number;
  /** End line */
  end?: number;
  /** Strip trailing whitespace */
  trim?: boolean;
}

export interface ExecuteResult {
  /** Command output */
  output: string;
  /** Exit code */
  exitCode: number;
  /** Whether execution completed */
  completed: boolean;
  /** Time taken in ms */
  duration: number;
}

export interface WaitOptions {
  /** Timeout in ms */
  timeout?: number;
  /** Poll interval in ms */
  interval?: number;
}

export interface WaitIdleResult {
  /** Whether the pane reached a stable/idle state */
  idle: boolean;
  /** Final captured pane content */
  content: string;
  /** Time taken in ms to reach idle (or timeout) */
  duration: number;
}

export interface CaptureProgressiveOptions {
  /** Target pane identifier */
  target: string;
  /** Optional string to search for in the captured output */
  searchString?: string;
  /** Timeout in ms for the overall operation (default: 30000) */
  timeout?: number;
  /** Poll interval in ms between capture attempts (default: 500) */
  interval?: number;
}

export interface FleetPaneMapping {
  workerId: string;
  handle: string;
  paneId: string;
  windowId?: string;
  sessionId?: string;
  createdAt: number;
}
