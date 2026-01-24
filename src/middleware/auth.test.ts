/**
 * Tests for authentication middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  requireRole,
  type AuthenticatedRequest,
} from './auth.js';

// Mock request type that allows property assignment
interface MockRequest {
  headers: Record<string, string | undefined>;
  path: string;
  params: Record<string, string>;
  user?: AuthenticatedRequest['user'];
}

describe('Auth Middleware', () => {
  const TEST_SECRET = 'test-secret-key-for-testing';
  let mockReq: MockRequest;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockJson = vi.fn().mockReturnThis();
    mockStatus = vi.fn().mockReturnValue({ json: mockJson });
    mockReq = {
      headers: {},
      path: '/test',
      params: {},
    };
    mockRes = {
      status: mockStatus as unknown as Response['status'],
      json: mockJson as unknown as Response['json'],
    };
    mockNext = vi.fn();
  });

  describe('createAuthMiddleware', () => {
    it('allows public routes without token', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      mockReq.path = '/health';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockStatus).not.toHaveBeenCalled();
    });

    it('allows /metrics without token', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      mockReq.path = '/metrics';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('allows /auth without token', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      mockReq.path = '/auth';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('rejects protected route without token', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      mockReq.path = '/tasks';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Authentication required' })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('allows valid token and attaches user', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      const payload = {
        uid: 'a'.repeat(24),
        handle: 'test-agent',
        teamName: 'test-team',
        agentType: 'worker' as const,
      };
      const token = jwt.sign(payload, TEST_SECRET);
      mockReq.headers = { authorization: `Bearer ${token}` };
      mockReq.path = '/tasks';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toMatchObject(payload);
    });

    it('rejects expired token', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      const token = jwt.sign(
        { uid: 'a'.repeat(24), handle: 'test', teamName: 'test' },
        TEST_SECRET,
        { expiresIn: '-1h' }
      );
      mockReq.headers = { authorization: `Bearer ${token}` };
      mockReq.path = '/tasks';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Token expired' })
      );
    });

    it('rejects invalid token', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      mockReq.headers = { authorization: 'Bearer invalid-token' };
      mockReq.path = '/tasks';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid token' })
      );
    });

    it('rejects token signed with wrong secret', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      const token = jwt.sign(
        { uid: 'a'.repeat(24), handle: 'test', teamName: 'test' },
        'wrong-secret'
      );
      mockReq.headers = { authorization: `Bearer ${token}` };
      mockReq.path = '/tasks';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(403);
    });

    it('rejects token with missing required fields', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      const token = jwt.sign({ uid: 'a'.repeat(24) }, TEST_SECRET);
      mockReq.headers = { authorization: `Bearer ${token}` };
      mockReq.path = '/tasks';

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid token structure' })
      );
    });
  });

  describe('createOptionalAuthMiddleware', () => {
    it('proceeds without token', () => {
      const middleware = createOptionalAuthMiddleware(TEST_SECRET);

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it('attaches user if valid token present', () => {
      const middleware = createOptionalAuthMiddleware(TEST_SECRET);
      const payload = {
        uid: 'a'.repeat(24),
        handle: 'test-agent',
        teamName: 'test-team',
        agentType: 'worker' as const,
      };
      const token = jwt.sign(payload, TEST_SECRET);
      mockReq.headers = { authorization: `Bearer ${token}` };

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toMatchObject(payload);
    });

    it('proceeds without error if token invalid', () => {
      const middleware = createOptionalAuthMiddleware(TEST_SECRET);
      mockReq.headers = { authorization: 'Bearer invalid-token' };

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });
  });

  describe('requireRole', () => {
    it('allows matching role', () => {
      const middleware = requireRole('worker');
      mockReq.user = {
        uid: 'a'.repeat(24),
        handle: 'test',
        teamName: 'test',
        agentType: 'worker',
      };

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('allows any of multiple roles', () => {
      const middleware = requireRole('team-lead', 'worker');
      mockReq.user = {
        uid: 'a'.repeat(24),
        handle: 'test',
        teamName: 'test',
        agentType: 'team-lead',
      };

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('rejects non-matching role', () => {
      const middleware = requireRole('team-lead');
      mockReq.user = {
        uid: 'a'.repeat(24),
        handle: 'test',
        teamName: 'test',
        agentType: 'worker',
      };

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Insufficient permissions' })
      );
    });

    it('rejects if no user attached', () => {
      const middleware = requireRole('worker');

      middleware(mockReq as unknown as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(401);
    });
  });
});
