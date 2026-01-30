/**
 * Tests for Mail Route Handlers
 *
 * Validates inter-agent mail and handoff endpoints including
 * sending, receiving, marking read, and creating handoffs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';
import {
  createSendMailHandler,
  createGetMailHandler,
  createGetUnreadMailHandler,
  createMarkMailReadHandler,
  createCreateHandoffHandler,
  createGetHandoffsHandler,
} from './mail.js';

describe('createSendMailHandler', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it('should send mail between agents', async () => {
    const mailResult = {
      id: 1,
      fromHandle: 'agent-1',
      toHandle: 'agent-2',
      subject: 'Hello',
      body: 'Test message body',
      readAt: null,
      createdAt: Date.now(),
    };
    (deps.storage.mail.sendMail as ReturnType<typeof vi.fn>).mockResolvedValue(mailResult);

    const handler = createSendMailHandler(deps);
    const req = createMockReq({
      body: {
        from: 'agent-1',
        to: 'agent-2',
        body: 'Test message body',
        subject: 'Hello',
      },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(deps.storage.mail.sendMail).toHaveBeenCalledWith(
      'agent-1',
      'agent-2',
      'Test message body',
      'Hello',
    );
    expect(mockRes.json).toHaveBeenCalledWith(mailResult);
  });

  it('should reject without required fields', async () => {
    const handler = createSendMailHandler(deps);

    // Missing 'from' and 'to'
    const req = createMockReq({
      body: {
        body: 'Test message body',
      },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.status).toHaveBeenCalled();
    });

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const errorCall = mockRes.status.mock.results[0].value;
    expect(errorCall.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('should reject when body field is empty', async () => {
    const handler = createSendMailHandler(deps);

    const req = createMockReq({
      body: {
        from: 'agent-1',
        to: 'agent-2',
        body: '',
      },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.status).toHaveBeenCalled();
    });

    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('should send mail without optional subject', async () => {
    const mailResult = {
      id: 2,
      fromHandle: 'agent-1',
      toHandle: 'agent-2',
      subject: null,
      body: 'No subject message',
      readAt: null,
      createdAt: Date.now(),
    };
    (deps.storage.mail.sendMail as ReturnType<typeof vi.fn>).mockResolvedValue(mailResult);

    const handler = createSendMailHandler(deps);
    const req = createMockReq({
      body: {
        from: 'agent-1',
        to: 'agent-2',
        body: 'No subject message',
      },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(deps.storage.mail.sendMail).toHaveBeenCalledWith(
      'agent-1',
      'agent-2',
      'No subject message',
      undefined,
    );
    expect(mockRes.json).toHaveBeenCalledWith(mailResult);
  });
});

describe('createGetMailHandler', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it('should return mail for handle', async () => {
    const messages = [
      { id: 1, fromHandle: 'agent-1', toHandle: 'agent-2', subject: 'Test', body: 'Hello', readAt: null, createdAt: Date.now() },
      { id: 2, fromHandle: 'agent-3', toHandle: 'agent-2', subject: null, body: 'Hi', readAt: Date.now(), createdAt: Date.now() },
    ];
    (deps.storage.mail.getMail as ReturnType<typeof vi.fn>).mockResolvedValue(messages);

    const handler = createGetMailHandler(deps);
    const req = createMockReq({
      params: { handle: 'agent-2' },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(deps.storage.mail.getMail).toHaveBeenCalledWith('agent-2');
    expect(mockRes.json).toHaveBeenCalledWith(messages);
  });

  it('should return empty array when no mail exists', async () => {
    (deps.storage.mail.getMail as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const handler = createGetMailHandler(deps);
    const req = createMockReq({
      params: { handle: 'lonely-agent' },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(mockRes.json).toHaveBeenCalledWith([]);
  });
});

describe('createGetUnreadMailHandler', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it('should return only unread mail', async () => {
    const unreadMessages = [
      { id: 3, fromHandle: 'agent-1', toHandle: 'agent-2', subject: 'Urgent', body: 'Read me', readAt: null, createdAt: Date.now() },
    ];
    (deps.storage.mail.getUnreadMail as ReturnType<typeof vi.fn>).mockResolvedValue(unreadMessages);

    const handler = createGetUnreadMailHandler(deps);
    const req = createMockReq({
      params: { handle: 'agent-2' },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(deps.storage.mail.getUnreadMail).toHaveBeenCalledWith('agent-2');
    expect(mockRes.json).toHaveBeenCalledWith(unreadMessages);
  });

  it('should return empty array when all mail is read', async () => {
    (deps.storage.mail.getUnreadMail as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const handler = createGetUnreadMailHandler(deps);
    const req = createMockReq({
      params: { handle: 'agent-2' },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(mockRes.json).toHaveBeenCalledWith([]);
  });
});

describe('createMarkMailReadHandler', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it('should mark mail as read', async () => {
    (deps.storage.mail.markMailRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const handler = createMarkMailReadHandler(deps);
    const req = createMockReq({
      params: { id: '42' },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(deps.storage.mail.markMailRead).toHaveBeenCalledWith(42);
    expect(mockRes.json).toHaveBeenCalledWith({ success: true, id: 42 });
  });

  it('should reject invalid mail ID', async () => {
    const handler = createMarkMailReadHandler(deps);
    const req = createMockReq({
      params: { id: 'not-a-number' },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.status).toHaveBeenCalled();
    });

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const errorCall = mockRes.status.mock.results[0].value;
    expect(errorCall.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid mail ID' }),
    );
  });
});

describe('createCreateHandoffHandler', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it('should create handoff', async () => {
    const handoffResult = {
      id: 1,
      fromHandle: 'worker-1',
      toHandle: 'worker-2',
      context: { task: 'implement-feature', progress: 50 },
      acceptedAt: null,
      createdAt: Date.now(),
    };
    (deps.storage.mail.createHandoff as ReturnType<typeof vi.fn>).mockResolvedValue(handoffResult);

    const handler = createCreateHandoffHandler(deps);
    const req = createMockReq({
      body: {
        from: 'worker-1',
        to: 'worker-2',
        context: { task: 'implement-feature', progress: 50 },
      },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(deps.storage.mail.createHandoff).toHaveBeenCalledWith(
      'worker-1',
      'worker-2',
      { task: 'implement-feature', progress: 50 },
    );
    expect(mockRes.json).toHaveBeenCalledWith(handoffResult);
  });

  it('should reject without required fields', async () => {
    const handler = createCreateHandoffHandler(deps);

    // Missing 'context'
    const req = createMockReq({
      body: {
        from: 'worker-1',
        to: 'worker-2',
      },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.status).toHaveBeenCalled();
    });

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const errorCall = mockRes.status.mock.results[0].value;
    expect(errorCall.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('should reject when from handle is missing', async () => {
    const handler = createCreateHandoffHandler(deps);

    const req = createMockReq({
      body: {
        to: 'worker-2',
        context: { task: 'test' },
      },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.status).toHaveBeenCalled();
    });

    expect(mockRes.status).toHaveBeenCalledWith(400);
  });
});

describe('createGetHandoffsHandler', () => {
  let deps: RouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it('should return handoffs for handle', async () => {
    const handoffs = [
      { id: 1, fromHandle: 'worker-1', toHandle: 'worker-2', context: { task: 'build' }, acceptedAt: null, createdAt: Date.now() },
      { id: 2, fromHandle: 'worker-3', toHandle: 'worker-2', context: { task: 'test' }, acceptedAt: null, createdAt: Date.now() },
    ];
    (deps.storage.mail.getHandoffs as ReturnType<typeof vi.fn>).mockResolvedValue(handoffs);

    const handler = createGetHandoffsHandler(deps);
    const req = createMockReq({
      params: { handle: 'worker-2' },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(deps.storage.mail.getHandoffs).toHaveBeenCalledWith('worker-2', { pendingOnly: true });
    expect(mockRes.json).toHaveBeenCalledWith(handoffs);
  });

  it('should return empty array when no pending handoffs exist', async () => {
    (deps.storage.mail.getHandoffs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const handler = createGetHandoffsHandler(deps);
    const req = createMockReq({
      params: { handle: 'worker-2' },
    });
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    expect(mockRes.json).toHaveBeenCalledWith([]);
  });
});
