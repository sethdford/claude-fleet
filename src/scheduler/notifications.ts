/**
 * Notification System
 *
 * Sends notifications to Slack, Teams, or other channels
 * when autonomous tasks start, complete, or fail.
 */

import { EventEmitter } from 'events';

export interface NotificationConfig {
  slack?: {
    webhookUrl: string;
    channel?: string;
    username?: string;
    iconEmoji?: string;
  };
  teams?: {
    webhookUrl: string;
  };
  discord?: {
    webhookUrl: string;
  };
  email?: {
    smtpHost: string;
    smtpPort: number;
    from: string;
    to: string[];
  };
}

export interface NotificationPayload {
  type: 'task_started' | 'task_completed' | 'task_failed' | 'security_alert' | 'schedule_triggered';
  title: string;
  message: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  fields?: Record<string, string>;
  repository?: string;
  taskId?: string;
  timestamp?: Date;
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
}

export class NotificationService extends EventEmitter {
  private static instance: NotificationService;
  private config: NotificationConfig = {};
  private enabled: boolean = true;
  private rateLimiter: Map<string, number> = new Map();
  private readonly RATE_LIMIT_MS = 1000; // 1 second between same notifications

  private constructor() {
    super();
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Configure notification channels
   */
  configure(config: NotificationConfig): void {
    this.config = config;
    console.log('[Notifications] Configured channels:', Object.keys(config).join(', '));
  }

  /**
   * Enable/disable notifications globally
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[Notifications] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Send notification to all configured channels
   */
  async send(payload: NotificationPayload): Promise<void> {
    if (!this.enabled) {
      console.log('[Notifications] Skipping (disabled):', payload.title);
      return;
    }

    // Rate limiting
    const key = `${payload.type}:${payload.taskId || payload.title}`;
    const lastSent = this.rateLimiter.get(key);
    if (lastSent && Date.now() - lastSent < this.RATE_LIMIT_MS) {
      console.log('[Notifications] Rate limited:', key);
      return;
    }
    this.rateLimiter.set(key, Date.now());

    payload.timestamp = payload.timestamp || new Date();

    const results = await Promise.allSettled([
      this.sendSlack(payload),
      this.sendTeams(payload),
      this.sendDiscord(payload)
    ]);

    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const channels = ['Slack', 'Teams', 'Discord'];
        console.error(`[Notifications] ${channels[index]} failed:`, result.reason);
      }
    });

    this.emit('sent', payload);
  }

  /**
   * Send to Slack
   */
  private async sendSlack(payload: NotificationPayload): Promise<void> {
    if (!this.config.slack?.webhookUrl) return;

    const color = this.getSeverityColor(payload.severity);
    const emoji = this.getStatusEmoji(payload.type);

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} ${payload.title}`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: payload.message
        }
      }
    ];

    // Add fields if present
    if (payload.fields && Object.keys(payload.fields).length > 0) {
      blocks.push({
        type: 'section',
        fields: Object.entries(payload.fields).map(([key, value]) => ({
          type: 'mrkdwn',
          text: `*${key}:*\n${value}`
        }))
      });
    }

    // Add context
    const contextElements = [];
    if (payload.repository) {
      contextElements.push(`📦 ${payload.repository}`);
    }
    if (payload.taskId) {
      contextElements.push(`🔖 ${payload.taskId}`);
    }
    contextElements.push(`🕐 ${payload.timestamp?.toISOString()}`);

    blocks.push({
      type: 'context',
      elements: contextElements.map(text => ({ type: 'mrkdwn', text }))
    });

    const slackPayload = {
      channel: this.config.slack.channel,
      username: this.config.slack.username || 'Claude Fleet',
      icon_emoji: this.config.slack.iconEmoji || ':robot_face:',
      attachments: [
        {
          color,
          blocks
        }
      ]
    };

    await this.postWebhook(this.config.slack.webhookUrl, slackPayload);
    console.log('[Notifications] Sent to Slack:', payload.title);
  }

  /**
   * Send to Microsoft Teams
   */
  private async sendTeams(payload: NotificationPayload): Promise<void> {
    if (!this.config.teams?.webhookUrl) return;

    const color = this.getSeverityColor(payload.severity);
    const emoji = this.getStatusEmoji(payload.type);

    const facts = [];
    if (payload.repository) {
      facts.push({ name: 'Repository', value: payload.repository });
    }
    if (payload.taskId) {
      facts.push({ name: 'Task ID', value: payload.taskId });
    }
    if (payload.fields) {
      Object.entries(payload.fields).forEach(([key, value]) => {
        facts.push({ name: key, value });
      });
    }

    const teamsPayload = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: color.replace('#', ''),
      summary: payload.title,
      sections: [
        {
          activityTitle: `${emoji} ${payload.title}`,
          activitySubtitle: payload.timestamp?.toISOString(),
          activityImage: 'https://www.anthropic.com/images/icons/apple-touch-icon.png',
          facts,
          text: payload.message,
          markdown: true
        }
      ]
    };

    await this.postWebhook(this.config.teams.webhookUrl, teamsPayload);
    console.log('[Notifications] Sent to Teams:', payload.title);
  }

  /**
   * Send to Discord
   */
  private async sendDiscord(payload: NotificationPayload): Promise<void> {
    if (!this.config.discord?.webhookUrl) return;

    const color = this.getSeverityColorInt(payload.severity);
    const emoji = this.getStatusEmoji(payload.type);

    const fields = [];
    if (payload.repository) {
      fields.push({ name: 'Repository', value: payload.repository, inline: true });
    }
    if (payload.taskId) {
      fields.push({ name: 'Task ID', value: payload.taskId, inline: true });
    }
    if (payload.fields) {
      Object.entries(payload.fields).forEach(([key, value]) => {
        fields.push({ name: key, value, inline: true });
      });
    }

    const discordPayload = {
      username: 'Claude Fleet',
      avatar_url: 'https://www.anthropic.com/images/icons/apple-touch-icon.png',
      embeds: [
        {
          title: `${emoji} ${payload.title}`,
          description: payload.message,
          color,
          fields,
          timestamp: payload.timestamp?.toISOString(),
          footer: {
            text: 'Claude Fleet Autonomous Ops'
          }
        }
      ]
    };

    await this.postWebhook(this.config.discord.webhookUrl, discordPayload);
    console.log('[Notifications] Sent to Discord:', payload.title);
  }

  /**
   * Post to webhook URL
   */
  private async postWebhook(url: string, payload: unknown): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Get color for severity
   */
  private getSeverityColor(severity?: string): string {
    switch (severity) {
      case 'critical': return '#dc2626'; // Red
      case 'error': return '#ea580c';    // Orange
      case 'warning': return '#ca8a04';  // Yellow
      case 'info':
      default: return '#2563eb';         // Blue
    }
  }

  /**
   * Get color as integer (for Discord)
   */
  private getSeverityColorInt(severity?: string): number {
    switch (severity) {
      case 'critical': return 0xdc2626;
      case 'error': return 0xea580c;
      case 'warning': return 0xca8a04;
      case 'info':
      default: return 0x2563eb;
    }
  }

  /**
   * Get emoji for notification type
   */
  private getStatusEmoji(type: NotificationPayload['type']): string {
    switch (type) {
      case 'task_started': return '🚀';
      case 'task_completed': return '✅';
      case 'task_failed': return '❌';
      case 'security_alert': return '🔒';
      case 'schedule_triggered': return '⏰';
      default: return '📢';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Notify task started
   */
  async notifyTaskStarted(taskName: string, repository?: string, taskId?: string): Promise<void> {
    await this.send({
      type: 'task_started',
      title: 'Task Started',
      message: `Autonomous task *${taskName}* has started execution.`,
      severity: 'info',
      repository,
      taskId
    });
  }

  /**
   * Notify task completed
   */
  async notifyTaskCompleted(
    taskName: string,
    result: { prUrl?: string; commitSha?: string; duration?: number },
    repository?: string,
    taskId?: string
  ): Promise<void> {
    const fields: Record<string, string> = {};
    if (result.prUrl) fields['Pull Request'] = result.prUrl;
    if (result.commitSha) fields['Commit'] = result.commitSha.substring(0, 7);
    if (result.duration) fields['Duration'] = `${Math.round(result.duration / 1000)}s`;

    await this.send({
      type: 'task_completed',
      title: 'Task Completed',
      message: `Autonomous task *${taskName}* completed successfully.`,
      severity: 'info',
      fields,
      repository,
      taskId
    });
  }

  /**
   * Notify task failed
   */
  async notifyTaskFailed(
    taskName: string,
    error: string,
    repository?: string,
    taskId?: string
  ): Promise<void> {
    await this.send({
      type: 'task_failed',
      title: 'Task Failed',
      message: `Autonomous task *${taskName}* failed:\n\`\`\`${error}\`\`\``,
      severity: 'error',
      repository,
      taskId
    });
  }

  /**
   * Notify security alert
   */
  async notifySecurityAlert(
    vulnerability: string,
    severity: 'critical' | 'high' | 'medium' | 'low',
    repository?: string
  ): Promise<void> {
    await this.send({
      type: 'security_alert',
      title: `Security Alert: ${severity.toUpperCase()}`,
      message: `Security vulnerability detected:\n${vulnerability}`,
      severity: severity === 'critical' || severity === 'high' ? 'critical' : 'warning',
      repository
    });
  }

  /**
   * Notify schedule triggered
   */
  async notifyScheduleTriggered(scheduleName: string, tasks: string[]): Promise<void> {
    await this.send({
      type: 'schedule_triggered',
      title: 'Scheduled Tasks Triggered',
      message: `Schedule *${scheduleName}* triggered ${tasks.length} tasks:\n• ${tasks.join('\n• ')}`,
      severity: 'info',
      fields: {
        'Schedule': scheduleName,
        'Tasks': tasks.length.toString()
      }
    });
  }
}

export default NotificationService;
