/**
 * Autonomous Operations Module
 *
 * Exports all scheduler, template, and notification components
 * for 24/7 autonomous task execution.
 */

export { AutoScheduler, DEFAULT_SCHEDULES } from './auto-scheduler.js';
export {
  TaskTemplateEngine,
  TASK_TEMPLATES,
  type TaskTemplate,
  type TaskExecutionContext,
  type TaskExecutionResult
} from './templates.js';
export {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload
} from './notifications.js';
export { TaskExecutor } from './executor.js';
export {
  loadConfig,
  applyConfig,
  loadDefaultConfig,
  validateConfig
} from './config-loader.js';
