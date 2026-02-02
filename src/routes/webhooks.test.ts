/**
 * Tests for webhooks route handlers
 *
 * Tests POST /github (signature verification, event routing, task queueing),
 * GET /status, and GET /history endpoints through the Express router.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import type { Request, Response } from 'express';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQueueTask = vi.fn().mockResolvedValue('task-1');
const mockGetRecentWebhookTasks = vi.fn().mockResolvedValue([]);

vi.mock('../scheduler/auto-scheduler.js', () => ({
  AutoScheduler: {
    getInstance: vi.fn().mockReturnValue({
      queueTask: mockQueueTask,
      getRecentWebhookTasks: mockGetRecentWebhookTasks,
    }),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute a valid HMAC-SHA256 signature for a given payload and secret.
 */
function computeSignature(payload: string, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

interface MockRes {
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  headersSent: boolean;
}

function createRes(): MockRes {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { json, status, headersSent: false };
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: unknown) => unknown }>;
  };
}

/**
 * Extract the route handler function from the imported router by path and method.
 */
function getHandler(
  router: { stack: RouteLayer[] },
  method: string,
  path: string
): ((req: Request, res: Response) => Promise<void>) | undefined {
  for (const layer of router.stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      const handlerLayer = layer.route.stack[layer.route.stack.length - 1];
      return handlerLayer.handle as (req: Request, res: Response) => Promise<void>;
    }
  }
  return undefined;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Webhook Routes', () => {
  const TEST_SECRET = 'test-webhook-secret-42';
  let postGithub: (req: Request, res: Response) => Promise<void>;
  let getStatus: (req: Request, res: Response) => void;
  let getHistory: (req: Request, res: Response) => Promise<void>;

  // Spy on console to suppress log noise
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Set the env var BEFORE dynamic import so the module picks it up
    process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;

    // Re-import the module fresh each time so WEBHOOK_SECRET is re-read
    vi.resetModules();

    // Re-mock after resetModules
    vi.doMock('../scheduler/auto-scheduler.js', () => ({
      AutoScheduler: {
        getInstance: vi.fn().mockReturnValue({
          queueTask: mockQueueTask,
          getRecentWebhookTasks: mockGetRecentWebhookTasks,
        }),
      },
    }));

    const mod = await import('./webhooks.js');
    const router = mod.default as unknown as { stack: RouteLayer[] };

    const postHandler = getHandler(router, 'post', '/github');
    const statusHandler = getHandler(router, 'get', '/status');
    const historyHandler = getHandler(router, 'get', '/history');

    if (!postHandler || !statusHandler || !historyHandler) {
      throw new Error('Could not extract route handlers from router');
    }

    postGithub = postHandler;
    getStatus = statusHandler as unknown as (req: Request, res: Response) => void;
    getHistory = historyHandler;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Signature Verification (through POST /github)
  // ════════════════════════════════════════════════════════════════════════════

  describe('verifySignature (via POST /github)', () => {
    it('should accept a valid HMAC-SHA256 signature', async () => {
      const body = { repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' } };
      const rawBody = JSON.stringify(body);
      const signature = computeSignature(rawBody, TEST_SECRET);

      const req = {
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
          'x-github-delivery': 'delivery-1',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'pong' })
      );
    });

    it('should reject an invalid signature with 401', async () => {
      const body = { repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' } };
      const rawBody = JSON.stringify(body);

      const req = {
        headers: {
          'x-hub-signature-256': 'sha256=badhex0000000000000000000000000000000000000000000000000000000000',
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-2',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should reject when signature header is missing and secret is configured', async () => {
      const body = { repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' } };

      const req = {
        headers: {
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-3',
        },
        body,
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('verifySignature dev mode (no secret)', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      vi.resetModules();
      delete process.env.GITHUB_WEBHOOK_SECRET;

      vi.doMock('../scheduler/auto-scheduler.js', () => ({
        AutoScheduler: {
          getInstance: vi.fn().mockReturnValue({
            queueTask: mockQueueTask,
            getRecentWebhookTasks: mockGetRecentWebhookTasks,
          }),
        },
      }));

      const mod = await import('./webhooks.js');
      const router = mod.default as unknown as { stack: RouteLayer[] };
      const handler = getHandler(router, 'post', '/github');
      if (!handler) throw new Error('Could not extract POST /github handler');
      postGithub = handler;
    });

    it('should allow requests without signature when no secret is configured (dev mode)', async () => {
      const body = { repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' } };

      const req = {
        headers: {
          'x-github-event': 'ping',
          'x-github-delivery': 'delivery-4',
        },
        body,
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'pong' })
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Push Events
  // ════════════════════════════════════════════════════════════════════════════

  describe('handlePushEvent', () => {
    function makePushReq(
      branch: string,
      defaultBranch: string,
      files: { added: string[]; modified: string[] }[]
    ) {
      const commits = files.map((f, idx) => ({
        id: `sha${idx}`,
        message: `commit ${idx}`,
        added: f.added,
        modified: f.modified,
        removed: [],
      }));
      const body = {
        ref: `refs/heads/${branch}`,
        repository: { full_name: 'org/repo', name: 'repo', default_branch: defaultBranch },
        sender: { login: 'user' },
        commits,
      };
      const rawBody = JSON.stringify(body);
      return {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-push',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
    }

    it('should queue documentation and linter tasks on default branch push', async () => {
      const req = makePushReq('main', 'main', [{ added: ['README.md'], modified: [] }]);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasksQueued).toBeGreaterThanOrEqual(2);
      expect(result.tasks).toContain('update-documentation');
      expect(result.tasks).toContain('run-linter-check');
    });

    it('should queue analyze-code-quality when .ts files are modified', async () => {
      const req = makePushReq('main', 'main', [{ added: [], modified: ['src/index.ts'] }]);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('analyze-code-quality');
    });

    it('should queue analyze-code-quality when .js files are added', async () => {
      const req = makePushReq('main', 'main', [{ added: ['lib/util.js'], modified: [] }]);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('analyze-code-quality');
    });

    it('should queue validate-test-coverage when test files are modified', async () => {
      const req = makePushReq('main', 'main', [{ added: [], modified: ['src/foo.test.ts'] }]);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('validate-test-coverage');
    });

    it('should queue validate-test-coverage when spec files are modified', async () => {
      const req = makePushReq('main', 'main', [{ added: ['spec/helpers.ts'], modified: [] }]);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('validate-test-coverage');
    });

    it('should not queue any tasks for non-default branch push', async () => {
      const req = makePushReq('feature/xyz', 'main', [{ added: ['src/new.ts'], modified: [] }]);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasksQueued).toBe(0);
      expect(result.tasks).toEqual([]);
      expect(mockQueueTask).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Pull Request Events
  // ════════════════════════════════════════════════════════════════════════════

  describe('handlePullRequestEvent', () => {
    function makePrReq(action: string, labels: string[] = []) {
      const body = {
        action,
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'user' },
        pull_request: {
          number: 42,
          title: 'Test PR',
          head: { ref: 'feat/branch' },
          base: { ref: 'main' },
          labels: labels.map(name => ({ name })),
        },
      };
      const rawBody = JSON.stringify(body);
      return {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-pr',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
    }

    it('should queue PR review tasks on opened action', async () => {
      const req = makePrReq('opened');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('generate-pr-tests');
      expect(result.tasks).toContain('security-scan');
      expect(result.tasks).toContain('code-review');
      expect(result.tasks).toContain('check-dependencies');
      expect(result.tasksQueued).toBe(4);
    });

    it('should queue PR review tasks on synchronize action', async () => {
      const req = makePrReq('synchronize');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('generate-pr-tests');
      expect(result.tasksQueued).toBe(4);
    });

    it('should queue generate-documentation on needs-docs label', async () => {
      const req = makePrReq('labeled', ['needs-docs']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('generate-documentation');
      expect(result.tasks).not.toContain('generate-tests');
    });

    it('should queue generate-tests on needs-tests label', async () => {
      const req = makePrReq('labeled', ['needs-tests']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('generate-tests');
    });

    it('should queue auto-fix-issues on auto-fix label', async () => {
      const req = makePrReq('labeled', ['auto-fix']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('auto-fix-issues');
    });

    it('should queue cleanup on closed action', async () => {
      const req = makePrReq('closed');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('cleanup-pr-resources');
      expect(result.tasksQueued).toBe(1);
    });

    it('should queue nothing for unrecognized PR action', async () => {
      const req = makePrReq('edited');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasksQueued).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Issue Events
  // ════════════════════════════════════════════════════════════════════════════

  describe('handleIssueEvent', () => {
    function makeIssueReq(action: string, labels: string[]) {
      const body = {
        action,
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'user' },
        issue: {
          number: 99,
          title: 'Test Issue',
          labels: labels.map(name => ({ name })),
        },
      };
      const rawBody = JSON.stringify(body);
      return {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'issues',
          'x-github-delivery': 'delivery-issue',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
    }

    it('should queue investigate-bug for opened issue with bug label', async () => {
      const req = makeIssueReq('opened', ['bug']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('investigate-bug');
    });

    it('should queue analyze-feature-request for enhancement label', async () => {
      const req = makeIssueReq('labeled', ['enhancement']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('analyze-feature-request');
    });

    it('should queue analyze-feature-request for feature label', async () => {
      const req = makeIssueReq('opened', ['feature']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('analyze-feature-request');
    });

    it('should queue update-documentation for documentation label', async () => {
      const req = makeIssueReq('labeled', ['documentation']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('update-documentation');
    });

    it('should queue generate-implementation-guide for good-first-issue label', async () => {
      const req = makeIssueReq('opened', ['good-first-issue']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('generate-implementation-guide');
    });

    it('should not queue tasks for closed action', async () => {
      const req = makeIssueReq('closed', ['bug']);
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasksQueued).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Check Run Events
  // ════════════════════════════════════════════════════════════════════════════

  describe('handleCheckRunEvent', () => {
    function makeCheckReq(action: string, name: string, conclusion: string) {
      const body = {
        action,
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'ci-bot' },
        check_run: { name, conclusion },
      };
      const rawBody = JSON.stringify(body);
      return {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'check_run',
          'x-github-delivery': 'delivery-check',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
    }

    it('should queue auto-fix-lint-errors for lint failure', async () => {
      const req = makeCheckReq('completed', 'ESLint Check', 'failure');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('auto-fix-lint-errors');
    });

    it('should queue fix-type-errors for type check failure', async () => {
      const req = makeCheckReq('completed', 'TypeScript Type Check', 'failure');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('fix-type-errors');
    });

    it('should queue investigate-test-failure for test failure', async () => {
      const req = makeCheckReq('completed', 'Unit Tests', 'failure');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('investigate-test-failure');
    });

    it('should queue investigate-build-failure for build failure', async () => {
      const req = makeCheckReq('completed', 'Production Build', 'failure');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('investigate-build-failure');
    });

    it('should not queue tasks when check run succeeds', async () => {
      const req = makeCheckReq('completed', 'ESLint Check', 'success');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasksQueued).toBe(0);
    });

    it('should not queue tasks for non-completed check run action', async () => {
      const req = makeCheckReq('created', 'ESLint Check', 'failure');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasksQueued).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Security Events
  // ════════════════════════════════════════════════════════════════════════════

  describe('handleSecurityEvent', () => {
    function makeSecurityReq(
      event: string,
      action: string,
      severity: string
    ) {
      const body = {
        action,
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'dependabot' },
        alert: { affected_package_name: 'lodash', severity },
      };
      const rawBody = JSON.stringify(body);
      return {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': event,
          'x-github-delivery': 'delivery-sec',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
    }

    it('should queue urgent-security-fix for critical severity', async () => {
      const req = makeSecurityReq('dependabot_alert', 'created', 'critical');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('security-vulnerability-scan');
      expect(result.tasks).toContain('urgent-security-fix');
      expect(result.tasks).not.toContain('scheduled-security-fix');
    });

    it('should queue urgent-security-fix for high severity', async () => {
      const req = makeSecurityReq('security_advisory', 'created', 'high');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('urgent-security-fix');
    });

    it('should queue scheduled-security-fix for low severity', async () => {
      const req = makeSecurityReq('dependabot_alert', 'created', 'low');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('security-vulnerability-scan');
      expect(result.tasks).toContain('scheduled-security-fix');
      expect(result.tasks).not.toContain('urgent-security-fix');
    });

    it('should queue scheduled-security-fix for medium severity', async () => {
      const req = makeSecurityReq('dependabot_alert', 'reopened', 'medium');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasks).toContain('scheduled-security-fix');
    });

    it('should not queue tasks for dismissed action', async () => {
      const req = makeSecurityReq('dependabot_alert', 'dismissed', 'critical');
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.tasksQueued).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // extractRelevantPayload (through task payload inspection)
  // ════════════════════════════════════════════════════════════════════════════

  describe('extractRelevantPayload', () => {
    it('should include branch and files for push events', async () => {
      const body = {
        ref: 'refs/heads/main',
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'user' },
        commits: [{
          id: 'abc',
          message: 'fix',
          added: ['new.ts'],
          modified: ['old.ts'],
          removed: ['gone.ts'],
        }],
      };
      const rawBody = JSON.stringify(body);
      const req = {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-extract-push',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      // The first queueTask call should have payload with push-specific fields
      expect(mockQueueTask).toHaveBeenCalled();
      const firstCall = mockQueueTask.mock.calls[0][0];
      expect(firstCall.payload).toHaveProperty('branch', 'main');
      expect(firstCall.payload).toHaveProperty('commits', 1);
      expect(firstCall.payload.files).toEqual(expect.arrayContaining(['new.ts', 'old.ts', 'gone.ts']));
      expect(firstCall.payload).toHaveProperty('repository', 'org/repo');
      expect(firstCall.payload).toHaveProperty('sender', 'user');
    });

    it('should include PR details for pull_request events', async () => {
      const body = {
        action: 'opened',
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'dev' },
        pull_request: {
          number: 55,
          title: 'Add feature',
          head: { ref: 'feat/thing' },
          base: { ref: 'main' },
          labels: [{ name: 'enhancement' }],
        },
      };
      const rawBody = JSON.stringify(body);
      const req = {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-extract-pr',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const firstCall = mockQueueTask.mock.calls[0][0];
      expect(firstCall.payload).toHaveProperty('prNumber', 55);
      expect(firstCall.payload).toHaveProperty('prTitle', 'Add feature');
      expect(firstCall.payload).toHaveProperty('headBranch', 'feat/thing');
      expect(firstCall.payload).toHaveProperty('baseBranch', 'main');
      expect(firstCall.payload.labels).toEqual(['enhancement']);
    });

    it('should include issue details for issues events', async () => {
      const body = {
        action: 'opened',
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'reporter' },
        issue: {
          number: 101,
          title: 'Something broke',
          labels: [{ name: 'bug' }],
        },
      };
      const rawBody = JSON.stringify(body);
      const req = {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'issues',
          'x-github-delivery': 'delivery-extract-issue',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const firstCall = mockQueueTask.mock.calls[0][0];
      expect(firstCall.payload).toHaveProperty('issueNumber', 101);
      expect(firstCall.payload).toHaveProperty('issueTitle', 'Something broke');
      expect(firstCall.payload.labels).toEqual(['bug']);
    });

    it('should include base fields for unrecognized event types', async () => {
      const body = {
        action: 'completed',
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'ci-bot' },
        check_run: { name: 'ESLint', conclusion: 'failure' },
      };
      const rawBody = JSON.stringify(body);
      const req = {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'check_run',
          'x-github-delivery': 'delivery-extract-default',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      // check_run falls into the default case of extractRelevantPayload
      const firstCall = mockQueueTask.mock.calls[0][0];
      expect(firstCall.payload).toHaveProperty('repository', 'org/repo');
      expect(firstCall.payload).toHaveProperty('sender', 'ci-bot');
      // Should NOT have push/pr/issue-specific fields
      expect(firstCall.payload).not.toHaveProperty('branch');
      expect(firstCall.payload).not.toHaveProperty('prNumber');
      expect(firstCall.payload).not.toHaveProperty('issueNumber');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Ping Event
  // ════════════════════════════════════════════════════════════════════════════

  describe('ping event', () => {
    it('should respond with pong and deliveryId', async () => {
      const body = { repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' } };
      const rawBody = JSON.stringify(body);
      const req = {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'ping',
          'x-github-delivery': 'delivery-ping-123',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      expect(res.json).toHaveBeenCalledWith({
        message: 'pong',
        deliveryId: 'delivery-ping-123',
      });
      expect(mockQueueTask).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Unhandled Events
  // ════════════════════════════════════════════════════════════════════════════

  describe('unhandled events', () => {
    it('should respond with zero tasks for unrecognized event type', async () => {
      const body = { repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' } };
      const rawBody = JSON.stringify(body);
      const req = {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'fork',
          'x-github-delivery': 'delivery-fork',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result.received).toBe(true);
      expect(result.event).toBe('fork');
      expect(result.tasksQueued).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Error Handling
  // ════════════════════════════════════════════════════════════════════════════

  describe('error handling', () => {
    it('should return 500 when queueTask throws', async () => {
      mockQueueTask.mockRejectedValueOnce(new Error('DB connection lost'));

      const body = {
        action: 'opened',
        repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' },
        sender: { login: 'user' },
        issue: {
          number: 1,
          title: 'Bug',
          labels: [{ name: 'bug' }],
        },
      };
      const rawBody = JSON.stringify(body);
      const req = {
        headers: {
          'x-hub-signature-256': computeSignature(rawBody, TEST_SECRET),
          'x-github-event': 'issues',
          'x-github-delivery': 'delivery-err',
        },
        body,
        rawBody: Buffer.from(rawBody),
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /status
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /status', () => {
    it('should return webhook configuration status', () => {
      const req = { headers: {}, params: {}, body: {}, query: {} } as unknown as Request;
      const res = createRes();

      getStatus(req, res as unknown as Response);

      const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(result).toHaveProperty('configured');
      expect(result.endpoint).toBe('/webhooks/github');
      expect(result.supportedEvents).toContain('push');
      expect(result.supportedEvents).toContain('pull_request');
      expect(result.supportedEvents).toContain('issues');
      expect(result.supportedEvents).toContain('check_run');
      expect(result.supportedEvents).toContain('ping');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /history
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /history', () => {
    it('should return recent webhook tasks', async () => {
      const fakeTasks = [
        { id: 't1', name: 'security-scan', status: 'completed' },
        { id: 't2', name: 'code-review', status: 'queued' },
      ];
      mockGetRecentWebhookTasks.mockResolvedValueOnce(fakeTasks);

      const req = { headers: {}, params: {}, body: {}, query: {} } as unknown as Request;
      const res = createRes();

      await getHistory(req, res as unknown as Response);

      expect(mockGetRecentWebhookTasks).toHaveBeenCalledWith(20);
      expect(res.json).toHaveBeenCalledWith(fakeTasks);
    });

    it('should return empty array when no tasks', async () => {
      mockGetRecentWebhookTasks.mockResolvedValueOnce([]);

      const req = { headers: {}, params: {}, body: {}, query: {} } as unknown as Request;
      const res = createRes();

      await getHistory(req, res as unknown as Response);

      expect(res.json).toHaveBeenCalledWith([]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // rawBody vs JSON.stringify fallback
  // ════════════════════════════════════════════════════════════════════════════

  describe('rawBody handling', () => {
    it('should use JSON.stringify(body) when rawBody is not present', async () => {
      const body = { repository: { full_name: 'org/repo', name: 'repo', default_branch: 'main' } };
      const rawBody = JSON.stringify(body);
      const signature = computeSignature(rawBody, TEST_SECRET);

      const req = {
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
          'x-github-delivery': 'delivery-no-raw',
        },
        body,
        // No rawBody property
      } as unknown as Request;
      const res = createRes();

      await postGithub(req, res as unknown as Response);

      // Should succeed because JSON.stringify(body) matches
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'pong' })
      );
    });
  });
});
