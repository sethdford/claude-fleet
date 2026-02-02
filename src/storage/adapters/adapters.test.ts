/**
 * Tests for Storage Adapter Stubs
 *
 * Tests S3, DynamoDB, Firestore, and PostgreSQL adapters.
 * All are stub implementations that throw "not implemented"
 * but provide in-memory swarm CRUD for interface compliance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3StorageAdapter } from './s3-adapter.js';
import { DynamoDBStorageAdapter } from './dynamodb-adapter.js';
import { FirestoreStorageAdapter } from './firestore-adapter.js';
import { PostgreSQLStorageAdapter } from './postgresql-adapter.js';

// Suppress console.log from initialize()
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ============================================================================
// Shared adapter behavior tests
// ============================================================================

interface AdapterEntry {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: () => any;
}

const adapters: AdapterEntry[] = [
  {
    name: 'S3StorageAdapter',
    create: () => new S3StorageAdapter({ backend: 's3', bucket: 'test-bucket', region: 'us-east-1' }),
  },
  {
    name: 'DynamoDBStorageAdapter',
    create: () => new DynamoDBStorageAdapter({ backend: 'dynamodb', region: 'us-east-1' }),
  },
  {
    name: 'FirestoreStorageAdapter',
    create: () => new FirestoreStorageAdapter({ backend: 'firestore', projectId: 'test-project' }),
  },
  {
    name: 'PostgreSQLStorageAdapter',
    create: () => new PostgreSQLStorageAdapter({
      backend: 'postgresql',
      connectionString: 'postgresql://user:pass@localhost:5432/db',
    }),
  },
];

for (const { name, create } of adapters) {
  describe(name, () => {
    it('should construct successfully', () => {
      const adapter = create();
      expect(adapter).toBeDefined();
    });

    it('should initialize without error', async () => {
      const adapter = create();
      await expect(adapter.initialize()).resolves.toBeUndefined();
    });

    it('should close without error', async () => {
      const adapter = create();
      await expect(adapter.close()).resolves.toBeUndefined();
    });

    it('should report healthy', async () => {
      const adapter = create();
      await expect(adapter.isHealthy()).resolves.toBe(true);
    });

    // ── Sub-storage interfaces exist ────────────────────────────────────

    it('should have all sub-storage interfaces', () => {
      const adapter = create();
      expect(adapter.team).toBeDefined();
      expect(adapter.worker).toBeDefined();
      expect(adapter.workItem).toBeDefined();
      expect(adapter.mail).toBeDefined();
      expect(adapter.blackboard).toBeDefined();
      expect(adapter.checkpoint).toBeDefined();
      expect(adapter.spawnQueue).toBeDefined();
      expect(adapter.tldr).toBeDefined();
    });

    // ── Sub-storage throws not implemented ──────────────────────────────

    it('should throw not implemented for team methods', async () => {
      const adapter = create();
      await expect(adapter.team.insertUser()).rejects.toThrow('not yet implemented');
      await expect(adapter.team.getUser()).rejects.toThrow('not yet implemented');
      await expect(adapter.team.getUsersByTeam()).rejects.toThrow('not yet implemented');
    });

    it('should throw not implemented for worker methods', async () => {
      const adapter = create();
      await expect(adapter.worker.insertWorker()).rejects.toThrow('not yet implemented');
      await expect(adapter.worker.getWorker()).rejects.toThrow('not yet implemented');
      await expect(adapter.worker.getAllWorkers()).rejects.toThrow('not yet implemented');
    });

    it('should throw not implemented for workItem methods', async () => {
      const adapter = create();
      await expect(adapter.workItem.createWorkItem()).rejects.toThrow('not yet implemented');
      await expect(adapter.workItem.getWorkItem()).rejects.toThrow('not yet implemented');
    });

    it('should throw not implemented for mail methods', async () => {
      const adapter = create();
      await expect(adapter.mail.sendMail()).rejects.toThrow('not yet implemented');
      await expect(adapter.mail.getMail()).rejects.toThrow('not yet implemented');
    });

    it('should throw not implemented for blackboard methods', () => {
      const adapter = create();
      expect(() => adapter.blackboard.postMessage()).toThrow('not yet implemented');
      expect(() => adapter.blackboard.readMessages()).toThrow('not yet implemented');
      expect(() => adapter.blackboard.getMessage()).toThrow('not yet implemented');
    });

    it('should throw not implemented for checkpoint methods', () => {
      const adapter = create();
      expect(() => adapter.checkpoint.createCheckpoint()).toThrow('not yet implemented');
      expect(() => adapter.checkpoint.loadCheckpoint()).toThrow('not yet implemented');
    });

    it('should throw not implemented for spawnQueue methods', async () => {
      const adapter = create();
      await expect(adapter.spawnQueue.enqueue()).rejects.toThrow('not yet implemented');
      await expect(adapter.spawnQueue.getItem()).rejects.toThrow('not yet implemented');
    });

    it('should throw not implemented for tldr methods', () => {
      const adapter = create();
      expect(() => adapter.tldr.getFileSummary()).toThrow('not yet implemented');
      expect(() => adapter.tldr.getFileSummaries()).toThrow('not yet implemented');
    });

    // ── Sub-storage initialize/close ────────────────────────────────────

    it('should allow sub-storage initialize and close', async () => {
      const adapter = create();
      await expect(adapter.team.initialize()).resolves.toBeUndefined();
      await expect(adapter.team.close()).resolves.toBeUndefined();
      await expect(adapter.worker.initialize()).resolves.toBeUndefined();
      await expect(adapter.worker.close()).resolves.toBeUndefined();
    });

    // ── Swarm CRUD (in-memory) ──────────────────────────────────────────

    it('should insert and get a swarm', () => {
      const adapter = create();
      adapter.insertSwarm({ id: 'swarm-1', name: 'Test Swarm' });
      const swarm = adapter.getSwarm('swarm-1');
      expect(swarm).not.toBeNull();
      expect(swarm!.id).toBe('swarm-1');
      expect(swarm!.name).toBe('Test Swarm');
      expect(swarm!.description).toBeNull();
      expect(swarm!.maxAgents).toBe(50);
    });

    it('should insert swarm with optional fields', () => {
      const adapter = create();
      adapter.insertSwarm({
        id: 'swarm-2',
        name: 'Custom Swarm',
        description: 'A described swarm',
        maxAgents: 10,
      });
      const swarm = adapter.getSwarm('swarm-2');
      expect(swarm!.description).toBe('A described swarm');
      expect(swarm!.maxAgents).toBe(10);
    });

    it('should return null for non-existent swarm', () => {
      const adapter = create();
      expect(adapter.getSwarm('nonexistent')).toBeNull();
    });

    it('should list all swarms', () => {
      const adapter = create();
      adapter.insertSwarm({ id: 's1', name: 'Swarm 1' });
      adapter.insertSwarm({ id: 's2', name: 'Swarm 2' });
      const swarms = adapter.getAllSwarms();
      expect(swarms).toHaveLength(2);
    });

    it('should delete a swarm', () => {
      const adapter = create();
      adapter.insertSwarm({ id: 'del-1', name: 'To Delete' });
      expect(adapter.getSwarm('del-1')).not.toBeNull();
      adapter.deleteSwarm('del-1');
      expect(adapter.getSwarm('del-1')).toBeNull();
    });

    it('should return empty array when no swarms exist', () => {
      const adapter = create();
      expect(adapter.getAllSwarms()).toEqual([]);
    });
  });
}
