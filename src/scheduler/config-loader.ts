/**
 * Configuration Loader
 *
 * Loads and parses YAML configuration for autonomous operations.
 * Supports environment variable substitution.
 */

import fs from 'fs';
import path from 'path';
import { AutoScheduler } from './auto-scheduler.js';
import { TaskTemplateEngine, type TaskTemplate } from './templates.js';
import { NotificationService, type NotificationConfig } from './notifications.js';

interface ScheduleConfig {
  name: string;
  cron: string;
  enabled?: boolean;
  repository?: string;
  tasks: string[];
}

interface WebhookConfig {
  github?: {
    secret?: string;
    events?: string[];
    mappings?: Record<string, unknown>;
  };
}

interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  category: 'documentation' | 'testing' | 'security' | 'maintenance' | 'review' | 'conversion';
  role: string;
  estimatedMinutes?: number;
  prompt: string;
  steps?: string[];
  requiredContext?: string[];
  outputFormat?: 'pr' | 'commit' | 'report' | 'slack';
  notifyOn?: ('start' | 'complete' | 'error')[];
}

interface SchedulerSettings {
  maxConcurrentTasks?: number;
  defaultRetries?: number;
  retryDelayMs?: number;
}

interface RepositoryConfig {
  name: string;
  schedules?: ScheduleConfig[];
  webhooks?: WebhookConfig;
}

interface AutoOpsConfig {
  notifications?: NotificationConfig;
  schedules?: ScheduleConfig[];
  webhooks?: WebhookConfig;
  templates?: TemplateConfig[];
  scheduler?: SchedulerSettings;
  repositories?: RepositoryConfig[];
}

/**
 * Simple YAML parser (handles common cases without external dependency)
 * For production, consider using 'yaml' or 'js-yaml' package
 */
function parseYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  const stack: Array<{ indent: number; obj: Record<string, unknown>; key?: string; isArray?: boolean }> = [
    { indent: -1, obj: result }
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Calculate indentation
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Pop stack to find parent at correct indentation level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    // Handle array item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();

      // Initialize array if needed
      if (parent.key && !Array.isArray(parent.obj[parent.key])) {
        parent.obj[parent.key] = [];
      }

      const arr = parent.key ? (parent.obj[parent.key] as unknown[]) : [];

      // Check if this is a key: value or just a value
      const colonIndex = value.indexOf(':');
      if (colonIndex > 0 && !value.startsWith('"') && !value.startsWith("'")) {
        const itemKey = value.slice(0, colonIndex).trim();
        const itemValue = value.slice(colonIndex + 1).trim();
        const newObj: Record<string, unknown> = {};

        if (itemValue) {
          newObj[itemKey] = parseValue(itemValue);
        }

        arr.push(newObj);
        stack.push({ indent: indent + 2, obj: newObj, key: itemKey });
      } else {
        arr.push(parseValue(value));
      }
      continue;
    }

    // Handle key: value
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      if (value === '' || value === '|' || value === '>') {
        // Nested object or multiline string
        parent.obj[key] = value === '|' || value === '>' ? '' : {};

        if (value === '|' || value === '>') {
          // Collect multiline string
          const multilineIndent = indent + 2;
          let multiline = '';
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nextIndent = nextLine.search(/\S/);
            if (nextIndent >= multilineIndent || nextLine.trim() === '') {
              multiline += (multiline ? '\n' : '') + nextLine.slice(multilineIndent);
              i++;
            } else {
              break;
            }
          }
          parent.obj[key] = multiline;
        } else {
          stack.push({ indent, obj: parent.obj[key] as Record<string, unknown>, key });
        }
      } else {
        parent.obj[key] = parseValue(value);
        stack.push({ indent, obj: parent.obj, key });
      }
    }
  }

  return result;
}

/**
 * Parse a YAML value
 */
function parseValue(value: string): unknown {
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Null
  if (value === 'null' || value === '~') return null;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  // Environment variable substitution
  if (value.startsWith('${') && value.endsWith('}')) {
    const envVar = value.slice(2, -1);
    return process.env[envVar] || '';
  }

  // Array (inline)
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map(v => parseValue(v.trim()));
  }

  return value;
}

/**
 * Load configuration from file
 */
export function loadConfig(configPath: string): AutoOpsConfig {
  if (!fs.existsSync(configPath)) {
    console.log(`[Config] Configuration file not found: ${configPath}`);
    return {};
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const config = parseYaml(content) as AutoOpsConfig;

  console.log(`[Config] Loaded configuration from: ${configPath}`);

  return config;
}

/**
 * Apply configuration to services
 */
export function applyConfig(config: AutoOpsConfig): void {
  const scheduler = AutoScheduler.getInstance();
  const templateEngine = TaskTemplateEngine.getInstance();
  const notifications = NotificationService.getInstance();

  // Configure notifications
  if (config.notifications) {
    notifications.configure(config.notifications);
    console.log('[Config] Applied notification settings');
  }

  // Load schedules
  if (config.schedules && config.schedules.length > 0) {
    for (const schedule of config.schedules) {
      scheduler.registerSchedule({
        name: schedule.name,
        cron: schedule.cron,
        tasks: schedule.tasks,
        repository: schedule.repository,
        enabled: schedule.enabled ?? true
      });
    }
    console.log(`[Config] Loaded ${config.schedules.length} schedules`);
  }

  // Load custom templates
  if (config.templates && config.templates.length > 0) {
    for (const template of config.templates) {
      templateEngine.registerTemplate(template as TaskTemplate);
    }
    console.log(`[Config] Loaded ${config.templates.length} custom templates`);
  }

  // Load repository-specific schedules
  if (config.repositories && config.repositories.length > 0) {
    for (const repo of config.repositories) {
      if (repo.schedules) {
        for (const schedule of repo.schedules) {
          scheduler.registerSchedule({
            name: schedule.name,
            cron: schedule.cron,
            tasks: schedule.tasks,
            repository: repo.name,
            enabled: schedule.enabled ?? true
          });
        }
      }
    }
    console.log(`[Config] Loaded schedules for ${config.repositories.length} repositories`);
  }
}

/**
 * Load and apply configuration from default locations
 */
export function loadDefaultConfig(): AutoOpsConfig {
  const possiblePaths = [
    path.join(process.cwd(), 'config', 'autonomous-ops.yaml'),
    path.join(process.cwd(), 'config', 'autonomous-ops.yml'),
    path.join(process.cwd(), 'autonomous-ops.yaml'),
    path.join(process.cwd(), 'autonomous-ops.yml'),
    path.join(process.cwd(), '.fleet', 'autonomous-ops.yaml')
  ];

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      const config = loadConfig(configPath);
      applyConfig(config);
      return config;
    }
  }

  console.log('[Config] No configuration file found, using defaults');
  return {};
}

/**
 * Validate configuration
 */
export function validateConfig(config: AutoOpsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate schedules
  if (config.schedules) {
    for (const schedule of config.schedules) {
      if (!schedule.name) {
        errors.push('Schedule missing name');
      }
      if (!schedule.cron) {
        errors.push(`Schedule '${schedule.name}' missing cron expression`);
      }
      if (!schedule.tasks || schedule.tasks.length === 0) {
        errors.push(`Schedule '${schedule.name}' has no tasks`);
      }
    }
  }

  // Validate templates
  if (config.templates) {
    for (const template of config.templates) {
      if (!template.id) {
        errors.push('Template missing id');
      }
      if (!template.prompt) {
        errors.push(`Template '${template.id}' missing prompt`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default { loadConfig, applyConfig, loadDefaultConfig, validateConfig };
