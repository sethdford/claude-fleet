/**
 * Shared storage test helper
 *
 * Creates a real SQLiteStorage with a unique temp DB per test.
 * Handles setup/teardown and provides factory functions for common test data.
 */

import { SQLiteStorage } from '../../src/storage/sqlite.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface TestStorageContext {
  storage: SQLiteStorage;
  dbPath: string;
  cleanup: () => void;
}

/**
 * Create a test storage instance with a unique temp database.
 * Call cleanup() in afterEach to remove temp files.
 */
export function createTestStorage(): TestStorageContext {
  const dbPath = path.join(
    os.tmpdir(),
    `test-fleet-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const storage = new SQLiteStorage(dbPath);

  const cleanup = (): void => {
    storage.close();
    for (const suffix of ['', '-shm', '-wal']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        // Files may not exist
      }
    }
  };

  return { storage, dbPath, cleanup };
}

/**
 * Create a test user in storage and return the data.
 */
export function seedTestUser(
  storage: SQLiteStorage,
  overrides: Partial<{
    uid: string;
    handle: string;
    teamName: string;
    agentType: 'worker' | 'team-lead';
  }> = {}
): {
  uid: string;
  handle: string;
  teamName: string;
  agentType: 'worker' | 'team-lead';
} {
  const user = {
    uid: overrides.uid ?? 'a'.repeat(24),
    handle: overrides.handle ?? 'test-agent',
    teamName: overrides.teamName ?? 'test-team',
    agentType: overrides.agentType ?? ('worker' as const),
    createdAt: new Date().toISOString(),
    lastSeen: null,
  };
  storage.insertUser(user);
  return user;
}
