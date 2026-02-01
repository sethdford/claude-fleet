/**
 * GitHub Webhooks Handler
 *
 * Receives GitHub webhook events and triggers autonomous tasks.
 * Supports: push, pull_request, issues, check_run, workflow_run
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { AutoScheduler } from '../scheduler/auto-scheduler.js';

const router = Router();

// Webhook secret for signature verification
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

// Extend Request type to include rawBody
interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

interface GitHubWebhookPayload {
  action?: string;
  ref?: string;
  repository?: {
    full_name: string;
    name: string;
    default_branch: string;
  };
  sender?: {
    login: string;
  };
  pull_request?: {
    number: number;
    title: string;
    head: { ref: string };
    base: { ref: string };
    labels?: Array<{ name: string }>;
  };
  issue?: {
    number: number;
    title: string;
    labels?: Array<{ name: string }>;
  };
  commits?: Array<{
    id: string;
    message: string;
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  check_run?: {
    name: string;
    conclusion: string;
  };
  alert?: {
    affected_package_name: string;
    severity: string;
  };
}

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET || !signature) {
    console.warn('[Webhooks] No secret configured or signature missing');
    return !WEBHOOK_SECRET; // Allow if no secret configured (dev mode)
  }

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Log webhook event
 */
function logWebhook(event: string, action: string | undefined, repo: string | undefined) {
  const timestamp = new Date().toISOString();
  console.log(`[Webhooks] ${timestamp} | ${event}${action ? `:${action}` : ''} | ${repo || 'unknown'}`);
}

/**
 * POST /webhooks/github
 * Main GitHub webhook endpoint
 */
router.post('/github', async (req: WebhookRequest, res: Response): Promise<void> => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const event = req.headers['x-github-event'] as string;
  const deliveryId = req.headers['x-github-delivery'] as string;

  // Verify signature using raw body (preserves exact byte sequence)
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  if (!verifySignature(rawBody, signature)) {
    console.error('[Webhooks] Invalid signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const payload: GitHubWebhookPayload = req.body;
  const repoName = payload.repository?.full_name;
  const action = payload.action;

  logWebhook(event, action, repoName);

  try {
    const tasks: string[] = [];

    switch (event) {
      case 'push':
        tasks.push(...handlePushEvent(payload));
        break;

      case 'pull_request':
        tasks.push(...handlePullRequestEvent(payload));
        break;

      case 'issues':
        tasks.push(...handleIssueEvent(payload));
        break;

      case 'check_run':
        tasks.push(...handleCheckRunEvent(payload));
        break;

      case 'dependabot_alert':
      case 'security_advisory':
        tasks.push(...handleSecurityEvent(payload));
        break;

      case 'ping':
        console.log('[Webhooks] Ping received, webhook configured correctly');
        res.json({ message: 'pong', deliveryId });
        return;

      default:
        console.log(`[Webhooks] Unhandled event type: ${event}`);
    }

    // Queue the tasks
    if (tasks.length > 0) {
      const scheduler = AutoScheduler.getInstance();
      for (const taskName of tasks) {
        await scheduler.queueTask({
          name: taskName,
          trigger: 'webhook',
          triggerEvent: event,
          repository: repoName,
          payload: {
            action,
            deliveryId,
            ...extractRelevantPayload(event, payload)
          }
        });
      }

      console.log(`[Webhooks] Queued ${tasks.length} tasks: ${tasks.join(', ')}`);
    }

    res.json({
      received: true,
      event,
      action,
      deliveryId,
      tasksQueued: tasks.length,
      tasks
    });
  } catch (error) {
    console.error('[Webhooks] Error processing webhook:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

/**
 * Handle push events
 */
function handlePushEvent(payload: GitHubWebhookPayload): string[] {
  const tasks: string[] = [];
  const branch = payload.ref?.replace('refs/heads/', '');
  const defaultBranch = payload.repository?.default_branch;

  // Only trigger on default branch pushes
  if (branch === defaultBranch) {
    tasks.push('update-documentation');
    tasks.push('run-linter-check');

    // Check if specific file types were modified
    const allFiles = payload.commits?.flatMap(c => [...c.added, ...c.modified]) || [];

    if (allFiles.some(f => f.endsWith('.ts') || f.endsWith('.js'))) {
      tasks.push('analyze-code-quality');
    }

    if (allFiles.some(f => f.includes('test') || f.includes('spec'))) {
      tasks.push('validate-test-coverage');
    }
  }

  return tasks;
}

/**
 * Handle pull request events
 */
function handlePullRequestEvent(payload: GitHubWebhookPayload): string[] {
  const tasks: string[] = [];
  const action = payload.action;

  switch (action) {
    case 'opened':
    case 'synchronize':
      tasks.push('generate-pr-tests');
      tasks.push('security-scan');
      tasks.push('code-review');
      tasks.push('check-dependencies');
      break;

    case 'labeled': {
      const labels = payload.pull_request?.labels?.map(l => l.name) || [];
      if (labels.includes('needs-docs')) {
        tasks.push('generate-documentation');
      }
      if (labels.includes('needs-tests')) {
        tasks.push('generate-tests');
      }
      if (labels.includes('auto-fix')) {
        tasks.push('auto-fix-issues');
      }
      break;
    }

    case 'closed':
      if (payload.pull_request) {
        tasks.push('cleanup-pr-resources');
      }
      break;
  }

  return tasks;
}

/**
 * Handle issue events
 */
function handleIssueEvent(payload: GitHubWebhookPayload): string[] {
  const tasks: string[] = [];
  const action = payload.action;
  const labels = payload.issue?.labels?.map(l => l.name) || [];

  if (action === 'opened' || action === 'labeled') {
    if (labels.includes('bug')) {
      tasks.push('investigate-bug');
    }
    if (labels.includes('enhancement') || labels.includes('feature')) {
      tasks.push('analyze-feature-request');
    }
    if (labels.includes('documentation')) {
      tasks.push('update-documentation');
    }
    if (labels.includes('good-first-issue')) {
      tasks.push('generate-implementation-guide');
    }
  }

  return tasks;
}

/**
 * Handle check run events (CI failures)
 */
function handleCheckRunEvent(payload: GitHubWebhookPayload): string[] {
  const tasks: string[] = [];

  if (payload.action === 'completed' && payload.check_run?.conclusion === 'failure') {
    const checkName = payload.check_run.name.toLowerCase();

    if (checkName.includes('lint')) {
      tasks.push('auto-fix-lint-errors');
    }
    if (checkName.includes('type') || checkName.includes('typescript')) {
      tasks.push('fix-type-errors');
    }
    if (checkName.includes('test')) {
      tasks.push('investigate-test-failure');
    }
    if (checkName.includes('build')) {
      tasks.push('investigate-build-failure');
    }
  }

  return tasks;
}

/**
 * Handle security events (Dependabot, Snyk, etc.)
 */
function handleSecurityEvent(payload: GitHubWebhookPayload): string[] {
  const tasks: string[] = [];

  if (payload.action === 'created' || payload.action === 'reopened') {
    const severity = payload.alert?.severity?.toLowerCase();

    tasks.push('security-vulnerability-scan');

    if (severity === 'critical' || severity === 'high') {
      tasks.push('urgent-security-fix');
    } else {
      tasks.push('scheduled-security-fix');
    }
  }

  return tasks;
}

/**
 * Extract relevant payload data for task context
 */
function extractRelevantPayload(event: string, payload: GitHubWebhookPayload): Record<string, unknown> {
  const base: Record<string, unknown> = {
    repository: payload.repository?.full_name,
    sender: payload.sender?.login
  };

  switch (event) {
    case 'push':
      return {
        ...base,
        branch: payload.ref?.replace('refs/heads/', ''),
        commits: payload.commits?.length || 0,
        files: payload.commits?.flatMap(c => [...c.added, ...c.modified, ...c.removed]) || []
      };

    case 'pull_request':
      return {
        ...base,
        prNumber: payload.pull_request?.number,
        prTitle: payload.pull_request?.title,
        headBranch: payload.pull_request?.head.ref,
        baseBranch: payload.pull_request?.base.ref,
        labels: payload.pull_request?.labels?.map(l => l.name) || []
      };

    case 'issues':
      return {
        ...base,
        issueNumber: payload.issue?.number,
        issueTitle: payload.issue?.title,
        labels: payload.issue?.labels?.map(l => l.name) || []
      };

    default:
      return base;
  }
}

/**
 * GET /webhooks/status
 * Check webhook configuration status
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    configured: !!WEBHOOK_SECRET,
    endpoint: '/webhooks/github',
    supportedEvents: [
      'push',
      'pull_request',
      'issues',
      'check_run',
      'dependabot_alert',
      'security_advisory',
      'ping'
    ]
  });
});

/**
 * GET /webhooks/history
 * Get recent webhook events (for debugging)
 */
router.get('/history', async (_req: Request, res: Response) => {
  const scheduler = AutoScheduler.getInstance();
  const recentTasks = await scheduler.getRecentWebhookTasks(20);
  res.json(recentTasks);
});

export default router;
