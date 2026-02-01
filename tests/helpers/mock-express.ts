/**
 * Shared Express mock helpers for route handler tests
 *
 * Provides factory functions for creating mock Request and Response objects
 * compatible with Express route handlers.
 */

import { vi } from 'vitest';

/**
 * Partial Response type that matches mock structure
 */
export interface MockResponse {
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  headersSent: boolean;
}

/**
 * Creates a mock Express Response with chainable status().json() methods.
 *
 * Usage:
 *   const res = createMockRes();
 *   handler(req as Request, res as unknown as Response);
 *   expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
 *   expect(res.status).toHaveBeenCalledWith(400);
 */
export function createMockRes(): MockResponse {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return {
    json,
    status,
    headersSent: false,
  };
}

/**
 * Partial Request type that allows property overrides
 */
export interface MockRequest {
  headers: Record<string, string | undefined>;
  params: Record<string, string>;
  body: Record<string, unknown>;
  query: Record<string, string | undefined>;
  path: string;
  method: string;
  [key: string]: unknown;
}

/**
 * Creates a mock Express Request with sensible defaults.
 *
 * @param overrides - Partial object to override default request properties
 * @returns A mock request object that can be cast to Request
 *
 * Usage:
 *   const req = createMockReq({ body: { handle: 'agent-1' }, method: 'POST' });
 *   handler(req as unknown as Request, res as unknown as Response);
 */
export function createMockReq(overrides?: Partial<MockRequest>): MockRequest {
  const { query, ...rest } = overrides ?? {};
  return {
    headers: {},
    params: {},
    body: {},
    query: query ?? {},
    path: '/test',
    method: 'GET',
    ...rest,
  };
}
