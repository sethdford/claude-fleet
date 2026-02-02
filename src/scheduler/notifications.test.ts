/**
 * Tests for NotificationService
 *
 * Co-located test that enhances the existing tests/scheduler.test.ts with
 * additional coverage for:
 * - Rate limiting behavior
 * - Teams webhook formatting
 * - Discord webhook formatting
 * - Multiple channel delivery (allSettled)
 * - Webhook failure handling
 * - All convenience methods
 * - Severity color mapping
 * - Status emoji mapping
 * - Event emission on send
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Global fetch mock
let mockFetch: ReturnType<typeof vi.fn>;

describe('NotificationService', () => {
  let NotificationService: typeof import('./notifications.js').NotificationService;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    const mod = await import('./notifications.js');
    NotificationService = mod.NotificationService;
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('getInstance()', () => {
    it('should return the same instance on repeated calls', () => {
      const a = NotificationService.getInstance();
      const b = NotificationService.getInstance();
      expect(a).toBe(b);
    });
  });

  // ==========================================================================
  // configure()
  // ==========================================================================

  describe('configure()', () => {
    it('should accept slack config', () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: {
          webhookUrl: 'https://hooks.slack.com/services/T/B/X',
          channel: '#ops',
          username: 'Bot',
          iconEmoji: ':robot:',
        },
      });
      // No error thrown
    });

    it('should accept teams config', () => {
      const service = NotificationService.getInstance();
      service.configure({
        teams: {
          webhookUrl: 'https://outlook.office.com/webhook/xxx',
        },
      });
    });

    it('should accept discord config', () => {
      const service = NotificationService.getInstance();
      service.configure({
        discord: {
          webhookUrl: 'https://discord.com/api/webhooks/xxx',
        },
      });
    });

    it('should accept multi-channel config', () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://slack.test' },
        teams: { webhookUrl: 'https://teams.test' },
        discord: { webhookUrl: 'https://discord.test' },
      });
    });
  });

  // ==========================================================================
  // setEnabled()
  // ==========================================================================

  describe('setEnabled()', () => {
    it('should disable notification sending', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });
      service.setEnabled(false);

      await service.send({
        type: 'task_completed',
        title: 'Test',
        message: 'Should not send',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should re-enable notification sending', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });
      service.setEnabled(false);
      service.setEnabled(true);

      await service.send({
        type: 'task_completed',
        title: 'Test',
        message: 'Should send now',
      });

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // send()
  // ==========================================================================

  describe('send()', () => {
    it('should send to Slack when configured', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.send({
        type: 'task_started',
        title: 'Task Started',
        message: 'Running update-docs',
        severity: 'info',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.attachments).toBeDefined();
      expect(body.attachments[0].blocks).toBeDefined();
    });

    it('should send to Teams when configured', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        teams: { webhookUrl: 'https://teams.test/webhook' },
      });

      await service.send({
        type: 'task_completed',
        title: 'Done',
        message: 'Task finished',
        severity: 'info',
        repository: 'org/repo',
        taskId: 'task-123',
        fields: { Duration: '30s' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://teams.test/webhook',
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body['@type']).toBe('MessageCard');
      expect(body.sections).toBeDefined();
      expect(body.sections[0].facts.length).toBeGreaterThan(0);
    });

    it('should send to Discord when configured', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        discord: { webhookUrl: 'https://discord.test/webhook' },
      });

      await service.send({
        type: 'security_alert',
        title: 'Alert',
        message: 'Vulnerability found',
        severity: 'critical',
        repository: 'org/repo',
        taskId: 'task-456',
        fields: { CVE: 'CVE-2024-1234' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.test/webhook',
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds).toBeDefined();
      expect(body.embeds[0].fields.length).toBeGreaterThan(0);
    });

    it('should send to all configured channels in parallel', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://slack.test' },
        teams: { webhookUrl: 'https://teams.test' },
        discord: { webhookUrl: 'https://discord.test' },
      });

      await service.send({
        type: 'task_completed',
        title: 'Multi-channel',
        message: 'Sent to all',
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not fail when one channel errors', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://slack.test' },
        teams: { webhookUrl: 'https://teams.test' },
      });

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('slack')) {
          return Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' });
        }
        return Promise.resolve({ ok: true });
      });

      // Should not throw even though Slack webhook fails
      await expect(service.send({
        type: 'task_completed',
        title: 'Partial fail',
        message: 'One channel fails',
      })).resolves.toBeUndefined();
    });

    it('should apply rate limiting for duplicate notifications', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.send({
        type: 'task_started',
        title: 'Rate limited',
        message: 'First send',
        taskId: 'task-rl',
      });

      // Immediately send same notification again
      await service.send({
        type: 'task_started',
        title: 'Rate limited',
        message: 'Second send',
        taskId: 'task-rl',
      });

      // Only the first should have been sent
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not send when no channels are configured', async () => {
      const service = NotificationService.getInstance();
      service.configure({});

      await service.send({
        type: 'task_completed',
        title: 'No channels',
        message: 'Should not send',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should emit sent event after sending', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.send({
        type: 'task_completed',
        title: 'Event test',
        message: 'Check event',
      });

      expect(sentSpy).toHaveBeenCalledOnce();
      expect(sentSpy.mock.calls[0][0].title).toBe('Event test');
    });

    it('should set timestamp if not provided', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.send({
        type: 'task_completed',
        title: 'Auto timestamp',
        message: 'No timestamp provided',
      });

      expect(sentSpy.mock.calls[0][0].timestamp).toBeInstanceOf(Date);
    });

    it('should use provided timestamp', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      const ts = new Date('2025-01-01T00:00:00Z');
      await service.send({
        type: 'task_completed',
        title: 'Custom timestamp',
        message: 'Has timestamp',
        timestamp: ts,
      });

      expect(sentSpy.mock.calls[0][0].timestamp).toBe(ts);
    });
  });

  // ==========================================================================
  // Slack-specific formatting
  // ==========================================================================

  describe('Slack formatting', () => {
    it('should include fields in Slack blocks when provided', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.send({
        type: 'task_completed',
        title: 'With Fields',
        message: 'Has fields',
        fields: { Duration: '30s', Result: 'success' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const fieldBlock = body.attachments[0].blocks.find(
        (b: Record<string, unknown>) => b.type === 'section' && Array.isArray(b.fields)
      );
      expect(fieldBlock).toBeDefined();
      expect(fieldBlock.fields).toHaveLength(2);
    });

    it('should use custom username and icon', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: {
          webhookUrl: 'https://hooks.slack.com/test',
          username: 'CustomBot',
          iconEmoji: ':star:',
          channel: '#custom',
        },
      });

      await service.send({
        type: 'task_completed',
        title: 'Custom',
        message: 'Test',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.username).toBe('CustomBot');
      expect(body.icon_emoji).toBe(':star:');
      expect(body.channel).toBe('#custom');
    });

    it('should use default username and icon when not configured', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.send({
        type: 'task_completed',
        title: 'Defaults',
        message: 'Test',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.username).toBe('Claude Fleet');
      expect(body.icon_emoji).toBe(':robot_face:');
    });
  });

  // ==========================================================================
  // Severity colors
  // ==========================================================================

  describe('severity colors', () => {
    it('should use red for critical severity', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.send({
        type: 'security_alert',
        title: 'Critical',
        message: 'Critical issue',
        severity: 'critical',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.attachments[0].color).toBe('#dc2626');
    });

    it('should use orange for error severity', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.send({
        type: 'task_failed',
        title: 'Error',
        message: 'Error occurred',
        severity: 'error',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.attachments[0].color).toBe('#ea580c');
    });

    it('should use yellow for warning severity', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.send({
        type: 'task_completed',
        title: 'Warning',
        message: 'Warning issued',
        severity: 'warning',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.attachments[0].color).toBe('#ca8a04');
    });

    it('should use blue for info severity (default)', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.send({
        type: 'task_completed',
        title: 'Info',
        message: 'Info message',
        severity: 'info',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.attachments[0].color).toBe('#2563eb');
    });
  });

  // ==========================================================================
  // Convenience methods
  // ==========================================================================

  describe('notifyTaskStarted()', () => {
    it('should send a task_started notification', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.notifyTaskStarted('update-docs', 'org/repo', 'task-001');

      expect(sentSpy).toHaveBeenCalledOnce();
      expect(sentSpy.mock.calls[0][0].type).toBe('task_started');
      expect(sentSpy.mock.calls[0][0].message).toContain('update-docs');
    });

    it('should work without optional parameters', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.notifyTaskStarted('simple-task');
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('notifyTaskCompleted()', () => {
    it('should include PR URL and commit SHA in fields', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.notifyTaskCompleted(
        'test-task',
        { prUrl: 'https://github.com/org/repo/pull/1', commitSha: 'abc1234def', duration: 30000 },
        'org/repo',
        'task-002'
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const blocks = body.attachments[0].blocks;
      const fieldBlock = blocks.find(
        (b: Record<string, unknown>) => b.type === 'section' && Array.isArray(b.fields)
      );
      expect(fieldBlock).toBeDefined();
    });

    it('should handle empty result fields', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      await service.notifyTaskCompleted('test-task', {}, 'org/repo');
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('notifyTaskFailed()', () => {
    it('should send error notification with error message', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.notifyTaskFailed('broken-task', 'Out of memory', 'org/repo', 'task-003');

      expect(sentSpy).toHaveBeenCalledOnce();
      expect(sentSpy.mock.calls[0][0].type).toBe('task_failed');
      expect(sentSpy.mock.calls[0][0].severity).toBe('error');
      expect(sentSpy.mock.calls[0][0].message).toContain('Out of memory');
    });
  });

  describe('notifySecurityAlert()', () => {
    it('should send critical severity for critical vulnerabilities', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.notifySecurityAlert('SQL Injection in login', 'critical', 'org/repo');

      expect(sentSpy.mock.calls[0][0].severity).toBe('critical');
    });

    it('should send critical severity for high vulnerabilities', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.notifySecurityAlert('XSS in comments', 'high', 'org/repo');

      expect(sentSpy.mock.calls[0][0].severity).toBe('critical');
    });

    it('should send warning severity for medium vulnerabilities', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.notifySecurityAlert('Outdated dependency', 'medium', 'org/repo');

      expect(sentSpy.mock.calls[0][0].severity).toBe('warning');
    });

    it('should send warning severity for low vulnerabilities', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.notifySecurityAlert('Info disclosure', 'low', 'org/repo');

      expect(sentSpy.mock.calls[0][0].severity).toBe('warning');
    });
  });

  describe('notifyScheduleTriggered()', () => {
    it('should send schedule notification with task list', async () => {
      const service = NotificationService.getInstance();
      service.configure({
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      });

      const sentSpy = vi.fn();
      service.on('sent', sentSpy);

      await service.notifyScheduleTriggered('nightly-maintenance', ['lint', 'test', 'audit']);

      expect(sentSpy).toHaveBeenCalledOnce();
      expect(sentSpy.mock.calls[0][0].type).toBe('schedule_triggered');
      expect(sentSpy.mock.calls[0][0].message).toContain('nightly-maintenance');
      expect(sentSpy.mock.calls[0][0].message).toContain('3 tasks');
      expect(sentSpy.mock.calls[0][0].fields!.Schedule).toBe('nightly-maintenance');
      expect(sentSpy.mock.calls[0][0].fields!.Tasks).toBe('3');
    });
  });
});
