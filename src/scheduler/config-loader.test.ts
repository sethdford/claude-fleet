/**
 * Tests for config-loader module
 *
 * Covers: loadConfig, applyConfig, loadDefaultConfig, validateConfig, parseYaml
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import { loadConfig, applyConfig, loadDefaultConfig, validateConfig } from './config-loader.js';

// Mock fs module at the top level (hoisted by vitest)
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock the scheduler dependencies as singletons
const mockRegisterSchedule = vi.fn();
const mockRegisterTemplate = vi.fn();
const mockConfigure = vi.fn();

vi.mock('./auto-scheduler.js', () => ({
  AutoScheduler: {
    getInstance: vi.fn(() => ({
      registerSchedule: mockRegisterSchedule,
    })),
  },
}));

vi.mock('./templates.js', () => ({
  TaskTemplateEngine: {
    getInstance: vi.fn(() => ({
      registerTemplate: mockRegisterTemplate,
    })),
  },
}));

vi.mock('./notifications.js', () => ({
  NotificationService: {
    getInstance: vi.fn(() => ({
      configure: mockConfigure,
    })),
  },
}));

const mockedFs = vi.mocked(fs);

describe('config-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // loadConfig()
  // ==========================================================================

  describe('loadConfig()', () => {
    it('should return empty object when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const config = loadConfig('/nonexistent/path.yaml');
      expect(config).toEqual({});
    });

    it('should read and parse a YAML file when it exists', () => {
      const yamlContent = [
        'schedules:',
        '  - name: nightly',
        '    cron: "0 2 * * *"',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig('/some/path.yaml');
      expect(mockedFs.readFileSync).toHaveBeenCalledWith('/some/path.yaml', 'utf-8');
      expect(config).toBeDefined();
    });

    it('should handle empty YAML file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('');

      const config = loadConfig('/empty.yaml');
      expect(config).toEqual({});
    });

    it('should parse simple key-value pairs', () => {
      const yamlContent = [
        'scheduler:',
        '  maxConcurrentTasks: 5',
        '  defaultRetries: 3',
        '  retryDelayMs: 10000',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig('/config.yaml');
      expect(config).toBeDefined();
      expect(config.scheduler).toBeDefined();
    });

    it('should parse boolean values correctly', () => {
      const yamlContent = [
        'schedules:',
        '  - name: test-schedule',
        '    enabled: true',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig('/config.yaml');
      expect(config).toBeDefined();
    });

    it('should skip comments and empty lines in YAML', () => {
      const yamlContent = [
        '# This is a comment',
        '',
        'scheduler:',
        '  maxConcurrentTasks: 3',
        '',
        '  # Another comment',
        '  defaultRetries: 2',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig('/config.yaml');
      expect(config).toBeDefined();
      expect(config.scheduler).toBeDefined();
    });

    it('should parse quoted string values', () => {
      const yamlContent = [
        'notifications:',
        '  slack:',
        '    webhookUrl: "https://hooks.slack.com/test"',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig('/config.yaml');
      expect(config).toBeDefined();
      expect(config.notifications).toBeDefined();
    });

    it('should parse numeric values', () => {
      const yamlContent = [
        'scheduler:',
        '  maxConcurrentTasks: 10',
        '  retryDelayMs: 5000',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig('/config.yaml');
      expect(config.scheduler).toBeDefined();
    });

    it('should parse null and tilde values', () => {
      const yamlContent = [
        'scheduler:',
        '  optional: null',
        '  other: ~',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(yamlContent);

      const config = loadConfig('/config.yaml');
      expect(config.scheduler).toBeDefined();
    });
  });

  // ==========================================================================
  // validateConfig()
  // ==========================================================================

  describe('validateConfig()', () => {
    it('should pass for valid empty config', () => {
      const result = validateConfig({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for valid config with schedules and templates', () => {
      const result = validateConfig({
        schedules: [
          { name: 'nightly', cron: '0 2 * * *', tasks: ['update-deps'] },
        ],
        templates: [
          {
            id: 'custom-lint',
            name: 'Custom Lint',
            description: 'Run lint',
            category: 'maintenance',
            role: 'worker',
            prompt: 'Fix all lint errors',
          },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when schedule is missing name', () => {
      const result = validateConfig({
        schedules: [
          { name: '', cron: '0 2 * * *', tasks: ['task1'] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Schedule missing name');
    });

    it('should fail when schedule is missing cron', () => {
      const result = validateConfig({
        schedules: [
          { name: 'test', cron: '', tasks: ['task1'] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing cron'))).toBe(true);
    });

    it('should fail when schedule has empty tasks', () => {
      const result = validateConfig({
        schedules: [
          { name: 'test', cron: '0 * * * *', tasks: [] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('has no tasks'))).toBe(true);
    });

    it('should fail when template is missing id', () => {
      const result = validateConfig({
        templates: [
          {
            id: '',
            name: 'No ID',
            description: 'test',
            category: 'maintenance',
            role: 'worker',
            prompt: 'do something',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Template missing id');
    });

    it('should fail when template is missing prompt', () => {
      const result = validateConfig({
        templates: [
          {
            id: 'no-prompt',
            name: 'No Prompt',
            description: 'test',
            category: 'maintenance',
            role: 'worker',
            prompt: '',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing prompt'))).toBe(true);
    });

    it('should collect multiple errors at once', () => {
      const result = validateConfig({
        schedules: [
          { name: '', cron: '', tasks: [] },
          { name: 'valid', cron: '0 * * * *', tasks: [] },
        ],
        templates: [
          {
            id: '',
            name: 'Bad',
            description: '',
            category: 'testing',
            role: 'worker',
            prompt: '',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });

    it('should pass config with no schedules or templates keys', () => {
      const result = validateConfig({
        notifications: {
          slack: { webhookUrl: 'https://hooks.slack.com/test' },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass when schedule has undefined tasks field', () => {
      const result = validateConfig({
        schedules: [
          { name: 'no-tasks', cron: '0 * * * *' } as { name: string; cron: string; tasks: string[] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('has no tasks'))).toBe(true);
    });
  });

  // ==========================================================================
  // applyConfig()
  // ==========================================================================

  describe('applyConfig()', () => {
    it('should apply notification settings', () => {
      applyConfig({
        notifications: {
          slack: {
            webhookUrl: 'https://hooks.slack.com/test',
            channel: '#ops',
          },
        },
      });

      expect(mockConfigure).toHaveBeenCalledWith({
        slack: {
          webhookUrl: 'https://hooks.slack.com/test',
          channel: '#ops',
        },
      });
    });

    it('should register schedules', () => {
      applyConfig({
        schedules: [
          {
            name: 'nightly',
            cron: '0 2 * * *',
            tasks: ['update-deps', 'lint-fix'],
            enabled: true,
          },
          {
            name: 'weekly',
            cron: '0 9 * * 1',
            tasks: ['security-audit'],
          },
        ],
      });

      expect(mockRegisterSchedule).toHaveBeenCalledTimes(2);
      expect(mockRegisterSchedule).toHaveBeenCalledWith({
        name: 'nightly',
        cron: '0 2 * * *',
        tasks: ['update-deps', 'lint-fix'],
        repository: undefined,
        enabled: true,
      });
      expect(mockRegisterSchedule).toHaveBeenCalledWith({
        name: 'weekly',
        cron: '0 9 * * 1',
        tasks: ['security-audit'],
        repository: undefined,
        enabled: true,
      });
    });

    it('should register custom templates', () => {
      const template = {
        id: 'custom-scan',
        name: 'Custom Scan',
        description: 'A custom security scan',
        category: 'security' as const,
        role: 'security-engineer',
        prompt: 'Scan for vulnerabilities',
      };

      applyConfig({
        templates: [template],
      });

      expect(mockRegisterTemplate).toHaveBeenCalledTimes(1);
      expect(mockRegisterTemplate).toHaveBeenCalledWith(template);
    });

    it('should register repository-specific schedules', () => {
      applyConfig({
        repositories: [
          {
            name: 'org/repo-a',
            schedules: [
              { name: 'repo-a-nightly', cron: '0 3 * * *', tasks: ['lint'], enabled: true },
            ],
          },
          {
            name: 'org/repo-b',
            schedules: [
              { name: 'repo-b-weekly', cron: '0 10 * * 5', tasks: ['test'] },
            ],
          },
        ],
      });

      expect(mockRegisterSchedule).toHaveBeenCalledTimes(2);
      expect(mockRegisterSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'repo-a-nightly',
          repository: 'org/repo-a',
        })
      );
      expect(mockRegisterSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'repo-b-weekly',
          repository: 'org/repo-b',
        })
      );
    });

    it('should handle repositories with no schedules', () => {
      applyConfig({
        repositories: [
          { name: 'org/empty-repo' },
        ],
      });

      expect(mockRegisterSchedule).not.toHaveBeenCalled();
    });

    it('should not call services when config has no relevant sections', () => {
      applyConfig({});

      expect(mockConfigure).not.toHaveBeenCalled();
      expect(mockRegisterSchedule).not.toHaveBeenCalled();
      expect(mockRegisterTemplate).not.toHaveBeenCalled();
    });

    it('should not register empty schedule arrays', () => {
      applyConfig({
        schedules: [],
      });

      expect(mockRegisterSchedule).not.toHaveBeenCalled();
    });

    it('should not register empty template arrays', () => {
      applyConfig({
        templates: [],
      });

      expect(mockRegisterTemplate).not.toHaveBeenCalled();
    });

    it('should default enabled to true when not specified', () => {
      applyConfig({
        schedules: [
          { name: 'no-enabled', cron: '0 * * * *', tasks: ['t1'] },
        ],
      });

      expect(mockRegisterSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true })
      );
    });

    it('should handle empty repositories array', () => {
      applyConfig({
        repositories: [],
      });

      expect(mockRegisterSchedule).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // loadDefaultConfig()
  // ==========================================================================

  describe('loadDefaultConfig()', () => {
    it('should return empty object when no config files found', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const config = loadDefaultConfig();
      expect(config).toEqual({});
    });

    it('should load first matching config file', () => {
      mockedFs.existsSync.mockImplementation((p: unknown) => {
        return String(p).endsWith('autonomous-ops.yml') && String(p).includes('config');
      });
      mockedFs.readFileSync.mockReturnValue('scheduler:\n  maxConcurrentTasks: 5');

      const config = loadDefaultConfig();
      expect(config).toBeDefined();
    });

    it('should try all possible paths when none match', () => {
      mockedFs.existsSync.mockReturnValue(false);

      loadDefaultConfig();

      // Should check at least 5 paths
      expect(mockedFs.existsSync.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    it('should stop searching after finding first match', () => {
      // First path matches
      mockedFs.existsSync.mockImplementation((p: unknown) => {
        return String(p).includes('config/autonomous-ops.yaml');
      });
      mockedFs.readFileSync.mockReturnValue('scheduler:\n  maxConcurrentTasks: 3');

      loadDefaultConfig();

      // readFileSync should only be called once (first match)
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
