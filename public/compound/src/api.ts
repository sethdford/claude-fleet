// Compounding Machine - Typed API Client

import type { CompoundSnapshot } from './types';

let authToken: string | null = null;

const BASE_URL = window.location.origin;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Re-auth on 401: get fresh token and retry once
    authToken = null;
    try {
      await authenticate();
      // Retry with fresh token
      const retryHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string>),
      };
      if (authToken) {
        retryHeaders['Authorization'] = `Bearer ${authToken}`;
      }
      const retryResponse = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: retryHeaders,
      });
      if (!retryResponse.ok) {
        const text = await retryResponse.text();
        throw new Error(`API error ${retryResponse.status} after re-auth: ${text}`);
      }
      return retryResponse.json();
    } catch (reAuthErr) {
      throw new Error(`Authentication expired and re-auth failed: ${(reAuthErr as Error).message}`);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

export async function authenticate(): Promise<string> {
  // Direct fetch to avoid re-auth loop in request()
  const response = await fetch(`${BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: 'compound-viewer',
      teamName: 'monitoring',
      agentType: 'team-lead',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auth failed ${response.status}: ${text}`);
  }

  const data = await response.json() as { token: string; uid: string };
  authToken = data.token;
  return data.token;
}

export function getToken(): string | null {
  return authToken;
}

export async function fetchSnapshot(): Promise<CompoundSnapshot> {
  return request<CompoundSnapshot>('/compound/snapshot');
}

// Fallback: fetch data from individual endpoints if /compound/snapshot isn't available
export async function fetchWorkers() {
  return request<Array<Record<string, unknown>>>('/orchestrate/workers');
}

export async function fetchSwarms() {
  return request<Array<Record<string, unknown>>>('/swarms?includeAgents=true');
}

export async function fetchMetrics() {
  return request<Record<string, unknown>>('/metrics/json');
}

export async function fetchHealth() {
  // Health endpoint doesn't require auth
  const response = await fetch(`${BASE_URL}/health`);
  return response.json();
}
