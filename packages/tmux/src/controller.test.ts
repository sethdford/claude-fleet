/**
 * TmuxController Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TmuxController } from './controller.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

import { execSync } from 'node:child_process';

describe('TmuxController', () => {
  let controller: TmuxController;
  const mockExecSync = vi.mocked(execSync);

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
      mockExecSync.mockReturnValueOnce(Buffer.from('main\n'));
      expect(controller.getCurrentSession()).toBe('main');
    });

    it('gets current window', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('0\n'));
      expect(controller.getCurrentWindow()).toBe('0');
    });

    it('gets current pane', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('%0\n'));
      expect(controller.getCurrentPane()).toBe('%0');
    });
  });

  describe('List Operations', () => {
    it('lists sessions', () => {
      mockExecSync.mockReturnValueOnce(
        Buffer.from('$0|main|1700000000|1|2\n$1|dev|1700001000|0|1\n')
      );

      const sessions = controller.listSessions();

      expect(sessions.length).toBe(2);
      expect(sessions[0].name).toBe('main');
      expect(sessions[0].attached).toBe(true);
      expect(sessions[1].name).toBe('dev');
      expect(sessions[1].attached).toBe(false);
    });

    it('lists windows', () => {
      mockExecSync.mockReturnValueOnce(
        Buffer.from('@0|0|main|1|2\n@1|1|editor|0|1\n')
      );

      const windows = controller.listWindows();

      expect(windows.length).toBe(2);
      expect(windows[0].name).toBe('main');
      expect(windows[0].active).toBe(true);
      expect(windows[1].name).toBe('editor');
    });

    it('lists panes', () => {
      mockExecSync.mockReturnValueOnce(
        Buffer.from('%0|0|pane0|1|80|24|zsh|1234\n%1|1|pane1|0|80|24|vim|5678\n')
      );

      const panes = controller.listPanes();

      expect(panes.length).toBe(2);
      expect(panes[0].id).toBe('%0');
      expect(panes[0].active).toBe(true);
      expect(panes[0].command).toBe('zsh');
      expect(panes[1].command).toBe('vim');
    });

    it('returns empty array when no sessions', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('no sessions');
      });

      expect(controller.listSessions()).toEqual([]);
    });
  });

  describe('Pane Creation', () => {
    it('creates vertical split pane', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('%1\n'));
      mockExecSync.mockReturnValueOnce(
        Buffer.from('%1|1|pane1|0|80|24|zsh|5678\n')
      );

      const pane = controller.createPane({ direction: 'vertical' });

      expect(pane).toBeDefined();
      expect(pane?.id).toBe('%1');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('split-window'),
        expect.any(Object)
      );
    });

    it('creates horizontal split pane', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('%1\n'));
      mockExecSync.mockReturnValueOnce(
        Buffer.from('%1|1|pane1|0|80|24|zsh|5678\n')
      );

      controller.createPane({ direction: 'horizontal' });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-h'),
        expect.any(Object)
      );
    });

    it('creates pane with command', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('%1\n'));
      mockExecSync.mockReturnValueOnce(Buffer.from('%1|1|pane1|0|80|24|node|5678\n'));

      controller.createPane({ command: 'node server.js' });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('node server.js'),
        expect.any(Object)
      );
    });
  });

  describe('Pane Operations', () => {
    it('kills a pane', () => {
      // Mock getCurrentPane to return different pane
      mockExecSync.mockReturnValueOnce(Buffer.from('%0\n'));
      mockExecSync.mockReturnValueOnce(Buffer.from(''));

      const result = controller.killPane('%1');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('kill-pane'),
        expect.any(Object)
      );
    });

    it('prevents killing current pane', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('%1\n'));

      expect(() => controller.killPane('%1')).toThrow('Cannot kill current pane');
    });

    it('captures pane output', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('$ ls\nfile1.txt\nfile2.txt\n'));

      const output = controller.capture('%0');

      expect(output).toBe('$ ls\nfile1.txt\nfile2.txt');
    });
  });

  describe('Target Resolution', () => {
    it('resolves pane index to ID', () => {
      mockExecSync.mockReturnValueOnce(
        Buffer.from('%0|0|pane0|1|80|24|zsh|1234\n%1|1|pane1|0|80|24|vim|5678\n')
      );
      mockExecSync.mockReturnValueOnce(Buffer.from(''));

      controller.focusPane('1');

      expect(mockExecSync).toHaveBeenLastCalledWith(
        expect.stringContaining('%1'),
        expect.any(Object)
      );
    });

    it('passes through pane IDs unchanged', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from(''));

      controller.focusPane('%5');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('%5'),
        expect.any(Object)
      );
    });
  });

  describe('Session Management', () => {
    it('creates a session', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('$1\n'));

      const sessionId = controller.createSession({ name: 'test-session' });

      expect(sessionId).toBe('$1');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('new-session'),
        expect.any(Object)
      );
    });

    it('kills a session', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from(''));

      const result = controller.killSession('test-session');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('kill-session'),
        expect.any(Object)
      );
    });

    it('checks if session exists', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from(''));

      expect(controller.sessionExists('main')).toBe(true);
    });

    it('returns false when session does not exist', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('session not found');
      });

      expect(controller.sessionExists('nonexistent')).toBe(false);
    });

    it('gets attach command', () => {
      const originalTmux = process.env.TMUX;
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
      mockExecSync.mockReturnValueOnce(Buffer.from('main\n'));

      const cmd = controller.getAttachCommand();

      expect(cmd).toBe('tmux attach-session -t main');

      process.env.TMUX = originalTmux;
    });
  });

  describe('Input Keys', () => {
    it('sends escape key', () => {
      mockExecSync.mockReturnValueOnce(Buffer.from(''));

      controller.sendEscape('%0');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('Escape'),
        expect.any(Object)
      );
    });

    it('sends keys with instant mode', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      await controller.sendKeys('%0', 'hello', { instant: true });

      // Should have sent keys and Enter without delay
      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('sends keys with custom delay', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      const start = Date.now();
      await controller.sendKeys('%0', 'hello', { delay: 50 });
      const elapsed = Date.now() - start;

      // Should have waited approximately 50ms
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});
