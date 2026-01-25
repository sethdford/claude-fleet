/**
 * TmuxController Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TmuxController } from './controller.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

import { execSync, spawnSync } from 'node:child_process';

describe('TmuxController', () => {
  let controller: TmuxController;
  const mockExecSync = vi.mocked(execSync);
  const mockSpawnSync = vi.mocked(spawnSync);

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new TmuxController();
  });

  describe('Environment Detection', () => {
    it('detects when inside tmux', () => {
      const originalTmux = process.env.TMUX;
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';

      expect(controller.isInsideTmux()).toBe(true);

      process.env.TMUX = originalTmux;
    });

    it('detects when not inside tmux', () => {
      const originalTmux = process.env.TMUX;
      delete process.env.TMUX;

      expect(controller.isInsideTmux()).toBe(false);

      if (originalTmux) {
        process.env.TMUX = originalTmux;
      }
    });

    it('checks if tmux is installed', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/tmux'));
      expect(controller.isTmuxInstalled()).toBe(true);
    });

    it('returns false when tmux not installed', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      expect(controller.isTmuxInstalled()).toBe(false);
    });
  });

  describe('Session Information', () => {
    beforeEach(() => {
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
    });

    afterEach(() => {
      delete process.env.TMUX;
    });

    it('gets current session name', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'main', stderr: '' } as ReturnType<typeof spawnSync>);
      expect(controller.getCurrentSession()).toBe('main');
    });

    it('gets current window', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '0', stderr: '' } as ReturnType<typeof spawnSync>);
      expect(controller.getCurrentWindow()).toBe('0');
    });

    it('gets current pane', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '%0', stderr: '' } as ReturnType<typeof spawnSync>);
      expect(controller.getCurrentPane()).toBe('%0');
    });
  });

  describe('List Operations', () => {
    it('lists sessions', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '$0|main|1700000000|1|2\n$1|dev|1700001000|0|1',
        stderr: '',
      } as ReturnType<typeof spawnSync>);

      const sessions = controller.listSessions();

      expect(sessions.length).toBe(2);
      expect(sessions[0].name).toBe('main');
      expect(sessions[0].attached).toBe(true);
      expect(sessions[1].name).toBe('dev');
      expect(sessions[1].attached).toBe(false);
    });

    it('lists windows', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '@0|0|main|1|2\n@1|1|editor|0|1',
        stderr: '',
      } as ReturnType<typeof spawnSync>);

      const windows = controller.listWindows();

      expect(windows.length).toBe(2);
      expect(windows[0].name).toBe('main');
      expect(windows[0].active).toBe(true);
      expect(windows[1].name).toBe('editor');
    });

    it('lists panes', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%0|0|pane0|1|80|24|zsh|1234\n%1|1|pane1|0|80|24|vim|5678',
        stderr: '',
      } as ReturnType<typeof spawnSync>);

      const panes = controller.listPanes();

      expect(panes.length).toBe(2);
      expect(panes[0].id).toBe('%0');
      expect(panes[0].active).toBe(true);
      expect(panes[0].command).toBe('zsh');
      expect(panes[1].command).toBe('vim');
    });

    it('returns empty array when no sessions', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'no sessions',
      } as ReturnType<typeof spawnSync>);

      expect(controller.listSessions()).toEqual([]);
    });
  });

  describe('Pane Creation', () => {
    it('creates vertical split pane', () => {
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: '%1', stderr: '' } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 0,
          stdout: '%1|1|pane1|0|80|24|zsh|5678',
          stderr: '',
        } as ReturnType<typeof spawnSync>);

      const pane = controller.createPane({ direction: 'vertical' });

      expect(pane).toBeDefined();
      expect(pane?.id).toBe('%1');
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['split-window']),
        expect.any(Object)
      );
    });

    it('creates horizontal split pane', () => {
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: '%1', stderr: '' } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 0,
          stdout: '%1|1|pane1|0|80|24|zsh|5678',
          stderr: '',
        } as ReturnType<typeof spawnSync>);

      controller.createPane({ direction: 'horizontal' });

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['-h']),
        expect.any(Object)
      );
    });

    it('creates pane with command', () => {
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: '%1', stderr: '' } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({
          status: 0,
          stdout: '%1|1|pane1|0|80|24|node|5678',
          stderr: '',
        } as ReturnType<typeof spawnSync>);

      controller.createPane({ command: 'node server.js' });

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['node server.js']),
        expect.any(Object)
      );
    });
  });

  describe('Pane Operations', () => {
    beforeEach(() => {
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
    });

    afterEach(() => {
      delete process.env.TMUX;
    });

    it('kills a pane', () => {
      // Mock getCurrentPane to return different pane (%0)
      // Mock getActivePaneId to return different pane (%0) - format: paneId|active|windowIndex
      // Mock the actual kill-pane call
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: '%0', stderr: '' } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({ status: 0, stdout: '%0|1|0', stderr: '' } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);

      const result = controller.killPane('%1');

      expect(result).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['kill-pane']),
        expect.any(Object)
      );
    });

    it('prevents killing current pane', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '%1', stderr: '' } as ReturnType<typeof spawnSync>);

      expect(() => controller.killPane('%1')).toThrow('Cannot kill current pane');
    });

    it('prevents killing active pane (when not inside tmux)', () => {
      // First call: getCurrentPane returns undefined (not inside tmux)
      // Second call: getActivePaneId returns %1
      delete process.env.TMUX;
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '%1|1|0', stderr: '' } as ReturnType<typeof spawnSync>);

      expect(() => controller.killPane('%1')).toThrow('Cannot kill active pane');
    });

    it('captures pane output', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '$ ls\nfile1.txt\nfile2.txt\n',
        stderr: '',
      } as ReturnType<typeof spawnSync>);

      const output = controller.capture('%0');

      expect(output).toBe('$ ls\nfile1.txt\nfile2.txt');
    });
  });

  describe('Target Resolution', () => {
    it('resolves pane index to ID', () => {
      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: '%0|0|pane0|1|80|24|zsh|1234\n%1|1|pane1|0|80|24|vim|5678',
          stderr: '',
        } as ReturnType<typeof spawnSync>)
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);

      controller.focusPane('1');

      expect(mockSpawnSync).toHaveBeenLastCalledWith(
        'tmux',
        expect.arrayContaining(['%1']),
        expect.any(Object)
      );
    });

    it('passes through pane IDs unchanged', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);

      controller.focusPane('%5');

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['%5']),
        expect.any(Object)
      );
    });
  });

  describe('Session Management', () => {
    it('creates a session', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '$1', stderr: '' } as ReturnType<typeof spawnSync>);

      const sessionId = controller.createSession({ name: 'test-session' });

      expect(sessionId).toBe('$1');
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['new-session']),
        expect.any(Object)
      );
    });

    it('kills a session', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);

      const result = controller.killSession('test-session');

      expect(result).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['kill-session']),
        expect.any(Object)
      );
    });

    it('checks if session exists', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);

      expect(controller.sessionExists('main')).toBe(true);
    });

    it('returns false when session does not exist', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'session not found',
      } as ReturnType<typeof spawnSync>);

      expect(controller.sessionExists('nonexistent')).toBe(false);
    });

    it('gets attach command', () => {
      const originalTmux = process.env.TMUX;
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'main', stderr: '' } as ReturnType<typeof spawnSync>);

      const cmd = controller.getAttachCommand();

      expect(cmd).toBe('tmux attach-session -t main');

      process.env.TMUX = originalTmux;
    });
  });

  describe('Input Keys', () => {
    it('sends escape key', () => {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);

      controller.sendEscape('%0');

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['Escape']),
        expect.any(Object)
      );
    });

    it('sends keys with instant mode', async () => {
      mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);

      // Use verifyEnter: false to skip Enter verification (which adds extra capture calls)
      await controller.sendKeys('%0', 'hello', { instant: true, verifyEnter: false });

      // Should have sent keys and Enter without delay (no verification = 2 calls)
      expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    });

    it('sends keys with Enter verification', async () => {
      // Mock different content before and after Enter to simulate success
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>) // send text
        .mockReturnValueOnce({ status: 0, stdout: 'before', stderr: '' } as ReturnType<typeof spawnSync>) // capture before
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>) // send Enter
        .mockReturnValueOnce({ status: 0, stdout: 'after', stderr: '' } as ReturnType<typeof spawnSync>); // capture after

      await controller.sendKeys('%0', 'hello', { instant: true, verifyEnter: true });

      // With verification: send text, capture, send Enter, capture
      expect(mockSpawnSync).toHaveBeenCalledTimes(4);
    });

    it('sends keys with custom delay', async () => {
      mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);

      const start = Date.now();
      await controller.sendKeys('%0', 'hello', { delay: 50 });
      const elapsed = Date.now() - start;

      // Should have waited approximately 50ms
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});
