/**
 * Storage Module Index
 *
 * Main entry point for the storage abstraction layer.
 * Supports multiple backends: SQLite, DynamoDB, S3, Firestore, PostgreSQL
 */

// Core interfaces
export type {
  IStorage,
  ITeamStorage,
  IWorkerStorage,
  IWorkItemStorage,
  IMailStorage,
  IBlackboardStorage,
  ICheckpointStorage,
  ISpawnQueueStorage,
  ITLDRStorage,
  StorageConfig,
  StorageBackend,
  SQLiteConfig,
  DynamoDBConfig,
  S3Config,
  FirestoreConfig,
  PostgreSQLConfig,
} from './interfaces.js';

// Factory functions
export { createStorage, getStorageConfigFromEnv } from './factory.js';

// Adapters
export {
  SQLiteStorageAdapter,
  DynamoDBStorageAdapter,
  S3StorageAdapter,
  FirestoreStorageAdapter,
  PostgreSQLStorageAdapter,
} from './adapters/index.js';

// Legacy exports for backwards compatibility
export { SQLiteStorage } from './sqlite.js';
export { BlackboardStorage } from './blackboard.js';
export { CheckpointStorage } from './checkpoint.js';
export { SpawnQueueStorage } from './spawn-queue.js';
export { TLDRStorage } from './tldr.js';
